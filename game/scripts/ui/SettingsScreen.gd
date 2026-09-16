class_name SettingsScreen
extends ScreenBase
## Audio / camera / display settings (spec §6) written straight into Game.settings.

const PRESETS := ["Low", "Balanced", "High", "Custom"]

func _init() -> void:
	screen_name = "settings"

func build() -> void:
	var body := page("Settings")
	var tabs := UiUtil.hbox(6.0 * s)
	var pages := Control.new()
	pages.size_flags_vertical = Control.SIZE_EXPAND_FILL
	pages.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var made: Array[Control] = [_audio_page(), _camera_page(), _display_page()]
	for p in made:
		p.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		p.visible = false
		pages.add_child(p)
	made[0].visible = true
	var names := ["Audio", "Camera", "Display"]
	for i in names.size():
		var idx := i
		tabs.add_child(UiUtil.flat_button(names[i], func() -> void:
			for j in made.size():
				made[j].visible = j == idx, false, 130.0 * s))
	body.add_child(tabs)
	body.add_child(pages)
	var foot := UiUtil.hbox(8.0 * s)
	foot.alignment = BoxContainer.ALIGNMENT_CENTER
	foot.add_child(UiUtil.button("Save", func() -> void:
		Game.save_settings()
		Game.ui.call("toast", "Settings saved", "", null)
		close_self(), 220.0 * s, 44.0 * s))
	body.add_child(foot)

func _column() -> VBoxContainer:
	var v := UiUtil.vbox(6.0 * s)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return v

func _wrap(v: VBoxContainer) -> Control:
	var sc := UiUtil.scroll(v)
	return sc

func _put(key: String, value: Variant) -> void:
	Game.settings[key] = value
	Events.settings_changed.emit()

func _audio_page() -> Control:
	var v := _column()
	v.add_child(UiUtil.slider_row("Music", float(Game.settings.get("music_volume", 0.7)), 0.0, 1.0, 0.05,
		func(x: float) -> void: _put("music_volume", x)))
	v.add_child(UiUtil.slider_row("Sounds", float(Game.settings.get("sfx_volume", 1.0)), 0.0, 1.0, 0.05,
		func(x: float) -> void: _put("sfx_volume", x)))
	v.add_child(UiUtil.slider_row("Ambience", float(Game.settings.get("ambience_volume", 0.8)), 0.0, 1.0, 0.05,
		func(x: float) -> void: _put("ambience_volume", x)))
	return _wrap(v)

func _camera_page() -> Control:
	var v := _column()
	v.add_child(UiUtil.slider_row("1st sensitivity", float(Game.settings.get("sens_first", 1.0)), 0.3, 2.0, 0.05,
		func(x: float) -> void: _put("sens_first", x)))
	v.add_child(UiUtil.slider_row("3rd sensitivity", float(Game.settings.get("sens_third", 0.9)), 0.3, 2.0, 0.05,
		func(x: float) -> void: _put("sens_third", x)))
	v.add_child(UiUtil.slider_row("Field of view", float(Game.settings.get("fov", 75.0)), 60.0, 100.0, 1.0,
		func(x: float) -> void: _put("fov", x), "%.0f"))
	v.add_child(UiUtil.check_row("View bobbing", bool(Game.settings.get("view_bobbing", true)),
		func(b: bool) -> void: _put("view_bobbing", b)))
	v.add_child(UiUtil.check_row("Invert look Y", bool(Game.settings.get("invert_y", false)),
		func(b: bool) -> void: _put("invert_y", b)))
	v.add_child(UiUtil.check_row("Vibration", bool(Game.settings.get("vibration", true)),
		func(b: bool) -> void: _put("vibration", b)))
	v.add_child(UiUtil.check_row("Left handed layout", bool(Game.settings.get("left_handed", false)),
		func(b: bool) -> void: _put("left_handed", b)))
	return _wrap(v)

func _display_page() -> Control:
	var v := _column()
	var preset := String(Game.settings.get("quality_preset", "balanced")).capitalize()
	var pi := PRESETS.find(preset)
	v.add_child(UiUtil.option_row("Quality preset", PRESETS, maxi(0, pi), func(i: int) -> void:
		if PRESETS[i] == "Custom":
			_put("quality_preset", "custom")
		else:
			Game.apply_quality_preset(PRESETS[i].to_lower())
			rebuild()))
	v.add_child(UiUtil.slider_row("Render distance", float(Game.settings.get("render_distance", 5)), 2.0, 12.0, 1.0,
		func(x: float) -> void: _put("render_distance", int(x)), "%.0f"))
	v.add_child(UiUtil.slider_row("Sim distance", float(Game.settings.get("sim_distance", 3)), 1.0, 8.0, 1.0,
		func(x: float) -> void: _put("sim_distance", int(x)), "%.0f"))
	v.add_child(UiUtil.slider_row("UI scale", float(Game.settings.get("ui_scale", 1.0)), 0.7, 1.5, 0.05,
		func(x: float) -> void: _put("ui_scale", x)))
	v.add_child(UiUtil.slider_row("Button opacity", float(Game.settings.get("button_opacity", 0.65)), 0.2, 1.0, 0.05,
		func(x: float) -> void: _put("button_opacity", x)))
	v.add_child(UiUtil.slider_row("Particles", float(Game.settings.get("particles", 1.0)), 0.0, 1.0, 0.1,
		func(x: float) -> void: _put("particles", x)))
	v.add_child(UiUtil.check_row("Shadows", bool(Game.settings.get("shadows", false)),
		func(b: bool) -> void: _put("shadows", b)))
	v.add_child(UiUtil.check_row("Bloom", bool(Game.settings.get("bloom", true)),
		func(b: bool) -> void: _put("bloom", b)))
	v.add_child(UiUtil.check_row("Clouds", bool(Game.settings.get("clouds", true)),
		func(b: bool) -> void: _put("clouds", b)))
	v.add_child(UiUtil.check_row("Fancy water", bool(Game.settings.get("fancy_water", true)),
		func(b: bool) -> void: _put("fancy_water", b)))
	v.add_child(UiUtil.check_row("High contrast outline", bool(Game.settings.get("high_contrast_outline", false)),
		func(b: bool) -> void: _put("high_contrast_outline", b)))
	v.add_child(UiUtil.check_row("Show FPS", bool(Game.settings.get("show_fps", false)),
		func(b: bool) -> void: _put("show_fps", b)))
	return _wrap(v)
