extends TestCase
## Worldgen: determinism, biome bytes, water, caves, ores and the per-column time budget.

const SEED := 4242

func _gen(planet_id: String, seed := SEED) -> Object:
	return WorldGenFactory.create_for_planet(planet_id, seed)

func _col(gen: Object, cx: int, cz: int) -> ChunkColumn:
	var c := ChunkColumn.new(cx, cz)
	gen.call("generate_column", c, int(gen.get("seed")), Registry.planet(String(gen.get("planet_id"))))
	return c

# --- determinism -----------------------------------------------------------

func test_same_seed_same_columns() -> void:
	var a := _gen("earth")
	var b := _gen("earth")
	var keys := [Vector2i(0, 0), Vector2i(3, -2), Vector2i(-7, 5), Vector2i(12, 9)]
	var reversed := keys.duplicate()
	reversed.reverse()
	var first := {}
	for k in keys:
		first[k] = _col(a, k.x, k.y)
	for k in reversed:
		var c := _col(b, k.x, k.y)
		var ref: ChunkColumn = first[k]
		assert_eq(c.blocks, ref.blocks, "blocks differ for %s (visit order)" % str(k))
		assert_eq(c.biomes, ref.biomes, "biomes differ for %s" % str(k))
		assert_eq(c.heightmap, ref.heightmap, "heightmap differs for %s" % str(k))

func test_regenerating_one_column_is_stable() -> void:
	var g := _gen("earth")
	var a := _col(g, 5, -9)
	var b := _col(g, 5, -9)
	assert_eq(a.blocks, b.blocks, "same column twice must match")
	assert_eq(a.meta, b.meta, "meta must match")

func test_different_seeds_differ() -> void:
	var a := _col(_gen("earth", 1), 0, 0)
	var b := _col(_gen("earth", 2), 0, 0)
	assert_ne(a.blocks, b.blocks, "different seeds should produce different terrain")

# --- content ---------------------------------------------------------------

func test_biome_bytes_are_valid() -> void:
	var n := Registry.biome_order.size()
	assert_true(n > 0, "no biomes registered")
	for planet in ["earth", "namek", "vegeta", "heaven"]:
		var g := _gen(planet)
		var c := _col(g, 2, 3)
		var planet_biomes: Array = Registry.planet(planet).get("biomes", [])
		for i in 256:
			var idx: int = c.biomes[i]
			assert_true(idx < n, "%s biome index %d out of range" % [planet, idx])
			var id := Registry.biome_order[idx]
			assert_true(planet_biomes.has(id), "%s got foreign biome %s" % [planet, id])

func test_earth_has_bedrock_and_surface() -> void:
	var g := _gen("earth")
	var c := _col(g, 0, 0)
	var bedrock := Registry.block_id("bedrock")
	for i in 256:
		assert_eq(c.blocks[i], bedrock, "bedrock floor missing at %d" % i)
	var air_above := true
	for lz in 16:
		for lx in 16:
			var top: int = c.heightmap[lx + 16 * lz]
			assert_true(top > 4, "surface too low")
			if top < WorldConst.HEIGHT:
				if c.blocks[lx + 16 * (lz + 16 * top)] != 0:
					air_above = false
	assert_true(air_above, "block found above the heightmap")

func test_earth_has_water_at_sea_level() -> void:
	var g := _gen("earth")
	var water := Registry.block_id("water")
	var sea: int = int(g.get("sea_level"))
	var found := 0
	# The generator always carves an ocean bay around Terrain.EARTH_BAY.
	var bay := Terrain.EARTH_BAY
	var cx := int(floor(bay.x / 16.0))
	var cz := int(floor(bay.y / 16.0))
	var c := _col(g, cx, cz)
	for lz in 16:
		for lx in 16:
			if c.blocks[lx + 16 * (lz + 16 * sea)] == water:
				found += 1
	assert_true(found > 100, "expected the Kame House bay to be water, got %d cells" % found)

func test_earth_spawn_area_is_land_with_saga_biomes() -> void:
	var g := _gen("earth")
	var terrain: Terrain = g.get("terrain")
	var sea: int = int(g.get("sea_level"))
	assert_true(terrain.height_at(0, 0) > sea + 1, "spawn must be dry land")
	var seen := {}
	for z in range(-380, 381, 20):
		for x in range(-380, 381, 20):
			if x * x + z * z > 400 * 400:
				continue
			seen[(g.get("biome_map") as BiomeMap).id_at_world(x, z)] = true
	for want in ["plains", "wasteland", "forest"]:
		assert_true(seen.has(want), "biome %s missing near spawn (got %s)" % [want, str(seen.keys())])
	assert_true(seen.has("beach") or seen.has("ocean"), "no beach/ocean near spawn")

func test_caves_and_ores_exist() -> void:
	var g := _gen("earth")
	var air_pockets := 0
	var ores := 0
	var ore_ids := {}
	for name in ["coal_ore", "iron_ore", "copper_ore", "gold_ore", "diamond_ore", "redstone_ore"]:
		ore_ids[Registry.block_id(name)] = true
	for k in [Vector2i(0, 0), Vector2i(1, 1), Vector2i(-2, 4)]:
		var c := _col(g, k.x, k.y)
		for lz in 16:
			for lx in 16:
				var top: int = c.heightmap[lx + 16 * lz]
				for y in range(4, mini(top - 6, 60)):
					var b: int = c.blocks[lx + 16 * (lz + 16 * y)]
					if b == 0:
						air_pockets += 1
					elif ore_ids.has(b):
						ores += 1
	assert_true(air_pockets > 200, "expected cave air underground, got %d" % air_pockets)
	assert_true(ores > 20, "expected ore veins, got %d" % ores)

func test_no_caves_on_heaven() -> void:
	var g := _gen("heaven")
	var c := _col(g, 1, 1)
	var holes := 0
	for lz in 16:
		for lx in 16:
			var top: int = c.heightmap[lx + 16 * lz]
			for y in range(4, maxi(5, top - 8)):
				if c.blocks[lx + 16 * (lz + 16 * y)] == 0:
					holes += 1
	assert_true(holes < 40, "heaven should be solid underground, found %d holes" % holes)

# --- budget ----------------------------------------------------------------

func test_column_time_budget() -> void:
	for planet in ["earth", "namek", "vegeta", "heaven", "cereal", "hell_planet",
			"otherworld", "universe_7_deep_space"]:
		var g := _gen(planet)
		# Warm up: the first column also resolves the unique structure positions.
		_col(g, 40, 40)
		var t0 := Time.get_ticks_usec()
		var n := 8
		for i in n:
			_col(g, 100 + i, 60 + i)
		var ms := float(Time.get_ticks_usec() - t0) / 1000.0 / float(n)
		print("      %-22s %.2f ms/column" % [planet, ms])
		assert_true(ms < 40.0, "%s column generation too slow: %.2f ms" % [planet, ms])
