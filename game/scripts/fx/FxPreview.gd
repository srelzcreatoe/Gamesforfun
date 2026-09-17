extends Node3D
## Standalone fx stage used for visual verification (`scenes/fx/FxPreview.tscn`).
##
##   tools/screenshot.sh out.png --sandbox vfx --seconds 8 \
##     --args "--scene=res://scenes/fx/FxPreview.tscn --form=supersaiyan.supersaiyan2 --at=2.6,3.5"
##
## `--fx=` one of: transform, kamehameha, beam, blast, barrage, disc, explosion, aura,
##                 lightning, hit, dash, all   (defaults to "transform" when --form is given)
## `--form=` form id for the transformation (default ssgrades.supersaiyan)
## `--technique=` technique id for the beam/blast modes
## `--at=` one or more seconds (comma separated). The stage grabs the viewport at exactly
##         those times and then quits, so a cinematic can be frozen at its climax:
##         a single value writes `--screenshot=<path>`, several write
##         `<path-without-ext>_t<seconds>.png` next to it.
## `--nohud` hide the debug label (clean shots)
## `--cam=x,y,z --look=x,y,z` fixed camera; implies `--staticcam`
## `--staticcam` keep the preview camera where it is (a stub camera rig absorbs the
##         cinematic camera work), so a frame can be compared across runs

const GROUND_SIZE := 120.0
const ROCKS := 150

var fx := ""
var form_id := "ssgrades.supersaiyan"
var technique_id := ""
var dummy: FxDummy
var camera: Camera3D
var label: Label
var t := 0.0

var static_cam := false
var cam_pos := Vector3.INF
var cam_look := Vector3(0.0, 1.25, 0.0)
var at_times: Array[float] = []
var shot_path := ""
var show_hud := true

var _steps: Array[Dictionary] = []
var _next_step := 0
var _shots_done := 0
var _capturing := false

func _ready() -> void:
	_parse_args()
	Game.world = self
	# the fx stage runs inside Main, which also spawns the UiManager (loading screen);
	# hide it so the preview shot is just the effect
	if Game.ui != null and Game.ui is CanvasLayer:
		(Game.ui as CanvasLayer).visible = false
	Game.paused_by_ui = false
	ScreenFx.get_instance()
	_build_stage()
	_build_dummy()
	_script_fx()

func _parse_args() -> void:
	var had_form := false
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--"):
			continue
		var kv := a.substr(2).split("=", true, 1)
		var key := kv[0]
		var val := kv[1] if kv.size() > 1 else ""
		match key:
			"fx": fx = val
			"form":
				form_id = val
				had_form = true
			"technique": technique_id = val
			"screenshot": shot_path = val
			"nohud": show_hud = false
			"staticcam": static_cam = true
			"cam":
				cam_pos = _vec(val, cam_pos)
				static_cam = true
			"look":
				cam_look = _vec(val, cam_look)
				static_cam = true
			"at":
				for piece in val.split(",", false):
					var s := piece.strip_edges()
					if s.is_valid_float():
						at_times.append(float(s))
	at_times.sort()

static func _vec(text: String, fallback: Vector3) -> Vector3:
	var parts := text.split(",", false)
	if parts.size() < 3:
		return fallback
	return Vector3(float(parts[0]), float(parts[1]), float(parts[2]))
	if fx == "":
		fx = "transform" if had_form else "aura"

# --- stage ----------------------------------------------------------------

func _build_stage() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.055, 0.075, 0.13)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.50, 0.55, 0.68)
	e.ambient_light_energy = 1.0
	e.fog_enabled = true
	e.fog_light_color = Color(0.13, 0.16, 0.25)
	e.fog_density = 0.012
	# the fx are additive and already very bright: a soft, high-threshold glow keeps the
	# character readable instead of washing the whole frame out
	e.glow_enabled = true
	e.glow_intensity = 0.45
	e.glow_strength = 0.95
	e.glow_bloom = 0.03
	e.glow_hdr_threshold = 1.05
	e.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	env.environment = e
	add_child(env)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-38, 128, 0)
	sun.light_color = Color(1.0, 0.86, 0.72)
	sun.light_energy = 1.05
	sun.shadow_enabled = false
	add_child(sun)

	var ground := MeshInstance3D.new()
	ground.name = "Ground"
	var pm := PlaneMesh.new()
	pm.size = Vector2(GROUND_SIZE, GROUND_SIZE)
	ground.mesh = pm
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.24, 0.22, 0.18)
	gm.roughness = 1.0
	ground.material_override = gm
	add_child(ground)

	_build_rocks()

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
			# _build_dummy turns the caster to fire along +X, so stand off on +Z and
			# watch the whole beam cross the frame
			pos = Vector3(9.0, 3.6, 17.0)
			look = Vector3(9.0, 1.6, 0.0)
	if static_cam and cam_pos != Vector3.INF:
		pos = cam_pos
		look = cam_look
	add_child(camera)
	camera.position = pos
	camera.look_at(look, Vector3.UP)
	camera.current = true

	var layer := CanvasLayer.new()
	layer.layer = 95
	add_child(layer)
	label = Label.new()
	label.position = Vector2(14, 10)
	label.modulate = Color(1, 1, 1, 0.75)
	label.visible = show_hud
	layer.add_child(label)

## A voxel-ish rocky arena in one MultiMesh: gives the fx something to light and a
## sense of scale without adding draw calls.
func _build_rocks() -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = FxAssets.cube_mesh(1.0)
	mm.instance_count = ROCKS
	var rng := RandomNumberGenerator.new()
	rng.seed = 7731
	for i in ROCKS:
		var a := rng.randf() * TAU
		var r: float = lerpf(7.0, 46.0, sqrt(rng.randf()))
		var s := rng.randf_range(0.8, 3.4) * (1.0 + r * 0.03)
		var h := s * rng.randf_range(0.5, 1.6)
		var xf := Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, h, s)),
			Vector3(cos(a) * r, h * 0.35, sin(a) * r))
		mm.set_instance_transform(i, xf)
		var tone := rng.randf_range(0.18, 0.34)
		mm.set_instance_color(i, Color(tone * 1.1, tone, tone * 0.88))
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "Rocks"
	mmi.multimesh = mm
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.roughness = 1.0
	mmi.material_override = m
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)

## Race of the previewed form, so a Namekian form previews on a Namekian body.
func _race_for_form() -> String:
	if fx != "transform" and fx != "transform_revert" and fx != "all":
		return "saiyan"
	var d := Forms.def(form_id)
	var r := String(d.get("race", "saiyan"))
	return r if r != "" else "saiyan"

func _build_dummy() -> void:
	dummy = FxDummy.create(_race_for_form(), "warrior", true)
	dummy.name = "Dummy"
	dummy.world = self
	add_child(dummy)
	dummy.global_position = Vector3.ZERO
	if fx in ["kamehameha", "beam", "blast", "barrage", "disc"]:
		dummy.rotation.y = -PI * 0.5        # aim along +X, across the camera
	var k := Ki.get_for(dummy)
	k.set_power_release(1.0)
	if static_cam:
		# the director prefers a camera rig over the viewport camera: give it a stub
		# that swallows the orbit so the verification framing never moves
		var rig := Node3D.new()
		rig.name = "StubCameraRig"
		rig.set_script(preload("res://scripts/fx/FxStubRig.gd"))
		dummy.add_child(rig)
		dummy.camera_rig = rig
		Game.player = dummy

# --- fx scripts -----------------------------------------------------------

func _at(time: float, fn: Callable) -> void:
	_steps.append({"t": time, "fn": fn})

func _script_fx() -> void:
	match fx:
		"transform":
			_at(0.35, func() -> void: Forms.transform(dummy, form_id))
		"transform_revert":
			_at(0.35, func() -> void: Forms.transform(dummy, form_id))
			_at(0.4 + FormVfx.for_id(form_id).duration, func() -> void: Forms.revert(dummy))
		"aura":
			_at(0.2, func() -> void:
				Ki.get_for(dummy).set_charging(true)
				Aura.get_for(dummy).set_intensity(1.2))
		"lightning":
			_at(0.2, func() -> void:
				var a := Aura.get_for(dummy)
				a.set_form(Forms.def(form_id))
				a.set_intensity(1.3)
				a.set_lightning(true, FormVfx.for_id(form_id).lightning_color))
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
	# the UiManager's loading screen would otherwise keep the simulation paused
	Game.paused_by_ui = false
	t += delta / maxf(0.001, Engine.time_scale)
	while _next_step < _steps.size() and t >= float(_steps[_next_step]["t"]):
		var fn: Callable = _steps[_next_step]["fn"]
		_next_step += 1
		if fn.is_valid():
			fn.call()
	if label != null and label.visible:
		var a := Aura.find_on(dummy)
		var d := TransformationDirector.running_for(dummy)
		label.text = "fx=%s  t=%.2f s  form=%s  phase=%s  aura=%.2f" % [
			fx, t, Forms.current(dummy) if Forms.current(dummy) != "" else form_id,
			d.phase_name() if d != null else "-",
			a.intensity() if a != null else 0.0]
	_maybe_capture()

# --- frozen captures ------------------------------------------------------

## Grab the viewport at each `--at` second and quit. The director runs on real time, so
## this is the only reliable way to land a screenshot exactly on the climax frame -
## Main's own `--after` timer is scaled by the cinematic's slow motion.
func _maybe_capture() -> void:
	if _capturing or shot_path == "" or _shots_done >= at_times.size():
		return
	if t < at_times[_shots_done]:
		return
	_capturing = true
	_capture(at_times[_shots_done])

func _capture(at: float) -> void:
	await RenderingServer.frame_post_draw
	var vp := get_viewport()
	if vp == null:
		_capturing = false
		return
	var img := vp.get_texture().get_image()
	var path := shot_path
	if at_times.size() > 1:
		path = "%s/%s_t%.2f.%s" % [shot_path.get_base_dir(), shot_path.get_basename().get_file(),
			at, shot_path.get_extension()]
	var err := img.save_png(path)
	print("SCREENSHOT %s -> %s (t=%.2f, phase=%s)" % [
		path, "ok" if err == OK else str(err), t,
		TransformationDirector.running_for(dummy).phase_name() if TransformationDirector.running_for(dummy) != null else "-"])
	_shots_done += 1
	_capturing = false
	if _shots_done >= at_times.size():
		get_tree().quit()
