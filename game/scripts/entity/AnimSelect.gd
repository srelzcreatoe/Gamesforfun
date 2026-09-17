class_name AnimSelect
extends RefCounted
## Clip table for humanoid entities: maps a gameplay STATE to the clip that should
## play, preferring the DragonMineZ clips and falling back to the imported Serious
## Player Animations pack (MIT, `spa.` prefix) for the states DMZ has no clip for.
##
## DMZ clips are never replaced: ki charge, ki blasts, techniques, transformations,
## flight, the melee combo, faints and every `base.*` movement clip keep winning.
## SPA only fills the gaps (sneaking, crawling, climbing, swimming variants, turning,
## eating, tool swings, shield, sleeping) and provides a second opinion for plain
## walk/run/idle/jump/fall, which a caller can force with `prefer_spa`.
##
## Usage (the player/entity code only ever names a STATE):
##     var clip := AnimSelect.choose("walk", anim)        # -> "base.walk"
##     var clip := AnimSelect.choose("crawl", anim)       # -> "spa.crawling"
##     entity.set_locomotion("run", speed)                # picks + plays with blending
##
## `choose()` returns "" when neither pack has anything for the state, so callers
## can leave the current clip alone.

## state -> [DMZ candidates..., SPA candidates...] in priority order.
const TABLE := {
	# --- locomotion ---------------------------------------------------------
	"idle": ["base.idle", "spa.idle_standing", "idle"],
	"walk": ["base.walk", "spa.walking", "walk"],
	"walk_back": ["spa.walking_backwards", "base.walk"],
	"run": ["base.run", "spa.running", "run"],
	"sprint": ["base.run", "spa.running"],
	"jump": ["base.jump", "spa.falling"],
	"fall": ["base.jump", "spa.falling"],
	"land": ["base.landing", "base.jump"],
	"turn_left": ["spa.turn_left"],
	"turn_right": ["spa.turn_right"],
	# --- sneak / crawl / climb (DMZ has crouching, SPA has the rest) ---------
	"sneak": ["base.crouching", "spa.idle_sneak"],
	"sneak_walk": ["base.crouching_walk", "spa.walking_sneak"],
	"sneak_walk_back": ["spa.walking_sneak_backwards", "base.crouching_walk"],
	"crawl": ["base.crawling", "spa.idle_crawling"],
	"crawl_move": ["base.crawling_move", "spa.crawling"],
	"crawl_back": ["spa.crawling_backwards", "base.crawling_move"],
	"climb": ["base.climb", "spa.climbing"],
	"climb_idle": ["spa.idle_climbing", "base.climb"],
	"climb_back": ["spa.climbing_backwards", "base.climb"],
	"climb_sneak": ["spa.climbing_sneak", "base.climb"],
	# --- water --------------------------------------------------------------
	"swim": ["base.swimming", "spa.swimming"],
	"swim_idle": ["spa.idle_in_water", "base.swimming"],
	"swim_forward": ["base.swimming", "spa.forward_in_water"],
	"swim_back": ["spa.backwards_in_water", "base.swimming"],
	"swim_up": ["spa.up_in_water", "base.swimming"],
	# --- flight (DMZ only) --------------------------------------------------
	"fly": ["base.fly_idle", "base.fly_front"],
	"fly_idle": ["base.fly_idle"],
	"fly_forward": ["base.fly_front", "base.fly_idle"],
	"fly_back": ["base.fly_back", "base.flyback", "base.fly_idle"],
	"fly_left": ["base.fly_left", "base.fly_idle"],
	"fly_right": ["base.fly_right", "base.fly_idle"],
	"fly_fast": ["base.fly_fast", "base.fly_front"],
	"elytra": ["spa.elytra", "base.fly_front"],
	# --- combat / ki (DMZ only) ---------------------------------------------
	"attack1": ["base.jab_right", "base.attack1", "spa.sword_attack"],
	"attack2": ["base.jab_left", "base.attack2", "spa.sword_attack2"],
	"attack3": ["base.combo_1", "base.attack1", "spa.sword_attack"],
	"heavy_charge": ["base.charge_heavy_punch"],
	"heavy_fire": ["base.charge_heavy_punch_fire"],
	"light_charge": ["base.charge_light_punch"],
	"light_fire": ["base.charge_light_punch_fire"],
	"block": ["base.block", "spa.shield"],
	"block_sneak": ["spa.shield_sneak", "base.block"],
	"dodge_left": ["base.evasion_left", "base.dodge_left"],
	"dodge_right": ["base.evasion_right", "base.dodge_right"],
	"dodge_back": ["base.evasion_back", "base.dodge_back"],
	"dash": ["base.dash_front"],
	"dash_back": ["base.dash_back"],
	"ki_charge": ["base.ki_charge"],
	"ki_blast": ["ki.blast_fire", "ki.kiblast", "base.attack1"],
	"ki_cast": ["ki.blast_cast", "base.ki_charge"],
	"technique": ["ki.kamehameha_fire", "ki.blast_fire", "base.ki_charge"],
	"technique_charge": ["ki.kamehameha_cast", "ki.blast_cast", "base.ki_charge"],
	"transform": ["base.transformation", "transf.transformation"],
	"powerup": ["base.ki_charge", "base.flex"],
	"hurt": ["base.faint_horizontal", "base.block"],
	"death": ["base.faint_vertical", "base.faint_horizontal"],
	# --- interactions -------------------------------------------------------
	"mine": ["base.mining1", "spa.pickaxe"],
	"mine_alt": ["base.mining2", "spa.pickaxe"],
	"mine_sneak": ["spa.pickaxe_sneak", "base.mining1"],
	"axe": ["spa.axe", "base.mining1"],
	"axe_sneak": ["spa.axe_sneak", "base.mining1"],
	"shovel": ["spa.shovel", "base.mining1"],
	"shovel_sneak": ["spa.shovel_sneak", "base.mining1"],
	"eat": ["base.eat", "spa.eating"],
	"eat_sneak": ["spa.eating_left_sneak", "base.eat"],
	"bow": ["spa.bow_idle"],
	"bow_sneak": ["spa.bow_sneak", "spa.bow_idle"],
	"trident": ["spa.trident"],
	"sit": ["base.sit", "spa.sleeping"],
	"sleep": ["spa.sleeping", "base.sit"],
	"meditate": ["base.meditation", "base.sit"],
	"flex": ["base.flex"],
	"boat": ["spa.boat1", "base.sit"],
	"minecart": ["spa.minecart_idle", "base.sit"],
	"horse": ["spa.horse_idle", "base.sit"],
	"horse_run": ["spa.horse_running", "spa.horse_idle"],
	"creative_fly": ["spa.idle_creative_flying", "base.fly_idle"],
}

## States whose clip should play once and hand the body back (actions, not loops).
const ONE_SHOT := [
	"jump", "land", "attack1", "attack2", "attack3", "heavy_fire", "light_fire",
	"dodge_left", "dodge_right", "dodge_back", "dash", "dash_back", "ki_blast",
	"technique", "transform", "hurt", "death", "turn_left", "turn_right",
	"eat", "eat_sneak", "mine", "mine_alt", "axe", "shovel",
]

## Actions that only move the upper body, so the legs keep walking.
const UPPER_BODY := [
	"attack1", "attack2", "attack3", "heavy_charge", "heavy_fire", "light_charge",
	"light_fire", "ki_blast", "ki_cast", "technique", "technique_charge", "block",
	"mine", "mine_alt", "axe", "shovel", "eat", "bow", "trident", "flex",
]

## First clip of `state` that `anim` actually knows; "" when it knows none.
static func choose(state: String, anim: BedrockAnimation, prefer_spa := false) -> String:
	if anim == null:
		return ""
	var list: Array = TABLE.get(state, [])
	if list.is_empty():
		return state if anim.has_clip(state) else ""
	if prefer_spa:
		for c in list:
			var s := String(c)
			if s.begins_with("spa.") and anim.has_clip(s):
				return s
	for c in list:
		if anim.has_clip(String(c)):
			return String(c)
	return ""

static func is_one_shot(state: String) -> bool:
	return ONE_SHOT.has(state)

static func is_upper_body(state: String) -> bool:
	return UPPER_BODY.has(state)

static func states() -> Array:
	return TABLE.keys()

## Every clip this table can ask for that the animation player actually has.
static func available(anim: BedrockAnimation) -> PackedStringArray:
	var out := PackedStringArray()
	for state in TABLE.keys():
		var c := choose(String(state), anim)
		if c != "":
			out.append("%s -> %s" % [state, c])
	return out
