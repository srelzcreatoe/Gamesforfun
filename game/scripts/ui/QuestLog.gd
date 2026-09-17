class_name QuestLog
extends ScreenBase
## Saga tree + sidequest categories with locked / available / active / complete states and
## Start / Track / Claim wired to the quest engineer's QuestManager (guarded).

const STATE_COLORS := {
	"locked": Color(0.55, 0.55, 0.6),
	"available": Color(1.0, 0.92, 0.55),
	"active": Color(0.55, 0.85, 1.0),
	"complete": Color(0.55, 0.9, 0.6),
	"claimed": Color(0.45, 0.7, 0.5),
}

var tab := 0                       # 0 = sagas, 1 = sidequests
var saga_i := 0
var category := ""
var selected := ""
var left_list: VBoxContainer = null
var detail: VBoxContainer = null

func _init() -> void:
	screen_name = "quests"

func refresh() -> void:
	rebuild()

func build() -> void:
	var body := dmz_page("Quest Log", "", "quest")
	var tabs := UiUtil.hbox(6.0 * s)
	tabs.add_child(UiUtil.flat_button("Sagas", func() -> void: tab = 0; rebuild(), false, 130.0 * s))
	tabs.add_child(UiUtil.flat_button("Sidequests", func() -> void: tab = 1; rebuild(), false, 150.0 * s))
	body.add_child(tabs)
	var row := UiUtil.hbox(10.0 * s)
	row.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(row)

	var left := UiUtil.vbox(6.0 * s)
	left.custom_minimum_size.x = minf(340.0 * s, size.x * 0.42)
	if tab == 0:
		left.add_child(_saga_picker())
	else:
		left.add_child(_category_picker())
	left_list = UiUtil.vbox(4.0 * s)
	var sc := UiUtil.scroll(left_list)
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	left.add_child(sc)
	row.add_child(left)

	var frame := Panel.new()
	frame.add_theme_stylebox_override("panel", UiUtil.dmz_panel_style("quest"))
	frame.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	frame.size_flags_vertical = Control.SIZE_EXPAND_FILL
	detail = UiUtil.vbox(6.0 * s)
	detail.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	# The DMZ quest panel has a thick painted border; keep the text well inside it.
	detail.offset_left = 28.0 * s
	detail.offset_top = 24.0 * s
	detail.offset_right = -28.0 * s
	detail.offset_bottom = -24.0 * s
	frame.add_child(detail)
	row.add_child(frame)

	_fill_list()
	_fill_detail()

func _saga_picker() -> Control:
	var names: Array = []
	var sagas: Array = Registry.sagas if Registry != null else []
	for sg in sagas:
		names.append(String(sg.get("name", sg.get("id", "Saga"))))
	if names.is_empty():
		names = ["(no sagas)"]
	saga_i = clampi(saga_i, 0, names.size() - 1)
	return UiUtil.option_row("Saga", names, saga_i, func(i: int) -> void:
		saga_i = i
		_fill_list())

func _categories() -> PackedStringArray:
	var out := PackedStringArray()
	if Registry == null:
		return out
	for qid in Registry.quests.keys():
		var c := String(Registry.quests[qid].get("category", ""))
		if c.begins_with("sidequest") and not out.has(c):
			out.append(c)
	out.sort()
	return out

func _category_picker() -> Control:
	var cats := _categories()
	var names: Array = []
	for c in cats:
		names.append(c.replace("sidequest_", "").capitalize())
	if names.is_empty():
		names = ["(none)"]
	var idx := maxi(0, cats.find(category))
	if cats.size() > 0:
		category = cats[idx]
	return UiUtil.option_row("Category", names, idx, func(i: int) -> void:
		category = cats[i] if i < cats.size() else ""
		_fill_list())

func _quest_ids() -> PackedStringArray:
	var out := PackedStringArray()
	if Registry == null:
		return out
	if args.has("quests"):
		for q in args["quests"]:
			out.append(String(q))
		if out.size() > 0:
			return out
	if tab == 0:
		var sagas: Array = Registry.sagas
		if saga_i < sagas.size():
			for q in sagas[saga_i].get("quests", []):
				out.append(String(q))
		return out
	for qid in Registry.quests.keys():
		if String(Registry.quests[qid].get("category", "")) == category:
			out.append(qid)
	out.sort()
	return out

func _profile_quests() -> Dictionary:
	return Game.profile.get("quests", {}) if Game != null else {}

func quest_state(qid: String) -> String:
	var q := _profile_quests()
	if String(q.get("tracked", "")) == qid:
		pass
	if (q.get("claimed", []) as Array).has(qid):
		return "claimed"
	if (q.get("completed", []) as Array).has(qid):
		return "complete"
	if (q.get("active", {}) as Dictionary).has(qid):
		return "active"
	var qm := _quest_manager()
	if qm != null and qm.has_method("can_start"):
		var r: Dictionary = qm.call("can_start", qid)
		return "available" if bool(r.get("ok", false)) else "locked"
	# fallback: prerequisites resolved from the profile only
	for c in Registry.quest(qid).get("prerequisites", {}).get("conditions", []):
		if String(c.get("type", "")) == "SAGA_QUEST":
			var need := String(c.get("quest", ""))
			if need != "" and not (q.get("completed", []) as Array).has(need):
				return "locked"
	return "available"

func _quest_manager() -> Node:
	if Game != null and Game.world != null:
		return Game.world.get_node_or_null("QuestManager")
	return null

func _fill_list() -> void:
	if left_list == null:
		return
	for c in left_list.get_children():
		c.queue_free()
	var ids := _quest_ids()
	if ids.is_empty():
		left_list.add_child(UiUtil.dim("Nothing here yet.", UiUtil.font_small(s)))
		return
	if selected == "" or not ids.has(selected):
		selected = ids[0]
	for qid in ids:
		var def := Registry.quest(qid)
		var st := quest_state(qid)
		var icon := _state_icon(st)
		var b := Button.new()
		b.text = "%s %s" % [icon, String(def.get("title", def.get("name", qid)))]
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.focus_mode = Control.FOCUS_NONE
		b.add_theme_font_override("font", UiUtil.font())
		b.add_theme_font_size_override("font_size", UiUtil.font_small(s))
		b.add_theme_color_override("font_color", STATE_COLORS[st])
		b.add_theme_stylebox_override("normal", UiUtil.panel_light())
		b.add_theme_stylebox_override("hover", UiUtil.flat(UiUtil.BUTTON_UP, UiUtil.BUTTON_UP_BORDER, 2.0 * s, 9.0 * s, 5.0 * s))
		b.add_theme_stylebox_override("pressed", UiUtil.flat(UiUtil.BUTTON_DOWN, UiUtil.BUTTON_DOWN_BORDER, 2.0 * s, 9.0 * s, 5.0 * s))
		var id := qid
		b.pressed.connect(func() -> void:
			UiUtil.click()
			selected = id
			_fill_detail())
		left_list.add_child(b)

func _state_icon(st: String) -> String:
	match st:
		"locked": return "[-]"
		"available": return "[!]"
		"active": return "[>]"
		"complete": return "[*]"
		"claimed": return "[x]"
	return "[ ]"

func _fill_detail() -> void:
	if detail == null:
		return
	for c in detail.get_children():
		c.queue_free()
	if selected == "":
		detail.add_child(UiUtil.dim("Select a quest.", UiUtil.font_small(s)))
		return
	var def := Registry.quest(selected)
	if def.is_empty():
		detail.add_child(UiUtil.dim("Unknown quest " + selected, UiUtil.font_small(s)))
		return
	var st := quest_state(selected)
	detail.add_child(UiUtil.label(String(def.get("title", def.get("name", selected))), UiUtil.font_body(s), Color(1.0, 0.9, 0.5)))
	detail.add_child(UiUtil.dim("%s · %s" % [String(def.get("type", "QUEST")), st.capitalize()], UiUtil.font_small(s)))
	var d := UiUtil.label(String(def.get("description", def.get("desc", ""))), UiUtil.font_small(s))
	d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	d.custom_minimum_size.x = 120.0 * s
	d.size_flags_horizontal = Control.SIZE_FILL
	detail.add_child(d)
	var lvl := int(def.get("min_level", 0))
	if lvl > 0:
		detail.add_child(UiUtil.dim("Requires level %d" % lvl, UiUtil.font_small(s)))
	detail.add_child(UiUtil.label("Objectives", UiUtil.font_small(s), UiUtil.TITLE_COLOR))
	var prog: Array = _profile_quests().get("active", {}).get(selected, {}).get("objectives", [])
	var objs: Array = def.get("objectives", [])
	if objs.is_empty():
		detail.add_child(UiUtil.dim("  (none)", UiUtil.font_small(s)))
	for i in objs.size():
		var o: Dictionary = objs[i]
		var need := maxi(1, int(o.get("count", 1)))
		var have := int(prog[i]) if i < prog.size() else 0
		detail.add_child(UiUtil.dim("  %s  %d/%d" % [_objective_text(o), mini(have, need), need], UiUtil.font_small(s)))
	detail.add_child(UiUtil.label("Rewards", UiUtil.font_small(s), UiUtil.TITLE_COLOR))
	var rw: Array = def.get("rewards", [])
	if rw.is_empty():
		detail.add_child(UiUtil.dim("  (none)", UiUtil.font_small(s)))
	for r in rw:
		detail.add_child(UiUtil.dim("  " + _reward_text(r), UiUtil.font_small(s)))
	detail.add_child(UiUtil.spacer(6.0 * s))
	var actions := UiUtil.hbox(6.0 * s)
	var start := UiUtil.flat_button("Start", _start, false, 110.0 * s)
	start.disabled = st != "available"
	actions.add_child(start)
	var track := UiUtil.flat_button("Track", _track, false, 110.0 * s)
	track.disabled = st != "active"
	actions.add_child(track)
	var claim := UiUtil.flat_button("Claim", _claim, false, 110.0 * s)
	claim.disabled = st != "complete"
	actions.add_child(claim)
	detail.add_child(actions)

func _objective_text(o: Dictionary) -> String:
	match String(o.get("type", "")):
		"KILL": return "Defeat " + String(o.get("entity_name", o.get("entity", "enemy")))
		"TALK": return "Talk to " + String(o.get("npc_name", o.get("npc", "someone")))
		"OBTAIN": return "Collect " + UiUtil.item_name(String(o.get("item", "")))
		"GO_TO": return "Travel to " + String(o.get("biome", o.get("structure", "the marker")))
		"INTERACT": return "Interact with " + String(o.get("block", "the object"))
		"SUMMON": return "Summon " + String(o.get("dragon", "the dragon"))
		"SKILL": return "Learn " + String(o.get("skill", "a skill"))
		"TRAIN": return "Spend %d training points" % int(o.get("amount", 0))
		"WAIT": return "Wait %d seconds" % int(o.get("seconds", 0))
	return String(o.get("desc", "Objective"))

func _reward_text(r: Dictionary) -> String:
	match String(r.get("type", "")):
		"TPS": return "%d training points" % int(r.get("amount", 0))
		"ITEM": return "%s x%d" % [UiUtil.item_name(String(r.get("item", ""))), int(r.get("count", 1))]
		"SKILL": return "Skill: " + String(r.get("skill", ""))
		"TECHNIQUE": return "Technique: " + String(r.get("technique", ""))
		"FORM": return "Form: " + String(r.get("form", ""))
		"ALIGNMENT": return "Alignment %+d" % int(r.get("amount", 0))
		"UNLOCK_PLANET": return "Travel unlocked: " + String(r.get("planet", ""))
	return String(r.get("type", "Reward"))

func _start() -> void:
	var qm := _quest_manager()
	if qm != null and qm.has_method("start"):
		qm.call("start", selected)
	else:
		var q := _profile_quests()
		if not q.has("active"):
			q["active"] = {}
		var objs: Array = Registry.quest(selected).get("objectives", [])
		var arr: Array = []
		for _o in objs:
			arr.append(0)
		q["active"][selected] = {"objectives": arr, "spawned": []}
		q["tracked"] = selected
		Events.quest_started.emit(selected)
	_fill_list()
	_fill_detail()

func _track() -> void:
	var qm := _quest_manager()
	if qm != null and qm.has_method("track"):
		qm.call("track", selected)
	else:
		_profile_quests()["tracked"] = selected
		Events.quest_tracked.emit(selected)
	Game.ui.call("toast", "Tracking", String(Registry.quest(selected).get("title", selected)), null)

func _claim() -> void:
	var qm := _quest_manager()
	if qm != null and qm.has_method("claim"):
		qm.call("claim", selected)
	else:
		var q := _profile_quests()
		if not (q.get("claimed", []) as Array).has(selected):
			(q["claimed"] as Array).append(selected)
		Events.quest_reward_claimed.emit(selected)
	_fill_list()
	_fill_detail()
