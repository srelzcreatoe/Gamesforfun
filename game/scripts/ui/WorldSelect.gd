class_name WorldSelect
extends ScreenBase
## The three save slots. Each card shows who lives in the slot; empty slots offer "New Game".
## Kept under the `world_select` screen id so every existing caller keeps working.

var list: HBoxContainer = null

func _init() -> void:
	screen_name = "world_select"

func refresh() -> void:
	rebuild()

func build() -> void:
	var body := page("Select Save Slot")
	body.add_child(UiUtil.dim("Each slot keeps its own world, character and settings.", UiUtil.font_small(s)))
	var wrap := ScrollContainer.new()
	wrap.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	wrap.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	wrap.size_flags_vertical = Control.SIZE_EXPAND_FILL
	wrap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list = UiUtil.hbox(12.0 * s)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list.alignment = BoxContainer.ALIGNMENT_CENTER
	wrap.add_child(list)
	body.add_child(wrap)
	for slot in SaveSlots.list():
		list.add_child(_card(slot))

func _card(slot: Dictionary) -> Control:
	var i := int(slot["index"])
	var used := bool(slot["used"])
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UiUtil.panel_light())
	var col_w := clampf((size.x - 90.0 * s) / 3.0, 180.0 * s, 300.0 * s)
	p.custom_minimum_size = Vector2(col_w, 0.0)
	var v := UiUtil.vbox(5.0 * s)
	v.add_child(UiUtil.label("Slot %d" % i, UiUtil.font_body(s), UiUtil.TITLE_COLOR, HORIZONTAL_ALIGNMENT_CENTER))
	v.add_child(_divider())
	if used:
		v.add_child(UiUtil.label(String(slot["name"]) if String(slot["name"]) != "" else "Unnamed",
			UiUtil.font_body(s), Color(1.0, 0.9, 0.5), HORIZONTAL_ALIGNMENT_CENTER))
		v.add_child(_row("Race", String(slot["race"])))
		v.add_child(_row("Class", String(slot["class"])))
		v.add_child(_row("Level", str(int(slot["level"]))))
		v.add_child(_row("Planet", String(slot["planet"])))
		v.add_child(_row("Mode", "%s · %s" % [String(slot["mode"]), String(slot["difficulty"])]))
		v.add_child(_row("Played", SaveSlots.format_play_time(float(slot["play_time"]))))
		v.add_child(_row("Last", SaveSlots.format_last_played(int(slot["last_played"]))))
		v.add_child(UiUtil.spacer(6.0 * s))
		v.add_child(UiUtil.button("Play", func() -> void: _play(i), col_w - 24.0 * s, 46.0 * s))
		var actions := UiUtil.hbox(6.0 * s)
		actions.alignment = BoxContainer.ALIGNMENT_CENTER
		actions.add_child(UiUtil.flat_button("Copy", func() -> void: _copy(i), false, 96.0 * s))
		actions.add_child(UiUtil.flat_button("Delete", func() -> void: _delete(i, String(slot["name"])), true, 110.0 * s))
		v.add_child(actions)
	else:
		v.add_child(UiUtil.spacer(10.0 * s))
		var empty := UiUtil.dim("Empty slot", UiUtil.font_small(s))
		empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(empty)
		v.add_child(UiUtil.spacer(120.0 * s))
		v.add_child(UiUtil.button("New Game", func() -> void: _new_game(i), col_w - 24.0 * s, 46.0 * s))
	p.add_child(v)
	return p

func _divider() -> Control:
	var c := ColorRect.new()
	c.color = Color(1, 1, 1, 0.12)
	c.custom_minimum_size.y = maxf(1.0, 2.0 * s)
	return c

func _row(key: String, value: String) -> Control:
	var h := UiUtil.hbox(6.0 * s)
	var k := UiUtil.dim(key, UiUtil.font_small(s))
	k.custom_minimum_size.x = 74.0 * s
	h.add_child(k)
	var val := UiUtil.label(value if value != "" else "-", UiUtil.font_small(s))
	val.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	val.clip_text = true
	h.add_child(val)
	return h

func _play(i: int) -> void:
	if SaveSlots.start(i):
		Game.ui.call("close", "world_select")
	else:
		Game.ui.call("show_hint", "That slot has no character yet.", 2.0)
		rebuild()

func _new_game(i: int) -> void:
	Game.ui.call("open", "create_world", {"slot": i})

func _delete(i: int, name: String) -> void:
	var who := name if name != "" else "this save"
	UiUtil.confirm(self, "Delete slot %d (%s) forever?" % [i, who], "Delete", func() -> void:
		SaveSlots.delete_slot(i)
		if SaveSlots.active() == i:
			SaveSlots.clear_active()
		rebuild(), true)

func _copy(i: int) -> void:
	var targets: Array = []
	for n in range(1, SaveSlots.COUNT + 1):
		if n != i:
			targets.append(n)
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_STOP
	UiUtil.dim_background(root, 0.55)
	var panel := UiUtil.panel()
	var v := UiUtil.vbox(8.0 * s)
	v.add_child(UiUtil.label("Copy slot %d to..." % i, UiUtil.font_body(s), UiUtil.TITLE_COLOR))
	for t in targets:
		var target := int(t)
		var used := SaveSlots.is_used(target)
		v.add_child(UiUtil.flat_button("Slot %d%s" % [target, "  (overwrite)" if used else ""],
			func() -> void:
				root.queue_free()
				if used:
					UiUtil.confirm(self, "Overwrite slot %d?" % target, "Overwrite", func() -> void:
						SaveSlots.copy_slot(i, target)
						rebuild(), true)
				else:
					SaveSlots.copy_slot(i, target)
					rebuild(), used, 220.0 * s))
	v.add_child(UiUtil.flat_button("Cancel", func() -> void: root.queue_free(), false, 220.0 * s))
	panel.add_child(v)
	root.add_child(panel)
	add_child(root)
	panel.reset_size()
	panel.position = (size - panel.get_combined_minimum_size()) * 0.5
