class_name DmzOptions
extends RefCounted
## How many variants of each DragonMineZ customization option a race has.
##
## RaceSkin.compose() picks the body/face layer files by index, so the creation screen has to
## know how far each arrow row may count. When RaceSkin exposes the counts itself (see the note
## in `_from_race_skin`) those win; otherwise the texture set is probed here, mirroring
## RaceSkin._body_layers()'s candidate order so an index we offer always resolves to a file.
##
## Everything is cached: a probe is a handful of ResourceLoader.exists() calls, but the arrow
## rows ask on every rebuild and every race change.

const RACE_SKIN := "res://scripts/entity/RaceSkin.gd"
const TEX_DIR := "res://assets/textures/entity/"
const MAX_PROBE := 32

## race id -> texture directory, same table as RaceSkin.RACE_DIRS.
const RACE_DIRS := {
	"human": "humansaiyan", "saiyan": "humansaiyan", "humansaiyan": "humansaiyan",
	"halfsaiyan": "humansaiyan", "half_saiyan": "humansaiyan",
	"namek": "namekian", "namekian": "namekian",
	"majin": "majin", "buu": "majin",
	"bioandroid": "bioandroid", "android": "bioandroid", "cell": "bioandroid",
	"frostdemon": "frostdemon", "coldemon": "frostdemon", "arcosian": "frostdemon",
	"frieza": "frostdemon", "frieza_race": "frostdemon",
}

static var _cache: Dictionary = {}

static func race_dir(race_id: String) -> String:
	var rs := _race_skin()
	if rs != null and rs.has_method("race_dir"):
		return String(rs.call("race_dir", race_id))
	return String(RACE_DIRS.get(race_id, "humansaiyan"))

## Number of selectable body types. Indices are what RaceSkin takes as `body_type`, so an index
## whose layers resolve to the same files as the previous one is not offered twice.
static func body_types(race_id: String, gender := "male") -> int:
	var n := _from_race_skin("body_type_count", [race_id, gender])
	if n > 0:
		return n
	return _cached("body:%s:%s" % [race_id, gender], func() -> int:
		var dir := race_dir(race_id)
		var seen := PackedStringArray()
		for i in MAX_PROBE:
			var base := _body_base(dir, gender, i)
			if base == "" or seen.has(base):
				break
			seen.append(base)
		return maxi(1, seen.size()))

## Number of eye variants (`faces/<dir>_eye_<n>_0`). Races that ship a single unnumbered eye
## set (bioandroid's `base_eye_layer0`) report 1.
static func eye_types(race_id: String) -> int:
	var n := _from_race_skin("eye_type_count", [race_id])
	if n > 0:
		return n
	return _cached("eye:%s" % race_id, func() -> int:
		var dir := race_dir(race_id)
		var count := _count_face(dir, "eye", "_0")
		if count > 0:
			return count
		return 1)

static func noses(race_id: String) -> int:
	var n := _from_race_skin("nose_count", [race_id])
	if n > 0:
		return n
	return _cached("nose:%s" % race_id, func() -> int:
		return _count_face(race_dir(race_id), "nose", ""))

static func mouths(race_id: String) -> int:
	var n := _from_race_skin("mouth_count", [race_id])
	if n > 0:
		return n
	return _cached("mouth:%s" % race_id, func() -> int:
		return _count_face(race_dir(race_id), "mouth", ""))

## Tattoo overlays in races/tattoos (the character keeps -1 for "none").
static func tattoos() -> int:
	var n := _from_race_skin("tattoo_count", [])
	if n > 0:
		return n
	return _cached("tattoo", func() -> int:
		var i := 0
		while i < MAX_PROBE and _exists("races/tattoos/tattoo_%d" % i):
			i += 1
		return i)

## How many of skin_color / skin_color2 / skin_color3 actually tint something: RaceSkin tints
## `<body>_layerN` with colour N, so a race whose body is one layer only uses the first.
static func body_color_layers(race_id: String, gender := "male") -> int:
	var n := _from_race_skin("body_color_layers", [race_id, gender])
	if n > 0:
		return n
	return _cached("layers:%s:%s" % [race_id, gender], func() -> int:
		var base := _body_base(race_dir(race_id), gender, 0)
		if base == "" or _exists(base):
			return 1        # a single unsuffixed mask (humansaiyan) is layer 1 only
		var count := 1
		for l in [2, 3]:
			if _exists("%s_layer%d" % [base, l]):
				count = l
		return count)

# --- internals -------------------------------------------------------------

## RaceSkin owns the index -> file mapping; prefer its own count when it has one so this file
## cannot drift away from the composer.
static func _from_race_skin(method: String, args: Array) -> int:
	var rs := _race_skin()
	if rs != null and rs.has_method(method):
		return maxi(0, int(rs.callv(method, args)))
	return 0

static func _race_skin() -> GDScript:
	if not ResourceLoader.exists(RACE_SKIN):
		return null
	return load(RACE_SKIN)

## The base path RaceSkin._body_layers() resolves for this index, or "" when nothing matches.
static func _body_base(dir: String, gender: String, body: int) -> String:
	for base in [
		"races/%s/bodytype_%s_%d" % [dir, gender, body + 1],
		"races/%s/bodytype_%s_%d" % [dir, gender, body],
		"races/%s/bodytype_%d" % [dir, body],
		"races/%s/base_%d" % [dir, body],
	]:
		if _exists(base):
			return base
		for l in range(1, 6):
			if _exists("%s_layer%d" % [base, l]):
				return base
	return ""

static func _count_face(dir: String, part: String, suffix: String) -> int:
	var i := 0
	while i < MAX_PROBE and _exists("races/%s/faces/%s_%s_%d%s" % [dir, dir, part, i, suffix]):
		i += 1
	return i

## Both texture trees count: compose() reads entity/races/** and switches to entity/hd/** when
## RaceSkin.hd is set.
static func _exists(rel: String) -> bool:
	return ResourceLoader.exists("%s%s.png" % [TEX_DIR, rel]) \
		or ResourceLoader.exists("%shd/%s.png" % [TEX_DIR, rel])

static func _cached(key: String, compute: Callable) -> int:
	if _cache.has(key):
		return int(_cache[key])
	var v := int(compute.call())
	_cache[key] = v
	return v
