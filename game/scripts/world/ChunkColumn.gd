class_name ChunkColumn
extends RefCounted
## One 16 x 128 x 16 column of voxels (see docs/ARCHITECTURE.md §4).
##
## Layout: local index = x + 16 * (z + 16 * y) so every 16-high section is a contiguous
## 4096-byte range starting at section * 4096.
##
## blocks : numeric block id per cell
## meta   : fluid level/falling, crop stage, rotation (see BlockShapes for the bit layout)
## light  : high nibble = sky light, low nibble = block light
## The PackedByteArrays are copy-on-write, so a worker thread that keeps a local reference
## sees an immutable snapshot even if the main thread edits the column afterwards.

enum { EMPTY, GENERATED, DECORATED, LIT, MESHED }

const CHUNK := WorldConst.CHUNK
const HEIGHT := WorldConst.HEIGHT
const SECTIONS := WorldConst.SECTIONS
const ALL_SECTIONS := 255            # (1 << SECTIONS) - 1

var cx: int = 0
var cz: int = 0
var blocks := PackedByteArray()
var meta := PackedByteArray()
var light := PackedByteArray()
var heightmap := PackedByteArray()
var biomes := PackedByteArray()
var state: int = EMPTY
var dirty_sections: int = 0
var modified := false
var entities_pending: Array = []
var structure_marks: Array = []
## Sections currently queued/being meshed on a worker thread.
var meshing_sections: int = 0
## Set when the column was restored from disk (generation is skipped).
var from_disk := false
## Section index -> MeshInstance3D (owned by ChunkManager).
var mesh_nodes: Dictionary = {}
var fluid_ticks: Dictionary = {}

func _init(p_cx := 0, p_cz := 0) -> void:
	cx = p_cx
	cz = p_cz
	blocks.resize(WorldConst.COLUMN_VOLUME)
	meta.resize(WorldConst.COLUMN_VOLUME)
	light.resize(WorldConst.COLUMN_VOLUME)
	heightmap.resize(256)
	biomes.resize(256)

func origin() -> Vector3i:
	return Vector3i(cx * CHUNK, 0, cz * CHUNK)

func key() -> Vector2i:
	return Vector2i(cx, cz)

# --- blocks ----------------------------------------------------------------

func get_block(lx: int, y: int, lz: int) -> int:
	if y < 0 or y >= HEIGHT:
		return 0
	return blocks[lx + 16 * (lz + 16 * y)]

func set_block(lx: int, y: int, lz: int, id: int) -> void:
	if y < 0 or y >= HEIGHT:
		return
	blocks[lx + 16 * (lz + 16 * y)] = id

func get_meta(lx: int, y: int, lz: int) -> int:
	if y < 0 or y >= HEIGHT:
		return 0
	return meta[lx + 16 * (lz + 16 * y)]

func set_meta(lx: int, y: int, lz: int, v: int) -> void:
	if y < 0 or y >= HEIGHT:
		return
	meta[lx + 16 * (lz + 16 * y)] = v & 255

func set_cell(lx: int, y: int, lz: int, id: int, m := 0) -> void:
	if y < 0 or y >= HEIGHT:
		return
	var i := lx + 16 * (lz + 16 * y)
	blocks[i] = id
	meta[i] = m & 255

# --- light -----------------------------------------------------------------

func get_sky_light(lx: int, y: int, lz: int) -> int:
	if y < 0:
		return 0
	if y >= HEIGHT:
		return 15
	return light[lx + 16 * (lz + 16 * y)] >> 4

func get_block_light(lx: int, y: int, lz: int) -> int:
	if y < 0 or y >= HEIGHT:
		return 0
	return light[lx + 16 * (lz + 16 * y)] & 15

func set_sky_light(lx: int, y: int, lz: int, v: int) -> void:
	if y < 0 or y >= HEIGHT:
		return
	var i := lx + 16 * (lz + 16 * y)
	light[i] = (light[i] & 0x0F) | ((v & 15) << 4)

func set_block_light(lx: int, y: int, lz: int, v: int) -> void:
	if y < 0 or y >= HEIGHT:
		return
	var i := lx + 16 * (lz + 16 * y)
	light[i] = (light[i] & 0xF0) | (v & 15)

# --- heightmap / biomes ----------------------------------------------------

func get_height(lx: int, lz: int) -> int:
	return heightmap[lx + 16 * lz]

func biome_index(lx: int, lz: int) -> int:
	return biomes[lx + 16 * lz]

func set_biome(lx: int, lz: int, idx: int) -> void:
	biomes[lx + 16 * lz] = idx & 255

func recompute_heightmap() -> void:
	for lz in 16:
		for lx in 16:
			var top := 0
			for y in range(HEIGHT - 1, -1, -1):
				if blocks[lx + 16 * (lz + 16 * y)] != 0:
					top = y + 1
					break
			heightmap[lx + 16 * lz] = top

func update_height_at(lx: int, lz: int) -> void:
	var top := 0
	for y in range(HEIGHT - 1, -1, -1):
		if blocks[lx + 16 * (lz + 16 * y)] != 0:
			top = y + 1
			break
	heightmap[lx + 16 * lz] = top

func max_height() -> int:
	var m := 0
	for i in 256:
		if heightmap[i] > m:
			m = heightmap[i]
	return m

# --- dirty tracking --------------------------------------------------------

func mark_dirty(section: int) -> void:
	if section >= 0 and section < SECTIONS:
		dirty_sections |= 1 << section

func mark_dirty_y(y: int) -> void:
	mark_dirty(y >> 4)

func mark_all_dirty() -> void:
	dirty_sections = ALL_SECTIONS

func clear_dirty(section: int) -> void:
	dirty_sections &= ~(1 << section)

func is_dirty(section: int) -> bool:
	return (dirty_sections & (1 << section)) != 0

func section_is_empty(section: int) -> bool:
	var base := section * WorldConst.SECTION_VOLUME
	for i in range(base, base + WorldConst.SECTION_VOLUME):
		if blocks[i] != 0:
			return false
	return true

# --- serialisation ---------------------------------------------------------

## blocks + meta + biomes, ready for DEFLATE (light is recomputed on load).
func pack() -> PackedByteArray:
	var out := PackedByteArray()
	out.append_array(blocks)
	out.append_array(meta)
	out.append_array(biomes)
	return out

func unpack(data: PackedByteArray) -> bool:
	var need := WorldConst.COLUMN_VOLUME * 2 + 256
	if data.size() < need:
		return false
	blocks = data.slice(0, WorldConst.COLUMN_VOLUME)
	meta = data.slice(WorldConst.COLUMN_VOLUME, WorldConst.COLUMN_VOLUME * 2)
	biomes = data.slice(WorldConst.COLUMN_VOLUME * 2, need)
	light.resize(WorldConst.COLUMN_VOLUME)
	recompute_heightmap()
	return true
