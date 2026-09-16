class_name HudWidgets
## Small drawing-only Controls used by the touch HUD (CUBIC_WORLD_UI_SPEC.md §1).
## They never handle input: the Hud owns pointer tracking so joystick + look + buttons work at once.

const GLYPH_COLOR := Color(0.75, 0.85, 1.0, 1.0)
const FILL_COLOR := Color(0.10, 0.12, 0.18, 0.85)

## Round action button with a texture or a vector glyph.
class CircleButton extends Control:
	var glyph := ""
	var tex: Texture2D = null
	var down := false
	var latched := false          # toggle buttons (sneak / sprint / fly)
	var opacity := 0.65
	var accent := Color(0.75, 0.85, 1.0, 1.0)
	var label := ""

	func _init(g := "", t: Texture2D = null) -> void:
		glyph = g
		tex = t
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST

	func _draw() -> void:
		var r := size.x * 0.5
		var c := Vector2(r, r)
		var a: float = opacity
		if latched:
			a = 1.0
		if down:
			a = minf(1.0, a + 0.25)
		draw_circle(c, r, Color(HudWidgets.FILL_COLOR.r, HudWidgets.FILL_COLOR.g, HudWidgets.FILL_COLOR.b, HudWidgets.FILL_COLOR.a * a))
		draw_arc(c, r - 1.0, 0.0, TAU, 40, Color(accent.r, accent.g, accent.b, 0.55 * a), maxf(1.0, r * 0.05), false)
		var gc := Color(accent.r, accent.g, accent.b, a)
		if tex != null:
			var pad := r * 0.42
			draw_texture_rect(tex, Rect2(Vector2(pad, pad), size - Vector2(pad, pad) * 2.0), false, gc)
		elif glyph != "":
			HudWidgets.draw_glyph(self, glyph, c, r * 0.55, gc)
		if label != "":
			var f := UiUtil.font()
			var fs := int(maxf(8.0, r * 0.42))
			var w := f.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
			draw_string(f, c + Vector2(-w * 0.5, r * 0.95), label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1, 1, 1, a * 0.9))

## Virtual joystick (spec: size 150*s, deadzone 6 px).
class Joystick extends Control:
	const DEADZONE := 6.0
	var knob := Vector2.ZERO        # -1..1
	var active := false

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func radius() -> float:
		return size.x * 0.5

	func center() -> Vector2:
		return size * 0.5

	## Feed an absolute local point; returns the normalised knob vector.
	func drag_to(local: Vector2) -> Vector2:
		var d := local - center()
		if d.length() < DEADZONE:
			knob = Vector2.ZERO
		else:
			var r := radius()
			knob = (d / r).limit_length(1.0)
		queue_redraw()
		return knob

	func release() -> void:
		knob = Vector2.ZERO
		active = false
		queue_redraw()

	func _draw() -> void:
		var r := radius()
		var c := center()
		draw_circle(c, r, Color(1, 1, 1, 0.14))
		draw_arc(c, r - 1.0, 0.0, TAU, 48, Color(1, 1, 1, 0.35), maxf(1.5, r * 0.03), false)
		var kr := r * (26.0 / 75.0)
		var kc := c + knob * (r - kr)
		draw_circle(kc, kr, Color(1, 1, 1, 0.50))
		draw_arc(kc, kr - 1.0, 0.0, TAU, 32, Color(1, 1, 1, 0.70), maxf(1.5, kr * 0.09), false)

## A row of N sprite icons (hearts / food / armor / bubbles) from icons.png.
class IconRow extends Control:
	var sheet: Texture2D = null
	var factor := 1.0
	var bg_region := Rect2()
	var full_region := Rect2()
	var half_region := Rect2()
	var icon_size := 17.0
	var pitch := 18.0
	var count := 10
	var value := 20.0            # in half units
	var maximum := 20.0
	var right_to_left := false
	var show_bg := true
	var tint := Color.WHITE

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST

	func _draw() -> void:
		if sheet == null:
			return
		var shown := mini(count, int(ceil(maximum * 0.5)))
		for i in shown:
			var idx := (shown - 1 - i) if right_to_left else i
			var x := float(idx) * pitch
			var rect := Rect2(Vector2(x, 0.0), Vector2(icon_size, icon_size))
			if show_bg and bg_region.size.x > 0.0:
				draw_texture_rect_region(sheet, rect, _src(bg_region))
			var v := value - float(i) * 2.0
			if v >= 2.0:
				draw_texture_rect_region(sheet, rect, _src(full_region))
			elif v >= 1.0:
				draw_texture_rect_region(sheet, rect, _src(half_region))

	func _src(r: Rect2) -> Rect2:
		return Rect2(r.position * factor, r.size * factor)

## A sprite bar (xenoversehud.png style): a frame plus a fill clipped horizontally.
class SpriteBar extends Control:
	var sheet: Texture2D = null
	var factor := 1.0
	var frame_region := Rect2()
	var fill_region := Rect2()
	var fill_inset := Vector2(3.0, 2.0)     # where the fill starts inside the frame, in 1x px
	var value := 1.0
	var tint := Color.WHITE
	var fallback_color := Color(0.3, 0.8, 1.0)

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST

	func _draw() -> void:
		var v := clampf(value, 0.0, 1.0)
		if sheet == null or frame_region.size.x <= 0.0:
			draw_rect(Rect2(Vector2.ZERO, size), Color(0, 0, 0, 0.45))
			draw_rect(Rect2(Vector2.ZERO, Vector2(size.x * v, size.y)), fallback_color)
			return
		var k := size / (frame_region.size)
		draw_texture_rect_region(sheet, Rect2(Vector2.ZERO, size), Rect2(frame_region.position * factor, frame_region.size * factor))
		if fill_region.size.x <= 0.0 or v <= 0.0:
			return
		var off := fill_inset * k
		var full := Vector2(fill_region.size.x, fill_region.size.y) * k
		var w := full.x * v
		var src := Rect2(fill_region.position * factor, Vector2(fill_region.size.x * v, fill_region.size.y) * factor)
		draw_texture_rect_region(sheet, Rect2(off, Vector2(w, full.y)), src, tint)

## The 9 slot hotbar from widgets.png with item icons, counts and the selection frame.
class Hotbar extends Control:
	var inventory: Inventory = null
	var selected := 0
	var cell := 78.0
	var scale_px := 1.5

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST

	func slot_rect(i: int) -> Rect2:
		var pad := 4.0 * scale_px
		return Rect2(Vector2(pad + float(i) * cell, pad), Vector2(cell, cell))

	func slot_at(local: Vector2) -> int:
		for i in Inventory.HOTBAR_SIZE:
			if slot_rect(i).has_point(local):
				return i
		return -1

	func _draw() -> void:
		var w := UiUtil.gui_tex("widgets")
		var f := UiUtil.hd_factor(w)
		# panel: the 182x22 hotbar sprite stretched to our bar size
		if w != null:
			draw_texture_rect_region(w, Rect2(Vector2.ZERO, size), Rect2(UiUtil.R_HOTBAR.position * f, UiUtil.R_HOTBAR.size * f))
		for i in Inventory.HOTBAR_SIZE:
			var r := slot_rect(i)
			draw_rect(r.grow(-2.0 * scale_px), Color(0, 0, 0, 0.35))
			var st: ItemStack = inventory.stack_at(i) if inventory != null else null
			if st != null and not st.is_empty():
				var icon := UiUtil.item_icon(st.item)
				if icon != null:
					var pad := r.size.x * 0.14
					draw_texture_rect(icon, Rect2(r.position + Vector2(pad, pad), r.size - Vector2(pad, pad) * 2.0), false)
				if st.count > 1:
					var fnt := UiUtil.font()
					var fs := int(maxf(8.0, cell * 0.30))
					var txt := str(st.count)
					var tw := fnt.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
					var p := r.end - Vector2(tw + 3.0 * scale_px, 3.0 * scale_px)
					draw_string(fnt, p + Vector2(2, 2), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(0, 0, 0, 0.7))
					draw_string(fnt, p, txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color.WHITE)
		if w != null:
			var sr := slot_rect(clampi(selected, 0, 8)).grow(3.0 * scale_px)
			draw_texture_rect_region(w, sr, Rect2(UiUtil.R_HOTBAR_SEL.position * f, UiUtil.R_HOTBAR_SEL.size * f))

## Crosshair + mining ring (spec §1 "Reticle & mining feedback").
class Reticle extends Control:
	var scale_px := 1.5
	var progress := 0.0
	var show_crosshair := true

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		var c := size * 0.5
		if progress > 0.0:
			draw_circle(c, 26.0 * scale_px, Color(0, 0, 0, 0.35))
			var r := 24.0 * scale_px
			var start := -PI * 0.5
			var pts := PackedVector2Array()
			pts.append(c)
			var steps := maxi(3, int(48.0 * progress))
			for i in steps + 1:
				var a := start + TAU * progress * (float(i) / float(steps))
				pts.append(c + Vector2(cos(a), sin(a)) * r)
			draw_colored_polygon(pts, Color(0.95, 0.90, 0.50, 0.9))
		elif show_crosshair:
			draw_circle(c, 3.0 * scale_px, Color(1, 1, 1, 0.55))

## Health bar of the locked/targeted entity.
class TargetBar extends Control:
	var title := ""
	var value := 1.0
	var scale_px := 1.5

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color(0, 0, 0, 0.45))
		draw_rect(Rect2(Vector2(2, 2), Vector2((size.x - 4.0) * clampf(value, 0, 1), size.y - 4.0)), Color(0.85, 0.2, 0.2, 0.9))
		if title != "":
			var f := UiUtil.font()
			var fs := int(maxf(8.0, size.y * 0.8))
			draw_string(f, Vector2(4.0 * scale_px, size.y - size.y * 0.22), title, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1, 1, 1, 0.95))

# --- vector glyphs ---------------------------------------------------------

static func draw_glyph(ci: CanvasItem, kind: String, c: Vector2, r: float, col: Color) -> void:
	var w := maxf(2.0, r * 0.22)
	match kind:
		"jump":
			_chevron(ci, c + Vector2(0, r * 0.3), r, col, w, -1.0)
			ci.draw_line(c + Vector2(0, -r * 0.1), c + Vector2(0, r * 0.8), col, w)
		"sneak":
			_chevron(ci, c + Vector2(0, -r * 0.3), r, col, w, 1.0)
			ci.draw_line(c + Vector2(0, -r * 0.8), c + Vector2(0, r * 0.1), col, w)
		"sprint":
			_chevron_h(ci, c + Vector2(-r * 0.45, 0), r, col, w)
			_chevron_h(ci, c + Vector2(r * 0.35, 0), r, col, w)
		"dash":
			ci.draw_line(c + Vector2(-r, -r * 0.4), c + Vector2(r * 0.6, -r * 0.4), col, w)
			ci.draw_line(c + Vector2(-r, r * 0.1), c + Vector2(r * 0.9, r * 0.1), col, w)
			_chevron_h(ci, c + Vector2(r * 0.3, -r * 0.15), r * 0.8, col, w)
		"attack":
			# impact burst
			var star := PackedVector2Array()
			for i in 8:
				var a4 := -PI * 0.5 + TAU * float(i) / 8.0
				var rad2 := r * 1.05 if i % 2 == 0 else r * 0.38
				star.append(c + Vector2(cos(a4), sin(a4)) * rad2)
			ci.draw_colored_polygon(star, col)
		"ki_blast":
			ci.draw_circle(c, r * 0.45, col)
			for i in 6:
				var a := TAU * float(i) / 6.0
				var d := Vector2(cos(a), sin(a))
				ci.draw_line(c + d * r * 0.65, c + d * r, col, w * 0.7)
		"charge":
			for i in 3:
				ci.draw_arc(c, r * (0.4 + 0.3 * float(i)), -PI * 0.9, PI * 0.25, 20, col, w * 0.7, false)
		"fly":
			ci.draw_line(c + Vector2(0, r * 0.9), c + Vector2(0, -r * 0.9), col, w)
			ci.draw_line(c + Vector2(-r * 0.7, -r * 0.2), c + Vector2(0, -r * 0.9), col, w)
			ci.draw_line(c + Vector2(r * 0.7, -r * 0.2), c + Vector2(0, -r * 0.9), col, w)
		"transform":
			var pts := PackedVector2Array()
			for i in 10:
				var a := -PI * 0.5 + TAU * float(i) / 10.0
				var rad := r if i % 2 == 0 else r * 0.45
				pts.append(c + Vector2(cos(a), sin(a)) * rad)
			ci.draw_polyline(pts + PackedVector2Array([pts[0]]), col, w * 0.8)
		"technique":
			ci.draw_arc(c, r * 0.8, 0.0, TAU, 32, col, w * 0.8, false)
			for i in 8:
				var a2 := TAU * float(i) / 8.0
				var d2 := Vector2(cos(a2), sin(a2))
				ci.draw_line(c + d2 * r * 0.8, c + d2 * r * 1.05, col, w * 0.7)
		"lock_on":
			ci.draw_arc(c, r * 0.75, 0.0, TAU, 32, col, w * 0.7, false)
			ci.draw_circle(c, r * 0.18, col)
			for i in 4:
				var a3 := TAU * float(i) / 4.0
				var d3 := Vector2(cos(a3), sin(a3))
				ci.draw_line(c + d3 * r * 0.75, c + d3 * r * 1.15, col, w * 0.7)
		"pause":
			ci.draw_rect(Rect2(c + Vector2(-r * 0.5, -r * 0.65), Vector2(r * 0.34, r * 1.3)), col)
			ci.draw_rect(Rect2(c + Vector2(r * 0.16, -r * 0.65), Vector2(r * 0.34, r * 1.3)), col)
		"camera":
			ci.draw_arc(c, r * 0.8, 0.0, TAU, 28, col, w * 0.7, false)
			ci.draw_circle(c, r * 0.32, col)
		"quests":
			ci.draw_rect(Rect2(c - Vector2(r * 0.75, r * 0.85), Vector2(r * 1.5, r * 1.7)), col, false, w * 0.8)
			for i in 3:
				var y := c.y - r * 0.4 + float(i) * r * 0.45
				ci.draw_line(Vector2(c.x - r * 0.45, y), Vector2(c.x + r * 0.45, y), col, w * 0.6)
		"stats":
			for i in 3:
				var h := r * (0.5 + 0.35 * float(i))
				ci.draw_rect(Rect2(Vector2(c.x - r * 0.75 + float(i) * r * 0.55, c.y + r * 0.8 - h), Vector2(r * 0.35, h)), col)
		"bag":
			ci.draw_rect(Rect2(c - Vector2(r * 0.8, r * 0.5), Vector2(r * 1.6, r * 1.2)), col, false, w * 0.8)
			ci.draw_arc(c + Vector2(0, -r * 0.5), r * 0.45, PI, TAU, 16, col, w * 0.8, false)
		_:
			ci.draw_circle(c, r * 0.5, col)

static func _chevron(ci: CanvasItem, c: Vector2, r: float, col: Color, w: float, dir: float) -> void:
	ci.draw_line(c + Vector2(-r * 0.7, 0), c + Vector2(0, dir * r * 0.7), col, w)
	ci.draw_line(c + Vector2(r * 0.7, 0), c + Vector2(0, dir * r * 0.7), col, w)

static func _chevron_h(ci: CanvasItem, c: Vector2, r: float, col: Color, w: float) -> void:
	ci.draw_line(c + Vector2(0, -r * 0.6), c + Vector2(r * 0.5, 0), col, w)
	ci.draw_line(c + Vector2(0, r * 0.6), c + Vector2(r * 0.5, 0), col, w)
