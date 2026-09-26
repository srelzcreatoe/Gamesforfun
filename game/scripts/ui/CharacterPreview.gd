class_name CharacterPreview
extends SubViewportContainer
## 3D character preview used by the inventory, stats and character creation screens.
## Uses BedrockModel + RaceSkin when the entity engineer's scripts exist, else a blocky stand-in.
##
## The figure does not spin by itself: the player turns it with a finger (or the mouse). A
## horizontal drag yaws it at DEG_PER_PX degrees per pixel and keeps a little inertia that decays
## after the finger lifts, a vertical drag tilts it within PITCH_LIMIT degrees about the body
## centre, and a tap does nothing. Every drag event is consumed, so dragging over the preview
## never scrolls the options panel behind it. `--ui_spin` turns the old idle spin back on for
## verification renders.

const BEDROCK_MODEL := "res://scripts/entity/BedrockModel.gd"
const RACE_SKIN := "res://scripts/entity/RaceSkin.gd"
var viewport: SubViewport
var pivot: Node3D
var camera: Camera3D = null
var model: Node3D = null
## Degrees of rotation per pixel dragged, and how far the tilt may go.
const DEG_PER_PX := 0.9
const PITCH_LIMIT := 25.0
## Inertia: the throw speed is the last drag scaled by this, and it decays by DECAY per second
## (plus a floor so it stops instead of creeping).
const THROW := 14.0
const DECAY := 4.0
const MIN_SPIN := 2.0
## `_drag_index` value standing for "this gesture came in as a mouse drag".
const MOUSE_DRAG := -2

var spin := 0.5                     # idle spin speed, only used when `auto_spin` is on
var character: Dictionary = {}
var armor: Array = []
## Off by default (the user asked for drag control); `--ui_spin` re-enables it for renders.
var auto_spin: bool = _has_spin_arg()
var yaw_deg := 0.0
var pitch_deg := 0.0
## Node the yaw pivot hangs under, so the tilt turns about the body centre and not the feet.
var tilt: Node3D = null
var _drag_index := -1
var _dragging := false
var _spin_vel := 0.0

func _init(size_px := Vector2(120, 180)) -> void:
	stretch = true
	custom_minimum_size = size_px
	# STOP, not IGNORE: the preview has to receive the drag itself and swallow it so the panel
	# underneath does not scroll at the same time.
	mouse_filter = Control.MOUSE_FILTER_STOP
	viewport = SubViewport.new()
	viewport.transparent_bg = true
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	viewport.own_world_3d = true
	viewport.world_3d = World3D.new()
	add_child(viewport)
	tilt = Node3D.new()
	viewport.add_child(tilt)
	pivot = Node3D.new()
	tilt.add_child(pivot)
	var cam := Camera3D.new()
	# BedrockModel faces -Z, so the camera sits on -Z and is turned around to look at it.
	# The rotation is set here (not only in frame_camera) so the model is visible even if the
	# framing pass has not run yet - that is what made the preview look empty.
	cam.position = Vector3(0, 1.0, -3.4)
	cam.rotation_degrees = Vector3(0, 180, 0)
	cam.fov = 38.0
	cam.near = 0.05
	viewport.add_child(cam)
	var l := DirectionalLight3D.new()
	l.rotation_degrees = Vector3(-35, 35, 0)
	l.light_energy = 1.3
	viewport.add_child(l)
	var l2 := DirectionalLight3D.new()
	l2.rotation_degrees = Vector3(-20, -140, 0)
	l2.light_energy = 0.55
	viewport.add_child(l2)
	camera = cam

func set_character(ch: Dictionary, worn: Array = []) -> void:
	character = ch.duplicate(true)
	armor = worn
	rebuild()

func _ready() -> void:
	resized.connect(_on_resized)
	call_deferred("frame_camera")

func _on_resized() -> void:
	# `stretch` makes the container own viewport.size; writing it here only logs a warning.
	frame_camera()

func rebuild() -> void:
	if model != null and is_instance_valid(model):
		pivot.remove_child(model)
		model.queue_free()
	model = _make_model()
	if model == null:
		model = _box_figure()
	pivot.add_child(model)
	call_deferred("frame_camera")

## Fit the whole figure in view whatever model was built. The distance is found by projecting
## the model's bounding box through the camera and correcting, so it does not depend on which
## axis Godot applies `fov` to for a given viewport aspect.
func frame_camera() -> void:
	if camera == null or model == null or not is_instance_valid(model) or not is_inside_tree():
		return
	var box := AABB()
	var inner: Node = model.get_child(0) if model.get_child_count() > 0 else null
	if inner != null and inner.has_method("visual_aabb"):
		box = inner.call("visual_aabb")
	if box.size.y <= 0.01:
		box = _model_aabb(model)
	if box.size.y <= 0.01 or not is_finite(box.size.y):
		box = AABB(Vector3(-0.4, 0.0, -0.4), Vector3(0.8, 1.9, 0.8))
	# Fit a fixed 3.1 m tall box (feet on the box floor) rather than the exact model height, so the
	# figure keeps the same size as the player cycles hair: the base styles run 2.05 m (bald) to
	# 3.06 m (broly). Transformed hair is taller (flame@ssj2 3.48), so grow past the constant when
	# the measured box needs it instead of cropping the crown.
	var fit_h := maxf(3.1, box.size.y * 1.02)
	box = AABB(Vector3(box.position.x, box.position.y, box.position.z),
		Vector3(maxf(box.size.x, 0.1), fit_h, maxf(box.size.z, 0.1)))
	var center := box.position + box.size * 0.5
	# The tilt has to happen about the middle of the body, not about the feet, so the pivot is
	# offset down by as much as its parent is raised.
	if tilt != null:
		tilt.position.y = center.y
		pivot.position.y = -center.y
	var t := maxf(0.05, tan(deg_to_rad(camera.fov) * 0.5))
	var dist := clampf((fit_h * 0.5) / t * 1.25, 0.6, 24.0)
	var vp_h := size.y if size.y > 8.0 else float(maxi(16, viewport.size.y))
	var want := vp_h * 0.94
	for i in 6:
		_place_camera(center, dist)
		var got := _projected_height(box)
		if got <= 1.0:
			break
		if got > want * 1.02 or got < want * 0.72:
			dist = clampf(dist * (got / want), 0.6, 40.0)
		else:
			break
	_place_camera(center, dist)

func _place_camera(center: Vector3, dist: float) -> void:
	camera.position = Vector3(0.0, center.y, -dist)
	camera.look_at_from_position(camera.position, Vector3(0.0, center.y, 0.0), Vector3.UP)
	if camera.is_inside_tree():
		camera.force_update_transform()

## Screen height of the model's bounding box through the current camera, in viewport pixels.
func _projected_height(box: AABB) -> float:
	var top := Vector3(0.0, box.position.y + box.size.y, 0.0)
	var bottom := Vector3(0.0, box.position.y, 0.0)
	if camera.is_position_behind(top) or camera.is_position_behind(bottom):
		return 0.0
	return absf(camera.unproject_position(top).y - camera.unproject_position(bottom).y)

static func _model_aabb(root: Node) -> AABB:
	var out := AABB()
	var first := true
	for c in root.get_children():
		if c is MeshInstance3D:
			var mi: MeshInstance3D = c
			if mi.mesh == null or not mi.visible:
				continue
			var b: AABB = mi.get_aabb()
			b = mi.transform * b
			out = b if first else out.merge(b)
			first = false
		if c is Node3D:
			var sub := _model_aabb(c)
			if sub.size.length() > 0.0001:
				sub = (c as Node3D).transform * sub
				out = sub if first else out.merge(sub)
				first = false
	return out

func _make_model() -> Node3D:
	if not ResourceLoader.exists(BEDROCK_MODEL) or not ResourceLoader.exists(RACE_SKIN):
		return _box_figure()
	var race := String(character.get("race", "human"))
	# RaceSkin owns the geometry choice (race + gender + body type). It lives in another
	# engineer's folder, so every call is guarded: while that script is mid-edit (or fails to
	# compile) the preview falls back to the blocky stand-in instead of an empty box.
	var skin_script: GDScript = load(RACE_SKIN)
	if skin_script == null or not skin_script.has_method("race_model") \
			or not skin_script.has_method("apply_to"):
		return _box_figure()
	var geo := String(skin_script.call("race_model", race, String(character.get("gender", "male")),
		int(character.get("body_type", 0))))
	var model_script: GDScript = load(BEDROCK_MODEL)
	if model_script == null:
		return _box_figure()
	var m: Node3D = model_script.new()
	if m == null:
		return _box_figure()
	if not m.has_method("load_geo") or not bool(m.call("load_geo", geo)):
		m.queue_free()
		return _box_figure()
	if m.has_method("set_model_scale"):
		m.call("set_model_scale", 1.0)
	var ch := character.duplicate(true)
	if race == "saiyan":
		ch["has_tail"] = bool(ch.get("has_tail", false))
	skin_script.call("apply_to", m, ch, armor)
	var root := Node3D.new()
	root.add_child(m)
	return root

func _box_figure() -> Node3D:
	var root := Node3D.new()
	var skin := UiUtil.color_hex(String(character.get("skin_color", "#FFD3C9")), Color(1.0, 0.83, 0.79))
	var hair := UiUtil.color_hex(String(character.get("hair_color", "#222629")), Color(0.13, 0.15, 0.16))
	var eye := UiUtil.color_hex(String(character.get("eye_color", "#222629")), Color(0.1, 0.1, 0.12))
	var gi := UiUtil.color_hex(String(character.get("aura_color", "#E8721B")), Color(0.85, 0.45, 0.1))
	var parts := [
		[Vector3(0.52, 0.52, 0.52), Vector3(0, 1.56, 0), skin],
		[Vector3(0.56, 0.18, 0.56), Vector3(0, 1.80, 0), hair],
		[Vector3(0.12, 0.08, 0.06), Vector3(-0.12, 1.60, 0.27), eye],
		[Vector3(0.12, 0.08, 0.06), Vector3(0.12, 1.60, 0.27), eye],
		[Vector3(0.52, 0.62, 0.30), Vector3(0, 0.99, 0), gi],
		[Vector3(0.18, 0.62, 0.18), Vector3(-0.35, 0.99, 0), skin],
		[Vector3(0.18, 0.62, 0.18), Vector3(0.35, 0.99, 0), skin],
		[Vector3(0.22, 0.68, 0.22), Vector3(-0.13, 0.34, 0), Color(0.22, 0.30, 0.6)],
		[Vector3(0.22, 0.68, 0.22), Vector3(0.13, 0.34, 0), Color(0.22, 0.30, 0.6)],
	]
	for p in parts:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = p[0]
		mi.mesh = bm
		mi.position = p[1]
		var mat := StandardMaterial3D.new()
		mat.albedo_color = p[2]
		mat.roughness = 1.0
		mi.material_override = mat
		root.add_child(mi)
	return root

func _process(delta: float) -> void:
	if pivot == null:
		return
	if auto_spin and not _dragging:
		yaw_deg = fposmod(yaw_deg + rad_to_deg(delta * spin), 360.0)
	elif not _dragging and absf(_spin_vel) > MIN_SPIN:
		# inertia after a throw: exponential decay, and it stops rather than creeping
		yaw_deg = fposmod(yaw_deg + _spin_vel * delta, 360.0)
		_spin_vel *= exp(-DECAY * delta)
		if absf(_spin_vel) <= MIN_SPIN:
			_spin_vel = 0.0
	_apply_rotation()

## Drag to turn the figure. Every touch/mouse event over the box is consumed so the drag cannot
## scroll the options panel or press anything underneath; a tap (no motion) changes nothing.
func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		var t := event as InputEventScreenTouch
		if t.pressed:
			_begin_drag(t.index)
		elif t.index == _drag_index:
			_end_drag()
		accept_event()
	elif event is InputEventScreenDrag:
		var d := event as InputEventScreenDrag
		if _dragging and d.index == _drag_index:
			_turn(d.relative)
		accept_event()
	elif event is InputEventMouseButton:
		# The project emulates mouse from touch *and* touch from mouse, so a single gesture
		# arrives twice. MOUSE_DRAG marks the mouse path; a real touch always takes precedence
		# and the mouse branch then only consumes its duplicate.
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed and _drag_index < 0:
				_begin_drag(MOUSE_DRAG)
			elif not mb.pressed and _drag_index == MOUSE_DRAG:
				_end_drag()
			accept_event()
	elif event is InputEventMouseMotion:
		var mm := event as InputEventMouseMotion
		if (mm.button_mask & MOUSE_BUTTON_MASK_LEFT) != 0:
			if _dragging and _drag_index == MOUSE_DRAG:
				_turn(mm.relative)
			accept_event()

func _begin_drag(index: int) -> void:
	_drag_index = index
	_dragging = true
	_spin_vel = 0.0

func _end_drag() -> void:
	_dragging = false
	_drag_index = -1

## One drag step: horizontal turns, vertical tilts (clamped), and the horizontal speed is kept
## as the throw for the inertia in _process.
func _turn(relative: Vector2) -> void:
	yaw_deg = fposmod(yaw_deg + relative.x * DEG_PER_PX, 360.0)
	pitch_deg = clampf(pitch_deg - relative.y * DEG_PER_PX, -PITCH_LIMIT, PITCH_LIMIT)
	_spin_vel = relative.x * DEG_PER_PX * THROW
	_apply_rotation()

func _apply_rotation() -> void:
	if pivot != null:
		pivot.rotation_degrees = Vector3(0.0, yaw_deg, 0.0)
	if tilt != null:
		tilt.rotation_degrees = Vector3(pitch_deg, 0.0, 0.0)

## Turn the figure from code (tests, the verification aid, a screen that wants a start angle).
func turn_by(relative: Vector2) -> void:
	_turn(relative)

static func _has_spin_arg() -> bool:
	for a in OS.get_cmdline_user_args():
		if a == "--ui_spin" or a == "--spin":
			return true
	return false
