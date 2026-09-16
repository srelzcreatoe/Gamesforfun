class_name EarthGen
extends WorldGen
## Earth: Minecraft-quality varied terrain with oceans, rivers, beaches, mountains and snow,
## caves, ore veins and the DMZ story structures (docs/briefs/worldgen.md §3).
##
## The height field biases the first ~400 blocks around the spawn so the Saiyan saga always
## finds plains, forest, `wasteland` and a beach/ocean bay (Kame House) near the origin.

func _configure() -> void:
	terrain_mode = Terrain.MODE_EARTH
	biome_style = BiomeMap.STYLE_EARTH
	tree_density_scale = 0.7
	caves_enabled = true
	stone_name = "stone"
	filler_depth = 4
	bedrock_depth = 1
	lava_level = 7
	snow_y = sea_level + 38
	snow_name = "snow_block"
	dragon_ball_set = String(planet_def.get("dragon_balls", "earth"))
	ore_table = [
		{"block": "coal_ore", "min": 6, "max": 112, "tries": 9, "size": 14},
		{"block": "iron_ore", "min": 2, "max": 68, "tries": 8, "size": 9},
		{"block": "copper_ore", "min": 6, "max": 82, "tries": 5, "size": 12},
		{"block": "gold_ore", "min": 2, "max": 34, "tries": 2, "size": 7},
		{"block": "redstone_ore", "min": 1, "max": 18, "tries": 3, "size": 8},
		{"block": "lapis_ore", "min": 2, "max": 30, "tries": 1, "size": 6},
		{"block": "diamond_ore", "min": 1, "max": 15, "tries": 1, "size": 5},
		{"block": "emerald_ore", "min": 70, "max": 112, "tries": 1, "size": 2},
		{"block": "gravel", "min": 8, "max": 58, "tries": 3, "size": 20},
		{"block": "clay", "min": 40, "max": 62, "tries": 1, "size": 10},
	]

## Snowy caps on the highest ground.
func _features(col: ChunkColumn, ctx: Ctx) -> void:
	if id_snow_layer <= 0:
		return
	for lz in 16:
		for lx in 16:
			var i2 := lx + 16 * lz
			if ctx.wet[i2] == 1:
				continue
			var top := ctx.tops[i2]
			if top < snow_y - 6:
				continue
			var wx := ctx.ox + lx
			var wz := ctx.oz + lz
			if top >= _snow_line(wx, wz):
				put_world(col, ctx, wx, top, wz, id_snow_layer, 0, true)
