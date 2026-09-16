extends Node3D
## Standalone fx stage used for visual verification (`scenes/fx/FxPreview.tscn`).
##
##   tools/screenshot.sh out.png --sandbox fx --seconds 2.4 \
##     --args "--scene=res://scenes/fx/FxPreview.tscn --fx=transform --form=ssgrades.supersaiyan"
##
## `--fx=` one of: transform, kamehameha, beam, blast, barrage, disc, explosion, aura,
##                 lightning, hit, dash, all
## `--form=` form id for the transformation (default ssgrades.supersaiyan)
## `--technique=` technique id for the beam/blast modes

const GROUND_SIZE := 90.0

var fx := "aura"
var form_id := "ssgrades.supersaiyan"
var technique_id := ""
var dummy: FxDummy
var camera: Camera3D
var label: Label
var t := 0.0

var _steps: Array[Dictionary] = []
var _next_step := 0

func _ready() -> void:
	_parse_args()
	Game.world = self
	# the fx stage runs inside Main, which also spawns the UiManager (loading screen);
	# hide it so the preview shot is just the effect
	if Game.ui != null and Game.ui is CanvasLayer:
		(Game.ui as CanvasLayer).visible = false
	ScreenFx.get_instance()
	_build_stage()
	_build_dummy()
	_script_fx()

func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--"):
			continue
		var kv := a.substr(2).split("=", true, 1)
		var key := kv[0]
		var val := kv[1] if kv.size() > 1 else ""
		match key:
			"fx": fx = val
			"form": form_id = val
			"technique": technique_id = val

# --- stage ----------------------------------------------------------------

func _build_stage() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.09, 0.12, 0.2)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.55, 0.6, 0.72)
	e.ambient_light_energy = 0.9
	e.glow_enabled = true
	e.glow_intensity = 0.45
	e.glow_bloom = 0.12
	e.glow_hdr_threshold = 1.0
	env.environment = e
	add_child(env)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52, 38, 0)
	sun.light_energy = 1.1
	sun.shadow_enabled = false
	add_child(sun)

	var ground := MeshInstance3D.new()
	ground.name = "Ground"
	var pm := PlaneMesh.new()
	pm.size = Vector2(GROUND_SIZE, GROUND_SIZE)
	ground.mesh = pm
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.33, 0.40, 0.25)
	gm.roughness = 1.0
	ground.material_override = gm
	add_child(ground)

	# a few blocks well outside the fx so scale reads without cluttering the shot
	for i in 6:
		var b := MeshInstance3D.new()
		b.mesh = FxAssets.cube_mesh(1.0)
		var bm := StandardMaterial3D.new()
		bm.albedo_color = Color(0.38, 0.35, 0.31).lightened(float(i) * 0.03)
		b.material_override = bm
		var a := float(i) / 6.0 * TAU + 0.4
		b.position = Vector3(cos(a) * 12.0, 0.5, sin(a) * 12.0)
		add_child(b)

	camera = Camera3D.new()
	camera.name = "PreviewCamera"
	camera.fov = 68.0
	var pos := Vector3(0.0, 2.3, 6.4)
	var look := Vector3(0.0, 1.25, 0.0)
	match fx:
		"explosion":
			pos = Vector3(0.0, 5.0, 15.0)
			look = Vector3(0.0, 2.0, 0.0)
		"kamehameha", "beam", "blast", "barrage", "disc":
			# the dummy aims along -Z, so watch from the side to see the whole beam
			pos = Vector3(8.5, 2.6, 3.0)
			look = Vector3(0.0, 1.4, -7.0)
	add_child(camera)
	camera.position = pos
	camera.look_at(look, Vector3.UP)
	camera.current = true

	var layer := CanvasLayer.new()
	layer.layer = 95
	add_child(layer)
	label = Label.new()
	label.position = Vector2(14, 10)
	label.modulate = Color(1, 1, 1, 0.85)
	layer.add_child(label)

func _build_dummy() -> void:
	dummy = FxDummy.create("saiyan", "warrior")
	dummy.name = "Dummy"
	dummy.world = self
	add_child(dummy)
	dummy.global_position = Vector3.ZERO
	var k := Ki.get_for(dummy)
	k.set_power_release(1.0)

# --- fx scripts -----------------------------------------------------------

func _at(time: float, fn: Callable) -> void:
	_steps.append({"t": time, "fn": fn})

func _script_fx() -> void:
	match fx:
		"transform":
			_at(0.35, func() -> void: Forms.transform(dummy, form_id))
		"aura":
			_at(0.2, func() -> void:
				Ki.get_for(dummy).set_charging(true)
				Aura.get_for(dummy).set_intensity(1.2))
		"lightning":
			_at(0.2, func() -> void:
				var a := Aura.get_for(dummy)
				a.set_form(Forms.def("ssgrades.supersaiyan2"))
				a.set_intensity(1.3)
				a.set_lightning(true, Color("#8AD8FF")))
		"kamehameha", "beam":
			var tid := technique_id if technique_id != "" else "kamehameha"
			_at(0.25, func() -> void: Techniques.begin(dummy, tid))
			_at(2.3, func() -> void: Techniques.release(dummy))
		"blast":
			var tid2 := technique_id if technique_id != "" else "charged_ki_blast"
			_at(0.25, func() -> void: Techniques.begin(dummy, tid2))
			_at(1.35, func() -> void: Techniques.release(dummy))
			_at(2.3, func() -> void: Techniques.tap(dummy, "ki_blast"))
			_at(2.8, func() -> void: Techniques.tap(dummy, "ki_blast"))
		"barrage":
			_at(0.25, func() -> void: Techniques.begin(dummy, "ki_barrage"))
			_at(0.85, func() -> void: Techniques.release(dummy))
		"disc":
			_at(0.25, func() -> void: Techniques.begin(dummy, "kienzan"))
			_at(1.5, func() -> void: Techniques.release(dummy))
		"explosion":
			_at(0.8, func() -> void:
				ExplosionFx.hint_color(Color("#FFD166"))
				Events.explosion.emit(Vector3(0, 0.6, 0), 5.0, 90.0))
			_at(2.2, func() -> void:
				ExplosionFx.hint_color(Color("#9BE7FF"))
				Events.explosion.emit(Vector3(4, 1.0, -2), 3.0, 50.0))
		"hit":
			_at(0.5, func() -> void: HitFx.on_hit(dummy, Vector3(0, 1.2, 0), 42.0, false, Damage.MELEE))
			_at(1.1, func() -> void: HitFx.on_hit(dummy, Vector3(0, 1.4, 0), 120.0, true, Damage.MELEE))
			_at(1.8, func() -> void: HitFx.block(Vector3(0, 1.2, 0.4)))
			_at(2.4, func() -> void: HitFx.parry(Vector3(0, 1.3, 0.4)))
		"dash":
			_at(0.5, func() -> void: Trails.get_for(dummy).dash(Vector3.FORWARD))
			_at(1.4, func() -> void: Trails.get_for(dummy).set_flying_fast(true))
		"all":
			_at(0.3, func() -> void: Forms.transform(dummy, form_id))
			_at(4.2, func() -> void: Techniques.begin(dummy, "kamehameha"))
			_at(6.3, func() -> void: Techniques.release(dummy))
		_:
			_at(0.2, func() -> void: Aura.get_for(dummy).set_intensity(1.0))

func _process(delta: float) -> void:
	t += delta / maxf(0.001, Engine.time_scale)
	while _next_step < _steps.size() and t >= float(_steps[_next_step]["t"]):
		var fn: Callable = _steps[_next_step]["fn"]
		_next_step += 1
		if fn.is_valid():
			fn.call()
	if label != null:
		var a := Aura.find_on(dummy)
		label.text = "fx=%s  t=%.2f s  form=%s  aura=%.2f  ki=%.0f/%.0f" % [
			fx, t, Forms.current(dummy), a.intensity() if a != null else 0.0,
			dummy.ki if dummy != null else 0.0, dummy.max_ki if dummy != null else 0.0]
