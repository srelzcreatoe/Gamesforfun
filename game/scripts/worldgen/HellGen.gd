class_name HellGen
extends WorldGen
## Hell (HFIL): hell_rock shelves, molten pools of lava, ash gravel, no water at all.

func _configure() -> void:
	terrain_mode = Terrain.MODE_HELL
	biome_style = BiomeMap.STYLE_SINGLE
	caves_enabled = true
	stone_name = "hell_rock"
	filler_depth = 3
	bedrock_depth = 1
	lava_level = 20
	pool_name = "lava"
	pool_depth = 7.0
	ore_table = [
		{"block": "hell_rock_molten", "min": 4, "max": 70, "tries": 6, "size": 14},
		{"block": "gravel", "min": 6, "max": 60, "tries": 4, "size": 18},
		{"block": "gold_ore", "min": 2, "max": 40, "tries": 2, "size": 7},
	]

## Molten crust around the lava pools.
func _features(col: ChunkColumn, ctx: Ctx) -> void:
	var molten := block_id("hell_rock_molten")
	if molten <= 0:
		return
	for lz in 16:
		for lx in 16:
			var i2 := lx + 16 * lz
			if ctx.wet[i2] != 1:
				continue
			var wx := ctx.ox + lx
			var wz := ctx.oz + lz
			var top := ctx.tops[i2]
			put_world(col, ctx, wx, top - 1, wz, molten)
