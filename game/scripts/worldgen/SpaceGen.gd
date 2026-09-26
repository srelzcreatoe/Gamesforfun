class_name SpaceGen
extends WorldGen
## Universe 7 deep space: empty, with asteroid_rock clumps (space_metal cores) floating at
## random 3D positions like the DMZ Plus `asteroid_rock` feature. Zero gravity and the oxygen
## timer come from planets.json.

## Clump centres stay inside this y band.
var band_min := 32
var band_max := 120
## 1 in CLUMP_RARITY chunks holds a clump.
var clump_rarity := 3
var clump_radius_min := 3
var clump_radius_max := 9
var scan_chunks := 1

func _configure() -> void:
	terrain_mode = Terrain.MODE_FLAT
	biome_style = BiomeMap.STYLE_SINGLE
	caves_enabled = false
	decorate = false
	bedrock_depth = 0
	stone_name = "asteroid_rock"
	ore_table = []
	dragon_ball_set = String(planet_def.get("dragon_balls", ""))

## Nothing but vacuum; the clumps are added by _features().
func _fill_column(col: ChunkColumn, ctx: Ctx) -> void:
	var bio := col.biomes
	var idx: int = maxi(0, biome_map.index_of("deep_space"))
	if idx < 0:
		idx = maxi(0, biome_map.default_index)
	for i in 256:
		bio[i] = idx & 255
		ctx.tops[i] = 0
		ctx.top_any[i] = 0
		ctx.wet[i] = 0
	col.biomes = bio

func _features(col: ChunkColumn, ctx: Ctx) -> void:
	var rock := block_id("asteroid_rock")
	var metal := block_id("space_metal")
	if rock <= 0:
		return
	var field: int = maxi(0, biome_map.index_of("asteroid_field"))
	for dz in range(-scan_chunks, scan_chunks + 1):
		for dx in range(-scan_chunks, scan_chunks + 1):
			var rx := ctx.cx + dx
			var rz := ctx.cz + dz
			var hh := Terrain.hash_seeded(seed + 8123, rx, 12, rz)
			if hh % clump_rarity != 0:
				continue
			var clumps := 1 + (hh >> 3) % 2
			for c in clumps:
				var ch := Terrain.hash_seeded(seed + 8123 + c * 77, rx, 13 + c, rz)
				var ax := rx * 16 + (ch % 16)
				var az := rz * 16 + ((ch >> 5) % 16)
				var ay := band_min + ((ch >> 10) % maxi(1, band_max - band_min))
				var r := clump_radius_min + ((ch >> 18) % maxi(1, clump_radius_max - clump_radius_min + 1))
				_clump(col, ctx, ax, ay, az, r, rock, metal, ch, field)

func _clump(col: ChunkColumn, ctx: Ctx, ax: int, ay: int, az: int, r: int, rock: int,
		metal: int, hh: int, field_biome: int) -> void:
	var rf := float(r) + 0.4
	var core: int = maxi(1, r - 3)
	for dy in range(-r, r + 1):
		for dz in range(-r, r + 1):
			for dx in range(-r, r + 1):
				var d2 := dx * dx + dy * dy + dz * dz
				if float(d2) > rf * rf:
					continue
				if d2 > (r - 1) * (r - 1) and (Terrain.hash_seeded(hh, ax + dx, ay + dy, az + dz) % 4) == 0:
					continue
				var id := rock
				if metal > 0 and d2 <= core * core and (Terrain.hash_seeded(hh + 5, ax + dx, ay + dy, az + dz) % 3) == 0:
					id = metal
				put_world(col, ctx, ax + dx, ay + dy, az + dz, id)
	if field_biome > 0 and inside(ctx, ax, az):
		var bio := col.biomes
		for dz2 in range(-r, r + 1):
			for dx2 in range(-r, r + 1):
				var lx := ax + dx2 - ctx.ox
				var lz := az + dz2 - ctx.oz
				if lx < 0 or lx > 15 or lz < 0 or lz > 15:
					continue
				bio[lx + 16 * lz] = field_biome & 255
		col.biomes = bio
