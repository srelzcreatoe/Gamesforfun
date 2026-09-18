class_name Structures
extends RefCounted
## Deterministic structure placement and stamping (docs/briefs/worldgen.md §4,
## DATA_SCHEMA.md "Additions produced by the converters").
##
## Placement never depends on which column is being generated:
##   * `unique` structures get one seeded position per world (a golden-angle spiral search over
##     the allowed distance band, checking biome and land at each candidate, then cached).
##   * repeatable structures are anchored per chunk: `hash(seed, id, cx, cz) % rarity == 0`,
##     so every column the structure reaches derives the same anchor.
##   * `group` followers are stamped at the anchor's x/z with their own `y_mode`, and a
##     `village_role: center` anchor lays out the group's pieces as a deterministic jigsaw.
## Each column stamps only the part of the template that falls inside it, which is what makes
## structures cross chunk borders correctly.
##
## Templates (assets/structures/*.json) are never all held in memory: only their tiny headers
## are, and a template body is parsed - into packed arrays, in small chunks - when a column
## it actually covers is generated, then cached LRU (see "template loading" below).

const HEIGHT := WorldConst.HEIGHT
## Chunk radius scanned for repeatable anchors (covers templates up to ~190 blocks wide).
const SCAN_CHUNKS := 6
## Candidates tried when searching a unique structure's position.
const UNIQUE_SAMPLES := 512
## Half extent no converted template exceeds (the widest is 142 blocks) - used to reject a
## structure before its template is parsed.
const MAX_HALF := 104
## Structures this class does not place (the planet generator builds them itself).
const SKIP := ["snake_way"]

## Overrides needed because this world is only 128 blocks tall (see the final report):
## `src_y_min/src_y_max` crop the template vertically, `dest_y` is the world y of `src_y_min`,
## `offset_from_spawn` replaces a fixed_position of (0,0,0), `korin_tower` adds the tower below.
const SPECIAL := {
	"kami_lookout": {
		"src_y_min": 147, "src_y_max": 174, "dest_y": 100,
		"offset_from_spawn": [264, -176], "korin_tower": true,
	},
}

static var _tpl_mutex := Mutex.new()

var gen: Variant = null
var planet_id := ""
## Structures that decide their own position (unique, or rarity > 0).
var anchors: Array = []
## group id -> follower entries (rarity 0, stamped at the anchor's x/z).
var followers: Dictionary = {}
## group id -> village piece entries.
var village_pieces: Dictionary = {}

var _unique: Dictionary = {}
var _mutex := Mutex.new()

func configure(p_gen) -> void:
	gen = p_gen
	planet_id = gen.planet_id
	anchors = []
	followers = {}
	village_pieces = {}
	_unique = {}
	var all: Dictionary = Registry.structures
	var keys: Array = all.keys()
	keys.sort()
	for sid in keys:
		var def: Dictionary = all[sid]
		if String(def.get("planet", "")) != planet_id:
			continue
		if def.get("generate", true) == false:
			continue
		if String(sid) in SKIP:
			continue
		var entry := {
			"id": String(sid),
			"def": def,
			"file": "res://" + String(def.get("file", "")).trim_prefix("res://"),
			"rarity": int(def.get("rarity", 0)),
			"unique": bool(def.get("unique", false)),
			"group": String(def.get("group", "")),
			"role": String(def.get("village_role", "")),
			"y_mode": String(def.get("y_mode", "surface")),
			"y": int(def.get("y", 0)),
			"clear_above": bool(def.get("clear_above", false)),
			"quest_tag": String(def.get("quest_tag", "")),
			"min_dist": int(def.get("min_distance_from_spawn", 0)),
			"biomes": def.get("biomes", []),
		}
		entry["hdr"] = header(String(entry["file"]))
		if String(entry["role"]) == "piece":
			var g: String = entry["group"]
			if not village_pieces.has(g):
				village_pieces[g] = []
			village_pieces[g].append(entry)
		elif int(entry["rarity"]) <= 0 and String(entry["group"]) != "":
			var g2: String = entry["group"]
			if not followers.has(g2):
				followers[g2] = []
			followers[g2].append(entry)
		elif int(entry["rarity"]) > 0 or bool(entry["unique"]):
			var surfaces := PackedInt32Array()
			for b3 in entry["biomes"]:
				var sid2 := Registry.block_id(String(Registry.biome(String(b3)).get("surface", "")))
				if sid2 > 0 and not surfaces.has(sid2):
					surfaces.append(sid2)
			entry["surfaces"] = surfaces
			anchors.append(entry)

# --- per column ------------------------------------------------------------

## Resolve every unique structure's position once (called from WorldGen.configure on the main
## thread), so the per-column stamp never takes a lock or runs a search.
func resolve_uniques() -> void:
	for entry in anchors:
		if bool(entry["unique"]):
			entry["pos"] = unique_position(entry)

func stamp(col: ChunkColumn, ctx) -> void:
	for entry in anchors:
		if bool(entry["unique"]):
			var pos: Vector3i = entry.get("pos", Vector3i(0x7fffffff, 0, 0))
			if pos.x == 0x7fffffff:
				pos = unique_position(entry)
			if pos.x != 0x7fffffff:
				_place(col, ctx, entry, pos.x, pos.z, 0)
		else:
			_stamp_repeatable(col, ctx, entry)

## Repeatable structures use `rarity` as a region size in chunks (Minecraft-style spacing,
## which is what the DMZ configs mean): every `rarity` x `rarity` chunk region holds one
## anchor at a seeded chunk/offset inside it, so the density is one per rarity*16 blocks.
func _stamp_repeatable(col: ChunkColumn, ctx, entry: Dictionary) -> void:
	var region: int = maxi(2, int(entry["rarity"]))
	var sid_hash := absi(int(String(entry["id"]).hash())) & 0xffffff
	var rad: int = maxi(1, int(ceil((float(MAX_HALF) / 16.0 + 1.0) / float(region))))
	var rcx := _floor_div(ctx.cx, region)
	var rcz := _floor_div(ctx.cz, region)
	for dz in range(-rad, rad + 1):
		for dx in range(-rad, rad + 1):
			var rx := rcx + dx
			var rz := rcz + dz
			var hh := Terrain.hash_seeded(gen.seed + sid_hash, rx, 91, rz)
			var ccx := rx * region + (hh % region)
			var ccz := rz * region + ((hh >> 8) % region)
			var ax := ccx * 16 + ((hh >> 16) % 16)
			var az := ccz * 16 + ((hh >> 20) % 16)
			if not _valid_site(entry, ax, az, 1):
				continue
			var rot := ((hh >> 25) % 4) if String(entry["role"]) == "center" else 0
			_place(col, ctx, entry, ax, az, rot)

static func _floor_div(a: int, b: int) -> int:
	return int(floor(float(a) / float(b)))

## Stamp the anchor plus its group followers / village pieces.
func _place(col: ChunkColumn, ctx, entry: Dictionary, ax: int, az: int, rot: int) -> void:
	_stamp_one(col, ctx, entry, ax, az, rot)
	var group: String = entry["group"]
	if group == "":
		return
	if followers.has(group):
		for f in followers[group]:
			_stamp_one(col, ctx, f, ax, az, rot)
	if String(entry["role"]) == "center" and village_pieces.has(group):
		_stamp_village(col, ctx, group, ax, az)

## Deterministic village jigsaw: street arms on the two axes plus houses on a ring.
func _stamp_village(col: ChunkColumn, ctx, group: String, ax: int, az: int) -> void:
	var pieces: Array = village_pieces[group]
	if pieces.is_empty():
		return
	var streets: Array = []
	var houses: Array = []
	for p in pieces:
		if String(p["id"]).contains("street"):
			streets.append(p)
		else:
			houses.append(p)
	var hh := Terrain.hash_seeded(gen.seed + 4441, ax, 77, az)
	if not streets.is_empty():
		var straight: Dictionary = streets[0]
		for s in streets:
			if String(s["id"]).ends_with("straight"):
				straight = s
		var dirs := [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]
		for arm in 4:
			var d := 26 + ((hh >> (arm * 3)) % 10)
			var dir: Vector2i = dirs[arm]
			_stamp_one(col, ctx, straight, ax + dir.x * d, az + dir.y * d, 0 if dir.x != 0 else 1)
	var count := 4 + ((hh >> 19) % 3)
	if houses.is_empty():
		return
	for i in count:
		var h2 := Terrain.hash_seeded(gen.seed + 991 * (i + 1), ax, 53, az)
		var ang := (float(h2 % 4096) / 4096.0) * TAU
		var dist := 22.0 + float((h2 >> 12) % 18)
		var px := ax + int(round(cos(ang) * dist))
		var pz := az + int(round(sin(ang) * dist))
		var piece: Dictionary = houses[(h2 >> 7) % houses.size()]
		if not _valid_site(piece, px, pz, 1):
			continue
		_stamp_one(col, ctx, piece, px, pz, (h2 >> 21) % 4)

# --- one template ----------------------------------------------------------

func _stamp_one(col: ChunkColumn, ctx, entry: Dictionary, ax: int, az: int, rot: int) -> void:
	var sid: String = entry["id"]
	var special: Dictionary = SPECIAL.get(sid, {})
	# Conservative reject before the (possibly multi-megabyte) template is parsed: no
	# converted structure reaches further than MAX_HALF blocks from its anchor.
	if ax - MAX_HALF >= ctx.ox + 16 or ax + MAX_HALF < ctx.ox:
		return
	if az - MAX_HALF >= ctx.oz + 16 or az + MAX_HALF < ctx.oz:
		return
	# Header only (a few hundred bytes, read once at configure time): enough to decide whether
	# this column is touched at all, without parsing any block data.
	var file := String(entry["file"])
	var tpl: Dictionary = entry.get("hdr", {})
	if tpl.is_empty():
		tpl = header(file)
	if tpl.is_empty():
		return
	var size: Vector3i = tpl["size"]
	var off: Vector3i = tpl["off"]
	var ro := _rot_off(off, rot)
	var src_min: int = clampi(int(special.get("src_y_min", 0)), 0, size.y - 1)
	var src_max: int = clampi(int(special.get("src_y_max", size.y - 1)), src_min, size.y - 1)
	var ext_x := size.z if (rot & 1) == 1 else size.x
	var ext_z := size.x if (rot & 1) == 1 else size.z
	var min_x := ax + ro.x
	var min_z := az + ro.y
	if min_x + ext_x <= ctx.ox or min_x >= ctx.ox + 16:
		return
	if min_z + ext_z <= ctx.oz or min_z >= ctx.oz + 16:
		return
	var base_y := _resolve_y(entry, special, ax, az, size)
	if base_y < 0:
		return
	if gen.structures_avoid_spawn and _covers_spawn(min_x, min_z, ext_x, ext_z):
		return
	var ext_y := src_max - src_min + 1
	if bool(tpl.get("clear", false)):
		_clear_box(col, ctx, min_x, min_z, ext_x, ext_z, base_y + off.y, ext_y)
	if bool(entry["clear_above"]):
		_clear_box(col, ctx, min_x, min_z, ext_x, ext_z, base_y + off.y + ext_y, 8)
	if bool(special.get("korin_tower", false)):
		_korin_tower(col, ctx, ax, az, base_y)
	# Only now, for a column the structure really covers, is the block data parsed.
	var blk := blocks_of(file, src_min, src_max)
	var pal: PackedByteArray = blk["pal"]
	var data: PackedInt32Array = blk["data"]
	var starts: PackedInt32Array = blk["starts"]
	var counts: PackedInt32Array = blk["counts"]
	# Template-space bounding box of this column, so only overlapping tiles are walked.
	var rx0: int = ctx.ox - min_x
	var rz0: int = ctx.oz - min_z
	var bb := _template_bbox(rx0, rz0, size, rot)
	var tx0: int = maxi(0, int(bb.x)) >> 4
	var tx1: int = maxi(0, int(bb.y)) >> 4
	var tz0: int = maxi(0, int(bb.z)) >> 4
	var tz1: int = maxi(0, int(bb.w)) >> 4
	for tz in range(tz0, tz1 + 1):
		if tz < 0 or tz > 15:
			continue
		for tx in range(tx0, tx1 + 1):
			if tx < 0 or tx > 15:
				continue
			var ti := tx + 16 * tz
			var from := starts[ti]
			var to := from + counts[ti]
			for i in range(from, to):
				var v := data[i]
				var sy := (v >> 8) & 255
				if sy < src_min or sy > src_max:
					continue
				var p := _rotate_point(v & 255, (v >> 16) & 255, size, rot)
				var wx := min_x + p.x
				var wz := min_z + p.y
				if wx < ctx.ox or wx >= ctx.ox + 16 or wz < ctx.oz or wz >= ctx.oz + 16:
					continue
				var wy := base_y + off.y + (sy - src_min)
				if wy < 0 or wy >= HEIGHT:
					continue
				gen.put_world(col, ctx, wx, wy, wz, pal[(v >> 24) & 255])
	_mark(col, ctx, entry, min_x, min_z, ext_x, ext_z, base_y + off.y, ext_y)
	_spawn_entities(col, ctx, entry, tpl, min_x, min_z, base_y, off, size, rot, src_min, src_max)

## Clear a box (used for `clear_box` templates and `clear_above`).
func _clear_box(col: ChunkColumn, ctx, min_x: int, min_z: int, ext_x: int,
		ext_z: int, y_from: int, ext_y: int) -> void:
	var x0: int = maxi(min_x, ctx.ox)
	var x1: int = mini(min_x + ext_x, ctx.ox + 16)
	var z0: int = maxi(min_z, ctx.oz)
	var z1: int = mini(min_z + ext_z, ctx.oz + 16)
	var y0: int = maxi(0, y_from)
	var y1: int = mini(HEIGHT, y_from + ext_y)
	for wz in range(z0, z1):
		for wx in range(x0, x1):
			for wy in range(y0, y1):
				if gen.get_world(col, ctx, wx, wy, wz) != 0:
					gen.put_world(col, ctx, wx, wy, wz, 0)

func _mark(col: ChunkColumn, ctx, entry: Dictionary, min_x: int, min_z: int,
		ext_x: int, ext_z: int, base_y: int, ext_y: int) -> void:
	var aabb := AABB(Vector3(float(min_x), float(base_y), float(min_z)),
		Vector3(float(ext_x), float(ext_y), float(ext_z)))
	for m in col.structure_marks:
		if m is Dictionary and String(m.get("id", "")) == String(entry["id"]):
			var other: AABB = m.get("aabb", AABB())
			if other.position.is_equal_approx(aabb.position):
				return
	add_mark(col, String(entry["id"]), String(entry["quest_tag"]), aabb)

## Record a structure anchor for the quest system: live in `structure_marks` and mirrored into
## the column's JSON `extra` so it survives a save/load (a column restored from disk skips
## generation, see ChunkManager._gen_task).
static func add_mark(col: ChunkColumn, id: String, quest_tag: String, aabb: AABB) -> void:
	col.structure_marks.append({"id": id, "quest_tag": quest_tag, "aabb": aabb})
	var saved: Array = col.extra.get("structures", [])
	saved.append({
		"id": id, "quest_tag": quest_tag,
		"aabb": [aabb.position.x, aabb.position.y, aabb.position.z,
			aabb.size.x, aabb.size.y, aabb.size.z],
	})
	col.extra["structures"] = saved

func _spawn_entities(col: ChunkColumn, ctx, entry: Dictionary, tpl: Dictionary,
		min_x: int, min_z: int, base_y: int, off: Vector3i, size: Vector3i, rot: int,
		src_min: int, src_max: int) -> void:
	var ents: Array = tpl.get("ents", [])
	var placed := 0
	for e in ents:
		if not e is Dictionary:
			continue
		var p: Array = e.get("pos", [])
		if p.size() < 3:
			continue
		var sy := int(p[1])
		if sy < src_min or sy > src_max:
			continue
		var rp := _rotate_point(int(p[0]), int(p[2]), size, rot)
		var wx := min_x + rp.x
		var wz := min_z + rp.y
		if not gen.inside(ctx, wx, wz):
			continue
		var type := String(e.get("id", ""))
		if type == "" or not Registry.entities.has(type):
			continue
		col.entities_pending.append({
			"type": type,
			"pos": Vector3(float(wx) + 0.5, float(base_y + off.y + (sy - src_min)), float(wz) + 0.5),
			"data": {"structure": entry["id"]},
		})
		placed += 1
	if placed > 0:
		return
	# Templates without embedded entities: drop the declared ones on the anchor column.
	var cx := min_x - off.x
	var cz := min_z - off.z
	if not gen.inside(ctx, cx, cz):
		return
	for type2 in entry["def"].get("spawn_entities", []):
		var t := String(type2)
		if not Registry.entities.has(t):
			continue
		col.entities_pending.append({
			"type": t,
			"pos": Vector3(float(cx) + 0.5, float(base_y + 1), float(cz) + 0.5),
			"data": {"structure": entry["id"]},
		})

## Korin's tower: a procedural pole with a platform and a small house, built under the
## lookout because the original 200-block-tall template does not fit a 128-block world.
func _korin_tower(col: ChunkColumn, ctx, ax: int, az: int, lookout_y: int) -> void:
	var pole := Registry.block_id("korin_tower_block")
	if pole <= 0:
		return
	var tile: int = maxi(pole, Registry.block_id("lookout_tile"))
	var wall: int = maxi(pole, Registry.block_id("kame_house_wall"))
	var roof: int = maxi(pole, Registry.block_id("kame_house_roof"))
	var ground: int = gen.terrain.height_at(ax, az)
	var top: int = clampi(lookout_y - 14, ground + 8, HEIGHT - 10)
	if not _near_column(ctx, ax, az, 8):
		return
	for wy in range(maxi(0, ground - 2), top):
		for dz in range(-1, 2):
			for dx in range(-1, 2):
				gen.put_world(col, ctx, ax + dx, wy, az + dz, pole)
	for dz in range(-6, 7):
		for dx in range(-6, 7):
			if dx * dx + dz * dz > 40:
				continue
			gen.put_world(col, ctx, ax + dx, top, az + dz, pole)
			gen.put_world(col, ctx, ax + dx, top + 1, az + dz, tile)
	# small house on the platform
	for dz in range(-2, 3):
		for dx in range(-2, 3):
			var edge: bool = absi(dx) == 2 or absi(dz) == 2
			if edge:
				for wy in range(top + 2, top + 5):
					gen.put_world(col, ctx, ax + dx, wy, az + dz, wall)
			gen.put_world(col, ctx, ax + dx, top + 5, az + dz, roof)
	if gen.inside(ctx, ax, az):
		if Registry.entities.has("master_karin"):
			col.entities_pending.append({
				"type": "master_karin",
				"pos": Vector3(float(ax) + 0.5, float(top + 2), float(az) + 0.5),
				"data": {"structure": "korin_tower"},
			})
		add_mark(col, "korin_tower", "dragonminez:korin_tower",
			AABB(Vector3(ax - 7, float(maxi(0, ground - 2)), az - 7),
				Vector3(15, float(top + 7 - ground), 15)))

## Does this footprint reach into the protected spawn clearing?
func _covers_spawn(min_x: int, min_z: int, ext_x: int, ext_z: int) -> bool:
	var sp: Vector2i = gen.spawn_xz
	var r: int = int(gen.spawn_clear_radius) + 1
	return min_x - r < sp.x and sp.x < min_x + ext_x + r \
		and min_z - r < sp.y and sp.y < min_z + ext_z + r

func _near_column(ctx, wx: int, wz: int, r: int) -> bool:
	return wx + r >= ctx.ox and wx - r < ctx.ox + 16 and wz + r >= ctx.oz and wz - r < ctx.oz + 16

# --- placement helpers -----------------------------------------------------

func _resolve_y(entry: Dictionary, special: Dictionary, ax: int, az: int, size: Vector3i) -> int:
	if special.has("dest_y"):
		return int(special["dest_y"])
	var mode: String = entry["y_mode"]
	if mode == "absolute" or mode == "sky":
		var y: int = gen.remap_structure_y(int(entry["y"]), mode)
		return clampi(y, 1, maxi(1, HEIGHT - 2))
	var ground: int = gen.terrain.height_at(ax, az)
	if gen.has_sea:
		ground = maxi(ground, gen.sea_level + 1)
	return clampi(ground, 1, maxi(1, HEIGHT - mini(size.y, 20) - 1))

## Is this anchor allowed here? `relax` 0 = the structure's own biome list, 1 = any biome whose
## surface block matches one of them (Earth carries 70 biomes since the Nature's Spirit set was
## added, so a story structure's two or three listed biomes can be rare), 2 = any dry land.
func _valid_site(entry: Dictionary, ax: int, az: int, relax: int = 0) -> bool:
	var min_d: int = int(entry["min_dist"])
	if min_d > 0 and (ax * ax + az * az) < min_d * min_d:
		return false
	var list: Array = entry["biomes"]
	if list.is_empty():
		return true
	var bid: String = gen.biome_map.id_at_world(ax, az)
	for b in list:
		if String(b) == bid:
			return true
	if relax <= 0:
		return false
	if relax >= 2:
		return true
	var surfaces: PackedInt32Array = entry.get("surfaces", PackedInt32Array())
	if surfaces.is_empty():
		return false
	return surfaces.has(Registry.block_id(String(Registry.biome(bid).get("surface", ""))))

## One seeded position per unique structure. x == 0x7fffffff means "not on this planet".
func unique_position(entry: Dictionary) -> Vector3i:
	var sid: String = entry["id"]
	_mutex.lock()
	var hit: Variant = _unique.get(sid, null)
	_mutex.unlock()
	if hit != null:
		return hit
	var pos := _search_unique(entry)
	_mutex.lock()
	_unique[sid] = pos
	_mutex.unlock()
	return pos

## Pin a unique structure's position (used by generators that decide it themselves, e.g. the
## Other World placing King Kai's planet at the end of Snake Way).
func set_unique(sid: String, pos: Vector3i) -> void:
	_mutex.lock()
	_unique[sid] = pos
	_mutex.unlock()

func _search_unique(entry: Dictionary) -> Vector3i:
	var sid: String = entry["id"]
	var special: Dictionary = SPECIAL.get(sid, {})
	var def: Dictionary = entry["def"]
	if special.has("offset_from_spawn"):
		var o: Array = special["offset_from_spawn"]
		return Vector3i(int(o[0]), 0, int(o[1]))
	if def.has("fixed_position"):
		var fp: Array = def["fixed_position"]
		if fp.size() >= 3:
			return Vector3i(int(fp[0]), 0, int(fp[2]))
	var min_d: int = maxi(120, int(entry["min_dist"]))
	var max_d: int = mini(1400, min_d + 520)
	# Beach / ocean structures search around the bay the Earth height field carves out.
	var center := Vector2.ZERO
	var biomes: Array = entry["biomes"]
	if gen.planet_id == "earth":
		for b in biomes:
			var bs := String(b)
			if bs == "beach" or bs == "ocean" or bs == "deep_ocean":
				center = Terrain.EARTH_BAY
				break
	var rot_seed := Terrain.hash_unit(gen.seed, absi(int(sid.hash())) & 0xffff, 5, 7) * TAU
	for relax in 3:
		for k in UNIQUE_SAMPLES:
			var t := (float(k) + 0.5) / float(UNIQUE_SAMPLES)
			var r := float(max_d) * sqrt(t)
			var ang := rot_seed + float(k) * 2.39996323
			var x := int(round(center.x + cos(ang) * r))
			var z := int(round(center.y + sin(ang) * r))
			var d2 := x * x + z * z
			if d2 < min_d * min_d or d2 > max_d * max_d:
				continue
			if not _valid_site(entry, x, z, relax):
				continue
			if String(entry["y_mode"]) == "surface" and gen.has_sea:
				var gh: int = gen.terrain.height_at(x, z)
				if gh <= gen.sea_level + 1 or gh >= 100:
					continue                      # not in the water, not on a snow peak
			return Vector3i(x, 0, z)
	return Vector3i(min_d + 40, 0, min_d + 40)

# --- rotation helpers ------------------------------------------------------

## Template-local (x, z) after rotation, still relative to the rotated volume's corner.
static func _rotate_point(sx: int, sz: int, size: Vector3i, rot: int) -> Vector2i:
	match rot & 3:
		1: return Vector2i(size.z - 1 - sz, sx)
		2: return Vector2i(size.x - 1 - sx, size.z - 1 - sz)
		3: return Vector2i(sz, size.x - 1 - sx)
		_: return Vector2i(sx, sz)

## The origin_offset, rotated the same way (x/z swap for odd rotations).
static func _rot_off(off: Vector3i, rot: int) -> Vector2i:
	if (rot & 1) == 1:
		return Vector2i(off.z, off.x)
	return Vector2i(off.x, off.z)

## Template-space bbox (min x, max x, min z, max z) of the 16x16 column at rotated (rx0, rz0).
static func _template_bbox(rx0: int, rz0: int, size: Vector3i, rot: int) -> Vector4:
	var xs := [rx0, rx0 + 15]
	var zs := [rz0, rz0 + 15]
	var min_x := 1 << 30
	var max_x := -(1 << 30)
	var min_z := 1 << 30
	var max_z := -(1 << 30)
	for rx in xs:
		for rz in zs:
			var p := _inverse_rotate(rx, rz, size, rot)
			min_x = mini(min_x, p.x)
			max_x = maxi(max_x, p.x)
			min_z = mini(min_z, p.y)
			max_z = maxi(max_z, p.y)
	return Vector4(float(min_x), float(max_x), float(min_z), float(max_z))

static func _inverse_rotate(rx: int, rz: int, size: Vector3i, rot: int) -> Vector2i:
	match rot & 3:
		1: return Vector2i(rz, size.z - 1 - rx)
		2: return Vector2i(size.x - 1 - rx, size.z - 1 - rz)
		3: return Vector2i(size.x - 1 - rz, rx)
		_: return Vector2i(rx, rz)

# --- template loading ------------------------------------------------------
#
# Memory matters here: the 43 converted templates are 12.6 MB of JSON, and parsing them all
# into Dictionaries/Arrays costs ~230 MB of static memory - enough for Android's low-memory
# killer to take the game down on the loading screen. So:
#
#   * headers (size / origin_offset / clear_box / entity list) are read from the first and
#     last few kilobytes of the file and kept forever: a few hundred bytes each. A column can
#     therefore decide whether a structure reaches it without touching the block data at all.
#   * block data is parsed only for a column the structure really overlaps, in ~32 KB chunks
#     (so the temporary Variant tree stays tiny), straight into ONE PackedInt32Array of
#     `x | y<<8 | z<<16 | palette<<24` - 4 bytes per placed block - bucketed into 16x16 tiles
#     through a 256-entry offset table. The palette is a PackedByteArray of block ids.
#   * at most MAX_CACHED_BLOCKS templates (and MAX_CACHE_BYTES) stay cached, least recently
#     used first out. Callers hold a reference while they stamp, so eviction is always safe.

## Bytes of JSON handed to one JSON.parse call while scanning the blocks array.
const PARSE_CHUNK_BYTES := 32768
## Window read from the start / end of the file for the header fields.
const HEADER_BYTES := 32768
const FOOTER_BYTES := 16384
## Block data cache limits.
const MAX_CACHED_BLOCKS := 4
const MAX_CACHE_BYTES := 4 << 20

## path -> {size: Vector3i, off: Vector3i, clear: bool, ents: Array}  (tiny, kept for good)
static var _headers: Dictionary = {}
static var _hdr_mutex := Mutex.new()
## cache key -> {data: PackedInt32Array, starts: PackedInt32Array, counts: PackedInt32Array,
##               pal: PackedByteArray, bytes: int}
static var _blocks: Dictionary = {}
static var _blocks_lru: PackedStringArray = PackedStringArray()
static var _blocks_bytes := 0

## Header fields only - never touches the block data.
static func header(path: String) -> Dictionary:
	_hdr_mutex.lock()
	var hit: Variant = _headers.get(path, null)
	_hdr_mutex.unlock()
	if hit != null:
		return hit
	var built := _read_header(path)
	_hdr_mutex.lock()
	_headers[path] = built
	_hdr_mutex.unlock()
	return built

static func _read_header(path: String) -> Dictionary:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		Log.w("Structures: cannot open template " + path)
		return {}
	var len_total := int(f.get_length())
	var head := f.get_buffer(mini(HEADER_BYTES, len_total)).get_string_from_utf8()
	var tail := head
	if len_total > HEADER_BYTES:
		f.seek(maxi(0, len_total - FOOTER_BYTES))
		tail = f.get_buffer(mini(FOOTER_BYTES, len_total)).get_string_from_utf8()
	f.close()
	var size := _int_triple(head, "\"size\"", Vector3i(1, 1, 1))
	var off := _int_triple(tail, "\"origin_offset\"", Vector3i.ZERO)
	var ents: Array = []
	var e_at := tail.find("\"entities\"")
	if e_at >= 0:
		var span := _span(tail, e_at, "[", "]")
		if span.x >= 0:
			var json := JSON.new()
			if json.parse(tail.substr(span.x, span.y - span.x + 1)) == OK and json.data is Array:
				ents = json.data
	return {
		"size": size,
		"off": off,
		"clear": tail.find("\"clear_box\":true") >= 0,
		"ents": ents,
	}

## Compact block data for a template (optionally cropped to a source y range).
static func blocks_of(path: String, src_min := 0, src_max := 255) -> Dictionary:
	var key := path if (src_min == 0 and src_max >= 255) else "%s|%d|%d" % [path, src_min, src_max]
	_tpl_mutex.lock()
	var hit: Variant = _blocks.get(key, null)
	if hit != null:
		_touch(key)
		_tpl_mutex.unlock()
		return hit
	_tpl_mutex.unlock()
	var built := _parse_blocks(path, src_min, src_max)
	_tpl_mutex.lock()
	if not _blocks.has(key):
		_blocks[key] = built
		_blocks_lru.append(key)
		_blocks_bytes += int(built.get("bytes", 0))
		_evict()
	else:
		built = _blocks[key]
		_touch(key)
	_tpl_mutex.unlock()
	return built

## Both halves together (used by the tests and by anything that wants one dictionary).
static func template(path: String, src_min := 0, src_max := 255) -> Dictionary:
	var hdr := header(path)
	if hdr.is_empty():
		return {}
	var blk := blocks_of(path, src_min, src_max)
	var out := hdr.duplicate()
	for k in blk.keys():
		out[k] = blk[k]
	return out

## Drop every cached template body (the headers are tiny and stay).
static func release_cache() -> void:
	_tpl_mutex.lock()
	_blocks.clear()
	_blocks_lru = PackedStringArray()
	_blocks_bytes = 0
	_tpl_mutex.unlock()

static func cache_stats() -> Dictionary:
	_tpl_mutex.lock()
	var out := {"templates": _blocks.size(), "bytes": _blocks_bytes, "headers": _headers.size()}
	_tpl_mutex.unlock()
	return out

## _tpl_mutex must be held.
static func _touch(key: String) -> void:
	var i := _blocks_lru.find(key)
	if i >= 0:
		_blocks_lru.remove_at(i)
	_blocks_lru.append(key)

## _tpl_mutex must be held.
static func _evict() -> void:
	while _blocks_lru.size() > MAX_CACHED_BLOCKS or (_blocks_bytes > MAX_CACHE_BYTES and _blocks_lru.size() > 1):
		var oldest: String = _blocks_lru[0]
		_blocks_lru.remove_at(0)
		var gone: Dictionary = _blocks.get(oldest, {})
		_blocks_bytes -= int(gone.get("bytes", 0))
		_blocks.erase(oldest)

## Chunked scan of the `blocks` array into packed arrays. Peak memory is the raw file bytes
## plus one 32 KB chunk, instead of a multi-hundred-megabyte Variant tree.
static func _parse_blocks(path: String, src_min: int, src_max: int) -> Dictionary:
	# Empty result still carries a full offset table, so the stamping loop can index it blindly.
	var zero_starts := PackedInt32Array()
	zero_starts.resize(256)
	var zero_counts := PackedInt32Array()
	zero_counts.resize(256)
	var empty := {
		"data": PackedInt32Array(), "starts": zero_starts, "counts": zero_counts,
		"pal": PackedByteArray(), "bytes": 2048,
	}
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		Log.w("Structures: cannot open template " + path)
		return empty
	var total := int(f.get_length())
	var bytes := f.get_buffer(total)
	f.close()
	# palette + the byte offset of the blocks array, from the head of the file
	var head := bytes.slice(0, mini(HEADER_BYTES, total)).get_string_from_utf8()
	var pal := PackedByteArray()
	var p_at := head.find("\"palette\"")
	if p_at >= 0:
		var p_span := _span(head, p_at, "[", "]")
		if p_span.x >= 0:
			var json_pal := JSON.new()
			if json_pal.parse(head.substr(p_span.x, p_span.y - p_span.x + 1)) == OK and json_pal.data is Array:
				for name in json_pal.data:
					var bid := Registry.block_id(String(name))
					pal.append(bid if bid > 0 and bid < 256 else 0)
	if pal.is_empty():
		pal.append(0)
	var b_at := head.find("\"blocks\"")
	if b_at < 0:
		return empty
	var open_at := head.find("[", b_at)
	if open_at < 0:
		return empty
	# One pass: parse chunk by chunk, collect the encoded cells and count them per tile.
	var all := PackedInt32Array()
	var counts := PackedInt32Array()
	counts.resize(256)
	var json := JSON.new()
	var s := open_at + 1
	var last := _blocks_end(bytes, total, s)
	while last > 0 and s <= last:
		var chunk_end := last + 1
		if s + PARSE_CHUNK_BYTES < last:
			var b := _find_entry_break(bytes, s + PARSE_CHUNK_BYTES, last)
			if b > 0:
				chunk_end = b + 1
		var chunk := "[" + bytes.slice(s, chunk_end).get_string_from_utf8() + "]"
		if json.parse(chunk) == OK and json.data is Array:
			for e in json.data:
				if not e is Array or e.size() < 4:
					continue
				var x := int(e[0])
				var y := int(e[1])
				var z := int(e[2])
				var pi := int(e[3])
				if y < src_min or y > src_max:
					continue
				if x < 0 or x > 255 or y < 0 or y > 255 or z < 0 or z > 255:
					continue
				if pi < 0 or pi >= pal.size() or pal[pi] == 0:
					continue
				all.append(x | (y << 8) | (z << 16) | (pi << 24))
				var ti := (x >> 4) + 16 * (z >> 4)
				counts[ti] = counts[ti] + 1
		s = chunk_end + 1
	# Counting sort into one array with a 256-entry offset table (no per-tile arrays).
	var starts := PackedInt32Array()
	starts.resize(256)
	var acc := 0
	for i in 256:
		starts[i] = acc
		acc += counts[i]
	var cursors := starts.duplicate()
	var data := PackedInt32Array()
	data.resize(all.size())
	for i in all.size():
		var v := all[i]
		var ti2 := ((v & 255) >> 4) + 16 * (((v >> 16) & 255) >> 4)
		data[cursors[ti2]] = v
		cursors[ti2] = cursors[ti2] + 1
	return {
		"data": data, "starts": starts, "counts": counts, "pal": pal,
		"bytes": data.size() * 4 + 2048 + pal.size(),
	}

## Index of the ']' that closes the LAST `[x,y,z,p]` entry of the blocks array, or -1 when the
## array is empty. The keys after `blocks` ("entities", "origin_offset") mark where it ends, so
## this never has to walk the whole file.
static func _blocks_end(bytes: PackedByteArray, total: int, from: int) -> int:
	if from < total and bytes[from] == 0x5D:       # "blocks":[]
		return -1
	var tail_len: int = mini(FOOTER_BYTES, total)
	var tail := bytes.slice(total - tail_len, total).get_string_from_utf8()
	var cut := total
	var marker := tail.find("\"entities\"")
	if marker < 0:
		marker = tail.find("\"origin_offset\"")
	if marker >= 0:
		cut = total - tail_len + marker
	# the ']' that closes the blocks array, then the one that closes its last entry
	var outer := -1
	var i := cut - 1
	while i > from:
		if bytes[i] == 0x5D:
			outer = i
			break
		i -= 1
	if outer < 0:
		return -1
	i = outer - 1
	while i > from:
		if bytes[i] == 0x5D:
			return i
		i -= 1
	return -1

## First "],[" boundary at or after `from`; returns the index of its ']'.
static func _find_entry_break(bytes: PackedByteArray, from: int, last: int) -> int:
	var i := from
	while i < last - 1:
		if bytes[i] == 0x5D and bytes[i + 1] == 0x2C and bytes[i + 2] == 0x5B:
			return i
		i += 1
	return -1

## "key":[a,b,c] -> Vector3i
static func _int_triple(text: String, key: String, fallback: Vector3i) -> Vector3i:
	var at := text.find(key)
	if at < 0:
		return fallback
	var span := _span(text, at, "[", "]")
	if span.x < 0:
		return fallback
	var parts := text.substr(span.x + 1, span.y - span.x - 1).split(",")
	if parts.size() < 3:
		return fallback
	return Vector3i(int(parts[0]), int(parts[1]), int(parts[2]))

## Balanced span of `open`/`close` starting at or after `from`; x = open index, y = close index.
static func _span(text: String, from: int, open_ch: String, close_ch: String) -> Vector2i:
	var start := text.find(open_ch, from)
	if start < 0:
		return Vector2i(-1, -1)
	var depth := 0
	var i := start
	var n := text.length()
	while i < n:
		var c := text[i]
		if c == open_ch:
			depth += 1
		elif c == close_ch:
			depth -= 1
			if depth == 0:
				return Vector2i(start, i)
		i += 1
	return Vector2i(-1, -1)
