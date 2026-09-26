extends ScreenBase
## "Crash log" screen: shows what the last run did before it died and copies it to the
## clipboard in one tap, so a phone-only crash can be reported without a cable.
##
## The text comes from `CrashReport.build()` (device + driver, settings, the previous run's
## breadcrumbs, and the tail of the engine's own log). The body is a read-only TextEdit so
## the player can also select part of it by hand if the clipboard is blocked.

var _report := ""
var _body: TextEdit = null
var _status: Label = null

func build() -> void:
	_report = CrashReport.build()
	var root := UiUtil.vbox(8.0 * s)
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.offset_left = 12.0 * s + insets.x
	root.offset_top = 10.0 * s + insets.y
	root.offset_right = -(12.0 * s + insets.z)
	root.offset_bottom = -(10.0 * s + insets.w)

	var head := UiUtil.hbox(8.0 * s)
	var title := UiUtil.label("Crash log", UiUtil.font_body(s), UiUtil.TITLE_COLOR)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	head.add_child(UiUtil.flat_button("Close", func() -> void: Game.ui.call("close", "crash_log")))
	root.add_child(head)

	var hint := UiUtil.label("Tap Copy, then paste it in the chat. This is what the last run did before it closed.",
		UiUtil.font_small(s), UiUtil.DIM_COLOR)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	root.add_child(hint)

	_body = TextEdit.new()
	_body.text = _report
	_body.editable = false
	_body.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	_body.scroll_smooth = true
	_body.add_theme_font_size_override("font_size", UiUtil.font_small(s))
	_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body.custom_minimum_size = Vector2(0.0, 180.0 * s)
	var frame := UiUtil.dmz_frame(_body, "big", 6.0)
	frame.size_flags_vertical = Control.SIZE_EXPAND_FILL
	frame.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	root.add_child(frame)

	var row := UiUtil.hbox(8.0 * s)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_child(UiUtil.button("Copy", _on_copy, 160.0 * s, 46.0 * s))
	row.add_child(UiUtil.button("Save to file", _on_save, 160.0 * s, 46.0 * s))
	root.add_child(row)

	_status = UiUtil.label("", UiUtil.font_small(s), UiUtil.ACCENT, HORIZONTAL_ALIGNMENT_CENTER)
	root.add_child(_status)
	add_child(root)

func _on_copy() -> void:
	DisplayServer.clipboard_set(_report)
	var ok := DisplayServer.clipboard_get().length() > 0
	_say("Copied. Paste it in the chat." if ok else "Copy failed - select the text and copy it by hand.")

## A file the player can attach if the clipboard is unavailable. `user://` on Android is
## Android/data/<package>/files, which a file manager can reach.
func _on_save() -> void:
	var path := "user://crash_report.txt"
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		_say("Could not write the file.")
		return
	f.store_string(_report)
	f.close()
	_say("Saved to %s" % ProjectSettings.globalize_path(path))

func _say(msg: String) -> void:
	if _status != null:
		_status.text = msg
