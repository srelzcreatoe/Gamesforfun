extends TestCase
## Water/lava spreading, the infinite source rule, lava reactions and flow vectors.

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
	var stone := Registry.block_id("stone")
	for y in range(0, 61):
		for lz in 16:
			for lx in 16:
				col.set_cell(lx, y, lz, stone, 0)
	col.recompute_heightmap()
	w.manager.columns[Vector2i(0, 0)] = col
	w.invalidate_column_cache()
	w.sky = null
	w.fluids.enabled = false      # tests drive Fluids.tick()/settle() themselves
	world = w
	return w

func _level(w: Node, x: int, y: int, z: int) -> int:
	return w.get_block_meta(x, y, z) & BlockShapes.META_LEVEL

func test_water_spreads_to_level_7_and_stops() -> void:
	var w := _make_world()
	var water := Registry.block_id("water")
	w.set_block(8, 61, 8, water, Fluids.SOURCE)
	w.fluids.settle()
	assert_eq(w.get_block(8, 61, 8), water, "the source stays put")
	assert_eq(_level(w, 8, 61, 8), Fluids.SOURCE)
	assert_eq(w.get_block(7, 61, 8), water, "water spreads to its neighbour")
	assert_eq(_level(w, 7, 61, 8), 7, "the first ring is level 7")
	assert_eq(_level(w, 6, 61, 8), 6)
	assert_eq(_level(w, 2, 61, 8), 2, "level drops by one per block")
	assert_eq(_level(w, 1, 61, 8), 1, "spread 7 reaches 7 blocks")
	assert_eq(w.get_block(0, 61, 8), 0, "and stops there")
	assert_eq(w.get_block(8, 62, 8), 0, "water never flows upwards")

func test_water_falls_and_keeps_spreading_below() -> void:
	var w := _make_world()
	var water := Registry.block_id("water")
	# Dig a 1x1 shaft two blocks deep and pour water in from above.
	w.set_block(8, 60, 8, 0)
	w.set_block(8, 59, 8, 0)
	w.set_block(8, 61, 8, water, Fluids.SOURCE)
	w.fluids.settle()
	assert_eq(w.get_block(8, 60, 8), water, "water falls into the hole")
	assert_eq(w.get_block(8, 59, 8), water)
	assert_true((w.get_block_meta(8, 60, 8) & BlockShapes.META_FALLING) != 0, "falling flag is set")
	assert_eq(w.get_block(7, 59, 8), water, "and spreads along the floor of the hole")

func test_removing_the_source_drains_the_water() -> void:
	var w := _make_world()
	var water := Registry.block_id("water")
	w.set_block(8, 61, 8, water, Fluids.SOURCE)
	w.fluids.settle()
	assert_eq(w.get_block(5, 61, 8), water)
	w.set_block(8, 61, 8, 0)
	w.fluids.settle()
	assert_eq(w.get_block(5, 61, 8), 0, "flowing water disappears without a source")
	assert_eq(w.get_block(7, 61, 8), 0)

func test_infinite_source_rule() -> void:
	var w := _make_world()
	var water := Registry.block_id("water")
	# Two sources with a gap between them: the gap becomes a source too.
	w.set_block(6, 61, 8, water, Fluids.SOURCE)
	w.set_block(8, 61, 8, water, Fluids.SOURCE)
	w.fluids.settle()
	assert_eq(w.get_block(7, 61, 8), water)
	assert_eq(_level(w, 7, 61, 8), Fluids.SOURCE, "a cell between two sources becomes a source")

func test_lava_spread_is_shorter() -> void:
	var w := _make_world()
	var lava := Registry.block_id("lava")
	w.set_block(8, 61, 8, lava, Fluids.SOURCE)
	w.fluids.settle()
	assert_eq(_level(w, 7, 61, 8), 7, "lava also starts at 7")
	assert_eq(w.get_block(5, 61, 8), lava, "spread 3 reaches 3 blocks")
	assert_eq(w.get_block(4, 61, 8), 0, "and no further")

func test_water_turns_lava_into_stone() -> void:
	var w := _make_world()
	var water := Registry.block_id("water")
	var lava := Registry.block_id("lava")
	var obsidian := Registry.block_id("obsidian")
	var cobble := Registry.block_id("cobblestone")
	w.set_block(8, 61, 8, lava, Fluids.SOURCE)
	w.set_block(10, 61, 8, water, Fluids.SOURCE)
	w.fluids.settle()
	var at_lava := w.get_block(8, 61, 8)
	assert_true(at_lava == obsidian or at_lava == cobble or at_lava == Registry.block_id("stone"),
		"lava meeting water must solidify, got " + BlockTable.name_of(at_lava))

func test_flow_vector_points_downhill() -> void:
	var w := _make_world()
	var water := Registry.block_id("water")
	w.set_block(8, 61, 8, water, Fluids.SOURCE)
	w.fluids.settle()
	var flow: Vector3 = w.flow_at(7, 61, 8)
	assert_true(flow.length() > 0.5, "flowing water has a direction")
	assert_true(flow.x < -0.3, "the flow points away from the source, got %s" % str(flow))
	assert_eq(w.flow_at(8, 70, 8), Vector3.ZERO, "air has no flow")

func test_fluids_only_run_inside_sim_distance() -> void:
	var w := _make_world()
	w.set_view_center(Vector3(2000, 64, 2000))
	var water := Registry.block_id("water")
	w.set_block(8, 61, 8, water, Fluids.SOURCE)
	w.fluids.settle()
	assert_eq(w.get_block(7, 61, 8), 0, "cells far from the view centre are skipped")
