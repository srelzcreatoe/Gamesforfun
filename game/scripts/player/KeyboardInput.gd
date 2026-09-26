class_name KeyboardInput
extends RefCounted
## Desktop input: WASD + captured mouse + the project.godot action map, written into a PlayerInput.
## Used for development and for the automated screenshot/verification runs.

const ACTIONS := ["jump", "sneak", "sprint", "attack", "use", "ki_charge", "ki_blast", "fly", "dash",
	"lock_on", "transform", "technique"]

var enabled := true
var mouse_captured := false
var _input: PlayerInput = null

func _init(input: PlayerInput) -> void:
	_input = input

## Grab / release the mouse. Called by the Player when a modal UI opens or closes.
func set_capture(on: bool) -> void:
	if Game != null and Game.is_mobile():
		return
	mouse_captured = on
	Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED if on else Input.MOUSE_MODE_VISIBLE)

## Poll the held/edge actions. Call once per frame before the Player reads the input.
func poll() -> void:
	if not enabled or _input == null:
		return
	if Game != null and Game.paused_by_ui:
		return
	var mv := Vector2.ZERO
	if InputMap.has_action("move_right"):
		mv.x = Input.get_axis("move_left", "move_right")
		mv.y = Input.get_axis("move_back", "move_forward")
	if mv.length() > 1.0:
		mv = mv.normalized()
	# Do not fight the touch joystick: keyboard only overrides when actually pressed.
	if mv != Vector2.ZERO or _last_keyboard_move != Vector2.ZERO:
		_input.move = mv
	_last_keyboard_move = mv
	var trust_mouse := _mouse_actions_trusted()
	for a in ACTIONS:
		if not InputMap.has_action(a):
			continue
		var down := Input.is_action_pressed(a) and (trust_mouse or not _is_mouse_action(a))
		if down:
			_kb_held[a] = true
			_input.set_action(a, true)
		elif _kb_held.erase(a) and _input.touch_owner(a) < 0:
			# Only release what this object actually pressed, and never what a finger holds:
			# polling `is_action_pressed` for every action used to zero the touch HUD's held
			# buttons (jump / charge / dash) one frame after they were pressed.
			_input.set_action(a, false)
	for i in 9:
		var key := KEY_1 + i
		if Input.is_physical_key_pressed(key):
			_input.hotbar_select = i

var _last_keyboard_move := Vector2.ZERO
var _mouse_action_cache: Dictionary = {}
var _kb_held: Dictionary = {}

## `attack` and `use` are bound to mouse buttons, and Android's
## `input_devices/pointing/emulate_mouse_from_touch` fabricates a left-button press from *every*
## finger - the joystick, the jump button, a look drag. Polling `Input.is_action_pressed("attack")`
## on a phone therefore held `attack` down for as long as any finger touched the screen, which is
## what made the player mine without being asked to. Mouse-bound actions are only honoured for a
## real captured desktop mouse.
func _is_mouse_action(action: String) -> bool:
	if _mouse_action_cache.has(action):
		return bool(_mouse_action_cache[action])
	var mouse_only := false
	for ev in InputMap.action_get_events(action):
		if ev is InputEventMouseButton:
			mouse_only = true
		else:
			mouse_only = false
			break
	_mouse_action_cache[action] = mouse_only
	return mouse_only

func _mouse_actions_trusted() -> bool:
	if Game != null and Game.is_mobile():
		return false
	if _input != null and (_input.touch_input or _input.touch_count > 0):
		return false
	return mouse_captured

## Mouse look + wheel hotbar + UI hotkeys. Called from Player._unhandled_input.
func handle_event(event: InputEvent) -> bool:
	if not enabled or _input == null:
		return false
	if event is InputEventMouseMotion:
		var mm: InputEventMouseMotion = event
		# `emulate_mouse_from_touch` sends a mouse-motion duplicate of every touch drag, which
		# would turn the camera twice as fast as the finger moved.
		if mouse_captured and not (_input.touch_input or _input.touch_count > 0):
			_input.add_look(mm.relative)
			return true
		return false
	if event is InputEventMouseButton:
		var mb: InputEventMouseButton = event
		if mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			_input.hotbar_select = -2   # previous
			return true
		if mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_input.hotbar_select = -3   # next
			return true
	return false
