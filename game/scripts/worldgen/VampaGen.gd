class_name VampaGen
extends WorldGen
## Planet Vampa: vampa_sand dunes, bone_block scatters, tall vampa_rock spires (the Yardrat
## cage of Granolah's saga) and the odd green pool.

func _configure() -> void:
	terrain_mode = Terrain.MODE_VAMPA
	biome_style = BiomeMap.STYLE_SINGLE
	caves_enabled = false
	stone_name = "vampa_rock"
	filler_depth = 4
	bedrock_depth = 1
	pool_name = "water"
	pool_depth = 9.0
	ore_table = [
		{"block": "iron_ore", "min": 4, "max": 50, "tries": 3, "size": 8},
		{"block": "bone_block", "min": 8, "max": 52, "tries": 2, "size": 12},
	]

func _features(col: ChunkColumn, ctx: Ctx) -> void:
	var rock := block_id("vampa_rock")
	var bone := block_id("bone_block")
	# Rock spires: one candidate per 24x24 region, stamped from any column it reaches.
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			var rx := (ctx.cx + dx)
			var rz := (ctx.cz + dz)
			var hh := Terrain.hash_seeded(seed + 313, rx, 44, rz)
			if hh % 5 != 0:
				continue
			var ax := rx * 16 + (hh >> 4) % 16
			var az := rz * 16 + (hh >> 9) % 16
			var base := terrain.height_at(ax, az)
			var tall := 10 + (hh >> 14) % 22
			for i in tall:
				var r := maxi(0, 2 - i / 8)
				for ddz in range(-r, r + 1):
					for ddx in range(-r, r + 1):
						if ddx * ddx + ddz * ddz > r * r + 1:
							continue
						put_world(col, ctx, ax + ddx, base + i, az + ddz, rock)
	if bone <= 0:
		return
	for lz in 16:
		for lx in 16:
			var i2 := lx + 16 * lz
			if ctx.wet[i2] == 1:
				continue
			var wx := ctx.ox + lx
			var wz := ctx.oz + lz
			if Terrain.hash_seeded(seed, wx, 5, wz) % 420 != 0:
				continue
			var top := ctx.tops[i2]
			put_world(col, ctx, wx, top, wz, bone)
			if Terrain.hash_seeded(seed, wx, 6, wz) % 3 == 0:
				put_world(col, ctx, wx + 1, top, wz, bone)
