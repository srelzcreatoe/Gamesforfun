class_name Trees
extends RefCounted
## Tree shapes for every biome (docs/briefs/worldgen.md §2/§3).
##
## Every tree is a pure function of its world position and the generator seed, and it is
## stamped through `WorldGen.put_world()`, which clips to the column being generated. A tree
## anchored in a neighbouring chunk is therefore rebuilt identically by both columns and its
## canopy crosses the chunk border seamlessly (no per-column trunk offsets).

const HEIGHT := WorldConst.HEIGHT

## Trunk / leaf blocks per tree type.
const WOOD := {
	"oak": ["oak_log", "oak_leaves"],
	"big_oak": ["oak_log", "oak_leaves"],
	"birch": ["birch_log", "birch_leaves"],
	"spruce": ["spruce_log", "spruce_leaves"],
	"jungle": ["jungle_log", "jungle_leaves"],
	"dark_oak": ["dark_oak_log", "dark_oak_leaves"],
	"acacia": ["acacia_log", "acacia_leaves"],
	"cherry": ["cherry_log", "cherry_leaves"],
	"ajissa": ["ajissa_log", "ajissa_leaves"],
	"sacred": ["sacred_log", "sacred_leaves"],
}

## Stamp one tree. `base` is the first air y above the ground, `hh` a deterministic hash.
static func place(gen: RefCounted, col: ChunkColumn, ctx: RefCounted, kind: String,
		wx: int, base: int, wz: int, hh: int) -> void:
	if base < 2 or base > HEIGHT - 8:
		return
	match kind:
		"cactus":
			_cactus(gen, col, ctx, wx, base, wz, hh)
			return
		"spruce":
			_spruce(gen, col, ctx, wx, base, wz, hh)
			return
		"jungle":
			_jungle(gen, col, ctx, wx, base, wz, hh)
			return
		"dark_oak":
			_dark_oak(gen, col, ctx, wx, base, wz, hh)
			return
		"acacia":
			_acacia(gen, col, ctx, wx, base, wz, hh)
			return
		"cherry":
			_round(gen, col, ctx, "cherry", wx, base, wz, hh, 5, 3, 3, 2)
			return
		"ajissa":
			_ajissa(gen, col, ctx, wx, base, wz, hh)
			return
		"sacred":
			_round(gen, col, ctx, "sacred", wx, base, wz, hh, 6, 3, 3, 3)
			return
		"birch":
			_round(gen, col, ctx, "birch", wx, base, wz, hh, 6, 2, 2, 3)
			return
		"big_oak":
			_big_oak(gen, col, ctx, wx, base, wz, hh)
			return
		_:
			if (hh >> 7) % 14 == 0:
				_big_oak(gen, col, ctx, wx, base, wz, hh)
			else:
				_round(gen, col, ctx, "oak", wx, base, wz, hh, 4, 2, 2, 3)

static func _ids(kind: String) -> Array:
	var pair: Array = WOOD.get(kind, WOOD["oak"])
	return [Registry.block_id(String(pair[0])), Registry.block_id(String(pair[1]))]

## Straight trunk with a rounded canopy (oak / birch / cherry / sacred).
static func _round(gen: RefCounted, col: ChunkColumn, ctx: RefCounted, kind: String,
		wx: int, base: int, wz: int, hh: int, trunk_min: int, radius: int, ry: int, extra: int) -> void:
	var ids := _ids(kind)
	var log_id: int = ids[0]
	var leaf_id: int = ids[1]
	var trunk: int = trunk_min + (hh >> 3) % maxi(1, extra)
	for i in trunk:
		gen.put_world(col, ctx, wx, base + i, wz, log_id)
	var cy := base + trunk - 1
	_ellipsoid(gen, col, ctx, wx, cy, wz, radius, ry, leaf_id, hh)
	gen.put_world(col, ctx, wx, cy + ry, wz, leaf_id, 0, true)

## Tall trunk, two stacked canopies, occasional branches.
static func _big_oak(gen: RefCounted, col: ChunkColumn, ctx: RefCounted,
		wx: int, base: int, wz: int, hh: int) -> void:
	var ids := _ids("oak")
	var log_id: int = ids[0]
	var leaf_id: int = ids[1]
	var trunk: int = 8 + (hh >> 3) % 4
	if base + trunk + 5 >= HEIGHT:
		trunk = maxi(4, HEIGHT - base - 6)
	for i in trunk:
		gen.put_world(col, ctx, wx, base + i, wz, log_id)
	var top := base + trunk
	_ellipsoid(gen, col, ctx, wx, top - 1, wz, 4, 3, leaf_id, hh)
	_ellipsoid(gen, col, ctx, wx, top - 5, wz, 3, 2, leaf_id, hh * 7 + 1)
	# two short branches
	for b in 2:
		var ang := float((hh >> (4 + b * 5)) % 8) * (TAU / 8.0)
		var bx := wx + int(round(cos(ang) * 2.0))
		var bz := wz + int(round(sin(ang) * 2.0))
		var by := top - 4 - b * 2
		gen.put_world(col, ctx, bx, by, bz, log_id, 0, true)
		_ellipsoid(gen, col, ctx, bx, by + 1, bz, 2, 2, leaf_id, hh + b * 31)

## Conifer: layered rings shrinking toward the top.
static func _spruce(gen: RefCounted, col: ChunkColumn, ctx: RefCounted,
		wx: int, base: int, wz: int, hh: int) -> void:
	var ids := _ids("spruce")
	var log_id: int = ids[0]
	var leaf_id: int = ids[1]
	var trunk: int = 8 + (hh >> 3) % 5
	if base + trunk + 3 >= HEIGHT:
		trunk = maxi(5, HEIGHT - base - 4)
	for i in trunk:
		gen.put_world(col, ctx, wx, base + i, wz, log_id)
	var y := base + 2
	var ring := 0
	while y <= base + trunk:
		var r := 2 if (ring % 3) != 2 else 1
		if y > base + trunk - 3:
			r = 1
		for dz in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if dx == 0 and dz == 0:
					continue
				if absi(dx) == r and absi(dz) == r:
					continue
				gen.put_world(col, ctx, wx + dx, y, wz + dz, leaf_id, 0, true)
		y += 1
		ring += 1
	gen.put_world(col, ctx, wx, base + trunk + 1, wz, leaf_id, 0, true)
	gen.put_world(col, ctx, wx, base + trunk, wz, leaf_id, 0, true)

## Jungle: tall, sometimes 2x2 trunk, wide top canopy plus hanging vines.
static func _jungle(gen: RefCounted, col: ChunkColumn, ctx: RefCounted,
		wx: int, base: int, wz: int, hh: int) -> void:
	var ids := _ids("jungle")
	var log_id: int = ids[0]
	var leaf_id: int = ids[1]
	var vine := Registry.block_id("vine")
	var big := (hh % 3) == 0
	var trunk: int = (12 + (hh >> 3) % 7) if big else (6 + (hh >> 3) % 5)
	if base + trunk + 4 >= HEIGHT:
		trunk = maxi(5, HEIGHT - base - 5)
	for i in trunk:
		gen.put_world(col, ctx, wx, base + i, wz, log_id)
		if big:
			gen.put_world(col, ctx, wx + 1, base + i, wz, log_id)
			gen.put_world(col, ctx, wx, base + i, wz + 1, log_id)
			gen.put_world(col, ctx, wx + 1, base + i, wz + 1, log_id)
	var cy := base + trunk - 1
	var r := 4 if big else 3
	_ellipsoid(gen, col, ctx, wx, cy, wz, r, 2, leaf_id, hh)
	if big:
		_ellipsoid(gen, col, ctx, wx + 1, cy - 3, wz + 1, r - 1, 2, leaf_id, hh + 17)
	if vine > 0:
		for v in 6:
			var hv := Terrain.hash_seeded(gen.seed, wx + v, base, wz - v)
			var vx := wx + (hv % (2 * r + 1)) - r
			var vz := wz + ((hv >> 6) % (2 * r + 1)) - r
			var len_v := 2 + (hv >> 12) % 5
			for k in len_v:
				gen.put_world(col, ctx, vx, cy - 1 - k, vz, vine, (hv >> 3) & 3, true)

## Dark oak: thick 2x2 trunk, broad flat canopy.
static func _dark_oak(gen: RefCounted, col: ChunkColumn, ctx: RefCounted,
		wx: int, base: int, wz: int, hh: int) -> void:
	var ids := _ids("dark_oak")
	var log_id: int = ids[0]
	var leaf_id: int = ids[1]
	var trunk: int = 6 + (hh >> 3) % 3
	for i in trunk:
		gen.put_world(col, ctx, wx, base + i, wz, log_id)
		gen.put_world(col, ctx, wx + 1, base + i, wz, log_id)
		gen.put_world(col, ctx, wx, base + i, wz + 1, log_id)
		gen.put_world(col, ctx, wx + 1, base + i, wz + 1, log_id)
	var cy := base + trunk
	_ellipsoid(gen, col, ctx, wx, cy, wz, 4, 2, leaf_id, hh)
	_ellipsoid(gen, col, ctx, wx + 1, cy - 1, wz + 1, 3, 1, leaf_id, hh + 5)

## Acacia: leaning trunk with a flat disc canopy.
static func _acacia(gen: RefCounted, col: ChunkColumn, ctx: RefCounted,
		wx: int, base: int, wz: int, hh: int) -> void:
	var ids := _ids("acacia")
	var log_id: int = ids[0]
	var leaf_id: int = ids[1]
	var trunk: int = 4 + (hh >> 3) % 3
	for i in trunk:
		gen.put_world(col, ctx, wx, base + i, wz, log_id)
	var dir := (hh >> 9) % 4
	var dx := [1, -1, 0, 0][dir]
	var dz := [0, 0, 1, -1][dir]
	var tx := wx
	var tz := wz
	var ty := base + trunk
	for i in 3:
		tx += dx
		tz += dz
		gen.put_world(col, ctx, tx, ty, tz, log_id)
		ty += 1
	# flat canopies
	_disc(gen, col, ctx, tx, ty, tz, 3, leaf_id, hh)
	_disc(gen, col, ctx, wx, base + trunk + 1, wz, 2, leaf_id, hh + 3)

## Namek ajissa: bare trunk with a big bulbous canopy.
static func _ajissa(gen: RefCounted, col: ChunkColumn, ctx: RefCounted,
		wx: int, base: int, wz: int, hh: int) -> void:
	var ids := _ids("ajissa")
	var log_id: int = ids[0]
	var leaf_id: int = ids[1]
	var trunk: int = 7 + (hh >> 3) % 6
	if base + trunk + 7 >= HEIGHT:
		trunk = maxi(4, HEIGHT - base - 8)
	for i in trunk:
		gen.put_world(col, ctx, wx, base + i, wz, log_id)
	var cy := base + trunk + 2
	_ellipsoid(gen, col, ctx, wx, cy, wz, 4, 4, leaf_id, hh)
	_ellipsoid(gen, col, ctx, wx, cy - 3, wz, 2, 1, leaf_id, hh + 11)
	gen.put_world(col, ctx, wx, base + trunk, wz, log_id)
	gen.put_world(col, ctx, wx, base + trunk + 1, wz, log_id)

static func _cactus(gen: RefCounted, col: ChunkColumn, ctx: RefCounted,
		wx: int, base: int, wz: int, hh: int) -> void:
	var cactus := Registry.block_id("cactus")
	if cactus <= 0:
		return
	var n := 2 + (hh >> 3) % 3
	for i in n:
		gen.put_world(col, ctx, wx, base + i, wz, cactus)

## Leaf ellipsoid with hash-trimmed corners, only into air.
static func _ellipsoid(gen: RefCounted, col: ChunkColumn, ctx: RefCounted,
		cx: int, cy: int, cz: int, r: int, ry: int, leaf_id: int, hh: int) -> void:
	if leaf_id <= 0:
		return
	var rf := float(r) + 0.35
	var ryf := float(ry) + 0.35
	for dy in range(-ry, ry + 1):
		for dz in range(-r, r + 1):
			for dx in range(-r, r + 1):
				var fx := float(dx) / rf
				var fy := float(dy) / ryf
				var fz := float(dz) / rf
				var d := fx * fx + fy * fy + fz * fz
				if d > 1.0:
					continue
				if d > 0.62 and (Terrain.hash_seeded(hh, cx + dx, cy + dy, cz + dz) % 5) == 0:
					continue
				gen.put_world(col, ctx, cx + dx, cy + dy, cz + dz, leaf_id, 0, true)

## Flat leaf disc (acacia).
static func _disc(gen: RefCounted, col: ChunkColumn, ctx: RefCounted,
		cx: int, cy: int, cz: int, r: int, leaf_id: int, hh: int) -> void:
	if leaf_id <= 0:
		return
	for dz in range(-r, r + 1):
		for dx in range(-r, r + 1):
			if dx * dx + dz * dz > r * r + 1:
				continue
			if absi(dx) == r and absi(dz) == r:
				continue
			gen.put_world(col, ctx, cx + dx, cy, cz + dz, leaf_id, 0, true)
			if (Terrain.hash_seeded(hh, cx + dx, cy, cz + dz) % 3) == 0:
				gen.put_world(col, ctx, cx + dx, cy + 1, cz + dz, leaf_id, 0, true)
