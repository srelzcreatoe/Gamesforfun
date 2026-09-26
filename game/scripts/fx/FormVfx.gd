class_name FormVfx
extends RefCounted
## Per-form VFX profile resolved from `data/forms.json` (+ `data/races.json`).
##
## THE RESOLUTION IS DragonMineZ'S OWN, verified against
## `com.dragonminez.client.render.effects.AuraRenderer.getAuraLayers` (javap -p -c):
##
##   auraColor  = character.getAuraColor()                      # the character's colour
##   auraType   = raceConfig.getAuraType() (else "kakarot")
##   auraLayer  = 0
##   if (character.hasActiveForm() && formData != null) {
##       if (formData.getAuraColor() is non-empty) auraColor = formData.getAuraColor()
##       if (formData.getAuraType()  is non-empty) auraType  = formData.getAuraType()
##       auraLayer = formData.getAuraLayer() (else 0)
##   }
##
## That is the WHOLE chain: the form's own `auraColor` when it has one, otherwise the
## character's colour (which character creation seeds from `races.json.defaultAuraColor`),
## otherwise nothing. The mod NEVER derives an aura colour from `lightningColor`,
## `hairColor`, `bodyColor*`, `eye*Color`, `extraAuraColor` or a per-group palette, and
## neither do we: a Namekian form with no `auraColor` is race green, not the colour of
## its eyes. `aura_from_form` says whether the form itself carried the colour, so
## `Aura.set_form` can let a player's own aura colour through when it did not.
##
##   var p := FormVfx.of(Forms.def("supersaiyan.supersaiyan2"))
##   p.aura, p.inner, p.lightning, p.lightning_color, p.hair, p.eye
##   p.aura_type ("kakarot"/"god" -> the flame strip), p.aura_layer (0-6)
##   p.tier (0 minor / 1 major / 2 epic), p.duration, p.scale, p.giant, p.anim_state
##
## `aura_source` names where the colour came from ("auraColor", "race" or "fallback"),
## so the tests can prove that no form whose data has a colour falls back to a default.

const TIER_MINOR := 0
const TIER_MAJOR := 1
const TIER_EPIC := 2

## Cinematic length per tier (seconds). Minor forms are a quick flare, epic forms get
## the full four-phase show.
const TIER_DURATION: Array[float] = [2.6, 4.7, 5.8]

## Groups that are "power-up" style boosts rather than a new form.
const MINOR_GROUPS: Array[String] = ["kaioken"]

## Colour ramps: a family name per hue, used for the spark tint and the "hot band" of
## the aura so a gold aura burns white-yellow and a violet one burns magenta-white.
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

## The ONLY forms.json field that may drive the aura colour (DMZ: FormData.getAuraColor).
const AURA_COLOR_FIELD := "auraColor"
## Kept for the tests / callers that want to know which colour fields a form authored.
const COLOR_FIELDS: Array[String] = [
	"auraColor", "extraAuraColor", "lightningColor", "hairColor",
	"bodyColor1", "bodyColor2", "bodyColor3", "eye1Color", "eye2Color", "extraFormColor",
]
const AURA_FIELDS: Array[String] = [AURA_COLOR_FIELD]
## A colour below this saturation reads as "white/grey" rather than as energy.
const MIN_AURA_SATURATION := 0.18

## DMZ's own default character aura colour, and the value `races.json` carries for the
## races that do not tint it (human/saiyan `defaultAuraColor`).
const DEFAULT_AURA := Color(127.0 / 255.0, 1.0, 1.0)        # #7FFFFF

## The flame strip a layer is drawn with (`<type>_aura.png` / `<type>_cross.png`).
const DEFAULT_AURA_TYPE := "kakarot"
## DMZ clamps the layer id to 0..6 (AuraRenderer.putLayer -> Mth.clamp(id, 0, 6)).
const MAX_AURA_LAYER := 6

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

## DMZ aura composition: which flame strip and which layer slot (0-6, nested outward).
var aura_type := DEFAULT_AURA_TYPE
var aura_layer := 0
## DMZ body tint while the form is held (`tintColor` x `tintIntensity`; kaioken glows red).
var tint := Color(1, 0, 0)
var tint_amount := 0.0

## Where the aura colour came from: "auraColor" (the form's own field), "race" (the
## race default, which is also the character's own colour) or "fallback" (no data at
## all). Only "auraColor" means the FORM chose it.
var aura_source := "fallback"
## True when the form's own `auraColor` decided the colour. When false, DMZ lets the
## character's personal aura colour through, so `Aura.set_form` may override `aura`.
var aura_from_form := false
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

	# DMZ AuraRenderer.getAuraLayers: the form's own auraColor, else the character's
	# colour (seeded from the race default), else nothing. No other field, ever.
	var own := _clean(String(d.get(AURA_COLOR_FIELD, "")))
	if own != "":
		aura = Color(own)
		aura_source = AURA_COLOR_FIELD
		aura_from_form = true
	else:
		var rc := _race_color()
		if rc != "":
			aura = Color(rc)
			aura_source = "race"
		else:
			aura = DEFAULT_AURA
			aura_source = "fallback"

	aura_type = _resolve_aura_type(d)
	aura_layer = clampi(int(d.get("auraLayer", 0)), 0, MAX_AURA_LAYER)

	family = family_of(aura)
	inner = hot_band(aura)
	glow = aura.lerp(Color(1, 1, 1), 0.28)
	spark = inner

	var tc := _clean(String(d.get("tintColor", "")))
	if tc != "":
		tint = Color(tc)
	tint_amount = clampf(float(d.get("tintIntensity", 0.0)), 0.0, 1.0)

	var hc := _clean(String(d.get("hairColor", "")))
	hair = Color(hc) if hc != "" else aura.lerp(Color(1, 1, 1), 0.35)
	var ec := _clean(String(d.get("eye1Color", "")))
	if ec == "":
		ec = _clean(String(d.get("eye2Color", "")))
	eye = Color(ec) if ec != "" else inner

	lightning = bool(d.get("hasLightnings", false))
	var lc := _clean(String(d.get("lightningColor", "")))
	lightning_color = Color(lc) if lc != "" else aura.lerp(Color(0.85, 0.95, 1.0), 0.55)

## The aura's hottest colour band, the way the mod's own shader builds it: the form
## colour multiplied by 1.6 and clamped. It is the same HUE as the aura - never a
## near-white pastel, which is what used to wash a green Namekian aura out to white.
static func hot_band(c: Color) -> Color:
	return Color(minf(c.r * 1.6, 1.0), minf(c.g * 1.6, 1.0), minf(c.b * 1.6, 1.0), c.a)

## `auraType` of the form, else of the race, else DMZ's default ("kakarot").
func _resolve_aura_type(d: Dictionary) -> String:
	var t := String(d.get("auraType", "")).strip_edges().to_lower()
	if t != "":
		return t
	if Registry != null and race != "":
		var r: Dictionary = Registry.race(race)
		var rt := String(r.get("auraType", "")).strip_edges().to_lower()
		if rt != "":
			return rt
	return DEFAULT_AURA_TYPE

## Minor (kaioken-like) / major / epic, from group, order, scale and lightning.
func _resolve_tier(d: Dictionary) -> int:
	if MINOR_GROUPS.has(group):
		return TIER_MINOR
	var epic := order >= 2 or scale >= 2.0 or bool(d.get("hasLightnings", false))
	if epic:
		return TIER_EPIC
	return TIER_MAJOR

## Pale tint of the hue family, for the sparks/motes that should read lighter than the
## flame itself (the aura's own bands are always the form colour).
func pale() -> Color:
	var ramp := String(FAMILY_INNER.get(family, "#FFFFFF"))
	return aura.lerp(Color(ramp), 0.6)

func _race_color() -> String:
	if Registry == null or race == "":
		return ""
	var r: Dictionary = Registry.race(race)
	return _clean(String(r.get("defaultAuraColor", "")))

## Does this form's own data decide its aura colour? (DMZ: a non-empty `auraColor`.)
static func has_own_color(d: Dictionary) -> bool:
	return _clean(String(d.get(AURA_COLOR_FIELD, ""))) != ""

## The form's own aura colour as authored, or "" - the ONLY field DMZ reads for the aura.
static func own_color(d: Dictionary) -> String:
	return _clean(String(d.get(AURA_COLOR_FIELD, "")))

## Every colour field this form actually fills in (diagnostics + the colour table test).
## Filling one of these is NOT enough to colour the aura: only `auraColor` is.
static func authored_fields(d: Dictionary) -> PackedStringArray:
	var out := PackedStringArray()
	for f in COLOR_FIELDS:
		if _clean(String(d.get(f, ""))) != "":
			out.append(f)
	return out

static func _clean(s: String) -> String:
	var t := s.strip_edges()
	if t == "" or not t.begins_with("#"):
		return ""
	if t.length() != 7 and t.length() != 9 and t.length() != 4:
		return ""
	return t.to_upper()

## Hue family of a colour, used for the pale spark tint and the readability tests.
static func family_of(c: Color) -> String:
	var s := c.s
	if s < 0.16:
		return "white"
	var h := c.h * 360.0
	if h < 16.0 or h >= 330.0:
		return "crimson" if h < 16.0 else "pink"      # 330-360 is rose/pink, not red
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
	if h < 285.0:
		return "violet"
	# 285-330 is the magenta wedge: DMZ's majin pink (#FF6DFF, 300 deg) and the rose
	# god palette both live here
	return "pink"
