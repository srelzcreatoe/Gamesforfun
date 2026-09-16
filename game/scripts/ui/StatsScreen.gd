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
var _fallback: Object = null

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

## The RPG stats object (scripts/combat/Stats.gd) held by the player, or a profile-backed one.
func _stats() -> Object:
	if Game != null and Game.player != null:
		var st: Variant = Game.player.get("stats")
		if st is Object and st != null:
			return st
	if _fallback == null and ResourceLoader.exists("res://scripts/combat/Stats.gd"):
		var sc: GDScript = load("res://scripts/combat/Stats.gd")
		if sc != null:
			_fallback = sc.new()
			if _fallback.has_method("from_profile") and Game != null:
				_fallback.call("from_profile", Game.profile)
	return _fallback

func _level() -> int:
	var st := _stats()
	if st != null and st.has_method("level"):
		return int(st.call("level"))
	var total := 0
	for k in STAT_KEYS:
		total += int(Game.profile.get("stats", {}).get(k, 5))
	return 1 + total / 5

func _tp() -> int:
	if Game != null and Game.player != null:
		return Training.tp(Game.player)
	return int(Game.profile.get("tp", 0)) if Game != null else 0

func _tp_total() -> int:
	return int(Game.profile.get("tp_total", 0)) if Game != null else 0

func _stat_value(k: String) -> int:
	var st := _stats()
	if st != null and st.has_method("raw"):
		return int(st.call("raw", k))
	return int(Game.profile.get("stats", {}).get(k, 5))

func _stat_cost(k: String) -> int:
	var st := _stats()
	if st != null and st.has_method("next_cost"):
		var mult := 1.0
		if st.has_method("tp_cost_mult"):
			mult = float(st.call("tp_cost_mult"))
		return int(round(float(st.call("next_cost", k)) * mult))
	return 10 + _stat_value(k) * 5

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
		var cost := _stat_cost(k)
		var b := UiUtil.flat_button("+%d TP" % cost, func() -> void: _raise(k), false, 130.0 * s)
		b.disabled = _tp() < cost
		row.add_child(b)
		page_box.add_child(row)
	page_box.add_child(UiUtil.spacer(8.0 * s))
	var st2 := _stats()
	if st2 != null:
		for pair in [["Max health", "max_health"], ["Max ki", "max_ki"], ["Max stamina", "max_stamina"],
				["Melee", "melee"], ["Ki damage", "ki_damage"], ["Defense", "defense"],
				["Crit chance", "crit_chance"], ["Battle power", "battle_power"]]:
			if st2.has_method(String(pair[1])):
				page_box.add_child(UiUtil.dim("%-14s %.1f" % [String(pair[0]), float(st2.call(String(pair[1])))],
					UiUtil.font_small(s)))

func _raise(k: String) -> void:
	var p: Node = Game.player if Game != null else null
	var ok := false
	if p != null and p.has_method("raise_stat"):
		ok = bool(p.call("raise_stat", k))
	elif p != null:
		ok = Training.raise_stat(p, k, 1)
	else:
		ok = _raise_on_profile(k)
	if ok:
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

## No player node (menu preview / character sheet before spawning): spend straight in the profile.
func _raise_on_profile(k: String) -> bool:
	var st := _stats()
	if st == null or Game == null:
		return false
	var cost := _stat_cost(k)
	if int(Game.profile.get("tp", 0)) < cost:
		return false
	Game.profile["tp"] = int(Game.profile.get("tp", 0)) - cost
	st.call("raise", k, 1)
	if st.has_method("to_profile"):
		st.call("to_profile", Game.profile)
	Events.stats_changed.emit()
	Events.tp_changed.emit(int(Game.profile.get("tp", 0)), _tp_total())
	return true

func _learn_skill(id: String, cost: int) -> void:
	var p: Node = Game.player if Game != null else null
	if p != null and Training.upgrade_skill(p, id):
		Audio.play_sfx("tp_gain", -6.0)
		rebuild()
		return
	Game.ui.call("show_hint", "Not enough training points.", 2.0)

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
	if Game != null and Game.player != null:
		current = Forms.current(Game.player)
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
	var p: Node = Game.player if Game != null else null
	if p == null:
		Game.ui.call("show_hint", "Not in a world.", 1.5)
		return
	if Forms.current(p) == form_id:
		Forms.revert(p)
		rebuild()
		return
	var check := Forms.can_transform(p, form_id)
	if not bool(check.get("ok", false)):
		var reasons: Array = check.get("reasons", [])
		Game.ui.call("show_hint", String(reasons[0]) if reasons.size() > 0 else "You cannot transform yet.", 2.5)
		return
	Forms.transform(p, form_id)
	close_self()
