class_name TransformationDirector
extends Node3D
## THE transformation cinematic (~3.5 s). One instance runs one transformation and
## frees itself; `Forms.begin_transform` creates it and gets a callback when the
## multipliers should land (at the climax, not at the end).
##
##   TransformationDirector.play_for(entity, "ssgrades.supersaiyan", on_climax)
##
## Timeline (seconds, real time - the director is immune to its own slow motion):
##   0.00  input lock, Events.transformation_started, BGM "transformation",
##         transform_on + power_up_burst, camera orbit + push-in, FOV widen,
##         ground dust ring, cracked-ground decal, 8-14 levitating rock cubes
##   0.15  Engine.time_scale 0.6 for 1.5 s (restored by ScreenFx)
##   0.30  aura grows in, lightning starts, white body flashes, hair flicker every
##         0.15 s, eye glow, rising energy particles
##   0.90  first shockwave ring        1.70  second ring
##   2.55  CLIMAX: screen flash, big shockwave, burst particles, rocks shatter,
##         Events.screen_shake(1.0, 0.5), hit-stop, one OmniLight3D  -> on_climax()
##   2.90  settle: persistent idle aura, camera released, BGM restored
##   3.50  done, frees itself
##
## Mobile budget: <= 300 CPU particles total, billboards only, exactly one light.

const DURATION := 3.5
const SLOW_START := 0.15
const SLOW_LENGTH := 1.5
const SLOW_SCALE := 0.6
const AURA_IN := 0.30
const RING_TIMES: Array[float] = [0.9, 1.7]
const CLIMAX := 2.55
const SETTLE := 2.9
const FLICKER_PERIOD := 0.15

const ROCKS_MIN := 8
const ROCKS_MAX := 14
const ROCK_RADIUS := 2.1

const SHOCKWAVE_SHADER := "res://shaders/shockwave.gdshader"

static var _running: Dictionary = {}          # entity id -> director

var entity: Node = null
var form_id := ""
var form_def: Dictionary = {}
var on_climax: Callable = Callable()

var t := 0.0
var _phase := 0
var _flicker_t := 0.0
var _flicker_on := false
var _rings_done := 0
var _climax_done := false
var _settled := false

var _aura: Aura
var _rocks: Array[MeshInstance3D] = []
var _rock_angles: PackedFloat32Array = PackedFloat32Array()
var _dust: CPUParticles3D
var _rise: CPUParticles3D
var _decal: MeshInstance3D
var _light: OmniLight3D
var _body_flash: MeshInstance3D
var _rng := RandomNumberGenerator.new()

# camera state we borrow and must give back
var _cam: Camera3D
var _cam_xform := Transform3D.IDENTITY
var _cam_fov := 75.0
var _cam_owned := false
var _cam_rig: Node = null
var _prev_bgm := ""
var _giant := 1.0
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
	d.form_def = Registry.form(id)
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

static func _fallback_parent() -> Node:
	if Game != null and Game.world != null and Game.world.is_inside_tree():
		return Game.world
	var loop := Engine.get_main_loop()
	if loop is SceneTree:
		return (loop as SceneTree).current_scene
	return null

# --- setup ----------------------------------------------------------------

func _ready() -> void:
	_rng.randomize()
	ScreenFx.get_instance()
	top_level = true
	if entity is Node3D:
		global_position = (entity as Node3D).global_position
	_lock_input(true)
	Events.transformation_started.emit(entity, form_id)
	_prev_bgm = Audio.bgm_context()
	Audio.play_bgm("transformation", 0.4)
	Audio.play_sfx_at("transform_on", global_position)
	Audio.play_sfx_at("power_up_burst", global_position, -2.0)
	Audio.play_sfx_at("aura_start", global_position, -4.0)
	_setup_aura()
	_setup_ground()
	_setup_rocks()
	_setup_body_flash()
	_setup_camera()
	_setup_giant()

func _setup_aura() -> void:
	_aura = Aura.get_for(entity)
	if _aura == null:
		return
	_aura.set_form(form_def)
	_aura.set_intensity(0.0)

func _setup_ground() -> void:
	# expanding dust ring at the feet
	_dust = FxAssets.make_particles("GroundDust", 24, ["aaa/lightning/Smoke", "aaa/explosion/smoke_tex", "block_0"], Color(0.70, 0.67, 0.62))
	_dust.material_override.blend_mode = BaseMaterial3D.BLEND_MODE_MIX
	_dust.lifetime = 1.4
	_dust.emission_shape = CPUParticles3D.EMISSION_SHAPE_RING
	_dust.emission_ring_axis = Vector3.UP
	_dust.emission_ring_radius = 1.4
	_dust.emission_ring_inner_radius = 0.9
	_dust.emission_ring_height = 0.1
	_dust.direction = Vector3(0, 0.4, 0)
	_dust.spread = 60.0
	_dust.initial_velocity_min = 1.0
	_dust.initial_velocity_max = 3.0
	_dust.gravity = Vector3(0, -1.0, 0)
	_dust.scale_amount_min = 1.1
	_dust.scale_amount_max = 2.6
	add_child(_dust)
	_dust.emitting = true

	_rise = FxAssets.make_particles("RisingEnergy", 46, ["divine_particle_0", "ki_spark_0", "aura_2"], _aura_color())
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

	_decal = FxAssets.make_quad("CrackedGround", _crack_texture(), 5.2, Color(0.15, 0.12, 0.1, 0.0), true)
	var m: StandardMaterial3D = _decal.material_override
	m.blend_mode = BaseMaterial3D.BLEND_MODE_MIX
	m.albedo_color = Color(1, 1, 1, 0.0)
	_decal.position = Vector3(0, 0.04, 0)
	add_child(_decal)

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

func _setup_rocks() -> void:
	var count := _rng.randi_range(ROCKS_MIN, ROCKS_MAX)
	_rock_angles.resize(count)
	for i in count:
		var mi := MeshInstance3D.new()
		mi.name = "Rock%d" % i
		var s := _rng.randf_range(0.14, 0.30)
		mi.mesh = FxAssets.cube_mesh(s)
		mi.material_override = FxAssets.debris_material(Color(0.26, 0.23, 0.20).lightened(_rng.randf() * 0.22))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var a := float(i) / float(count) * TAU + _rng.randf_range(-0.2, 0.2)
		_rock_angles[i] = a
		var r := ROCK_RADIUS * _rng.randf_range(0.7, 1.25)
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
			(rig as Node).call("cinematic_orbit", global_position + Vector3.UP * 1.1, DURATION, 5.2, 2.6)
			return
	_cam = FxAssets.camera(self)
	if _cam == null:
		return
	_cam_owned = true
	_cam_xform = _cam.global_transform
	_cam_fov = _cam.fov

func _setup_giant() -> void:
	var sc: Variant = form_def.get("modelScaling", null)
	if sc is Array and (sc as Array).size() >= 2:
		_giant = maxf(float(sc[0]), float(sc[1]))
	var target: Variant = entity.get("model") if entity != null and "model" in entity else null
	_scaled_node = target if target is Node3D else (entity as Node3D if entity is Node3D else null)
	if _scaled_node != null:
		_base_scale = _scaled_node.scale

func _aura_color() -> Color:
	var ac := String(form_def.get("auraColor", ""))
	if ac != "":
		return Color(ac)
	if _aura != null:
		return _aura.outer_color
	return Color(1.0, 0.85, 0.2)

# --- timeline -------------------------------------------------------------

func _process(delta: float) -> void:
	# immune to our own slow motion / hit stop
	var real := delta / maxf(0.001, Engine.time_scale)
	t += real
	if entity != null and is_instance_valid(entity) and entity is Node3D:
		global_position = (entity as Node3D).global_position

	if _phase == 0 and t >= SLOW_START:
		_phase = 1
		ScreenFx.slow_mo(SLOW_SCALE, SLOW_LENGTH)
		ScreenFx.chromatic(0.004, SLOW_LENGTH)

	# aura ramp
	if _aura != null:
		var a := clampf((t - AURA_IN) / (CLIMAX - AURA_IN), 0.0, 1.0)
		_aura.set_intensity(a * 1.1 if t < CLIMAX else 1.45)
		if t > CLIMAX + 0.35 and not _settled:
			pass

	# cracked ground fades in
	if _decal != null:
		var m: StandardMaterial3D = _decal.material_override
		m.albedo_color = Color(1, 1, 1, clampf((t - 0.2) / 1.2, 0.0, 0.85))
		_decal.scale = Vector3.ONE * (0.6 + clampf(t / CLIMAX, 0.0, 1.0) * 0.6)

	# rocks levitate and orbit
	_update_rocks(real)

	# white body flashes + hair flicker
	_flicker_t += real
	if _flicker_t >= FLICKER_PERIOD:
		_flicker_t = 0.0
		_flicker_on = not _flicker_on
		_flash_body(_flicker_on)
		_flicker_hair(_flicker_on)

	# shockwave rings
	while _rings_done < RING_TIMES.size() and t >= RING_TIMES[_rings_done]:
		_spawn_ring(2.2 + float(_rings_done) * 1.6, 0.7)
		_rings_done += 1

	# giant forms grow over the sequence
	if _scaled_node != null and _giant > 1.05:
		var g: float = lerpf(1.0, _giant, clampf(t / CLIMAX, 0.0, 1.0))
		_scaled_node.scale = _base_scale * g

	_update_camera(real)

	if not _climax_done and t >= CLIMAX:
		_do_climax()
	if not _settled and t >= SETTLE:
		_do_settle()
	if t >= DURATION:
		_finish()

func _update_rocks(real: float) -> void:
	if _rocks.is_empty():
		return
	var lift := clampf((t - 0.25) / 1.4, 0.0, 1.0)
	for i in _rocks.size():
		var mi := _rocks[i]
		if not is_instance_valid(mi):
			continue
		_rock_angles[i] += real * (0.9 + 0.25 * float(i % 3))
		var r := ROCK_RADIUS * (1.0 - 0.25 * lift) * (0.7 + 0.5 * float((i * 7) % 5) / 5.0)
		var y: float = lerpf(-0.3, 1.2 + 0.6 * float(i % 4) / 4.0, lift)
		mi.position = Vector3(cos(_rock_angles[i]) * r, y, sin(_rock_angles[i]) * r)
		mi.rotation += Vector3(real * 1.7, real * 2.3, real * 1.1)

func _flash_body(on: bool) -> void:
	var ramp := clampf((t - 0.3) / (CLIMAX - 0.3), 0.0, 1.0)
	if _body_flash != null:
		var m: StandardMaterial3D = _body_flash.material_override
		m.albedo_color = Color(1, 1, 1, (0.30 * ramp) if on else 0.0)
		_body_flash.scale = Vector3.ONE * (0.7 + 0.5 * ramp)
	var model := _model()
	if model != null and model.has_method("set_emission"):
		model.call("set_emission", Color(1, 1, 1), (0.9 * ramp) if on else 0.0)

const HAIR_BONES: Array[String] = ["hair", "hair_base", "hairstyle", "hair1", "head_hair"]

func _model() -> Node3D:
	if entity == null or not is_instance_valid(entity) or not ("model" in entity):
		return null
	var m: Variant = entity.get("model")
	return m if m is Node3D else null

## Flicker between the base look and the form's hair colour every 0.15 s. Prefers the
## entity's own hook, then the model's hair bones, then a whole-model emission pulse.
func _flicker_hair(on: bool) -> void:
	if entity == null or not is_instance_valid(entity):
		return
	if entity.has_method("flicker_form_visuals"):
		entity.call("flicker_form_visuals", form_def if on else {})
		return
	var model := _model()
	if model == null:
		return
	var hc := String(form_def.get("hairColor", ""))
	var c := Color(hc) if hc != "" else _aura_color().lightened(0.3)
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
		model.call("set_tint", c.lerp(Color.WHITE, 0.55) if on else Color.WHITE)

func _spawn_ring(size: float, life: float) -> void:
	var mi := MeshInstance3D.new()
	mi.name = "Ring"
	var q := QuadMesh.new()
	q.size = Vector2(size * 2.0, size * 2.0)
	q.orientation = PlaneMesh.FACE_Y
	mi.mesh = q
	var mat := FxAssets.shader_material(SHOCKWAVE_SHADER, {
		"ring_color": Color(_aura_color().r, _aura_color().g, _aura_color().b, 0.95),
		"progress": 0.0, "thickness": 0.08, "intensity": 1.6,
	})
	mi.material_override = mat
	mi.position = Vector3(0, 0.12, 0)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	var tw := mi.create_tween()
	tw.tween_method(func(v: float) -> void:
		if is_instance_valid(mat):
			mat.set_shader_parameter("progress", v), 0.0, 1.0, life)
	tw.tween_callback(mi.queue_free)
	Audio.play_sfx_at("shockwave", global_position, -6.0)

func _do_climax() -> void:
	_climax_done = true
	# the form takes effect now
	if on_climax.is_valid():
		on_climax.call()
	ScreenFx.flash(Color(1, 1, 1), 0.55, 1.0)
	Events.screen_flash.emit(Color(1, 1, 1), 0.55)
	Events.screen_shake.emit(1.0, 0.5)
	ScreenFx.hit_stop(0.08)
	_spawn_ring(7.5, 1.1)
	FxAssets.burst(self, global_position + Vector3.UP * 1.0, "ClimaxBurst", 60,
		["aaa/lightning/Burst_1", "ki_flash1", "aaa/missile_boost/Star"], _aura_color(), 16.0, 0.7, 1.1, -3.0)
	FxAssets.burst(self, global_position, "ClimaxDust", 30,
		["aaa/lightning/Smoke", "aaa/explosion/smoke_tex", "block_0"], Color(0.85, 0.82, 0.76), 9.0, 1.0, 1.3, -6.0)
	Audio.play_sfx_at("power_up_burst", global_position)
	Audio.play_sfx_at("explosion_big", global_position, -6.0, 0.8)
	Audio.play_sfx_at("thunder", global_position, -8.0)
	_shatter_rocks()
	_light = OmniLight3D.new()
	_light.light_color = _aura_color()
	_light.light_energy = 8.0
	_light.omni_range = 16.0
	_light.shadow_enabled = false
	_light.position = Vector3(0, 1.2, 0)
	add_child(_light)
	if _aura != null:
		_aura.set_lightning(bool(form_def.get("hasLightnings", false)))

func _shatter_rocks() -> void:
	for mi in _rocks:
		if not is_instance_valid(mi):
			continue
		var p := mi.global_position
		FxAssets.burst(self, p, "RockShatter", 5, ["block_1", "block_2", "block_0"], Color(0.55, 0.5, 0.45), 7.0, 0.7, 0.28, -18.0)
		mi.queue_free()
	_rocks.clear()

func _do_settle() -> void:
	_settled = true
	if _dust != null:
		_dust.emitting = false
	if _rise != null:
		_rise.emitting = false
	if _aura != null:
		_aura.set_intensity(-1.0)       # back to the automatic idle aura
	if _body_flash != null:
		var m: StandardMaterial3D = _body_flash.material_override
		m.albedo_color = Color(1, 1, 1, 0.0)
	_flicker_hair(true)                  # settle on the form colour
	if _prev_bgm != "" and _prev_bgm != "transformation":
		Audio.play_bgm(_prev_bgm, 1.5)
	else:
		Audio.play_bgm("battle", 1.5)

func _update_camera(real: float) -> void:
	if _cam_rig != null or _cam == null or not is_instance_valid(_cam):
		return
	var centre := global_position + Vector3.UP * 1.1
	var p := clampf(t / DURATION, 0.0, 1.0)
	var ang := -0.9 + p * 2.3
	var dist: float = lerpf(5.4, 2.7, ease(p, 0.6))
	var height: float = lerpf(1.9, 1.35, p)
	var pos := centre + Vector3(sin(ang) * dist, height, cos(ang) * dist)
	_cam.global_position = pos
	_cam.look_at(centre, Vector3.UP)
	_cam.fov = _cam_fov + sin(p * PI) * 14.0

func _finish() -> void:
	_release()
	queue_free()

func _release() -> void:
	_lock_input(false)
	if _cam_owned and _cam != null and is_instance_valid(_cam):
		_cam.global_transform = _cam_xform
		_cam.fov = _cam_fov
	if _light != null and is_instance_valid(_light):
		_light.queue_free()
	var model := _model()
	if model != null:
		if model.has_method("set_emission"):
			model.call("set_emission", Color(1, 1, 1), 0.0)
		if model.has_method("set_tint"):
			model.call("set_tint", Color.WHITE)
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
