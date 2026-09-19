class_name FlatTestGen
extends RefCounted
## Fallback world generator used until scripts/worldgen/WorldGenFactory.gd exists.
##
## Contract (docs/briefs/voxel.md): any object with
##   generate_column(col: ChunkColumn, seed: int, planet: Dictionary) -> void
## can be assigned to `World.generator`. It runs on a WorkerThreadPool thread and may only
## touch the column it was handed (plus read-only registries).
##
## Produces noise hills with stone/dirt/grass, sand beaches, water ponds, oak trees,
## grass/flowers and the odd torch so lighting and every mesh shape get exercised.

const SEA := WorldConst.SEA_LEVEL

var seed: int = 0
var _hills := FastNoiseLite.new()
var _detail := FastNoiseLite.new()
var _ponds := FastNoiseLite.new()
var _ids: Dictionary = {}

func _init(p_seed := 0) -> void:
	set_seed(p_seed)

func set_seed(p_seed: int) -> void:
	seed = p_seed
	_hills.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_hills.seed = p_seed
	_hills.frequency = 0.008
	_hills.fractal_octaves = 4
	_detail.noise_type = FastNoiseLite.TYPE_SIMPLEX
	_detail.seed = p_seed + 7717
	_detail.frequency = 0.045
	_ponds.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_ponds.seed = p_seed + 4242
	_ponds.frequency = 0.014

func _id(name: String) -> int:
	if _ids.has(name):
		return _ids[name]
	var v := Registry.block_id(name)
	if v < 0:
		v = 0
	_ids[name] = v
	return v

func height_at(wx: int, wz: int) -> int:
	var h := float(SEA) + 4.0 + _hills.get_noise_2d(wx, wz) * 9.0 + _detail.get_noise_2d(wx, wz) * 1.5
	var pond := _ponds.get_noise_2d(wx, wz)
	if pond < -0.32:
		h -= (-0.32 - pond) * 26.0
	return clampi(int(round(h)), 4, WorldConst.HEIGHT - 20)

func generate_column(col: ChunkColumn, p_seed: int, planet: Dictionary) -> void:
	if p_seed != seed:
		set_seed(p_seed)
	var stone := _id("stone")
	var dirt := _id("dirt")
	var grass := _id("grass_block")
	var sand := _id("sand")
	var water := _id("water")
	var bedrock := _id("bedrock")
	var gravel := _id("gravel")
	var coal := _id("coal_ore")
	var biome_idx := maxi(0, Registry.biome_index(String(planet.get("default_biome", "plains"))))
	var ox := col.cx * 16
	var oz := col.cz * 16
	for lz in 16:
		for lx in 16:
			var wx := ox + lx
			var wz := oz + lz
			var h := height_at(wx, wz)
			col.set_biome(lx, lz, biome_idx)
			var surface := grass
			if h <= SEA:
				surface = sand
			for y in range(0, h):
				var id := stone
				if y == 0:
					id = bedrock
				elif y >= h - 4:
					id = dirt if h > SEA else sand
				elif y > 8 and y < h - 6 and (BlockShapes.hash3(wx, y, wz) % 97) == 0:
					id = coal
				elif y > 2 and y < 6 and (BlockShapes.hash3(wx, y, wz) % 53) == 0:
					id = gravel
				col.set_cell(lx, y, lz, id, 0)
			col.set_cell(lx, h - 1, lz, surface, 0)
			for y in range(h, SEA):
				col.set_cell(lx, y, lz, water, Fluids.SOURCE)
	_decorate(col)
	col.recompute_heightmap()

func _decorate(col: ChunkColumn) -> void:
	var grass := _id("grass_block")
	var log_id := _id("oak_log")
	var leaves := _id("oak_leaves")
	var short_grass := _id("short_grass")
	var tall_grass := _id("tall_grass")
	var flowers := [_id("dandelion"), _id("poppy"), _id("oxeye_daisy"), _id("cornflower")]
	var torch := _id("torch")
	var lily := _id("lily_pad")
	var water := _id("water")
	var ox := col.cx * 16
	var oz := col.cz * 16
	for lz in 16:
		for lx in 16:
			var wx := ox + lx
			var wz := oz + lz
			var top := _surface_y(col, lx, lz)
			if top <= 0:
				continue
			var id := col.get_block(lx, top - 1, lz)
			var h := BlockShapes.hash3(wx, 1, wz)
			if id == water:
				if (h % 211) == 0:
					col.set_cell(lx, top, lz, lily, 0)
				continue
			if id != grass:
				continue
			# Trees: keep the whole canopy inside this column (the fallback generator does
			# not write into neighbours).
			if (h % 251) == 0 and lx >= 3 and lx <= 12 and lz >= 3 and lz <= 12 and top < WorldConst.HEIGHT - 12:
				_tree(col, lx, top, lz, log_id, leaves, 4 + (h >> 8) % 3)
				continue
			var r := h % 1000
			if r < 90:
				col.set_cell(lx, top, lz, short_grass, 0)
			elif r < 130:
				col.set_cell(lx, top, lz, tall_grass, 0)
			elif r < 150:
				col.set_cell(lx, top, lz, flowers[(h >> 11) % flowers.size()], 0)
			elif r < 154 and torch > 0:
				col.set_cell(lx, top, lz, torch, 0)

func _surface_y(col: ChunkColumn, lx: int, lz: int) -> int:
	for y in range(WorldConst.HEIGHT - 2, 0, -1):
		if col.get_block(lx, y, lz) != 0:
			return y + 1
	return 0

func _tree(col: ChunkColumn, lx: int, base: int, lz: int, log_id: int, leaves: int, trunk: int) -> void:
	for i in trunk:
		col.set_cell(lx, base + i, lz, log_id, 0)
	var top := base + trunk
	for dy in range(-2, 2):
		var r := 2 if dy < 0 else 1
		for dz in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if absi(dx) == r and absi(dz) == r and dy >= 0:
					continue
				var x := lx + dx
				var z := lz + dz
				var y := top + dy
				if x < 0 or x > 15 or z < 0 or z > 15 or y >= WorldConst.HEIGHT:
					continue
				if col.get_block(x, y, z) == 0:
					col.set_cell(x, y, z, leaves, 0)
	col.set_cell(lx, top, lz, leaves, 0)
