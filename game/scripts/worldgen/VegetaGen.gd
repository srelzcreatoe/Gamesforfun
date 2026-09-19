class_name VegetaGen
extends WorldGen
## Planet Vegeta: rocky_stone / rocky_dirt mesas with vegeta_red_sand flats, no water.
## The red sky and the 10x gravity come from planets.json.

func _configure() -> void:
	terrain_mode = Terrain.MODE_VEGETA
	biome_style = BiomeMap.STYLE_SINGLE
	caves_enabled = true
	stone_name = "rocky_stone"
	filler_depth = 3
	bedrock_depth = 1
	lava_level = 8
	ore_table = [
		{"block": "coal_ore", "min": 6, "max": 90, "tries": 7, "size": 12},
		{"block": "iron_ore", "min": 2, "max": 64, "tries": 6, "size": 9},
		{"block": "gold_ore", "min": 2, "max": 40, "tries": 2, "size": 7},
		{"block": "gete_debris_ore", "min": 2, "max": 40, "tries": 2, "size": 5},
	]

## Cliff faces show rocky stone, flats keep the red sand surface.
func _features(col: ChunkColumn, ctx: Ctx) -> void:
	var rock := block_id("rocky_stone")
	var dirt := block_id("rocky_dirt")
	for lz in 16:
		for lx in 16:
			var i2 := lx + 16 * lz
			var top := ctx.tops[i2]
			if top < 2:
				continue
			var wx := ctx.ox + lx
			var wz := ctx.oz + lz
			# Neighbour heights come from the cached extended grid, not fresh noise.
			var slope := 0
			slope = maxi(slope, absi(ext_height(ctx, lx + 1, lz) - top))
			slope = maxi(slope, absi(ext_height(ctx, lx - 1, lz) - top))
			slope = maxi(slope, absi(ext_height(ctx, lx, lz + 1) - top))
			slope = maxi(slope, absi(ext_height(ctx, lx, lz - 1) - top))
			if slope >= 3:
				put_world(col, ctx, wx, top - 1, wz, rock)
				put_world(col, ctx, wx, top - 2, wz, rock)
			elif slope == 2:
				put_world(col, ctx, wx, top - 1, wz, dirt)
