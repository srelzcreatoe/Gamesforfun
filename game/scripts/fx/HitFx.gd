class_name HitFx
extends RefCounted
## Melee / impact feedback: punch particles, DMZ golpe sounds, hit-stop, camera shake
## scaled by damage, crit flash, block and parry sparks and the floating damage number.
##
## Public API:
##   HitFx.on_hit(target, pos, amount, crit, kind, source)   # called by Damage.deal
##   HitFx.punch(pos, dir, damage, crit)                     # swing that connected
##   HitFx.block(pos, dir)  HitFx.parry(pos, dir)  HitFx.evade(pos)
##   HitFx.miss(pos)                                         # whoosh only
##   HitFx.speed_lines(parent, pos, color, strength)         # radiating impact streaks
##   HitFx.dust_puff(parent, pos, strength)

const PUNCH_TEX: Array[String] = ["punch_particle_0", "punch_particle_2", "punch_particle_4"]
const SPARK_TEX: Array[String] = ["spark1", "spark3", "ki_spark_0"]
const BLOCK_TEX: Array[String] = ["block_0", "block_1", "block_2"]
const HIT_TEX := "ki_exp0"

const PUNCH_SOUNDS: Array[String] = ["golpe1", "golpe2", "golpe3", "golpe4", "golpe5", "golpe6"]
const CRIT_SOUNDS: Array[String] = ["critico1", "critico2"]
const BLOCK_SOUNDS: Array[String] = ["block1", "block2", "block3"]

const HIT_STOP := 0.05
const CRIT_HIT_STOP := 0.09

static var rng := RandomNumberGenerator.new()

## Full hit reaction. `kind` is one of the Damage.* kinds; melee hits get the punch
## sprites and the hit-stop, ki/explosion hits only get sparks and the shake.
static func on_hit(target: Node, pos: Vector3, amount: float, crit := false,
		kind := Damage.MELEE, source: Node = null) -> void:
	if amount <= 0.0:
		return
	var color := Color(1, 0.92, 0.75) if kind == Damage.MELEE else Color(0.65, 0.9, 1.0)
	if crit:
		color = Color(1, 0.75, 0.35)
	var parent := _parent(target)
	if parent != null:
		var tex: Array = PUNCH_TEX if kind == Damage.MELEE else SPARK_TEX
		FxAssets.burst(parent, pos, "Hit", 10 if crit else 6, tex, color, 5.5, 0.35, 0.45, -2.0)
		var flash := FxAssets.make_quad("HitFlash", FxAssets.particle(HIT_TEX, "ki_flash", "spark1"),
			0.9 + clampf(amount / 80.0, 0.0, 1.2), color)
		parent.add_child(flash)
		flash.global_position = pos
		_pop(flash, 0.16, 1.7)
		# the punch reads as force: white speed lines shooting out of the contact point
		# plus a low dust puff. Both scale with the damage so a jab is not a Dragon Fist.
		var power := clampf(amount / 70.0, 0.25, 1.4)
		speed_lines(parent, pos, color.lerp(Color(1, 1, 1), 0.55), power * (1.5 if crit else 1.0))
		if kind == Damage.MELEE or kind == Damage.EXPLOSION:
			dust_puff(parent, pos, power)
		if crit:
			KiEffects.flash_pop(parent, pos, Color(1, 0.95, 0.8), 2.2 * power, 0.2)
			KiEffects.shock_ring(parent, pos, Color(1, 0.88, 0.6), 1.6 * power, 0.35, false)
	_sounds(pos, amount, crit, kind)
	if kind == Damage.MELEE or kind == Damage.EXPLOSION:
		ScreenFx.hit_stop(CRIT_HIT_STOP if crit else HIT_STOP)
	var is_player_hit := Game != null and Game.player == target
	ScreenFx.shake(clampf(amount / 50.0, 0.12, 1.1) * (1.5 if crit else 1.0), 0.15 + clampf(amount / 400.0, 0.0, 0.2))
	if is_player_hit:
		ScreenFx.vignette_pulse(Color(0.6, 0.04, 0.04), clampf(amount / 60.0, 0.15, 0.75), 0.4)
	if crit:
		ScreenFx.flash(Color(1, 0.95, 0.85), 0.14, 0.5)
	Events.damage_number.emit(pos, amount, crit, color)

static func punch(pos: Vector3, dir: Vector3, damage: float, crit := false, parent: Node = null) -> void:
	var p := parent if parent != null else _tree_parent()
	if p != null:
		FxAssets.burst(p, pos, "Punch", 6, PUNCH_TEX, Color(1, 0.95, 0.85), 4.0, 0.3, 0.4, -1.0)
		speed_lines(p, pos, Color(1, 0.97, 0.9), clampf(damage / 70.0, 0.3, 1.2) * (1.4 if crit else 1.0))
	Audio.play_sfx_at(_pick(CRIT_SOUNDS if crit else PUNCH_SOUNDS), pos)

static func miss(pos: Vector3) -> void:
	Audio.play_sfx_at("whoosh", pos, -6.0, rng.randf_range(0.9, 1.15))

static func block(pos: Vector3, dir := Vector3.ZERO, parent: Node = null) -> void:
	var p := parent if parent != null else _tree_parent()
	if p != null:
		FxAssets.burst(p, pos, "Block", 8, BLOCK_TEX, Color(0.8, 0.9, 1.0), 4.5, 0.3, 0.35, -3.0)
	Audio.play_sfx_at(_pick(BLOCK_SOUNDS), pos)
	ScreenFx.shake(0.18, 0.12)

static func parry(pos: Vector3, dir := Vector3.ZERO, parent: Node = null) -> void:
	var p := parent if parent != null else _tree_parent()
	if p != null:
		FxAssets.burst(p, pos, "Parry", 14, SPARK_TEX, Color(1, 1, 0.8), 7.0, 0.35, 0.4, -2.0)
		speed_lines(p, pos, Color(1, 1, 0.85), 1.1)
		KiEffects.flash_pop(p, pos, Color(1, 1, 0.9), 1.6, 0.16)
	Audio.play_sfx_at("parry", pos)
	ScreenFx.flash(Color(1, 1, 0.9), 0.1, 0.35)
	ScreenFx.hit_stop(0.07)

static func evade(pos: Vector3) -> void:
	Audio.play_sfx_at(_pick(["evasion1", "evasion2"]), pos)

static func knockdown(pos: Vector3) -> void:
	Audio.play_sfx_at("knockback_character", pos)
	ScreenFx.shake(0.5, 0.25)

## Velocity-aligned streaks radiating from an impact. `strength` 0.25 - 1.5 scales the
## count, reach and length; one CPUParticles3D, freed automatically.
static func speed_lines(parent: Node, pos: Vector3, c: Color, strength := 1.0) -> void:
	if parent == null or not parent.is_inside_tree():
		return
	var s := clampf(strength, 0.2, 1.5)
	var p := FxAssets.make_particles("SpeedLines", int(round(8.0 * s)) + 4,
		["ki_line", "ki_trail4", "spark3"], c)
	p.one_shot = true
	p.explosiveness = 1.0
	p.lifetime = 0.22
	p.particle_flag_align_y = true
	(p.mesh as QuadMesh).size = Vector2(0.09, 1.5 * s)
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	p.emission_sphere_radius = 0.12
	p.spread = 180.0
	p.direction = Vector3.UP
	p.initial_velocity_min = 9.0 * s
	p.initial_velocity_max = 17.0 * s
	p.gravity = Vector3.ZERO
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.2
	parent.add_child(p)
	p.global_position = pos
	p.emitting = true
	FxAssets.free_after(p, 0.6)

## Low grey dust kicked up by a melee impact (mix blended, not additive).
static func dust_puff(parent: Node, pos: Vector3, strength := 1.0) -> void:
	if parent == null or not parent.is_inside_tree():
		return
	var s := clampf(strength, 0.2, 1.5)
	var p := FxAssets.make_particles("HitDust", int(round(7.0 * s)) + 3,
		["aaa/lightning/Smoke", "aaa/explosion/smoke_tex", "block_0"], Color(0.72, 0.69, 0.64))
	p.material_override.blend_mode = BaseMaterial3D.BLEND_MODE_MIX
	p.one_shot = true
	p.explosiveness = 0.85
	p.lifetime = 0.55
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	p.emission_sphere_radius = 0.25
	p.spread = 110.0
	p.direction = Vector3.UP
	p.initial_velocity_min = 1.2 * s
	p.initial_velocity_max = 3.2 * s
	p.gravity = Vector3(0, -2.5, 0)
	p.scale_amount_min = 0.35 * s
	p.scale_amount_max = 0.9 * s
	parent.add_child(p)
	p.global_position = pos
	p.emitting = true
	FxAssets.free_after(p, 1.0)

# --- internals ------------------------------------------------------------

static func _sounds(pos: Vector3, amount: float, crit: bool, kind: String) -> void:
	match kind:
		Damage.MELEE:
			Audio.play_sfx_at(_pick(CRIT_SOUNDS if crit else PUNCH_SOUNDS), pos, 0.0, rng.randf_range(0.92, 1.08))
		Damage.KI:
			Audio.play_sfx_at("ki_explosion_impact", pos, -4.0)
		Damage.EXPLOSION:
			Audio.play_sfx_at("ki_explosion_impact", pos)
		_:
			Audio.play_sfx_at("golpe2", pos, -6.0)

static func _pick(list: Array) -> String:
	if list.is_empty():
		return ""
	return String(list[rng.randi_range(0, list.size() - 1)])

static func _parent(target: Node) -> Node:
	if target != null and target.is_inside_tree():
		var p := target.get_parent()
		if p != null:
			return p
		return target
	return _tree_parent()

static func _tree_parent() -> Node:
	if Game != null and Game.world != null and Game.world.is_inside_tree():
		return Game.world
	var loop := Engine.get_main_loop()
	if loop is SceneTree:
		return (loop as SceneTree).current_scene
	return null

## Scale a quad up while fading it out, then free it.
static func _pop(node: MeshInstance3D, duration: float, grow: float) -> void:
	if node == null or not node.is_inside_tree():
		return
	var m: StandardMaterial3D = node.material_override
	var tw := node.create_tween()
	tw.set_parallel(true)
	tw.tween_property(node, "scale", Vector3.ONE * grow, duration)
	if m != null:
		tw.tween_property(m, "albedo_color:a", 0.0, duration)
	tw.chain().tween_callback(node.queue_free)
