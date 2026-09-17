class_name UiTheme
## Builds the project Theme at runtime (Monocraft font, Minecraft-style buttons, dark panels) sized by
## Game.ui_scale(). Screens call UiTheme.apply(root) in _ready and again from relayout().

static var _theme: Theme = null
static var _built_for: float = -1.0

static func get_theme() -> Theme:
	var sc := UiUtil.s()
	if _theme == null or absf(sc - _built_for) > 0.01:
		_theme = _build(sc)
		_built_for = sc
	return _theme

static func apply(root: Control) -> void:
	root.theme = get_theme()

static func _build(sc: float) -> Theme:
	var t := Theme.new()
	var font := UiUtil.font()
	t.default_font = font
	t.default_font_size = UiUtil.font_body(sc)
	# Button - night-city flat nine-slice (palette sampled from the Night City pack)
	t.set_stylebox("normal", "Button", UiUtil.big_button_style(false))
	t.set_stylebox("hover", "Button", UiUtil.big_button_style(true))
	t.set_stylebox("pressed", "Button", UiUtil.big_button_style(true))
	t.set_stylebox("disabled", "Button", UiUtil.flat(Color(0.12, 0.13, 0.19, 0.8),
		Color(0.32, 0.35, 0.45, 0.8), 2.0 * sc, 6.0 * sc, 6.0 * sc))
	t.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	t.set_color("font_color", "Button", UiUtil.NIGHT_TEXT)
	t.set_color("font_hover_color", "Button", UiUtil.NIGHT_NEON_LIGHT)
	t.set_color("font_pressed_color", "Button", Color.WHITE)
	t.set_color("font_disabled_color", "Button", Color(0.63, 0.63, 0.63))
	t.set_color("font_shadow_color", "Button", Color(0, 0, 0, 0.6))
	t.set_constant("shadow_offset_x", "Button", 2)
	t.set_constant("shadow_offset_y", "Button", 2)
	# CheckBox / CheckButton must not inherit the green Button nine-slice.
	for tp in ["CheckBox", "CheckButton"]:
		for st in ["normal", "hover", "pressed", "disabled", "focus"]:
			t.set_stylebox(st, tp, StyleBoxEmpty.new())
		t.set_color("font_color", tp, Color.WHITE)
		t.set_color("font_hover_color", tp, UiUtil.NIGHT_NEON_LIGHT)
		t.set_color("font_pressed_color", tp, Color.WHITE)
		t.set_color("font_shadow_color", tp, Color(0, 0, 0, 0.6))
		t.set_constant("shadow_offset_x", tp, 2)
		t.set_constant("shadow_offset_y", tp, 2)
		t.set_constant("h_separation", tp, int(8.0 * sc))
	# Label
	t.set_color("font_color", "Label", UiUtil.NIGHT_TEXT)
	t.set_color("font_shadow_color", "Label", Color(0, 0, 0, 0.6))
	t.set_constant("shadow_offset_x", "Label", 2)
	t.set_constant("shadow_offset_y", "Label", 2)
	# Panel
	t.set_stylebox("panel", "PanelContainer", UiUtil.flat(UiUtil.PANEL_FILL, UiUtil.PANEL_BORDER, 3.0 * sc, 8.0 * sc, 10.0 * sc))
	t.set_stylebox("panel", "Panel", UiUtil.flat(UiUtil.PANEL_FILL, UiUtil.PANEL_BORDER, 3.0 * sc, 8.0 * sc, 10.0 * sc))
	t.set_color("font_color", "ProgressBar", UiUtil.NIGHT_TEXT)
	# ScrollContainer / scrollbars (touch friendly: fat grabber)
	var track := UiUtil.flat(Color(0, 0, 0, 0.35), Color(0, 0, 0, 0.35), 0, 0, 0)
	var grab := UiUtil.flat(UiUtil.NIGHT_NEON, UiUtil.NIGHT_NEON_LIGHT, 0, 3.0 * sc, 0)
	t.set_stylebox("scroll", "VScrollBar", track)
	t.set_stylebox("grabber", "VScrollBar", grab)
	t.set_stylebox("grabber_highlight", "VScrollBar", grab)
	t.set_stylebox("grabber_pressed", "VScrollBar", grab)
	t.set_stylebox("panel", "ScrollContainer", StyleBoxEmpty.new())
	# LineEdit
	t.set_stylebox("normal", "LineEdit", UiUtil.flat(Color(0.06, 0.06, 0.11, 0.85), UiUtil.NIGHT_BORDER, 2.0 * sc, 4.0 * sc, 6.0 * sc))
	t.set_stylebox("focus", "LineEdit", UiUtil.flat(Color(0.08, 0.06, 0.13, 0.9), UiUtil.NIGHT_NEON_LIGHT, 2.0 * sc, 4.0 * sc, 6.0 * sc))
	t.set_color("font_color", "LineEdit", UiUtil.NIGHT_TEXT)
	t.set_color("font_placeholder_color", "LineEdit", Color(0.55, 0.58, 0.72))
	t.set_color("caret_color", "LineEdit", UiUtil.NIGHT_NEON_LIGHT)
	t.set_color("selection_color", "LineEdit", Color(UiUtil.NIGHT_NEON.r, UiUtil.NIGHT_NEON.g, UiUtil.NIGHT_NEON.b, 0.5))
	# Tooltip - night-city card
	t.set_stylebox("panel", "TooltipPanel", UiUtil.flat(Color(0.086, 0.078, 0.145, 0.96), UiUtil.NIGHT_NEON, 2.0 * sc, 5.0 * sc, 6.0 * sc))
	t.set_color("font_color", "TooltipLabel", UiUtil.NIGHT_TEXT)
	return t
