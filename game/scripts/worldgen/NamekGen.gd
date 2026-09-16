class_name NamekGen
extends WorldGen
## Namek: green namek_grass_block plains with ajissa trees, shallow seas and rivers (water is
## tinted green by the biome `water_color`), namek_stone highlands and namekian villages.

func _configure() -> void:
	terrain_mode = Terrain.MODE_NAMEK
	biome_style = BiomeMap.STYLE_NAMEK
	caves_enabled = true
	stone_name = "namek_stone"
	deep_name = "namek_deepslate"
	deep_y = 26
	filler_depth = 4
	bedrock_depth = 1
	lava_level = 6
	dragon_ball_set = String(planet_def.get("dragon_balls", "namek"))
	ore_table = [
		{"block": "namek_coal_ore", "min": 6, "max": 96, "tries": 8, "size": 13},
		{"block": "namek_iron_ore", "min": 2, "max": 64, "tries": 7, "size": 9},
		{"block": "namek_gold_ore", "min": 2, "max": 32, "tries": 2, "size": 7},
		{"block": "namek_diamond_ore", "min": 1, "max": 16, "tries": 1, "size": 5},
		{"block": "namek_kikono_ore", "min": 1, "max": 26, "tries": 1, "size": 4},
		{"block": "namek_cobblestone", "min": 8, "max": 60, "tries": 2, "size": 16},
	]
