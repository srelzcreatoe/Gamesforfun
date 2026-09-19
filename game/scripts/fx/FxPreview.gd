class_name FxPreview
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
## `--at=` one or more seconds (comma separated). The stage grabs the viewport on the LAST
##         FRAME AT OR BEFORE each of those times and then quits, so a cinematic can be
##         frozen at its climax without ever overshooting into the next phase (`_due`);
##         the SCREENSHOT line prints the frame's real t next to the target.
##         A single value writes `--screenshot=<path>`, several write
##         `<path-without-ext>_t<seconds>.png` next to it.
## `--nohud` hide the debug label (clean shots)
## `--cam=x,y,z --look=x,y,z` fixed camera; implies `--staticcam`
## `--staticcam` keep the preview camera where it is (a stub camera rig absorbs the
##         cinematic camera work), so a frame can be compared across runs
## `--hide=A,B` hide every node whose name starts with one of these (layer isolation
##         when hunting down which quad washed the frame out, e.g. --hide=Ring,CrackGlow)
## `--dumpfx` print every visible emitter / quad with the material state that decides its
##         colour, at each capture (which node drew that black pixel?)
## `--profile` print, per cinematic phase, the frame time, the fx scripts' cpu time
##         (FxAssets.cpu_usec, which EXCLUDES the OTHER subsystems work the cinematic
##         triggers in the same frame - the form application at the climax and Audio s
##         synchronous stream loads; those are the `extern_*` columns, so the two add up;
##         the engine's Performance.TIME_PROCESS monitor reads 0 headless), how much of
##         that was the afterimage silhouette, the draw calls and the on-screen particle
##         / light peak. This is how the cinematic's cost is measured; under llvmpipe the
##         frame time is software rasterisation, so the own_/fx_cpu columns are the
##         numbers that transfer to a phone.
## `--noglow --nofog` drop those environment features, to tell a post effect apart from
##         a material problem
## `--fx=dustdiag` the regression stage for the black-quad bug (see `_build_dust_diag`)

const GROUND_SIZE := 120.0
const ROCKS := 150
## Rock wall the beams and blasts slam into (x >= WALL_X), so an impact can be verified.
const WALL_X := 16.0
const WALL_ID := 1

var fx := ""
var form_id := "ssgrades.supersaiyan"
var technique_id := ""
var dummy: FxDummy
var camera: Camera3D
var label: Label
var t := 0.0
## Last frame's real-time step. `--at` lands on the last frame AT OR BEFORE the requested
## time: capturing on the first frame past it overshot by a whole frame, and at 66 ms a
## frame that is enough to miss the burst window entirely and label a reveal shot "t=4.95".
var _last_real := 0.0

var static_cam := false
var hide_names: PackedStringArray = PackedStringArray()
var cam_pos := Vector3.INF
var cam_look := Vector3(0.0, 1.25, 0.0)
var at_times: Array[float] = []
var shot_path := ""
var show_hud := true
var dump_fx := false
var do_profile := false
var no_glow := false
var no_fog := false

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
			"dumpfx": dump_fx = true
			"profile": do_profile = true
			"noglow": no_glow = true
			"nofog": no_fog = true
			"staticcam": static_cam = true
			"hide":
				for h in val.split(",", false):
					hide_names.append(h.strip_edges())
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
	if fx == "":
		fx = "transform" if had_form else "aura"

## "x,y,z" -> Vector3 (`--cam` / `--look`).
static func _vec(text: String, fallback: Vector3) -> Vector3:
	var parts := text.split(",", false)
	if parts.size() < 3:
		return fallback
	return Vector3(float(parts[0]), float(parts[1]), float(parts[2]))

# --- stage ----------------------------------------------------------------

func _build_stage() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.055, 0.075, 0.13)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.50, 0.55, 0.68)
	e.ambient_light_energy = 1.0
	e.fog_enabled = not no_fog
	e.fog_light_color = Color(0.13, 0.16, 0.25)
	e.fog_density = 0.012
	# the fx are additive and already very bright: a soft, high-threshold glow keeps the
	# character readable instead of washing the whole frame out
	e.glow_enabled = not no_glow
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
	_build_wall()

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
			# watch the whole beam cross the frame from the caster to the cliff
			pos = Vector3(7.0, 4.2, 14.0)
			look = Vector3(7.0, 1.5, 0.0)
		"dustdiag":
			pos = Vector3(0.0, 0.9, 19.0)
			look = Vector3(0.0, 1.0, 0.0)
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
	# the ki modes fire along +X at the cliff: keep that corridor (and the camera line)
	# free of boulders, or the whole effect happens behind a rock
	var corridor := fx in ["kamehameha", "beam", "blast", "barrage", "disc", "dustdiag"]
	for i in ROCKS:
		var a := rng.randf() * TAU
		var r: float = lerpf(7.0, 46.0, sqrt(rng.randf()))
		var s := rng.randf_range(0.8, 3.4) * (1.0 + r * 0.03)
		var h := s * rng.randf_range(0.5, 1.6)
		var p := Vector3(cos(a) * r, h * 0.35, sin(a) * r)
		if corridor and p.x > -12.0 and p.x < 28.0 and absf(p.z) < 15.0:
			p.y -= 40.0                      # sunk out of sight, keeps the instance count
		var xf := Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, h, s)), p)
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

## A cliff face at +X: `raycast()` reports it as terrain, so ki blasts and beams
## detonate against something instead of flying into the void.
func _build_wall() -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = FxAssets.cube_mesh(1.0)
	var cols := 9
	var rows := 7
	mm.instance_count = cols * rows
	var rng := RandomNumberGenerator.new()
	rng.seed = 4242
	var i := 0
	for r in rows:
		for c in cols:
			var s := rng.randf_range(1.6, 2.4)
			# the face of the wall must stay BEHIND WALL_X, or the impact fx spawn
			# inside the boulders and are occluded
			var pos := Vector3(WALL_X + 2.0 + rng.randf_range(-0.1, 0.3),
				float(r) * 1.8 + 0.6, (float(c) - float(cols) * 0.5) * 1.9)
			var xf := Transform3D(Basis(Vector3.UP, rng.randf() * 0.4).scaled(Vector3(s * 1.2, s, s * 1.4)), pos)
			mm.set_instance_transform(i, xf)
			var tone := rng.randf_range(0.20, 0.36)
			mm.set_instance_color(i, Color(tone * 1.05, tone, tone * 0.9))
			i += 1
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "Wall"
	mmi.multimesh = mm
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.roughness = 1.0
	mmi.material_override = m
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)

# --- minimal World stand-in (only what the ki fx duck-type) ---------------

## Solid below the stage plane and inside the cliff face; air everywhere else.
func get_block(x: int, y: int, z: int) -> int:
	if y < 0:
		return WALL_ID
	return WALL_ID if float(x) >= WALL_X else 0

## Analytic raycast against the stage plane and the cliff face (same dictionary shape
## as `World.raycast`, which is what `Projectile`/`Beam` read).
func raycast(origin: Vector3, dir: Vector3, max_dist: float, _ignore_liquid := true) -> Dictionary:
	var miss := {"hit": false, "block": Vector3i.ZERO, "normal": Vector3i.ZERO,
		"point": origin, "dist": 0.0, "id": 0}
	if dir.length_squared() < 0.000001:
		return miss
	var d := dir.normalized()
	var best := INF
	var point := origin
	var normal := Vector3i.ZERO
	if d.y < -0.0001 and origin.y > 0.0:
		var t := origin.y / -d.y
		if t <= max_dist and t < best:
			best = t
			point = origin + d * t
			normal = Vector3i(0, 1, 0)
	if d.x > 0.0001 and origin.x < WALL_X:
		var t2 := (WALL_X - origin.x) / d.x
		if t2 <= max_dist and t2 < best:
			best = t2
			point = origin + d * t2
			normal = Vector3i(-1, 0, 0)
	if best == INF:
		return miss
	return {"hit": true, "block": Vector3i(point.round()), "normal": normal,
		"point": point, "dist": best, "id": WALL_ID}

## The fx explosion path (`World.explode` normally also destroys blocks).
func explode(center: Vector3, radius: float, damage := 0.0, _source: Node = null) -> void:
	Events.explosion.emit(center, radius, damage)

func get_entities() -> Array:
	return [dummy] if dummy != null and is_instance_valid(dummy) else []

func entities_in_aabb(_box: AABB) -> Array:
	return []

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
		"dustdiag":
			# the cinematic runs too: the artefact needs a busy frame with the director
			# churning its own children, which is where it was bisected
			_at(0.35, func() -> void: Forms.transform(dummy, form_id))
			_at(0.40, _build_dust_diag)
		_:
			_at(0.2, func() -> void: Aura.get_for(dummy).set_intensity(1.0))

## `--fx=dustdiag`: the regression stage for the BLACK QUAD bug.
##
## A MIX-blended CPUParticles3D with `local_coords = false` keeps its particles in world
## space by re-deriving its emission transform from its own global transform every frame.
## Parent it under a node whose global transform is RE-ASSIGNED every frame - which is
## what the transformation cinematic did, `global_position = entity.global_position` on a
## `top_level` director - and some instance slots reach the renderer zeroed. The material
## is `BILLBOARD_PARTICLES`, so the vertex stage throws the instance basis away and
## rebuilds it from the view matrix: a zeroed slot still covers pixels, with instance
## colour (0,0,0). A pure black quad. Additive emitters hide it (black adds nothing),
## which is why only the dust showed it.
##
## The three columns are left to right: the bug, `FxAssets.mix_dust` (the fix), and a
## control on a still parent. Only column 0 may contain pure black pixels.
##
##   tools/screenshot.sh out.png --sandbox vfx --seconds 8 \
##     --args "--scene=res://scenes/fx/FxPreview.tscn --fx=dustdiag --at=1.0 --nohud"
var _diag_rig: Node3D = null

func _build_dust_diag() -> void:
	print("DUSTDIAG columns left->right: 0 BUG moving-parent+world-coords / 1 FIXED mix_dust / 2 control still-parent")
	_diag_rig = Node3D.new()
	_diag_rig.name = "DiagRig"
	_diag_rig.top_level = true
	dummy.add_child(_diag_rig)
	for i in 3:
		var p := FxAssets.make_particles("Diag%d" % i, 20, FxAssets.smoke(), Color(0.70, 0.67, 0.62))
		p.lifetime = 1.1
		p.emission_shape = CPUParticles3D.EMISSION_SHAPE_RING
		p.emission_ring_axis = Vector3.UP
		p.emission_ring_radius = 2.7
		p.emission_ring_inner_radius = 2.1
		p.emission_ring_height = 0.1
		p.direction = Vector3(0, 0.4, 0)
		p.spread = 60.0
		p.initial_velocity_min = 1.4
		p.initial_velocity_max = 3.6
		p.gravity = Vector3(0, -1.0, 0)
		p.scale_amount_min = 0.45
		p.scale_amount_max = 1.05
		if i == 1:
			FxAssets.mix_dust(p)
		else:
			(p.material_override as StandardMaterial3D).blend_mode = BaseMaterial3D.BLEND_MODE_MIX
		var host: Node = _diag_rig if i < 2 else self
		host.add_child(p)
		p.position = Vector3(-8.0 + float(i) * 8.0, 0.18, 0.0)
		p.emitting = true

func _process(delta: float) -> void:
	# the UiManager's loading screen would otherwise keep the simulation paused
	Game.paused_by_ui = false
	if _diag_rig != null and is_instance_valid(_diag_rig):
		_diag_rig.global_position = dummy.global_position       # see _build_dust_diag
	var real := FxAssets.real_delta(delta)
	t += real
	while _next_step < _steps.size() and t >= float(_steps[_next_step]["t"]):
		var fn: Callable = _steps[_next_step]["fn"]
		_next_step += 1
		if fn.is_valid():
			fn.call()
	if not hide_names.is_empty():
		_hide_matching(self)
	if do_profile:
		_sample_profile(delta)
	if label != null and label.visible:
		var a := Aura.find_on(dummy)
		var d := TransformationDirector.running_for(dummy)
		label.text = "fx=%s  t=%.2f s  form=%s  phase=%s  aura=%.2f" % [
			fx, t, Forms.current(dummy) if Forms.current(dummy) != "" else form_id,
			d.phase_name() if d != null else "-",
			a.intensity() if a != null else 0.0]
	_maybe_capture()
	_last_real = real

## `--dumpfx`: print every visible particle emitter / quad with the material state that
## decides its colour, so a black frame can be traced to the node that drew it.
func _dump_fx(n: Node, path: String) -> void:
	var here := path + "/" + String(n.name)
	if n is CPUParticles3D:
		var p := n as CPUParticles3D
		var desc := "PARTICLES %s vis=%s emit=%s amount=%d color=%s" % [
			here, str(p.is_visible_in_tree()), str(p.emitting), p.amount, str(p.color)]
		if p.color_ramp != null:
			var ramp := ""
			for i in p.color_ramp.get_point_count():
				ramp += "%.2f:%s " % [p.color_ramp.get_offset(i), str(p.color_ramp.get_color(i))]
			desc += " ramp=[" + ramp + "]"
		else:
			desc += " ramp=null"
		if p.color_initial_ramp != null:
			var r2 := ""
			for i in p.color_initial_ramp.get_point_count():
				r2 += "%.2f:%s " % [p.color_initial_ramp.get_offset(i), str(p.color_initial_ramp.get_color(i))]
			desc += " initial_ramp=[" + r2 + "]"
		desc += " aabb=%s" % str(p.get_aabb())
		desc += _mat_desc(p.material_override)
		print(desc)
	elif n is MeshInstance3D:
		var mi := n as MeshInstance3D
		if mi.is_visible_in_tree():
			print("MESH %s pos=%s scale=%s%s" % [here, str(mi.global_position.snapped(Vector3.ONE * 0.01)),
				str(mi.scale.snapped(Vector3.ONE * 0.01)), _mat_desc(mi.material_override)])
	for c in n.get_children():
		_dump_fx(c, here)

static func _mat_desc(m: Material) -> String:
	if m is StandardMaterial3D:
		var sm := m as StandardMaterial3D
		var tex := sm.albedo_texture.resource_path if sm.albedo_texture != null else "<none>"
		return " | STD blend=%d shading=%d albedo=%s vcol=%s tex=%s filter=%d" % [
			sm.blend_mode, sm.shading_mode, str(sm.albedo_color),
			str(sm.vertex_color_use_as_albedo), tex, sm.texture_filter]
	if m is ShaderMaterial:
		var shm := m as ShaderMaterial
		return " | SHADER %s" % (shm.shader.resource_path if shm.shader != null else "<none>")
	return " | mat=<none>"

# --- profiling -------------------------------------------------------------
## `--profile`: frame cost and the on-screen budget of the cinematic, per phase. The
## brief's mobile budget is about what is alive in the frame, so the particle and light
## numbers come from `TransformationDirector.particle_budget()/light_count()`, which
## count the director, the persistent aura and the afterimage ghosts together.
var _prof: Dictionary = {}

func _sample_profile(delta: float) -> void:
	var d := TransformationDirector.running_for(dummy)
	var key := d.phase_name() if d != null else ("idle" if _next_step >= _steps.size() else "pre")
	var row: Dictionary = _prof.get(key, {
		"frames": 0, "sum": 0.0, "max": 0.0, "cpu": 0.0, "cpu_max": 0.0,
		"particles": 0, "lights": 0, "draws": 0, "objects": 0,
		"ghost": 0.0, "extern": 0.0, "extern_sum": 0.0})
	var ms := delta / maxf(0.001, Engine.time_scale) * 1000.0
	# TIME_PROCESS is the main thread's _process cost (our scripts). Under llvmpipe the
	# whole frame is dominated by software rasterisation, which a phone's GPU does not
	# pay, so this is the number that actually transfers off this box.
	# Our own accounting, not Performance.TIME_PROCESS: that monitor reads 0 headless and
	# mixes every script in the scene. FxAssets.cpu_take() is the microseconds the
	# cinematic and the aura spent in their own _process since the last frame.
	var cpu := float(FxAssets.cpu_take()) / 1000.0
	var ghost := float(FxAssets.cpu_ghost_take()) / 1000.0
	# of the fx total: work by OTHER subsystems inside the cinematic's frame (the form
	# application at the climax, Audio's synchronous stream loads). See FxAssets.cpu_extern_usec.
	var extern := float(FxAssets.cpu_extern_take()) / 1000.0
	row["frames"] = int(row["frames"]) + 1
	row["sum"] = float(row["sum"]) + ms
	row["max"] = maxf(float(row["max"]), ms)
	row["cpu"] = float(row["cpu"]) + cpu
	row["cpu_max"] = maxf(float(row["cpu_max"]), cpu)
	row["draws"] = maxi(int(row["draws"]),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)))
	row["ghost"] = maxf(float(row.get("ghost", 0.0)), ghost)
	row["extern"] = maxf(float(row.get("extern", 0.0)), extern)
	row["extern_sum"] = float(row.get("extern_sum", 0.0)) + extern
	row["objects"] = maxi(int(row["objects"]),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)))
	if d != null:
		row["particles"] = maxi(int(row["particles"]), d.particle_budget())
		row["lights"] = maxi(int(row["lights"]), d.light_count())
	_prof[key] = row

func _print_profile() -> void:
	if not do_profile:
		return
	for key in ["pre", "gather", "strain", "burst", "reveal", "done", "idle"]:
		if not _prof.has(key):
			continue
		var row: Dictionary = _prof[key]
		var n: int = maxi(1, int(row["frames"]))
		# fx_cpu is the cinematic's OWN cost (the director already subtracts extern from
		# it), extern_* is the other subsystems' work it triggers in the same frame
		print(("VFX PROFILE phase=%-7s frames=%3d frame_avg=%6.2fms frame_max=%6.2fms "
			+ "fx_cpu_avg=%5.3fms fx_cpu_max=%5.3fms ghost_max=%5.3fms "
			+ "extern_avg=%5.3fms extern_max=%5.3fms draws=%4d objects=%4d particles=%3d lights=%d") % [
			key, n, float(row["sum"]) / float(n), float(row["max"]),
			float(row["cpu"]) / float(n), float(row["cpu_max"]),
			float(row.get("ghost", 0.0)),
			float(row.get("extern_sum", 0.0)) / float(n), float(row.get("extern", 0.0)),
			int(row["draws"]), int(row["objects"]), int(row["particles"]), int(row["lights"])])
	print("VFX PROFILE budget particles<=%d lights<=%d" % [
		TransformationDirector.MAX_PARTICLES, TransformationDirector.MAX_LIGHTS])

## Layer isolation for the diagnostics: hide anything whose name starts with one of
## `--hide=`. Walks the stage every frame, which is fine for a verification tool.
func _hide_matching(n: Node) -> void:
	for c in n.get_children():
		if c is CanvasItem or c is Node3D:
			for h in hide_names:
				if h != "" and String(c.name).begins_with(h):
					# stop its _process too: Aura re-shows its own shells every frame
					c.set_process(false)
					if c is Node3D:
						(c as Node3D).visible = false
					else:
						(c as CanvasItem).visible = false
		_hide_matching(c)

# --- frozen captures ------------------------------------------------------

## Grab the viewport at each `--at` second and quit. The director runs on real time, so
## this is the only reliable way to land a screenshot exactly on the climax frame -
## Main's own `--after` timer is scaled by the cinematic's slow motion.
func _maybe_capture() -> void:
	if _capturing or shot_path == "" or _shots_done >= at_times.size():
		return
	if not _due(t, _last_real, at_times[_shots_done]):
		return
	_capturing = true
	_capture(at_times[_shots_done])

## True on the last frame at or before `target`: either we are already there, or the
## next frame (same length as the last one) would step past it. Never overshoots, so a
## shot named t=4.95 is never a frame of the phase AFTER the one at 4.95.
static func _due(now: float, last_step: float, target: float) -> bool:
	return now >= target or (last_step > 0.0 and now + last_step > target)

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
	if dump_fx:
		_dump_fx(self, "")
	var err := img.save_png(path)
	print("SCREENSHOT %s -> %s (t=%.2f, target=%.2f, phase=%s)" % [
		path, "ok" if err == OK else str(err), t, at,
		TransformationDirector.running_for(dummy).phase_name() if TransformationDirector.running_for(dummy) != null else "-"])
	_shots_done += 1
	_capturing = false
	if _shots_done >= at_times.size():
		_print_profile()
		get_tree().quit()
