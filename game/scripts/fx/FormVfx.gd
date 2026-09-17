class_name FormVfx
extends RefCounted
## Per-form VFX profile resolved from `data/forms.json` (+ `data/races.json`).
##
## Every transformation in the game has to LOOK like itself: Super Saiyan is gold,
## Kaioken is crimson, a Namekian super form is acid green, an Arcosian evolution is
## violet, Majin forms are pink. `forms.json` only fills a few of the colour fields per
## form, so this class walks the data in a fixed priority order and never lands on a
## generic white unless the form really carries no colour anywhere.
##
##   var p := FormVfx.of(Forms.def("supersaiyan.supersaiyan2"))
##   p.aura, p.inner, p.lightning, p.lightning_color, p.hair, p.eye
##   p.tier (0 minor / 1 major / 2 epic), p.duration, p.scale, p.giant, p.anim_state
##
## `aura_source` names the json field the aura colour came from, so the tests can prove
## that a form with colour data never falls through to the group/race/default palette.

const TIER_MINOR := 0
const TIER_MAJOR := 1
const TIER_EPIC := 2

## Cinematic length per tier (seconds). Minor forms are a quick flare, epic forms get
## the full four-phase show.
const TIER_DURATION: Array[float] = [2.6, 4.7, 5.8]

## Groups that are "power-up" style boosts rather than a new form.
const MINOR_GROUPS: Array[String] = ["kaioken"]

## Groups whose later forms crackle even when `hasLightnings` is not set in the data
## (SSJ grade 3, 5th form, ultra Majin, super Namekian...).
const LIGHTNING_GROUPS: Array[String] = [
	"supersaiyan", "ssgrades", "evolutionforms", "bioevolution",
	"legendaryforms", "pureforms", "superforms", "ultimate",
]
const LIGHTNING_FROM_ORDER := 2

## Signature colour per form group, used ONLY when the form itself carries no colour
## in any field. Derived from the DMZ race/form families, not invented per entity.
const GROUP_PALETTE := {
	"supersaiyan": "#FFD700",      # gold
	"ssgrades": "#FFD700",
	"oozaru": "#C8892E",           # great ape brown-gold
	"kaioken": "#DB182C",          # crimson
	"androidforms": "#59C7FF",     # electric blue
	"bioevolution": "#B6FF5A",     # cell green
	"evolutionforms": "#B06BFF",   # arcosian violet
	"pureforms": "#FF6EC7",        # majin pink
	"legendaryforms": "#7CFF3D",   # legendary green
	"superforms": "#FFF3A0",       # pale gold
	"ultimate": "#FFFFFF",
}

## Colour ramps: a family name per hue so the climax light, the sparks and the inner
## core sheet of every race read differently (god/blue/UI/golden/majin/namek/arcosian).
const FAMILY_INNER := {
	"gold": "#FFFBE0",
	"crimson": "#FFD2B0",
	"blue": "#E6FBFF",
	"divine": "#FFE9F4",
	"green": "#E9FFD6",
	"violet": "#F0DCFF",
	"pink": "#FFE7FA",
	"white": "#FFFFFF",
}

## `transformationAnimation` -> the AnimSelect state the entity engineer exposes.
const ANIM_STATE := {
	"transf.generic": "transform",
	"transf.ssj": "transform_ssj",
	"transf.ssj3": "transform_ssj3",
	"transf.ssg2": "transform_god",
	"transf.ozaru": "transform_ozaru",
	"transf.oozaru": "transform_ozaru",
	"transf.freezer": "transform_freezer",
	"transf.berserker": "transform_berserker",
	"transf.janemba": "transform_janemba",
	"transf.daima": "transform_daima",
	"transf.absorb": "transform_absorb",
	"transf.kaioken": "transform",
}

## Colour fields of forms.json, in the order they are consulted for the aura colour.
## `extraAuraColor` is skipped when it is the DMZ default white.
const COLOR_FIELDS: Array[String] = [
	"auraColor", "extraAuraColor", "lightningColor", "hairColor",
	"bodyColor1", "bodyColor2", "bodyColor3", "eye1Color", "eye2Color", "extraFormColor",
]

const DEFAULT_AURA := Color(0.55, 0.92, 1.0)

var id := ""
var name := ""
var group := ""
var race := ""
var order := 0
var tier := TIER_MAJOR
var duration := TIER_DURATION[TIER_MAJOR]

var aura := DEFAULT_AURA
var inner := Color(1, 1, 1)
var glow := Color(1, 1, 1)
var spark := Color(1, 1, 1)
var hair := Color(1, 1, 1)
var eye := Color(1, 1, 1)
var lightning := false
var lightning_color := Color(0.65, 0.85, 1.0)

var scale := 1.0
var giant := false
var anim := "transf.generic"
var anim_state := "transform"

## Where the aura colour came from: a forms.json field name, "group", "race" or
## "fallback". Anything but the first two means the data had nothing to offer.
var aura_source := "fallback"
var family := "white"

static var _cache: Dictionary = {}

# --- construction ---------------------------------------------------------

## Profile for a forms.json entry (cached by form id).
static func of(form_def: Dictionary) -> FormVfx:
	if form_def.is_empty():
		return FormVfx.new()
	var key := String(form_def.get("id", ""))
	if key != "" and _cache.has(key):
		return _cache[key]
	var p := FormVfx.new()
	p._resolve(form_def)
	if key != "":
		_cache[key] = p
	return p

## Profile for a form id (uses Forms.def so the built-in fallbacks work too).
static func for_id(form_id: String) -> FormVfx:
	if form_id == "":
		return FormVfx.new()
	return of(Forms.def(form_id))

## Drop the cache (the tests inject fixtures into Registry.forms).
static func clear_cache() -> void:
	_cache.clear()

# --- resolution -----------------------------------------------------------

func _resolve(d: Dictionary) -> void:
	id = String(d.get("id", ""))
	name = String(d.get("name", id))
	group = String(d.get("group", ""))
	race = String(d.get("race", ""))
	order = int(d.get("order", 0))

	var sc: Variant = d.get("modelScaling", null)
	if sc is Array and (sc as Array).size() >= 2:
		scale = maxf(float((sc as Array)[0]), float((sc as Array)[1]))
	elif sc is float or sc is int:
		scale = float(sc)
	giant = scale >= 2.0

	anim = String(d.get("transformationAnimation", "transf.generic"))
	anim_state = String(ANIM_STATE.get(anim, "transform"))

	tier = _resolve_tier(d)
	duration = TIER_DURATION[tier]

	var found := _first_color(d, COLOR_FIELDS)
	if found.is_empty():
		var gp := String(GROUP_PALETTE.get(group, ""))
		if gp != "":
			aura = Color(gp)
			aura_source = "group"
		else:
			var rc := _race_color()
			if rc != "":
				aura = Color(rc)
				aura_source = "race"
			else:
				aura = DEFAULT_AURA
				aura_source = "fallback"
	else:
		aura = Color(String(found["color"]))
		aura_source = String(found["field"])

	family = family_of(aura)
	inner = _resolve_inner(d)
	glow = aura.lerp(Color(1, 1, 1), 0.45)
	spark = aura.lerp(inner, 0.5)

	var hc := _clean(String(d.get("hairColor", "")))
	hair = Color(hc) if hc != "" else aura.lerp(Color(1, 1, 1), 0.35)
	var ec := _clean(String(d.get("eye1Color", "")))
	if ec == "":
		ec = _clean(String(d.get("eye2Color", "")))
	eye = Color(ec) if ec != "" else inner

	lightning = _resolve_lightning(d)
	var lc := _clean(String(d.get("lightningColor", "")))
	lightning_color = Color(lc) if lc != "" else aura.lerp(Color(0.85, 0.95, 1.0), 0.55)

## Minor (kaioken-like) / major / epic, from group, order, scale and lightning.
func _resolve_tier(d: Dictionary) -> int:
	if MINOR_GROUPS.has(group):
		return TIER_MINOR
	var epic := order >= 2 or scale >= 2.0 or bool(d.get("hasLightnings", false))
	if epic:
		return TIER_EPIC
	return TIER_MAJOR

func _resolve_lightning(d: Dictionary) -> bool:
	if bool(d.get("hasLightnings", false)):
		return true
	if MINOR_GROUPS.has(group):
		return false
	return LIGHTNING_GROUPS.has(group) and order >= LIGHTNING_FROM_ORDER

## Inner core sheet colour: the form's own extra/hair colour when it has one, else the
## family ramp so a gold aura burns white-yellow and a violet one burns magenta-white.
func _resolve_inner(d: Dictionary) -> Color:
	var extra := _clean(String(d.get("extraAuraColor", "")))
	if extra != "" and extra != "#FFFFFF":
		return Color(extra)
	var hc := _clean(String(d.get("hairColor", "")))
	if hc != "" and Color(hc) != aura:
		return Color(hc).lerp(Color(1, 1, 1), 0.35)
	var ramp := String(FAMILY_INNER.get(family, "#FFFFFF"))
	return aura.lerp(Color(ramp), 0.72)

func _race_color() -> String:
	if Registry == null or race == "":
		return ""
	var r: Dictionary = Registry.race(race)
	return _clean(String(r.get("defaultAuraColor", "")))

## First usable colour among `fields`; {} when the form carries none.
static func _first_color(d: Dictionary, fields: Array[String]) -> Dictionary:
	for f in fields:
		var raw := _clean(String(d.get(f, "")))
		if raw == "":
			continue
		if f == "extraAuraColor" and raw == "#FFFFFF":
			continue        # DMZ default, not an authored colour
		return {"field": f, "color": raw}
	return {}

## Colour fields of a form that actually carry authored data (used by the tests).
static func authored_fields(d: Dictionary) -> PackedStringArray:
	var out := PackedStringArray()
	for f in COLOR_FIELDS:
		var raw := _clean(String(d.get(f, "")))
		if raw == "" or (f == "extraAuraColor" and raw == "#FFFFFF"):
			continue
		out.append(f)
	return out

static func _clean(s: String) -> String:
	var t := s.strip_edges()
	if t == "" or not t.begins_with("#"):
		return ""
	if t.length() != 7 and t.length() != 9 and t.length() != 4:
		return ""
	return t.to_upper()

## Hue family of a colour, used for the inner ramp and the spark tint.
static func family_of(c: Color) -> String:
	var s := c.s
	if s < 0.16:
		return "white"
	var h := c.h * 360.0
	if h < 16.0 or h >= 330.0:
		return "crimson" if h < 16.0 else "pink"
	if h < 45.0:
		return "gold" if c.v > 0.6 else "crimson"
	if h < 70.0:
		return "gold"
	if h < 165.0:
		return "green"
	if h < 200.0:
		return "blue"
	if h < 255.0:
		return "blue"
	if h < 290.0:
		return "violet"
	return "divine"
