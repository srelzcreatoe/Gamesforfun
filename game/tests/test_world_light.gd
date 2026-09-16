extends TestCase
## Sky light flood fill, block light BFS and incremental relighting.

const WORLD_SCENE := "res://scenes/world/World.tscn"

var world: Node = null

func setup() -> void:
	if not BlockTable.built:
		BlockTable.build()

func teardown() -> void:
	if world != null and is_instance_valid(world):
		world.get_parent().remove_child(world)
		world.free()
	world = null

func _make_world() -> Node:
	var packed: PackedScene = load(WORLD_SCENE)
	var w: Node = packed.instantiate()
	add_node(w)
	var col := ChunkColumn.new(0, 0)
	col.state = ChunkColumn.LIT
	w.manager.columns[Vector2i(0, 0)] = col
	w.invalidate_column_cache()
	w.fluids.enabled = false
	# The SkyController only updates its cached daylight from World._process, which does not
	# run in tests, so use World's own day/night curve here.
	w.sky = null
	world = w
	return w

func _fill_ground(col: ChunkColumn, top_y: int) -> void:
	var stone := Registry.block_id("stone")
	for y in range(0, top_y + 1):
		for lz in 16:
			for lx in 16:
				col.set_cell(lx, y, lz, stone, 0)
	col.recompute_heightmap()

# --- sky light --------------------------------------------------------------

func test_sky_light_above_ground_is_full() -> void:
	var col := ChunkColumn.new(0, 0)
	_fill_ground(col, 63)
	Lighting.compute_column(col)
	assert_eq(col.get_sky_light(8, 64, 8), 15, "the first air cell above ground is fully lit")
	assert_eq(col.get_sky_light(8, 100, 8), 15, "open sky stays 15")
	assert_eq(col.get_sky_light(8, 63, 8), 0, "solid ground gets no sky light")

func test_sky_light_is_zero_under_three_opaque_blocks() -> void:
	var col := ChunkColumn.new(0, 0)
	_fill_ground(col, 62)
	var stone := Registry.block_id("stone")
	# Roof of three solid layers over the whole column with an air gap below it.
	for y in range(64, 67):
		for lz in 16:
			for lx in 16:
				col.set_cell(lx, y, lz, stone, 0)
	col.recompute_heightmap()
	Lighting.compute_column(col)
	assert_eq(col.get_sky_light(8, 67, 8), 15, "above the roof it is bright")
	assert_eq(col.get_sky_light(8, 63, 8), 0, "no sky light reaches under 3 opaque blocks")

func test_sky_light_decays_sideways_into_a_cave() -> void:
	var col := ChunkColumn.new(0, 0)
	_fill_ground(col, 71)
	var air := 0
	# Roofed tunnel at y = 70 from x = 0 to x = 6, with a hole in the roof above x = 0.
	for x in 7:
		col.set_cell(x, 70, 8, air, 0)
	col.set_cell(0, 71, 8, air, 0)
	col.recompute_heightmap()
	Lighting.compute_column(col)
	var a := col.get_sky_light(0, 70, 8)
	var b := col.get_sky_light(3, 70, 8)
	assert_true(a > b, "light must fall off along the tunnel (%d -> %d)" % [a, b])
	assert_eq(col.get_sky_light(6, 70, 8), maxi(0, a - 6), "one level per block")

func test_water_attenuates_sky_light() -> void:
	var col := ChunkColumn.new(0, 0)
	_fill_ground(col, 50)
	var water := Registry.block_id("water")
	for y in range(51, 62):
		for lz in 16:
			for lx in 16:
				col.set_cell(lx, y, lz, water, Fluids.SOURCE)
	col.recompute_heightmap()
	Lighting.compute_column(col)
	assert_eq(col.get_sky_light(8, 61, 8), 15, "the water surface is fully lit")
	assert_eq(col.get_sky_light(8, 60, 8), 13, "light_attenuation 2 per water block")
	assert_eq(col.get_sky_light(8, 59, 8), 11)
	assert_eq(col.get_sky_light(8, 53, 8), 0, "deep water is dark")

# --- block light ------------------------------------------------------------

func test_torch_block_light() -> void:
	var col := ChunkColumn.new(0, 0)
	_fill_ground(col, 63)
	var torch := Registry.block_id("torch")
	col.set_cell(8, 64, 8, torch, 0)
	col.recompute_heightmap()
	Lighting.compute_column(col)
	assert_eq(col.get_block_light(8, 64, 8), 14, "a torch emits 14")
	assert_eq(col.get_block_light(9, 64, 8), 13, "one level per block")
	assert_eq(col.get_block_light(10, 64, 8), 12)
	assert_eq(col.get_block_light(8, 64 + 14, 8), 0, "the light runs out after 14 blocks")

func test_glowstone_light_is_blocked_by_walls() -> void:
	var col := ChunkColumn.new(0, 0)
	_fill_ground(col, 63)
	var glow := Registry.block_id("glowstone")
	var stone := Registry.block_id("stone")
	col.set_cell(8, 65, 8, glow, 0)
	for f in 6:
		var d: Vector3i = BlockShapes.FACE_DIR[f]
		col.set_cell(8 + d.x, 65 + d.y, 8 + d.z, stone, 0)
	col.recompute_heightmap()
	Lighting.compute_column(col)
	assert_eq(col.get_block_light(8, 65, 8), 15)
	assert_eq(col.get_block_light(8, 67, 8), 0, "walled-in light does not escape")

# --- incremental relight ----------------------------------------------------

func test_relight_after_placing_and_removing_a_torch() -> void:
	var w := _make_world()
	var col: ChunkColumn = w.get_column(0, 0)
	_fill_ground(col, 63)
	Lighting.compute_column(col)
	var torch := Registry.block_id("torch")
	w.set_block(8, 64, 8, torch)
	assert_eq(w.get_block_light(8, 64, 8), 14, "placing a torch lights its cell")
	assert_eq(w.get_block_light(10, 64, 8), 12, "and its surroundings")
	w.set_block(8, 64, 8, 0)
	assert_eq(w.get_block_light(8, 64, 8), 0, "removing it clears the light")
	assert_eq(w.get_block_light(10, 64, 8), 0)

func test_relight_after_building_a_roof() -> void:
	var w := _make_world()
	var col: ChunkColumn = w.get_column(0, 0)
	_fill_ground(col, 63)
	Lighting.compute_column(col)
	assert_eq(w.get_sky_light(8, 64, 8), 15)
	var stone := Registry.block_id("stone")
	# Roof over a 5x5 area, 3 blocks above the ground.
	for lz in range(6, 11):
		for lx in range(6, 11):
			w.set_block(lx, 67, lz, stone)
	assert_true(w.get_sky_light(8, 64, 8) < 15, "the cell under the roof lost direct sunlight")
	assert_eq(w.get_sky_light(8, 100, 8), 15, "the sky above is unaffected")
	# Tearing the roof down brings the sunlight back.
	for lz in range(6, 11):
		for lx in range(6, 11):
			w.set_block(lx, 67, lz, 0)
	assert_eq(w.get_sky_light(8, 64, 8), 15, "sky light returns when the roof is removed")

func test_light_crosses_chunk_borders() -> void:
	var w := _make_world()
	var a: ChunkColumn = w.get_column(0, 0)
	var b := ChunkColumn.new(1, 0)
	b.state = ChunkColumn.LIT
	w.manager.columns[Vector2i(1, 0)] = b
	w.invalidate_column_cache()
	# Both columns are solid up to y = 71; a roofed tunnel at y = 70 runs from the hole above
	# a's x = 8 through the chunk border into b.
	_fill_ground(a, 71)
	_fill_ground(b, 71)
	for x in range(8, 16):
		a.set_cell(x, 70, 8, 0, 0)
	for x in 16:
		b.set_cell(x, 70, 8, 0, 0)
	a.set_cell(8, 71, 8, 0, 0)
	a.recompute_heightmap()
	b.recompute_heightmap()
	Lighting.compute_column(a)
	Lighting.compute_column(b)
	assert_eq(w.get_sky_light(16, 70, 8), 0, "the neighbour starts dark")
	Lighting.merge_borders(w, b)
	var here := w.get_sky_light(15, 70, 8)
	var there := w.get_sky_light(16, 70, 8)
	assert_true(there == maxi(0, here - 1) and there > 0,
		"light must flow across the border (%d -> %d)" % [here, there])

func test_world_get_light_mixes_sky_and_block() -> void:
	var w := _make_world()
	var col: ChunkColumn = w.get_column(0, 0)
	_fill_ground(col, 63)
	Lighting.compute_column(col)
	w.time_ticks = 6000.0             # noon
	assert_eq(w.get_light(8, 64, 8), 15, "noon sky light is full")
	w.time_ticks = 18000.0            # midnight
	assert_true(w.get_light(8, 64, 8) < 8, "at midnight the sky barely lights anything")
	w.set_block(8, 64, 8, Registry.block_id("glowstone"))
	assert_eq(w.get_light(8, 65, 8), 14, "block light is independent of the time of day")
