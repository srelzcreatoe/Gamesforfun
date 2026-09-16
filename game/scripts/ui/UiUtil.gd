class_name UiUtil
## Static helpers shared by every UI screen: scale, fonts, sheet regions, nine-slices, widgets.
## All sizes in the UI are expressed as N * s where s = Game.ui_scale() (docs/CUBIC_WORLD_UI_SPEC.md §0).

const GUI := "res://assets/textures/gui/"
const FONT_PATH := "res://assets/fonts/Monocraft.ttf"

# --- palette (spec §0) ---------------------------------------------------------
const PANEL_FILL := Color(0.09, 0.11, 0.16, 0.92)
const PANEL_BORDER := Color(0.30, 0.38, 0.52, 1.0)
const PANEL_LIGHT_FILL := Color(0.16, 0.20, 0.28, 0.95)
const PANEL_LIGHT_BORDER := Color(0.38, 0.48, 0.64, 1.0)
const BUTTON_UP := Color(0.20, 0.30, 0.44, 0.95)
const BUTTON_UP_BORDER := Color(0.45, 0.62, 0.85, 1.0)
const BUTTON_DOWN := Color(0.32, 0.48, 0.66, 1.0)
const BUTTON_DOWN_BORDER := Color(0.60, 0.80, 1.0, 1.0)
const DANGER := Color(0.45, 0.16, 0.14, 0.95)
const DANGER_BORDER := Color(0.85, 0.40, 0.36, 1.0)
const TITLE_COLOR := Color(0.85, 0.95, 1.0, 1.0)
const DIM_COLOR := Color(0.70, 0.75, 0.82, 1.0)
const HUD_BUTTON_FILL := Color(0.10, 0.12, 0.18, 0.85)
const HUD_GLYPH := Color(0.75, 0.85, 1.0, 1.0)

# --- sheet regions (1x coordinates; multiply by the sheet's HD factor) --------
const R_HOTBAR := Rect2(0, 0, 182, 22)
const R_HOTBAR_SEL := Rect2(0, 22, 24, 24)
const R_BUTTON_DISABLED := Rect2(0, 46, 200, 20)
const R_BUTTON := Rect2(0, 66, 200, 20)
const R_BUTTON_HOVER := Rect2(0, 86, 200, 20)
const R_HEART_BG := Rect2(16, 0, 9, 9)
const R_HEART_FULL := Rect2(52, 0, 9, 9)
const R_HEART_HALF := Rect2(61, 0, 9, 9)
const R_ARMOR_EMPTY := Rect2(16, 9, 9, 9)
const R_ARMOR_HALF := Rect2(25, 9, 9, 9)
const R_ARMOR_FULL := Rect2(34, 9, 9, 9)
const R_BUBBLE := Rect2(16, 18, 9, 9)
const R_BUBBLE_POP := Rect2(25, 18, 9, 9)
const R_FOOD_BG := Rect2(16, 27, 9, 9)
const R_FOOD_FULL := Rect2(52, 27, 9, 9)
const R_FOOD_HALF := Rect2(61, 27, 9, 9)
const R_XP_BG := Rect2(0, 64, 182, 5)
const R_XP_FILL := Rect2(0, 69, 182, 5)
const R_INVENTORY_PANEL := Rect2(0, 0, 176, 166)
# xenoversehud.png (1x; the hd/hud version is exactly 4x)
const R_XENO_BAR_FRAME := Rect2(8, 2, 147, 9)
const R_XENO_FILL_GREEN := Rect2(11, 21, 141, 5)
const R_XENO_FILL_ORANGE := Rect2(11, 35, 141, 5)
const R_XENO_FILL_RED := Rect2(11, 48, 141, 5)
const R_XENO_KI_BG := Rect2(8, 65, 118, 8)
const R_XENO_KI_SEG := Rect2(10, 81, 15, 4)       # 8 segments, pitch 14
const R_XENO_STM_BG := Rect2(9, 105, 100, 7)
const R_XENO_STM_FILL := Rect2(24, 121, 83, 5)
const R_XENO_PORTRAIT := Rect2(218, 100, 26, 27)
const R_XENO_AURA := Rect2(184, 10, 57, 26)
# menu/menubig.png
const R_MENUBIG_PANEL := Rect2(0, 0, 141, 213)
const R_MENUBIG_BAR := Rect2(142, 0, 79, 21)
const R_MENUBIG_BAR_WIDE := Rect2(142, 22, 107, 21)
const R_MENUBIG_TAB := Rect2(142, 44, 26, 32)      # 4 tabs, pitch 28
const R_MENUBIG_BAR_LONG := Rect2(0, 215, 149, 21)
const R_MENUSMALL_PANEL := Rect2(0, 0, 141, 94)
const R_MENUSMALL_PANEL2 := Rect2(0, 95, 141, 58)
const R_MENUSMALL_PANEL3 := Rect2(0, 154, 141, 32)
const R_QUESTMENU_PANEL := Rect2(1, 0, 281, 423)
const R_QUESTMENU_TAB := Rect2(290, 44, 26, 32)
const R_MENUNPC_TOP := Rect2(0, 0, 345, 94)
const R_MENUNPC_LEFT := Rect2(2, 95, 169, 178)
const R_MENUNPC_RIGHT := Rect2(174, 95, 169, 178)
const R_MENUBUTTON_ICON := Rect2(0, 0, 20, 20)     # 8 icons, pitch 20; pressed row at y=20
const R_STATROW := Rect2(0, 50, 105, 20)          # 6 rows, pitch 21

static var _font: FontFile = null
static var _tex_cache: Dictionary = {}
static var _white: Texture2D = null

static func s() -> float:
	if Game != null:
		return Game.ui_scale()
	return 1.5

## Body font size: multiples of 8 so Monocraft renders pixel-exact (2x at 720p, 3x at 1080p).
static func font_body(scale := -1.0) -> int:
	var sc := scale if scale > 0.0 else s()
	return 8 * maxi(2, int(round(sc * 1.4)))

static func font_small(scale := -1.0) -> int:
	var sc := scale if scale > 0.0 else s()
	return 8 * maxi(1, int(round(sc * 1.0)))

static func font_title(scale := -1.0) -> int:
	return font_body(scale) * 2

static func font() -> FontFile:
	if _font == null:
		if ResourceLoader.exists(FONT_PATH):
			_font = load(FONT_PATH)
		else:
			_font = FontFile.new()
	return _font

static func white_tex() -> Texture2D:
	if _white == null:
		var img := Image.create(2, 2, false, Image.FORMAT_RGBA8)
		img.fill(Color.WHITE)
		_white = ImageTexture.create_from_image(img)
	return _white

static func gui_tex(name: String) -> Texture2D:
	if Textures != null:
		return Textures.gui(name)
	var p := GUI + name + ".png"
	if _tex_cache.has(p):
		return _tex_cache[p]
	var t: Texture2D = load(p) if ResourceLoader.exists(p) else white_tex()
	_tex_cache[p] = t
	return t

## HD factor of a GUI sheet: 1 for the 256x256 sheets, 4 for the 1024 HD ones.
static func hd_factor(tex: Texture2D, base := 256.0) -> float:
	if tex == null:
		return 1.0
	return maxf(1.0, float(tex.get_width()) / base)

## Prefer the HD variant of a HUD sheet when the pipeline produced one.
static func hud_sheet(name: String) -> Texture2D:
	var hd := GUI + "hd/hud/" + name + ".png"
	if ResourceLoader.exists(hd):
		return gui_tex("hd/hud/" + name)
	return gui_tex("hud/" + name)

static func atlas(tex: Texture2D, region: Rect2, factor := 1.0) -> AtlasTexture:
	var a := AtlasTexture.new()
	a.atlas = tex
	a.region = Rect2(region.position * factor, region.size * factor)
	return a

static func atlas_named(sheet: String, region: Rect2) -> AtlasTexture:
	var t := gui_tex(sheet)
	return atlas(t, region, hd_factor(t))

static func nine(tex: Texture2D, region: Rect2, margin: float, factor := 1.0, scale := 1.0) -> StyleBoxTexture:
	var sb := StyleBoxTexture.new()
	sb.texture = tex
	sb.region_rect = Rect2(region.position * factor, region.size * factor)
	var m := margin * factor
	sb.texture_margin_left = m
	sb.texture_margin_right = m
	sb.texture_margin_top = m
	sb.texture_margin_bottom = m
	sb.axis_stretch_horizontal = StyleBoxTexture.AXIS_STRETCH_MODE_STRETCH
	sb.axis_stretch_vertical = StyleBoxTexture.AXIS_STRETCH_MODE_STRETCH
	sb.draw_center = true
	var pad := m * scale
	sb.content_margin_left = pad
	sb.content_margin_right = pad
	sb.content_margin_top = pad
	sb.content_margin_bottom = pad
	sb.modulate_color = Color.WHITE
	return sb

static func flat(fill: Color, border: Color, border_w := 2.0, radius := 0.0, pad := 8.0) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = fill
	sb.border_color = border
	sb.set_border_width_all(int(border_w))
	sb.set_corner_radius_all(int(radius))
	sb.set_content_margin_all(pad)
	sb.anti_aliasing = false
	return sb

static func label(text: String, size := -1, color := Color.WHITE, align := HORIZONTAL_ALIGNMENT_LEFT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font())
	l.add_theme_font_size_override("font_size", size if size > 0 else font_body())
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	l.add_theme_constant_override("shadow_offset_x", 2)
	l.add_theme_constant_override("shadow_offset_y", 2)
	l.horizontal_alignment = align
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

static func title(text: String, color := TITLE_COLOR) -> Label:
	var l := label(text, font_title(), color, HORIZONTAL_ALIGNMENT_CENTER)
	return l

static func dim(text: String, size := -1) -> Label:
	return label(text, size, DIM_COLOR)

## Minecraft-style text button using widgets.png (normal / hover / disabled rows).
static func button(text: String, on_pressed: Callable = Callable(), min_w := 0.0, min_h := 0.0) -> Button:
	var b := Button.new()
	b.text = text
	var sc := s()
	var w := gui_tex("widgets")
	var f := hd_factor(w)
	b.add_theme_stylebox_override("normal", nine(w, R_BUTTON, 3, f, sc))
	b.add_theme_stylebox_override("hover", nine(w, R_BUTTON_HOVER, 3, f, sc))
	b.add_theme_stylebox_override("pressed", nine(w, R_BUTTON_HOVER, 3, f, sc))
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	b.add_theme_stylebox_override("disabled", nine(w, R_BUTTON_DISABLED, 3, f, sc))
	b.add_theme_font_override("font", font())
	b.add_theme_font_size_override("font_size", font_body())
	b.add_theme_color_override("font_color", Color.WHITE)
	b.add_theme_color_override("font_hover_color", Color(1.0, 1.0, 0.63))
	b.add_theme_color_override("font_pressed_color", Color(1.0, 1.0, 0.63))
	b.add_theme_color_override("font_disabled_color", Color(0.63, 0.63, 0.63))
	b.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	b.add_theme_constant_override("shadow_offset_x", 2)
	b.add_theme_constant_override("shadow_offset_y", 2)
	b.custom_minimum_size = Vector2(min_w if min_w > 0 else 160.0 * sc, min_h if min_h > 0 else 40.0 * sc)
	b.focus_mode = Control.FOCUS_NONE
	if on_pressed.is_valid():
		b.pressed.connect(func() -> void:
			click()
			on_pressed.call())
	return b

## Flat rounded button in the Cubic World palette (used for danger / secondary actions).
static func flat_button(text: String, on_pressed: Callable = Callable(), danger := false, min_w := 0.0) -> Button:
	var b := Button.new()
	b.text = text
	var sc := s()
	var up := flat(DANGER if danger else BUTTON_UP, DANGER_BORDER if danger else BUTTON_UP_BORDER, 2.0 * sc, 9.0 * sc, 6.0 * sc)
	var down := flat(BUTTON_DOWN, BUTTON_DOWN_BORDER, 2.0 * sc, 9.0 * sc, 6.0 * sc)
	b.add_theme_stylebox_override("normal", up)
	b.add_theme_stylebox_override("hover", up)
	b.add_theme_stylebox_override("pressed", down)
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	var dis := flat(Color(0.15, 0.17, 0.22, 0.7), Color(0.3, 0.33, 0.4, 0.7), 2.0 * sc, 9.0 * sc, 6.0 * sc)
	b.add_theme_stylebox_override("disabled", dis)
	b.add_theme_font_override("font", font())
	b.add_theme_font_size_override("font_size", font_body())
	b.add_theme_color_override("font_color", Color.WHITE)
	b.add_theme_color_override("font_disabled_color", Color(0.6, 0.6, 0.65))
	b.custom_minimum_size = Vector2(min_w if min_w > 0 else 120.0 * sc, 36.0 * sc)
	b.focus_mode = Control.FOCUS_NONE
	if on_pressed.is_valid():
		b.pressed.connect(func() -> void:
			click()
			on_pressed.call())
	return b

static func panel(style: StyleBox = null) -> PanelContainer:
	var p := PanelContainer.new()
	var sc := s()
	p.add_theme_stylebox_override("panel", style if style != null else flat(PANEL_FILL, PANEL_BORDER, 2.0 * sc, 12.0 * sc, 10.0 * sc))
	return p

static func panel_light() -> StyleBoxFlat:
	var sc := s()
	return flat(PANEL_LIGHT_FILL, PANEL_LIGHT_BORDER, 2.0 * sc, 9.0 * sc, 5.0 * sc)

## Green DMZ menu panel (menu/menubig.png) as a nine-slice.
static func dmz_panel_style(kind := "big") -> StyleBoxTexture:
	var sc := s()
	match kind:
		"small":
			return nine(gui_tex("menu/menusmall"), R_MENUSMALL_PANEL, 8, 1.0, sc)
		"bar":
			return nine(gui_tex("menu/menubig"), R_MENUBIG_BAR_LONG, 6, 1.0, sc)
		"quest":
			return nine(gui_tex("menu/questmenu"), R_QUESTMENU_PANEL, 10, 1.0, sc)
		"npc_top":
			return nine(gui_tex("menu/menunpc"), R_MENUNPC_TOP, 10, 1.0, sc)
		"npc_side":
			return nine(gui_tex("menu/menunpc"), R_MENUNPC_LEFT, 10, 1.0, sc)
	return nine(gui_tex("menu/menubig"), R_MENUBIG_PANEL, 8, 1.0, sc)

static func icon_rect(tex: Texture2D, size: Vector2) -> TextureRect:
	var tr := TextureRect.new()
	tr.texture = tex
	tr.custom_minimum_size = size
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return tr

static func spacer(h := 0.0, w := 0.0) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(w, h)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c

static func hbox(sep := -1.0) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", int(sep if sep >= 0 else 6.0 * s()))
	return h

static func vbox(sep := -1.0) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", int(sep if sep >= 0 else 6.0 * s()))
	return v

static func click(volume := 0.7) -> void:
	if Audio != null:
		Audio.play_sfx("click", linear_to_db(volume))

static func vibrate(ms: int) -> void:
	if Game != null and bool(Game.settings.get("vibration", true)):
		Input.vibrate_handheld(ms)

## Safe-area insets (notch / rounded corners) in canvas units: left, top, right, bottom.
static func safe_insets(viewport: Viewport) -> Vector4:
	if viewport == null:
		return Vector4.ZERO
	var safe: Rect2i = DisplayServer.get_display_safe_area()
	var win := DisplayServer.window_get_size()
	if win.x <= 0 or win.y <= 0 or safe.size.x <= 0:
		return Vector4.ZERO
	var canvas := viewport.get_visible_rect().size
	var kx := canvas.x / float(win.x)
	var ky := canvas.y / float(win.y)
	var left := float(safe.position.x) * kx
	var top := float(safe.position.y) * ky
	var right := float(win.x - safe.end.x) * kx
	var bottom := float(win.y - safe.end.y) * ky
	return Vector4(maxf(0, left), maxf(0, top), maxf(0, right), maxf(0, bottom))

static func item_icon(item_id: String) -> Texture2D:
	if Textures != null and item_id != "":
		return Textures.item_icon(item_id)
	return white_tex()

static func item_name(item_id: String) -> String:
	if Registry != null:
		var d: Dictionary = Registry.item(item_id)
		if not d.is_empty():
			return String(d.get("name", item_id))
	return item_id.capitalize()

static func color_hex(hex: String, fallback := Color.WHITE) -> Color:
	return JsonUtil.color_from_hex(hex, fallback)

## Scroll container that fills its cell and scrolls vertically (touch drag works out of the box).
static func scroll(child: Control, min_size := Vector2.ZERO) -> ScrollContainer:
	var sc := ScrollContainer.new()
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sc.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	sc.custom_minimum_size = min_size
	sc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	child.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(child)
	return sc

static func set_full_rect(c: Control) -> void:
	c.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE

## Slider row "Label  [=====]  value" bound to a settings key.
static func slider_row(text: String, value: float, minv: float, maxv: float, step: float, on_change: Callable, fmt := "%.2f") -> HBoxContainer:
	var sc := s()
	var row := hbox(8.0 * sc)
	var l := label(text)
	l.custom_minimum_size.x = 150.0 * sc
	row.add_child(l)
	var sl := HSlider.new()
	sl.min_value = minv
	sl.max_value = maxv
	sl.step = step
	sl.value = value
	sl.custom_minimum_size = Vector2(180.0 * sc, 26.0 * sc)
	sl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	sl.focus_mode = Control.FOCUS_NONE
	var track := flat(Color(0.25, 0.28, 0.36), Color(0.25, 0.28, 0.36), 0, 3.0 * sc, 0)
	track.content_margin_top = 3.0 * sc
	track.content_margin_bottom = 3.0 * sc
	sl.add_theme_stylebox_override("slider", track)
	var fill := flat(Color(0.45, 0.62, 0.85), Color(0.45, 0.62, 0.85), 0, 3.0 * sc, 0)
	sl.add_theme_stylebox_override("grabber_area", fill)
	sl.add_theme_stylebox_override("grabber_area_highlight", fill)
	var knob := knob_texture(int(18 * sc), int(26 * sc))
	sl.add_theme_icon_override("grabber", knob)
	sl.add_theme_icon_override("grabber_highlight", knob)
	sl.add_theme_icon_override("grabber_disabled", knob)
	row.add_child(sl)
	var v := label(fmt % value)
	v.custom_minimum_size.x = 64.0 * sc
	v.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(v)
	sl.value_changed.connect(func(x: float) -> void:
		v.text = fmt % x
		on_change.call(x))
	return row

static var _knob_cache: Dictionary = {}
static func knob_texture(w: int, h: int) -> Texture2D:
	var key := "%dx%d" % [w, h]
	if _knob_cache.has(key):
		return _knob_cache[key]
	var img := Image.create(maxi(w, 2), maxi(h, 2), false, Image.FORMAT_RGBA8)
	img.fill(Color(0.55, 0.72, 0.95))
	for x in img.get_width():
		img.set_pixel(x, 0, Color(0.8, 0.9, 1.0))
		img.set_pixel(x, img.get_height() - 1, Color(0.3, 0.4, 0.6))
	var t := ImageTexture.create_from_image(img)
	_knob_cache[key] = t
	return t

static func check_row(text: String, value: bool, on_change: Callable) -> HBoxContainer:
	var sc := s()
	var row := hbox(8.0 * sc)
	var cb := CheckBox.new()
	cb.button_pressed = value
	cb.text = text
	cb.add_theme_font_override("font", font())
	cb.add_theme_font_size_override("font_size", font_body())
	cb.focus_mode = Control.FOCUS_NONE
	var sz := int(24 * sc)
	cb.add_theme_icon_override("checked", box_texture(sz, Color(0.45, 0.75, 0.5)))
	cb.add_theme_icon_override("unchecked", box_texture(sz, Color(0.2, 0.24, 0.32)))
	cb.add_theme_icon_override("checked_disabled", box_texture(sz, Color(0.35, 0.5, 0.4)))
	cb.add_theme_icon_override("unchecked_disabled", box_texture(sz, Color(0.2, 0.22, 0.26)))
	cb.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	cb.toggled.connect(func(v: bool) -> void:
		click()
		on_change.call(v))
	row.add_child(cb)
	return row

static var _box_cache: Dictionary = {}
static func box_texture(size: int, color: Color) -> Texture2D:
	var key := "%d_%s" % [size, color.to_html()]
	if _box_cache.has(key):
		return _box_cache[key]
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	img.fill(color)
	var edge := Color(0.6, 0.7, 0.85)
	for i in size:
		img.set_pixel(i, 0, edge)
		img.set_pixel(i, size - 1, edge)
		img.set_pixel(0, i, edge)
		img.set_pixel(size - 1, i, edge)
	var t := ImageTexture.create_from_image(img)
	_box_cache[key] = t
	return t

## "< value >" option row for enumerated settings.
static func option_row(text: String, options: Array, index: int, on_change: Callable) -> HBoxContainer:
	var sc := s()
	var row := hbox(8.0 * sc)
	var l := label(text)
	l.custom_minimum_size.x = 150.0 * sc
	row.add_child(l)
	var state := {"i": clampi(index, 0, maxi(0, options.size() - 1))}
	var left := flat_button("<", Callable(), false, 40.0 * sc)
	var val := label(String(options[state["i"]]) if options.size() > 0 else "", -1, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
	val.custom_minimum_size.x = 140.0 * sc
	val.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var right := flat_button(">", Callable(), false, 40.0 * sc)
	var step := func(d: int) -> void:
		if options.is_empty():
			return
		state["i"] = posmod(state["i"] + d, options.size())
		val.text = String(options[state["i"]])
		on_change.call(state["i"])
	left.pressed.connect(func() -> void: step.call(-1))
	right.pressed.connect(func() -> void: step.call(1))
	row.add_child(left)
	row.add_child(val)
	row.add_child(right)
	return row

static func line_edit(placeholder: String, text := "", max_len := 0) -> LineEdit:
	var sc := s()
	var le := LineEdit.new()
	le.placeholder_text = placeholder
	le.text = text
	le.max_length = max_len
	le.add_theme_font_override("font", font())
	le.add_theme_font_size_override("font_size", font_body())
	le.add_theme_stylebox_override("normal", flat(Color(0, 0, 0, 0.6), Color(0.6, 0.6, 0.6), 2.0 * sc, 0, 6.0 * sc))
	le.add_theme_stylebox_override("focus", flat(Color(0, 0, 0, 0.7), Color.WHITE, 2.0 * sc, 0, 6.0 * sc))
	le.custom_minimum_size = Vector2(200.0 * sc, 36.0 * sc)
	return le

## Dark tiled Minecraft "options background" (mc/options_background.png) behind menus.
static func dirt_background(parent: Control, dark := 0.35) -> TextureRect:
	var tr := TextureRect.new()
	tr.texture = gui_tex("mc/options_background")
	tr.stretch_mode = TextureRect.STRETCH_TILE
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	tr.modulate = Color(dark, dark, dark, 1.0)
	tr.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	tr.mouse_filter = Control.MOUSE_FILTER_STOP
	parent.add_child(tr)
	# tile at 2x scale like Minecraft (the tile is 16px)
	tr.scale = Vector2.ONE
	return tr

static func dim_background(parent: Control, alpha := 0.55) -> ColorRect:
	var cr := ColorRect.new()
	cr.color = Color(0, 0, 0, alpha)
	cr.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	cr.mouse_filter = Control.MOUSE_FILTER_STOP
	parent.add_child(cr)
	return cr

## Simple confirm dialog built from our own widgets (AcceptDialog would open a native window).
static func confirm(parent: Control, text: String, yes_text: String, on_yes: Callable, danger := true) -> Control:
	var sc := s()
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_STOP
	var shade := ColorRect.new()
	shade.color = Color(0, 0, 0, 0.5)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_child(shade)
	var p := panel()
	var v := vbox(10.0 * sc)
	var l := label(text, -1, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = 320.0 * sc
	v.add_child(l)
	var h := hbox(10.0 * sc)
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_child(flat_button("Cancel", func() -> void: root.queue_free()))
	h.add_child(flat_button(yes_text, func() -> void:
		root.queue_free()
		on_yes.call(), danger))
	v.add_child(h)
	p.add_child(v)
	root.add_child(p)
	parent.add_child(root)
	p.reset_size()
	var ps := p.get_combined_minimum_size()
	p.position = (parent.size - ps) * 0.5
	return root
