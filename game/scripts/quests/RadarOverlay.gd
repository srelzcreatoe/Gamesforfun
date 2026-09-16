class_name RadarOverlay
extends CanvasLayer
## Dragon radar HUD overlay (DMZ `gui/radar.png`, DMZ+ `gui/dmzplus/super_radar.png`).
## Shown by `DragonBalls.open_radar()` when the UI has no dedicated "radar" screen:
## a round radar face with a blip/arrow toward the nearest unfound ball, the distance
## and the star count found so far.

const PANEL := 120.0
const LIFETIME := 10.0
const EARTH_TEX := "radar"
const SUPER_TEX := "dmzplus/super_radar"

var balls: Node = null
var set_id := "earth"
var ttl := LIFETIME
var view: Control = null

func _init() -> void:
	name = "RadarOverlay"
	layer = 9

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	view = _RadarView.new()
	(view as _RadarView).owner_layer = self
	add_child(view)

func refresh(ball_node: Node, radar_set: String) -> void:
	balls = ball_node
	set_id = radar_set
	ttl = LIFETIME
	if view != null:
		view.queue_redraw()

func readout() -> Dictionary:
	if balls == null or not is_instance_valid(balls) or not balls.has_method("radar_direction"):
		return {"ok": false}
	var p: Node = Game.player if Game != null else null
	var pos: Vector3 = (p as Node3D).global_position if p is Node3D else Vector3.ZERO
	return balls.call("radar_direction", pos, set_id)

func _process(delta: float) -> void:
	ttl -= delta
	if ttl <= 0.0:
		queue_free()
		return
	if view != null:
		view.queue_redraw()

func scale_factor() -> float:
	return Game.ui_scale() if Game != null else 1.0

class _RadarView extends Control:
	var owner_layer: RadarOverlay = null

	func _ready() -> void:
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		if owner_layer == null:
			return
		var s: float = owner_layer.scale_factor()
		var px: float = RadarOverlay.PANEL * s
		var vp := get_viewport_rect().size
		var origin := Vector2(vp.x * 0.5 - px * 0.5, 10.0 * s)
		var rect := Rect2(origin, Vector2(px, px))
		var tex: Texture2D = null
		if Textures != null:
			tex = Textures.gui(RadarOverlay.SUPER_TEX if owner_layer.set_id == "super" else RadarOverlay.EARTH_TEX)
		draw_rect(Rect2(origin - Vector2(3, 3) * s, rect.size + Vector2(6, 6) * s), Color(0.03, 0.05, 0.04, 0.72), true)
		if tex != null:
			draw_texture_rect(tex, rect, false, Color(1, 1, 1, 0.95))
		else:
			draw_circle(rect.get_center(), px * 0.47, Color(0.05, 0.16, 0.08, 0.9))
		var center := rect.get_center()
		draw_arc(center, px * 0.42, 0.0, TAU, 48, Color(0.35, 0.95, 0.45, 0.55), 2.0 * s)
		draw_arc(center, px * 0.21, 0.0, TAU, 32, Color(0.35, 0.95, 0.45, 0.35), 1.5 * s)
		var info: Dictionary = owner_layer.readout()
		var font := ThemeDB.fallback_font
		var fs := int(maxf(10.0, 11.0 * s))
		if not bool(info.get("ok", false)):
			var none := String(info.get("text", "No signal"))
			draw_string(font, center + Vector2(-px * 0.36, px * 0.56), none, HORIZONTAL_ALIGNMENT_LEFT, px * 0.9, fs, Color(0.85, 0.9, 0.85))
			return
		var dir: Vector3 = info.get("dir", Vector3.FORWARD)
		var yaw := _camera_yaw()
		# Rotate the world direction into screen space (screen up = the way the player faces).
		var local := Vector2(dir.x, dir.z).rotated(yaw)
		if local.length() > 0.001:
			local = local.normalized()
		var tip := center + Vector2(local.x, -local.y) * px * 0.36
		var side := Vector2(-local.y, -local.x) * px * 0.07
		draw_colored_polygon(PackedVector2Array([tip, center + side, center - side]), Color(1.0, 0.45, 0.25, 0.95))
		draw_circle(tip, 4.0 * s, Color(1.0, 0.85, 0.3, 1.0))
		var dist := float(info.get("distance", 0.0))
		var star := int(info.get("star", 0))
		var found := int(info.get("found", 0))
		var total := int(info.get("total", 7))
		var line := "%d★  %.0f m" % [star, dist]
		draw_string(font, Vector2(center.x - px * 0.45, origin.y + px + 14.0 * s), line,
			HORIZONTAL_ALIGNMENT_LEFT, px * 0.95, fs + 2, Color(1.0, 0.92, 0.55))
		draw_string(font, Vector2(center.x - px * 0.45, origin.y + px + 28.0 * s), "%d/%d found" % [found, total],
			HORIZONTAL_ALIGNMENT_LEFT, px * 0.95, fs, Color(0.8, 0.9, 0.8))

	func _camera_yaw() -> float:
		var p: Node = Game.player if Game != null else null
		if p == null or not is_instance_valid(p):
			return 0.0
		var rig: Variant = p.get("camera_rig") if "camera_rig" in p else null
		if rig != null and is_instance_valid(rig as Object) and (rig as Object).get("yaw_deg") != null:
			return deg_to_rad(float((rig as Object).get("yaw_deg")))
		if "yaw" in p:
			return float(p.get("yaw"))
		return 0.0
