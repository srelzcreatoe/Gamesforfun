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
	var title := UiUtil.title_glow("PAUSED", UiUtil.NIGHT_NEON_LIGHT, UiUtil.TITLE_COLOR)
	title.custom_minimum_size.x = size.x
	v.add_child(title)
	var bw := minf(320.0 * s, size.x * 0.55)
	var rows := UiUtil.vbox(7.0 * s)
	var frame := UiUtil.dmz_frame(rows, "big", 8.0)
	frame.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var center := HBoxContainer.new()
	center.alignment = BoxContainer.ALIGNMENT_CENTER
	center.add_child(frame)
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
