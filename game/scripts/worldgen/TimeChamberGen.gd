class_name TimeChamberGen
extends WorldGen
## Hyperbolic Time Chamber: an endless white plane of time_chamber_block at y 60 with the
## converted DMZ time_chamber building at the origin.

const PLANE := 60

func _configure() -> void:
	terrain_mode = Terrain.MODE_FLAT
	biome_style = BiomeMap.STYLE_SINGLE
	caves_enabled = false
	decorate = false
	stone_name = "time_chamber_block"
	bedrock_depth = 0
	ore_table = []

func plane_y() -> int:
	return PLANE

## The DMZ chamber sits at y 8 of a dimension whose floor is y 0.
func remap_structure_y(y: int, _mode: String) -> int:
	return PLANE + 1 + (y - 8)

func _fill_column(col: ChunkColumn, ctx: Ctx) -> void:
	var blocks := col.blocks
	var bio := col.biomes
	var floor_id := block_id("time_chamber_block")
	var bottom: int = maxi(0, PLANE - 7)
	for lz in 16:
		for lx in 16:
			var i2 := lx + 16 * lz
			bio[i2] = maxi(0, ext_biome(ctx, lx, lz)) & 255
			for y in range(bottom, PLANE + 1):
				blocks[i2 + 256 * y] = floor_id
			ctx.tops[i2] = PLANE + 1
			ctx.top_any[i2] = PLANE + 1
			ctx.wet[i2] = 0
	col.blocks = blocks
	col.biomes = bio
