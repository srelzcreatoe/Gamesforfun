class_name ScreenBase
extends Control
## Base class of every UI screen. Handles the theme, the device safe area, rebuilding on resize
## and the Android BACK button. Subclasses build their content in `build()`.
##
## A Control has no size until the container/anchor layout has run once, so `build()` is delayed
## until `size` is valid and re-run when the viewport changes shape.

const MIN_SIZE := 16.0
const REBUILD_EPS := 8.0
const MAX_WAIT_FRAMES := 20

var screen_name := ""
var args: Dictionary = {}
var modal := true
var s := 1.5
var insets := Vector4.ZERO
var content: Control = null

var _built_for := Vector2.ZERO
var _wait_frames := 0

func _ready() -> void:
	_read_cmdline_args()
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP if modal else Control.MOUSE_FILTER_IGNORE
	UiTheme.apply(self)
	resized.connect(_on_self_resized)
	Events.settings_changed.connect(_on_settings)
	_try_build()

## Verification aid: `--demo` fills a throw-away profile and `--ui_<key>=<value>` becomes an
## entry in `args`, so `--args "--scene=res://scenes/ui/Dialog.tscn --demo --ui_master=roshi"`
## renders a populated screen without a world.
func _read_cmdline_args() -> void:
	UiUtil.apply_cmdline_flags()
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--ui_"):
			var kv := a.substr(5).split("=", true, 1)
			if kv.size() == 2 and not args.has(kv[0]):
				args[kv[0]] = kv[1]

func _try_build() -> void:
	if (size.x < MIN_SIZE or size.y < MIN_SIZE) and _wait_frames < MAX_WAIT_FRAMES:
		_wait_frames += 1
		call_deferred("_try_build")
		return
	if size.x < MIN_SIZE or size.y < MIN_SIZE:
		size = get_viewport_rect().size
	_refresh_metrics()
	_built_for = size
	build()
	relayout()

func _refresh_metrics() -> void:
	s = UiUtil.s()
	insets = UiUtil.safe_insets(get_viewport())

func _on_self_resized() -> void:
	if _built_for == Vector2.ZERO:
		return
	if (size - _built_for).length() > REBUILD_EPS:
		rebuild()

func _on_settings() -> void:
	UiTheme.apply(self)
	rebuild()

## Drop and rebuild the whole content tree (cheap: these screens are code-built).
func rebuild() -> void:
	if size.x < MIN_SIZE or size.y < MIN_SIZE:
		return
	content = null
	for c in get_children():
		remove_child(c)
		c.queue_free()
	_refresh_metrics()
	_built_for = size
	build()
	relayout()

func build() -> void:
	pass

func relayout() -> void:
	pass

## The rectangle that respects the device safe area.
func safe_rect() -> Rect2:
	return Rect2(insets.x, insets.y, maxf(64.0, size.x - insets.x - insets.z),
		maxf(64.0, size.y - insets.y - insets.w))

func close_self() -> void:
	if Game != null and Game.ui != null and screen_name != "" and Game.ui.has_method("is_open") \
			and bool(Game.ui.call("is_open", screen_name)):
		Game.ui.call("close", screen_name)
	else:
		queue_free()

func _unhandled_input(event: InputEvent) -> void:
	if not modal or not is_visible_in_tree():
		return
	if event is InputEventKey and event.is_pressed() and not event.is_echo():
		if (event as InputEventKey).keycode == KEY_ESCAPE:
			accept_event()
			close_self()

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST and modal and is_visible_in_tree():
		close_self()

## Standard framed page: tiled background + title row (with Close) + an expanding body.
## Everything is anchored so it survives any viewport shape.
func page(title_text: String, with_close := true) -> VBoxContainer:
	UiUtil.dirt_background(self, 0.32)
	var root := VBoxContainer.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.offset_left = insets.x + 16.0 * s
	root.offset_top = insets.y + 10.0 * s
	root.offset_right = -(insets.z + 16.0 * s)
	root.offset_bottom = -(insets.w + 10.0 * s)
	root.add_theme_constant_override("separation", int(8.0 * s))
	add_child(root)
	content = root
	var head := UiUtil.hbox(10.0 * s)
	var t := UiUtil.label(title_text, UiUtil.font_title(s), UiUtil.TITLE_COLOR)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	t.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(t)
	if with_close:
		var cb := UiUtil.flat_button("Close", close_self, false, 120.0 * s)
		cb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		head.add_child(cb)
	root.add_child(head)
	var body := VBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", int(6.0 * s))
	root.add_child(body)
	return body
