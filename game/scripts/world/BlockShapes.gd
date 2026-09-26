class_name BlockShapes
## Static geometry tables shared by ChunkMesher and VoxelPhysics.
##
## Meta byte layout (see ChunkColumn):
##   liquids : bits 0-3 = level (8 = source, 7..1 = flowing, 0 = none), bit 4 = falling
##   crops   : bits 0-2 = growth stage
##   others  : bits 0-1 = facing (0 = +Z south, 1 = -X west, 2 = -Z north, 3 = +X east)
##             bit 2 (4) = open (door/trapdoor), bit 3 (8) = upper half (door)
##
## Face indices everywhere: 0=+X east 1=-X west 2=+Y top 3=-Y bottom 4=+Z south 5=-Z north.
##
## THREAD SAFETY - these tables are `static var`, never `const`.
##
## A GDScript `const` Array/Dictionary is a *read-only* container, and Godot implements
## read-only element access (`operator[]`, and `for x in ...`) by copying the element into ONE
## scratch `Variant` that lives inside the container and returning a reference to it
## (core/variant/array.cpp, dictionary.cpp). Two threads indexing the same `const` at the same
## moment therefore both write that single slot, so one thread frees the Variant the other is
## still copying:
##     ERROR: Condition "!success" is true.   at: _ref (core/variant/array.cpp:61)
## That is the Android crash this class caused: `ChunkMesher` indexes FACE_CORNERS / FACE_DIR /
## FACE_NORMAL once per block face on every mesh worker, and `Decorator` iterates FACE_DIR on
## every generator worker. `static var` containers are not read-only, so their elements are
## returned directly and concurrent reads are safe. tests/test_world_threads.gd locks this in.
## Nothing here is ever written after load, so no mutex is needed - only "not const".

const META_LEVEL := 0x0F
const META_FALLING := 0x10
const META_FACING := 0x03
const META_OPEN := 0x04
const META_UPPER := 0x08

## Vertex corners per face, ordered so Godot's clockwise-front winding faces outwards,
## with uv (0,0) at the top-left of the tile.
static var FACE_CORNERS: Array = [
	# +X east
	[Vector3(1, 1, 1), Vector3(1, 1, 0), Vector3(1, 0, 0), Vector3(1, 0, 1)],
	# -X west
	[Vector3(0, 1, 0), Vector3(0, 1, 1), Vector3(0, 0, 1), Vector3(0, 0, 0)],
	# +Y top
	[Vector3(0, 1, 0), Vector3(1, 1, 0), Vector3(1, 1, 1), Vector3(0, 1, 1)],
	# -Y bottom
	[Vector3(0, 0, 1), Vector3(1, 0, 1), Vector3(1, 0, 0), Vector3(0, 0, 0)],
	# +Z south
	[Vector3(0, 1, 1), Vector3(1, 1, 1), Vector3(1, 0, 1), Vector3(0, 0, 1)],
	# -Z north
	[Vector3(1, 1, 0), Vector3(0, 1, 0), Vector3(0, 0, 0), Vector3(1, 0, 0)],
]
static var FACE_UV: Array = [Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1)]
static var FACE_NORMAL: Array = [
	Vector3(1, 0, 0), Vector3(-1, 0, 0), Vector3(0, 1, 0), Vector3(0, -1, 0), Vector3(0, 0, 1), Vector3(0, 0, -1),
]
static var FACE_DIR: Array = [
	Vector3i(1, 0, 0), Vector3i(-1, 0, 0), Vector3i(0, 1, 0), Vector3i(0, -1, 0), Vector3i(0, 0, 1), Vector3i(0, 0, -1),
]
## Per-face brightness multiplier (the shader applies it, kept here for reference/tests).
static var FACE_LIGHT: Array = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8]
## The four AO / smooth-light levels.
static var AO_LEVELS: Array = [0.55, 0.7, 0.85, 1.0]

static var FACING_DIR: Array = [Vector3i(0, 0, 1), Vector3i(-1, 0, 0), Vector3i(0, 0, -1), Vector3i(1, 0, 0)]
## Face index that a "facing" value points at.
static var FACING_FACE: Array = [4, 1, 5, 0]

## Deterministic position hash (same one Textures uses for variant picks).
static func hash3(x: int, y: int, z: int) -> int:
	var h: int = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791)
	return (h ^ (h >> 13)) & 0x7fffffff

## Stable random horizontal offset for cross-shaped plants, in [-0.19, 0.19].
static func plant_offset(x: int, z: int) -> Vector3:
	var h := hash3(x, 0, z)
	var ox := float((h & 255) / 255.0) - 0.5
	var oz := float(((h >> 8) & 255) / 255.0) - 0.5
	return Vector3(ox * 0.38, 0.0, oz * 0.38)

## Liquid surface height for a level (8 = source).
static func liquid_height(level: int) -> float:
	if level <= 0:
		return 0.0
	return clampf(float(level) * 0.109375, 0.11, 0.875)

## Collision boxes of a block, in local 0..1 space. Empty = no collision.
static func collision_boxes(id: int, meta: int) -> Array:
	if id <= 0 or id >= BlockTable.count:
		return []
	if BlockTable.solid[id] == 0:
		return []
	var sh: int = BlockTable.shape[id]
	match sh:
		BlockTable.Shape.FENCE:
			return [AABB(Vector3.ZERO, Vector3(1, 1.5, 1))]
		BlockTable.Shape.DOOR:
			var open := (meta & META_OPEN) != 0
			var facing := meta & META_FACING
			if open:
				facing = (facing + 1) & 3
			match facing:
				0: return [AABB(Vector3(0, 0, 0.8125), Vector3(1, 1, 0.1875))]
				1: return [AABB(Vector3(0, 0, 0), Vector3(0.1875, 1, 1))]
				2: return [AABB(Vector3(0, 0, 0), Vector3(1, 1, 0.1875))]
				_: return [AABB(Vector3(0.8125, 0, 0), Vector3(0.1875, 1, 1))]
		BlockTable.Shape.TRAPDOOR:
			if (meta & META_OPEN) != 0:
				var facing := meta & META_FACING
				match facing:
					0: return [AABB(Vector3(0, 0, 0.8125), Vector3(1, 1, 0.1875))]
					1: return [AABB(Vector3(0, 0, 0), Vector3(0.1875, 1, 1))]
					2: return [AABB(Vector3(0, 0, 0), Vector3(1, 1, 0.1875))]
					_: return [AABB(Vector3(0.8125, 0, 0), Vector3(0.1875, 1, 1))]
			return [AABB(Vector3.ZERO, Vector3(1, 0.1875, 1))]
		BlockTable.Shape.CACTUS:
			return [AABB(Vector3(0.0625, 0, 0.0625), Vector3(0.875, 1, 0.875))]
		BlockTable.Shape.LADDER:
			return []
	var h: float = BlockTable.height[id]
	if h <= 0.0:
		return []
	return [AABB(Vector3.ZERO, Vector3(1, h, 1))]
