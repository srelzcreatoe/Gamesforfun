class_name DmzOptions
extends RefCounted
## How many variants of each DragonMineZ customization option a race has, for the creation
## screen's arrow rows.
##
## RaceSkin owns the index -> texture mapping and exposes the counts and index lists
## (`body_type_count`, `body_types`, `eye_type_count`, `nose_count`, `mouth_count`,
## `tattoo_count`, `body_color_layers`), so this file is only an adapter: it calls those through
## `has_method()` and falls back to probing the texture set when the script is missing, so the
## screen still builds (with one option per row) in a stripped build.
##
## Body type indices are NOT contiguous: RaceSkin de-duplicates indices that resolve to the same
## art, so a row must offer `body_type_values()[i]` rather than `i`.

const RACE_SKIN := "res://scripts/entity/RaceSkin.gd"
const TEX_DIR := "res://assets/textures/entity/"
const MAX_PROBE := 32

## race id -> texture directory, only used by the fallback probe.
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

## The body_type values this race actually has, in order (see the note above).
static func body_type_values(race_id: String, gender := "male") -> Array[int]:
	var out: Array[int] = []
	var rs := _race_skin()
	if rs != null and rs.has_method("body_types"):
		for v in rs.call("body_types", race_id, gender):
			out.append(int(v))
	if out.is_empty():
		for i in _probe_body_types(race_id, gender):
			out.append(i)
	if out.is_empty():
		out.append(0)
	return out

static func body_types(race_id: String, gender := "male") -> int:
	var n := _count("body_type_count", [race_id, gender])
	return n if n > 0 else body_type_values(race_id, gender).size()

## Eye variants. A race with no numbered eye set (bioandroid) still composes one, so this is
## never 0.
static func eye_types(race_id: String) -> int:
	var n := _count("eye_type_count", [race_id])
	if n > 0:
		return n
	return maxi(1, _cached("eye:%s" % race_id, func() -> int:
		return _count_face(race_dir(race_id), "eye", "_0")))

## Noses and mouths can be 0 (bioandroid has neither) - the row is then hidden.
static func noses(race_id: String) -> int:
	var n := _count("nose_count", [race_id])
	if n > 0:
		return n
	return _cached("nose:%s" % race_id, func() -> int:
		return _count_face(race_dir(race_id), "nose", ""))

static func mouths(race_id: String) -> int:
	var n := _count("mouth_count", [race_id])
	if n > 0:
		return n
	return _cached("mouth:%s" % race_id, func() -> int:
		return _count_face(race_dir(race_id), "mouth", ""))

## Tattoo overlays in races/tattoos (the character keeps -1 for "none").
static func tattoos() -> int:
	var n := _count("tattoo_count", [])
	if n > 0:
		return n
	return _cached("tattoo", func() -> int:
		var i := 0
		while i < MAX_PROBE and _exists("races/tattoos/tattoo_%d" % i):
			i += 1
		return i)

## How many of body_color1..3 actually tint something for this race (1..3).
static func body_color_layers(race_id: String, gender := "male") -> int:
	var n := _count("body_color_layers", [race_id, gender])
	if n > 0:
		return clampi(n, 1, 3)
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

static func _count(method: String, args: Array) -> int:
	var rs := _race_skin()
	if rs != null and rs.has_method(method):
		return maxi(0, int(rs.callv(method, args)))
	return 0

static func _race_skin() -> GDScript:
	if not ResourceLoader.exists(RACE_SKIN):
		return null
	return load(RACE_SKIN)

static func _probe_body_types(race_id: String, gender: String) -> Array[int]:
	var key := "body:%s:%s" % [race_id, gender]
	if _cache.has(key):
		return _cache[key]
	var dir := race_dir(race_id)
	var seen := PackedStringArray()
	var out: Array[int] = []
	for i in MAX_PROBE:
		var base := _body_base(dir, gender, i)
		if base == "":
			break
		if not seen.has(base):
			seen.append(base)
			out.append(i)
	_cache[key] = out
	return out

## The base path a body type index resolves to, or "" when nothing matches.
static func _body_base(dir: String, gender: String, body: int) -> String:
	for base in [
		"races/%s/bodytype_%s_%d" % [dir, gender, body],
		"races/%s/bodytype_%s_%d" % [dir, gender, body + 1],
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
