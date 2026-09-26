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

## state -> candidate clips in priority order.
##
## ORDER MATTERS: the DMZ race pack (`base.*`, `ki.*`, `transf.*`, `skp.*`) first,
## then the DMZ per-entity packs, which name their clips WITHOUT a prefix
## (`walk`, `run1`, `attack1_1`, `ki_blast`, `fly_fast` - see
## assets/animations/entity/{sagas,master,animal,enemies}/*.animation.json), and
## only then Serious Player Animations (`spa.*`).
##
## Getting that order wrong is what made the mobs look broken: every saga model
## has a `right_arm` bone, so `Entity` loads the SPA pack onto it as a fallback,
## and with `spa.*` listed before the bare DMZ names a Saiyan walked with
## `spa.walking` - ONE stride authored over 6.6667 s - instead of its own 1 s
## `walk`, and the dinosaurs walked with a human clip. The bare names also give
## the 165 saga entities the attack / ki / flight clips they actually ship, which
## no `base.*` or `spa.*` name could ever resolve to.
const TABLE := {
	# --- locomotion ---------------------------------------------------------
	"idle": ["base.idle", "idle", "idle2", "spa.idle_standing"],
	"walk": ["base.walk", "walk", "walk2", "spa.walking"],
	"walk_back": ["spa.walking_backwards", "base.walk", "walk"],
	"run": ["base.run", "run", "run1", "run2", "walk", "spa.running"],
	"sprint": ["base.run", "run", "run1", "spa.running"],
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
	"fly": ["base.fly_idle", "base.fly_front", "fly_idle4", "fly", "fly_front"],
	"fly_idle": ["base.fly_idle", "fly_idle4", "fly"],
	"fly_forward": ["base.fly_front", "fly_front", "fly", "fly_fast"],
	"fly_back": ["base.fly_back", "base.flyback", "base.fly_idle", "fly"],
	"fly_left": ["base.fly_left", "base.fly_idle", "fly"],
	"fly_right": ["base.fly_right", "base.fly_idle", "fly"],
	"fly_fast": ["base.fly_fast", "fly_fast4", "fly_fast", "base.fly_front", "fly"],
	"elytra": ["spa.elytra", "base.fly_front", "fly"],
	# --- combat / ki --------------------------------------------------------
	"attack1": ["base.jab_right", "base.attack1", "attack1_1", "attack1", "attack", "punch", "spa.sword_attack"],
	"attack2": ["base.jab_left", "base.attack2", "attack2_1", "attack2", "attack", "spa.sword_attack2"],
	"attack3": ["base.combo_1", "attack3_1", "combo1", "attack3", "attack", "spa.sword_attack"],
	"heavy_charge": ["base.charge_heavy_punch", "combo2"],
	"heavy_fire": ["base.charge_heavy_punch_fire", "combo3"],
	"light_charge": ["base.charge_light_punch"],
	"light_fire": ["base.charge_light_punch_fire"],
	"block": ["base.block", "ki_barrier", "spa.shield"],
	"block_sneak": ["spa.shield_sneak", "base.block"],
	"dodge_left": ["base.evasion_left", "base.dodge_left", "evasion1"],
	"dodge_right": ["base.evasion_right", "base.dodge_right", "evasion1"],
	"dodge_back": ["base.evasion_back", "base.dodge_back", "evasion1"],
	"dash": ["base.dash_front", "evasion1"],
	"dash_back": ["base.dash_back", "evasion1"],
	"ki_charge": ["base.ki_charge", "ki_barrier", "idle2"],
	# no hover-charge clip ships with DMZ yet; falls back to the grounded one
	"ki_charge_air": ["base.ki_charge_fly", "base.ki_charge", "fly_idle4", "fly"],
	"ki_blast": ["ki.blast_fire", "ki.kiblast", "ki_blast", "kiblast", "kiattack", "ki_laser", "base.attack1"],
	"ki_cast": ["ki.blast_cast", "base.ki_charge", "ki_ball"],
	"technique": ["ki.kamehameha_fire", "ki.blast_fire", "ki_kame", "ki_bigbang", "ki_finalflash",
		"ki_galick", "ki_masenko", "ki_makkako", "kiwave", "base.ki_charge"],
	"technique_charge": ["ki.kamehameha_cast", "ki.blast_cast", "base.ki_charge", "ki_ball"],
	"barrage": ["ki_barrage", "base.combo_1", "combo1"],
	"transform": ["base.transformation", "transf.generic", "transformation_1"],
	# form-specific transformations (transf.* ships with the DMZ race pack)
	"transform_ssj": ["transf.ssj", "base.transformation", "transformation_1"],
	"transform_ssj3": ["transf.ssj3", "transf.ssj", "base.transformation", "transformation_2"],
	"transform_god": ["transf.ssg2", "transf.ssj", "base.transformation", "transformation_2"],
	"transform_ozaru": ["transf.ozaru", "base.ozaru_tr", "base.transformation", "transformation_3"],
	"transform_freezer": ["transf.freezer", "transf.freezer2", "base.transformation", "transformation_1"],
	"transform_berserker": ["transf.berserker", "base.transformation", "transformation_1"],
	"transform_janemba": ["transf.janemba", "base.transformation", "transformation_1"],
	"transform_daima": ["transf.daima", "base.transformation", "transformation_1"],
	"transform_absorb": ["transf.absorb", "base.absorb", "cell_absorb", "base.transformation"],
	"powerup": ["base.ki_charge", "base.flex", "idle2"],
	"hurt": ["base.faint_horizontal", "base.block", "evasion1"],
	"death": ["base.faint_vertical", "base.faint_horizontal", "explode"],
	"explode": ["explode", "base.faint_vertical"],
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
	"graze": ["graze", "base.eat"],
	"bow": ["spa.bow_idle"],
	"bow_sneak": ["spa.bow_sneak", "spa.bow_idle"],
	"trident": ["spa.trident"],
	"sit": ["base.sit", "spa.sleeping"],
	"sleep": ["spa.sleeping", "base.sit"],
	"meditate": ["base.meditation", "base.sit", "idle"],
	"flex": ["base.flex", "idle2"],
	"boat": ["spa.boat1", "base.sit"],
	"minecart": ["spa.minecart_idle", "base.sit"],
	"horse": ["spa.horse_idle", "base.sit"],
	"horse_run": ["spa.horse_running", "spa.horse_idle"],
	"creative_fly": ["spa.idle_creative_flying", "base.fly_idle", "fly"],
	# --- named skills (skp.* ships with the DMZ race pack) ------------------
	"skill_dragon_fist": ["skp.dragon_fist", "base.combo_1", "combo1"],
	"skill_wolf_fang": ["skp.wolf_fang", "base.combo_1", "combo2"],
	"skill_meteor": ["skp.meteor", "base.combo_1", "combo3"],
	"skill_kaioken": ["skp.kaioken_attack", "base.combo_1", "combo1"],
	"skill_god_fist": ["skp.super_god_fist", "skp.dragon_fist", "base.combo_1", "combo1"],
	"skill_ozaru_fist": ["skp.oozaru_fist", "base.combo_1", "ki_oozaru"],
	"skill_deadly_dance": ["skp.deadly_dance", "skp.deadly_dance_vegetto", "base.combo_1", "combo6"],
	"grab": ["skp.grab", "grab_ki", "grab_horns", "base.combo_1"],
	"grabbed": ["skp.grabbed", "base.faint_horizontal"],
	"absorb": ["base.absorb", "cell_absorb"],
	"ozaru_idle": ["base.idle_ozaru", "base.idle", "idle"],
	"ozaru_walk": ["base.walk_ozaru", "base.walk", "walk"],
	"fusion_dance": ["base.fusion_dance_left", "base.fusion_dance_right"],
	"fusion_potara": ["base.fusion_pothala_left", "base.fusion_pothala_right"],
	"tail": ["base.tail", "tail"],
	"cape": ["cape"],
}

## States whose clip should play once and hand the body back (actions, not loops).
const ONE_SHOT := [
	"jump", "land", "attack1", "attack2", "attack3", "heavy_fire", "light_fire",
	"dodge_left", "dodge_right", "dodge_back", "dash", "dash_back", "ki_blast",
	"technique", "transform", "hurt", "death", "turn_left", "turn_right",
	"transform_ssj", "transform_ssj3", "transform_god", "transform_ozaru",
	"transform_freezer", "transform_berserker", "transform_janemba",
	"transform_daima", "transform_absorb", "skill_dragon_fist", "skill_wolf_fang",
	"skill_meteor", "skill_kaioken", "skill_god_fist", "skill_ozaru_fist",
	"skill_deadly_dance", "grab", "grabbed", "fusion_dance", "fusion_potara",
	"eat", "eat_sneak", "mine", "mine_alt", "axe", "shovel", "barrage", "explode",
]

## Actions that only move the upper body, so the legs keep walking.
const UPPER_BODY := [
	"attack1", "attack2", "attack3", "heavy_charge", "heavy_fire", "light_charge",
	"light_fire", "ki_blast", "ki_cast", "technique", "technique_charge", "block",
	"mine", "mine_alt", "axe", "shovel", "eat", "bow", "trident", "flex", "barrage",
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


# --- playback rate -------------------------------------------------------------

## Locomotion states that scale their playback with the entity's speed:
## `state -> [reference speed m/s, wall-clock seconds one cycle should take at
## that speed]`. The reference cycle is the DMZ clip's OWN natural cycle, so a
## DMZ clip plays at rate 1.0 at the reference speed exactly like GeckoLib does
## it (`DBSagasAnimationHandler.walkPredicate` sets
## `animationSpeed = movementSpeed / 0.25`).
const LOCO_REF := {
	"walk": [4.2, 1.0], "walk_back": [4.2, 1.0],
	"sneak_walk": [1.6, 1.0], "sneak_walk_back": [1.6, 1.0],
	"crawl_move": [1.6, 1.0], "crawl_back": [1.6, 1.0],
	"run": [5.6, 0.6667], "sprint": [5.6, 0.6667],
	"swim": [2.4, 1.0], "swim_forward": [2.4, 1.0], "swim_back": [2.4, 1.0], "swim_up": [2.4, 1.0],
	"fly_forward": [12.0, 1.0], "fly_fast": [12.0, 1.0],
	"fly_back": [12.0, 1.0], "fly_left": [12.0, 1.0], "fly_right": [12.0, 1.0],
	"climb": [2.0, 1.5],
}
const RATE_MIN := 0.45
const RATE_MAX := 2.2

## Playback rate for a locomotion clip.
##
## `cycle` is `BedrockAnimation.cycle_length(clip)`: the clip's own natural cycle
## in seconds (1.0 for the Molang-driven DMZ clips, which have no keyframes).
## Dividing by the reference cycle is the part that used to be missing: the
## Serious Player Animations walk is one stride authored over 6.6667 s, so at
## rate 1.0 it played at a fifth of walking pace ("slow motion"), and its run is
## 1.875 s against the DMZ 0.6667 s run. Speed scaling is clamped, the clip
## length normalisation is not.
static func locomotion_rate(state: String, cycle: float, speed: float) -> float:
	var ref: Variant = LOCO_REF.get(state)
	if ref == null:
		return 1.0
	var ref_speed: float = float((ref as Array)[0])
	var ref_cycle: float = float((ref as Array)[1])
	var ratio := 1.0
	if speed > 0.0 and ref_speed > 0.0:
		ratio = clampf(speed / ref_speed, RATE_MIN, RATE_MAX)
	var length_scale := 1.0
	if cycle > 0.0 and ref_cycle > 0.0:
		length_scale = cycle / ref_cycle
	return maxf(0.05, ratio * length_scale)

static func scales_with_speed(state: String) -> bool:
	return LOCO_REF.has(state)
