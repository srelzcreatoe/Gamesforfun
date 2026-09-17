class_name DevMenu
extends ScreenBase
## Cheat / debug console, only reachable when `settings.dev_mode` is on (Settings > Display).
## Everything here goes through the normal subsystem APIs, guarded with has_method, so the
## dev menu can never drift from real gameplay.

const TIMES := {"Dawn": 0.0, "Noon": 6000.0, "Dusk": 12000.0, "Midnight": 18000.0}
const WEATHERS := ["clear", "rain", "thunder", "snow"]

var tab := 0
var page_box: VBoxContainer = null
var _item_filter := ""
var _entity_filter := ""

func _init() -> void:
	screen_name = "dev"

func refresh() -> void:
	rebuild()

func build() -> void:
	var body := page("Dev Menu")
	body.add_child(UiUtil.dim("Cheats are saved with this slot. Turn Dev mode off in Settings to hide them.",
		UiUtil.font_small(s)))
	var names := ["Player", "Items", "World", "Progress", "Debug"]
	var tabs := UiUtil.hbox(6.0 * s)
	for i in names.size():
		var idx := i
		var b := UiUtil.flat_button(names[i], func() -> void:
			tab = idx
			rebuild(), false, 120.0 * s)
		if i == tab:
			b.modulate = Color(1.25, 1.25, 1.0)
		tabs.add_child(b)
	body.add_child(tabs)
	page_box = UiUtil.vbox(6.0 * s)
	var sc := UiUtil.scroll(page_box)
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(sc)
	match tab:
		0: _player_tab()
		1: _items_tab()
		2: _world_tab()
		3: _progress_tab()
		_: _debug_tab()

# --- helpers ---------------------------------------------------------------

func player() -> Node:
	return Game.player if Game != null else null

func world() -> Node:
	return Game.world if Game != null else null

func _node(name: String) -> Node:
	var w := world()
	return w.get_node_or_null(name) if w != null else null

func _toggle(text: String, value: bool, on_change: Callable) -> Control:
	return UiUtil.check_row(text, value, on_change)

func _button_row(buttons: Array) -> HBoxContainer:
	var h := UiUtil.hbox(6.0 * s)
	for b in buttons:
		h.add_child(UiUtil.flat_button(String(b[0]), b[1], false, float(b[2]) * s))
	return h

func _note(text: String) -> void:
	if Game != null and Game.ui != null:
		Game.ui.call("show_hint", text, 2.0)

func _need_player() -> bool:
	if player() == null:
		_note("Start a world first.")
		return false
	return true

func _section(title: String) -> void:
	page_box.add_child(UiUtil.label(title, UiUtil.font_small(s), UiUtil.TITLE_COLOR))

# --- tabs ------------------------------------------------------------------

func _player_tab() -> void:
	var p := player()
	_section("Cheats")
	for pair in [["God mode", "god_mode"], ["Infinite ki", "infinite_ki"],
			["Creative flight", "creative_flight"], ["Noclip", "noclip"]]:
		var key := String(pair[1])
		var on := p != null and p.has_method("cheat") and bool(p.call("cheat", key))
		page_box.add_child(_toggle(String(pair[0]), on, func(v: bool) -> void:
			if _need_player():
				player().call("set_cheat", key, v)))
	_section("Body")
	page_box.add_child(_button_row([
		["Heal", func() -> void:
			if _need_player():
				player().call("heal", 99999.0)
				player().set("ki", player().get("max_ki"))
				player().set("stamina", player().get("max_stamina"))
				Events.ki_changed.emit(player().get("ki"), player().get("max_ki"))
				_note("Restored."), 120],
		["Kill hostiles", _kill_hostiles, 160],
		["Respawn", func() -> void:
			if _need_player():
				player().call("respawn"), 120],
	]))
	_section("Training points")
	page_box.add_child(_button_row([
		["+1 000 TP", func() -> void: _give_tp(1000), 150],
		["+10 000 TP", func() -> void: _give_tp(10000), 160],
		["Max stats", _max_stats, 150],
	]))
	_section("Transform")
	var forms := _form_list()
	if forms.is_empty():
		page_box.add_child(UiUtil.dim("No form data.", UiUtil.font_small(s)))
	else:
		page_box.add_child(UiUtil.option_row("Form", forms, 0, func(i: int) -> void:
			_transform(String(forms[i]))))
		page_box.add_child(_button_row([["Revert", func() -> void:
			if _need_player():
				Forms.revert_all(player()), 120]]))

func _items_tab() -> void:
	_section("Give item")
	var search := UiUtil.line_edit("Search items...", _item_filter, 32)
	page_box.add_child(search)
	var count_state := {"n": 1}
	page_box.add_child(UiUtil.option_row("Count", [1, 8, 16, 32, 64], 0, func(i: int) -> void:
		count_state["n"] = [1, 8, 16, 32, 64][i]))
	var list := UiUtil.vbox(3.0 * s)
	page_box.add_child(list)
	var fill := func() -> void:
		for c in list.get_children():
			c.queue_free()
		var needle := _item_filter.strip_edges().to_lower()
		var shown := 0
		for id in Registry.items.keys():
			if shown >= 40:
				break
			var sid := String(id)
			var nm := UiUtil.item_name(sid)
			if needle != "" and not (sid.contains(needle) or nm.to_lower().contains(needle)):
				continue
			shown += 1
			var row := UiUtil.hbox(6.0 * s)
			row.add_child(UiUtil.icon_rect(UiUtil.item_icon(sid), Vector2(26.0 * s, 26.0 * s)))
			var l := UiUtil.label(nm, UiUtil.font_small(s))
			l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			l.clip_text = true
			row.add_child(l)
			row.add_child(UiUtil.flat_button("Give", func() -> void:
				_give_item(sid, int(count_state["n"])), false, 100.0 * s))
			list.add_child(row)
		if shown == 0:
			list.add_child(UiUtil.dim("No item matches.", UiUtil.font_small(s)))
	search.text_changed.connect(func(t: String) -> void:
		_item_filter = t
		fill.call())
	fill.call()

func _world_tab() -> void:
	_section("Time")
	var times: Array = TIMES.keys()
	page_box.add_child(_button_row([
		[String(times[0]), func() -> void: _set_time(float(TIMES[times[0]])), 110],
		[String(times[1]), func() -> void: _set_time(float(TIMES[times[1]])), 110],
		[String(times[2]), func() -> void: _set_time(float(TIMES[times[2]])), 110],
		[String(times[3]), func() -> void: _set_time(float(TIMES[times[3]])), 130],
	]))
	_section("Weather")
	page_box.add_child(UiUtil.option_row("Weather", WEATHERS, 0, func(i: int) -> void:
		_set_weather(WEATHERS[i])))
	_section("Teleport")
	var marks := _structure_list()
	if marks.is_empty():
		page_box.add_child(UiUtil.dim("No structure markers in range.", UiUtil.font_small(s)))
	else:
		var names: Array = []
		for m in marks:
			names.append(String(m["name"]))
		page_box.add_child(UiUtil.option_row("Structure", names, 0, func(i: int) -> void:
			_teleport(marks[i]["pos"])))
	var coord := UiUtil.hbox(6.0 * s)
	var fx := UiUtil.line_edit("x", "0", 8)
	var fy := UiUtil.line_edit("y", "80", 8)
	var fz := UiUtil.line_edit("z", "0", 8)
	for f in [fx, fy, fz]:
		f.custom_minimum_size.x = 90.0 * s
		coord.add_child(f)
	coord.add_child(UiUtil.flat_button("Go", func() -> void:
		_teleport(Vector3(float(fx.text), float(fy.text), float(fz.text))), false, 90.0 * s))
	page_box.add_child(coord)
	_section("Travel")
	var planets: Array = Registry.planets.keys() if Registry != null else []
	if planets.is_empty():
		page_box.add_child(UiUtil.dim("No planet data.", UiUtil.font_small(s)))
	else:
		var pnames: Array = []
		for pid in planets:
			pnames.append(String(Registry.planet(String(pid)).get("name", String(pid).capitalize())))
		page_box.add_child(UiUtil.option_row("Planet", pnames, 0, func(i: int) -> void:
			_travel(String(planets[i]))))
	_section("Spawn entity")
	var esearch := UiUtil.line_edit("Search entities...", _entity_filter, 32)
	page_box.add_child(esearch)
	var elist := UiUtil.vbox(3.0 * s)
	page_box.add_child(elist)
	var efill := func() -> void:
		for c in elist.get_children():
			c.queue_free()
		var needle := _entity_filter.strip_edges().to_lower()
		var shown := 0
		for id in Registry.entities.keys():
			if shown >= 30:
				break
			var sid := String(id)
			if sid == "player":
				continue
			var nm := String(Registry.entity(sid).get("name", sid.capitalize()))
			if needle != "" and not (sid.contains(needle) or nm.to_lower().contains(needle)):
				continue
			shown += 1
			var row := UiUtil.hbox(6.0 * s)
			var l := UiUtil.label(nm, UiUtil.font_small(s))
			l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			l.clip_text = true
			row.add_child(l)
			row.add_child(UiUtil.flat_button("Spawn", func() -> void: _spawn(sid), false, 110.0 * s))
			elist.add_child(row)
		if shown == 0:
			elist.add_child(UiUtil.dim("No entity matches.", UiUtil.font_small(s)))
	esearch.text_changed.connect(func(t: String) -> void:
		_entity_filter = t
		efill.call())
	efill.call()

func _progress_tab() -> void:
	_section("Unlock everything")
	page_box.add_child(_button_row([
		["All skills", _unlock_skills, 140],
		["All techniques", _unlock_techniques, 170],
		["All forms", _unlock_forms, 140],
	]))
	page_box.add_child(_button_row([["All planets", _unlock_planets, 150]]))
	_section("Quests")
	page_box.add_child(_button_row([
		["Complete tracked", _complete_tracked, 200],
	]))
	var ids: Array = []
	var names: Array = []
	if Registry != null:
		for qid in Registry.quests.keys():
			if ids.size() >= 120:
				break
			ids.append(String(qid))
			names.append(String(Registry.quest(String(qid)).get("title", qid)))
	if ids.is_empty():
		page_box.add_child(UiUtil.dim("No quest data.", UiUtil.font_small(s)))
	else:
		page_box.add_child(UiUtil.option_row("Quest", names, 0, func(i: int) -> void:
			_start_quest(String(ids[i]))))

func _debug_tab() -> void:
	var w := world()
	var ov: DevOverlay = DevOverlay.get_for(w) if w != null else null
	_section("Overlays")
	page_box.add_child(_toggle("Entity hitboxes", ov != null and ov.show_hitboxes, func(v: bool) -> void:
		var o := DevOverlay.get_for(world())
		if o != null:
			o.show_hitboxes = v
		else:
			_note("Start a world first.")))
	page_box.add_child(_toggle("Chunk borders", ov != null and ov.show_chunks, func(v: bool) -> void:
		var o := DevOverlay.get_for(world())
		if o != null:
			o.show_chunks = v
		else:
			_note("Start a world first.")))
	page_box.add_child(_toggle("Show FPS", bool(Game.settings.get("show_fps", false)), func(v: bool) -> void:
		Game.settings["show_fps"] = v
		Events.settings_changed.emit()))
	page_box.add_child(_toggle("Show coordinates", bool(UiUtil.setting("show_coordinates", false)),
		func(v: bool) -> void:
			Game.settings["show_coordinates"] = v
			Events.settings_changed.emit()))
	_section("State")
	for line in _state_lines():
		page_box.add_child(UiUtil.dim(line, UiUtil.font_small(s)))

func _state_lines() -> PackedStringArray:
	var out := PackedStringArray()
	var p := player()
	if p == null:
		out.append("no player")
		return out
	var pos: Vector3 = (p as Node3D).global_position
	out.append("pos  %.1f, %.1f, %.1f" % [pos.x, pos.y, pos.z])
	out.append("hp   %.0f / %.0f" % [float(p.get("health")), float(p.get("max_health"))])
	out.append("ki   %.0f / %.0f" % [float(p.get("ki")), float(p.get("max_ki"))])
	out.append("form %s" % (String(p.get("current_form")) if String(p.get("current_form")) != "" else "base"))
	out.append("tp   %d" % Training.tp(p))
	var w := world()
	if w != null:
		out.append("planet %s  time %.0f  weather %s" % [String(w.get("planet_id")),
			float(w.get("time_ticks")), String(w.get("weather"))])
	return out

# --- actions ---------------------------------------------------------------

func _give_item(id: String, count: int) -> void:
	if not _need_player():
		return
	var left := int(player().call("give", id, count))
	_note("Gave %d %s" % [count - left, UiUtil.item_name(id)])

func _give_tp(amount: int) -> void:
	if not _need_player():
		return
	Training.award(player(), float(amount))
	_note("+%d TP" % amount)
	Events.tp_changed.emit(Training.tp(player()), Training.tp_total(player()))

func _max_stats() -> void:
	if not _need_player():
		return
	var st: Variant = player().get("stats")
	if st == null or not st.has_method("raise"):
		return
	for k in ["STR", "SKP", "STM", "RES", "VIT", "PWR", "ENE"]:
		var cur := int(st.call("raw", k)) if st.has_method("raw") else 5
		st.call("raise", k, maxi(0, 200 - cur))
	if st.has_method("to_profile"):
		st.call("to_profile", Game.profile)
	if player().has_method("refresh_derived"):
		player().call("refresh_derived")
	Events.stats_changed.emit()
	_note("Stats maxed.")

func _kill_hostiles() -> void:
	var w := world()
	if w == null or not w.has_method("get_entities"):
		_note("Start a world first.")
		return
	var n := 0
	for e in w.call("get_entities"):
		if e == player() or not e.has_method("die"):
			continue
		if String(e.get("faction")) in ["villain", "wild"]:
			e.call("die", player())
			n += 1
	_note("Defeated %d." % n)

func _form_list() -> Array:
	var out: Array = []
	if Registry == null:
		return out
	var race := String(Game.profile.get("character", {}).get("race", ""))
	for fid in Registry.forms.keys():
		var d: Dictionary = Registry.form(String(fid))
		if race != "" and String(d.get("race", "")) != "" and String(d.get("race", "")) != race:
			continue
		out.append(String(fid))
		if out.size() >= 40:
			break
	return out

func _transform(form_id: String) -> void:
	if not _need_player():
		return
	Forms.unlock(player(), form_id)
	if not Forms.transform(player(), form_id, true):
		_note("Could not transform into " + form_id)

func _set_time(ticks: float) -> void:
	var w := world()
	if w == null:
		_note("Start a world first.")
		return
	w.set("time_ticks", ticks)
	Events.time_changed.emit(ticks)

func _set_weather(kind: String) -> void:
	var w := world()
	if w == null:
		_note("Start a world first.")
		return
	if w.has_method("set_weather"):
		w.call("set_weather", kind)
	else:
		w.set("weather", kind)
	Events.weather_changed.emit(kind)

func _structure_list() -> Array:
	var out: Array = []
	var w := world()
	if w == null:
		return out
	# Structure anchors recorded by the worldgen engineer on each loaded column.
	if w.has_method("get_column"):
		var focus := Vector3.ZERO
		if player() != null:
			focus = (player() as Node3D).global_position
		var cx := int(floor(focus.x / 16.0))
		var cz := int(floor(focus.z / 16.0))
		for dx in range(-6, 7):
			for dz in range(-6, 7):
				var col: Variant = w.call("get_column", cx + dx, cz + dz)
				if col == null:
					continue
				var marks: Variant = col.get("structure_marks")
				if not (marks is Array):
					continue
				for m in marks:
					if not (m is Dictionary):
						continue
					var pos: Variant = m.get("pos", m.get("position", null))
					if pos == null:
						continue
					out.append({"name": String(m.get("id", m.get("structure", "structure"))),
						"pos": Vector3(pos)})
					if out.size() >= 30:
						return out
	if out.is_empty() and Registry != null:
		for sid in Registry.structures.keys():
			out.append({"name": String(sid) + " (not loaded)", "pos": Vector3.ZERO})
			if out.size() >= 20:
				break
		out.clear()      # no coordinates without a marker: offer nothing rather than lying
	return out

func _teleport(pos: Vector3) -> void:
	if not _need_player():
		return
	var target := pos
	if target.y <= 0.0 and world() != null and world().has_method("get_height"):
		target.y = float(world().call("get_height", int(floor(target.x)), int(floor(target.z)))) + 1.0
	player().call("teleport", target)
	_note("Teleported to %.0f, %.0f, %.0f" % [target.x, target.y, target.z])
	close_self()

func _travel(pid: String) -> void:
	var st := _node("SpaceTravel")
	if st != null and st.has_method("travel_to"):
		close_self()
		st.call("travel_to", pid)
		return
	if Game != null:
		close_self()
		Game.change_planet(pid)

func _spawn(entity_id: String) -> void:
	var w := world()
	if w == null or not w.has_method("spawn_entity") or not _need_player():
		return
	var p: Node3D = player()
	var dir: Vector3 = p.call("aim_direction") if p.has_method("aim_direction") else Vector3.FORWARD
	dir.y = 0.0
	if dir.length() < 0.01:
		dir = Vector3.FORWARD
	var pos: Vector3 = p.global_position + dir.normalized() * 6.0 + Vector3(0, 0.5, 0)
	w.call("spawn_entity", entity_id, pos, {})
	_note("Spawned " + entity_id)

func _unlock_skills() -> void:
	if Registry == null:
		return
	var skills: Dictionary = Game.profile.get("skills", {})
	for sid in Registry.skills.keys():
		skills[String(sid)] = int(Registry.skill(String(sid)).get("max_level", 1))
	Game.profile["skills"] = skills
	Events.stats_changed.emit()
	_note("All skills maxed.")

func _unlock_techniques() -> void:
	if Registry == null:
		return
	var known: Array = Game.profile.get("techniques", [])
	for tid in Registry.techniques.keys():
		if not known.has(String(tid)):
			known.append(String(tid))
	Game.profile["techniques"] = known
	_note("All techniques learned.")

func _unlock_forms() -> void:
	if Registry == null:
		return
	var forms: Dictionary = Game.profile.get("forms", {})
	var unlocked: Array = forms.get("unlocked", [])
	for fid in _form_list():
		if not unlocked.has(String(fid)):
			unlocked.append(String(fid))
	forms["unlocked"] = unlocked
	Game.profile["forms"] = forms
	_note("All forms unlocked.")

func _unlock_planets() -> void:
	if Registry == null:
		return
	var list: Array = Game.profile.get("planets_unlocked", [])
	for pid in Registry.planets.keys():
		if not list.has(String(pid)):
			list.append(String(pid))
			Events.planet_unlocked.emit(String(pid))
	Game.profile["planets_unlocked"] = list
	_note("All planets unlocked.")

func _complete_tracked() -> void:
	var qm := _node("QuestManager")
	var qid := String(Game.profile.get("quests", {}).get("tracked", ""))
	if qid == "":
		var active: Dictionary = Game.profile.get("quests", {}).get("active", {})
		if not active.is_empty():
			qid = String(active.keys()[0])
	if qid == "":
		_note("No tracked quest.")
		return
	if qm != null and qm.has_method("complete"):
		qm.call("complete", qid)
	else:
		var q: Dictionary = Game.profile.get("quests", {})
		var completed: Array = q.get("completed", [])
		if not completed.has(qid):
			completed.append(qid)
		q["completed"] = completed
		(q.get("active", {}) as Dictionary).erase(qid)
		Events.quest_completed.emit(qid)
	_note("Completed " + qid)

func _start_quest(qid: String) -> void:
	var qm := _node("QuestManager")
	if qm != null and qm.has_method("start"):
		qm.call("start", qid)
	else:
		var q: Dictionary = Game.profile.get("quests", {})
		if not q.has("active"):
			q["active"] = {}
		var prog: Array = []
		for _o in Registry.quest(qid).get("objectives", []):
			prog.append(0)
		q["active"][qid] = {"objectives": prog, "spawned": []}
		q["tracked"] = qid
		Events.quest_started.emit(qid)
	_note("Started " + qid)
