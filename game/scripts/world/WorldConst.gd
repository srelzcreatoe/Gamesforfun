class_name WorldConst
## Shared voxel-world constants (see docs/ARCHITECTURE.md §4). Do not change without updating every user.

const CHUNK := 16
const HEIGHT := 128
const SECTIONS := 8                 # HEIGHT / 16
const SECTION_VOLUME := 4096        # 16 * 16 * 16
const COLUMN_VOLUME := 32768        # 16 * 128 * 16
const SEA_LEVEL := 62
const MAX_LIGHT := 15
const TICKS_PER_DAY := 24000.0
const DAY_SECONDS := 1200.0         # 20 real minutes per day
const REACH := 4.6

## Local column index (y-major so each 16-high section is a contiguous 4096-byte range).
static func index(x: int, y: int, z: int) -> int:
	return x + 16 * (z + 16 * y)

static func section_of(y: int) -> int:
	return y >> 4

static func floor_div(a: int, b: int) -> int:
	return int(floor(float(a) / float(b)))

static func chunk_coord(v: int) -> int:
	return v >> 4

static func local_coord(v: int) -> int:
	return v & 15

## Face indices used by meshing/textures: 0=+X east 1=-X west 2=+Y top 3=-Y bottom 4=+Z south 5=-Z north
const FACE_NORMALS: Array[Vector3i] = [Vector3i(1, 0, 0), Vector3i(-1, 0, 0), Vector3i(0, 1, 0), Vector3i(0, -1, 0), Vector3i(0, 0, 1), Vector3i(0, 0, -1)]
