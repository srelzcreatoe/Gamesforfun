extends TestCase
## Index maths, block get/set round trip, raycasting and AABB physics.

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

## A World node with one hand-made column at (0, 0) and no streaming.
func _make_world() -> Node:
	var packed: PackedScene = load(WORLD_SCENE)
	var w: Node = packed.instantiate()
	add_node(w)
	var col := ChunkColumn.new(0, 0)
	col.state = ChunkColumn.LIT
	w.manager.columns[Vector2i(0, 0)] = col
	w.invalidate_column_cache()
	w.fluids.enabled = false
	world = w
	return w

func _flat_floor(w: Node, top_y: int, id_name := "stone") -> void:
	var id := Registry.block_id(id_name)
	var col: ChunkColumn = w.get_column(0, 0)
	for y in range(0, top_y + 1):
		for lz in 16:
			for lx in 16:
				col.set_cell(lx, y, lz, id, 0)
	col.recompute_heightmap()

# --- index maths ------------------------------------------------------------

func test_index_is_y_major() -> void:
	assert_eq(WorldConst.index(0, 0, 0), 0)
	assert_eq(WorldConst.index(15, 0, 0), 15)
	assert_eq(WorldConst.index(0, 0, 1), 16)
	assert_eq(WorldConst.index(0, 1, 0), 256)
	assert_eq(WorldConst.index(15, 127, 15), WorldConst.COLUMN_VOLUME - 1)
	# A 16-high section must be one contiguous 4096 byte range.
	assert_eq(WorldConst.index(0, 16, 0), WorldConst.SECTION_VOLUME)
	assert_eq(WorldConst.section_of(31), 1)
	assert_eq(WorldConst.chunk_coord(-1), -1)
	assert_eq(WorldConst.local_coord(-1), 15)

func test_column_roundtrip() -> void:
	var col := ChunkColumn.new(2, -3)
	col.set_cell(3, 70, 9, 17, 5)
	assert_eq(col.get_block(3, 70, 9), 17)
	assert_eq(col.get_block_meta(3, 70, 9), 5)
	assert_eq(col.get_block(3, 71, 9), 0)
	col.set_sky_light(3, 70, 9, 12)
	col.set_block_light(3, 70, 9, 7)
	assert_eq(col.get_sky_light(3, 70, 9), 12)
	assert_eq(col.get_block_light(3, 70, 9), 7)
	col.recompute_heightmap()
	assert_eq(col.get_height(3, 9), 71)
	assert_eq(col.key(), Vector2i(2, -3))

func test_world_set_get_block() -> void:
	var w := _make_world()
	_flat_floor(w, 60)
	var stone := Registry.block_id("stone")
	var glow := Registry.block_id("glowstone")
	assert_eq(w.get_block(4, 60, 4), stone)
	assert_eq(w.get_block(4, 61, 4), 0)
	w.set_block(4, 61, 4, glow, 0)
	assert_eq(w.get_block(4, 61, 4), glow)
	assert_eq(w.get_block_v(Vector3i(4, 61, 4)), glow)
	assert_eq(w.get_height(4, 4), 62)
	assert_true(w.get_column(0, 0).modified, "editing must mark the column for saving")
	# Outside the loaded area everything reads as air.
	assert_eq(w.get_block(500, 61, 500), 0)
	assert_eq(w.get_block_raw(500, 61, 500), -1)
	assert_true(w.is_solid(4, 60, 4))
	assert_true(not w.is_solid(4, 70, 4))

func test_block_changed_signal() -> void:
	var w := _make_world()
	_flat_floor(w, 60)
	var got: Array = []
	var cb := func(pos: Vector3i, old_id: int, new_id: int) -> void:
		got.append([pos, old_id, new_id])
	Events.block_changed.connect(cb)
	w.set_block(1, 61, 1, Registry.block_id("stone"))
	Events.block_changed.disconnect(cb)
	assert_eq(got.size(), 1)
	if got.size() == 1:
		assert_eq(got[0][0], Vector3i(1, 61, 1))
		assert_eq(got[0][2], Registry.block_id("stone"))

# --- raycast ----------------------------------------------------------------

func test_raycast_hits_block_and_face() -> void:
	var w := _make_world()
	_flat_floor(w, 60)
	var hit: Dictionary = w.raycast(Vector3(8.5, 66.0, 8.5), Vector3(0, -1, 0), 20.0)
	assert_true(hit["hit"], "ray must hit the floor")
	assert_eq(hit["block"], Vector3i(8, 60, 8))
	assert_eq(hit["normal"], Vector3i(0, 1, 0))
	assert_near(hit["dist"], 5.0, 0.01)
	assert_eq(hit["id"], Registry.block_id("stone"))
	# A ray into the sky misses.
	var miss: Dictionary = w.raycast(Vector3(8.5, 66.0, 8.5), Vector3(0, 1, 0), 20.0)
	assert_true(not miss["hit"])
	# Side faces.
	w.set_block(10, 61, 8, Registry.block_id("stone"))
	var side: Dictionary = w.raycast(Vector3(8.5, 61.5, 8.5), Vector3(1, 0, 0), 6.0)
	assert_true(side["hit"])
	assert_eq(side["block"], Vector3i(10, 61, 8))
	assert_eq(side["normal"], Vector3i(-1, 0, 0))

func test_raycast_ignores_liquid_when_asked() -> void:
	var w := _make_world()
	_flat_floor(w, 60)
	var water := Registry.block_id("water")
	w.set_block(8, 61, 8, water, Fluids.SOURCE)
	var through: Dictionary = w.raycast(Vector3(8.5, 66.0, 8.5), Vector3(0, -1, 0), 20.0, true)
	assert_eq(through["block"], Vector3i(8, 60, 8), "liquids are skipped by default")
	var stop: Dictionary = w.raycast(Vector3(8.5, 66.0, 8.5), Vector3(0, -1, 0), 20.0, false)
	assert_eq(stop["block"], Vector3i(8, 61, 8), "ignore_liquid = false stops at the water")

# --- physics ----------------------------------------------------------------

func _player_box(pos: Vector3) -> AABB:
	return AABB(pos - Vector3(0.3, 0.0, 0.3), Vector3(0.6, 1.8, 0.6))

func test_physics_floor_stops_fall() -> void:
	var w := _make_world()
	_flat_floor(w, 60)
	var box := _player_box(Vector3(8.5, 64.0, 8.5))
	var r: Dictionary = VoxelPhysics.move_aabb(w, box, Vector3(0, -6.0, 0), 0.51)
	var out: AABB = r["aabb"]
	assert_near(out.position.y, 61.0, 0.01, "feet must rest on top of the floor")
	assert_true(r["on_ground"], "on_ground must be set after landing")
	assert_true(r["hit_y"])
	# Walking on flat ground is unobstructed.
	var r2: Dictionary = VoxelPhysics.move_aabb(w, out, Vector3(0.5, 0, 0), 0.51)
	assert_near(r2["motion_done"].x, 0.5, 0.01)

func test_physics_step_up_slab() -> void:
	var w := _make_world()
	_flat_floor(w, 60)
	var slab := Registry.block_id("stone_slab")
	for lz in range(6, 12):
		w.set_block(10, 61, lz, slab)
	var box := _player_box(Vector3(9.0, 61.0, 8.5))
	var r: Dictionary = VoxelPhysics.move_aabb(w, box, Vector3(1.2, 0, 0), 0.51)
	var out: AABB = r["aabb"]
	assert_true(out.position.y > 61.4, "stepping onto a slab must raise the box, got y=%f" % out.position.y)
	assert_true(out.position.x > 9.4, "the box must move forward, got x=%f" % out.position.x)
	# A full block is too tall to step onto.
	var w2 := w
	for lz in range(6, 12):
		w2.set_block(12, 61, lz, Registry.block_id("stone"))
		w2.set_block(12, 62, lz, Registry.block_id("stone"))
	var box2 := _player_box(Vector3(11.0, 61.0, 8.5))
	var r2: Dictionary = VoxelPhysics.move_aabb(w2, box2, Vector3(1.5, 0, 0), 0.51)
	assert_true((r2["aabb"] as AABB).position.x < 11.8, "a 2 block wall must block movement")

func test_physics_non_solid_blocks_are_passable() -> void:
	var w := _make_world()
	_flat_floor(w, 60)
	var grass_plant := Registry.block_id("short_grass")
	for lz in range(6, 12):
		w.set_block(10, 61, lz, grass_plant)
	var box := _player_box(Vector3(9.0, 61.0, 8.5))
	var r: Dictionary = VoxelPhysics.move_aabb(w, box, Vector3(1.5, 0, 0), 0.51)
	assert_near((r["aabb"] as AABB).position.x, 10.5, 0.02, "plants must not collide")

func test_fluid_at_reports_submersion() -> void:
	var w := _make_world()
	_flat_floor(w, 60)
	var water := Registry.block_id("water")
	for lz in range(6, 12):
		for lx in range(6, 12):
			w.set_block(lx, 61, lz, water, Fluids.SOURCE)
			w.set_block(lx, 62, lz, water, Fluids.SOURCE)
	var info: Dictionary = VoxelPhysics.fluid_at(w, _player_box(Vector3(8.5, 61.0, 8.5)))
	assert_true(info["in_liquid"], "the box is in water")
	assert_true(float(info["submerged_fraction"]) > 0.9, "submerged fraction %f" % info["submerged_fraction"])
	var dry: Dictionary = VoxelPhysics.fluid_at(w, _player_box(Vector3(2.5, 61.0, 2.5)))
	assert_true(not dry["in_liquid"])

func test_explode_removes_blocks_but_not_bedrock() -> void:
	var w := _make_world()
	_flat_floor(w, 60)
	var bedrock := Registry.block_id("bedrock")
	w.set_block(8, 60, 8, bedrock)
	w.explode(Vector3(8.5, 60.5, 8.5), 3.0, 12.0, null)
	assert_eq(w.get_block(8, 60, 8), bedrock, "unbreakable blocks survive")
	assert_eq(w.get_block(6, 60, 8), 0, "stone within the radius is destroyed")
	assert_eq(w.get_block(2, 60, 8), Registry.block_id("stone"), "blocks outside the radius stay")
