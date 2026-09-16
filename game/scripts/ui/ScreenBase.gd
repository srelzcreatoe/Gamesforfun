class_name ScreenBase
extends Control
## Base class of every UI screen. Handles theme, safe area, relayout on resize and Android BACK.
## Subclasses build their content in `build()` and re-position in `relayout()`.

var screen_name := ""
var args: Dictionary = {}
var modal := true
var s := 1.5
var insets := Vector4.ZERO
var content: Control = null      # built by subclasses; cleared and rebuilt on resize

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP if modal else Control.MOUSE_FILTER_IGNORE
	UiTheme.apply(self)
	_refresh_metrics()
	build()
	relayout()
	get_viewport().size_changed.connect(_on_resized)
	Events.settings_changed.connect(_on_settings)

func _exit_tree() -> void:
	if get_viewport() != null and get_viewport().size_changed.is_connected(_on_resized):
		get_viewport().size_changed.disconnect(_on_resized)

func _refresh_metrics() -> void:
	s = UiUtil.s()
	insets = UiUtil.safe_insets(get_viewport())

func _on_resized() -> void:
	_refresh_metrics()
	UiTheme.apply(self)
	rebuild()

func _on_settings() -> void:
	_refresh_metrics()
	UiTheme.apply(self)
	rebuild()

## Drop and rebuild the whole content tree (cheap: these screens are code-built).
func rebuild() -> void:
	if content != null and is_instance_valid(content):
		content.queue_free()
		content = null
	for c in get_children():
		c.queue_free()
	build()
	relayout()

func build() -> void:
	pass

func relayout() -> void:
	pass

## The rectangle that respects the device safe area.
func safe_rect() -> Rect2:
	return Rect2(insets.x, insets.y, maxf(64.0, size.x - insets.x - insets.z), maxf(64.0, size.y - insets.y - insets.w))

func close_self() -> void:
	if Game != null and Game.ui != null and screen_name != "":
		Game.ui.call("close", screen_name)
	else:
		queue_free()

func _unhandled_input(event: InputEvent) -> void:
	if not modal or not is_visible_in_tree():
		return
	if event is InputEventKey and event.pressed and not event.echo:
		var k: InputEventKey = event
		if k.keycode == KEY_ESCAPE:
			accept_event()
			close_self()

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST and modal and is_visible_in_tree():
		close_self()

## Standard framed page: dirt background + title + body container + Close button.
func page(title_text: String, with_close := true) -> VBoxContainer:
	UiUtil.dirt_background(self, 0.32)
	var root := VBoxContainer.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var r := safe_rect()
	root.position = r.position
	root.size = r.size
	root.add_theme_constant_override("separation", int(8.0 * s))
	add_child(root)
	content = root
	var head := UiUtil.hbox(10.0 * s)
	head.custom_minimum_size.y = 48.0 * s
	var t := UiUtil.label(title_text, UiUtil.font_title(s), UiUtil.TITLE_COLOR)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(t)
	if with_close:
		head.add_child(UiUtil.flat_button("Close", close_self, false, 110.0 * s))
	root.add_child(head)
	var body := VBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", int(6.0 * s))
	root.add_child(body)
	return body
