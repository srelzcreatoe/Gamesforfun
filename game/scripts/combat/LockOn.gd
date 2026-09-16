class_name LockOn
extends RefCounted
## Target acquisition: the nearest *visible* hostile entity inside a cone in front of
## the camera/entity, up to 48 m. Writes `entity.target` (or calls `set_target`) and
## emits `Events.target_changed`; the camera rig and the HUD read it from there.
##
##   LockOn.toggle(Game.player)            # the lock-on button
##   LockOn.acquire(entity) -> Node        # pick and set the best target
##   LockOn.clear(entity)
##   LockOn.nearest(entity, 12.0)          # used by grabs and melee specials
##   LockOn.tick(entity)                   # drop the target when it dies or runs away

const RANGE := 48.0
const CONE_DEGREES := 55.0
## The target is dropped when it leaves this (a bit more than the acquisition cone).
const KEEP_CONE_DEGREES := 100.0
const KEEP_RANGE := 60.0

## Toggle lock-on: acquires when nothing is locked, clears otherwise.
static func toggle(entity: Node) -> Node:
	if current(entity) != null:
		clear(entity)
		return null
	return acquire(entity)

static func current(entity: Node) -> Node:
	if entity == null or not is_instance_valid(entity):
		return null
	if "target" in entity:
		var t: Variant = entity.get("target")
		if t is Node and is_instance_valid(t):
			return t
	return null

static func acquire(entity: Node, range_m := RANGE, cone_deg := CONE_DEGREES) -> Node:
	var best := nearest(entity, range_m, cone_deg)
	_set(entity, best)
	if best != null:
		Audio.play_sfx("lockon", -4.0)
	return best

static func clear(entity: Node) -> void:
	if current(entity) != null:
		_set(entity, null)

## Drop the target when it dies, gets too far or leaves the keep cone.
static func tick(entity: Node) -> void:
	var t := current(entity)
	if t == null:
		return
	if not is_instance_valid(t) or not (t is Node3D):
		_set(entity, null)
		return
	if "health" in t and float(t.get("health")) <= 0.0:
		_set(entity, null)
		return
	if not (entity is Node3D):
		return
	var from := _eye(entity)
	var to: Vector3 = (t as Node3D).global_position + Vector3.UP * 0.9
	if from.distance_to(to) > KEEP_RANGE:
		_set(entity, null)
		return
	var fwd := _forward(entity)
	var ang := rad_to_deg(fwd.angle_to((to - from).normalized()))
	if ang > KEEP_CONE_DEGREES:
		_set(entity, null)

## Best candidate: hostile, alive, inside the cone, line of sight clear; ranked by
## angle first (what the player is looking at) and distance second.
static func nearest(entity: Node, range_m := RANGE, cone_deg := CONE_DEGREES) -> Node:
	if entity == null or not (entity is Node3D):
		return null
	var world := _world(entity)
	if world == null:
		return null
	var list: Array = []
	if world.has_method("entities_in_aabb"):
		var p: Vector3 = (entity as Node3D).global_position
		list = world.call("entities_in_aabb", AABB(p - Vector3.ONE * range_m, Vector3.ONE * range_m * 2.0))
	elif world.has_method("get_entities"):
		list = world.call("get_entities")
	var from := _eye(entity)
	var fwd := _forward(entity)
	var best: Node = null
	var best_score := INF
	for e in list:
		if e == entity or not is_instance_valid(e) or not (e is Node3D):
			continue
		if not is_hostile(entity, e):
			continue
		if "health" in e and float(e.get("health")) <= 0.0:
			continue
		var to: Vector3 = (e as Node3D).global_position + Vector3.UP * 0.9
		var delta := to - from
		var dist := delta.length()
		if dist > range_m or dist < 0.01:
			continue
		var ang := rad_to_deg(fwd.angle_to(delta / dist))
		if ang > cone_deg:
			continue
		if not has_line_of_sight(world, from, to):
			continue
		var score := ang * 1.5 + dist
		if score < best_score:
			best_score = score
			best = e
	return best

## Every entity visible to the ki sense (used by the HUD radar / AI).
static func visible_entities(entity: Node, range_m := RANGE) -> Array[Node]:
	var out: Array[Node] = []
	var world := _world(entity)
	if world == null or not (entity is Node3D):
		return out
	var list: Array = world.call("get_entities") if world.has_method("get_entities") else []
	var from := _eye(entity)
	for e in list:
		if e == entity or not is_instance_valid(e) or not (e is Node3D):
			continue
		if from.distance_to((e as Node3D).global_position) <= range_m:
			out.append(e)
	return out

static func is_hostile(a: Node, b: Node) -> bool:
	if a == null or b == null:
		return false
	if "faction" in a and "faction" in b:
		var x := String(a.get("faction"))
		var y := String(b.get("faction"))
		if x == y and x != "":
			return false
		if (x == "player" and y == "z_fighter") or (x == "z_fighter" and y == "player"):
			return false
		if y == "wild" and x == "player":
			return true
		return true
	return true

static func has_line_of_sight(world: Node, from: Vector3, to: Vector3) -> bool:
	if world == null or not world.has_method("raycast"):
		return true
	var delta := to - from
	var dist := delta.length()
	if dist < 0.05:
		return true
	var hit: Dictionary = world.call("raycast", from, delta / dist, dist, true)
	return not bool(hit.get("hit", false))

# --- internals ------------------------------------------------------------

static func _set(entity: Node, target: Node) -> void:
	if entity == null:
		return
	if entity.has_method("set_target"):
		entity.call("set_target", target)
	elif "target" in entity:
		entity.set("target", target)
	Events.target_changed.emit(target)

static func _world(entity: Node) -> Node:
	if entity != null and "world" in entity:
		var w: Variant = entity.get("world")
		if w is Node and is_instance_valid(w):
			return w
	return Game.world if Game != null else null

static func _eye(entity: Node) -> Vector3:
	if not (entity is Node3D):
		return Vector3.ZERO
	var h := 1.62
	if "aabb_size" in entity:
		var s: Variant = entity.get("aabb_size")
		if s is Vector3:
			h = (s as Vector3).y * 0.9
	return (entity as Node3D).global_position + Vector3.UP * h

static func _forward(entity: Node) -> Vector3:
	return KiEffects.aim_direction(entity)
