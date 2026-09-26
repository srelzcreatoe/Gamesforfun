class_name PlayerModel
extends RefCounted
## One-call animation driver for the player (and any humanoid NPC).
##
## `Player.gd` only has to hand over its physics state once per frame:
##
##     PlayerModel.drive(self, {
##         "velocity": velocity, "on_ground": on_ground, "in_water": in_liquid,
##         "flying": is_flying, "sneaking": input.sneak, "sprinting": input.sprint,
##         "climbing": on_ladder, "crawling": crawling, "swim_forward": swimming,
##         "move": input.move,            # Vector2, y > 0 = forward
##     })
##
## and call `PlayerModel.action(self, "attack1")` (or `entity.play_action(...)`)
## for punches, ki blasts, techniques, transformations, hurt and death. Everything
## else - clip choice, DMZ-before-SPA priority, blending, playback rate - is handled
## by `AnimSelect` + `Entity.set_locomotion()`.
##
## States it can produce, in the order they are tested:
##   fly_fast fly_forward fly_back fly_left fly_right fly_idle
##   swim_up swim_back swim_forward swim_idle
##   climb climb_back climb_sneak climb_idle
##   crawl_move crawl_back crawl
##   sneak_walk sneak_walk_back sneak
##   fall jump run/sprint walk walk_back idle

const FLY_FAST_SPEED := 16.0
const RUN_SPEED := 5.0
const MOVE_EPSILON := 0.12

## Pick the locomotion state for a physics snapshot. Pure, so it is unit testable.
static func state_for(s: Dictionary) -> String:
	var vel: Vector3 = s.get("velocity", Vector3.ZERO)
	var move: Vector2 = s.get("move", Vector2.ZERO)
	var planar := Vector2(vel.x, vel.z).length()
	var forward := move.y >= -0.05
	var moving := planar > MOVE_EPSILON or absf(move.x) > 0.2 or absf(move.y) > 0.2
	if bool(s.get("flying", false)):
		if not moving:
			return "fly_idle"
		if planar > FLY_FAST_SPEED or bool(s.get("fly_fast", false)):
			return "fly_fast"
		if not forward:
			return "fly_back"
		if absf(move.x) > 0.6 and absf(move.x) > absf(move.y):
			return "fly_right" if move.x > 0.0 else "fly_left"
		return "fly_forward"
	if bool(s.get("climbing", false)):
		if not moving:
			return "climb_idle"
		if bool(s.get("sneaking", false)):
			return "climb_sneak"
		return "climb" if forward else "climb_back"
	if bool(s.get("in_water", false)) and bool(s.get("swimming", true)):
		if vel.y > 1.0:
			return "swim_up"
		if not moving:
			return "swim_idle"
		return "swim_forward" if forward else "swim_back"
	if bool(s.get("crawling", false)):
		if not moving:
			return "crawl"
		return "crawl_move" if forward else "crawl_back"
	if not bool(s.get("on_ground", true)):
		return "fall" if vel.y < -0.5 else "jump"
	if bool(s.get("sneaking", false)):
		if not moving:
			return "sneak"
		return "sneak_walk" if forward else "sneak_walk_back"
	if not moving:
		return "idle"
	if not forward:
		return "walk_back"
	if bool(s.get("sprinting", false)) or planar > RUN_SPEED:
		return "run"
	return "walk"

## Pick the state from `s` and play it on `entity`. Returns the state.
static func drive(entity: Node, s: Dictionary) -> String:
	var state := state_for(s)
	if entity != null and entity.has_method("set_locomotion"):
		var vel: Vector3 = s.get("velocity", Vector3.ZERO)
		entity.call("set_locomotion", state, Vector2(vel.x, vel.z).length())
	return state

## One-shot action ("attack1".."attack3", "ki_blast", "technique", "transform",
## "hurt", "death", "mine", "eat", "block", ...). Upper-body actions keep the legs
## on their locomotion clip.
static func action(entity: Node, state: String) -> bool:
	if entity == null or not entity.has_method("play_action"):
		return false
	return bool(entity.call("play_action", state))

## Melee combo helper: cycles attack1 -> attack2 -> attack3.
static func punch(entity: Node, combo_index: int) -> bool:
	return action(entity, ["attack1", "attack2", "attack3"][posmod(combo_index, 3)])

## What the entity can actually play (debug / the stats screen).
static func report(entity: Node) -> PackedStringArray:
	if entity == null or entity.get("anim") == null:
		return PackedStringArray()
	return AnimSelect.available(entity.get("anim"))
