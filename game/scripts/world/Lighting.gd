class_name Lighting
## Voxel light: sky-light flood fill + block-light BFS.
##
## Sky light: 15 in cells with open sky, minus `light_attenuation` of every block the sunlight
## passes through (water = 2, cutout cubes like leaves = 1), then a lateral flood fill losing
## one level per block. Opaque blocks stop it.
## Block light: BFS from every emissive block (`light` in blocks.json), one level per block.
##
## `compute_column` runs on the generation worker thread (the column is not published yet).
## `merge_borders` and `relight` run on the main thread and are budgeted.

const HEIGHT := WorldConst.HEIGHT
const MAX_LIGHT := 15
## Safety caps so a pathological edit can never stall a frame.
const ADD_BUDGET := 24000
const REMOVE_BUDGET := 24000

# --- full column (worker thread) -------------------------------------------

static func compute_column(col: ChunkColumn) -> void:
	var blocks: PackedByteArray = col.blocks
	var lt := PackedByteArray()
	lt.resize(WorldConst.COLUMN_VOLUME)
	var opaque: PackedByteArray = BlockTable.opaque
	var atten: PackedByteArray = BlockTable.atten
	var emit: PackedByteArray = BlockTable.light
	# 1. Direct sky light straight down each vertical column.
	var queue := PackedInt32Array()
	for lz in 16:
		for lx in 16:
			var base := lx + 16 * lz
			var level := MAX_LIGHT
			for y in range(HEIGHT - 1, -1, -1):
				var i := base + 256 * y
				var id := blocks[i]
				if opaque[id] == 1:
					break
				lt[i] = level << 4
				if level > 1:
					queue.append(i)
				level -= atten[id]
				if level <= 0:
					level = 0
					break
	# 2. Lateral sky flood.
	_flood_local(lt, blocks, queue, true, opaque, atten)
	# 3. Block light from emissive blocks.
	queue.clear()
	for i in WorldConst.COLUMN_VOLUME:
		var e := emit[blocks[i]]
		if e > 0:
			lt[i] = (lt[i] & 0xF0) | e
			queue.append(i)
	_flood_local(lt, blocks, queue, false, opaque, atten)
	col.light = lt

## BFS inside a single column; cells outside the column are handled by merge_borders().
static func _flood_local(lt: PackedByteArray, blocks: PackedByteArray, queue: PackedInt32Array,
		sky: bool, opaque: PackedByteArray, atten: PackedByteArray) -> void:
	var head := 0
	while head < queue.size():
		var i := queue[head]
		head += 1
		var level := (lt[i] >> 4) if sky else (lt[i] & 15)
		if level <= 1:
			continue
		var x := i & 15
		var z := (i >> 4) & 15
		var y := i >> 8
		for f in 6:
			var nx := x
			var ny := y
			var nz := z
			match f:
				0: nx += 1
				1: nx -= 1
				2: ny += 1
				3: ny -= 1
				4: nz += 1
				_: nz -= 1
			if nx < 0 or nx > 15 or nz < 0 or nz > 15 or ny < 0 or ny >= HEIGHT:
				continue
			var j := nx + 16 * (nz + 16 * ny)
			var nid := blocks[j]
			if opaque[nid] == 1:
				continue
			var want := level - 1 - atten[nid]
			if want <= 0:
				continue
			var cur := (lt[j] >> 4) if sky else (lt[j] & 15)
			if cur >= want:
				continue
			if sky:
				lt[j] = (lt[j] & 0x0F) | (want << 4)
			else:
				lt[j] = (lt[j] & 0xF0) | want
			queue.append(j)

# --- cross-chunk borders (main thread) -------------------------------------

## Push light from/into the four horizontal neighbours of `col` once they are all loaded.
## Only cells whose light differs by more than one level across the border become seeds, and
## only up to the highest terrain of the two columns (above that both sides are open sky).
static func merge_borders(world: Node, col: ChunkColumn) -> void:
	var seeds_sky: Array[Vector3i] = []
	var seeds_blk: Array[Vector3i] = []
	for side in 4:
		var n: ChunkColumn = null
		match side:
			0: n = world.get_column(col.cx + 1, col.cz)
			1: n = world.get_column(col.cx - 1, col.cz)
			2: n = world.get_column(col.cx, col.cz + 1)
			_: n = world.get_column(col.cx, col.cz - 1)
		if n == null or n.state < ChunkColumn.LIT:
			continue
		var la: PackedByteArray = col.light
		var lb: PackedByteArray = n.light
		var top: int = mini(HEIGHT - 1, maxi(col.max_height(), n.max_height()) + 1)
		for y in range(top, -1, -1):
			var row := 256 * y
			for t in 16:
				var ia := 0
				var ib := 0
				var ax := 0
				var az := 0
				var bx := 0
				var bz := 0
				match side:
					0:
						ax = 15; az = t; bx = 0; bz = t
					1:
						ax = 0; az = t; bx = 15; bz = t
					2:
						ax = t; az = 15; bx = t; bz = 0
					_:
						ax = t; az = 0; bx = t; bz = 15
				ia = row + ax + 16 * az
				ib = row + bx + 16 * bz
				var pa := la[ia]
				var pb := lb[ib]
				if pa == pb:
					continue
				var wax := col.cx * 16 + ax
				var waz := col.cz * 16 + az
				var wbx := n.cx * 16 + bx
				var wbz := n.cz * 16 + bz
				var sa := pa >> 4
				var sb := pb >> 4
				if sa > sb + 1:
					seeds_sky.append(Vector3i(wax, y, waz))
				elif sb > sa + 1:
					seeds_sky.append(Vector3i(wbx, y, wbz))
				var ba := pa & 15
				var bb := pb & 15
				if ba > bb + 1:
					seeds_blk.append(Vector3i(wax, y, waz))
				elif bb > ba + 1:
					seeds_blk.append(Vector3i(wbx, y, wbz))
	if not seeds_sky.is_empty():
		flood_add(world, seeds_sky, true)
	if not seeds_blk.is_empty():
		flood_add(world, seeds_blk, false)

# --- incremental relight (main thread) -------------------------------------

## Relight after a single block change. Bounded: never spends more than the flood budgets.
static func relight(world: Node, x: int, y: int, z: int, old_id: int, new_id: int) -> void:
	var old_emit: int = BlockTable.light[old_id] if old_id < BlockTable.count else 0
	var new_emit: int = BlockTable.light[new_id] if new_id < BlockTable.count else 0
	# --- block light ---
	var cur := world.get_block_light(x, y, z)
	var add_seeds: Array[Vector3i] = []
	if cur > new_emit or BlockTable.is_opaque(new_id):
		var removed := flood_remove(world, [Vector3i(x, y, z)], false)
		add_seeds.append_array(removed)
	if new_emit > 0:
		world.set_block_light(x, y, z, new_emit)
		add_seeds.append(Vector3i(x, y, z))
	for f in 6:
		var d: Vector3i = BlockShapes.FACE_DIR[f]
		add_seeds.append(Vector3i(x + d.x, y + d.y, z + d.z))
	flood_add(world, add_seeds, false)
	# --- sky light: recompute the vertical run of this (x, z) column ---
	var sky_remove: Array[Vector3i] = []
	var sky_add: Array[Vector3i] = []
	var level := MAX_LIGHT
	var blocked := false
	for yy in range(HEIGHT - 1, -1, -1):
		var id := world.get_block(x, yy, z)
		var want := 0
		if blocked or BlockTable.is_opaque(id):
			blocked = true
			want = 0
		else:
			want = level
			level -= BlockTable.atten[id] if id < BlockTable.count else 0
			if level < 0:
				level = 0
		var have := world.get_sky_light(x, yy, z)
		if want > have:
			world.set_sky_light(x, yy, z, want)
			sky_add.append(Vector3i(x, yy, z))
		elif want < have and blocked:
			sky_remove.append(Vector3i(x, yy, z))
	if not sky_remove.is_empty():
		sky_add.append_array(flood_remove(world, sky_remove, true))
	for f in 6:
		var d: Vector3i = BlockShapes.FACE_DIR[f]
		sky_add.append(Vector3i(x + d.x, y + d.y, z + d.z))
	flood_add(world, sky_add, true)

## Clear the light of a region reachable from `seeds` and return the cells that can refill it.
static func flood_remove(world: Node, seeds: Array, sky: bool) -> Array[Vector3i]:
	var refill: Array[Vector3i] = []
	var q: Array[Vector3i] = []
	var lv: PackedInt32Array = PackedInt32Array()
	for s in seeds:
		var p: Vector3i = s
		var l: int = world.get_sky_light(p.x, p.y, p.z) if sky else world.get_block_light(p.x, p.y, p.z)
		if l <= 0:
			continue
		if sky:
			world.set_sky_light(p.x, p.y, p.z, 0)
		else:
			world.set_block_light(p.x, p.y, p.z, 0)
		q.append(p)
		lv.append(l)
	var head := 0
	var steps := 0
	while head < q.size() and steps < REMOVE_BUDGET:
		var p: Vector3i = q[head]
		var level: int = lv[head]
		head += 1
		steps += 1
		for f in 6:
			var d: Vector3i = BlockShapes.FACE_DIR[f]
			var n := Vector3i(p.x + d.x, p.y + d.y, p.z + d.z)
			if n.y < 0 or n.y >= HEIGHT:
				continue
			var nl: int = world.get_sky_light(n.x, n.y, n.z) if sky else world.get_block_light(n.x, n.y, n.z)
			if nl == 0:
				continue
			if nl < level:
				if sky:
					world.set_sky_light(n.x, n.y, n.z, 0)
				else:
					world.set_block_light(n.x, n.y, n.z, 0)
				q.append(n)
				lv.append(nl)
			else:
				refill.append(n)
	return refill

## Spread light outwards from `seeds` (their current level is taken as given).
static func flood_add(world: Node, seeds: Array, sky: bool) -> void:
	var q: Array[Vector3i] = []
	for s in seeds:
		q.append(s)
	var head := 0
	var steps := 0
	while head < q.size() and steps < ADD_BUDGET:
		var p: Vector3i = q[head]
		head += 1
		steps += 1
		var level: int = world.get_sky_light(p.x, p.y, p.z) if sky else world.get_block_light(p.x, p.y, p.z)
		if level <= 1:
			continue
		for f in 6:
			var d: Vector3i = BlockShapes.FACE_DIR[f]
			var n := Vector3i(p.x + d.x, p.y + d.y, p.z + d.z)
			if n.y < 0 or n.y >= HEIGHT:
				continue
			var nid := world.get_block_raw(n.x, n.y, n.z)
			if nid < 0:
				continue        # unloaded column
			if BlockTable.is_opaque(nid):
				continue
			var want := level - 1 - BlockTable.atten[nid]
			if want <= 0:
				continue
			var cur: int = world.get_sky_light(n.x, n.y, n.z) if sky else world.get_block_light(n.x, n.y, n.z)
			if cur >= want:
				continue
			if sky:
				world.set_sky_light(n.x, n.y, n.z, want)
			else:
				world.set_block_light(n.x, n.y, n.z, want)
			q.append(n)
