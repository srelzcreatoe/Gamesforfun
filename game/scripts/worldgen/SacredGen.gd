class_name SacredGen
extends WorldGen
## Sacred World of the Kai: bright sacred_planet_grass_block hills, sacred trees, wide rivers
## and Old Kai's pillar.

func _configure() -> void:
	terrain_mode = Terrain.MODE_SACRED
	biome_style = BiomeMap.STYLE_SACRED
	caves_enabled = false
	stone_name = "rocky_stone"
	filler_depth = 4
	bedrock_depth = 1
	ore_table = [
		{"block": "coal_ore", "min": 6, "max": 80, "tries": 4, "size": 10},
		{"block": "iron_ore", "min": 4, "max": 56, "tries": 3, "size": 8},
	]
