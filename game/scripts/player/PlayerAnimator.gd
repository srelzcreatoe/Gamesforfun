class_name PlayerAnimator
extends RefCounted
## Maps the player's movement/combat state onto animation STATES (never raw clip names):
## `scripts/entity/PlayerModel.gd` + `AnimSelect.gd` own the state -> clip table, so the DMZ
## and SPA clip choice stays in one place. This class only decides *which* state the player is
## in and re-triggers the repeating actions (mining).
##
## Locomotion is `PlayerModel.state_for()` plus the three states it cannot know about:
## dead, mining and ki charging.

const MINE_REPEAT := 0.6
const ACTION_HOLD := {
	"attack1": 0.35, "attack2": 0.35, "attack3": 0.45, "ki_blast": 0.4, "ki_cast": 0.5,
	"technique": 0.7, "technique_charge": 0.7, "transform": 1.6, "powerup": 0.6,
	"hurt": 0.4, "death": 3.0, "eat": 1.2, "dash": 0.3, "land": 0.25, "mine": 0.6, "block": 0.3,
}
## Touch button -> action state, for the report and for tests.
const BUTTON_ACTIONS := {
	"attack": ["attack1", "attack2", "attack3"],
	"ki_blast": ["ki_blast"],
	"ki_blast_charged": ["ki_cast", "ki_blast"],
	"ki_charge": ["ki_charge"],
	"fly": ["powerup"],
	"dash": ["dash"],
	"transform": ["transform"],
	"technique": ["technique_charge", "technique"],
}

var player: Node = null
var state := "idle"
var action := ""
var action_left := 0.0
var _mine_t := 0.0

func _init(p: Node = null) -> void:
	player = p

## The dictionary PlayerModel.state_for() consumes.
static func state_dict(p: Node) -> Dictionary:
	if p == null:
		return {}
	var inp: Variant = p.get("input")
	var mv: Vector2 = inp.move if inp != null else Vector2.ZERO
	return {
		"velocity": p.get("velocity"),
		"move": mv,
		"on_ground": bool(p.get("on_ground")),
		"in_water": bool(p.get("in_liquid")),
		"swimming": bool(p.get("is_swimming")),
		"flying": bool(p.get("is_flying")),
		"fly_fast": bool(p.get("fly_fast")),
		"sneaking": bool(p.get("is_crouching")),
		"sprinting": bool(p.get("is_sprinting")),
		"climbing": bool(p.get("on_ladder")),
		"crawling": false,
	}

## Player-specific overrides on top of PlayerModel.state_for().
static func locomotion_state(s: Dictionary) -> String:
	if bool(s.get("dead", false)):
		return "death"
	if bool(s.get("ki_charge", false)) and not bool(s.get("mining", false)):
		return "ki_charge"
	return PlayerModel.state_for(s)

func current_state_dict() -> Dictionary:
	var s := state_dict(player)
	if player == null:
		return s
	var ia: Variant = player.get("interaction")
	var inp: Variant = player.get("input")
	s["dead"] = bool(player.get("dead"))
	s["mining"] = ia != null and bool(ia.get("mining"))
	s["ki_charge"] = inp != null and bool(inp.ki_charge)
	return s

## Play a one-shot action state ("attack" picks the combo step).
func play_action(action_state: String, index := -1) -> String:
	if player == null:
		return ""
	var st := action_state
	if action_state == "attack":
		st = BUTTON_ACTIONS["attack"][posmod(maxi(index, 0), 3)]
	if not player.has_method("play_action"):
		return ""
	if not bool(player.call("play_action", st)):
		return ""
	action = st
	action_left = float(ACTION_HOLD.get(st, 0.4))
	return st

func clear_action() -> void:
	action = ""
	action_left = 0.0
	_mine_t = 0.0

## Called from Player.tick every frame.
func update(delta: float) -> void:
	if player == null:
		return
	if action_left > 0.0:
		action_left = maxf(0.0, action_left - delta)
		if action_left <= 0.0:
			action = ""
	var s := current_state_dict()
	if bool(s.get("dead", false)):
		state = "death"
		return
	# Mining is an upper-body one-shot, so it has to be re-triggered while the hold lasts.
	if bool(s.get("mining", false)):
		_mine_t -= delta
		if _mine_t <= 0.0:
			_mine_t = MINE_REPEAT
			play_action("mine")
	else:
		_mine_t = 0.0
	state = locomotion_state(s)
	if player.has_method("set_locomotion"):
		var v: Vector3 = player.get("velocity")
		player.call("set_locomotion", state, Vector2(v.x, v.z).length())

## "walk -> base.walk" lines for the dev menu / the report.
func report() -> PackedStringArray:
	if player != null and player.has_method("clip_for"):
		var out := PackedStringArray()
		for st in ["idle", "walk", "run", "jump", "fall", "land", "sneak", "sneak_walk",
				"swim_forward", "fly_idle", "fly_forward", "fly_fast", "ki_charge",
				"attack1", "attack2", "attack3", "ki_blast", "ki_cast", "technique",
				"transform", "hurt", "death", "mine", "eat", "dash", "powerup"]:
			out.append("%s -> %s" % [st, String(player.call("clip_for", st))])
		return out
	return PackedStringArray()
