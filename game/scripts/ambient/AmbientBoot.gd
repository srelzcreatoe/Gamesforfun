class_name AmbientBoot
extends Node
## Autoload `Ambient`: installs the ambient-life layer under whatever World is current and keeps
## it in sync with the world's planet, clock and weather. Nothing outside scripts/ambient/ has to
## call into the ambient system — it wires itself up through the Events bus alone.
##
## project.godot:  Ambient="*res://scripts/ambient/AmbientBoot.gd"
##
## Command line user args (after `--`), all debug-only and all no-ops when absent:
##   --profile                 print the ambient timing line (after the ChunkManager world line)
##   --ambient-off             do not install anything
##   --ambient-night           hold the world clock at night (fireflies, shooting stars)
##   --ambient-day             hold the world clock in the morning (butterflies, birds, pollen)
##   --ambient-dusk            hold the world clock at sunset (distant flock silhouettes)
##   --ambient-time=<ticks>    hold the world clock at an exact tick in [0, 24000)
##   --ambient-weather=<kind>  force World.weather ("rain", "thunder", "snow", ...)
##   --ambient-demo            fire the reactive effects on a loop (splash / debris / wisp)
##   --ambient-cap=<quads>     override the global quad budget
##   --ambient-nohud           hide the HUD layer so a verification shot is just the world

const LIFE_SCENE := "res://scenes/ambient/AmbientLife.tscn"
const NODE_NAME := "AmbientLife"
const DEMO_PERIOD := 1.0
const DEMO_WATER_SEARCH := 22

var life: AmbientLife = null
var world: Node = null

var force_profile := false
var install_enabled := true
var forced_time := -1.0
var forced_weather := ""
var demo := false
var quad_cap := -1
var hide_hud := false

var _demo_timer := 0.0
var _demo_step := 0
var _elapsed := 0.0
var _demo_shot_at := -1.0
var _demo_shot_fired := false
## A world we were told is unloading. `_process` will not adopt it again, so world_unloading
## really does stop the layer instead of being undone on the next frame.
var _retired_world: Node = null
var _rng := RandomNumberGenerator.new()

## signal name -> handler, so the wiring can be connected, disconnected and inspected as a set.
func _handlers() -> Dictionary:
	return {
		"world_loaded": _on_world_loaded,
		"world_unloading": _on_world_unloading,
		"player_spawned": _on_player_spawned,
		"planet_changed": _on_planet_changed,
		"weather_changed": _on_weather_changed,
		"time_changed": _on_time_changed,
	}

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_rng.randomize()
	_parse_args()
	# A world that was already running when this autoload came up (scene reload, tests).
	if Game != null and Game.world != null:
		install(Game.world)

func _enter_tree() -> void:
	if Events == null:
		return
	var h := _handlers()
	for key in h.keys():
		var name := String(key)
		var cb: Callable = h[key]
		if not Events.is_connected(name, cb):
			Events.connect(name, cb)

## An autoload never leaves the tree; a throwaway instance (tests) must stop hearing the bus the
## moment it is detached, or it would keep installing ambient layers into other people's worlds.
func _exit_tree() -> void:
	if Events == null:
		return
	var h := _handlers()
	for key in h.keys():
		var name := String(key)
		var cb: Callable = h[key]
		if Events.is_connected(name, cb):
			Events.disconnect(name, cb)
	uninstall()

func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--"):
			continue
		var kv := a.substr(2).split("=", true, 1)
		var key := kv[0]
		var value: String = kv[1] if kv.size() > 1 else ""
		match key:
			"profile":
				force_profile = true
			"ambient-off", "no-ambient":
				install_enabled = false
			"ambient-night":
				forced_time = 17000.0
			"ambient-day":
				forced_time = 3000.0
			"ambient-dusk":
				forced_time = 11900.0
			"ambient-time":
				if value.is_valid_float():
					forced_time = fposmod(value.to_float(), 24000.0)
			"ambient-weather":
				forced_weather = value
			"ambient-demo":
				demo = true
			"ambient-nohud":
				hide_hud = true
			"ambient-cap":
				if value.is_valid_int():
					quad_cap = value.to_int()
			"after":
				# Main's screenshot delay: with --ambient-demo, one burst is fired just before
				# the shutter so a verification shot always catches the reactive layer.
				if value.is_valid_float():
					_demo_shot_at = value.to_float()

# --- install / teardown -----------------------------------------------------------------------

## Create the AmbientLife node under `w` (idempotent) and bind it. Returns the node, or null.
func install(w: Node) -> AmbientLife:
	if not install_enabled or w == null or not is_instance_valid(w):
		return null
	# An explicit install (world_loaded, planet change, a test) un-retires the world.
	if _retired_world == w:
		_retired_world = null
	world = w
	var existing: Node = w.get_node_or_null(NODE_NAME)
	if existing is AmbientLife:
		life = existing
	if life == null or not is_instance_valid(life):
		life = _make_life()
		if life == null:
			return null
		life.name = NODE_NAME
		w.add_child(life)
	life.force_profile = force_profile
	if quad_cap > 0:
		life.set_quad_cap(quad_cap)
	_apply_overrides()
	life.bind(w)
	return life

func _make_life() -> AmbientLife:
	if ResourceLoader.exists(LIFE_SCENE):
		var packed: PackedScene = load(LIFE_SCENE)
		if packed != null:
			var inst: Node = packed.instantiate()
			if inst is AmbientLife:
				return inst
			if inst != null:
				inst.queue_free()
	return AmbientLife.new()

## Stop and destroy the ambient layer. The node itself is freed: leaving it parked under a
## world that is being torn down would keep its emitters (and its Events connections) alive.
func uninstall() -> void:
	if life != null and is_instance_valid(life):
		life.unbind()
		var parent := life.get_parent()
		if parent != null:
			parent.remove_child(life)
		life.queue_free()
	life = null
	world = null

func is_installed() -> bool:
	return life != null and is_instance_valid(life)

# --- Events -----------------------------------------------------------------------------------

func _on_world_loaded(w: Node) -> void:
	install(w)

func _on_world_unloading(w: Node) -> void:
	_retired_world = w if w != null else world
	uninstall()

func _on_player_spawned(_p: Node) -> void:
	# Re-home everything around wherever the player actually appeared.
	if is_installed():
		life.bind(world)
	elif Game != null and Game.world != null:
		install(Game.world)

func _on_planet_changed(planet: String) -> void:
	if not is_installed():
		return
	life.planet_id = planet
	life.bind(world)

func _on_weather_changed(_kind: String) -> void:
	if is_installed():
		life.tick()

func _on_time_changed(ticks: float) -> void:
	# Fired every frame by World: this must stay a single assignment.
	if life != null:
		life.day_fraction = fposmod(ticks, 24000.0) / 24000.0

# --- frame ------------------------------------------------------------------------------------

func _process(delta: float) -> void:
	if hide_hud and Game != null and Game.ui != null and Game.ui is CanvasLayer:
		(Game.ui as CanvasLayer).visible = false
	if not install_enabled:
		return
	if not is_installed():
		# The world can exist before `world_loaded` fires (it waits for the spawn ring), and the
		# ambient layer is happy to start early: it simply finds nothing to spawn on yet.
		if Game != null and Game.world != null and is_instance_valid(Game.world) \
				and Game.world != _retired_world:
			install(Game.world)
		return
	if forced_time >= 0.0 or forced_weather != "":
		_apply_overrides()
	if demo:
		_elapsed += delta
		if not _demo_shot_fired and _demo_shot_at > 0.5 and _elapsed >= _demo_shot_at - 0.45:
			_demo_shot_fired = true
			_demo_timer = 0.0
			_fire_demo()
			return
		_demo_timer += delta
		if _demo_timer >= DEMO_PERIOD:
			_demo_timer = 0.0
			_fire_demo()

func _apply_overrides() -> void:
	if world == null or not is_instance_valid(world):
		return
	if forced_time >= 0.0 and "time_ticks" in world:
		world.set("time_ticks", forced_time)
	if forced_weather != "" and "weather" in world:
		if String(world.get("weather")) != forced_weather:
			world.set("weather", forced_weather)

# --- debug demo -------------------------------------------------------------------------------

## Cycle through the reactive effects near the player so a screenshot can show them. The splash
## goes through the real `Events.splash` path; the others are called on the reactive layer
## directly, because faking `Events.block_changed` would lie to the quest and lighting code.
func _fire_demo() -> void:
	if not is_installed() or life.reactive == null:
		return
	_demo_step += 1
	var fwd := _ahead()
	var side := fwd.cross(Vector3.UP)
	var block := life.surface_block_under()
	var col := AmbientAssets.tinted_block_color(block, life.biome_def)
	# Off to the sides, not straight ahead: a third-person camera sits behind the player, so
	# "in front of the player" is exactly the one place the player's own body hides.
	life.reactive.debris(_demo_spot(side * 3.2 + fwd * 1.2, 0.6), col, 1.3)
	life.reactive.wisp(_demo_spot(side * -2.8 + fwd * 0.6, 0.9), Color(0.75, 0.35, 1.0))
	var spot := find_water(life.center)
	var on_water := spot.y > -9000.0
	if not on_water:
		spot = _demo_spot(side * 1.9 + fwd * 0.4, 0.08)
	Events.splash.emit(spot, 2.0)
	Log.i("ambient demo #%d: splash at %s (%s), debris %s" % [
		_demo_step, str(spot), "water" if on_water else "dry ground", str(life.center)])

## A point `offset` from the player, lifted to sit `up` above whatever surface is in that column
## (the demo must not fire into a hillside or into thin air).
func _demo_spot(offset: Vector3, up: float) -> Vector3:
	var p := life.center + offset
	if world != null and is_instance_valid(world) and world.has_method("get_height"):
		var top := int(world.call("get_height", int(floor(p.x)), int(floor(p.z))))
		if top > 1 and absf(float(top) - life.center.y) <= 6.0:
			p.y = float(top)
	return p + Vector3(0, up, 0)

## Horizontal forward of the active camera, so a demo effect lands in frame and not behind it.
func _ahead() -> Vector3:
	var cam: Camera3D = get_viewport().get_camera_3d() if is_inside_tree() else null
	if cam == null:
		return Vector3.FORWARD
	var f := -cam.global_transform.basis.z
	f.y = 0.0
	return f.normalized() if f.length() > 0.01 else Vector3.FORWARD

## Nearest water surface within DEMO_WATER_SEARCH blocks of `from`; y < -9000 when there is none.
func find_water(from: Vector3) -> Vector3:
	if world == null or not is_instance_valid(world) or not world.has_method("get_height"):
		return Vector3(0, -9999, 0)
	var cx := int(floor(from.x))
	var cz := int(floor(from.z))
	for r in range(1, DEMO_WATER_SEARCH):
		for i in range(-r, r + 1):
			for p in [Vector2i(cx + i, cz - r), Vector2i(cx + i, cz + r),
					Vector2i(cx - r, cz + i), Vector2i(cx + r, cz + i)]:
				var top := int(world.call("get_height", p.x, p.y))
				if top <= 1:
					continue
				if world.has_method("is_liquid") and bool(world.call("is_liquid", p.x, top - 1, p.y)):
					return Vector3(float(p.x) + 0.5, float(top), float(p.y) + 0.5)
	return Vector3(0, -9999, 0)
