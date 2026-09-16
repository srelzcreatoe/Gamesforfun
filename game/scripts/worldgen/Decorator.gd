class_name Decorator
extends RefCounted
## Trees, plants, ground scatter and mob seeding per biome (docs/briefs/worldgen.md §2).
##
## Tree candidates are enumerated over the column *plus a 5 block margin* so canopies of trees
## rooted in a neighbouring chunk are stamped here too; because both columns run the same
## deterministic hash the two halves always match. Plants are single blocks and only need the
## inner 16x16.
##
## Mobs are written sparsely into `col.entities_pending` as `{type, pos}`; the Spawner owns
## every later spawn.

const MARGIN := 5
## 1 in TREE_GATE positions is even considered for a tree (keeps the margin scan cheap).
const TREE_GATE := 8

var gen: Variant = null
var id_lily := 0
var id_snow_layer := 0
var id_water := 0

func configure(p_gen) -> void:
	gen = p_gen
	id_lily = Registry.block_id("lily_pad")
	id_snow_layer = Registry.block_id("snow_layer")
	id_water = Registry.block_id("water")

func decorate(col: ChunkColumn, ctx) -> void:
	_trees(col, ctx)
	_plants(col, ctx)
	_mobs(col, ctx)

# --- trees -----------------------------------------------------------------

func _trees(col: ChunkColumn, ctx) -> void:
	var sea: int = gen.sea_level
	for gz in range(-MARGIN, 16 + MARGIN):
		for gx in range(-MARGIN, 16 + MARGIN):
			var wx: int = ctx.ox + gx
			var wz: int = ctx.oz + gz
			var hh := Terrain.hash_seeded(gen.seed, wx, 3, wz)
			if hh % TREE_GATE != 0:
				continue
			var h: int = gen.ext_height(ctx, gx, gz)
			if gen.has_sea and h <= sea + 1:
				continue
			var def: Dictionary = gen.biome_def_at(ctx, gx, gz)
			var list: Array = def.get("trees", [])
			if list.is_empty():
				continue
			var total := 0.0
			for t in list:
				total += float(t.get("density", 0.0))
			if total <= 0.0:
				continue
			var scale: float = gen.tree_density_scale
			var accept := total * float(TREE_GATE) * scale
			var u := Terrain.hash_unit(gen.seed, wx, 5, wz)
			if u >= accept or accept <= 0.0:
				continue
			var pick := (u / accept) * total
			var kind := ""
			var acc := 0.0
			for t in list:
				acc += float(t.get("density", 0.0))
				if pick < acc:
					kind = String(t.get("type", "oak"))
					break
			if kind == "":
				continue
			Trees.place(gen, col, ctx, kind, wx, h, wz, hh)

# --- plants ----------------------------------------------------------------

func _plants(col: ChunkColumn, ctx) -> void:
	var sea: int = gen.sea_level
	for lz in 16:
		for lx in 16:
			var i2 := lx + 16 * lz
			var wx: int = ctx.ox + lx
			var wz: int = ctx.oz + lz
			var top: int = ctx.tops[i2]
			if top < 2 or top >= WorldConst.HEIGHT - 2:
				continue
			var def: Dictionary = gen.biome_def_at(ctx, lx, lz)
			var list: Array = def.get("plants", [])
			if list.is_empty():
				continue
			var submerged: bool = ctx.wet[i2] == 1
			var u := Terrain.hash_unit(gen.seed, wx, 11, wz)
			var acc := 0.0
			for p in list:
				acc += float(p.get("density", 0.0))
				if u >= acc:
					continue
				var name := String(p.get("block", ""))
				_place_plant(col, ctx, name, wx, wz, top, submerged, sea)
				break

func _place_plant(col: ChunkColumn, ctx, name: String, wx: int, wz: int,
		top: int, submerged: bool, sea: int) -> void:
	if name == "":
		return
	var id := Registry.block_id(name)
	if id <= 0:
		return
	if name == "lily_pad":
		if submerged and sea > 0 and gen.get_world(col, ctx, wx, sea + 1, wz) == 0:
			gen.put_world(col, ctx, wx, sea + 1, wz, id, 0, true)
		return
	if submerged:
		return
	var ground: int = gen.get_world(col, ctx, wx, top - 1, wz)
	if ground <= 0:
		return
	if name == "cactus":
		Trees.place(gen, col, ctx, "cactus", wx, top, wz, Terrain.hash_seeded(gen.seed, wx, 13, wz))
		return
	if name == "sugar_cane":
		# only next to water
		if not _near_water(col, ctx, wx, top - 1, wz):
			return
		var n := 1 + (Terrain.hash_seeded(gen.seed, wx, 17, wz) % 3)
		for i in n:
			gen.put_world(col, ctx, wx, top + i, wz, id, 0, true)
		return
	if name == "vine":
		return                                   # vines come with jungle trees
	gen.put_world(col, ctx, wx, top, wz, id, 0, true)

func _near_water(col: ChunkColumn, ctx, wx: int, wy: int, wz: int) -> bool:
	for d in BlockShapes.FACE_DIR:
		var v: Vector3i = d
		if v.y != 0:
			continue
		var b: int = gen.get_world(col, ctx, wx + v.x, wy, wz + v.z)
		if b == id_water:
			return true
	return false

# --- mobs ------------------------------------------------------------------

func _mobs(col: ChunkColumn, ctx) -> void:
	var hh := Terrain.hash_seeded(gen.seed + 7717, ctx.cx, 23, ctx.cz)
	if (hh % 100) >= 9:
		return
	var lx := (hh >> 7) % 16
	var lz := (hh >> 12) % 16
	var i2 := lx + 16 * lz
	if ctx.wet[i2] == 1:
		return
	var def: Dictionary = gen.biome_def_at(ctx, lx, lz)
	var mobs: Array = def.get("mobs", [])
	if mobs.is_empty():
		return
	var total := 0
	for m in mobs:
		total += int(m.get("weight", 1))
	if total <= 0:
		return
	var pick := (hh >> 3) % total
	var chosen: Dictionary = mobs[0]
	var acc := 0
	for m in mobs:
		acc += int(m.get("weight", 1))
		if pick < acc:
			chosen = m
			break
	var entity := String(chosen.get("type", chosen.get("entity", "")))
	if entity == "" or not Registry.entities.has(entity):
		return
	var lo := int(chosen.get("min", 1))
	var hi: int = maxi(lo, int(chosen.get("max", lo)))
	var count := lo + ((hh >> 17) % (hi - lo + 1))
	for i in count:
		var jh := Terrain.hash_seeded(gen.seed, ctx.cx * 16 + lx, 31 + i, ctx.cz * 16 + lz)
		var px := lx + (jh % 5) - 2
		var pz := lz + ((jh >> 5) % 5) - 2
		if px < 0 or px > 15 or pz < 0 or pz > 15:
			continue
		var pi := px + 16 * pz
		if ctx.wet[pi] == 1:
			continue
		var y: int = ctx.top_any[pi]
		col.entities_pending.append({
			"type": entity,
			"pos": Vector3(float(ctx.ox + px) + 0.5, float(y), float(ctx.oz + pz) + 0.5),
		})
