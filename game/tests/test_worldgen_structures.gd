extends TestCase
## Worldgen: structure placement/stamping, dragon balls, spawn points and every planet.

const SEED := 4242

func _gen(planet_id: String, seed := SEED) -> Object:
	return WorldGenFactory.create_for_planet(planet_id, seed)

func _col(gen: Object, cx: int, cz: int) -> ChunkColumn:
	var c := ChunkColumn.new(cx, cz)
	gen.call("generate_column", c, int(gen.get("seed")), Registry.planet(String(gen.get("planet_id"))))
	return c

# --- templates -------------------------------------------------------------

func test_templates_load() -> void:
	for sid in ["roshi_house", "capsule_corp", "kami_lookout", "check_in_station"]:
		var def: Dictionary = Registry.structures.get(sid, {})
		assert_true(not def.is_empty(), "structures.json missing " + sid)
		var tpl := Structures.template("res://" + String(def.get("file", "")))
		assert_true(not tpl.is_empty(), "template not loaded for " + sid)
		var size: Vector3i = tpl["size"]
		assert_true(size.x > 0 and size.y > 0 and size.z > 0, "bad size for " + sid)
		assert_true((tpl["tiles"] as Dictionary).size() > 0, "no blocks for " + sid)

# --- placement -------------------------------------------------------------

func test_unique_positions_are_deterministic_and_in_range() -> void:
	var a := _gen("earth")
	var b := _gen("earth")
	var sa: Structures = a.get("structures")
	var sb: Structures = b.get("structures")
	var checked := 0
	for entry in sa.anchors:
		if not bool(entry["unique"]):
			continue
		var pa := sa.unique_position(entry)
		var pb: Vector3i = Vector3i.ZERO
		for e2 in sb.anchors:
			if String(e2["id"]) == String(entry["id"]):
				pb = sb.unique_position(e2)
		assert_eq(pa, pb, "unique position not deterministic for " + String(entry["id"]))
		if pa.x == 0x7fffffff:
			continue
		checked += 1
		var d := sqrt(float(pa.x * pa.x + pa.z * pa.z))
		var min_d: int = int(entry["min_dist"])
		assert_true(d >= float(min_d) - 1.0,
			"%s is %.0f blocks from spawn, min_distance_from_spawn is %d" % [entry["id"], d, min_d])
		assert_true(d <= 1500.0, "%s is too far from spawn (%.0f)" % [entry["id"], d])
	assert_true(checked >= 8, "expected several unique earth structures, got %d" % checked)

func test_kame_house_is_on_a_beach_or_ocean() -> void:
	var g := _gen("earth")
	var s: Structures = g.get("structures")
	var bm: BiomeMap = g.get("biome_map")
	for entry in s.anchors:
		if String(entry["id"]) != "roshi_house":
			continue
		var p := s.unique_position(entry)
		assert_ne(p.x, 0x7fffffff, "Kame House was not placed")
		var bid := bm.id_at_world(p.x, p.z)
		assert_true(bid == "beach" or bid == "ocean", "Kame House landed in %s" % bid)

func test_structure_stamps_identically_across_columns() -> void:
	var g := _gen("earth")
	var s: Structures = g.get("structures")
	var entry: Dictionary = {}
	for e in s.anchors:
		if String(e["id"]) == "capsule_corp":
			entry = e
	assert_true(not entry.is_empty(), "capsule_corp anchor missing")
	var p := s.unique_position(entry)
	var cx := int(floor(float(p.x) / 16.0))
	var cz := int(floor(float(p.z) / 16.0))
	var keys := [Vector2i(cx, cz), Vector2i(cx + 1, cz), Vector2i(cx, cz + 1), Vector2i(cx - 1, cz - 1)]
	var forward := {}
	for k in keys:
		forward[k] = _col(g, k.x, k.y)
	var g2 := _gen("earth")
	var back := keys.duplicate()
	back.reverse()
	var marks := 0
	var blocks_placed := 0
	for k in back:
		var c := _col(g2, k.x, k.y)
		var ref: ChunkColumn = forward[k]
		assert_eq(c.blocks, ref.blocks, "structure column %s differs between visit orders" % str(k))
		for m in c.structure_marks:
			if String(m.get("id", "")) == "capsule_corp":
				marks += 1
		for i in c.blocks.size():
			if c.blocks[i] != 0:
				blocks_placed += 1
	assert_true(marks >= 1, "no capsule_corp structure_mark recorded")
	assert_true(blocks_placed > 0, "columns are empty")

func test_structure_entities_and_marks() -> void:
	var g := _gen("earth")
	var s: Structures = g.get("structures")
	var entry: Dictionary = {}
	for e in s.anchors:
		if String(e["id"]) == "capsule_corp":
			entry = e
	var p := s.unique_position(entry)
	var found_entity := false
	var found_mark := false
	var cx := int(floor(float(p.x) / 16.0))
	var cz := int(floor(float(p.z) / 16.0))
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			var c := _col(g, cx + dx, cz + dz)
			for e2 in c.entities_pending:
				if Registry.entities.has(String(e2.get("type", ""))):
					found_entity = true
			for m in c.structure_marks:
				if String(m.get("id", "")) == "capsule_corp":
					found_mark = true
					var aabb: AABB = m["aabb"]
					assert_true(aabb.size.x > 1.0 and aabb.size.z > 1.0, "degenerate structure aabb")
					assert_true(String(m.get("quest_tag", "")) != "", "missing quest_tag")
	assert_true(found_entity, "no structure entities queued")
	assert_true(found_mark, "no capsule_corp mark in the 3x3 around it")

# --- dragon balls ----------------------------------------------------------

func test_dragon_ball_positions_deterministic_and_on_surface() -> void:
	for set_id in ["earth", "namek", "cereal", "super"]:
		var a := DragonBallPlacement.positions(set_id, SEED)
		var b := DragonBallPlacement.positions(set_id, SEED + 1)
		var a2 := DragonBallPlacement.positions(set_id, SEED)
		assert_eq(a.size(), DragonBallPlacement.count_of(set_id), "wrong ball count for " + set_id)
		assert_eq(a, a2, "positions not deterministic for " + set_id)
		assert_ne(a, b, "positions do not depend on the seed for " + set_id)
		var planet := DragonBallPlacement.planet_of(set_id)
		var def := Registry.planet(planet)
		var terrain := WorldGenFactory.make_terrain(def, SEED)
		var min_d := float(DragonBallPlacement.SETS[set_id]["min"])
		var max_d := float(DragonBallPlacement.SETS[set_id]["range"])
		for p in a:
			var d := sqrt(p.x * p.x + p.z * p.z)
			assert_true(d >= min_d - 2.0 and d <= max_d + 2.0,
				"%s ball at %.0f blocks, outside [%.0f, %.0f]" % [set_id, d, min_d, max_d])
			if terrain.has_sea:
				assert_true(p.y > float(terrain.sea_level), "%s ball under water" % set_id)
				assert_near(p.y, float(terrain.height_at(int(floor(p.x)), int(floor(p.z)))), 1.5,
					"%s ball not on the surface" % set_id)

func test_dragon_balls_spawn_in_their_column() -> void:
	var g := _gen("earth")
	var list := DragonBallPlacement.positions("earth", SEED)
	assert_true(list.size() == 7, "earth set must have 7 balls")
	var p: Vector3 = list[0]
	var c := _col(g, int(floor(p.x / 16.0)), int(floor(p.z / 16.0)))
	var found := false
	for e in c.entities_pending:
		if String(e.get("type", "")) == "dragon_ball":
			found = true
			var data: Dictionary = e.get("data", {})
			assert_eq(String(data.get("set", "")), "earth", "wrong set tag")
			assert_true(int(data.get("star", 0)) >= 1, "missing star")
	assert_true(found, "the 1-star ball's column did not queue a dragon_ball entity")

# --- spawn points ----------------------------------------------------------

func test_spawn_points() -> void:
	for planet in ["earth", "namek", "vegeta", "heaven", "otherworld", "universe_7_deep_space"]:
		var def := Registry.planet(planet)
		var p := SpawnPoint.find(def, SEED)
		assert_true(p.y > 1.0 and p.y < float(WorldConst.HEIGHT - 2), "%s spawn y=%.1f" % [planet, p.y])
		assert_true(absf(p.x) < 260.0 and absf(p.z) < 260.0, "%s spawn too far from origin" % planet)
		var terrain := WorldGenFactory.make_terrain(def, SEED)
		if terrain.has_sea:
			assert_true(p.y > float(terrain.sea_level), "%s spawn is under water" % planet)

# --- every planet ----------------------------------------------------------

func test_every_planet_generates() -> void:
	var count := Registry.blocks.size()
	for planet in Registry.planets.keys():
		var g := _gen(String(planet))
		var c := _col(g, 1, -1)
		var solid := 0
		for i in c.blocks.size():
			var b: int = c.blocks[i]
			assert_true(b < count, "%s produced block id %d" % [planet, b])
			if b != 0:
				solid += 1
		if String(planet) in ["universe_7_deep_space", "orbit"]:
			continue                              # space is mostly empty on purpose
		assert_true(solid > 2000, "%s generated only %d blocks" % [planet, solid])

func test_otherworld_has_snake_way_and_king_kai() -> void:
	var g := _gen("otherworld")
	var road := Registry.block_id("snake_way")
	var edge := Registry.block_id("snake_way_edge")
	var kk: Vector2i = g.get("kk_pos")
	assert_true(kk.length() > 900.0, "King Kai's planet should be far from the check-in station")
	# Walk along the path and find the road in the columns it crosses.
	var found := 0
	var station: Vector2i = g.get("station_pos")
	var dir := (Vector2(kk) - Vector2(station)).normalized()
	for step in [60.0, 240.0, 700.0]:
		var p := Vector2(station) + dir * step
		var cx := int(floor(p.x / 16.0))
		var cz := int(floor(p.y / 16.0))
		for dz in range(-3, 4):
			for dx in range(-3, 4):
				var c := _col(g, cx + dx, cz + dz)
				for i in c.blocks.size():
					var b: int = c.blocks[i]
					if b == road or b == edge:
						found += 1
	assert_true(found > 50, "Snake Way not found along its path (%d blocks)" % found)

func test_time_chamber_is_a_flat_plane_with_the_building() -> void:
	var g := _gen("time_chamber")
	var floor_id := Registry.block_id("time_chamber_block")
	var c := _col(g, 8, 8)                        # far from the building
	for lz in 16:
		for lx in 16:
			assert_eq(c.heightmap[lx + 16 * lz], 61, "time chamber plane must be flat at y 60")
			assert_eq(c.blocks[lx + 16 * (lz + 16 * 60)], floor_id, "plane block missing")
	var mid := _col(g, 0, 0)
	var above := 0
	for lz in 16:
		for lx in 16:
			if mid.heightmap[lx + 16 * lz] > 62:
				above += 1
	assert_true(above > 20, "the time_chamber structure is missing at the origin")

func test_space_has_asteroids_but_mostly_vacuum() -> void:
	var g := _gen("universe_7_deep_space")
	var rock := Registry.block_id("asteroid_rock")
	var total := 0
	var rocks := 0
	for cz in 4:
		for cx in 4:
			var c := _col(g, cx, cz)
			for i in c.blocks.size():
				if c.blocks[i] != 0:
					total += 1
					if c.blocks[i] == rock or c.blocks[i] == Registry.block_id("space_metal"):
						rocks += 1
	assert_true(rocks > 100, "no asteroid clumps generated (%d)" % rocks)
	assert_eq(total, rocks, "deep space should only contain asteroid blocks")
