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
const DEMO_PERIOD := 1.6
const DEMO_WATER_SEARCH := 14

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

# --- install / teardown -----------------------------------------------------------------------

## Create the AmbientLife node under `w` (idempotent) and bind it. Returns the node, or null.
func install(w: Node) -> AmbientLife:
	if not install_enabled or w == null or not is_instance_valid(w):
		return null
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

func uninstall() -> void:
	if life != null and is_instance_valid(life):
		life.unbind()
	life = null
	world = null

func is_installed() -> bool:
	return life != null and is_instance_valid(life)

# --- Events -----------------------------------------------------------------------------------

func _on_world_loaded(w: Node) -> void:
	install(w)

func _on_world_unloading(_w: Node) -> void:
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
		if Game != null and Game.world != null and is_instance_valid(Game.world):
			install(Game.world)
		return
	if forced_time >= 0.0 or forced_weather != "":
		_apply_overrides()
	if demo:
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
	var at := life.center
	_demo_step += 1
	match _demo_step % 3:
		0:
			life.reactive.debris(at + _offset(2.0) + Vector3(0, 0.8, 0),
				AmbientAssets.block_color(life.surface_block_under()), 1.4)
		1:
			var spot := find_water(at)
			if spot.y < -9000.0:
				spot = at + _offset(1.6) + Vector3(0, 0.1, 0)
			Events.splash.emit(spot, 2.0)
		_:
			life.reactive.wisp(at + _offset(2.5) + Vector3(0, 1.0, 0), Color(0.75, 0.35, 1.0))

func _offset(r: float) -> Vector3:
	var a := _rng.randf() * TAU
	return Vector3(cos(a) * r, 0.0, sin(a) * r)

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
