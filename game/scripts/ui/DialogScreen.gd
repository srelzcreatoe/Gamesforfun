class_name DialogScreen
extends ScreenBase
## NPC conversation: portrait, typewriter text and the Talk / Train / Quests / Shop / Leave choices.
## Opened with `Game.ui.open("dialog", {npc: node})`; renders sensibly with no npc at all.

const CPS := 42.0

var npc: Node = null
var master: Dictionary = {}
var lines: PackedStringArray = PackedStringArray()
var line_i := 0
var text_label: Label = null
var _typed := 0.0
var _full := ""

func _init() -> void:
	screen_name = "dialog"

func build() -> void:
	npc = args.get("npc", null)
	_resolve_master()
	UiUtil.dim_background(self, 0.35)
	var panel_h := clampf(size.y * 0.42, 180.0, 420.0)
	var p := Panel.new()
	p.add_theme_stylebox_override("panel", UiUtil.dmz_panel_style("npc_top"))
	p.position = Vector2(20.0 * s + insets.x, size.y - panel_h - 16.0 * s - insets.w)
	p.size = Vector2(size.x - 40.0 * s - insets.x - insets.z, panel_h)
	add_child(p)
	content = p
	var row := UiUtil.hbox(12.0 * s)
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 14.0 * s
	row.offset_top = 12.0 * s
	row.offset_right = -14.0 * s
	row.offset_bottom = -12.0 * s
	p.add_child(row)

	var portrait := _portrait(minf(panel_h - 24.0 * s, 150.0 * s))
	row.add_child(portrait)

	var col := UiUtil.vbox(6.0 * s)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(col)
	var name_bar := UiUtil.dmz_bar(_npc_name(), 220.0 * s)
	name_bar.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	col.add_child(name_bar)
	text_label = UiUtil.label("", UiUtil.font_small(s))
	text_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	text_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(text_label)
	var choices := UiUtil.hbox(6.0 * s)
	choices.add_child(UiUtil.flat_button("Talk", _next_line, false, 100.0 * s))
	if bool(master.get("trains", false)):
		choices.add_child(UiUtil.flat_button("Train", _train, false, 100.0 * s))
	if not _quest_ids().is_empty():
		choices.add_child(UiUtil.flat_button("Quests", _quests, false, 110.0 * s))
	if npc != null and npc.has_method("open_shop"):
		choices.add_child(UiUtil.flat_button("Shop", func() -> void: npc.call("open_shop", Game.player), false, 100.0 * s))
	choices.add_child(UiUtil.flat_button("Leave", _leave, true, 100.0 * s))
	col.add_child(choices)
	_set_line(0)

func _resolve_master() -> void:
	var mid := ""
	if npc != null:
		if npc.get("master_id") != null:
			mid = String(npc.get("master_id"))
		elif npc.get("entity_type") != null and Registry != null:
			mid = String(Registry.entity(String(npc.get("entity_type"))).get("master", ""))
	if mid == "" and args.has("master"):
		mid = String(args["master"])
	if mid != "" and Registry != null:
		master = Registry.masters.get(mid, {})
	var d: Variant = master.get("dialog", [])
	if d is Array and not (d as Array).is_empty():
		lines = PackedStringArray(d)
	else:
		lines = PackedStringArray(["..."])

func _npc_name() -> String:
	if not master.is_empty():
		return String(master.get("name", "Stranger"))
	if npc != null and Registry != null:
		var et := String(npc.get("entity_type"))
		return String(Registry.entity(et).get("name", et.capitalize()))
	return "Stranger"

func _portrait(px: float) -> Control:
	var frame := Panel.new()
	frame.add_theme_stylebox_override("panel", UiUtil.flat(Color(0.02, 0.06, 0.04, 0.9), Color(0.45, 0.62, 0.4), 2.0 * s, 0.0, 0.0))
	frame.custom_minimum_size = Vector2(px, px)
	var ch := {"race": "human", "skin_color": "#FFD3C9", "hair_color": "#222629"}
	if npc != null and npc.get("character") != null:
		var c: Variant = npc.get("character")
		if c is Dictionary:
			ch = c
	var pv := CharacterPreview.new(Vector2(px - 8.0 * s, px - 8.0 * s))
	pv.position = Vector2(4.0 * s, 4.0 * s)
	pv.spin = 0.25
	pv.set_character(ch)
	frame.add_child(pv)
	return frame

func _set_line(i: int) -> void:
	line_i = clampi(i, 0, lines.size() - 1)
	_full = lines[line_i]
	_typed = 0.0
	if text_label != null:
		text_label.text = ""

func _next_line() -> void:
	if _typed < float(_full.length()):
		_typed = float(_full.length())
		text_label.text = _full
		return
	if line_i + 1 < lines.size():
		_set_line(line_i + 1)
	else:
		_set_line(0)

func _train() -> void:
	var mid := String(master.get("id", ""))
	var dc := _world_node("DialogController")
	if dc != null and dc.has_method("open_training"):
		dc.call("open_training", mid)
		close_self()
		return
	if npc != null and npc.has_method("train"):
		npc.call("train", Game.player)
		return
	var qm := _quest_manager()
	if qm != null and qm.has_method("notify_talk"):
		qm.call("notify_talk", mid)
	Game.ui.call("open", "stats", {"tab": 1})

func _world_node(name: String) -> Node:
	if Game != null and Game.world != null:
		return Game.world.get_node_or_null(name)
	return null

func _quest_ids() -> Array:
	var ids: Variant = master.get("gives_quests", master.get("quests", []))
	return ids if ids is Array else []

func _quests() -> void:
	Game.ui.call("open", "quests", {"npc": String(master.get("id", "")), "quests": _quest_ids()})

func _quest_manager() -> Node:
	return _world_node("QuestManager")

func _leave() -> void:
	close_self()

func _exit_tree() -> void:
	Events.dialog_closed.emit(npc)

func _process(delta: float) -> void:
	if text_label == null or _full == "":
		return
	if _typed < float(_full.length()):
		_typed = minf(float(_full.length()), _typed + delta * CPS)
		text_label.text = _full.substr(0, int(_typed))
