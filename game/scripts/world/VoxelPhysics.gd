class_name VoxelPhysics
## Voxel collision: the physics engine is "Dummy", so every AABB sweep happens here
## (docs/ARCHITECTURE.md §4). All functions are static and side-effect free.

const EPS := 0.0005
const STEP_UP := 0.51

## Per-axis swept move. Returns
## {aabb, motion_done, on_ground, hit_x, hit_y, hit_z, stepped}.
static func move_aabb(world: Node, aabb: AABB, motion: Vector3, step_height := 0.0) -> Dictionary:
	var box := aabb
	var done := Vector3.ZERO
	var hit_x := false
	var hit_y := false
	var hit_z := false
	var on_ground := false
	# Y first so walking off a ledge and standing on slabs behaves.
	if motion.y != 0.0:
		var dy := _sweep(world, box, 1, motion.y)
		box.position.y += dy
		done.y = dy
		if absf(dy - motion.y) > EPS:
			hit_y = true
			if motion.y < 0.0:
				on_ground = true
	else:
		on_ground = _on_ground(world, box)
	var dx := _sweep(world, box, 0, motion.x)
	var dz := _sweep(world, box, 2, motion.z)
	var blocked := absf(dx - motion.x) > EPS or absf(dz - motion.z) > EPS
	var stepped := false
	if blocked and step_height > 0.0 and on_ground:
		# Try again from step_height above; if that clears, drop back down onto the step.
		var up := box
		var rise := _sweep(world, up, 1, step_height)
		if rise > EPS:
			up.position.y += rise
			var sx := _sweep(world, up, 0, motion.x)
			var sz := _sweep(world, up, 2, motion.z)
			if absf(sx) + absf(sz) > absf(dx) + absf(dz) + EPS:
				up.position.x += sx
				up.position.z += sz
				var drop := _sweep(world, up, 1, -rise)
				up.position.y += drop
				box = up
				done.x = sx
				done.z = sz
				done.y += rise + drop
				stepped = true
				hit_x = absf(sx - motion.x) > EPS
				hit_z = absf(sz - motion.z) > EPS
	if not stepped:
		box.position.x += dx
		box.position.z += dz
		done.x = dx
		done.z = dz
		hit_x = absf(dx - motion.x) > EPS
		hit_z = absf(dz - motion.z) > EPS
	return {
		"aabb": box, "motion_done": done, "on_ground": on_ground,
		"hit_x": hit_x, "hit_y": hit_y, "hit_z": hit_z, "stepped": stepped,
	}

static func _on_ground(world: Node, box: AABB) -> bool:
	var probe := box
	probe.position.y -= 0.02
	probe.size.y = 0.02
	return aabb_intersects_solid(world, probe)

## Largest distance the box can travel along `axis` (0 = x, 1 = y, 2 = z).
static func _sweep(world: Node, box: AABB, axis: int, d: float) -> float:
	if d == 0.0:
		return 0.0
	var swept := box
	if d > 0.0:
		swept.size[axis] += d
	else:
		swept.position[axis] += d
		swept.size[axis] -= d
	var x0 := int(floor(swept.position.x - EPS))
	var x1 := int(floor(swept.position.x + swept.size.x + EPS))
	var y0 := int(floor(swept.position.y - EPS))
	var y1 := int(floor(swept.position.y + swept.size.y + EPS))
	var z0 := int(floor(swept.position.z - EPS))
	var z1 := int(floor(swept.position.z + swept.size.z + EPS))
	var best := d
	for y in range(y0, y1 + 1):
		for z in range(z0, z1 + 1):
			for x in range(x0, x1 + 1):
				var id := world.get_block(x, y, z)
				if id == 0 or BlockTable.solid[id] == 0:
					continue
				var boxes := BlockShapes.collision_boxes(id, world.get_meta(x, y, z))
				for b in boxes:
					var wb: AABB = AABB(Vector3(x, y, z) + b.position, b.size)
					if not _overlaps_other_axes(box, wb, axis):
						continue
					if d > 0.0:
						var gap: float = wb.position[axis] - (box.position[axis] + box.size[axis])
						if gap >= -EPS and gap < best:
							best = maxf(0.0, gap - EPS)
					else:
						var gap2: float = (wb.position[axis] + wb.size[axis]) - box.position[axis]
						if gap2 <= EPS and gap2 > best:
							best = minf(0.0, gap2 + EPS)
	return best

static func _overlaps_other_axes(a: AABB, b: AABB, axis: int) -> bool:
	for i in 3:
		if i == axis:
			continue
		if a.position[i] + a.size[i] <= b.position[i] + EPS:
			return false
		if b.position[i] + b.size[i] <= a.position[i] + EPS:
			return false
	return true

static func aabb_intersects_solid(world: Node, box: AABB) -> bool:
	var x0 := int(floor(box.position.x))
	var x1 := int(floor(box.position.x + box.size.x))
	var y0 := int(floor(box.position.y))
	var y1 := int(floor(box.position.y + box.size.y))
	var z0 := int(floor(box.position.z))
	var z1 := int(floor(box.position.z + box.size.z))
	for y in range(y0, y1 + 1):
		for z in range(z0, z1 + 1):
			for x in range(x0, x1 + 1):
				var id := world.get_block(x, y, z)
				if id == 0 or BlockTable.solid[id] == 0:
					continue
				for b in BlockShapes.collision_boxes(id, world.get_meta(x, y, z)):
					var wb := AABB(Vector3(x, y, z) + b.position, b.size)
					if _intersects(box, wb):
						return true
	return false

static func _intersects(a: AABB, b: AABB) -> bool:
	for i in 3:
		if a.position[i] + a.size[i] <= b.position[i] + EPS:
			return false
		if b.position[i] + b.size[i] <= a.position[i] + EPS:
			return false
	return true

## Is there a climbable block (ladder/vine) overlapping the box?
static func is_on_ladder(world: Node, box: AABB) -> bool:
	var x0 := int(floor(box.position.x))
	var x1 := int(floor(box.position.x + box.size.x))
	var y0 := int(floor(box.position.y))
	var y1 := int(floor(box.position.y + box.size.y))
	var z0 := int(floor(box.position.z))
	var z1 := int(floor(box.position.z + box.size.z))
	for y in range(y0, y1 + 1):
		for z in range(z0, z1 + 1):
			for x in range(x0, x1 + 1):
				var id := world.get_block(x, y, z)
				if id > 0 and BlockTable.climbable[id] == 1:
					return true
	return false

## Liquid state of a box: {in_liquid, submerged_fraction, flow: Vector3, lava: bool, id: int}
static func fluid_at(world: Node, box: AABB) -> Dictionary:
	var x0 := int(floor(box.position.x))
	var x1 := int(floor(box.position.x + box.size.x))
	var y0 := int(floor(box.position.y))
	var y1 := int(floor(box.position.y + box.size.y))
	var z0 := int(floor(box.position.z))
	var z1 := int(floor(box.position.z + box.size.z))
	var volume := maxf(box.size.x * box.size.y * box.size.z, 0.0001)
	var submerged := 0.0
	var flow := Vector3.ZERO
	var samples := 0
	var lava := false
	var fid := 0
	for y in range(y0, y1 + 1):
		for z in range(z0, z1 + 1):
			for x in range(x0, x1 + 1):
				var id := world.get_block(x, y, z)
				if id == 0 or BlockTable.liquid[id] == 0:
					continue
				fid = id
				if BlockTable.lava[id] == 1:
					lava = true
				var lvl := world.get_meta(x, y, z) & BlockShapes.META_LEVEL
				if lvl == 0:
					lvl = 8
				var h := 1.0 if (world.get_block(x, y + 1, z) == id) else BlockShapes.liquid_height(lvl)
				var cell := AABB(Vector3(x, y, z), Vector3(1, h, 1))
				var inter := box.intersection(cell)
				if inter.size.x > 0.0 and inter.size.y > 0.0 and inter.size.z > 0.0:
					submerged += inter.size.x * inter.size.y * inter.size.z
				if world.has_method("flow_at"):
					flow += world.flow_at(x, y, z)
					samples += 1
	if samples > 0:
		flow /= float(samples)
	return {
		"in_liquid": submerged > 0.0, "submerged_fraction": clampf(submerged / volume, 0.0, 1.0),
		"flow": flow, "lava": lava, "id": fid,
	}

## Voxel DDA raycast. Returns {hit, block, normal, point, dist, id}.
static func raycast(world: Node, origin: Vector3, dir: Vector3, max_dist: float, ignore_liquid := true) -> Dictionary:
	var miss := {"hit": false, "block": Vector3i.ZERO, "normal": Vector3i.ZERO, "point": origin, "dist": 0.0, "id": 0}
	if dir.length_squared() < 0.000001:
		return miss
	var d := dir.normalized()
	var x := int(floor(origin.x))
	var y := int(floor(origin.y))
	var z := int(floor(origin.z))
	var step_x := 1 if d.x > 0.0 else -1
	var step_y := 1 if d.y > 0.0 else -1
	var step_z := 1 if d.z > 0.0 else -1
	var inf := 1.0e30
	var tdx := inf if absf(d.x) < 0.000001 else absf(1.0 / d.x)
	var tdy := inf if absf(d.y) < 0.000001 else absf(1.0 / d.y)
	var tdz := inf if absf(d.z) < 0.000001 else absf(1.0 / d.z)
	var next_x := (float(x + 1) - origin.x) / d.x if absf(d.x) > 0.000001 else inf
	var next_y := (float(y + 1) - origin.y) / d.y if absf(d.y) > 0.000001 else inf
	var next_z := (float(z + 1) - origin.z) / d.z if absf(d.z) > 0.000001 else inf
	if d.x < 0.0 and absf(d.x) > 0.000001:
		next_x = (origin.x - float(x)) / -d.x
	if d.y < 0.0 and absf(d.y) > 0.000001:
		next_y = (origin.y - float(y)) / -d.y
	if d.z < 0.0 and absf(d.z) > 0.000001:
		next_z = (origin.z - float(z)) / -d.z
	var t := 0.0
	var normal := Vector3i.ZERO
	for _step in 256:
		var id := world.get_block(x, y, z)
		var hit := id != 0
		if hit and ignore_liquid and BlockTable.liquid[id] == 1:
			hit = false
		if hit and BlockTable.shape[id] == BlockTable.Shape.NONE:
			hit = false
		if hit:
			return {
				"hit": true, "block": Vector3i(x, y, z), "normal": normal,
				"point": origin + d * t, "dist": t, "id": id,
			}
		if next_x < next_y and next_x < next_z:
			t = next_x
			if t > max_dist:
				break
			x += step_x
			next_x += tdx
			normal = Vector3i(-step_x, 0, 0)
		elif next_y < next_z:
			t = next_y
			if t > max_dist:
				break
			y += step_y
			next_y += tdy
			normal = Vector3i(0, -step_y, 0)
		else:
			t = next_z
			if t > max_dist:
				break
			z += step_z
			next_z += tdz
			normal = Vector3i(0, 0, -step_z)
		if t > max_dist:
			break
	return miss
