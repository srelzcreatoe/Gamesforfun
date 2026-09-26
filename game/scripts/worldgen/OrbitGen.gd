class_name OrbitGen
extends SpaceGen
## Orbit: a thin band of asteroid rocks and nothing else (the space-pod travel hub).

func _configure() -> void:
	super._configure()
	band_min = 58
	band_max = 74
	clump_rarity = 6
	clump_radius_min = 2
	clump_radius_max = 5
	dragon_ball_set = ""
