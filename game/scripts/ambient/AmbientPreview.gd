class_name AmbientPreview
extends Node3D
## A standalone stage for looking at the ambient layer without generating a voxel world.
##
##   tools/screenshot.sh out.png --sandbox alive --scene res://scenes/ambient/AmbientPreview.tscn \
##       --args "--ambient-night --ambient-biome=forest"
##
## It builds a flat lawn, three boxy trees whose canopies match AmbientStubWorld's leaf columns,
## a camera and a sun, then runs the real AmbientLife against the stub world. Every flag the
## autoload understands works here too, plus `--ambient-biome=<id>` and `--ambient-planet=<id>`.

const GROUND_Y := 64
const TREES: Array[Vector2] = [Vector2(-7.0, 2.0), Vector2(4.0, -3.0), Vector2(11.0, 6.0)]

var stub: AmbientStubWorld = null
var life: AmbientLife = null
var camera: Camera3D = null
var sun: DirectionalLight3D = null
var env_res: Environment = null

var biome_id := "forest"
var planet_id := "earth"
var phase := "day"
var weather := "clear"
var demo := false
var shot_path := ""
var shot_at := 6.0

var _t := 0.0
var _demo_t := 0.0
var _capturing := false
var _shot_done := false

func _ready() -> void:
	_parse_args()
	_build_stage()
	stub = AmbientStubWorld.new()
	stub.setup(biome_id, planet_id, true)
	stub.canopy_centers = PackedVector2Array(TREES)
	stub.canopy_radius = 3.6
	stub.weather = weather
	stub.set_phase(phase)
	add_child(stub)
	life = AmbientLife.new()
	life.force_profile = true
	add_child(life)
	life.bind(stub)
	# Fill the fields straight away instead of waiting a second of ticks for a screenshot.
	for _i in 12:
		life.tick()
	_aim_flocks()
	_apply_light()

## A bird flock crosses at a random time on a random heading, which is right for the game and
## useless for a screenshot: aim it so it is in shot when the capture happens.
func _aim_flocks() -> void:
	if life == null:
		return
	if camera == null:
		return
	var eye := camera.global_position
	var fwd := -camera.global_transform.basis.z
	if life.flock_near != null and life.flock_near.active_count() > 0:
		# 38 m ahead and 19 m up: about 25 degrees above the horizon, inside the frame.
		life.flock_near.aim_at(eye + fwd * 38.0 + Vector3(0, 19.0, 0),
			Vector3(1.0, 0.0, 0.3), 0.46, shot_at)
	if life.flock_far != null and life.flock_far.active_count() > 0:
		life.flock_far.aim_at(eye + fwd * 120.0 + Vector3(0, 46.0, 0),
			Vector3(-1.0, 0.0, 0.4), 0.48, shot_at)

func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--"):
			continue
		var kv := a.substr(2).split("=", true, 1)
		var key := kv[0]
		var value: String = kv[1] if kv.size() > 1 else ""
		match key:
			"ambient-biome": biome_id = value
			"ambient-planet": planet_id = value
			"ambient-weather": weather = value
			"ambient-demo": demo = true
			"ambient-night": phase = "night"
			"ambient-day": phase = "day"
			"ambient-dusk": phase = "dusk"
			"screenshot": shot_path = value
			"after":
				if value.is_valid_float():
					shot_at = value.to_float()

# --- stage ------------------------------------------------------------------------------------

func _build_stage() -> void:
	var env := WorldEnvironment.new()
	env.name = "Env"
	env_res = Environment.new()
	env_res.background_mode = Environment.BG_COLOR
	env_res.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment = env_res
	add_child(env)

	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(160, 160)
	ground.mesh = plane
	ground.position = Vector3(0, float(GROUND_Y), 0)
	ground.material_override = _lit_material(Color(0.24, 0.42, 0.16))
	ground.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(ground)

	for t in TREES:
		var trunk := MeshInstance3D.new()
		var tb := BoxMesh.new()
		tb.size = Vector3(1.0, 6.0, 1.0)
		trunk.mesh = tb
		trunk.position = Vector3(t.x, float(GROUND_Y) + 3.0, t.y)
		trunk.material_override = _lit_material(Color(0.32, 0.22, 0.12))
		add_child(trunk)
		var crown := MeshInstance3D.new()
		var cb := BoxMesh.new()
		cb.size = Vector3(7.0, 2.4, 7.0)
		crown.mesh = cb
		crown.position = Vector3(t.x, float(GROUND_Y) + 6.2, t.y)
		crown.material_override = _lit_material(Color(0.16, 0.34, 0.12))
		add_child(crown)

	camera = Camera3D.new()
	camera.fov = 72.0
	camera.current = true
	add_child(camera)
	# Standing back and tilted up a little: the lawn keeps the lower half (butterflies, leaves,
	# fireflies), the canopies and the flock get the upper half.
	camera.look_at_from_position(Vector3(0.6, float(GROUND_Y) + 3.6, 17.0),
		Vector3(0.0, float(GROUND_Y) + 8.0, -6.0), Vector3.UP)

	sun = DirectionalLight3D.new()
	sun.shadow_enabled = false
	add_child(sun)

func _lit_material(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = 1.0
	m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	return m

## Sky colour, sun energy and ambient level for the requested time of day, so a night shot is
## actually dark and the additive fireflies read against it.
func _apply_light() -> void:
	var night := AmbientRules.night_amount(stub.day_fraction())
	var day_sky := Color(0.42, 0.62, 0.92)
	var dusk_sky := Color(0.5, 0.3, 0.22)
	var night_sky := Color(0.02, 0.03, 0.08)
	var twi := AmbientRules.twilight_amount(stub.day_fraction())
	var sky_col := day_sky.lerp(night_sky, night).lerp(dusk_sky, twi * 0.8)
	if env_res != null:
		env_res.background_color = sky_col
		env_res.ambient_light_color = Color(0.55, 0.68, 0.95)
		# A moonlit night, the way the SkyController lights the real world: dark, but not blind.
		env_res.ambient_light_energy = lerpf(0.55, 0.22, night)
	if sun != null:
		sun.light_energy = lerpf(1.0, 0.18, night)
		sun.light_color = Color(1.0, 0.92, 0.78).lerp(Color(0.45, 0.6, 1.0), night)
		var elev := lerpf(0.9, 0.25, twi)
		sun.look_at_from_position(Vector3(6, float(GROUND_Y) + 30.0 * elev, 10),
			Vector3(0, float(GROUND_Y), 0), Vector3.UP)
	RenderingServer.set_default_clear_color(sky_col)

func _process(delta: float) -> void:
	_t += delta
	_maybe_capture()
	if not demo or life == null or life.reactive == null:
		return
	_demo_t += delta
	if _demo_t < 1.2:
		return
	_demo_t = 0.0
	var at := Vector3(2.0, float(GROUND_Y) + 0.05, 5.0)
	stub.water = true
	Events.splash.emit(at, 2.0)
	stub.water = false
	life.reactive.debris(Vector3(-3.0, float(GROUND_Y) + 0.9, 4.0), Color(0.45, 0.62, 0.28), 1.4)
	life.reactive.wisp(Vector3(6.0, float(GROUND_Y) + 1.2, 3.0), Color(0.75, 0.35, 1.0))

# --- screenshot -------------------------------------------------------------------------------

## tools/screenshot.sh --scene runs this scene as the main scene, so Main.gd's `--screenshot`
## handling is not in the picture: the preview grabs its own frame and quits.
func _maybe_capture() -> void:
	if _capturing or _shot_done or shot_path == "" or _t < shot_at:
		return
	_capturing = true
	_capture()

func _capture() -> void:
	await RenderingServer.frame_post_draw
	var vp := get_viewport()
	if vp == null:
		_capturing = false
		return
	var img := vp.get_texture().get_image()
	var err := img.save_png(shot_path)
	var s: Dictionary = life.stats() if life != null else {}
	print("SCREENSHOT %s -> %s (t=%.2f, %s)" % [shot_path, "ok" if err == OK else str(err), _t, str(s)])
	_shot_done = true
	_capturing = false
	get_tree().quit()
