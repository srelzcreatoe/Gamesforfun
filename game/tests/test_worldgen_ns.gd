extends TestCase
## Nature's Spirit biomes + the reworked Terralith-style Earth terrain
## (docs/briefs/worldgen_ns.md).

const SEED := 4242
## Every Nature's Spirit tree species that Trees.gd must be able to build.
const NS_TREES := ["redwood", "frosty_redwood", "maple", "orange_maple", "wisteria",
	"pink_wisteria", "palm", "cypress", "aspen", "fir", "snowy_fir", "sugi", "willow", "joshua"]

func _earth() -> Object:
	return WorldGenFactory.create_for_planet("earth", SEED)

func _col(gen: Object, cx: int, cz: int) -> ChunkColumn:
	var c := ChunkColumn.new(cx, cz)
	gen.call("generate_column", c, SEED, Registry.planet("earth"))
	return c

# --- data ------------------------------------------------------------------

func test_ns_biomes_registered_and_valid() -> void:
	var earth: Array = Registry.planet("earth").get("biomes", [])
	var ns := 0
	for bid in Registry.biomes.keys():
		var b: Dictionary = Registry.biomes[bid]
		if not String(b.get("quest_tag", "")).begins_with("natures_spirit:"):
			continue
		ns += 1
		assert_eq(String(b.get("planet", "")), "earth", "%s is not an earth biome" % bid)
		assert_true(earth.has(String(bid)), "%s missing from earth's biome list" % bid)
		for key in ["surface", "filler", "underwater"]:
			assert_true(Registry.block_id(String(b.get(key, ""))) > 0,
				"%s.%s unknown block %s" % [bid, key, b.get(key, "")])
		for t in b.get("trees", []):
			assert_true(NS_TREES.has(String(t.get("type", ""))) or
				["oak", "birch", "spruce", "jungle", "acacia", "dark_oak", "cherry", "cactus",
				"big_oak", "ajissa", "sacred"].has(String(t.get("type", ""))),
				"%s unknown tree type %s" % [bid, t.get("type", "")])
		for pl in b.get("plants", []):
			assert_true(Registry.block_id(String(pl.get("block", ""))) > 0,
				"%s unknown plant %s" % [bid, pl.get("block", "")])
		assert_true(["low", "mid", "high", "peak", "any"].has(String(b.get("elevation", "mid"))),
			"%s has a bad elevation band" % bid)
	assert_true(ns >= 40, "expected the Nature's Spirit biome set, found %d" % ns)
	assert_true(Registry.biome_order.size() <= 256, "biome indices must fit in a byte")

func test_registry_still_validates() -> void:
	var problems := Registry.validate()
	assert_eq(problems.size(), 0, "Registry.validate(): " + str(problems))

# --- terrain ---------------------------------------------------------------

func test_heights_stay_inside_the_world() -> void:
	var t := WorldGenFactory.make_terrain(Registry.planet("earth"), SEED)
	for z in range(-2000, 2001, 137):
		for x in range(-2000, 2001, 137):
			var h := t.height_at(x, z)
			assert_true(h >= 1 and h <= 127, "height %d at (%d, %d)" % [h, x, z])

func test_mountains_reach_the_peaks_near_spawn() -> void:
	var t := WorldGenFactory.make_terrain(Registry.planet("earth"), SEED)
	var best := 0
	for z in range(-1500, 1501, 25):
		for x in range(-1500, 1501, 25):
			var h := t.height_at(x, z)
			if h > best:
				best = h
	print("      tallest peak within 1500 blocks: y %d" % best)
	assert_true(best > 100, "no mountain above y 100 within 1500 blocks (tallest %d)" % best)

func test_rivers_cut_down_to_sea_level() -> void:
	var t := WorldGenFactory.make_terrain(Registry.planet("earth"), SEED)
	var sea := t.sea_level
	var river_cells := 0
	for z in range(-1200, 1201, 17):
		for x in range(-1200, 1201, 17):
			if t.river_at(x, z) < 0.8:
				continue
			if t.continental_at(x, z) < 0.15:
				continue                       # only count inland rivers
			if t.height_at(x, z) <= sea:
				river_cells += 1
	assert_true(river_cells > 20, "inland rivers never reach sea level (%d cells)" % river_cells)

func test_terrain_has_relief_and_flats() -> void:
	var t := WorldGenFactory.make_terrain(Registry.planet("earth"), SEED)
	var lo := 999
	var hi := 0
	for z in range(-900, 901, 31):
		for x in range(-900, 901, 31):
			var h := t.height_at(x, z)
			lo = mini(lo, h)
			hi = maxi(hi, h)
	assert_true(hi - lo > 60, "terrain is too flat (range %d..%d)" % [lo, hi])

func test_band_placement_uses_elevation() -> void:
	var g := _earth()
	var bm: BiomeMap = g.get("biome_map")
	var t: Terrain = g.get("terrain")
	var peak_ok := false
	var checked := 0
	for z in range(-1500, 1501, 23):
		for x in range(-1500, 1501, 23):
			var h := t.height_at(x, z)
			if h < 104:
				continue
			checked += 1
			var def := bm.def(bm.at(x, z, h))
			var elev := String(def.get("elevation", "mid"))
			if elev == "peak" or elev == "high" or String(def.get("id", "")) == "mountains":
				peak_ok = true
	if checked > 0:
		assert_true(peak_ok, "peaks are not using the peak/high biome band")

# --- trees -----------------------------------------------------------------

func test_every_ns_tree_builds() -> void:
	var g := _earth()
	for kind in NS_TREES:
		var col := ChunkColumn.new(0, 0)
		var ctx: WorldGen.Ctx = WorldGen.Ctx.new()
		ctx.cx = 0
		ctx.cz = 0
		ctx.ox = 0
		ctx.oz = 0
		for i in 256:
			ctx.tops[i] = 64
			ctx.top_any[i] = 64
		Trees.place(g, col, ctx, String(kind), 8, 64, 8, 12345)
		var placed := 0
		var logs := 0
		var leaves := 0
		for i in col.blocks.size():
			var b: int = col.blocks[i]
			if b == 0:
				continue
			placed += 1
			var name := String(Registry.block(b).get("id", ""))
			if name.ends_with("_log"):
				logs += 1
			elif name.ends_with("_leaves"):
				leaves += 1
		assert_true(placed > 12, "%s produced only %d blocks" % [kind, placed])
		assert_true(logs > 0, "%s has no trunk" % kind)
		if kind != "joshua":
			assert_true(leaves > 4, "%s has no canopy (%d leaves)" % [kind, leaves])

func test_ns_trees_appear_in_the_world() -> void:
	var g := _earth()
	var t: Terrain = g.get("terrain")
	var bm: BiomeMap = g.get("biome_map")
	# find a column in a Nature's Spirit forest biome and check something grew there
	var found := ""
	for ring in range(4, 60, 4):
		for a in 12:
			var ang := float(a) / 12.0 * TAU
			var cx := int(round(cos(ang) * float(ring)))
			var cz := int(round(sin(ang) * float(ring)))
			var bid := bm.id_at_world(cx * 16 + 8, cz * 16 + 8)
			var def := Registry.biome(bid)
			var trees: Array = def.get("trees", [])
			if trees.is_empty() or not String(def.get("quest_tag", "")).begins_with("natures_spirit:"):
				continue
			var dens := 0.0
			for tr in trees:
				dens += float(tr.get("density", 0.0))
			if dens < 0.03:
				continue
			var col := _col(g, cx, cz)
			var wood := 0
			for i in col.blocks.size():
				var name := String(Registry.block(col.blocks[i]).get("id", ""))
				if name.ends_with("_log") or name.ends_with("_leaves"):
					wood += 1
			if wood > 20:
				found = bid
				break
		if found != "":
			break
	assert_ne(found, "", "no Nature's Spirit forest produced trees near spawn")
	print("      NS forest sampled: %s" % found)

# --- arrival point ---------------------------------------------------------

func test_spawn_point_entry_point() -> void:
	for planet in ["earth", "namek", "vegeta", "otherworld"]:
		var def := Registry.planet(planet)
		var p := WorldGenFactory.spawn_point(def, SEED)
		assert_eq(p, SpawnPoint.find(def, SEED), "%s: factory must delegate to SpawnPoint" % planet)
		assert_true(p.y > 1.0 and p.y < 127.0, "%s arrival y=%.1f" % [planet, p.y])
		var t := WorldGenFactory.make_terrain(def, SEED)
		if t.has_sea:
			assert_true(p.y > float(t.sea_level), "%s arrival is under water" % planet)
