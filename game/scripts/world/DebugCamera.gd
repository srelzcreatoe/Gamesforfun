class_name DebugCamera
extends Camera3D
## Free-look camera used when scenes/player/Player.tscn does not exist yet.
## WASD + mouse look (hold/click to capture, Escape releases), Shift = fast, Space/Ctrl = up/down.
## With `--autoplay` it slowly orbits the spawn point so screenshots always show the terrain.

var world: Node = null
var autoplay := false
var speed := 9.0
var look_sensitivity := 0.12
var orbit_radius := 19.0
var orbit_speed := 0.06

var _yaw := 0.0
var _pitch := -0.22
var _anchor := Vector3.ZERO
var _orbit_angle := 0.0
var _captured := false

func _ready() -> void:
	current = true
	fov = float(Game.settings.get("fov", 75.0))
	far = 1024.0
	near = 0.05
	process_mode = Node.PROCESS_MODE_ALWAYS

func place(pos: Vector3) -> void:
	_anchor = pos
	if autoplay:
		_apply_orbit()
	else:
		position = pos
		_yaw = 0.0
		_pitch = -0.2
		_apply_rotation()

func _apply_rotation() -> void:
	rotation = Vector3(_pitch, _yaw, 0.0)

func _apply_orbit() -> void:
	var h := _anchor.y + 7.0
	var p := Vector3(
		_anchor.x + cos(_orbit_angle) * orbit_radius,
		h,
		_anchor.z + sin(_orbit_angle) * orbit_radius)
	position = p
	look_at(_anchor + Vector3(0, 1.0, 0), Vector3.UP)

func _process(delta: float) -> void:
	if autoplay:
		_orbit_angle += delta * orbit_speed
		if world != null and world.has_method("get_height"):
			var h: int = world.get_height(int(floor(_anchor.x)), int(floor(_anchor.z)))
			if h > 1:
				_anchor.y = maxf(_anchor.y, float(h))
		_apply_orbit()
		return
	var dir := Vector3.ZERO
	if Input.is_action_pressed("move_forward"):
		dir -= transform.basis.z
	if Input.is_action_pressed("move_back"):
		dir += transform.basis.z
	if Input.is_action_pressed("move_left"):
		dir -= transform.basis.x
	if Input.is_action_pressed("move_right"):
		dir += transform.basis.x
	if Input.is_action_pressed("jump"):
		dir += Vector3.UP
	if Input.is_action_pressed("sneak"):
		dir += Vector3.DOWN
	var s := speed * (3.0 if Input.is_action_pressed("sprint") else 1.0)
	if dir.length_squared() > 0.0:
		position += dir.normalized() * s * delta

func _input(event: InputEvent) -> void:
	if autoplay:
		return
	if event is InputEventMouseButton and event.pressed and not _captured:
		Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
		_captured = true
	elif event is InputEventKey and event.pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
		_captured = false
	elif event is InputEventMouseMotion and _captured:
		var mm := event as InputEventMouseMotion
		_yaw -= mm.relative.x * look_sensitivity * 0.01
		_pitch = clampf(_pitch - mm.relative.y * look_sensitivity * 0.01, -1.5, 1.5)
		_apply_rotation()
