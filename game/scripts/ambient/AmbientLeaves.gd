class_name AmbientLeaves
extends Node3D
## Leaves drifting down out of the canopies around the player.
##
## A small pool of CPUParticles3D emitters is parked under whatever leaf blocks are overhead; the
## engine animates the fall, so the only per-tick work is finding a canopy and moving an emitter
## that has drifted out of range. Rate, drift direction and tumble all scale with the wind, so a
## storm strips the trees and a still afternoon barely sheds anything.

const MAX_EMITTERS := 4
const PER_EMITTER := 10
const BOX_EXTENTS := Vector3(3.0, 0.6, 3.0)

var emitters: Array[CPUParticles3D] = []
var anchors: PackedVector3Array = PackedVector3Array()
## How many emitters the budget lets us run. An emitter only costs quads once it is actually
## parked under a canopy, so `permitted` is a ceiling, never what is charged (see parked_count).
var permitted := 0

func setup(count: int = MAX_EMITTERS) -> void:
	name = "AmbientLeaves"
	var n := clampi(count, 0, MAX_EMITTERS)
	for i in n:
		var p := CPUParticles3D.new()
		p.name = "Leaf%d" % i
		p.emitting = false
		p.local_coords = false
		p.amount = PER_EMITTER
		p.lifetime = 7.0
		p.explosiveness = 0.0
		p.randomness = 0.8
		p.draw_order = CPUParticles3D.DRAW_ORDER_VIEW_DEPTH
		p.mesh = AmbientAssets.unit_quad()
		p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
		p.emission_box_extents = BOX_EXTENTS
		p.direction = Vector3(0, -1, 0)
		p.spread = 25.0
		p.initial_velocity_min = 0.05
		p.initial_velocity_max = 0.35
		p.gravity = Vector3(0, -0.75, 0)
		p.damping_min = 0.15
		p.damping_max = 0.45
		p.angle_min = -180.0
		p.angle_max = 180.0
		p.angular_velocity_min = -70.0
		p.angular_velocity_max = 70.0
		p.tangential_accel_min = -0.25
		p.tangential_accel_max = 0.25
		p.scale_amount_min = 0.30
		p.scale_amount_max = 0.52
		p.material_override = AmbientAssets.particle_material(AmbientAssets.leaf_mask(), false)
		var ramp := Gradient.new()
		ramp.offsets = PackedFloat32Array([0.0, 0.12, 0.8, 1.0])
		ramp.colors = PackedColorArray([
			Color(1, 1, 1, 0.0), Color(1, 1, 1, 1.0), Color(1, 1, 1, 1.0), Color(1, 1, 1, 0.0)])
		p.color_ramp = ramp
		add_child(p)
		emitters.append(p)
	anchors.resize(emitters.size())
	for i in anchors.size():
		anchors[i] = Vector3(0, -9999, 0)

## What this field really costs: only emitters that found a canopy hold quads.
func quad_cost() -> int:
	return parked_count() * PER_EMITTER

## Emitters currently hanging under a canopy (the honest number for the budget and the profile).
func parked_count() -> int:
	var n := 0
	for i in anchors.size():
		if anchors[i].y > -9000.0:
			n += 1
	return n

## Emitters actually shedding leaves right now.
func emitting_count() -> int:
	var n := 0
	for p in emitters:
		if p.emitting:
			n += 1
	return n

## Number of emitters allowed to run at once (budget driven). Emitters past the ceiling are
## unparked, so they stop emitting and stop being charged for.
func set_permitted(n: int) -> void:
	permitted = clampi(n, 0, emitters.size())
	for i in emitters.size():
		if i >= permitted:
			unpark(i)

## Park emitter `i` under a canopy and start it shedding.
##
## Writing `amount` or `lifetime` on a CPUParticles3D reallocates its particle array and throws
## every leaf in the air away, so those two are only touched when the emitter is re-anchored (and
## only when the value really changed). The per-tick wind refresh goes through `set_wind`.
func park(i: int, pos: Vector3, color: Color, rate: float, wind: Vector2, wind_gust: float) -> void:
	if i < 0 or i >= emitters.size():
		return
	var p := emitters[i]
	anchors[i] = pos
	p.global_position = pos
	p.color = color
	var life := clampf(9.0 - wind_gust * 3.0, 4.5, 9.0)
	var want := clampi(int(ceil(maxf(rate, 0.05) * life)), 1, PER_EMITTER)
	if absf(p.lifetime - life) > 0.5:
		p.lifetime = life
	if p.amount != want:
		p.amount = want
	set_wind(i, wind, wind_gust)
	p.emitting = true

## Recolour a parked emitter without restarting it: the real colour of a leaf species can arrive
## a tick after the emitter was parked (see AmbientLife._hot_leaf_color). Writing `color` does not
## touch the particle array, so nothing already in the air is lost.
func set_color(i: int, color: Color) -> void:
	if i < 0 or i >= emitters.size():
		return
	emitters[i].color = color

## Cheap per-tick refresh: drift direction and tumble only, so a gust shows up immediately
## without restarting the emitter.
func set_wind(i: int, wind: Vector2, wind_gust: float) -> void:
	if i < 0 or i >= emitters.size():
		return
	var p := emitters[i]
	var push := 0.35 + wind_gust * 1.4
	p.gravity = Vector3(wind.x * push, -0.75 - wind_gust * 0.35, wind.y * push)
	p.angular_velocity_min = -70.0 - wind_gust * 120.0
	p.angular_velocity_max = 70.0 + wind_gust * 120.0

func anchor_of(i: int) -> Vector3:
	return anchors[i] if i >= 0 and i < anchors.size() else Vector3(0, -9999, 0)

func is_parked(i: int) -> bool:
	return i >= 0 and i < anchors.size() and anchors[i].y > -9000.0

## Stop emitter `i` and forget its anchor (no canopy in reach, or the budget shrank).
func unpark(i: int) -> void:
	if i < 0 or i >= emitters.size():
		return
	if emitters[i].emitting:
		emitters[i].emitting = false
	anchors[i] = Vector3(0, -9999, 0)

func stop_all() -> void:
	for i in emitters.size():
		unpark(i)
	permitted = 0
