extends TestCase
## ChunkMesher: face culling, quad counts per shape and the UV2/COLOR packing.

func setup() -> void:
	if not BlockTable.built:
		BlockTable.build()

func _pad_for(col: ChunkColumn) -> Dictionary:
	var cols := []
	cols.resize(9)
	for i in 9:
		cols[i] = null
	cols[4] = col
	return ChunkMesher.build_pad(ChunkMesher.snapshot(cols))

func _mesh(col: ChunkColumn, section := 4) -> Dictionary:
	return ChunkMesher.build_section(_pad_for(col), section, ChunkManager.build_palette())

func _quads(surface: Array) -> int:
	var idx: PackedInt32Array = surface[Mesh.ARRAY_INDEX]
	return idx.size() / 6

func _lit_column() -> ChunkColumn:
	var col := ChunkColumn.new(0, 0)
	# Full sky light everywhere so the mesher records real light values.
	for i in WorldConst.COLUMN_VOLUME:
		col.light[i] = 0xF0
	return col

func test_empty_section_makes_no_surfaces() -> void:
	var out := _mesh(_lit_column())
	assert_true(out.is_empty(), "air must not produce geometry")

func test_lone_cube_has_six_faces() -> void:
	var col := _lit_column()
	col.set_cell(8, 70, 8, Registry.block_id("stone"), 0)
	col.recompute_heightmap()
	var out := _mesh(col)
	assert_true(out.has("opaque"), "stone belongs to the opaque surface")
	assert_eq(_quads(out["opaque"]), 6, "a lone cube has 6 quads")
	var verts: PackedVector3Array = out["opaque"][Mesh.ARRAY_VERTEX]
	assert_eq(verts.size(), 24, "6 quads = 24 vertices")
	var idx: PackedInt32Array = out["opaque"][Mesh.ARRAY_INDEX]
	assert_eq(idx.size(), 36)

func test_shared_faces_are_hidden() -> void:
	var col := _lit_column()
	var stone := Registry.block_id("stone")
	col.set_cell(8, 70, 8, stone, 0)
	col.set_cell(9, 70, 8, stone, 0)
	col.recompute_heightmap()
	var out := _mesh(col)
	assert_eq(_quads(out["opaque"]), 10, "two touching cubes show 10 of 12 faces")
	# A 3x3x3 solid block shows only its 54 outer faces.
	var col2 := _lit_column()
	for y in range(69, 72):
		for z in range(7, 10):
			for x in range(7, 10):
				col2.set_cell(x, y, z, stone, 0)
	col2.recompute_heightmap()
	assert_eq(_quads(_mesh(col2)["opaque"]), 54, "3x3x3 cube = 9 faces per side")

func test_cutout_cube_culls_only_against_itself() -> void:
	var col := _lit_column()
	var leaves := Registry.block_id("oak_leaves")
	var stone := Registry.block_id("stone")
	col.set_cell(8, 70, 8, leaves, 0)
	col.set_cell(9, 70, 8, leaves, 0)
	col.recompute_heightmap()
	var out := _mesh(col)
	assert_true(out.has("cutout"), "leaves belong to the cutout surface")
	assert_eq(_quads(out["cutout"]), 10, "leaves cull against the same id")
	var col2 := _lit_column()
	col2.set_cell(8, 70, 8, leaves, 0)
	col2.set_cell(9, 70, 8, stone, 0)
	col2.recompute_heightmap()
	var out2 := _mesh(col2)
	assert_eq(_quads(out2["cutout"]), 5, "the face against an opaque cube is still hidden")

func test_cross_plant_is_four_quads() -> void:
	var col := _lit_column()
	col.set_cell(8, 70, 8, Registry.block_id("dandelion"), 0)
	col.recompute_heightmap()
	var out := _mesh(col)
	assert_true(out.has("cutout"))
	assert_eq(_quads(out["cutout"]), 4, "a cross is 2 double-sided planes")

func test_double_plant_is_eight_quads() -> void:
	var col := _lit_column()
	col.set_cell(8, 70, 8, Registry.block_id("tall_grass"), 0)
	col.recompute_heightmap()
	var out := _mesh(col)
	assert_eq(_quads(out["cutout"]), 8, "tall grass adds its upper half")

func test_slab_and_snow_use_their_height() -> void:
	var col := _lit_column()
	col.set_cell(8, 70, 8, Registry.block_id("stone_slab"), 0)
	col.recompute_heightmap()
	var out := _mesh(col)
	assert_eq(_quads(out["opaque"]), 6)
	var verts: PackedVector3Array = out["opaque"][Mesh.ARRAY_VERTEX]
	var top := -999.0
	for v in verts:
		top = maxf(top, v.y)
	assert_near(top, 70.5, 0.001, "a bottom slab is half a metre tall")

func test_water_top_is_below_the_block_top() -> void:
	var col := _lit_column()
	col.set_cell(8, 70, 8, Registry.block_id("water"), Fluids.SOURCE)
	col.recompute_heightmap()
	var out := _mesh(col)
	assert_true(out.has("water"), "liquids belong to the water surface")
	var verts: PackedVector3Array = out["water"][Mesh.ARRAY_VERTEX]
	var top := -999.0
	for v in verts:
		top = maxf(top, v.y)
	assert_near(top, 70.875, 0.001, "a source block's surface sits at 7/8")
	var colors: PackedColorArray = out["water"][Mesh.ARRAY_COLOR]
	assert_near(colors[0].r, ChunkMesher.WATER_COLOR.r, 0.01, "water carries its tint")
	assert_near(colors[0].b, ChunkMesher.WATER_COLOR.b, 0.01)

func test_uv2_packs_layer_frames_and_light() -> void:
	var col := _lit_column()
	var stone := Registry.block_id("stone")
	col.set_cell(8, 70, 8, stone, 0)
	col.set_block_light(8, 71, 8, 9)
	col.recompute_heightmap()
	var out := _mesh(col)
	var uv2: PackedVector2Array = out["opaque"][Mesh.ARRAY_TEX_UV2]
	var layer := floor(uv2[0].x)
	assert_true(layer > 0.0, "stone must not use the magenta missing layer")
	var frac: float = uv2[0].x - layer
	var enc: float = round(frac * 128.0)
	assert_true(enc >= 1.0 and enc < 64.0, "static tile encodes 1 frame and no sway, got %f" % enc)
	# packed light = sky * 16 + block; full sky light = 15 -> 240/255.
	var packed: float = round(uv2[0].y * 255.0)
	assert_true(packed >= 240.0, "top faces of a lit cube see full sky light, got %f" % packed)

func test_plants_set_the_sway_bit() -> void:
	var col := _lit_column()
	col.set_cell(8, 70, 8, Registry.block_id("short_grass"), 0)
	col.recompute_heightmap()
	var out := _mesh(col)
	var uv2: PackedVector2Array = out["cutout"][Mesh.ARRAY_TEX_UV2]
	var enc: float = round((uv2[0].x - floor(uv2[0].x)) * 128.0)
	assert_true(enc >= 64.0, "plants must carry the wind sway flag, got %f" % enc)

func test_animated_water_encodes_frames() -> void:
	var col := _lit_column()
	col.set_cell(8, 70, 8, Registry.block_id("water"), Fluids.SOURCE)
	col.recompute_heightmap()
	var out := _mesh(col)
	var uv2: PackedVector2Array = out["water"][Mesh.ARRAY_TEX_UV2]
	var enc: float = round((uv2[0].x - floor(uv2[0].x)) * 128.0)
	var frames: float = enc if enc < 64.0 else enc - 64.0
	assert_true(frames > 1.0, "water_still is a 32 frame strip, got %f" % frames)

func test_ambient_occlusion_darkens_inner_corners() -> void:
	var col := _lit_column()
	var stone := Registry.block_id("stone")
	# An L shaped wall around the top face of a block creates occluded corners.
	col.set_cell(8, 70, 8, stone, 0)
	col.set_cell(9, 71, 8, stone, 0)
	col.set_cell(8, 71, 9, stone, 0)
	col.recompute_heightmap()
	var out := _mesh(col)
	var colors: PackedColorArray = out["opaque"][Mesh.ARRAY_COLOR]
	var min_ao := 2.0
	var max_ao := -1.0
	for c in colors:
		min_ao = minf(min_ao, c.a)
		max_ao = maxf(max_ao, c.a)
	assert_true(min_ao < 0.99, "occluded vertices must be darker, min ao %f" % min_ao)
	assert_near(max_ao, 1.0, 0.001, "open vertices keep ao 1.0")
	for c in colors:
		var ok := false
		for lvl in ChunkMesher.AO:
			if absf(c.a - float(lvl)) < 0.002:
				ok = true
		assert_true(ok, "ao must be one of the 4 levels, got %f" % c.a)

func test_no_partially_magenta_blocks() -> void:
	# Layer 0 is the magenta "missing texture" tile. A block that resolved at least one face
	# must have every face resolved (BlockTable fills the gaps), so nothing renders magenta
	# next to a real texture. Blocks with no texture at all are an asset-pipeline problem and
	# are only reported.
	var bad: PackedStringArray = PackedStringArray()
	var no_texture: PackedStringArray = PackedStringArray()
	for id in range(1, BlockTable.count):
		if BlockTable.shape[id] == BlockTable.Shape.NONE:
			continue
		var zero := 0
		for f in 6:
			if BlockTable.face_layer[id * 6 + f] == 0:
				zero += 1
		if zero == 6:
			no_texture.append(BlockTable.name_of(id))
		elif zero > 0:
			bad.append(BlockTable.name_of(id))
	if not no_texture.is_empty():
		print("      note: blocks without any tile: " + ", ".join(no_texture))
	assert_true(bad.is_empty(), "blocks with some magenta faces: " + ", ".join(bad))
