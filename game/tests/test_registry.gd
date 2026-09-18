extends TestCase
## Smoke tests for the data registries.

func test_air_is_zero() -> void:
	assert_eq(Registry.block_id("air"), 0)
	assert_eq(Registry.block(0)["shape"], "none")

func test_block_count_fits_byte() -> void:
	assert_true(Registry.blocks.size() <= 256, "block ids must fit in a byte")

func test_every_block_is_an_item() -> void:
	for b in Registry.blocks:
		if b["id"] == "air":
			continue
		assert_true(Registry.has_item(b["id"]), "missing item for block " + String(b["id"]))

func test_texture_array_has_layers() -> void:
	# The tiles live in one 2D atlas now (a Texture2DArray needed ~470 layers and GLES3 only
	# guarantees 256, which is why phones drew black blocks). Same thing checked: every block
	# tile made it in, and the indices still address them.
	assert_true(Textures.built)
	assert_true(Textures.tile_count > 100)
	assert_true(Textures.block_atlas != null, "the block atlas was created")
	assert_eq(Textures.block_atlas.get_width(), Textures.atlas_cols * 16,
		"the atlas is atlas_cols tiles wide")
	assert_true(Textures.atlas_cols * Textures.atlas_rows >= Textures.tile_count,
		"every tile has a cell")
	assert_ne(Textures.layer("stone0"), 0, "stone0 must not map to the missing layer")

func test_validation_reports_nothing_unknown() -> void:
	var problems := Registry.validate()
	assert_true(problems.is_empty(), "\n".join(problems))
