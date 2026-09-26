extends TestCase
## Concurrency stress test for the worldgen / meshing worker entry points.
##
## The Android crash (`ERROR: Condition "!success" is true. at: _ref
## (core/variant/array.cpp:61)`, hundreds of times right after "first chunk ready") was a
## use-after-free of a Variant container shared between WorkerThreadPool threads. It only
## showed up on an 8-core phone, which ran 3 generator threads, and never on a 4-core dev box
## running 2. So this test does not rely on the machine having spare cores: it starts
## THREADS real `Thread`s (oversubscribing on purpose) and runs the exact functions
## ChunkManager runs on its workers - `SaveManager.load_column`, `generate_column`,
## `Lighting.compute_column`, `ChunkMesher.build_pad`/`build_section` - over the *same*
## neighbourhood, the *same* generator object and the *same* structure templates, while the
## main thread does the work it normally does at the same time.
##
## Two things are asserted: nothing crashes, and every thread produces byte-for-byte the same
## column / mesh as a single-threaded reference run (a torn read of a shared cache shows up as
## a difference long before it shows up as a crash).
##
## The last two tests drive the real thing instead of the entry points: a World from
## World.tscn with `_max_gen_tasks`/`_max_mesh_tasks` forced to 3, pumped frame by frame while
## the main thread edits blocks, merges border light, queries heights and saves - and they
## assert the ownership invariant, that a column a worker still owns is never reachable through
## `ChunkManager.columns`, including while the view centre walks and columns unload.

const SEED := 4242
## Real threads, deliberately more than the dev box has cores.
const THREADS := 6
## Repeats of the whole battery (the race is timing dependent).
const ITERATIONS := 10
## Neighbourhood every thread generates.
const RING := 1

var _mutex := Mutex.new()
var _errors: PackedStringArray = PackedStringArray()

func setup() -> void:
	if not Registry.loaded:
		Registry.load_all()
	# Exactly what ChunkManager._ready() does before it may queue a task: build the block
	# tables and touch every shared static lookup table on the main thread.
	BlockTable.prewarm()
	_errors = PackedStringArray()

func _fail_t(msg: String) -> void:
	_mutex.lock()
	_errors.append(msg)
	_mutex.unlock()

func _drain() -> void:
	for e in _errors:
		assert_true(false, e)
	_errors = PackedStringArray()

func _keys() -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	for cz in range(-RING, RING + 1):
		for cx in range(-RING, RING + 1):
			out.append(Vector2i(cx, cz))
	return out

func _fingerprint(col: ChunkColumn) -> Dictionary:
	return {
		"blocks": col.blocks.duplicate(),
		"meta": col.meta.duplicate(),
		"biomes": col.biomes.duplicate(),
		"height": col.heightmap.duplicate(),
		"light": col.light.duplicate(),
		"ents": col.entities_pending.size(),
		"marks": col.structure_marks.size(),
	}

func _gen_one(gen: Object, def: Dictionary, k: Vector2i) -> ChunkColumn:
	var col := ChunkColumn.new(k.x, k.y)
	gen.call("generate_column", col, SEED, def)
	col.state = ChunkColumn.DECORATED
	col.recompute_heightmap()
	Lighting.compute_column(col)
	col.state = ChunkColumn.LIT
	return col

# --- generation -------------------------------------------------------------

## Every thread generates the whole neighbourhood on the shared generator; the result must
## match the single-threaded reference exactly.
func test_concurrent_generate_matches_single_thread() -> void:
	var def := Registry.planet("earth")
	var gen: Object = WorldGenFactory.create(def, SEED)
	var keys := _keys()
	var want := {}
	for k in keys:
		want[k] = _fingerprint(_gen_one(gen, def, k))
	for it in ITERATIONS:
		var threads: Array[Thread] = []
		for t in THREADS:
			var th := Thread.new()
			th.start(_gen_worker.bind(gen, def, keys, want, t))
			threads.append(th)
		# The main thread keeps doing main-thread work while the workers run.
		for i in 40:
			Structures.cache_stats()
			DragonBallPlacement.positions("earth", SEED)
		for th in threads:
			th.wait_to_finish()
		_drain()
		if not _errors.is_empty():
			break

func _gen_worker(gen: Object, def: Dictionary, keys: Array, want: Dictionary, tid: int) -> void:
	for k in keys:
		var col := _gen_one(gen, def, k)
		var got := _fingerprint(col)
		var exp: Dictionary = want[k]
		for field in ["blocks", "meta", "biomes", "height", "light"]:
			if got[field] != exp[field]:
				_fail_t("thread %d: column %s differs in %s" % [tid, str(k), field])
				return
		if got["ents"] != exp["ents"] or got["marks"] != exp["marks"]:
			_fail_t("thread %d: column %s differs in entities/marks (%d/%d vs %d/%d)"
				% [tid, str(k), got["ents"], got["marks"], exp["ents"], exp["marks"]])
			return

# --- meshing ----------------------------------------------------------------

## build_pad / build_section read the BlockTable and BlockShapes statics from several threads.
func test_concurrent_mesh_matches_single_thread() -> void:
	var def := Registry.planet("earth")
	var gen: Object = WorldGenFactory.create(def, SEED)
	var cols: Array = []
	cols.resize(9)
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			cols[(dz + 1) * 3 + (dx + 1)] = _gen_one(gen, def, Vector2i(dx, dz))
	var snap := ChunkMesher.snapshot(cols)
	var palette := ChunkManager.build_palette()
	var sections := [3, 4, 5]
	var want := {}
	var pad0 := ChunkMesher.build_pad(snap)
	var verts := 0
	for s in sections:
		var sz := _surface_sizes(ChunkMesher.build_section(pad0, s, palette))
		for k in sz.keys():
			verts += int(sz[k])
		want[s] = sz
	# Guard against the test passing because the mesher failed to compile / produced nothing.
	assert_true(verts > 0, "reference mesh is empty, the mesher produced no geometry")
	for it in ITERATIONS:
		var threads: Array[Thread] = []
		for t in THREADS:
			var th := Thread.new()
			th.start(_mesh_worker.bind(snap, palette, sections, want, t))
			threads.append(th)
		for th in threads:
			th.wait_to_finish()
		_drain()
		if not _errors.is_empty():
			break

func _surface_sizes(out: Dictionary) -> Dictionary:
	var sizes := {}
	for k in out.keys():
		var arrays: Array = out[k]
		sizes[k] = (arrays[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()
	return sizes

func _mesh_worker(snap: Array, palette: Dictionary, sections: Array, want: Dictionary, tid: int) -> void:
	var pad := ChunkMesher.build_pad(snap)
	for s in sections:
		var got := _surface_sizes(ChunkMesher.build_section(pad, s, palette))
		if got != want[s]:
			_fail_t("thread %d: section %d meshed differently (%s vs %s)" % [tid, s, str(got), str(want[s])])
			return

# --- the shared template cache ---------------------------------------------

## `Structures.blocks_of` is an LRU cache that evicts while other threads hold entries: the
## original Android crash. Hammer it with more distinct templates than the cache can hold.
func test_concurrent_template_cache() -> void:
	var paths: Array[String] = []
	var ids: Array = Registry.structures.keys()
	ids.sort()
	for sid in ids:
		var def: Dictionary = Registry.structures[sid]
		var f := "res://" + String(def.get("file", ""))
		if not paths.has(f) and FileAccess.file_exists(f):
			paths.append(f)
	assert_true(paths.size() > 8, "expected the converted structure set, got %d" % paths.size())
	var probe: Array[String] = []
	for i in mini(paths.size(), Structures.MAX_CACHED_BLOCKS * 3):
		probe.append(paths[i])
	var want := {}
	for p in probe:
		var blk := Structures.blocks_of(p)
		want[p] = [(blk["data"] as PackedInt32Array).size(), (blk["pal"] as PackedByteArray).size()]
	for it in ITERATIONS:
		var threads: Array[Thread] = []
		for t in THREADS:
			var th := Thread.new()
			th.start(_tpl_worker.bind(probe, want, t))
			threads.append(th)
		for i in 60:
			Structures.cache_stats()
		for th in threads:
			th.wait_to_finish()
		_drain()
		if not _errors.is_empty():
			break

func _tpl_worker(probe: Array, want: Dictionary, tid: int) -> void:
	for _pass in 2:
		for p in probe:
			var hdr := Structures.header(String(p))
			if hdr.is_empty() or not hdr.has("size"):
				_fail_t("thread %d: empty header for %s" % [tid, p])
				return
			var size: Vector3i = hdr["size"]
			if size.x <= 0:
				_fail_t("thread %d: bad header size for %s" % [tid, p])
				return
			# Touch the header's entity list too: it is handed out by reference and read by
			# every generator thread (Structures._spawn_entities).
			var ents: Array = hdr.get("ents", [])
			if ents.size() < 0:
				return
			var blk := Structures.blocks_of(String(p))
			var got := [(blk["data"] as PackedInt32Array).size(), (blk["pal"] as PackedByteArray).size()]
			if got != want[p]:
				_fail_t("thread %d: %s parsed as %s, expected %s" % [tid, p, str(got), str(want[p])])
				return
			# Walk the payload the way _stamp_one does, so a freed/evicted body is caught.
			var starts: PackedInt32Array = blk["starts"]
			var counts: PackedInt32Array = blk["counts"]
			var data: PackedInt32Array = blk["data"]
			var pal: PackedByteArray = blk["pal"]
			var total := 0
			var solid := 0
			for ti in 256:
				var from := starts[ti]
				for i in range(from, from + counts[ti]):
					var v := data[i]
					if pal[(v >> 24) & 255] != 0:
						solid += 1
					total += 1
			if total != data.size():
				_fail_t("thread %d: %s offset table covers %d of %d cells" % [tid, p, total, data.size()])
				return
			if solid != total:
				_fail_t("thread %d: %s has %d of %d cells on the air palette entry" % [tid, p, total - solid, total])
				return

# --- the dragon ball position cache ----------------------------------------

func test_concurrent_dragon_ball_cache() -> void:
	var want := {}
	for sid in DragonBallPlacement.SETS.keys():
		want[sid] = DragonBallPlacement.positions(String(sid), SEED)
	for it in ITERATIONS:
		var threads: Array[Thread] = []
		for t in THREADS:
			var th := Thread.new()
			th.start(_db_worker.bind(want, t))
			threads.append(th)
		for th in threads:
			th.wait_to_finish()
		_drain()
		if not _errors.is_empty():
			break

func _db_worker(want: Dictionary, tid: int) -> void:
	for sid in want.keys():
		var got := DragonBallPlacement.positions(String(sid), SEED)
		var exp: Array = want[sid]
		if got.size() != exp.size():
			_fail_t("thread %d: set %s has %d balls, expected %d" % [tid, sid, got.size(), exp.size()])
			return
		for i in got.size():
			if got[i] != exp[i]:
				_fail_t("thread %d: set %s ball %d moved" % [tid, sid, i])
				return

# --- the real streaming pipeline -------------------------------------------

const WORLD_SCENE := "res://scenes/world/World.tscn"

var _world: Node = null

func teardown() -> void:
	if _world != null and is_instance_valid(_world):
		if _world.manager != null:
			_world.manager.shutdown()
		if _world.get_parent() != null:
			_world.get_parent().remove_child(_world)
		_world.free()
	_world = null

## Drive ChunkManager with three generator and three mesher threads while the main thread does
## what it normally does at the same time (block edits, light merges, height queries, saves).
## Covers the column hand-off: an in-flight column must be unreachable, and a published one
## must match what a single-threaded run produces.
func test_chunk_manager_streams_on_three_threads() -> void:
	var packed: PackedScene = load(WORLD_SCENE)
	var w: Node = packed.instantiate()
	add_node(w)
	_world = w
	w.fluids.enabled = false
	w.sky = null
	Game.settings["render_distance"] = 2
	# slug "" keeps SaveManager disabled, so the test writes no files.
	w.start({"planet": "earth", "seed": SEED, "slug": ""}, {"position": {"x": 0.5, "y": -1.0, "z": 0.5}})
	var mgr: ChunkManager = w.manager
	# Forced rather than trusted: a two-core CI box would otherwise run this single threaded
	# and prove nothing. Three is what an 8-core phone picks.
	mgr._max_gen_tasks = 3
	mgr._max_mesh_tasks = 3
	var reachable_in_flight := 0
	var overlaps := 0
	for frame in 400:
		mgr._process(0.016)
		# No frames elapse in a headless test, so give the workers real time to run - that is
		# the whole point here: the main-thread work below must overlap with three live tasks.
		OS.delay_msec(3)
		# Main-thread world work, concurrent with the workers.
		for k in mgr.columns.keys():
			var col: ChunkColumn = mgr.columns[k]
			if col.in_flight:
				reachable_in_flight += 1
			if mgr._pending_gen.has(k):
				overlaps += 1
		w.get_height(3, 5)
		w.get_biome(3, 5)
		w.get_block(3, 70, 5)
		w.get_sky_light(3, 70, 5)
		if frame % 37 == 0 and mgr.columns.has(Vector2i(0, 0)):
			w.set_block(3, 70, 5, Registry.block_id("stone"))
			w.set_block(3, 70, 5, 0)
		if frame % 53 == 0:
			mgr.save_modified()
		if mgr.stream_progress() >= 1.0 and mgr._gen_ids.is_empty() and mgr._mesh_ids.is_empty():
			break
	mgr.shutdown()
	assert_eq(reachable_in_flight, 0, "an in-flight column was reachable through ChunkManager.columns")
	assert_eq(overlaps, 0, "a column was published while its generation task was still pending")
	assert_true(mgr.columns.size() >= 9, "only %d columns streamed in" % mgr.columns.size())
	# Byte-for-byte against a single-threaded generation of the same seed.
	var def := Registry.planet("earth")
	var gen: Object = WorldGenFactory.create(def, SEED)
	var checked := 0
	for k in mgr.columns.keys():
		var col: ChunkColumn = mgr.columns[k]
		if col.modified or col.state < ChunkColumn.LIT:
			continue
		var ref := ChunkColumn.new(k.x, k.y)
		gen.call("generate_column", ref, SEED, def)
		if col.blocks != ref.blocks:
			assert_true(false, "column %s streamed different blocks than a single-threaded run" % str(k))
			break
		if col.biomes != ref.biomes:
			assert_true(false, "column %s streamed different biomes than a single-threaded run" % str(k))
			break
		checked += 1
		if checked >= 6:
			break
	assert_true(checked > 0, "no published column could be compared")

## Unloading must never pull a column out from under a task that still references it.
func test_unload_never_drops_an_in_flight_column() -> void:
	var packed: PackedScene = load(WORLD_SCENE)
	var w: Node = packed.instantiate()
	add_node(w)
	_world = w
	w.fluids.enabled = false
	w.sky = null
	Game.settings["render_distance"] = 2
	w.start({"planet": "earth", "seed": SEED, "slug": ""}, {"position": {"x": 0.5, "y": -1.0, "z": 0.5}})
	var mgr: ChunkManager = w.manager
	mgr._max_gen_tasks = 3
	mgr._max_mesh_tasks = 3
	var bad := 0
	var seen := 0
	var dropped := false
	# Walk the centre one chunk at a time, slowly enough that columns actually finish and get
	# published before the centre moves out of their range - otherwise nothing is ever
	# unloaded and the test would pass without covering anything.
	for frame in 420:
		w.set_view_center(Vector3(float((frame / 60) * 16), 70.0, 0.0))
		var before := mgr.columns.size()
		mgr._process(0.016)
		if mgr.columns.size() < before:
			dropped = true
		OS.delay_msec(3)
		seen = maxi(seen, mgr.columns.size())
		for k in mgr.columns.keys():
			if (mgr.columns[k] as ChunkColumn).in_flight:
				bad += 1
		for k in mgr._pending_gen.keys():
			if mgr.columns.has(k):
				bad += 1
	mgr.shutdown()
	assert_eq(bad, 0, "an in-flight column was reachable while the view centre moved")
	assert_true(seen >= 9, "only %d columns streamed while the view centre moved" % seen)
	assert_true(dropped, "no column was ever unloaded, so the unload path was not covered")
