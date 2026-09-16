class_name PlayerInput
extends RefCounted
## The only input source the Player reads (ARCHITECTURE.md §6). The touch HUD and KeyboardInput
## both write into the same instance; edge flags are cleared once per frame by `end_frame()`.

var move: Vector2 = Vector2.ZERO          # -1..1 (x = right, y = forward)
var look_delta: Vector2 = Vector2.ZERO    # pixels accumulated this frame

var jump := false
var sneak := false
var sprint := false
var attack := false
var use := false
var ki_charge := false
var ki_blast := false
var fly := false
var dash := false
var lock_on := false

var jump_pressed := false
var attack_pressed := false
var use_pressed := false
var fly_pressed := false
var transform_pressed := false
var technique_pressed := false
var dash_pressed := false
var lock_on_pressed := false

var hotbar_select: int = -1

## Touch-specific signals the Interaction / Player read (spec §1).
var world_tap := false          # short tap in the look region -> place / use / attack / talk
var break_held := false         # long press in the look region -> mine (or eat)
var gesture_sprint := false     # joystick double-push
var ki_blast_charged := false   # ki blast button released after >= 0.4 s
var toggle_fly := false         # double-tap jump

var _prev := {}

## Set a boolean action and derive its edge flag.
func set_action(name: String, down: bool) -> void:
	var was: bool = bool(_prev.get(name, false))
	_prev[name] = down
	match name:
		"jump":
			jump = down
			if down and not was:
				jump_pressed = true
		"sneak": sneak = down
		"sprint": sprint = down
		"attack":
			attack = down
			if down and not was:
				attack_pressed = true
		"use":
			use = down
			if down and not was:
				use_pressed = true
		"ki_charge": ki_charge = down
		"ki_blast": ki_blast = down
		"fly":
			fly = down
			if down and not was:
				fly_pressed = true
		"dash":
			dash = down
			if down and not was:
				dash_pressed = true
		"lock_on":
			lock_on = down
			if down and not was:
				lock_on_pressed = true
		"transform":
			if down and not was:
				transform_pressed = true
		"technique":
			if down and not was:
				technique_pressed = true

func press(name: String) -> void:
	set_action(name, true)

func release(name: String) -> void:
	set_action(name, false)

func add_look(delta: Vector2) -> void:
	look_delta += delta

## Clear per-frame data. Called by Player at the end of its update.
func end_frame() -> void:
	look_delta = Vector2.ZERO
	jump_pressed = false
	attack_pressed = false
	use_pressed = false
	fly_pressed = false
	transform_pressed = false
	technique_pressed = false
	dash_pressed = false
	lock_on_pressed = false
	hotbar_select = -1
	world_tap = false
	ki_blast_charged = false
	toggle_fly = false

## Drop everything (focus left the HUD: bag / pause / death).
func clear_all() -> void:
	move = Vector2.ZERO
	end_frame()
	for k in _prev.keys():
		_prev[k] = false
	jump = false
	sneak = false
	sprint = false
	attack = false
	use = false
	ki_charge = false
	ki_blast = false
	fly = false
	dash = false
	lock_on = false
	break_held = false
	gesture_sprint = false

func wants_sprint() -> bool:
	return sprint or gesture_sprint
