extends TestCase
## Static-memory budget of starting a world: Android's low-memory killer took the game down on
## the loading screen when every structure template was parsed into Dictionaries/Arrays
## (12.6 MB of JSON cost ~230 MB). The generator must now add only a few MB.

const SEED := 4242
## Budget for "create the generator + generate the 5x5 spawn ring" (the phone case).
const RING_BUDGET_MB := 25.0

func _mb(bytes: float) -> float:
	return bytes / 1048576.0

func _static_mb() -> float:
	return _mb(float(Performance.get_monitor(Performance.MEMORY_STATIC)))

func test_world_start_memory_budget() -> void:
	Structures.release_cache()
	var def := Registry.planet("earth")
	var before := _static_mb()
	var gen: Object = WorldGenFactory.create(def, SEED)
	var after_configure := _static_mb()
	for cz in range(-2, 3):
		for cx in range(-2, 3):
			var col := ChunkColumn.new(cx, cz)
			gen.call("generate_column", col, SEED, def)
	var after_ring := _static_mb()
	var stats := Structures.cache_stats()
	print("      MEMORY_STATIC: start %.1f MB | after configure %.1f MB (+%.1f) | after 5x5 ring %.1f MB (+%.1f)"
		% [before, after_configure, after_configure - before, after_ring, after_ring - before])
	print("      template cache: %d bodies, %.2f MB, %d headers"
		% [int(stats["templates"]), _mb(float(stats["bytes"])), int(stats["headers"])])
	assert_true(after_ring - before < RING_BUDGET_MB,
		"world start added %.1f MB of static memory (budget %.1f)" % [after_ring - before, RING_BUDGET_MB])
	assert_true(int(stats["templates"]) <= Structures.MAX_CACHED_BLOCKS,
		"template cache holds %d bodies, cap is %d" % [int(stats["templates"]), Structures.MAX_CACHED_BLOCKS])

func test_template_cache_is_bounded() -> void:
	Structures.release_cache()
	var paths: Array[String] = []
	for sid in Registry.structures.keys():
		var def: Dictionary = Registry.structures[sid]
		var f := "res://" + String(def.get("file", ""))
		if not paths.has(f):
			paths.append(f)
	assert_true(paths.size() > 20, "expected the converted structure set")
	var before := _static_mb()
	for p in paths:
		var blk := Structures.blocks_of(p)
		assert_true(blk.has("data"), "no block data for " + p)
	var after := _static_mb()
	var stats := Structures.cache_stats()
	print("      loading all %d template bodies one after another: %+.1f MB static, cache %d bodies / %.2f MB"
		% [paths.size(), after - before, int(stats["templates"]), _mb(float(stats["bytes"]))])
	assert_true(int(stats["templates"]) <= Structures.MAX_CACHED_BLOCKS, "cache is not bounded")
	assert_true(float(stats["bytes"]) <= float(Structures.MAX_CACHE_BYTES) + 1048576.0,
		"cache bytes %d over the cap" % int(stats["bytes"]))
	assert_true(after - before < 40.0,
		"walking every template still cost %.1f MB of static memory" % [after - before])

func test_headers_are_cheap_and_correct() -> void:
	# The header read must agree with a full parse (it drives every footprint decision).
	for sid in ["roshi_house", "capsule_corp", "frieza_ship", "rr_tower", "snake_way"]:
		var def: Dictionary = Registry.structures.get(sid, {})
		if def.is_empty():
			continue
		var path := "res://" + String(def.get("file", ""))
		var hdr := Structures.header(path)
		assert_true(not hdr.is_empty(), "no header for " + sid)
		var raw: Variant = JsonUtil.load_file(path)
		assert_true(raw is Dictionary, "cannot read " + path)
		var d: Dictionary = raw
		var size: Array = d["size"]
		var off: Array = d.get("origin_offset", [0, 0, 0])
		assert_eq(hdr["size"], Vector3i(int(size[0]), int(size[1]), int(size[2])),
			"%s: header size differs" % sid)
		assert_eq(hdr["off"], Vector3i(int(off[0]), int(off[1]), int(off[2])),
			"%s: header origin_offset differs" % sid)
		assert_eq(bool(hdr["clear"]), bool(d.get("clear_box", false)), "%s: clear_box differs" % sid)
		assert_eq((hdr["ents"] as Array).size(), (d.get("entities", []) as Array).size(),
			"%s: entity list differs" % sid)

func test_chunked_parse_matches_a_full_json_parse() -> void:
	# Determinism guard: the streaming loader must produce exactly the blocks the JSON has.
	for sid in ["capsule_corp", "gero_lab", "trunks_ship", "rr_tower"]:
		var def: Dictionary = Registry.structures.get(sid, {})
		if def.is_empty():
			continue
		var path := "res://" + String(def.get("file", ""))
		var blk := Structures.blocks_of(path)
		var data: PackedInt32Array = blk["data"]
		var pal: PackedByteArray = blk["pal"]
		var raw: Variant = JsonUtil.load_file(path)
		var d: Dictionary = raw
		var expect := {}
		var pal_names: Array = d["palette"]
		for b in d["blocks"]:
			var bid := Registry.block_id(String(pal_names[int(b[3])]))
			if bid <= 0:
				continue
			expect[Vector3i(int(b[0]), int(b[1]), int(b[2]))] = bid
		assert_eq(data.size(), expect.size(), "%s: %d cells parsed, %d in the file" % [sid, data.size(), expect.size()])
		for i in data.size():
			var v := data[i]
			var pos := Vector3i(v & 255, (v >> 8) & 255, (v >> 16) & 255)
			assert_eq(int(pal[(v >> 24) & 255]), int(expect.get(pos, -1)),
				"%s: wrong block at %s" % [sid, str(pos)])
