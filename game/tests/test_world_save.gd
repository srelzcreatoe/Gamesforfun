extends TestCase
## SaveManager: per-column round trip, "modified only" behaviour and corrupt-file recovery.

const SLUG := "__test_voxel__"
const PLANET := "earth"

var sm: SaveManager = null

func setup() -> void:
	if not BlockTable.built:
		BlockTable.build()
	sm = SaveManager.new()
	sm.setup(SLUG, PLANET)

func teardown() -> void:
	_rm_rf("user://worlds/" + SLUG)
	sm = null

func _rm_rf(path: String) -> void:
	var d := DirAccess.open(path)
	if d == null:
		return
	d.list_dir_begin()
	var n := d.get_next()
	while n != "":
		var p := path.path_join(n)
		if d.current_is_dir():
			_rm_rf(p)
		else:
			DirAccess.remove_absolute(p)
		n = d.get_next()
	d.list_dir_end()
	DirAccess.remove_absolute(path)

func _sample_column(cx: int, cz: int) -> ChunkColumn:
	var col := ChunkColumn.new(cx, cz)
	var stone := Registry.block_id("stone")
	var water := Registry.block_id("water")
	for y in range(0, 60):
		for lz in 16:
			for lx in 16:
				col.set_cell(lx, y, lz, stone, 0)
	col.set_cell(3, 60, 4, water, Fluids.SOURCE)
	col.set_cell(3, 61, 4, Registry.block_id("glowstone"), 0)
	col.set_biome(3, 4, 2)
	col.recompute_heightmap()
	col.modified = true
	return col

func test_save_and_load_roundtrip() -> void:
	var col := _sample_column(3, -2)
	assert_true(sm.save_column(col), "saving must succeed")
	assert_true(sm.has_column(3, -2))
	assert_true(not col.modified, "saving clears the modified flag")
	var back := ChunkColumn.new(3, -2)
	assert_true(sm.load_column(back), "loading must succeed")
	assert_true(back.from_disk)
	assert_eq(back.get_block(3, 60, 4), Registry.block_id("water"))
	assert_eq(back.get_meta(3, 60, 4), Fluids.SOURCE)
	assert_eq(back.get_block(3, 61, 4), Registry.block_id("glowstone"))
	assert_eq(back.get_block(0, 0, 0), Registry.block_id("stone"))
	assert_eq(back.get_block(0, 100, 0), 0)
	assert_eq(back.biome_index(3, 4), 2)
	assert_eq(back.get_height(3, 4), 62, "the heightmap is rebuilt on load")
	# Light is not stored; it is recomputed.
	Lighting.compute_column(back)
	assert_eq(back.get_block_light(3, 61, 4), 15, "glowstone lights the reloaded column")

func test_unsaved_columns_are_not_on_disk() -> void:
	assert_true(not sm.has_column(9, 9))
	var fresh := ChunkColumn.new(9, 9)
	assert_true(not sm.load_column(fresh), "a column that was never saved does not load")

func test_save_all_writes_only_modified_columns() -> void:
	var a := _sample_column(0, 0)
	var b := _sample_column(1, 0)
	b.modified = false
	var columns := {Vector2i(0, 0): a, Vector2i(1, 0): b}
	assert_eq(sm.save_all(columns), 1, "only the modified column is written")
	assert_true(sm.has_column(0, 0))
	assert_true(not sm.has_column(1, 0))

func test_corrupt_file_is_discarded() -> void:
	var col := _sample_column(5, 5)
	sm.save_column(col)
	var path := sm.column_path(5, 5)
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string("this is not a chunk")
	f.close()
	var back := ChunkColumn.new(5, 5)
	assert_true(not sm.load_column(back), "a corrupt file must not load")
	assert_true(not FileAccess.file_exists(path), "and is removed so the column regenerates")

func test_edits_survive_a_reload() -> void:
	# Mimics Game.save_all() + reopening the world.
	var col := ChunkColumn.new(-1, 7)
	var stone := Registry.block_id("stone")
	for y in range(0, 40):
		for lz in 16:
			for lx in 16:
				col.set_cell(lx, y, lz, stone, 0)
	col.recompute_heightmap()
	col.set_cell(2, 40, 2, Registry.block_id("oak_planks"), 0)
	col.set_cell(2, 41, 2, Registry.block_id("torch"), 0)
	col.modified = true
	sm.save_column(col)
	var sm2 := SaveManager.new()
	sm2.setup(SLUG, PLANET)
	var back := ChunkColumn.new(-1, 7)
	assert_true(sm2.load_column(back))
	assert_eq(back.get_block(2, 40, 2), Registry.block_id("oak_planks"), "player edits are kept")
	assert_eq(back.get_block(2, 41, 2), Registry.block_id("torch"))
