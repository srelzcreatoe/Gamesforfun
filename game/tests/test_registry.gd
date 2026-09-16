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
	assert_true(Textures.built)
	assert_true(Textures.block_array.get_layers() > 100)
	assert_ne(Textures.layer("stone0"), 0, "stone0 must not map to the missing layer")

func test_validation_reports_nothing_unknown() -> void:
	var problems := Registry.validate()
	assert_true(problems.is_empty(), "\n".join(problems))
