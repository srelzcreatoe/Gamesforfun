class_name WorldSelect
extends ScreenBase
## World list: cards with name, mode/seed/last-played/version and Play / Rename / Copy / Delete.

var list: VBoxContainer = null

func _init() -> void:
	screen_name = "world_select"

func refresh() -> void:
	rebuild()

func build() -> void:
	var body := page("Select World")
	list = UiUtil.vbox(6.0 * s)
	body.add_child(UiUtil.scroll(list))
	var worlds := Game.list_worlds()
	if worlds.is_empty():
		list.add_child(UiUtil.dim("No worlds yet. Create one below.", UiUtil.font_body(s)))
	for w in worlds:
		list.add_child(_card(w))
	var actions := UiUtil.hbox(8.0 * s)
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	actions.add_child(UiUtil.button("Create New World", func() -> void: Game.ui.call("open", "create_world"), 300.0 * s, 44.0 * s))
	body.add_child(actions)

func _card(w: Dictionary) -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UiUtil.panel_light())
	var row := UiUtil.hbox(8.0 * s)
	var col := UiUtil.vbox(2.0 * s)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_child(UiUtil.label(String(w.get("name", "World")), UiUtil.font_body(s)))
	var when := "never"
	var lp := int(w.get("last_played", 0))
	if lp > 0:
		when = Time.get_datetime_string_from_unix_time(lp, true).replace("T", " ")
	col.add_child(UiUtil.dim("%s · seed %d · %s · v%s" % [
		String(w.get("mode", "story")).capitalize(), int(w.get("seed", 0)), when, String(w.get("version", "0.1.0"))],
		UiUtil.font_small(s)))
	row.add_child(col)
	row.add_child(UiUtil.flat_button("Play", func() -> void: _play(w), false, 100.0 * s))
	row.add_child(UiUtil.flat_button("Rename", func() -> void: _rename(w), false, 110.0 * s))
	row.add_child(UiUtil.flat_button("Copy", func() -> void: _copy(w), false, 90.0 * s))
	row.add_child(UiUtil.flat_button("Delete", func() -> void: _delete(w), true, 100.0 * s))
	p.add_child(row)
	return p

func _play(w: Dictionary) -> void:
	var prof := Game.load_profile(String(w.get("slug", "")))
	if prof.is_empty():
		Game.ui.call("open", "character_creation", {"world": w})
		return
	Game.ui.call("close", "world_select")
	Game.start_world(w, prof)

func _rename(w: Dictionary) -> void:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_STOP
	UiUtil.dim_background(root, 0.55)
	var p := UiUtil.panel()
	var v := UiUtil.vbox(8.0 * s)
	v.add_child(UiUtil.label("Rename world", UiUtil.font_body(s), UiUtil.TITLE_COLOR))
	var le := UiUtil.line_edit("World name", String(w.get("name", "")), 28)
	v.add_child(le)
	var h := UiUtil.hbox(8.0 * s)
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_child(UiUtil.flat_button("Cancel", func() -> void: root.queue_free()))
	h.add_child(UiUtil.flat_button("Rename", func() -> void:
		var info := w.duplicate(true)
		info["name"] = le.text.strip_edges().left(28)
		JsonUtil.save_file(Game.world_dir(String(w["slug"])).path_join("world.json"), info, true)
		root.queue_free()
		rebuild()))
	v.add_child(h)
	p.add_child(v)
	root.add_child(p)
	add_child(root)
	p.reset_size()
	p.position = (size - p.get_combined_minimum_size()) * 0.5

func _copy(w: Dictionary) -> void:
	var src := Game.world_dir(String(w.get("slug", "")))
	var info := Game.create_world(String(w.get("name", "World")) + " copy", str(int(w.get("seed", 0))),
		String(w.get("mode", "story")), String(w.get("difficulty", "normal")))
	var dst := Game.world_dir(String(info["slug"]))
	_copy_dir(src, dst, ["world.json"])
	var keep := info.duplicate(true)
	JsonUtil.save_file(dst.path_join("world.json"), keep, true)
	Game.ui.call("toast", "World copied", String(keep["name"]), null)
	rebuild()

func _copy_dir(src: String, dst: String, skip: Array) -> void:
	var d := DirAccess.open(src)
	if d == null:
		return
	DirAccess.make_dir_recursive_absolute(dst)
	d.list_dir_begin()
	var n := d.get_next()
	while n != "":
		if d.current_is_dir():
			if not n.begins_with("."):
				_copy_dir(src.path_join(n), dst.path_join(n), [])
		elif not skip.has(n):
			d.copy(src.path_join(n), dst.path_join(n))
		n = d.get_next()
	d.list_dir_end()

func _delete(w: Dictionary) -> void:
	UiUtil.confirm(self, "Delete \"%s\" forever?" % String(w.get("name", "")), "Delete", func() -> void:
		Game.delete_world(String(w.get("slug", "")))
		rebuild(), true)
