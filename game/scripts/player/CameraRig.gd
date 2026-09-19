class_name CameraRig
extends Node3D
## Third/first person camera for the player (ARCHITECTURE.md §6, CUBIC_WORLD_UI_SPEC.md §2).
## Owns the only Camera3D in the world; the Player feeds it the look delta every frame.

enum Mode { SHOULDER, FIRST, FRONT }

const LOOK_DEG_PER_PX := 0.22
const PITCH_LIMIT := 89.0
const SHOULDER_DIST := 3.4
const SHOULDER_OFFSET := Vector2(0.55, 0.15)   # right, up (camera space)
const NEAR := 0.08
const DIST_SMOOTH := 0.08
const PULL_START := 0.4
const PULL_STEP := 0.25
const PULL_BACKOFF := 0.3

var camera: Camera3D
var mode: int = Mode.SHOULDER
var player: Node3D = null
var eye_height := 1.62
var crouch_eye_height := 1.35

var yaw_deg := 0.0
var pitch_deg := 0.0
var distance := SHOULDER_DIST
var _dist_current := SHOULDER_DIST
var walk_cycle := 0.0
var _shake_strength := 0.0
var _shake_time := 0.0
var _shake_left := 0.0
var _orbit_time := 0.0
var _orbit_total := 0.0
var _orbit_center := Vector3.ZERO
var _orbit_distance := 6.0
var _orbit_from := 6.0
var _orbit_to := 3.0
var _orbit_speed := 0.45
var _orbit_angle := 0.0
var _fov_extra := 0.0

func _ready() -> void:
	camera = Camera3D.new()
	camera.name = "Camera3D"
	camera.near = NEAR
	camera.far = far_distance()
	camera.fov = float(Game.settings.get("fov", 75.0)) if Game != null else 75.0
	add_child(camera)
	camera.make_current()
	mode = int(Game.settings.get("camera_mode", Mode.SHOULDER)) if Game != null else Mode.SHOULDER
	Events.screen_shake.connect(shake)
	if Game != null:
		Events.settings_changed.connect(_apply_settings)

func _apply_settings() -> void:
	if camera == null:
		return
	camera.far = far_distance()

func far_distance() -> float:
	var rd := 5
	if Game != null:
		rd = int(Game.settings.get("render_distance", 5))
	return float(rd) * 16.0 + 32.0

func set_player(p: Node3D) -> void:
	player = p

func sensitivity() -> float:
	if Game == null:
		return 1.0
	return float(Game.settings.get("sens_first", 1.0)) if mode == Mode.FIRST else float(Game.settings.get("sens_third", 0.9))

## Apply a look delta in pixels (touch drag or captured mouse).
func apply_look(delta_px: Vector2) -> void:
	if delta_px == Vector2.ZERO:
		return
	var sens := sensitivity()
	var inv := -1.0 if (Game != null and bool(Game.settings.get("invert_y", false))) else 1.0
	yaw_deg -= delta_px.x * LOOK_DEG_PER_PX * sens
	pitch_deg -= delta_px.y * LOOK_DEG_PER_PX * sens * inv
	yaw_deg = wrapf(yaw_deg, -180.0, 180.0)
	pitch_deg = clampf(pitch_deg, -PITCH_LIMIT, PITCH_LIMIT)

func cycle_mode() -> void:
	set_mode((mode + 1) % 3)

func set_mode(m: int) -> void:
	mode = clampi(m, 0, 2)
	if Game != null:
		Game.settings["camera_mode"] = mode
	Events.camera_mode_changed.emit(mode)

func look_direction() -> Vector3:
	var y := deg_to_rad(yaw_deg)
	var p := deg_to_rad(pitch_deg)
	return Vector3(-sin(y) * cos(p), sin(p), -cos(y) * cos(p)).normalized()

func eye_position() -> Vector3:
	if player == null:
		return global_position
	var h := crouch_eye_height if bool(player.get("is_crouching")) else eye_height
	return player.global_position + Vector3(0.0, h, 0.0)

func shake(strength: float, duration: float) -> void:
	_shake_strength = maxf(_shake_strength, strength)
	_shake_time = maxf(_shake_time, duration)
	_shake_left = _shake_time

## Fly-by used by the transformation cinematics (scripts/fx/TransformationDirector.gd):
## orbit `center` for `duration` seconds while the distance eases from `dist_from` to `dist_to`.
func cinematic_orbit(center: Vector3, duration: float, dist_from := 6.0, dist_to := 3.0) -> void:
	_orbit_center = center
	_orbit_total = maxf(0.01, duration)
	_orbit_time = _orbit_total
	_orbit_from = dist_from
	_orbit_to = dist_to
	_orbit_distance = dist_from
	_orbit_angle = yaw_deg

func cancel_cinematic() -> void:
	_orbit_time = 0.0

func is_cinematic() -> bool:
	return _orbit_time > 0.0

## Extra FOV while flying fast (spec: +8).
func set_fov_extra(extra: float) -> void:
	_fov_extra = extra

func _process(delta: float) -> void:
	if camera == null:
		return
	var base_fov := float(Game.settings.get("fov", 75.0)) if Game != null else 75.0
	camera.fov = lerpf(camera.fov, base_fov + _fov_extra, minf(1.0, delta * 6.0))
	if _orbit_time > 0.0:
		_orbit_time = maxf(0.0, _orbit_time - delta)
		var f := 1.0 - clampf(_orbit_time / _orbit_total, 0.0, 1.0)
		_orbit_distance = lerpf(_orbit_from, _orbit_to, smoothstep(0.0, 1.0, f))
		_orbit_angle += _orbit_speed * 360.0 * delta
		var a := deg_to_rad(_orbit_angle)
		var pos := _orbit_center + Vector3(sin(a), 0.35, cos(a)) * _orbit_distance
		global_position = pos
		camera.position = Vector3.ZERO
		camera.look_at_from_position(pos, _orbit_center, Vector3.UP)
		return
	_update_transform(delta)
	_report_underwater()

func _update_transform(delta: float) -> void:
	var eye := eye_position()
	global_position = eye
	var look := look_direction()
	_ease_lock_on(delta)
	var basis_yaw := deg_to_rad(yaw_deg)
	var right := Vector3(cos(basis_yaw), 0.0, -sin(basis_yaw))
	var target_dist := 0.0
	var offset := Vector3.ZERO
	match mode:
		Mode.SHOULDER:
			target_dist = pull_in(eye, -look, distance)
			offset = right * SHOULDER_OFFSET.x + Vector3.UP * SHOULDER_OFFSET.y
		Mode.FRONT:
			target_dist = pull_in(eye, look, distance)
		_:
			target_dist = 0.0
	_dist_current = lerpf(_dist_current, target_dist, 1.0 - exp(-delta / DIST_SMOOTH))
	var cam_pos := eye
	match mode:
		Mode.SHOULDER:
			cam_pos = eye - look * _dist_current + offset
		Mode.FRONT:
			cam_pos = eye + look * _dist_current
		_:
			cam_pos = eye + _bob(delta)
	camera.global_position = cam_pos
	var dir := look if mode != Mode.FRONT else -look
	var to := cam_pos + dir
	if mode == Mode.SHOULDER:
		to = eye + look * 4.0
	camera.look_at_from_position(cam_pos + _shake_offset(delta), to, Vector3.UP)

## The shaders engineer's post-process pass draws the underwater tint from
## `SkyController.camera_underwater`; feed it the real camera position every frame.
func _sky_controller() -> Node:
	var w: Node = null
	if player != null:
		w = player.get("world")
	if w == null and Game != null:
		w = Game.world
	if w == null:
		return null
	var sk: Variant = w.get("sky")
	if sk is Node and sk != null and "camera_underwater" in sk:
		return sk
	var node := w.get_node_or_null("SkyController")
	if node != null and "camera_underwater" in node:
		return node
	return null

func sky_handles_underwater() -> bool:
	return _sky_controller() != null

func camera_in_liquid() -> bool:
	var w: Node = null
	if player != null:
		w = player.get("world")
	if w == null and Game != null:
		w = Game.world
	if w == null or camera == null or not w.has_method("is_liquid"):
		return false
	var p := camera.global_position
	return bool(w.call("is_liquid", int(floor(p.x)), int(floor(p.y)), int(floor(p.z))))

func _report_underwater() -> void:
	var sk := _sky_controller()
	if sk == null:
		return
	var wet := camera_in_liquid()
	if bool(sk.get("camera_underwater")) != wet:
		sk.set("camera_underwater", wet)

func _bob(delta: float) -> Vector3:
	if Game != null and not bool(Game.settings.get("view_bobbing", true)):
		return Vector3.ZERO
	if player == null:
		return Vector3.ZERO
	var v: Vector3 = player.get("velocity")
	var speed := Vector2(v.x, v.z).length()
	if bool(player.get("on_ground")) and speed > 0.1:
		walk_cycle += delta * speed * 1.6
	var basis_yaw := deg_to_rad(yaw_deg)
	var right := Vector3(cos(basis_yaw), 0.0, -sin(basis_yaw))
	return Vector3.UP * (sin(walk_cycle * 6.0) * 0.045) + right * (cos(walk_cycle * 3.0) * 0.025)

func _shake_offset(delta: float) -> Vector3:
	if _shake_left <= 0.0:
		return Vector3.ZERO
	_shake_left = maxf(0.0, _shake_left - delta)
	var k := (_shake_left / maxf(0.001, _shake_time)) * _shake_strength
	if _shake_left <= 0.0:
		_shake_strength = 0.0
	return Vector3(randf_range(-k, k), randf_range(-k, k), randf_range(-k, k)) * 0.1

func _ease_lock_on(delta: float) -> void:
	if player == null:
		return
	var t: Variant = player.get("target")
	if t == null or not (t is Node3D) or not is_instance_valid(t):
		return
	var tp: Vector3 = (t as Node3D).global_position + Vector3(0, 0.9, 0)
	var d := tp - eye_position()
	if d.length() < 0.2:
		return
	var want_yaw := rad_to_deg(atan2(-d.x, -d.z))
	var want_pitch := rad_to_deg(asin(clampf(d.normalized().y, -1.0, 1.0)))
	var k := minf(1.0, delta * 6.0)
	yaw_deg = rad_to_deg(lerp_angle(deg_to_rad(yaw_deg), deg_to_rad(want_yaw), k))
	pitch_deg = lerpf(pitch_deg, want_pitch, k)

## Voxel collision pull-in (spec §2): march from 0.4 in 0.25 steps along the camera ray.
func pull_in(origin: Vector3, dir: Vector3, max_dist: float) -> float:
	var world: Node = null
	if player != null:
		world = player.get("world")
	if world == null and Game != null:
		world = Game.world
	if world == null or not world.has_method("is_solid"):
		return max_dist
	var d := PULL_START
	while d <= max_dist:
		var p := origin + dir * d
		if bool(world.call("is_solid", int(floor(p.x)), int(floor(p.y)), int(floor(p.z)))):
			return maxf(d - PULL_BACKOFF, PULL_START)
		d += PULL_STEP
	return max_dist

## Static twin of `pull_in` so the camera maths can be unit tested without a world node.
static func pull_in_distance(is_solid: Callable, origin: Vector3, dir: Vector3, max_dist: float) -> float:
	var d := PULL_START
	while d <= max_dist:
		var p := origin + dir * d
		if bool(is_solid.call(int(floor(p.x)), int(floor(p.y)), int(floor(p.z)))):
			return maxf(d - PULL_BACKOFF, PULL_START)
		d += PULL_STEP
	return max_dist

func aim_origin() -> Vector3:
	return eye_position()

func aim_direction() -> Vector3:
	return look_direction()
