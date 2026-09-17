class_name PlayerAnimator
extends RefCounted
## Maps the player's movement/combat state onto the Bedrock clips of `entity/races/*`.
##
## Two layers, both driven through the entity engineer's API:
##   * base layer  (`Entity.play_anim`)      - locomotion and full-body actions
##   * upper layer (`Entity.play_upper_anim`) - punches / kicks / ki casts while still moving
##
## Clip names are resolved against the loaded animation sets with fallbacks, so a race model
## that ships a smaller set still animates (`base.run` -> `base.walk` -> `base.idle`).

## Locomotion states, in the order `locomotion_clip()` tests them.
const STATE_DEAD := "dead"
const STATE_MINING := "mining"
const STATE_KI_CHARGE := "ki_charge"
const STATE_FLY_FAST := "fly_fast"
const STATE_FLY_MOVE := "fly_move"
const STATE_FLY_IDLE := "fly_idle"
const STATE_SWIM := "swim"
const STATE_JUMP := "jump"
const STATE_FALL := "fall"
const STATE_SNEAK_WALK := "sneak_walk"
const STATE_SNEAK := "sneak"
const STATE_RUN := "run"
const STATE_WALK := "walk"
const STATE_IDLE := "idle"

## state -> candidate clips, best first.
const LOCOMOTION := {
	STATE_DEAD: ["base.faint_vertical", "base.faint_horizontal", "base.idle"],
	STATE_MINING: ["base.mining1", "base.mining2", "base.attack1", "base.idle"],
	STATE_KI_CHARGE: ["base.ki_charge", "base.meditation", "base.idle"],
	STATE_FLY_FAST: ["base.fly_fast", "base.fly_front", "base.fly_idle", "base.run"],
	STATE_FLY_MOVE: ["base.fly_front", "base.fly_idle", "base.run"],
	STATE_FLY_IDLE: ["base.fly_idle", "base.idle"],
	STATE_SWIM: ["base.swimming", "base.crawling_move", "base.walk"],
	STATE_JUMP: ["base.jump", "base.fly_idle", "base.idle"],
	STATE_FALL: ["base.jump", "base.flyback", "base.idle"],
	STATE_SNEAK_WALK: ["base.crouching_walk", "base.crouching", "base.walk"],
	STATE_SNEAK: ["base.crouching", "base.idle"],
	STATE_RUN: ["base.run", "base.walk", "base.idle"],
	STATE_WALK: ["base.walk", "base.idle"],
	STATE_IDLE: ["base.idle"],
}

## One-shot actions. `upper` plays on the upper-body layer so movement keeps going.
const ACTIONS := {
	"attack1": {"clips": ["combat.one_handed_punch_left", "base.jab_left", "base.attack1"], "upper": true, "time": 0.35},
	"attack2": {"clips": ["combat.one_handed_punch_right", "base.jab_right", "base.attack2"], "upper": true, "time": 0.35},
	"attack3": {"clips": ["combat.gutkick_right", "combat.lowkick_right", "base.combo_1"], "upper": false, "time": 0.45},
	"ki_blast": {"clips": ["ki.barrage_fire", "ki.large_ball_fire", "base.charge_light_punch_fire"], "upper": true, "time": 0.4},
	"ki_blast_charged": {"clips": ["ki.large_ball_fire", "ki.bigbang_fire", "ki.barrage_fire"], "upper": false, "time": 0.6},
	"ki_charge_cast": {"clips": ["ki.large_ball_cast", "ki.barrage_cast"], "upper": true, "time": 0.4},
	"technique_cast": {"clips": ["ki.kameha_cast", "ki.barrage_cast"], "upper": false, "time": 0.6},
	"technique_fire": {"clips": ["ki.kameha_fire", "ki.barrage_fire"], "upper": false, "time": 0.6},
	"transform": {"clips": ["transf.generic", "base.transformation"], "upper": false, "time": 1.6},
	"hurt": {"clips": ["base.flyback", "base.block"], "upper": false, "time": 0.4},
	"land": {"clips": ["base.landing"], "upper": false, "time": 0.25},
	"eat": {"clips": ["base.eat"], "upper": true, "time": 1.2},
	"dash": {"clips": ["base.dash_front"], "upper": false, "time": 0.3},
	"death": {"clips": ["base.faint_vertical", "base.faint_horizontal"], "upper": false, "time": 3.0},
}

const RUN_SPEED := 4.6
const MOVE_SPEED := 0.2

var player: Node = null
var state := STATE_IDLE
var action := ""
var action_left := 0.0
var _cache: Dictionary = {}

func _init(p: Node = null) -> void:
	player = p

## Pure state pick - the animation contract in one testable function.
static func locomotion_state(st: Dictionary) -> String:
	if bool(st.get("dead", false)):
		return STATE_DEAD
	if bool(st.get("mining", false)):
		return STATE_MINING
	if bool(st.get("ki_charge", false)):
		return STATE_KI_CHARGE
	if bool(st.get("flying", false)):
		if bool(st.get("fly_fast", false)):
			return STATE_FLY_FAST
		return STATE_FLY_MOVE if float(st.get("speed", 0.0)) > MOVE_SPEED else STATE_FLY_IDLE
	if bool(st.get("swimming", false)):
		return STATE_SWIM
	if not bool(st.get("on_ground", true)) and not bool(st.get("on_ladder", false)):
		return STATE_JUMP if float(st.get("vy", 0.0)) > 0.2 else STATE_FALL
	var moving := float(st.get("speed", 0.0)) > MOVE_SPEED
	if bool(st.get("crouching", false)):
		return STATE_SNEAK_WALK if moving else STATE_SNEAK
	if not moving:
		return STATE_IDLE
	return STATE_RUN if (bool(st.get("sprinting", false)) or float(st.get("speed", 0.0)) > RUN_SPEED) else STATE_WALK

static func clips_for(state_name: String) -> Array:
	return LOCOMOTION.get(state_name, LOCOMOTION[STATE_IDLE])

## First candidate the model actually has (falls back to the last one).
func resolve(candidates: Array) -> String:
	var key := String(candidates[0])
	if _cache.has(key):
		return _cache[key]
	var out := String(candidates[candidates.size() - 1])
	var anim: Variant = player.get("anim") if player != null else null
	if anim != null and anim.has_method("has_clip"):
		for c in candidates:
			if bool(anim.call("has_clip", String(c))):
				out = String(c)
				break
	_cache[key] = out
	return out

func state_of_player() -> Dictionary:
	if player == null:
		return {}
	var ia: Variant = player.get("interaction")
	return {
		"dead": bool(player.get("dead")),
		"mining": ia != null and bool(ia.get("mining")),
		"ki_charge": bool((player.get("input") as PlayerInput).ki_charge) if player.get("input") != null else false,
		"flying": bool(player.get("is_flying")),
		"fly_fast": bool(player.get("fly_fast")),
		"swimming": bool(player.get("is_swimming")),
		"on_ground": bool(player.get("on_ground")),
		"on_ladder": bool(player.get("on_ladder")),
		"crouching": bool(player.get("is_crouching")),
		"sprinting": bool(player.get("is_sprinting")),
		"speed": float(player.call("speed_now")),
		"vy": float((player.get("velocity") as Vector3).y),
	}

## Play a one-shot action; returns the clip that was started ("" when nothing matched).
func play_action(name: String, index := -1) -> String:
	if player == null:
		return ""
	var key := name
	if name == "attack":
		key = "attack%d" % (clampi(index, 0, 2) + 1)
	if not ACTIONS.has(key):
		return ""
	var def: Dictionary = ACTIONS[key]
	var clip := resolve(def["clips"])
	if clip == "":
		return ""
	action = key
	action_left = float(def["time"])
	if bool(def.get("upper", false)) and player.has_method("play_upper_anim"):
		player.call("play_upper_anim", clip, 0.08)
	else:
		player.call("play_anim", clip, 0.08, false)
	return clip

func clear_action() -> void:
	action = ""
	action_left = 0.0

## Called from Player.tick every frame.
func update(delta: float) -> void:
	if player == null:
		return
	if action_left > 0.0:
		action_left = maxf(0.0, action_left - delta)
		if action_left <= 0.0:
			action = ""
	var want := locomotion_state(state_of_player())
	state = want
	# A full-body action owns the base layer until it finishes.
	if action != "" and not bool(ACTIONS[action].get("upper", false)):
		return
	player.call("play_anim", resolve(clips_for(want)), 0.15, true)
