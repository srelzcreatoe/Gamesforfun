class_name YardratGen
extends WorldGen
## Planet Yardrat: rolling yellow-purple hills of yardrat_grass_block over yardrat_dirt.

func _configure() -> void:
	terrain_mode = Terrain.MODE_YARDRAT
	biome_style = BiomeMap.STYLE_SINGLE
	caves_enabled = false
	stone_name = "yardrat_stone"
	filler_depth = 4
	bedrock_depth = 1
	ore_table = [
		{"block": "coal_ore", "min": 6, "max": 80, "tries": 5, "size": 11},
		{"block": "iron_ore", "min": 4, "max": 58, "tries": 4, "size": 8},
	]
