class_name TransformationDirector
extends Node3D
## THE transformation cinematic. One instance runs one transformation and frees itself;
## `Forms.begin_transform` creates it and gets a callback when the multipliers land (at
## the climax, not at the end).
##
##   TransformationDirector.play_for(entity, "supersaiyan.supersaiyan2", on_climax)
##   TransformationDirector.revert_flash(entity, form_id)      # powering down
##
## FOUR PHASES. Their lengths are fractions of a per-form duration that `FormVfx` derives
## from the form's group/order/scale (2.6 s for a kaioken-style boost, 4.7 s for a major
## form, 5.8 s for an epic one), so a quick power-up never drags and an SSJ3 gets room.
##
##   A GATHER   0 % - 26 %   energy motes converge into the body, ground dust ring, low
##                           angle camera push-in, slight slow motion, BGM stinger +
##                           the DMZ charge sound, the form's transformation animation
##   B STRAIN  26 % - 74 %   the aura snaps in and out with the hair/eye colour flicker,
##                           lightning ribbons (lightning-tier forms) that reach further
##                           out as the strain builds, debris levitates, the ground cracks
##                           GROW, grass is pushed away through World.add_disturbance, the
##                           camera orbits with a handheld micro-shake, the vignette closes
##                           in and the sky dims, afterimage silhouettes, two shockwave
##                           rings - and ONE OmniLight3D at the body, so the character is
##                           lit by his own aura instead of going black inside it
##   C BURST      74 %       white flash, hit-stop, big shockwave ring + vertical energy
##                           pillar + radial dust + rock shatter, FOV kick, radial blur
##                           and chromatic aberration for ~0.3 s, one bright OmniLight3D,
##                           and this is where on_climax() applies the form multipliers
##   D REVEAL  82 % - 100 %  camera pulls back and settles, the persistent layered aura
##                           takes over (core sheet + flame + sparks + lightning + ground
##                           glow), the screen effects release, BGM returns
##
## MOBILE BUDGET: <= 700 CPU particles alive at the climax (`particle_budget()` reports
## the real number), at most two OmniLight3D (the strain light is released when the climax
## light is created) and no GPUParticles3D. Everything it adds is freed with the director,
## so an idle game pays nothing. Giant forms (Oozaru) scale the aura, the ground decal,
## the debris ring and the shockwaves by `FormVfx.scale`.

const SHOCKWAVE_SHADER := "res://shaders/shockwave.gdshader"
const BEAM_SHADER := "res://shaders/ki_beam.gdshader"

## Phase boundaries as a fraction of the (per-form) duration.
const F_STRAIN := 0.26
const F_CLIMAX := 0.74
const F_SETTLE := 0.82

enum Phase { GATHER = 0, STRAIN = 1, BURST = 2, REVEAL = 3, DONE = 4 }
const PHASE_NAMES: Array[String] = ["gather", "strain", "burst", "reveal", "done"]

const MAX_PARTICLES := 700
const MAX_LIGHTS := 2

const FLICKER_PERIOD := 0.13
const AFTERIMAGE_PERIOD := 0.3
const DISTURB_PERIOD := 0.35
const ROCK_RADIUS := 2.2

static var _running: Dictionary = {}          # entity id -> director

var entity: Node = null
var form_id := ""
var form_def: Dictionary = {}
var profile: FormVfx = null
var duration := 4.7
var on_climax: Callable = Callable()

var t := 0.0
var phase: int = Phase.GATHER

var _t_strain := 1.2
var _t_climax := 3.4
var _t_settle := 3.8
var _ring_times: PackedFloat32Array = PackedFloat32Array()
var _rings_done := 0
var _flicker_t := 0.0
var _flicker_on := false
var _ghost_t := 0.0
var _disturb_t := 0.0
var _spark_t := 0.0
var _climax_done := false
var _settled := false

var _aura: Aura
var _rocks: Array[MeshInstance3D] = []
var _rock_angles: PackedFloat32Array = PackedFloat32Array()
var _motes: CPUParticles3D
var _dust: CPUParticles3D
var _rise: CPUParticles3D
var _decal: MeshInstance3D
var _crack_glow: MeshInstance3D
var _light: OmniLight3D
var _aura_light: OmniLight3D
var _body_flash: MeshInstance3D
var _pillar: MeshInstance3D
var _pillar_mat: ShaderMaterial
var _pillar_age := -1.0
## Ground/debris/ring scale: a giant form tears up a much bigger patch of ground.
var _gs := 1.0
var _rng := RandomNumberGenerator.new()
var _loop_key := ""
var _hair_mat: StandardMaterial3D = null
var _hair_base := Color.WHITE
var _hair_base_set := false

# camera state we borrow and must give back
var _cam: Camera3D
var _cam_xform := Transform3D.IDENTITY
var _cam_fov := 75.0
var _cam_owned := false
var _cam_rig: Node = null
var _fov_kick := 0.0
var _prev_bgm := ""
var _base_scale := Vector3.ONE
var _scaled_node: Node3D

# --- entry point ----------------------------------------------------------

## Play the cinematic for an entity (player or boss). `climax_cb` is called when the
## form should actually take effect. Returns the director, or null if one is running.
static func play_for(entity_node: Node, id: String, climax_cb := Callable()) -> TransformationDirector:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var key := entity_node.get_instance_id()
	if _running.has(key) and is_instance_valid(_running[key]):
		return null
	var d := TransformationDirector.new()
	d.name = "TransformationDirector"
	d.entity = entity_node
	d.form_id = id
	d.form_def = Forms.def(id)
	d.profile = FormVfx.of(d.form_def)
	d.duration = d.profile.duration
	d.on_climax = climax_cb
	var parent: Node = entity_node if entity_node.is_inside_tree() else _fallback_parent()
	if parent == null:
		return null
	parent.add_child(d)
	_running[key] = d
	return d

static func is_playing(entity_node: Node) -> bool:
	if entity_node == null:
		return false
	var key := entity_node.get_instance_id()
	return _running.has(key) and is_instance_valid(_running[key])

static func running_for(entity_node: Node) -> TransformationDirector:
	if entity_node == null:
		return null
	var key := entity_node.get_instance_id()
	if _running.has(key) and is_instance_valid(_running[key]):
		return _running[key]
	return null

static func _fallback_parent() -> Node:
	if Game != null and Game.world != null and Game.world.is_inside_tree():
		return Game.world
	var loop := Engine.get_main_loop()
	if loop is SceneTree:
		return (loop as SceneTree).current_scene
	return null

## Quick flare when a form is dropped: inward collapse, one ring, `transform_off`.
static func revert_flash(entity_node: Node, id := "") -> void:
	if entity_node == null or not is_instance_valid(entity_node) or not (entity_node is Node3D):
		return
	var parent: Node = entity_node if entity_node.is_inside_tree() else _fallback_parent()
	if parent == null or not parent.is_inside_tree():
		return
	var p := FormVfx.for_id(id) if id != "" else FormVfx.new()
	var pos: Vector3 = (entity_node as Node3D).global_position
	var c := p.aura
	FxAssets.burst(parent, pos + Vector3.UP * 0.9, "RevertBurst", 18,
		["ki_spark_1", "aaa/missile_boost/Star", "ki_flash1"], c, 5.0, 0.4, 0.4, 2.0)
	var mi := _ring_mesh(c, 2.6)
	parent.add_child(mi)
	mi.global_position = pos + Vector3.UP * 0.1
	var mat: ShaderMaterial = mi.material_override
	var tw := mi.create_tween()
	tw.tween_method(func(v: float) -> void:
		if is_instance_valid(mat):
			mat.set_shader_parameter("progress", v), 0.0, 1.0, 0.5)
	tw.tween_callback(mi.queue_free)
	ScreenFx.flash(c.lerp(Color(1, 1, 1), 0.6), 0.18, 0.35)
	ScreenFx.clear_sustained(0.25)
	Audio.play_sfx_at("transform_off", pos)

# --- setup ----------------------------------------------------------------

func _ready() -> void:
	_rng.randomize()
	ScreenFx.get_instance()
	if profile == null:
		profile = FormVfx.of(form_def)
		duration = profile.duration
	top_level = true
	_loop_key = "transform_" + str(get_instance_id())
	if entity is Node3D:
		global_position = (entity as Node3D).global_position
	_gs = clampf(profile.scale, 1.0, 3.8)
	_t_strain = duration * F_STRAIN
	_t_climax = duration * F_CLIMAX
	_t_settle = duration * F_SETTLE
	_ring_times = PackedFloat32Array([
		_t_strain + (_t_climax - _t_strain) * 0.28,
		_t_strain + (_t_climax - _t_strain) * 0.68,
	])
	_lock_input(true)
	Events.transformation_started.emit(entity, form_id)
	_enter_gather()

## PHASE A - gather.
func _enter_gather() -> void:
	phase = Phase.GATHER
	_prev_bgm = Audio.bgm_context()
	Audio.play_bgm("transformation", 0.35)
	Audio.play_sfx_at("aura_start", global_position, -2.0)
	Audio.play_sfx_at("ki_charge_start", global_position, -4.0)
	Audio.play_loop("ki_charge_loop", _loop_key, -7.0)
	_setup_aura()
	_setup_ground()
	_setup_motes()
	_setup_rocks()
	_setup_body_flash()
	_setup_camera()
	_setup_scale()
	_play_form_animation()
	ScreenFx.slow_mo(0.82, _t_strain)
	ScreenFx.glow(0.30, duration * 0.9, 0.5)
	_disturb(0.45)

func _setup_aura() -> void:
	_aura = Aura.get_for(entity)
	if _aura == null:
		return
	_aura.set_form(form_def)
	_aura.set_lightning(false)              # lightning is armed in the strain phase
	_aura.set_intensity(0.0)

func _setup_ground() -> void:
	# expanding dust ring at the feet
	_dust = FxAssets.make_particles("GroundDust", 20, FxAssets.smoke(), Color(0.70, 0.67, 0.62))
	_dust.material_override.blend_mode = BaseMaterial3D.BLEND_MODE_MIX
	_dust.lifetime = 1.1
	_dust.emission_shape = CPUParticles3D.EMISSION_SHAPE_RING
	_dust.emission_ring_axis = Vector3.UP
	_dust.emission_ring_radius = 2.7 * _gs
	_dust.emission_ring_inner_radius = 2.1 * _gs
	_dust.emission_ring_height = 0.1
	_dust.position = Vector3(0, 0.18, 0)     # keeps the puff quads off the ground plane
	_dust.direction = Vector3(0, 0.4, 0)
	_dust.spread = 60.0
	_dust.initial_velocity_min = 1.4
	_dust.initial_velocity_max = 3.6
	_dust.gravity = Vector3(0, -1.0, 0)
	_dust.scale_amount_min = 0.45 * _gs
	_dust.scale_amount_max = 1.05 * _gs
	add_child(_dust)
	_dust.emitting = true

	_rise = FxAssets.make_particles("RisingEnergy", 46, ["divine_particle_0", "ki_spark_0", "aura_2"], profile.aura)
	_rise.lifetime = 1.3
	_rise.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	_rise.emission_box_extents = Vector3(1.3, 0.1, 1.3)
	_rise.direction = Vector3.UP
	_rise.spread = 8.0
	_rise.initial_velocity_min = 3.5
	_rise.initial_velocity_max = 9.0
	_rise.gravity = Vector3.ZERO
	_rise.scale_amount_min = 0.2
	_rise.scale_amount_max = 0.6
	add_child(_rise)
	_rise.emitting = true

	_decal = FxAssets.make_quad("CrackedGround", _crack_texture(), 5.2 * _gs, Color(0.15, 0.12, 0.1, 0.0), true)
	var m: StandardMaterial3D = _decal.material_override
	m.blend_mode = BaseMaterial3D.BLEND_MODE_MIX
	m.albedo_color = Color(1, 1, 1, 0.0)
	_decal.position = Vector3(0, 0.04, 0)
	add_child(_decal)

	# the cracks glow in the form colour as they open up
	_crack_glow = FxAssets.make_quad("CrackGlow", _crack_texture(), 5.2 * _gs,
		Color(profile.aura.r, profile.aura.g, profile.aura.b, 0.0), true)
	_crack_glow.position = Vector3(0, 0.06, 0)
	add_child(_crack_glow)

## Energy motes streaming IN from a few metres out: the "gathering" of phase A. The
## radial acceleration is negative so they accelerate towards the body.
func _setup_motes() -> void:
	_motes = FxAssets.make_particles("Motes", 44,
		["divine_particle_1", "aaa/essentials/SPARKLE001", "ki_spark_1"], profile.inner)
	_motes.lifetime = 0.9
	_motes.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	_motes.emission_sphere_radius = 5.5
	_motes.direction = Vector3.ZERO
	_motes.spread = 180.0
	_motes.initial_velocity_min = 0.0
	_motes.initial_velocity_max = 0.4
	_motes.radial_accel_min = -16.0
	_motes.radial_accel_max = -26.0
	_motes.gravity = Vector3.ZERO
	_motes.scale_amount_min = 0.12
	_motes.scale_amount_max = 0.34
	_motes.position = Vector3(0, 1.0, 0)
	_motes.local_coords = true
	add_child(_motes)
	_motes.emitting = true

func _setup_rocks() -> void:
	var count: int = [6, 10, 14][profile.tier]
	_rock_angles.resize(count)
	for i in count:
		var mi := MeshInstance3D.new()
		mi.name = "Rock%d" % i
		var s := _rng.randf_range(0.14, 0.32)
		mi.mesh = FxAssets.cube_mesh(s)
		mi.material_override = FxAssets.debris_material(Color(0.26, 0.23, 0.20).lightened(_rng.randf() * 0.22))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var a := float(i) / float(count) * TAU + _rng.randf_range(-0.2, 0.2)
		_rock_angles[i] = a
		var r := ROCK_RADIUS * _gs * _rng.randf_range(0.7, 1.25)
		mi.position = Vector3(cos(a) * r, -0.3, sin(a) * r)
		mi.rotation = Vector3(_rng.randf() * TAU, _rng.randf() * TAU, _rng.randf() * TAU)
		add_child(mi)
		_rocks.append(mi)

func _setup_body_flash() -> void:
	# soft radial glow behind the body; the white flash itself is done on the model
	# (BedrockModel.set_emission) when the entity exposes it
	_body_flash = FxAssets.make_quad("BodyFlash", FxAssets.soft_dot(), 2.6, Color(1, 1, 1, 0.0))
	_body_flash.position = Vector3(0, 1.0, 0)
	add_child(_body_flash)

func _setup_camera() -> void:
	if Game != null and Game.player == entity and Game.player != null and "camera_rig" in Game.player:
		var rig: Variant = Game.player.get("camera_rig")
		if rig is Node and (rig as Node).has_method("cinematic_orbit"):
			_cam_rig = rig as Node
			(rig as Node).call("cinematic_orbit", global_position + Vector3.UP * 1.1, duration, 6.0, 2.8)
			return
	_cam = FxAssets.camera(self)
	if _cam == null:
		return
	_cam_owned = true
	_cam_xform = _cam.global_transform
	_cam_fov = _cam.fov

func _setup_scale() -> void:
	var target: Variant = entity.get("model") if entity != null and "model" in entity else null
	_scaled_node = target if target is Node3D else (entity as Node3D if entity is Node3D else null)
	if _scaled_node != null:
		_base_scale = _scaled_node.scale

## Play the form's own DMZ clip (`transformationAnimation`, e.g. "transf.ssj3"); fall
## back to the AnimSelect state when the entity only speaks states.
func _play_form_animation() -> void:
	if entity == null or not is_instance_valid(entity):
		return
	if entity.has_method("play_anim"):
		var ok: Variant = entity.call("play_anim", profile.anim, 0.1, false, 1.0)
		if ok is bool and bool(ok):
			return
	if entity.has_method("play_action"):
		if bool(entity.call("play_action", profile.anim_state, 0.1)):
			return
		entity.call("play_action", "transform", 0.1)

## Procedural cracked-ground texture (radial cracks + dark ring), generated once.
static var _crack_tex: Texture2D = null
static func _crack_texture() -> Texture2D:
	if _crack_tex != null:
		return _crack_tex
	var size := 128
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var rng := RandomNumberGenerator.new()
	rng.seed = 90210
	var c := Vector2(size, size) * 0.5
	for i in 22:
		var a := rng.randf() * TAU
		var len_px := rng.randf_range(size * 0.16, size * 0.46)
		var p := c
		var dir := Vector2(cos(a), sin(a))
		var steps := int(len_px)
		for s in steps:
			p += dir
			dir = (dir + Vector2(rng.randf_range(-0.28, 0.28), rng.randf_range(-0.28, 0.28))).normalized()
			var w := 1.0 - float(s) / float(maxi(1, steps))
			var alpha := clampf(w * 0.85, 0.0, 1.0)
			for ox in range(-1, 2):
				for oy in range(-1, 2):
					var x := int(p.x) + ox
					var y := int(p.y) + oy
					if x < 0 or y < 0 or x >= size or y >= size:
						continue
					var falloff := 1.0 if (ox == 0 and oy == 0) else 0.35
					var prev := img.get_pixel(x, y)
					var a2 := maxf(prev.a, alpha * falloff)
					img.set_pixel(x, y, Color(0.06, 0.05, 0.04, a2))
	_crack_tex = ImageTexture.create_from_image(img)
	return _crack_tex

# --- timeline -------------------------------------------------------------

func _process(delta: float) -> void:
	# immune to our own slow motion / hit stop
	var real := delta / maxf(0.001, Engine.time_scale)
	t += real
	if entity != null and is_instance_valid(entity) and entity is Node3D:
		global_position = (entity as Node3D).global_position

	if phase == Phase.GATHER and t >= _t_strain:
		_enter_strain()
	if not _climax_done and t >= _t_climax:
		_do_climax()
	if not _settled and t >= _t_settle:
		_enter_reveal()

	_update_aura()
	_update_ground(real)
	_update_rocks(real)
	_update_flicker(real)
	_update_scale()
	_update_rings()
	_update_pillar(real)
	_update_camera(real)

	if phase == Phase.STRAIN:
		_disturb_t -= real
		if _disturb_t <= 0.0:
			_disturb_t = DISTURB_PERIOD
			_disturb(0.55 + 0.35 * _strain_progress())
		_ghost_t -= real
		if _ghost_t <= 0.0:
			_ghost_t = AFTERIMAGE_PERIOD
			_afterimage()
		_spark_t -= real
		if _spark_t <= 0.0:
			_spark_t = _rng.randf_range(0.45, 0.9)
			Audio.play_sfx_at("ki_sparks", global_position, -10.0, _rng.randf_range(0.9, 1.25))

	if t >= duration:
		_finish()

func _strain_progress() -> float:
	return clampf((t - _t_strain) / maxf(0.01, _t_climax - _t_strain), 0.0, 1.0)

## PHASE B - strain.
func _enter_strain() -> void:
	phase = Phase.STRAIN
	if _motes != null:
		_motes.emitting = false
	Audio.play_sfx_at("transform_on", global_position, -1.0)
	ScreenFx.vignette_hold(Color(0.02, 0.02, 0.05), 0.62, _t_climax - _t_strain, 0.45)
	ScreenFx.dim(0.38, _t_climax - _t_strain, 0.45)
	ScreenFx.glow(0.45, _t_climax - _t_strain + 0.6, 0.5)
	if _aura != null and profile.lightning:
		_aura.set_lightning(true, profile.lightning_color)
	# ONE light: the body is lit by its own aura, which is what makes the strain read
	# as cinematic instead of a dark silhouette. Released again at the climax.
	_aura_light = OmniLight3D.new()
	_aura_light.name = "AuraLight"
	_aura_light.light_color = profile.glow
	_aura_light.light_energy = 0.0
	_aura_light.omni_range = 7.0 * _gs
	_aura_light.shadow_enabled = false
	_aura_light.position = Vector3(0, 1.1 * profile.scale, 0)
	add_child(_aura_light)

func _update_aura() -> void:
	if _aura == null:
		return
	match phase:
		Phase.GATHER:
			_aura.set_intensity(clampf(t / maxf(0.01, _t_strain), 0.0, 1.0) * 0.45)
		Phase.STRAIN:
			var p := _strain_progress()
			_aura.set_intensity(0.45 + p * 0.85)
			_aura.set_lightning_reach(p * 0.55)
			# the flicker gets faster and shallower as the form stabilises
			_aura.set_flicker((1.0 - p) * 0.55, p * 0.6)
		Phase.BURST:
			_aura.set_intensity(1.2)
			_aura.set_flicker(0.0, 0.0)
		_:
			pass

func _update_ground(real: float) -> void:
	var grow := clampf((t - 0.2) / maxf(0.2, _t_climax - 0.2), 0.0, 1.0)
	if _decal != null:
		var m: StandardMaterial3D = _decal.material_override
		m.albedo_color = Color(1, 1, 1, grow * 0.85)
		_decal.scale = Vector3.ONE * (0.45 + grow * 0.85)
	if _crack_glow != null:
		var gm: StandardMaterial3D = _crack_glow.material_override
		var pulse := 0.55 + 0.45 * sin(t * 9.0)
		gm.albedo_color = Color(profile.glow.r, profile.glow.g, profile.glow.b,
			grow * grow * 0.75 * (pulse if phase == Phase.STRAIN else 1.0))
		_crack_glow.scale = Vector3.ONE * (0.45 + grow * 0.85)
	if _aura_light != null and is_instance_valid(_aura_light):
		var lp := _strain_progress()
		_aura_light.light_energy = 1.1 + 2.3 * lp + 0.25 * sin(t * 13.0)
	if _dust != null and phase == Phase.STRAIN:
		_dust.emission_ring_radius = (2.7 + grow * 1.3) * _gs
		_dust.emission_ring_inner_radius = (2.1 + grow * 1.3) * _gs

func _update_rocks(real: float) -> void:
	if _rocks.is_empty():
		return
	var lift := clampf((t - _t_strain * 0.6) / maxf(0.2, _t_climax - _t_strain * 0.6), 0.0, 1.0)
	for i in _rocks.size():
		var mi := _rocks[i]
		if not is_instance_valid(mi):
			continue
		_rock_angles[i] += real * (0.9 + 0.25 * float(i % 3)) * (1.0 + lift)
		var r := ROCK_RADIUS * _gs * (1.0 - 0.3 * lift) * (0.7 + 0.5 * float((i * 7) % 5) / 5.0)
		var y: float = lerpf(-0.3, (1.4 + 0.7 * float(i % 4) / 4.0) * _gs, lift)
		y += sin(t * 6.0 + float(i)) * 0.06 * lift
		mi.position = Vector3(cos(_rock_angles[i]) * r, y, sin(_rock_angles[i]) * r)
		mi.rotation += Vector3(real * 1.7, real * 2.3, real * 1.1)

func _update_flicker(real: float) -> void:
	if phase != Phase.STRAIN:
		return
	_flicker_t += real
	var period: float = lerpf(FLICKER_PERIOD, FLICKER_PERIOD * 0.55, _strain_progress())
	if _flicker_t < period:
		return
	_flicker_t = 0.0
	_flicker_on = not _flicker_on
	_flash_body(_flicker_on)
	_flicker_hair(_flicker_on)

func _update_scale() -> void:
	if _scaled_node == null or profile.scale <= 1.02:
		return
	var g: float = lerpf(1.0, profile.scale, clampf((t - _t_strain * 0.5) / maxf(0.2, _t_climax - _t_strain * 0.5), 0.0, 1.0))
	_scaled_node.scale = _base_scale * g
	if _aura != null and is_instance_valid(_aura):
		_aura.set_body_scale(g)

func _update_rings() -> void:
	while _rings_done < _ring_times.size() and t >= _ring_times[_rings_done]:
		_spawn_ring((2.4 + float(_rings_done) * 1.8) * _gs, 0.75)
		_rings_done += 1

func _update_pillar(real: float) -> void:
	if _pillar == null or _pillar_age < 0.0:
		return
	_pillar_age += real
	var p := clampf(_pillar_age / 0.7, 0.0, 1.0)
	_pillar.scale = Vector3(1.0 + p * 1.1, 1.0, 1.0 + p * 1.1)
	if _pillar_mat != null:
		_pillar_mat.set_shader_parameter("intensity", (1.0 - p) * 1.35)
	if p >= 1.0:
		_pillar.queue_free()
		_pillar = null

# --- phase C --------------------------------------------------------------

func _do_climax() -> void:
	_climax_done = true
	phase = Phase.BURST
	# the form takes effect now
	if on_climax.is_valid():
		on_climax.call()
	var c := profile.aura
	ScreenFx.flash(Color(1, 1, 1), 0.5, 1.0)
	Events.screen_flash.emit(Color(1, 1, 1), 0.5)
	Events.screen_shake.emit(1.0, 0.55)
	ScreenFx.shake(1.0, 0.55)
	ScreenFx.hit_stop(0.09)
	ScreenFx.radial_blur(0.085, 0.32)
	ScreenFx.chromatic(0.009, 0.32)
	ScreenFx.dim(0.0, 0.0, 0.25)
	ScreenFx.glow(0.75, 0.8, 0.7)
	_fov_kick = 16.0
	_spawn_ring(7.8 * _gs, 0.85)
	_spawn_pillar()
	FxAssets.burst(self, global_position + Vector3.UP * 1.0, "ClimaxBurst", 62,
		["aaa/missile_boost/Star", "ki_flash1", "aaa/lightning/Burst_1"], c, 21.0, 0.65, 0.55, -3.0)
	FxAssets.burst(self, global_position, "ClimaxDust", 32,
		FxAssets.smoke(), Color(0.85, 0.82, 0.76), 9.0, 1.0, 0.9, -6.0)
	FxAssets.burst(self, global_position + Vector3.UP * 0.2, "ClimaxSparks", 26,
		["ki_spark_2", "spark1", "ki_line"], profile.spark, 13.0, 0.5, 0.35, -9.0)
	Audio.play_sfx_at("power_up_burst", global_position)
	Audio.play_sfx_at("explosion_big", global_position, -6.0, 0.8)
	Audio.play_sfx_at("shockwave", global_position, -4.0)
	if profile.lightning:
		Audio.play_sfx_at("thunder", global_position, -7.0)
	Audio.stop_loop(_loop_key, 0.15)
	_shatter_rocks()
	_disturb(1.0)
	if _aura_light != null and is_instance_valid(_aura_light):
		_aura_light.queue_free()          # the climax light replaces it
		_aura_light = null
	_light = OmniLight3D.new()
	_light.name = "ClimaxLight"
	_light.light_color = profile.glow
	_light.light_energy = 9.0
	_light.omni_range = 18.0 * _gs
	_light.shadow_enabled = false
	_light.position = Vector3(0, 1.2, 0)
	add_child(_light)
	if _aura != null:
		_aura.set_lightning(profile.lightning, profile.lightning_color)
		var l: Node = _aura.get_node_or_null("Lightning")
		if l is AuraLightning:
			(l as AuraLightning).strike(Vector3(0, 0.1, 0))

## Vertical energy pillar shooting out of the body at the climax.
func _spawn_pillar() -> void:
	var mi := MeshInstance3D.new()
	mi.name = "Pillar"
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.42
	cyl.bottom_radius = 0.60
	cyl.height = 20.0
	cyl.radial_segments = 14
	cyl.rings = 1
	mi.mesh = cyl
	_pillar_mat = FxAssets.shader_material(BEAM_SHADER, {
		"beam_color": profile.aura, "core_color": profile.inner, "intensity": 1.35,
		"fade_in": 1.0, "core_width": 0.30, "ring_freq": 7.0, "flow_speed": 10.0,
	})
	mi.material_override = _pillar_mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# starts just above the head so the transformed character stays readable under it
	mi.position = Vector3(0, 12.0 * profile.scale, 0)
	add_child(mi)
	_pillar = mi
	_pillar_age = 0.0

func _shatter_rocks() -> void:
	for mi in _rocks:
		if not is_instance_valid(mi):
			continue
		var p := mi.global_position
		FxAssets.burst(self, p, "RockShatter", 4, ["block_1", "block_2", "block_0"],
			Color(0.55, 0.5, 0.45), 7.0, 0.7, 0.28, -18.0)
		mi.queue_free()
	_rocks.clear()

# --- phase D --------------------------------------------------------------

func _enter_reveal() -> void:
	_settled = true
	phase = Phase.REVEAL
	if _dust != null:
		_dust.emitting = false
	if _rise != null:
		_rise.emitting = false
	if _aura != null:
		_aura.set_flicker(0.0, 0.0)
		_aura.set_lightning_reach(0.12)  # the arcs hug the body again
		_aura.set_intensity(-1.0)       # back to the automatic idle aura
	_flash_body(false)                   # drop any emission the last flicker left on
	_flicker_hair(true)                  # settle on the form colour
	ScreenFx.clear_sustained(0.4)
	if _prev_bgm != "" and _prev_bgm != "transformation":
		Audio.play_bgm(_prev_bgm, 1.5)
	else:
		Audio.play_bgm("battle", 1.5)

# --- helpers --------------------------------------------------------------

func _flash_body(on: bool) -> void:
	var ramp := _strain_progress()
	if _body_flash != null:
		var m: StandardMaterial3D = _body_flash.material_override
		m.albedo_color = Color(1, 1, 1, (0.20 * ramp) if on else 0.0)
		_body_flash.scale = Vector3.ONE * (0.7 + 0.5 * ramp)
	var model := _model()
	if model != null and model.has_method("set_emission"):
		# a floor under the flicker: the body has to stay readable inside its own aura
		var base: float = 0.38 * ramp if phase == Phase.STRAIN else 0.0
		model.call("set_emission", profile.inner, (0.7 * ramp) if on else base)

const HAIR_BONES: Array[String] = [
	"hair", "hair_base", "hairstyle", "hair1", "hair2", "head_hair",
	"pelo1", "pelo2", "pelo3", "pelo4", "cabello",
]

func _model() -> Node3D:
	if entity == null or not is_instance_valid(entity) or not ("model" in entity):
		return null
	var m: Variant = entity.get("model")
	return m if m is Node3D else null

## Flicker between the base look and the form's hair colour. Prefers the entity's own
## hook, then the DMZ voxel hair mesh that `HairBuilder` parents under the head bone,
## then the model's named hair bones, then a whole-model tint. The base colour is
## remembered on the first call so `off` really puts the character back.
func _flicker_hair(on: bool) -> void:
	if entity == null or not is_instance_valid(entity):
		return
	if entity.has_method("flicker_form_visuals"):
		entity.call("flicker_form_visuals", form_def if on else {})
		return
	var model := _model()
	if model == null:
		return
	var c := profile.hair
	var hair := _hair_material(model)
	if hair != null:
		if not _hair_base_set:
			_hair_base = hair.albedo_color
			_hair_base_set = true
		hair.albedo_color = c if on else _hair_base
		# the gold/blue hair of a form is emissive while the aura burns
		hair.emission_enabled = on
		if on:
			hair.emission = c
			hair.emission_energy_multiplier = 0.85
		return
	if model.has_method("has_bone") and model.has_method("set_bone_material") and model.has_method("get_texture"):
		var tex: Variant = model.call("get_texture")
		var touched := false
		for b in HAIR_BONES:
			if bool(model.call("has_bone", b)):
				model.call("set_bone_material", b, tex, c if on else Color.WHITE, false)
				touched = true
		if touched:
			return
	if model.has_method("set_tint"):
		model.call("set_tint", c.lerp(Color.WHITE, 0.5) if on else Color.WHITE)

## Material of the voxel hair mesh (`head` bone -> "Hair"), or null.
func _hair_material(model: Node3D) -> StandardMaterial3D:
	if _hair_mat != null and is_instance_valid(_hair_mat):
		return _hair_mat
	if not model.has_method("get_bone"):
		return null
	var head: Variant = model.call("get_bone", "head")
	if not (head is Node3D):
		return null
	var n: Node = (head as Node3D).get_node_or_null("Hair")
	if n is MeshInstance3D and (n as MeshInstance3D).material_override is StandardMaterial3D:
		_hair_mat = (n as MeshInstance3D).material_override
		return _hair_mat
	return null

## One fading silhouette of the body, offset sideways (the "vibrating" look).
func _afterimage() -> void:
	var host: Node = get_parent()
	if host == null or not host.is_inside_tree():
		return
	var a := _rng.randf() * TAU
	var off := Vector3(cos(a), 0.0, sin(a)) * _rng.randf_range(0.25, 0.6)
	Trails.spawn_ghost(entity, global_position + off, profile.aura, 0.22)

## Push grass, leaves and loose blocks away from the transformation (voxel agent's API).
func _disturb(strength: float) -> void:
	var w: Node = Game.world if Game != null else null
	if w != null and is_instance_valid(w) and w.has_method("add_disturbance"):
		w.call("add_disturbance", global_position, clampf(strength, 0.0, 1.0), 0.7)

static func _ring_mesh(c: Color, size: float) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = "Ring"
	var q := QuadMesh.new()
	q.size = Vector2(size * 2.0, size * 2.0)
	q.orientation = PlaneMesh.FACE_Y
	mi.mesh = q
	mi.material_override = FxAssets.shader_material(SHOCKWAVE_SHADER, {
		"ring_color": Color(c.r, c.g, c.b, 0.95),
		"progress": 0.0, "thickness": 0.08, "intensity": 1.7,
	})
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi

func _spawn_ring(size: float, life: float) -> void:
	var mi := _ring_mesh(profile.aura, size)
	mi.position = Vector3(0, 0.12, 0)
	add_child(mi)
	var mat: ShaderMaterial = mi.material_override
	var tw := mi.create_tween()
	tw.tween_method(func(v: float) -> void:
		if is_instance_valid(mat):
			mat.set_shader_parameter("progress", v), 0.0, 1.0, life)
	tw.tween_callback(mi.queue_free)
	Audio.play_sfx_at("shockwave", global_position, -8.0)

func _update_camera(real: float) -> void:
	if _fov_kick > 0.0:
		_fov_kick = maxf(0.0, _fov_kick - real * 34.0)
	if _cam_rig != null:
		return
	if _cam == null or not is_instance_valid(_cam):
		return
	var centre := global_position + Vector3.UP * 1.05 * profile.scale
	var p := clampf(t / duration, 0.0, 1.0)
	var ang := 0.0
	var dist := 5.0
	var height := 1.6
	var shake := 0.0
	if phase == Phase.GATHER:
		# low angle push-in
		var g := clampf(t / maxf(0.01, _t_strain), 0.0, 1.0)
		ang = -1.0 + g * 0.35
		dist = lerpf(7.0, 5.2, ease(g, 0.4))
		height = lerpf(0.5, 1.3, g)
	elif phase == Phase.STRAIN:
		var s := _strain_progress()
		ang = -0.65 + s * 2.1
		dist = lerpf(5.2, 4.0, ease(s, 0.6))
		height = lerpf(1.3, 2.0, s)
		shake = 0.035 + 0.05 * s          # handheld micro-shake
	else:
		var r := clampf((t - _t_climax) / maxf(0.01, duration - _t_climax), 0.0, 1.0)
		ang = 1.45 + r * 0.35
		dist = lerpf(4.0, 5.2, ease(r, 0.35))
		height = lerpf(2.0, 1.9, r)
		shake = 0.05 * (1.0 - r)
	var scale_out: float = maxf(1.0, profile.scale * 0.75)
	var pos := centre + Vector3(sin(ang) * dist, height, cos(ang) * dist) * scale_out
	if shake > 0.0:
		pos += Vector3(sin(t * 27.0) * shake, cos(t * 31.0) * shake, sin(t * 19.0) * shake)
	_cam.global_position = pos
	_cam.look_at(centre, Vector3.UP)
	_cam.fov = _cam_fov + sin(p * PI) * 8.0 + _fov_kick

# --- lifecycle ------------------------------------------------------------

func _finish() -> void:
	phase = Phase.DONE
	_release()
	queue_free()

func _release() -> void:
	_lock_input(false)
	Audio.stop_loop(_loop_key, 0.2)
	if _cam_owned and _cam != null and is_instance_valid(_cam):
		_cam.global_transform = _cam_xform
		_cam.fov = _cam_fov
	for l: OmniLight3D in [_light, _aura_light]:
		if l != null and is_instance_valid(l):
			l.visible = false             # stops lighting this frame, not next frame
			l.queue_free()
	_light = null
	_aura_light = null
	if _hair_mat != null and is_instance_valid(_hair_mat) and _hair_base_set:
		_hair_mat.albedo_color = _hair_base
		_hair_mat.emission_enabled = false
	var model := _model()
	if model != null:
		if model.has_method("set_emission"):
			model.call("set_emission", Color(1, 1, 1), 0.0)
		if model.has_method("set_tint"):
			model.call("set_tint", Color.WHITE)
	if _aura != null and is_instance_valid(_aura):
		_aura.set_flicker(0.0, 0.0)
	ScreenFx.clear_sustained(0.3)
	if entity != null and is_instance_valid(entity):
		_running.erase(entity.get_instance_id())

func _exit_tree() -> void:
	_release()

func _lock_input(on: bool) -> void:
	if entity == null or not is_instance_valid(entity):
		return
	if entity.has_method("set_input_locked"):
		entity.call("set_input_locked", on)
	elif "input_locked" in entity:
		entity.set("input_locked", on)

# --- introspection (tests / profiling) ------------------------------------

func phase_name() -> String:
	return PHASE_NAMES[clampi(phase, 0, PHASE_NAMES.size() - 1)]

## Total CPU particles this director can have alive right now (its own emitters plus the
## one-shot bursts it parented under itself). Never allowed past MAX_PARTICLES.
func particle_budget() -> int:
	return _count_particles(self)

func light_count() -> int:
	return _count_lights(self)

static func _count_particles(n: Node) -> int:
	var total := 0
	if n is CPUParticles3D and (n as CPUParticles3D).emitting:
		total += (n as CPUParticles3D).amount
	for c in n.get_children():
		total += _count_particles(c)
	return total

static func _count_lights(n: Node) -> int:
	var total := 1 if n is Light3D else 0
	for c in n.get_children():
		total += _count_lights(c)
	return total
