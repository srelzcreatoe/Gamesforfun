class_name CerealGen
extends WorldGen
## Planet Cereal: cereal_sand mesas banded with terracotta layers (Granolah's home world).

func _configure() -> void:
	terrain_mode = Terrain.MODE_CEREAL
	biome_style = BiomeMap.STYLE_SINGLE
	caves_enabled = false
	stone_name = "cereal_rock"
	filler_depth = 3
	bedrock_depth = 1
	dragon_ball_set = String(planet_def.get("dragon_balls", "cereal"))
	band_names = ["terracotta", "orange_terracotta", "white_terracotta", "yellow_terracotta",
		"red_terracotta", "brown_terracotta"]
	band_depth = 24
	ore_table = [
		{"block": "coal_ore", "min": 6, "max": 70, "tries": 4, "size": 10},
		{"block": "iron_ore", "min": 4, "max": 50, "tries": 3, "size": 8},
		{"block": "gold_ore", "min": 2, "max": 30, "tries": 2, "size": 6},
	]
