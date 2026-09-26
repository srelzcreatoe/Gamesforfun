class_name PlayerInput
extends RefCounted
## The only input source the Player reads (ARCHITECTURE.md §6). The touch HUD and KeyboardInput
## both write into the same instance; edge flags are cleared once per frame by `end_frame()`.
##
## Held state that comes from a finger is *owned* by that finger: `set_touch_action()` /
## `set_break_held()` record the `InputEventScreenTouch` index, `release_touch_index()` drops
## everything that index owns, and `prune_stale_touch()` drops everything as soon as the HUD
## reports no finger down at all. Nothing that a finger started can therefore outlive it
## (the "character keeps mining with no touch held" bug).

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

## Rising edges of `jump` seen this frame. Two taps can land inside one frame on a 60 fps
## phone, and the fly double-tap has to see both of them.
var jump_press_count := 0

var hotbar_select: int = -1

## Touch-specific signals the Interaction / Player read (spec §1).
var world_tap := false          # short tap in the look region -> place / use / attack / talk
var break_held := false         # long press in the look region -> mine (or eat)
var gesture_sprint := false     # joystick double-push
var ki_blast_charged := false   # ki blast button released after >= 0.4 s
var toggle_fly := false         # double-tap jump

## How many fingers the touch HUD currently tracks, and whether this session has ever seen a
## real screen touch. `touch_input` makes KeyboardInput ignore the mouse actions that Android's
## `emulate_mouse_from_touch` fabricates from every finger (that is what used to hold `attack`).
var touch_count := 0
var touch_input := false

var _prev := {}
var _touch_owner: Dictionary = {}   # action name -> owning touch index
var _break_owner := -1

## Set a boolean action and derive its edge flag.
func set_action(name: String, down: bool) -> void:
	var was: bool = bool(_prev.get(name, false))
	_prev[name] = down
	match name:
		"jump":
			jump = down
			if down and not was:
				jump_pressed = true
				jump_press_count += 1
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

# --- touch ownership --------------------------------------------------------

## A held HUD button: the action stays down only while touch `index` is down.
func set_touch_action(name: String, down: bool, index := -1) -> void:
	if down:
		_touch_owner[name] = index
	else:
		_touch_owner.erase(name)
	set_action(name, down)

## The look-region long press that mines, owned by touch `index`.
func set_break_held(down: bool, index := -1) -> void:
	break_held = down
	_break_owner = index if down else -1

func break_owner() -> int:
	return _break_owner

func touch_owner(name: String) -> int:
	return int(_touch_owner.get(name, -1))

## Release everything a single finger owns (its `InputEventScreenTouch` release, or that index
## being reused by a new finger).
func release_touch_index(index: int) -> void:
	if _break_owner == index:
		set_break_held(false)
	for name in _touch_owner.keys():
		if int(_touch_owner[name]) == index:
			set_touch_action(name, false)

## Watchdog: no finger is down, so nothing a finger started may still be held.
func prune_stale_touch() -> void:
	if touch_count > 0:
		return
	if break_held and _break_owner >= 0:
		set_break_held(false)
	for name in _touch_owner.keys():
		set_touch_action(name, false)

## Drop every touch-owned hold (HUD hidden, app paused, UI screen opened, focus lost).
func clear_touch_state() -> void:
	touch_count = 0
	set_break_held(false)
	for name in _touch_owner.keys():
		set_touch_action(name, false)
	world_tap = false
	gesture_sprint = false

func add_look(delta: Vector2) -> void:
	look_delta += delta

## Anything that asks the Interaction to break a block / swing.
func wants_break() -> bool:
	return break_held or attack

## Clear per-frame data. Called by Player at the end of its update.
func end_frame() -> void:
	look_delta = Vector2.ZERO
	jump_pressed = false
	jump_press_count = 0
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
	touch_count = 0
	_touch_owner.clear()
	_break_owner = -1

func wants_sprint() -> bool:
	return sprint or gesture_sprint
