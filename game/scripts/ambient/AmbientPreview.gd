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
const TREES: Array[Vector2] = [Vector2(-5.5, -3.0), Vector2(4.5, -6.0), Vector2(8.0, 2.0)]

var stub: AmbientStubWorld = null
var life: AmbientLife = null
var camera: Camera3D = null
var sun: DirectionalLight3D = null

var biome_id := "forest"
var planet_id := "earth"
var phase := "day"
var weather := "clear"
var demo := false

var _t := 0.0
var _demo_t := 0.0

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
	_apply_light()

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

# --- stage ------------------------------------------------------------------------------------

func _build_stage() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment = e
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
	camera.position = Vector3(0.6, float(GROUND_Y) + 2.4, 13.0)
	camera.look_at(Vector3(0, float(GROUND_Y) + 3.2, -2.0), Vector3.UP)
	camera.current = true
	add_child(camera)

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
	var env := get_node_or_null("WorldEnvironment") as WorldEnvironment
	var day_sky := Color(0.42, 0.62, 0.92)
	var dusk_sky := Color(0.5, 0.3, 0.22)
	var night_sky := Color(0.02, 0.03, 0.08)
	var twi := AmbientRules.twilight_amount(stub.day_fraction())
	var sky_col := day_sky.lerp(night_sky, night).lerp(dusk_sky, twi * 0.8)
	if env != null and env.environment != null:
		env.environment.background_color = sky_col
		env.environment.ambient_light_color = Color(0.6, 0.7, 0.9)
		env.environment.ambient_light_energy = lerpf(0.55, 0.06, night)
	if sun != null:
		sun.light_energy = lerpf(1.0, 0.04, night)
		sun.light_color = Color(1.0, 0.92, 0.78).lerp(Color(0.45, 0.6, 1.0), night)
		var elev := lerpf(0.9, 0.25, twi)
		sun.look_at_from_position(Vector3(6, float(GROUND_Y) + 30.0 * elev, 10),
			Vector3(0, float(GROUND_Y), 0), Vector3.UP)
	RenderingServer.set_default_clear_color(sky_col)

func _process(delta: float) -> void:
	_t += delta
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
