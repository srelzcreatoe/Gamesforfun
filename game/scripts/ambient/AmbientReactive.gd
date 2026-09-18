class_name AmbientReactive
extends Node3D
## The "the world answers back" layer: everything that fires because something happened.
##
##   Events.splash        -> droplets + an expanding ripple ring on the water surface
##   Events.block_changed -> a voxel debris puff coloured from the block that was removed
##   Events.explosion     -> lingering smoke and embers
##   Events.entity_died   -> a small ki/soul wisp for humanoids
##   player footsteps     -> a tiny dust puff tinted by the block underfoot (polled, no player edits)
##   night sky            -> shooting-star streaks and rare distant horizon flashes
##
## Every effect is a pooled CPUParticles3D that is configured once and then only repositioned and
## restarted, so firing one allocates nothing. Effects that cannot get budget are simply skipped.

const SPLASH := "splash"
const RIPPLE := "ripple"
const DEBRIS := "debris"
const DUST := "dust"
const SMOKE := "smoke"
const EMBER := "ember"
const WISP := "wisp"
const STAR := "star"
const FLASH := "flash"

const POOL_SIZES := {
	SPLASH: 3, RIPPLE: 3, DEBRIS: 4, DUST: 3, SMOKE: 2, EMBER: 2, WISP: 2, STAR: 2, FLASH: 1,
}

var budget: AmbientBudget = null
var pools: Dictionary = {}                ## kind -> AmbientPool
var live: Array[Dictionary] = []           ## {node, kind, until (ms), quads}

var _rng := RandomNumberGenerator.new()

func setup(b: AmbientBudget, seed_value: int = 0) -> void:
	name = "AmbientReactive"
	budget = b
	_rng.seed = seed_value if seed_value != 0 else 0x1eaf_5b12
	for kind in POOL_SIZES.keys():
		var k := String(kind)
		pools[k] = AmbientPool.new(self, func() -> Node: return _make(k), int(POOL_SIZES[kind]))

# --- firing -----------------------------------------------------------------------------------

## Fire effect `kind` at `pos`. Returns false when the pool or the budget is exhausted.
func fire(kind: String, pos: Vector3, color: Color = Color(1, 1, 1),
		scale := 1.0, direction := Vector3.ZERO) -> bool:
	var pool: AmbientPool = pools.get(kind, null)
	if pool == null or budget == null:
		return false
	var cost := _cost(kind)
	# `take()` charges a partial grant before it returns it, so a refusal has to hand back
	# whatever it did get: the burst is never appended to `live`, so `expire()` can never
	# recover those quads and the layer's effective cap would shrink for the whole session.
	var got := budget.take("reactive", cost)
	if got < cost:
		budget.give_back("reactive", got)
		return false
	var node: Node = pool.acquire()
	if node == null:
		budget.give_back("reactive", cost)
		return false
	var p := node as CPUParticles3D
	if p == null:
		budget.give_back("reactive", cost)
		pool.release(node)
		return false
	p.global_position = pos
	p.color = color
	if direction != Vector3.ZERO:
		p.direction = direction.normalized()
	_apply_scale(kind, p, scale)
	p.restart()
	p.emitting = true
	live.append({
		"node": p, "kind": kind, "quads": cost,
		"until": Time.get_ticks_msec() + int((p.lifetime * 1.25 + 0.2) * 1000.0),
	})
	return true

## A splash is droplets plus a flat ripple ring sitting on the surface.
func splash(pos: Vector3, strength: float) -> void:
	var s := clampf(strength, 0.15, 3.0)
	fire(SPLASH, pos + Vector3(0, 0.05, 0), Color(0.72, 0.88, 1.0), 0.7 + s * 0.5)
	fire(RIPPLE, pos + Vector3(0, 0.03, 0), Color(0.85, 0.94, 1.0, 0.9), 0.7 + s * 0.6)

func debris(pos: Vector3, color: Color, strength := 1.0) -> void:
	fire(DEBRIS, pos, color, clampf(strength, 0.5, 1.6))
	fire(DUST, pos, Color(color.r * 1.15 + 0.1, color.g * 1.15 + 0.1, color.b * 1.15 + 0.1), 1.1)

func footstep(pos: Vector3, color: Color) -> void:
	fire(DUST, pos, Color(color.r * 1.1 + 0.08, color.g * 1.1 + 0.08, color.b * 1.1 + 0.08), 0.7)

func explosion(center: Vector3, radius: float) -> void:
	var s := clampf(radius / 3.0, 0.6, 3.0)
	fire(SMOKE, center + Vector3(0, radius * 0.25, 0), Color(0.34, 0.31, 0.29), s)
	fire(EMBER, center, Color(1.0, 0.55, 0.18), s)

func wisp(pos: Vector3, color: Color) -> void:
	fire(WISP, pos, color, 1.0)

func shooting_star(from: Vector3, dir: Vector3) -> void:
	fire(STAR, from, Color(0.95, 0.97, 1.0), 1.0, dir)

func horizon_flash(pos: Vector3, color: Color) -> void:
	fire(FLASH, pos, color, 1.0)

# --- housekeeping (called from the 0.25 s tick) -----------------------------------------------

func expire() -> void:
	var now := Time.get_ticks_msec()
	for i in range(live.size() - 1, -1, -1):
		var e: Dictionary = live[i]
		if now < int(e["until"]):
			continue
		var n: Node = e["node"]
		var kind := String(e["kind"])
		if is_instance_valid(n):
			(n as CPUParticles3D).emitting = false
			var pool: AmbientPool = pools.get(kind, null)
			if pool != null:
				pool.release(n)
		if budget != null:
			budget.give_back("reactive", int(e["quads"]))
		live.remove_at(i)

func stop_all() -> void:
	for e in live:
		var n: Node = e["node"]
		if is_instance_valid(n):
			(n as CPUParticles3D).emitting = false
		if budget != null:
			budget.give_back("reactive", int(e["quads"]))
	live.clear()
	for k in pools.keys():
		var pool: AmbientPool = pools[k]
		pool.release_all()

func live_count() -> int:
	return live.size()

# --- presets ----------------------------------------------------------------------------------

func _cost(kind: String) -> int:
	match kind:
		SPLASH: return 12
		RIPPLE: return 3
		DEBRIS: return 10
		DUST: return 6
		SMOKE: return 12
		EMBER: return 10
		WISP: return 10
		STAR: return 1
		FLASH: return 1
	return 4

func _apply_scale(kind: String, p: CPUParticles3D, scale: float) -> void:
	match kind:
		SPLASH:
			p.initial_velocity_min = 1.8 * scale
			p.initial_velocity_max = 4.6 * scale
		RIPPLE:
			p.scale_amount_min = 1.6 * scale
			p.scale_amount_max = 2.6 * scale
		DEBRIS:
			p.initial_velocity_min = 1.4 * scale
			p.initial_velocity_max = 3.6 * scale
		DUST:
			p.scale_amount_min = 0.18 * scale
			p.scale_amount_max = 0.38 * scale
		SMOKE:
			p.scale_amount_min = 0.9 * scale
			p.scale_amount_max = 1.8 * scale
			p.initial_velocity_min = 0.5 * scale
			p.initial_velocity_max = 1.7 * scale
		EMBER:
			p.initial_velocity_min = 1.0 * scale
			p.initial_velocity_max = 3.4 * scale
		_:
			pass

static func _ramp(offsets: PackedFloat32Array, colors: PackedColorArray) -> Gradient:
	var g := Gradient.new()
	g.offsets = offsets
	g.colors = colors
	return g

static func _curve(points: PackedVector2Array) -> Curve:
	var c := Curve.new()
	for p in points:
		c.add_point(p)
	return c

func _base(node_name: String, amount: int, life: float, additive: bool, tex: Texture2D) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.name = node_name
	p.emitting = false
	p.one_shot = true
	p.local_coords = false
	p.amount = amount
	p.lifetime = life
	p.explosiveness = 0.95
	p.randomness = 0.5
	p.draw_order = CPUParticles3D.DRAW_ORDER_VIEW_DEPTH
	p.mesh = AmbientAssets.unit_quad()
	p.material_override = AmbientAssets.particle_material(tex, additive)
	return p

func _make(kind: String) -> Node:
	match kind:
		SPLASH:
			var p := _base("Splash", 12, 0.8, false, AmbientAssets.soft_dot())
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
			p.emission_sphere_radius = 0.22
			p.direction = Vector3(0, 1, 0)
			p.spread = 48.0
			p.initial_velocity_min = 1.8
			p.initial_velocity_max = 4.6
			p.gravity = Vector3(0, -13.0, 0)
			p.scale_amount_min = 0.07
			p.scale_amount_max = 0.16
			p.color_ramp = _ramp(PackedFloat32Array([0.0, 0.7, 1.0]),
				PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 0.8), Color(1, 1, 1, 0)]))
			return p
		RIPPLE:
			var p := _base("Ripple", 3, 1.1, false, AmbientAssets.ring())
			p.explosiveness = 0.35
			p.mesh = AmbientAssets.flat_quad()
			p.material_override = AmbientAssets.decal_material(AmbientAssets.ring(), false)
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_POINT
			p.direction = Vector3(0, 1, 0)
			p.spread = 0.0
			p.initial_velocity_min = 0.0
			p.initial_velocity_max = 0.0
			p.gravity = Vector3.ZERO
			p.angle_min = 0.0
			p.angle_max = 0.0
			p.scale_amount_min = 1.8
			p.scale_amount_max = 2.6
			p.scale_amount_curve = _curve(PackedVector2Array([Vector2(0, 0.12), Vector2(1, 1.0)]))
			p.color_ramp = _ramp(PackedFloat32Array([0.0, 0.2, 1.0]),
				PackedColorArray([Color(1, 1, 1, 0.0), Color(1, 1, 1, 0.75), Color(1, 1, 1, 0)]))
			return p
		DEBRIS:
			var p := _base("Debris", 10, 1.0, false, AmbientAssets.soft_dot())
			var box := BoxMesh.new()
			box.size = Vector3(0.085, 0.085, 0.085)
			p.mesh = box
			var m := StandardMaterial3D.new()
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			m.vertex_color_use_as_albedo = true
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.disable_receive_shadows = true
			p.material_override = m
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
			p.emission_sphere_radius = 0.3
			p.direction = Vector3(0, 1, 0)
			p.spread = 70.0
			p.initial_velocity_min = 1.4
			p.initial_velocity_max = 3.6
			p.gravity = Vector3(0, -16.0, 0)
			p.angular_velocity_min = -280.0
			p.angular_velocity_max = 280.0
			p.scale_amount_min = 0.55
			p.scale_amount_max = 1.2
			p.color_ramp = _ramp(PackedFloat32Array([0.0, 0.75, 1.0]),
				PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 1), Color(1, 1, 1, 0)]))
			return p
		DUST:
			var p := _base("Dust", 6, 0.7, false, AmbientAssets.soft_dot())
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
			p.emission_sphere_radius = 0.2
			p.direction = Vector3(0, 1, 0)
			p.spread = 85.0
			p.initial_velocity_min = 0.25
			p.initial_velocity_max = 1.0
			p.gravity = Vector3(0, -1.4, 0)
			p.damping_min = 1.0
			p.damping_max = 2.0
			p.scale_amount_min = 0.18
			p.scale_amount_max = 0.38
			p.scale_amount_curve = _curve(PackedVector2Array([Vector2(0, 0.4), Vector2(1, 1.0)]))
			p.color_ramp = _ramp(PackedFloat32Array([0.0, 0.25, 1.0]),
				PackedColorArray([Color(1, 1, 1, 0.0), Color(1, 1, 1, 0.55), Color(1, 1, 1, 0)]))
			return p
		SMOKE:
			var p := _base("Smoke", 12, 2.6, false, AmbientAssets.soft_dot())
			p.explosiveness = 0.55
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
			p.emission_sphere_radius = 0.6
			p.direction = Vector3(0, 1, 0)
			p.spread = 60.0
			p.initial_velocity_min = 0.5
			p.initial_velocity_max = 1.7
			p.gravity = Vector3(0, 0.55, 0)
			p.damping_min = 0.4
			p.damping_max = 0.9
			p.angular_velocity_min = -30.0
			p.angular_velocity_max = 30.0
			p.scale_amount_min = 0.9
			p.scale_amount_max = 1.8
			p.scale_amount_curve = _curve(PackedVector2Array([Vector2(0, 0.35), Vector2(1, 1.0)]))
			p.color_ramp = _ramp(PackedFloat32Array([0.0, 0.18, 1.0]),
				PackedColorArray([Color(1, 1, 1, 0.0), Color(1, 1, 1, 0.55), Color(1, 1, 1, 0)]))
			return p
		EMBER:
			var p := _base("Ember", 10, 1.9, true, AmbientAssets.soft_dot())
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
			p.emission_sphere_radius = 0.4
			p.direction = Vector3(0, 1, 0)
			p.spread = 75.0
			p.initial_velocity_min = 1.0
			p.initial_velocity_max = 3.4
			p.gravity = Vector3(0, -1.6, 0)
			p.damping_min = 0.5
			p.damping_max = 1.2
			p.scale_amount_min = 0.07
			p.scale_amount_max = 0.15
			p.color_ramp = _ramp(PackedFloat32Array([0.0, 0.5, 1.0]),
				PackedColorArray([Color(1, 1, 1, 1), Color(1, 0.75, 0.45, 0.8), Color(0.6, 0.2, 0.1, 0)]))
			return p
		WISP:
			var p := _base("Wisp", 10, 1.7, true, AmbientAssets.soft_dot())
			p.explosiveness = 0.5
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
			p.emission_sphere_radius = 0.35
			p.direction = Vector3(0, 1, 0)
			p.spread = 22.0
			p.initial_velocity_min = 0.7
			p.initial_velocity_max = 1.8
			p.gravity = Vector3(0, 1.1, 0)
			p.damping_min = 0.3
			p.damping_max = 0.8
			p.tangential_accel_min = -1.2
			p.tangential_accel_max = 1.2
			p.scale_amount_min = 0.12
			p.scale_amount_max = 0.3
			p.scale_amount_curve = _curve(PackedVector2Array([Vector2(0, 1.0), Vector2(1, 0.15)]))
			p.color_ramp = _ramp(PackedFloat32Array([0.0, 0.3, 1.0]),
				PackedColorArray([Color(1, 1, 1, 0.0), Color(1, 1, 1, 1.0), Color(1, 1, 1, 0)]))
			return p
		STAR:
			var p := _base("Star", 1, 1.2, true, AmbientAssets.streak())
			p.mesh = AmbientAssets.streak_quad()
			p.particle_flag_align_y = true
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_POINT
			p.spread = 0.0
			p.randomness = 0.0
			p.initial_velocity_min = 60.0
			p.initial_velocity_max = 95.0
			p.gravity = Vector3.ZERO
			p.scale_amount_min = 3.0
			p.scale_amount_max = 6.0
			p.color_ramp = _ramp(PackedFloat32Array([0.0, 0.25, 1.0]),
				PackedColorArray([Color(1, 1, 1, 0.0), Color(1, 1, 1, 1.0), Color(1, 1, 1, 0)]))
			return p
		FLASH:
			var p := _base("Flash", 1, 0.45, true, AmbientAssets.soft_dot())
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_POINT
			p.spread = 0.0
			p.randomness = 0.0
			p.initial_velocity_min = 0.0
			p.initial_velocity_max = 0.0
			p.gravity = Vector3.ZERO
			p.scale_amount_min = 14.0
			p.scale_amount_max = 22.0
			p.scale_amount_curve = _curve(PackedVector2Array([Vector2(0, 0.4), Vector2(0.25, 1.0), Vector2(1, 0.7)]))
			p.color_ramp = _ramp(PackedFloat32Array([0.0, 0.08, 0.3, 1.0]),
				PackedColorArray([Color(1, 1, 1, 0.0), Color(1, 1, 1, 0.9), Color(1, 1, 1, 0.25), Color(1, 1, 1, 0)]))
			return p
	return _base("Burst", 6, 0.8, true, AmbientAssets.soft_dot())
