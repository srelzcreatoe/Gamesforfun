class_name KiEffects
extends Node3D
## Ki charge orb (an instance of this node) plus the small one-shot ki effects
## (muzzle flash, beam impact, teleport flash, solar flare, disc sparks).
##
## The charge orb is the glowing sphere that grows in the caster's hands while a
## technique charges, with inward-sucking sparkles and an aura pulse:
##   var orb := KiEffects.charge(entity, Color("#4FC3FF"), 1.2)
##   orb.set_progress(0.0 .. 1.0)
##   orb.release()      # flash + free
##
## The orb carries a white-hot core (`shaders/ki_sphere.gdshader`), a corona billboard,
## inward-sucking sparkles and six motes orbiting it on tilted rings.
##
## Statics:
##   KiEffects.hand_position(entity)      -> Vector3 (bone "rightArm"/"arm_right" if the
##                                           entity has a BedrockModel, else eye+forward)
##   KiEffects.muzzle_flash(pos, color, parent)
##   KiEffects.blast_impact(pos, color, radius, parent)   # flash + sparks + ring + scorch
##   KiEffects.beam_impact(pos, color, radius, parent)
##   KiEffects.decorate_projectile(node, color, size)     # glow shell + aligned streak
##   KiEffects.flash_pop(parent, pos, color, size, secs)
##   KiEffects.shock_ring(parent, pos, color, size, secs)
##   KiEffects.scorch(parent, pos, size)
##   KiEffects.teleport_flash(entity, pos)
##   KiEffects.solar_flare(entity, pos, color, seconds)
##   KiEffects.aura_pulse(entity, strength)

const SPHERE_SHADER := "res://shaders/ki_sphere.gdshader"
const RING_SHADER := "res://shaders/shockwave.gdshader"
const FLASH_TEX := "ki_flash"
const SPARKLE_TEX := "aaa/essentials/SPARKLE001"
const SHINE_TEX := "ki_flash1"

const HAND_BONES: Array[String] = ["rightArm", "arm_right", "rightarm", "right_arm", "body"]

const MOTES := 6

var color := Color(0.5, 0.83, 1.0)
var base_size := 1.0
var progress := 0.0

var _sphere: MeshInstance3D
var _mat: ShaderMaterial
var _in_sparks: CPUParticles3D
var _glow: MeshInstance3D
var _motes: Array[MeshInstance3D] = []
var _mote_phase: PackedFloat32Array = PackedFloat32Array()
var _mote_tilt: PackedFloat32Array = PackedFloat32Array()
var _age := 0.0

# --- charge orb -----------------------------------------------------------

## Create a charge orb in the entity's hands (falls back to the world origin offset).
static func charge(entity: Node, c: Color, size := 1.0) -> KiEffects:
	var orb := KiEffects.new()
	orb.name = "KiCharge"
	orb.color = c
	orb.base_size = maxf(0.15, size)
	var parent: Node = entity if entity != null and entity.is_inside_tree() else _parent()
	if parent == null:
		return null
	parent.add_child(orb)
	if entity is Node3D:
		orb.global_position = hand_position(entity)
	return orb

func _ready() -> void:
	_sphere = MeshInstance3D.new()
	_sphere.name = "Sphere"
	var sm := SphereMesh.new()
	sm.radius = 0.5
	sm.height = 1.0
	sm.radial_segments = 16
	sm.rings = 8
	_sphere.mesh = sm
	_mat = FxAssets.shader_material(SPHERE_SHADER, {
		"ki_color": color, "core_color": color.lightened(0.7), "intensity": 1.2,
	})
	_sphere.material_override = _mat
	_sphere.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_sphere)

	_glow = FxAssets.make_quad("Glow", FxAssets.particle(SHINE_TEX, FLASH_TEX, "ki_exp0"), 2.4, Color(color.r, color.g, color.b, 0.35))
	add_child(_glow)

	_in_sparks = FxAssets.make_particles("Suck", 14, [SPARKLE_TEX, "ki_spark_0", "spark1"], color.lightened(0.3))
	_in_sparks.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	_in_sparks.emission_sphere_radius = 1.4
	_in_sparks.direction = Vector3.ZERO
	_in_sparks.spread = 180.0
	_in_sparks.initial_velocity_min = 0.0
	_in_sparks.initial_velocity_max = 0.3
	_in_sparks.radial_accel_min = -9.0
	_in_sparks.radial_accel_max = -14.0
	_in_sparks.lifetime = 0.5
	_in_sparks.scale_amount_min = 0.1
	_in_sparks.scale_amount_max = 0.3
	_in_sparks.local_coords = true
	add_child(_in_sparks)
	_in_sparks.emitting = true
	_build_motes()
	set_progress(0.0)

## Bright motes orbiting the charge sphere on tilted rings (the "gathering energy" read
## of a Kamehameha charge). Six billboards, no particle system.
func _build_motes() -> void:
	var tex := FxAssets.particle("aaa/missile_boost/Star", "ki_spark_1", "spark1")
	for i in MOTES:
		var q := FxAssets.make_quad("Mote%d" % i, tex, 0.34, Color(color.r, color.g, color.b, 0.95))
		add_child(q)
		_motes.append(q)
		_mote_phase.append(float(i) / float(MOTES) * TAU)
		_mote_tilt.append(float(i % 3) * 0.6 - 0.6)

func _process(delta: float) -> void:
	_age += delta
	if _motes.is_empty():
		return
	var r := base_size * (0.55 + 0.75 * progress)
	var speed := 2.4 + progress * 4.5
	for i in _motes.size():
		var a := _mote_phase[i] + _age * speed
		var tilt := _mote_tilt[i]
		var p := Vector3(cos(a) * r, sin(a) * r * sin(tilt), sin(a) * r * cos(tilt))
		_motes[i].position = p
		var s := base_size * (0.18 + 0.22 * progress) * (0.8 + 0.2 * sin(_age * 9.0 + float(i)))
		_motes[i].scale = Vector3.ONE * s
		var m: StandardMaterial3D = _motes[i].material_override
		m.albedo_color = Color(color.r, color.g, color.b, 0.5 + 0.45 * progress)

## 0 = just started, 1 = fully charged.
func set_progress(p: float) -> void:
	progress = clampf(p, 0.0, 1.0)
	var s := base_size * (0.25 + 0.75 * progress)
	if _sphere != null:
		_sphere.scale = Vector3.ONE * s
	if _glow != null:
		_glow.scale = Vector3.ONE * s * 1.1
		var m: StandardMaterial3D = _glow.material_override
		m.albedo_color = Color(color.r, color.g, color.b, 0.18 + 0.28 * progress)
	if _mat != null:
		_mat.set_shader_parameter("intensity", 0.9 + progress * 0.9)
		_mat.set_shader_parameter("pulse_speed", 6.0 + progress * 10.0)
	if _in_sparks != null:
		_in_sparks.emission_sphere_radius = 1.6 * base_size * (1.2 - 0.5 * progress)

## Track the caster's hand each frame (the model moves while casting).
func follow(entity: Node) -> void:
	if entity is Node3D and is_inside_tree():
		global_position = hand_position(entity)

## Flash and free.
func release() -> void:
	if not is_inside_tree():
		queue_free()
		return
	muzzle_flash(global_position, color, get_parent())
	queue_free()

func fade_out(seconds := 0.25) -> void:
	if not is_inside_tree():
		queue_free()
		return
	var tw := create_tween()
	tw.tween_method(func(v: float) -> void:
		if _mat != null:
			_mat.set_shader_parameter("intensity", v), 1.6, 0.0, seconds)
	tw.tween_callback(queue_free)

# --- one shots ------------------------------------------------------------

static func _parent() -> Node:
	if Game != null and Game.world != null and Game.world.is_inside_tree():
		return Game.world
	var loop := Engine.get_main_loop()
	if loop is SceneTree:
		return (loop as SceneTree).current_scene
	return null

## Position of the casting hand: the model's arm bone if the entity engineer's
## BedrockModel exposes `bone(name)`, else eye height + a little forward.
static func hand_position(entity: Node) -> Vector3:
	if entity == null or not (entity is Node3D):
		return Vector3.ZERO
	var n := entity as Node3D
	var model: Variant = entity.get("model") if "model" in entity else null
	if model is Node3D and (model as Node).has_method("bone"):
		for b in HAND_BONES:
			var bone: Variant = (model as Node).call("bone", b)
			if bone is Node3D:
				return (bone as Node3D).global_position
	var fwd := -n.global_transform.basis.z
	var height := 1.25
	if "aabb_size" in entity:
		var s: Variant = entity.get("aabb_size")
		if s is Vector3:
			height = (s as Vector3).y * 0.7
	return n.global_position + Vector3.UP * height + fwd * 0.45

## Forward direction the entity is aiming at (camera forward for the player).
static func aim_direction(entity: Node) -> Vector3:
	if entity == null:
		return Vector3.FORWARD
	if entity.has_method("aim_direction"):
		var v: Variant = entity.call("aim_direction")
		if v is Vector3:
			return (v as Vector3).normalized()
	if Game != null and Game.player == entity:
		var cam := FxAssets.camera(entity)
		if cam != null:
			return -cam.global_transform.basis.z
	var target: Variant = entity.get("target") if "target" in entity else null
	if target is Node3D and entity is Node3D:
		var d: Vector3 = (target as Node3D).global_position + Vector3.UP * 0.9 - hand_position(entity)
		if d.length_squared() > 0.01:
			return d.normalized()
	if entity is Node3D:
		return -(entity as Node3D).global_transform.basis.z
	return Vector3.FORWARD

static func muzzle_flash(pos: Vector3, c: Color, parent: Node = null) -> void:
	var p := parent if parent != null and parent.is_inside_tree() else _parent()
	if p == null:
		return
	var q := FxAssets.make_quad("Muzzle", FxAssets.particle(FLASH_TEX, "ki_flash1", "ki_exp0"), 2.2, Color(c.r, c.g, c.b, 1.0))
	p.add_child(q)
	q.global_position = pos
	var tw := q.create_tween()
	tw.set_parallel(true)
	tw.tween_property(q, "scale", Vector3.ONE * 2.2, 0.18)
	tw.tween_property(q.material_override, "albedo_color:a", 0.0, 0.18)
	tw.chain().tween_callback(q.queue_free)
	FxAssets.burst(p, pos, "MuzzleSparks", 8, ["ki_spark_1", "spark2", "ki_line"], c.lightened(0.3), 8.0, 0.25, 0.3, -2.0)

static func beam_impact(pos: Vector3, c: Color, radius := 1.5, parent: Node = null) -> void:
	var p := parent if parent != null and parent.is_inside_tree() else _parent()
	if p == null:
		return
	FxAssets.burst(p, pos, "BeamHit", 16, ["aaa/lightning/Particle_Soft", "ki_flash1", "spark1"], c, 6.0 * radius, 0.4, 0.5 * radius, -3.0)
	FxAssets.burst(p, pos, "BeamDust", 10, ["aaa/lightning/Smoke", "aaa/explosion/smoke_tex", "block_0"], Color(0.85, 0.82, 0.76), 3.0, 0.8, 0.8 * radius, -4.0)
	flash_pop(p, pos, c.lerp(Color(1, 1, 1), 0.5), radius * 2.6, 0.22)
	shock_ring(p, pos, c, radius * 2.2, 0.5)

## Bright additive flash that pops and fades (impacts, muzzles, climaxes).
static func flash_pop(parent: Node, pos: Vector3, c: Color, size: float, seconds := 0.2) -> void:
	if parent == null or not parent.is_inside_tree():
		return
	var q := FxAssets.make_quad("Flash", FxAssets.particle(FLASH_TEX, SHINE_TEX, "ki_exp0"), size, Color(c.r, c.g, c.b, 1.0))
	parent.add_child(q)
	q.global_position = pos
	q.scale = Vector3.ONE * 0.4
	var tw := q.create_tween()
	tw.set_parallel(true)
	tw.tween_property(q, "scale", Vector3.ONE * 1.3, seconds)
	tw.tween_property(q.material_override, "albedo_color:a", 0.0, seconds)
	tw.chain().tween_callback(q.queue_free)

## Flat expanding ring on the ground/impact plane (`shaders/shockwave.gdshader`).
static func shock_ring(parent: Node, pos: Vector3, c: Color, size: float, seconds := 0.5,
		face_y := true) -> void:
	if parent == null or not parent.is_inside_tree():
		return
	var mi := MeshInstance3D.new()
	mi.name = "ImpactRing"
	var q := QuadMesh.new()
	q.size = Vector2(size * 2.0, size * 2.0)
	if face_y:
		q.orientation = PlaneMesh.FACE_Y
	mi.mesh = q
	var mat := FxAssets.shader_material(RING_SHADER, {
		"ring_color": Color(c.r, c.g, c.b, 0.9), "progress": 0.0,
		"thickness": 0.10, "intensity": 1.5,
	})
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	mi.global_position = pos + Vector3.UP * 0.08
	var tw := mi.create_tween()
	tw.tween_method(func(v: float) -> void:
		if is_instance_valid(mat):
			mat.set_shader_parameter("progress", v), 0.0, 1.0, seconds)
	tw.tween_callback(mi.queue_free)

## Ki blast impact: white flash, coloured sparks, a ring and a scorch mark that lingers.
static func blast_impact(pos: Vector3, c: Color, radius := 2.0, parent: Node = null) -> void:
	var p := parent if parent != null and parent.is_inside_tree() else _parent()
	if p == null:
		return
	flash_pop(p, pos, Color(1, 1, 1), radius * 2.4, 0.18)
	flash_pop(p, pos, c, radius * 3.4, 0.28)
	shock_ring(p, pos, c, radius * 1.8, 0.45)
	FxAssets.burst(p, pos, "BlastSparks", 18, ["ki_spark_1", "spark1", "ki_line"],
		c.lerp(Color(1, 1, 1), 0.35), 9.0 * clampf(radius / 2.0, 0.6, 2.0), 0.38, 0.3, -8.0)
	FxAssets.burst(p, pos, "BlastFire", 12, ["ki_exp1", "explode2", "aaa/lightning/Fire"],
		c, 5.0, 0.4, radius * 0.5, -2.0)
	scorch(p, pos, radius * 0.9)

## Dark scorch decal that fades out over a couple of seconds.
static func scorch(parent: Node, pos: Vector3, size: float, seconds := 2.2) -> void:
	if parent == null or not parent.is_inside_tree():
		return
	var q := FxAssets.make_quad("Scorch", FxAssets.soft_dot(), size * 2.0, Color(1, 1, 1, 1), true)
	var m: StandardMaterial3D = q.material_override
	m.blend_mode = BaseMaterial3D.BLEND_MODE_MIX
	m.albedo_color = Color(0.06, 0.05, 0.05, 0.75)
	parent.add_child(q)
	q.global_position = pos + Vector3.UP * 0.03
	var tw := q.create_tween()
	tw.tween_property(m, "albedo_color:a", 0.0, seconds)
	tw.tween_callback(q.queue_free)

## Glow shell + velocity-aligned streak trail bolted onto a flying ki blast. Called by
## `scripts/combat/Projectile.gd`; safe to call twice (it names its children).
static func decorate_projectile(node: Node3D, c: Color, size: float) -> void:
	if node == null or node.get_node_or_null("KiGlow") != null:
		return
	var glow := FxAssets.make_quad("KiGlow", FxAssets.particle(SHINE_TEX, FLASH_TEX, "ki_exp0"),
		size * 6.0, Color(c.r, c.g, c.b, 0.55))
	node.add_child(glow)
	var streak := FxAssets.make_particles("KiStreak", 16, ["ki_trail1", "ki_trail4", "aura_1"], c)
	streak.lifetime = 0.28
	streak.particle_flag_align_y = true
	(streak.mesh as QuadMesh).size = Vector2(size * 1.1, size * 4.5)
	streak.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	streak.emission_sphere_radius = size * 0.25
	streak.direction = Vector3.ZERO
	streak.spread = 12.0
	streak.initial_velocity_min = 0.1
	streak.initial_velocity_max = 0.6
	streak.gravity = Vector3.ZERO
	streak.scale_amount_min = 0.7
	streak.scale_amount_max = 1.3
	node.add_child(streak)
	streak.emitting = true

static func disc_sparks(pos: Vector3, c: Color, parent: Node = null) -> void:
	var p := parent if parent != null and parent.is_inside_tree() else _parent()
	if p == null:
		return
	FxAssets.burst(p, pos, "DiscCut", 10, ["ki_spark_2", "spark4", "ki_line"], c, 7.0, 0.3, 0.3, -6.0)

static func teleport_flash(entity: Node, pos: Vector3) -> void:
	var p := _parent()
	if p == null:
		return
	var c := Color(0.8, 0.95, 1.0)
	var q := FxAssets.make_quad("Zanzoken", FxAssets.particle(SHINE_TEX, FLASH_TEX, "ki_flash"), 2.4, Color(c.r, c.g, c.b, 0.9))
	p.add_child(q)
	q.global_position = pos + Vector3.UP * 0.9
	var tw := q.create_tween()
	tw.set_parallel(true)
	tw.tween_property(q, "scale", Vector3(0.2, 3.0, 1.0), 0.2)
	tw.tween_property(q.material_override, "albedo_color:a", 0.0, 0.2)
	tw.chain().tween_callback(q.queue_free)

## Solar flare: white screen flash for the player, a big additive billboard in the
## world and `seconds` of blindness on every entity looking at it.
static func solar_flare(entity: Node, pos: Vector3, c := Color(1, 1, 1), seconds := 4.0, radius := 16.0) -> void:
	var p := _parent()
	if p != null:
		var q := FxAssets.make_quad("SolarFlare", FxAssets.particle(FLASH_TEX, SHINE_TEX, "ki_exp0"), 6.0, Color(1, 1, 1, 1))
		p.add_child(q)
		q.global_position = pos
		var tw := q.create_tween()
		tw.set_parallel(true)
		tw.tween_property(q, "scale", Vector3.ONE * 4.0, 0.45)
		tw.tween_property(q.material_override, "albedo_color:a", 0.0, 0.45)
		tw.chain().tween_callback(q.queue_free)
	ScreenFx.flash(Color(1, 1, 1), 0.9, 1.0)
	Audio.play_sfx_at("ki_sparks", pos)
	var world: Node = Game.world if Game != null else null
	if world != null and world.has_method("get_entities"):
		for e in world.call("get_entities"):
			if e == entity or not (e is Node3D):
				continue
			if (e as Node3D).global_position.distance_to(pos) > radius:
				continue
			if e.has_method("blind"):
				e.call("blind", seconds)
			elif "blinded_until" in e:
				e.set("blinded_until", Time.get_ticks_msec() + int(seconds * 1000.0))

## Quick aura flare (technique charge, form stack, mastery gain).
static func aura_pulse(entity: Node, strength := 1.2, seconds := 0.35) -> void:
	var a := Aura.get_for(entity)
	if a == null:
		return
	a.set_intensity(strength)
	var t := Timer.new()
	t.one_shot = true
	t.wait_time = maxf(0.05, seconds)
	a.add_child(t)
	t.timeout.connect(func() -> void:
		if is_instance_valid(a):
			a.set_intensity(-1.0)
		if is_instance_valid(t):
			t.queue_free())
	t.start()
