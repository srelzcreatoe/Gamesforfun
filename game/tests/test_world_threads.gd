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
	if not BlockTable.built:
		BlockTable.build()
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
	for s in sections:
		want[s] = _surface_sizes(ChunkMesher.build_section(pad0, s, palette))
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
	for pass_i in 2:
		for p in probe:
			var hdr := Structures.header(String(p))
			if hdr.is_empty() or not hdr.has("size"):
				_fail_t("thread %d: empty header for %s" % [tid, p])
				return
			var size: Vector3i = hdr["size"]
			if size.x <= 0:
				_fail_t("thread %d: bad header size for %s" % [tid, p])
				return
			var ents: Array = hdr.get("ents", [])
			ents.size()
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
			for ti in 256:
				var from := starts[ti]
				for i in range(from, from + counts[ti]):
					var v := data[i]
					if pal[(v >> 24) & 255] == 0 and false:
						return
					total += 1
			if total != data.size():
				_fail_t("thread %d: %s offset table covers %d of %d cells" % [tid, p, total, data.size()])
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
