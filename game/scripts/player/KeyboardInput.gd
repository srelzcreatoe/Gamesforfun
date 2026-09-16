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
	for a in ACTIONS:
		if InputMap.has_action(a):
			_input.set_action(a, Input.is_action_pressed(a))
	for i in 9:
		var key := KEY_1 + i
		if Input.is_physical_key_pressed(key):
			_input.hotbar_select = i

var _last_keyboard_move := Vector2.ZERO

## Mouse look + wheel hotbar + UI hotkeys. Called from Player._unhandled_input.
func handle_event(event: InputEvent) -> bool:
	if not enabled or _input == null:
		return false
	if event is InputEventMouseMotion:
		var mm: InputEventMouseMotion = event
		if mouse_captured:
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
