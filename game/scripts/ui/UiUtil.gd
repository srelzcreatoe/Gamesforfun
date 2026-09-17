class_name UiUtil
## Static helpers shared by every UI screen: scale, fonts, sheet regions, nine-slices, widgets.
## All sizes in the UI are expressed as N * s where s = Game.ui_scale() (docs/CUBIC_WORLD_UI_SPEC.md §0).

const GUI := "res://assets/textures/gui/"
const FONT_PATH := "res://assets/fonts/Monocraft.ttf"

# --- palette -------------------------------------------------------------------
## Night City Inventory GUI (Myth6): dark navy panels, lavender borders, neon magenta
## highlights. These are the colours sampled from assets/textures/gui/nightcity/inventory.png,
## so the procedural widgets sit in the same set as the pack's inventory art.
const NIGHT_PANEL := Color(0.133, 0.125, 0.204)        # #222034
const NIGHT_DEEP := Color(0.102, 0.173, 0.322)         # #1A2C52
const NIGHT_BORDER := Color(0.518, 0.608, 0.894)       # #849BE4
const NIGHT_BLUE := Color(0.243, 0.357, 0.580)         # #3E5B94
const NIGHT_PURPLE := Color(0.478, 0.286, 0.447)       # #7A4972
const NIGHT_NEON := Color(0.737, 0.290, 0.608)         # #BC4A9B
const NIGHT_NEON_LIGHT := Color(1.0, 0.560, 0.816)     # neon highlight
const NIGHT_TEXT := Color(0.890, 0.902, 1.0)           # #E3E6FF

const PANEL_FILL := Color(NIGHT_PANEL.r, NIGHT_PANEL.g, NIGHT_PANEL.b, 0.94)
const PANEL_BORDER := NIGHT_BORDER
const PANEL_LIGHT_FILL := Color(0.165, 0.169, 0.271, 0.95)
const PANEL_LIGHT_BORDER := Color(0.384, 0.443, 0.639, 1.0)
const BUTTON_UP := Color(NIGHT_BLUE.r, NIGHT_BLUE.g, NIGHT_BLUE.b, 0.95)
const BUTTON_UP_BORDER := NIGHT_BORDER
const BUTTON_DOWN := NIGHT_NEON
const BUTTON_DOWN_BORDER := NIGHT_NEON_LIGHT
const DANGER := Color(0.451, 0.145, 0.290, 0.95)
const DANGER_BORDER := Color(0.890, 0.400, 0.659, 1.0)
const TITLE_COLOR := NIGHT_TEXT
const DIM_COLOR := Color(0.663, 0.706, 0.847, 1.0)
const ACCENT := NIGHT_NEON_LIGHT
const HUD_BUTTON_FILL := Color(0.098, 0.106, 0.180, 0.85)
const HUD_GLYPH := Color(0.788, 0.824, 1.0, 1.0)

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
# hd/hud/racial_icons.png (and the 256 version): 7 head icons, pitch 17; row 1 = highlighted
const R_RACE_ICON := Rect2(0, 0, 17, 17)
const RACE_ICON_PITCH := 17.0
const RACE_ICON_ORDER := ["human", "saiyan", "namekian", "frostdemon", "majin", "bioandroid"]
# buttons/characterbuttons.png: up / down arrows, pressed row at y + 20
const R_CHAR_ARROW_UP := Rect2(168, 0, 20, 20)
const R_CHAR_ARROW_DOWN := Rect2(188, 0, 20, 20)

static var _font: FontFile = null
static var _tex_cache: Dictionary = {}
static var _white: Texture2D = null

## Settings this subsystem adds. Game.load_settings() only restores keys that exist in
## Game.DEFAULT_SETTINGS, so they are re-read from the settings file here on every boot.
const EXTRA_SETTINGS := {
	"show_coordinates": false,
	"dev_mode": false,
	"hud_scale": 1.0,
	"slot": 0,
}

static func ensure_ui_settings() -> void:
	if Game == null:
		return
	var raw: Variant = JsonUtil.load_file("user://settings.json")
	for k in EXTRA_SETTINGS.keys():
		if Game.settings.has(k):
			continue
		if raw is Dictionary and (raw as Dictionary).has(k):
			Game.settings[k] = (raw as Dictionary)[k]
		else:
			Game.settings[k] = EXTRA_SETTINGS[k]

## Verification flags: `--demo` (throw-away profile), `--dev` (dev mode + coordinates on).
static func apply_cmdline_flags() -> void:
	ensure_ui_settings()
	for a in OS.get_cmdline_user_args():
		if a == "--demo":
			ensure_demo_profile()
		elif a == "--slots":
			_seed_demo_slots()
		elif a == "--dev":
			Game.settings["dev_mode"] = true
			Game.settings["show_coordinates"] = true

## `--slots`: fill two save slots so the slot screen can be screenshotted.
static func _seed_demo_slots() -> void:
	if SaveSlots.is_used(1):
		return
	SaveSlots.create(1, "Kame House", "42", "story", "normal", true)
	var a := ProfileFactory.new_profile("Kakarot", "saiyan", "male", "warrior")
	a["play_time"] = 7830.0
	a["stats"] = {"STR": 24, "SKP": 18, "STM": 20, "RES": 16, "VIT": 26, "PWR": 22, "ENE": 19}
	SaveSlots.write_profile(1, a)
	SaveSlots.create(3, "Namek Run", "7", "creative", "hard", false)
	var b := ProfileFactory.new_profile("Piccolo", "namekian", "male", "defender")
	b["play_time"] = 640.0
	b["position"]["planet"] = "namek"
	SaveSlots.write_profile(3, b)
	var info := SaveSlots.world_info(3)
	info["planet"] = "namek"
	JsonUtil.save_file(Game.world_dir(SaveSlots.slug(3)).path_join("world.json"), info, true)

static func setting(key: String, fallback: Variant = null) -> Variant:
	if Game == null:
		return fallback
	if not Game.settings.has(key):
		return EXTRA_SETTINGS.get(key, fallback)
	return Game.settings[key]

static func s() -> float:
	if Game != null:
		return Game.ui_scale()
	return 1.5

## HUD-only scale: the user can shrink or grow the touch controls without resizing menus.
static func hud_s() -> float:
	return s() * clampf(float(setting("hud_scale", 1.0)), 0.8, 1.4)

static func dev_mode() -> bool:
	return bool(setting("dev_mode", false))

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

## The primary menu button: deep navy with a lavender edge, neon magenta when pressed.
static func big_button_style(active: bool) -> StyleBoxFlat:
	var sc := s()
	var sb := flat(NIGHT_NEON if active else Color(NIGHT_DEEP.r, NIGHT_DEEP.g, NIGHT_DEEP.b, 0.96),
		NIGHT_NEON_LIGHT if active else NIGHT_BORDER, 3.0 * sc, 6.0 * sc, 6.0 * sc)
	sb.shadow_color = Color(NIGHT_NEON.r, NIGHT_NEON.g, NIGHT_NEON.b, 0.35 if active else 0.0)
	sb.shadow_size = int(4.0 * sc) if active else 0
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
	b.add_theme_stylebox_override("normal", big_button_style(false))
	b.add_theme_stylebox_override("hover", big_button_style(true))
	b.add_theme_stylebox_override("pressed", big_button_style(true))
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	b.add_theme_stylebox_override("disabled", flat(Color(0.12, 0.13, 0.19, 0.8),
		Color(0.32, 0.35, 0.45, 0.8), 2.0 * sc, 6.0 * sc, 6.0 * sc))
	b.add_theme_font_override("font", font())
	b.add_theme_font_size_override("font_size", font_body())
	b.add_theme_color_override("font_color", Color.WHITE)
	b.add_theme_color_override("font_hover_color", NIGHT_NEON_LIGHT)
	b.add_theme_color_override("font_pressed_color", Color.WHITE)
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

## DMZ race head icon (gui/hd/hud/racial_icons.png), highlighted row by default.
static func race_icon(race_id: String, selected := true) -> Texture2D:
	var sheet := hud_sheet("racial_icons")
	var f := hd_factor(sheet)
	var i := RACE_ICON_ORDER.find(race_id)
	if i < 0:
		i = 0
	return atlas(sheet, Rect2(float(i) * RACE_ICON_PITCH, RACE_ICON_PITCH if selected else 0.0,
		R_RACE_ICON.size.x, R_RACE_ICON.size.y), f)

## One of the 8 DMZ menu icons (gui/buttons/menubuttons.png).
static func menu_icon(index: int, pressed := false) -> Texture2D:
	var sheet := gui_tex("buttons/menubuttons")
	return atlas(sheet, Rect2(float(index % 8) * 20.0, 20.0 if pressed else 0.0, 20.0, 20.0),
		hd_factor(sheet))

## Big glowing title: offset copies of the text in the accent colour behind a crisp copy.
static func title_glow(text: String, glow := ACCENT, face := Color(1.0, 0.86, 0.35),
		font_size := -1) -> Control:
	var sc := s()
	var fs := font_size if font_size > 0 else font_title(sc)
	var root := Control.new()
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.custom_minimum_size.y = float(fs) * 1.5
	var spread := maxf(2.0, float(fs) * 0.07)
	for o in [Vector2(-1, 0), Vector2(1, 0), Vector2(0, -1), Vector2(0, 1),
			Vector2(-1, -1), Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1)]:
		var halo := label(text, fs, Color(glow.r, glow.g, glow.b, 0.22), HORIZONTAL_ALIGNMENT_CENTER)
		halo.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		halo.position = o * spread
		halo.add_theme_constant_override("shadow_offset_x", 0)
		halo.add_theme_constant_override("shadow_offset_y", 0)
		root.add_child(halo)
	var main := label(text, fs, face, HORIZONTAL_ALIGNMENT_CENTER)
	main.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	main.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.75))
	main.add_theme_constant_override("shadow_offset_x", int(maxf(2.0, sc)))
	main.add_theme_constant_override("shadow_offset_y", int(maxf(2.0, sc)))
	root.add_child(main)
	return root

## A DMZ nine-slice panel (menu/menubig.png and friends) as a container.
static func dmz_panel(kind := "big") -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", dmz_panel_style(kind))
	return p

## The DMZ title bar sprite with a label on it (menu/menubig.png long bar).
static func dmz_bar(text: String, min_w := 0.0) -> Control:
	var sc := s()
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", dmz_panel_style("bar"))
	p.custom_minimum_size = Vector2(min_w, 34.0 * sc)
	var l := label(text, font_body(sc), TITLE_COLOR, HORIZONTAL_ALIGNMENT_CENTER)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	p.add_child(l)
	return p

## Rotating race panorama behind a screen (assets/textures/gui/background/<prefix>_0..5.png).
static func panorama_backdrop(parent: Control, prefix: String, shade := 0.45) -> Control:
	var px := parent.size if parent.size.x > 64.0 else Vector2(1280, 720)
	var cube := PanoramaCube.new(px, prefix)
	cube.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	parent.add_child(cube)
	var shadeing := ColorRect.new()
	shadeing.color = Color(NIGHT_PANEL.r * 0.5, NIGHT_PANEL.g * 0.5, NIGHT_PANEL.b * 0.6, shade)
	shadeing.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shadeing.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(shadeing)
	return cube

## Prev / next arrow from the DMZ character button sheet (rotated for left/right).
static func arrow_button(direction: int, on_pressed: Callable) -> Button:
	var sc := s()
	var b := Button.new()
	b.custom_minimum_size = Vector2(46.0 * sc, 46.0 * sc)
	b.focus_mode = Control.FOCUS_NONE
	b.flat = true
	b.add_theme_stylebox_override("normal", flat(Color(NIGHT_DEEP.r, NIGHT_DEEP.g, NIGHT_DEEP.b, 0.75),
		NIGHT_BORDER, 2.0 * sc, 5.0 * sc, 0.0))
	b.add_theme_stylebox_override("hover", flat(NIGHT_NEON, NIGHT_NEON_LIGHT, 2.0 * sc, 5.0 * sc, 0.0))
	b.add_theme_stylebox_override("pressed", flat(NIGHT_NEON, NIGHT_NEON_LIGHT, 2.0 * sc, 5.0 * sc, 0.0))
	var sheet := gui_tex("buttons/characterbuttons")
	var tr := TextureRect.new()
	tr.texture = atlas(sheet, R_CHAR_ARROW_UP, hd_factor(sheet))
	tr.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tr.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	tr.pivot_offset = Vector2(23.0 * sc, 23.0 * sc)
	tr.rotation_degrees = -90.0 if direction < 0 else 90.0
	b.add_child(tr)
	if on_pressed.is_valid():
		b.pressed.connect(func() -> void:
			click()
			on_pressed.call())
	return b

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

## Fill Game.profile / world_info with a playable demo character (screenshot + preview aid).
static func ensure_demo_profile() -> void:
	if Game == null:
		return
	if Game.world_info.is_empty():
		Game.world_info = {"name": "Preview", "slug": "__preview", "seed": 12345, "mode": "story",
			"difficulty": "normal", "planet": "earth", "transient": true, "keep_inventory": true,
			"version": Game.version, "last_played": int(Time.get_unix_time_from_system())}
	if not Game.profile.is_empty():
		return
	Game.profile = ProfileFactory.new_profile("Kakarot", "saiyan", "male", "warrior")
	Game.profile["tp"] = 4200
	Game.profile["tp_total"] = 9000
	Game.profile["skills"]["fly"] = 3
	Game.profile["skills"]["ki_control"] = 4
	Game.profile["techniques"] = ["ki_blast", "kamehameha", "kienzan", "solar_flare"]
	Game.profile["planets_unlocked"] = ["earth", "namek", "otherworld"]
	var demo := ["stone", "dirt", "oak_planks", "cobblestone", "oak_log", "sand", "glass", "torch", "crafting_table"]
	var counts := [1, 12, 64, 7, 32, 5, 18, 3, 1]
	var slots: Array = Game.profile["inventory"]["slots"]
	var i := 0
	for id in demo:
		if Registry != null and Registry.has_item(id):
			slots[i] = {"item": id, "count": counts[i % counts.size()]}
			i += 1
	for j in range(9, 18):
		var pool := ["iron_ingot", "coal", "senzu_bean", "oak_sapling", "apple", "bread", "diamond", "stick", "gravel"]
		var id2: String = pool[(j - 9) % pool.size()]
		if Registry != null and Registry.has_item(id2):
			slots[j] = {"item": id2, "count": 3 + j}
	var quests: Dictionary = Game.profile["quests"]
	if Registry != null and Registry.quests.has("saga_saiyan:1"):
		var objs: Array = Registry.quest("saga_saiyan:1").get("objectives", [])
		var prog: Array = []
		for _o in objs:
			prog.append(0)
		quests["active"] = {"saga_saiyan:1": {"objectives": prog, "spawned": []}}
		quests["tracked"] = "saga_saiyan:1"

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
	val.custom_minimum_size.x = 190.0 * sc
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
	row.add_child(spacer(0.0, 0.0))
	row.get_child(row.get_child_count() - 1).size_flags_horizontal = Control.SIZE_EXPAND_FILL
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
