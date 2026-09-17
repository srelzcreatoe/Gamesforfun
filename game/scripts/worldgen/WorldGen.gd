class_name WorldGen
extends RefCounted
## Base class of every planet generator (docs/ARCHITECTURE.md §4, docs/briefs/worldgen.md).
##
## Contract: `generate_column(col: ChunkColumn, seed: int, planet: Dictionary) -> void`, called
## from ChunkManager's WorkerThreadPool tasks. Several columns are generated concurrently on
## the *same* generator object, so all state here is read-only after `configure()`; per-column
## scratch data lives in a `Ctx` instance and in local variables only.
##
## Everything is a pure function of (seed, planet, column coordinates): the same seed always
## produces the same column, no matter the order in which columns are visited
## (tests/test_worldgen_determinism.gd checks exactly that).
##
## Pipeline per column:
##   1. heights + biomes  (Terrain + BiomeMap: continuous fields, no per-chunk state)
##   2. terrain fill      (bedrock / stone / filler / surface / water, snow above altitude)
##   3. ore veins         (blocks.json ores, enumerated from the 3x3 chunk neighbourhood)
##   4. caves             (Caves.carve_list: stride-4 interpolated 3D noise)
##   5. decoration        (Decorator: trees, plants, lakes, mobs -> entities_pending)
##   6. structures        (Structures: deterministic stamping + structure_marks)
##   7. dragon balls      (DragonBallPlacement)

const HEIGHT := WorldConst.HEIGHT
const CHUNK := WorldConst.CHUNK
## Feature margin: trees/plants may be anchored this far outside the column and still stamp
## into it, so canopies cross chunk borders seamlessly.
const MARGIN := 5
const EXT := 26                    # 16 + 2 * MARGIN
const UNKNOWN := -32768

## Per-column scratch data (one instance per generate_column call, never shared).
class Ctx extends RefCounted:
	const E := 26
	const NONE := -32768
	var cx: int = 0
	var cz: int = 0
	var ox: int = 0
	var oz: int = 0
	## Extended (26x26) lazily filled terrain heights, index (gx + 5) + 26 * (gz + 5).
	var ext_h := PackedInt32Array()
	## Extended biome registry indices, -1 = not computed yet.
	var ext_b := PackedInt32Array()
	## Per (lx + 16*lz): first air y above the generated ground, ignoring water.
	var tops := PackedInt32Array()
	## Per (lx + 16*lz): 1 when the ground there is covered by water/lava.
	var wet := PackedByteArray()
	## Per (lx + 16*lz): highest block placed by any pass + 1 (used for the heightmap).
	var top_any := PackedInt32Array()

	func _init() -> void:
		ext_h.resize(E * E)
		ext_b.resize(E * E)
		tops.resize(256)
		wet.resize(256)
		top_any.resize(256)
		for i in E * E:
			ext_h[i] = NONE
			ext_b[i] = -1

var seed: int = 0
var planet_def: Dictionary = {}
var planet_id := "earth"
var sea_level := WorldConst.SEA_LEVEL
var has_sea := true

var terrain := Terrain.new()
var biome_map := BiomeMap.new()
var caves := Caves.new()
var decorator := Decorator.new()
var structures := Structures.new()

# --- tunables, set by the subclass in _configure() --------------------------

var terrain_mode := Terrain.MODE_EARTH
var biome_style := BiomeMap.STYLE_SINGLE
var caves_enabled := false
var bedrock_depth := 1
var stone_name := "stone"
var deep_name := ""                       # optional deeper stone (e.g. namek_deepslate)
var deep_y := 0
var filler_depth := 4
var lava_level := 0                       # carved cave cells at/below this y become lava
var snow_y := 9999                        # surface at/above this y gets `snow_name`
var snow_name := "snow_block"
var ore_table: Array = []                 # [{block, min, max, tries, size}]
## Scales the biomes.json tree densities for this planet (the converted DMZ/vanilla numbers
## are dense enough to close the canopy; meadow-like planets want fewer).
var tree_density_scale := 1.0
var decorate := true
var stamp_structures := true
var dragon_ball_set := ""
## Local pools/lakes on planets without a sea: `pool_name` is the liquid, `pool_depth` the
## basin depth the height field already subtracted (Terrain.lake_at).
var pool_name := ""
var pool_depth := 0.0
var id_pool := 0
## Horizontal colour bands in the top `band_depth` blocks (mesa planets); every 3 blocks
## steps to the next entry of `band_names`.
var band_names: Array = []
var band_depth := 0
var _band_ids := PackedInt32Array()
## Exposed rock: a surface steeper than this many blocks uses the biome's `cliff` block.
var cliff_slope := 0
## Surfaces at/above this y turn to bare stone (mountain rock above the tree line).
var stone_y := 9999

# resolved block ids
var id_air := 0
var id_stone := 1
var id_deep := -1
var id_water := 0
var id_lava := 0
var id_bedrock := 0
var id_snow := 0
var id_snow_layer := 0
var id_gravel := 0
var id_sand := 0

## Registry-biome-index -> block id tables (so the fill loop never touches a Dictionary).
var _biome_surface := PackedInt32Array()
var _biome_filler := PackedInt32Array()
var _biome_underwater := PackedInt32Array()
var _biome_cliff := PackedInt32Array()
var _biome_band := PackedInt32Array()
var _ore_ids := PackedInt32Array()
var _mutex := Mutex.new()

func _init(p_planet_def: Dictionary = {}, p_seed: int = 0) -> void:
	planet_def = p_planet_def
	seed = p_seed
	configure()

# --- configuration ---------------------------------------------------------

func configure() -> void:
	planet_id = String(planet_def.get("id", "earth"))
	var sl := int(planet_def.get("sea_level", WorldConst.SEA_LEVEL))
	has_sea = sl > 0 and sl < HEIGHT
	sea_level = sl if has_sea else -999
	_configure()
	terrain.configure(seed, planet_def, terrain_mode)
	terrain.plane_y = plane_y()
	biome_map.configure(terrain, planet_def, biome_style)
	caves.configure(seed, caves_enabled)
	id_stone = block_id(stone_name)
	id_deep = block_id(deep_name) if deep_name != "" else -1
	id_water = block_id("water")
	id_lava = block_id("lava")
	id_bedrock = block_id("bedrock")
	id_snow = block_id(snow_name)
	id_snow_layer = block_id("snow_layer")
	id_gravel = block_id("gravel")
	id_sand = block_id("sand")
	id_pool = block_id(pool_name) if pool_name != "" else 0
	_band_ids = PackedInt32Array()
	for bn in band_names:
		var bid := block_id(String(bn))
		if bid > 0:
			_band_ids.append(bid)
	_build_biome_tables()
	_ore_ids = PackedInt32Array()
	for o in ore_table:
		_ore_ids.append(block_id(String(o.get("block", "stone"))))
	decorator.configure(self)
	structures.configure(self)
	_post_configure()

## Subclasses override this to set the tunables above.
func _configure() -> void:
	pass

## Runs after terrain / biomes / structures are configured (hotspots, fixed positions, ...).
func _post_configure() -> void:
	pass

## Flat planets (otherworld / time chamber) override this.
func plane_y() -> int:
	return 60

## Structure `y_mode: absolute|sky` y values come from DMZ worlds that are 384 blocks tall;
## planets whose ground sits elsewhere remap them here.
func remap_structure_y(y: int, _mode: String) -> int:
	return y

## Extra per-planet features (cloud islands, rock spires, asteroid clumps, Snake Way, ...).
func _features(_col: ChunkColumn, _ctx: Ctx) -> void:
	pass

func reseed(p_seed: int) -> void:
	_mutex.lock()
	if p_seed != seed:
		seed = p_seed
		configure()
	_mutex.unlock()

func block_id(name: String) -> int:
	if name == "":
		return 0
	var v := Registry.block_id(name)
	return v if v >= 0 else 0

func _build_biome_tables() -> void:
	var n := Registry.biome_order.size()
	_biome_surface = PackedInt32Array()
	_biome_filler = PackedInt32Array()
	_biome_underwater = PackedInt32Array()
	_biome_cliff = PackedInt32Array()
	_biome_band = PackedInt32Array()
	_biome_surface.resize(n)
	_biome_filler.resize(n)
	_biome_underwater.resize(n)
	_biome_cliff.resize(n)
	_biome_band.resize(n)
	for i in n:
		var b := Registry.biome_by_index(i)
		_biome_surface[i] = block_id(String(b.get("surface", "grass_block")))
		_biome_filler[i] = block_id(String(b.get("filler", "dirt")))
		_biome_underwater[i] = block_id(String(b.get("underwater", "sand")))
		_biome_cliff[i] = block_id(String(b.get("cliff", "stone")))
		_biome_band[i] = int(b.get("band_depth", 0))

# --- public generator entry point ------------------------------------------

func generate_column(col: ChunkColumn, p_seed: int, planet: Dictionary) -> void:
	if p_seed != seed:
		reseed(p_seed)
	var ctx := Ctx.new()
	ctx.cx = col.cx
	ctx.cz = col.cz
	ctx.ox = col.cx * CHUNK
	ctx.oz = col.cz * CHUNK
	_fill_column(col, ctx)
	_features(col, ctx)
	if decorate:
		decorator.decorate(col, ctx)
	if stamp_structures:
		structures.stamp(col, ctx)
	if dragon_ball_set != "":
		DragonBallPlacement.place_in_column(col, ctx, dragon_ball_set, self)
	_write_heightmap(col, ctx)

func _write_heightmap(col: ChunkColumn, ctx: Ctx) -> void:
	for i in 256:
		col.heightmap[i] = clampi(ctx.top_any[i], 0, 255)

# --- terrain fill ----------------------------------------------------------

## Default fill: bedrock floor, stone body, biome filler + surface, water up to sea level,
## ore veins, caves. Cloud / space planets override this completely.
func _fill_column(col: ChunkColumn, ctx: Ctx) -> void:
	var blocks := col.blocks
	var meta := col.meta
	var bio := col.biomes
	var sea := sea_level
	var wet_sea := has_sea
	for lz in 16:
		for lx in 16:
			var i2 := lx + 16 * lz
			var wx := ctx.ox + lx
			var wz := ctx.oz + lz
			var h := ext_height(ctx, lx, lz)
			var b: int = maxi(0, ext_biome(ctx, lx, lz))
			bio[i2] = b & 255
			var surface := _biome_surface[b] if b < _biome_surface.size() else id_stone
			var filler := _biome_filler[b] if b < _biome_filler.size() else id_stone
			var under := _biome_underwater[b] if b < _biome_underwater.size() else id_gravel
			var submerged := wet_sea and h <= sea
			var top_solid: int = maxi(0, h - 1)
			# Steep ground shows bare rock (coastal cliffs, mountain walls, canyon sides).
			var steep := false
			if cliff_slope > 0 and not submerged:
				var slope: int = absi(ext_height(ctx, lx + 1, lz) - h)
				slope = maxi(slope, absi(ext_height(ctx, lx - 1, lz) - h))
				slope = maxi(slope, absi(ext_height(ctx, lx, lz + 1) - h))
				slope = maxi(slope, absi(ext_height(ctx, lx, lz - 1) - h))
				steep = slope >= cliff_slope
				if steep:
					var cliff_id := _biome_cliff[b] if b < _biome_cliff.size() else id_stone
					surface = cliff_id
					filler = cliff_id
			var body_top: int = maxi(bedrock_depth, top_solid - filler_depth)
			var bdepth := band_depth
			if b < _biome_band.size() and _biome_band[b] > 0:
				bdepth = _biome_band[b]
			var band_from := top_solid - bdepth
			var band_n := _band_ids.size() if bdepth > 0 else 0
			var y := bedrock_depth
			while y <= body_top:
				var id := id_stone
				if id_deep > 0 and y < deep_y:
					id = id_deep
				elif band_n > 0 and y > band_from:
					id = _band_ids[int(y / 3) % band_n]
				blocks[i2 + 256 * y] = id
				y += 1
			for yb in bedrock_depth:
				blocks[i2 + 256 * yb] = id_bedrock
			while y < top_solid:
				var fid := filler
				if band_n > 0 and y > band_from:
					fid = _band_ids[int(y / 3) % band_n]
				blocks[i2 + 256 * y] = fid
				y += 1
			if top_solid >= bedrock_depth:
				var top_id := surface
				if submerged:
					top_id = under
				elif top_solid >= _snow_line(wx, wz):
					top_id = id_snow
				elif top_solid >= stone_y and not steep:
					top_id = id_stone
				blocks[i2 + 256 * top_solid] = top_id
			ctx.tops[i2] = h
			ctx.top_any[i2] = h
			if submerged:
				var yw := h
				while yw <= sea:
					var iw := i2 + 256 * yw
					blocks[iw] = id_water
					meta[iw] = Fluids.SOURCE
					yw += 1
				ctx.wet[i2] = 1
				ctx.top_any[i2] = sea + 1
			else:
				ctx.wet[i2] = 0
				if id_pool > 0:
					var pool_y := terrain.pool_level_at(wx, wz, h, pool_depth)
					if pool_y > -900:
						if pool_y >= h:
							var yp := h
							while yp <= pool_y and yp < HEIGHT:
								var ip := i2 + 256 * yp
								blocks[ip] = id_pool
								meta[ip] = Fluids.SOURCE
								yp += 1
							ctx.wet[i2] = 1
							ctx.top_any[i2] = pool_y + 1
							if top_solid >= bedrock_depth:
								blocks[i2 + 256 * top_solid] = under
	# ore veins
	var ores := _ore_list(ctx)
	var n := ores.size()
	var oi := 0
	while oi < n:
		var idx := ores[oi]
		var oid := ores[oi + 1]
		oi += 2
		var cur := blocks[idx]
		if cur == id_stone or (id_deep > 0 and cur == id_deep):
			blocks[idx] = oid
	# caves
	if caves_enabled:
		var list := caves.carve_list(ctx.cx, ctx.cz, ctx.tops)
		for i in list.size():
			var ci := list[i]
			var cb := blocks[ci]
			if cb == 0 or cb == id_bedrock or cb == id_water:
				continue
			var cy := ci >> 8
			if cy <= lava_level and id_lava > 0:
				blocks[ci] = id_lava
				meta[ci] = Fluids.SOURCE
			else:
				blocks[ci] = 0
	col.blocks = blocks
	col.meta = meta
	col.biomes = bio

func _snow_line(wx: int, wz: int) -> int:
	if snow_y > HEIGHT:
		return HEIGHT + 1
	return snow_y + (Terrain.hash_seeded(seed, wx, 7, wz) % 5) - 2

## Candidate ore cells as interleaved (index, block id) pairs. Veins anchored in the eight
## neighbouring chunks are enumerated with their own hash, so a vein that crosses a chunk
## border is produced identically by both columns.
func _ore_list(ctx: Ctx) -> PackedInt32Array:
	var out := PackedInt32Array()
	if ore_table.is_empty():
		return out
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			var ncx := ctx.cx + dx
			var ncz := ctx.cz + dz
			for oi in ore_table.size():
				var o: Dictionary = ore_table[oi]
				var ore_id := _ore_ids[oi]
				if ore_id <= 0:
					continue
				var tries := int(o.get("tries", 2))
				var size := int(o.get("size", 8))
				var ymin := int(o.get("min", 1))
				var ymax: int = maxi(ymin + 1, int(o.get("max", 60)))
				for t in tries:
					var hh := Terrain.hash_seeded(seed + 1013 * (oi + 1), ncx, t + 31, ncz)
					var lx := ncx * 16 + (hh % 16) - ctx.ox
					var lz := ncz * 16 + ((hh >> 5) % 16) - ctx.oz
					var vy := ymin + ((hh >> 10) % (ymax - ymin))
					if lx < -6 or lx > 21 or lz < -6 or lz > 21:
						continue
					# random walk blob, clipped to this column
					var step := hh | 1
					var placed := 0
					while placed < size:
						if lx >= 0 and lx < 16 and lz >= 0 and lz < 16 and vy > bedrock_depth and vy < HEIGHT:
							if vy < ctx.tops[lx + 16 * lz] - 2:
								out.append(lx + 16 * lz + 256 * vy)
								out.append(ore_id)
						placed += 1
						step = (step * 1103515245 + 12345) & 0x7fffffff
						match step % 6:
							0: lx += 1
							1: lx -= 1
							2: lz += 1
							3: lz -= 1
							4: vy += 1
							_: vy -= 1
	return out

# --- extended height / biome grids -----------------------------------------

## Terrain height at a column-local coordinate that may lie up to MARGIN outside the column.
func ext_height(ctx: Ctx, gx: int, gz: int) -> int:
	var ix := gx + MARGIN
	var iz := gz + MARGIN
	if ix < 0 or ix >= EXT or iz < 0 or iz >= EXT:
		return terrain.height_at(ctx.ox + gx, ctx.oz + gz)
	var i := ix + EXT * iz
	var v := ctx.ext_h[i]
	if v != UNKNOWN:
		return v
	v = terrain.height_at(ctx.ox + gx, ctx.oz + gz)
	ctx.ext_h[i] = v
	return v

func ext_biome(ctx: Ctx, gx: int, gz: int) -> int:
	var ix := gx + MARGIN
	var iz := gz + MARGIN
	if ix < 0 or ix >= EXT or iz < 0 or iz >= EXT:
		return biome_map.at(ctx.ox + gx, ctx.oz + gz, ext_height(ctx, gx, gz))
	var i := ix + EXT * iz
	var v := ctx.ext_b[i]
	if v >= 0:
		return v
	v = biome_map.at(ctx.ox + gx, ctx.oz + gz, ext_height(ctx, gx, gz))
	ctx.ext_b[i] = v
	return v

# --- helpers for Decorator / Structures ------------------------------------

## Place a block, clipped to this column (world coordinates in).
func put_world(col: ChunkColumn, ctx: Ctx, wx: int, wy: int, wz: int, id: int, m: int = 0,
		only_air: bool = false) -> void:
	if wy < 0 or wy >= HEIGHT:
		return
	var lx := wx - ctx.ox
	var lz := wz - ctx.oz
	if lx < 0 or lx > 15 or lz < 0 or lz > 15:
		return
	var i2 := lx + 16 * lz
	var i := i2 + 256 * wy
	if only_air and col.blocks[i] != 0:
		return
	col.set_cell(lx, wy, lz, id, m)
	if id != 0 and wy + 1 > ctx.top_any[i2]:
		ctx.top_any[i2] = wy + 1

## Block id at a world position, or -1 when it lies outside this column.
func get_world(col: ChunkColumn, ctx: Ctx, wx: int, wy: int, wz: int) -> int:
	if wy < 0 or wy >= HEIGHT:
		return 0
	var lx := wx - ctx.ox
	var lz := wz - ctx.oz
	if lx < 0 or lx > 15 or lz < 0 or lz > 15:
		return -1
	return col.blocks[lx + 16 * lz + 256 * wy]

func inside(ctx: Ctx, wx: int, wz: int) -> bool:
	var lx := wx - ctx.ox
	var lz := wz - ctx.oz
	return lx >= 0 and lx < 16 and lz >= 0 and lz < 16

## Ground surface y (first air above the terrain, water ignored).
func surface_y(ctx: Ctx, wx: int, wz: int) -> int:
	if inside(ctx, wx, wz):
		return ctx.tops[(wx - ctx.ox) + 16 * (wz - ctx.oz)]
	return terrain.height_at(wx, wz)

func biome_def_at(ctx: Ctx, gx: int, gz: int) -> Dictionary:
	return biome_map.def(ext_biome(ctx, gx, gz))

func rand_unit(x: int, y: int, z: int) -> float:
	return Terrain.hash_unit(seed, x, y, z)

func rand_int(x: int, y: int, z: int) -> int:
	return Terrain.hash_seeded(seed, x, y, z)
