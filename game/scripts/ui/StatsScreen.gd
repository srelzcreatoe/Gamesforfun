class_name StatsScreen
extends ScreenBase
## Xenoverse-style character sheet: Stats (TP spend) / Skills / Techniques / Forms tabs.

const STAT_KEYS := ["STR", "SKP", "STM", "RES", "VIT", "PWR", "ENE"]
const STAT_NAMES := {
	"STR": "Strength", "SKP": "Skill Power", "STM": "Stamina", "RES": "Resistance",
	"VIT": "Vitality", "PWR": "Ki Power", "ENE": "Energy",
}

var tab := 0
var page_box: VBoxContainer = null

func _init() -> void:
	screen_name = "stats"

func refresh() -> void:
	rebuild()

func build() -> void:
	tab = clampi(int(args.get("tab", tab)), 0, 3)
	var body := page("Character")
	var head := UiUtil.hbox(8.0 * s)
	var ch: Dictionary = Game.profile.get("character", {}) if Game != null else {}
	var preview := CharacterPreview.new(Vector2(110.0 * s, 150.0 * s))
	preview.set_character(ch)
	head.add_child(preview)
	var info := UiUtil.vbox(2.0 * s)
	info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	info.add_child(UiUtil.label(String(ch.get("name", "Warrior")), UiUtil.font_body(s), Color(1.0, 0.9, 0.5)))
	var race := String(ch.get("race", "saiyan"))
	if Registry != null:
		race = String(Registry.race(race).get("name", race.capitalize()))
	info.add_child(UiUtil.dim("%s · %s · Lv %d" % [race, String(ch.get("class", "warrior")).capitalize(), _level()], UiUtil.font_small(s)))
	info.add_child(UiUtil.dim("TP %d   (total %d)" % [_tp(), _tp_total()], UiUtil.font_small(s)))
	info.add_child(UiUtil.dim("Alignment %d" % int(Game.profile.get("alignment", 50)), UiUtil.font_small(s)))
	head.add_child(info)
	body.add_child(head)

	var tabs := UiUtil.hbox(6.0 * s)
	var names := ["Stats", "Skills", "Techniques", "Forms"]
	for i in names.size():
		var idx := i
		var b := UiUtil.flat_button(names[i], func() -> void:
			tab = idx
			rebuild(), false, 120.0 * s)
		if i == tab:
			b.modulate = Color(1.2, 1.2, 1.0)
		tabs.add_child(b)
	body.add_child(tabs)

	page_box = UiUtil.vbox(5.0 * s)
	var sc := UiUtil.scroll(page_box)
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(sc)
	match tab:
		0: _stats_page()
		1: _skills_page()
		2: _techniques_page()
		_: _forms_page()

func _stats() -> Variant:
	if Game != null and Game.player != null:
		return Game.player.get("stats")
	return null

func _level() -> int:
	var st: Variant = _stats()
	if st != null and st.has_method("level"):
		return int(st.call("level"))
	var total := 0
	for k in STAT_KEYS:
		total += int(Game.profile.get("stats", {}).get(k, 5))
	return 1 + total / 5

func _tp() -> int:
	var st: Variant = _stats()
	if st != null and st.get("tp") != null:
		return int(st.get("tp"))
	return int(Game.profile.get("tp", 0))

func _tp_total() -> int:
	var st: Variant = _stats()
	if st != null and st.get("tp_total") != null:
		return int(st.get("tp_total"))
	return int(Game.profile.get("tp_total", 0))

func _stat_value(k: String) -> int:
	var st: Variant = _stats()
	if st != null and st.has_method("stat"):
		return int(st.call("stat", k))
	return int(Game.profile.get("stats", {}).get(k, 5))

func _stats_page() -> void:
	var sheet := UiUtil.gui_tex("buttons/menubuttons")
	for i in STAT_KEYS.size():
		var k: String = STAT_KEYS[i]
		var row := UiUtil.hbox(8.0 * s)
		var icon := UiUtil.atlas(sheet, Rect2(0, 50 + (i % 6) * 21, 20, 20), 1.0)
		row.add_child(UiUtil.icon_rect(icon, Vector2(26.0 * s, 26.0 * s)))
		var l := UiUtil.label(String(STAT_NAMES[k]), UiUtil.font_small(s))
		l.custom_minimum_size.x = 170.0 * s
		row.add_child(l)
		var v := UiUtil.label(str(_stat_value(k)), UiUtil.font_body(s), Color(1.0, 0.95, 0.7), HORIZONTAL_ALIGNMENT_RIGHT)
		v.custom_minimum_size.x = 70.0 * s
		row.add_child(v)
		var bar := ProgressBar.new()
		bar.show_percentage = false
		bar.max_value = 200.0
		bar.value = float(_stat_value(k))
		bar.custom_minimum_size = Vector2(160.0 * s, 16.0 * s)
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar.add_theme_stylebox_override("background", UiUtil.flat(Color(0, 0, 0, 0.5), Color(0.3, 0.35, 0.45), 2.0, 0.0, 0.0))
		bar.add_theme_stylebox_override("fill", UiUtil.flat(Color(0.45, 0.72, 0.95), Color(0.6, 0.85, 1.0), 0.0, 0.0, 0.0))
		row.add_child(bar)
		var st: Variant = _stats()
		var cost := 0
		if st != null and st.has_method("tp_cost"):
			cost = int(st.call("tp_cost", k))
		var b := UiUtil.flat_button("+%d TP" % cost if cost > 0 else "+", func() -> void: _raise(k), false, 120.0 * s)
		b.disabled = st == null or not st.has_method("raise") or _tp() < cost
		row.add_child(b)
		page_box.add_child(row)
	page_box.add_child(UiUtil.spacer(8.0 * s))
	var st2: Variant = _stats()
	if st2 != null and st2.has_method("derived"):
		var lines := [
			"Max health  %d" % int(st2.call("derived", "max_health", 100.0)),
			"Max ki      %d" % int(st2.call("derived", "max_ki", 100.0)),
			"Max stamina %d" % int(st2.call("derived", "max_stamina", 100.0)),
			"Melee       %.1f" % float(st2.call("derived", "melee", 5.0)),
			"Ki damage   %.1f" % float(st2.call("derived", "ki_damage", 5.0)),
			"Defense     %.1f" % float(st2.call("derived", "defense", 0.0)),
		]
		for t in lines:
			page_box.add_child(UiUtil.dim(t, UiUtil.font_small(s)))

func _raise(k: String) -> void:
	var st: Variant = _stats()
	if st != null and st.has_method("raise") and bool(st.call("raise", k)):
		Audio.play_sfx("tp_gain", -6.0)
		rebuild()
	else:
		Game.ui.call("show_hint", "Not enough training points.", 2.0)

func _skills_page() -> void:
	var skills: Dictionary = Game.profile.get("skills", {}) if Game != null else {}
	var all: Array = Registry.skills.keys() if Registry != null else []
	if all.is_empty():
		page_box.add_child(UiUtil.dim("No skill data.", UiUtil.font_small(s)))
		return
	for id in all:
		var def: Dictionary = Registry.skill(String(id))
		var lvl := int(skills.get(String(id), 0))
		var maxl := int(def.get("max_level", 1))
		var row := UiUtil.hbox(8.0 * s)
		var l := UiUtil.label(String(def.get("name", id)), UiUtil.font_small(s),
			Color.WHITE if lvl > 0 else UiUtil.DIM_COLOR)
		l.custom_minimum_size.x = 200.0 * s
		row.add_child(l)
		row.add_child(UiUtil.dim("Lv %d/%d" % [lvl, maxl], UiUtil.font_small(s)))
		var costs: Array = def.get("tp_costs", [])
		var cost := int(costs[mini(lvl, costs.size() - 1)]) if costs.size() > 0 else -1
		var col := UiUtil.vbox(0.0)
		col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var d := UiUtil.dim(String(def.get("desc", "")), UiUtil.font_small(s))
		d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		col.add_child(d)
		row.add_child(col)
		if lvl < maxl and cost > 0:
			var b := UiUtil.flat_button("%d TP" % cost, func() -> void: _learn_skill(String(id), cost), false, 120.0 * s)
			b.disabled = _tp() < cost
			row.add_child(b)
		elif cost <= 0:
			row.add_child(UiUtil.dim("from a master", UiUtil.font_small(s)))
		page_box.add_child(row)

func _learn_skill(id: String, cost: int) -> void:
	var st: Variant = _stats()
	if st == null or int(st.get("tp")) < cost:
		Game.ui.call("show_hint", "Not enough training points.", 2.0)
		return
	st.set("tp", int(st.get("tp")) - cost)
	var skills: Dictionary = Game.profile.get("skills", {})
	skills[id] = int(skills.get(id, 0)) + 1
	Game.profile["skills"] = skills
	Events.skill_changed.emit(id, int(skills[id]))
	Events.tp_changed.emit(int(st.get("tp")), _tp_total())
	Audio.play_sfx("tp_gain", -6.0)
	rebuild()

func _techniques_page() -> void:
	var known: Array = Game.profile.get("techniques", []) if Game != null else []
	var all: Array = Registry.techniques.keys() if Registry != null else []
	if all.is_empty():
		page_box.add_child(UiUtil.dim("No technique data.", UiUtil.font_small(s)))
		return
	for id in all:
		var def: Dictionary = Registry.technique(String(id))
		var have := known.has(String(id))
		var row := UiUtil.hbox(8.0 * s)
		var col := Color(1.0, 0.95, 0.7) if have else UiUtil.DIM_COLOR
		var l := UiUtil.label(String(def.get("name", id)), UiUtil.font_small(s), col)
		l.custom_minimum_size.x = 210.0 * s
		row.add_child(l)
		row.add_child(UiUtil.dim("%s · ki %d%% · x%.1f" % [
			String(def.get("kind", "blast")), int(float(def.get("ki_cost", 0.0)) * 100.0),
			float(def.get("damage_mult", 1.0))], UiUtil.font_small(s)))
		var sp := Control.new()
		sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(sp)
		row.add_child(UiUtil.dim("known" if have else "locked", UiUtil.font_small(s)))
		page_box.add_child(row)

func _forms_page() -> void:
	var forms: Dictionary = Game.profile.get("forms", {}) if Game != null else {}
	var unlocked: Array = forms.get("unlocked", [])
	var mastery: Dictionary = forms.get("mastery", {})
	var current := String(forms.get("current", ""))
	var all: Array = Registry.forms.keys() if Registry != null else []
	var race := String(Game.profile.get("character", {}).get("race", "")) if Game != null else ""
	var shown := 0
	for id in all:
		var def: Dictionary = Registry.form(String(id))
		if race != "" and String(def.get("race", "")) != "" and String(def.get("race", "")) != race:
			continue
		shown += 1
		if shown > 40:
			break
		var have := unlocked.has(String(id))
		var row := UiUtil.hbox(8.0 * s)
		var l := UiUtil.label(String(def.get("name", id)).capitalize(), UiUtil.font_small(s),
			Color(1.0, 0.85, 0.35) if have else UiUtil.DIM_COLOR)
		l.custom_minimum_size.x = 210.0 * s
		row.add_child(l)
		row.add_child(UiUtil.dim("mastery %.0f%%" % float(mastery.get(String(id), 0.0)), UiUtil.font_small(s)))
		row.add_child(UiUtil.dim("str x%.1f" % float(def.get("strMultiplier", 1.0)), UiUtil.font_small(s)))
		var sp := Control.new()
		sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(sp)
		if have:
			var fid := String(id)
			row.add_child(UiUtil.flat_button("Revert" if current == fid else "Transform",
				func() -> void: _transform(fid), false, 140.0 * s))
		else:
			row.add_child(UiUtil.dim("locked", UiUtil.font_small(s)))
		page_box.add_child(row)
	if shown == 0:
		page_box.add_child(UiUtil.dim("No forms for this race yet.", UiUtil.font_small(s)))

func _transform(form_id: String) -> void:
	var forms_node: Node = null
	if Game != null and Game.world != null:
		forms_node = Game.world.get_node_or_null("Forms")
	if forms_node != null and forms_node.has_method("transform"):
		forms_node.call("transform", Game.player, form_id)
		close_self()
		return
	var f: Dictionary = Game.profile.get("forms", {})
	f["current"] = "" if String(f.get("current", "")) == form_id else form_id
	Game.profile["forms"] = f
	if Game.player != null:
		Game.player.set("current_form", String(f["current"]))
	Events.form_changed.emit(Game.player, String(f["current"]))
	rebuild()
