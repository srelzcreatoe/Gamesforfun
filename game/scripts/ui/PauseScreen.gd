class_name PauseScreen
extends ScreenBase
## Resume / Settings / Save & Quit (spec §7). Autosaves on open.

func _init() -> void:
	screen_name = "pause"

func build() -> void:
	UiUtil.dim_background(self, 0.6)
	var v := UiUtil.vbox(10.0 * s)
	v.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	add_child(v)
	content = v
	v.add_child(UiUtil.label("Paused", UiUtil.font_title(s), UiUtil.TITLE_COLOR, HORIZONTAL_ALIGNMENT_CENTER))
	var bw := minf(340.0 * s, size.x * 0.6)
	var rows := UiUtil.vbox(8.0 * s)
	var center := HBoxContainer.new()
	center.alignment = BoxContainer.ALIGNMENT_CENTER
	center.add_child(rows)
	v.add_child(center)
	rows.add_child(UiUtil.button("Resume", close_self, bw, 46.0 * s))
	rows.add_child(UiUtil.button("Settings", func() -> void: Game.ui.call("open", "settings"), bw, 46.0 * s))
	rows.add_child(UiUtil.button("Quests", func() -> void: Game.ui.call("open", "quests"), bw, 46.0 * s))
	rows.add_child(UiUtil.button("Stats", func() -> void: Game.ui.call("open", "stats"), bw, 46.0 * s))
	rows.add_child(UiUtil.button("Save & Quit", func() -> void:
		Game.save_all()
		Game.ui.call("close_all")
		Game.quit_to_menu(), bw, 46.0 * s))
	if not Game.world_info.is_empty():
		Game.save_all()
