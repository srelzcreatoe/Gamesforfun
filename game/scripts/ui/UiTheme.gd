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
	var w := UiUtil.gui_tex("widgets")
	var f := UiUtil.hd_factor(w)
	# Button
	t.set_stylebox("normal", "Button", UiUtil.nine(w, UiUtil.R_BUTTON, 3, f, sc))
	t.set_stylebox("hover", "Button", UiUtil.nine(w, UiUtil.R_BUTTON_HOVER, 3, f, sc))
	t.set_stylebox("pressed", "Button", UiUtil.nine(w, UiUtil.R_BUTTON_HOVER, 3, f, sc))
	t.set_stylebox("disabled", "Button", UiUtil.nine(w, UiUtil.R_BUTTON_DISABLED, 3, f, sc))
	t.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	t.set_color("font_color", "Button", Color.WHITE)
	t.set_color("font_hover_color", "Button", Color(1.0, 1.0, 0.63))
	t.set_color("font_pressed_color", "Button", Color(1.0, 1.0, 0.63))
	t.set_color("font_disabled_color", "Button", Color(0.63, 0.63, 0.63))
	t.set_color("font_shadow_color", "Button", Color(0, 0, 0, 0.6))
	t.set_constant("shadow_offset_x", "Button", 2)
	t.set_constant("shadow_offset_y", "Button", 2)
	# Label
	t.set_color("font_color", "Label", Color.WHITE)
	t.set_color("font_shadow_color", "Label", Color(0, 0, 0, 0.6))
	t.set_constant("shadow_offset_x", "Label", 2)
	t.set_constant("shadow_offset_y", "Label", 2)
	# Panel
	t.set_stylebox("panel", "PanelContainer", UiUtil.flat(UiUtil.PANEL_FILL, UiUtil.PANEL_BORDER, 2.0 * sc, 12.0 * sc, 10.0 * sc))
	t.set_stylebox("panel", "Panel", UiUtil.flat(UiUtil.PANEL_FILL, UiUtil.PANEL_BORDER, 2.0 * sc, 12.0 * sc, 10.0 * sc))
	# ScrollContainer / scrollbars (touch friendly: fat grabber)
	var track := UiUtil.flat(Color(0, 0, 0, 0.35), Color(0, 0, 0, 0.35), 0, 0, 0)
	var grab := UiUtil.flat(Color(0.55, 0.72, 0.95, 0.9), Color(0.55, 0.72, 0.95, 0.9), 0, 3.0 * sc, 0)
	t.set_stylebox("scroll", "VScrollBar", track)
	t.set_stylebox("grabber", "VScrollBar", grab)
	t.set_stylebox("grabber_highlight", "VScrollBar", grab)
	t.set_stylebox("grabber_pressed", "VScrollBar", grab)
	t.set_stylebox("panel", "ScrollContainer", StyleBoxEmpty.new())
	# LineEdit
	t.set_stylebox("normal", "LineEdit", UiUtil.flat(Color(0, 0, 0, 0.6), Color(0.6, 0.6, 0.6), 2.0 * sc, 0, 6.0 * sc))
	t.set_stylebox("focus", "LineEdit", UiUtil.flat(Color(0, 0, 0, 0.7), Color.WHITE, 2.0 * sc, 0, 6.0 * sc))
	t.set_color("font_color", "LineEdit", Color.WHITE)
	t.set_color("font_placeholder_color", "LineEdit", Color(0.6, 0.6, 0.6))
	# Tooltip
	t.set_stylebox("panel", "TooltipPanel", UiUtil.flat(Color(0.06, 0.0, 0.06, 0.94), Color(0.31, 0.0, 0.5), 2.0 * sc, 0, 6.0 * sc))
	t.set_color("font_color", "TooltipLabel", Color.WHITE)
	return t
