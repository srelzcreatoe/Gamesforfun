class_name CerealGen
extends WorldGen
## Planet Cereal: cereal_sand mesas banded with terracotta layers (Granolah's home world).

const BANDS := ["terracotta", "orange_terracotta", "white_terracotta", "yellow_terracotta",
	"red_terracotta", "brown_terracotta"]

var _band_ids := PackedInt32Array()

func _configure() -> void:
	terrain_mode = Terrain.MODE_CEREAL
	biome_style = BiomeMap.STYLE_SINGLE
	caves_enabled = false
	stone_name = "cereal_rock"
	filler_depth = 3
	bedrock_depth = 1
	dragon_ball_set = String(planet_def.get("dragon_balls", "cereal"))
	ore_table = [
		{"block": "coal_ore", "min": 6, "max": 70, "tries": 4, "size": 10},
		{"block": "iron_ore", "min": 4, "max": 50, "tries": 3, "size": 8},
		{"block": "gold_ore", "min": 2, "max": 30, "tries": 2, "size": 6},
	]
	_band_ids = PackedInt32Array()
	for b in BANDS:
		_band_ids.append(block_id(String(b)))

## Horizontal terracotta banding on every exposed mesa wall.
func _features(col: ChunkColumn, ctx: Ctx) -> void:
	if _band_ids.is_empty():
		return
	var sand := block_id("cereal_sand")
	for lz in 16:
		for lx in 16:
			var i2 := lx + 16 * lz
			var top := ctx.tops[i2]
			if top < 4:
				continue
			var wx := ctx.ox + lx
			var wz := ctx.oz + lz
			var depth := 0
			var y := top - 1
			while y > 2 and depth < 26:
				var band := _band_ids[(y / 3) % _band_ids.size()]
				var cur := get_world(col, ctx, wx, y, wz)
				if cur == 0:
					break
				if y == top - 1 and top > 62:
					put_world(col, ctx, wx, y, wz, sand)
				elif band > 0:
					put_world(col, ctx, wx, y, wz, band)
				y -= 1
				depth += 1
