class_name HeavenGen
extends WorldGen
## Heaven: heaven_grass_block meadows with flowers, small ponds and heaven_cloud islands
## floating over them (heaven_arch is stamped by Structures).

func _configure() -> void:
	terrain_mode = Terrain.MODE_HEAVEN
	biome_style = BiomeMap.STYLE_SINGLE
	tree_density_scale = 0.3
	caves_enabled = false
	stone_name = "stone"
	filler_depth = 4
	bedrock_depth = 1
	pool_name = "water"
	pool_depth = 8.0
	ore_table = [
		{"block": "coal_ore", "min": 6, "max": 60, "tries": 3, "size": 10},
		{"block": "iron_ore", "min": 4, "max": 48, "tries": 2, "size": 8},
	]

## Floating cloud islands between y 86 and 112.
func _features(col: ChunkColumn, ctx: Ctx) -> void:
	var cloud := block_id("heaven_cloud")
	if cloud <= 0:
		return
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			var rx := ctx.cx + dx
			var rz := ctx.cz + dz
			var hh := Terrain.hash_seeded(seed + 977, rx, 66, rz)
			if hh % 19 != 0:
				continue
			var ax := rx * 16 + (hh >> 4) % 16
			var az := rz * 16 + (hh >> 9) % 16
			var ay := 86 + (hh >> 14) % 24
			var r := 4 + (hh >> 19) % 6
			for ddz in range(-r, r + 1):
				for ddx in range(-r, r + 1):
					var d2 := ddx * ddx + ddz * ddz
					if d2 > r * r:
						continue
					var thick: int = 1 + int(round(float(r - int(sqrt(float(d2)))) * 0.45))
					for i in thick:
						put_world(col, ctx, ax + ddx, ay - i, az + ddz, cloud)
