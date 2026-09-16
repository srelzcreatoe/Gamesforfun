class_name RadarOverlay
extends CanvasLayer
## Dragon radar HUD overlay (DMZ `gui/radar.png`, DMZ+ `gui/dmzplus/super_radar.png`).
## Shown by `DragonBalls.open_radar()` when the UI has no dedicated "radar" screen:
## the radar dial with a blip per ball still out there, an arrow to the nearest one,
## its distance and the star count found so far.

const PANEL := 116.0                     ## dial size in virtual pixels (x ui_scale)
const LIFETIME := 10.0
const EARTH_TEX := "radar"
const SUPER_TEX := "dmzplus/super_radar"
## The radar face inside radar.png (the rest of the sheet is the blip sprite strip).
const DIAL_REGION := Rect2(4, 30, 112, 112)
const BLIP_REGION := Rect2(120, 0, 18, 6)
const RADAR_RANGE := 900.0               ## distance mapped to the rim of the dial

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

func player_position() -> Vector3:
	var p: Node = Game.player if Game != null else null
	return (p as Node3D).global_position if p is Node3D else Vector3.ZERO

func readout() -> Dictionary:
	if balls == null or not is_instance_valid(balls) or not balls.has_method("radar_direction"):
		return {"ok": false}
	return balls.call("radar_direction", player_position(), set_id)

func blips() -> Array:
	if balls == null or not is_instance_valid(balls) or not balls.has_method("radar_blips"):
		return []
	return balls.call("radar_blips", player_position(), set_id)

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
		var font := ThemeDB.fallback_font
		var fs := int(maxf(10.0, 11.0 * s))
		var pad := 6.0 * s
		var text_h := float(fs) * 2.4
		var vp := get_viewport_rect().size
		var panel := Rect2(Vector2(vp.x * 0.5 - px * 0.5 - pad, 8.0 * s),
			Vector2(px + pad * 2.0, px + text_h + pad * 2.0))
		draw_rect(panel, Color(0.03, 0.05, 0.04, 0.78), true)
		draw_rect(panel, Color(0.35, 0.95, 0.45, 0.45), false, maxf(1.0, 1.5 * s))
		var dial := Rect2(panel.position + Vector2(pad, pad), Vector2(px, px))
		var tex: Texture2D = null
		if Textures != null:
			tex = Textures.gui(RadarOverlay.SUPER_TEX if owner_layer.set_id == "super" else RadarOverlay.EARTH_TEX)
		var center := dial.get_center()
		var radius := px * 0.46
		if tex != null and owner_layer.set_id != "super":
			draw_texture_rect_region(tex, dial, RadarOverlay.DIAL_REGION)
		elif tex != null:
			draw_texture_rect(tex, dial, false)
		else:
			draw_circle(center, radius, Color(0.05, 0.22, 0.08, 0.95))
		draw_arc(center, radius, 0.0, TAU, 48, Color(0.5, 1.0, 0.55, 0.5), maxf(1.0, 1.5 * s))
		draw_arc(center, radius * 0.5, 0.0, TAU, 32, Color(0.5, 1.0, 0.55, 0.3), maxf(1.0, 1.0 * s))
		var yaw := _camera_yaw()
		# blips: every ball still out there, clamped to the rim
		var list: Array = owner_layer.blips()
		for i in list.size():
			var b: Dictionary = list[i]
			var dir: Vector3 = b.get("dir", Vector3.FORWARD)
			var local := Vector2(dir.x, dir.z).rotated(yaw)
			if local.length() > 0.001:
				local = local.normalized()
			var t: float = clampf(float(b.get("distance", 0.0)) / RadarOverlay.RADAR_RANGE, 0.1, 0.94)
			var at := center + Vector2(local.x, -local.y) * radius * t
			var col := Color(1.0, 0.86, 0.25, 0.95) if i == 0 else Color(1.0, 0.7, 0.2, 0.7)
			draw_circle(at, maxf(2.0, 3.2 * s), col)
			if i == 0:
				var side := Vector2(-local.y, -local.x) * 5.0 * s
				draw_colored_polygon(PackedVector2Array([
					center + Vector2(local.x, -local.y) * radius * 0.92, center + side, center - side]),
					Color(1.0, 0.45, 0.2, 0.85))
		var info: Dictionary = owner_layer.readout()
		var line_y := dial.position.y + px + float(fs) * 1.05
		var text_x := panel.position.x + pad
		if not bool(info.get("ok", false)):
			draw_string(font, Vector2(text_x, line_y), String(info.get("text", "No signal")),
				HORIZONTAL_ALIGNMENT_LEFT, panel.size.x - pad * 2.0, fs, Color(0.85, 0.92, 0.85))
			return
		draw_string(font, Vector2(text_x, line_y), "%d★  %.0f m" % [int(info.get("star", 0)), float(info.get("distance", 0.0))],
			HORIZONTAL_ALIGNMENT_LEFT, panel.size.x - pad * 2.0, fs + 1, Color(1.0, 0.92, 0.55))
		draw_string(font, Vector2(text_x, line_y + float(fs) * 1.2),
			"%d/%d found  %s" % [int(info.get("found", 0)), int(info.get("total", 7)),
				DragonBalls.compass(info.get("dir", Vector3.FORWARD))],
			HORIZONTAL_ALIGNMENT_LEFT, panel.size.x - pad * 2.0, fs, Color(0.8, 0.9, 0.8))

	func _camera_yaw() -> float:
		var p: Node = Game.player if Game != null else null
		if p == null or not is_instance_valid(p):
			return 0.0
		if "camera_rig" in p:
			var rig: Variant = p.get("camera_rig")
			if rig != null and is_instance_valid(rig as Object) and (rig as Object).get("yaw_deg") != null:
				return deg_to_rad(float((rig as Object).get("yaw_deg")))
		if "yaw" in p:
			return float(p.get("yaw"))
		return 0.0
