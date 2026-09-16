extends TestCase
## Story & character registries produced by tools/convert_dmz_data.py:
## quests/**, sagas.json, entities.json, races.json, forms.json, skills.json,
## techniques.json, masters.json, wishes.json, audio.json.

const RACE_IDS := ["human", "saiyan", "namekian", "frostdemon", "majin", "bioandroid"]
const SAGA_IDS := ["saiyan_saga", "frieza_saga", "android_saga", "future_saga", "buu_saga", "movies_saga"]
const ENTITY_KINDS := ["player", "enemy", "master", "npc", "animal", "projectile", "pickup", "dragon", "vehicle", "dragon_ball"]

func _story_quests() -> Array:
	var out: Array = []
	for qid in Registry.quests:
		if String(Registry.quests[qid].get("type", "")) == "SAGA":
			out.append(Registry.quests[qid])
	return out

# --- quests -----------------------------------------------------------------

func test_every_dmz_quest_is_ported() -> void:
	assert_eq(Registry.quests.size(), 211, "121 story quests + 90 sidequests")
	assert_eq(_story_quests().size(), 121)

func test_quest_ids_are_category_prefixed() -> void:
	for qid in Registry.quests:
		var q: Dictionary = Registry.quests[qid]
		assert_true(qid.contains(":"), "quest id must be <category>:<id>, got " + qid)
		assert_eq(qid, "%s:%s" % [q.get("category", ""), str(q.get("id", ""))])

func test_quests_have_english_text() -> void:
	for qid in Registry.quests:
		var q: Dictionary = Registry.quests[qid]
		var name: String = q.get("name", "")
		assert_true(name != "", "quest %s has no name" % qid)
		assert_true(not name.begins_with("dmz."), "quest %s name is an unresolved lang key: %s" % [qid, name])
		assert_true(not String(q.get("desc", "")).begins_with("dmz."), "quest %s desc unresolved" % qid)

func test_quest_objectives_reference_known_data() -> void:
	for qid in Registry.quests:
		var q: Dictionary = Registry.quests[qid]
		for o in q.get("objectives", []):
			match String(o.get("type", "")):
				"KILL":
					assert_true(Registry.entities.has(o.get("entity", "")),
						"quest %s kills unknown entity %s" % [qid, o.get("entity", "")])
					assert_true(String(o.get("entity_name", "")) != "", "quest %s objective lacks entity_name" % qid)
				"TALK":
					assert_true(Registry.masters.has(o.get("npc", "")),
						"quest %s talks to unknown npc %s" % [qid, o.get("npc", "")])
				"SKILL":
					assert_true(Registry.skills.has(o.get("skill", "")),
						"quest %s objective unknown skill %s" % [qid, o.get("skill", "")])
		for r in q.get("rewards", []):
			if String(r.get("type", "")) == "SKILL":
				assert_true(Registry.skills.has(r.get("skill", "")),
					"quest %s rewards unknown skill %s" % [qid, r.get("skill", "")])

func test_quest_requirements_have_no_namespaces() -> void:
	for qid in Registry.quests:
		var q: Dictionary = Registry.quests[qid]
		var conds: Array = []
		conds.append_array(q.get("requirements", {}).get("conditions", []))
		conds.append_array(q.get("prerequisites", {}).get("conditions", []))
		for c in conds:
			match String(c.get("type", "")):
				"DIMENSION":
					assert_true(false, "quest %s still has a DIMENSION condition" % qid)
				"PLANET":
					var p: String = c.get("planet", "")
					assert_true(not p.contains(":"), "quest %s planet %s keeps a namespace" % [qid, p])
				"SKILL":
					assert_true(Registry.skills.has(c.get("skill", "")),
						"quest %s requires unknown skill %s" % [qid, c.get("skill", "")])
				"SAGA_QUEST", "QUEST":
					assert_true(Registry.quests.has(c.get("quest", "")),
						"quest %s references unknown quest %s" % [qid, c.get("quest", "")])

func test_quest_givers_are_masters() -> void:
	for qid in Registry.quests:
		var q: Dictionary = Registry.quests[qid]
		for key in ["quest_giver", "turn_in"]:
			if q.has(key):
				assert_true(Registry.masters.has(q[key]),
					"quest %s %s unknown master %s" % [qid, key, q[key]])

# --- sagas ------------------------------------------------------------------

func test_sagas_are_ordered_and_chained() -> void:
	assert_eq(Registry.sagas.size(), 6)
	var prev := ""
	for i in Registry.sagas.size():
		var s: Dictionary = Registry.sagas[i]
		assert_eq(String(s.get("id", "")), SAGA_IDS[i])
		assert_true(String(s.get("name", "")) != "", "saga %s has no name" % s.get("id", ""))
		if i > 0:
			assert_true(String(s.get("requirements", {}).get("previousSaga", "")) != "",
				"saga %s has no previousSaga" % s.get("id", ""))
		prev = String(s.get("id", ""))
	assert_true(prev == "movies_saga")

func test_saga_quest_lists_cover_every_story_quest() -> void:
	var listed := {}
	for s in Registry.sagas:
		for qid in s.get("quests", []):
			assert_true(Registry.quests.has(qid), "saga %s lists unknown quest %s" % [s.get("id", ""), qid])
			listed[qid] = true
	assert_eq(listed.size(), _story_quests().size(), "every story quest must be in exactly one saga")

# --- entities ---------------------------------------------------------------

func test_entities_are_complete_and_well_formed() -> void:
	assert_true(Registry.entities.size() >= 200, "expected 200+ entities, got %d" % Registry.entities.size())
	for eid in Registry.entities:
		var e: Dictionary = Registry.entities[eid]
		assert_true(ENTITY_KINDS.has(String(e.get("kind", ""))), "entity %s bad kind %s" % [eid, e.get("kind", "")])
		assert_true(String(e.get("scene", "")).begins_with("res://"), "entity %s has no scene" % eid)
		assert_true(String(e.get("name", "")) != "", "entity %s has no name" % eid)
		var hb: Array = e.get("hitbox", [])
		assert_eq(hb.size(), 2, "entity %s hitbox must be [w,h]" % eid)
		assert_true(float(hb[0]) > 0.0 and float(hb[1]) > 0.0, "entity %s hitbox must be positive" % eid)
		assert_true(float(e.get("scale", 0.0)) > 0.0, "entity %s scale must be positive" % eid)

func test_entity_models_and_textures_exist() -> void:
	for eid in Registry.entities:
		var e: Dictionary = Registry.entities[eid]
		var model: String = e.get("model", "")
		if model != "":
			assert_true(FileAccess.file_exists("res://assets/models/%s.geo.json" % model),
				"entity %s model missing: %s" % [eid, model])
		var tex: String = e.get("texture", "")
		if tex != "":
			assert_true(FileAccess.file_exists("res://assets/textures/entity/%s.png" % tex),
				"entity %s texture missing: %s" % [eid, tex])
		for a in e.get("animations", []):
			assert_true(FileAccess.file_exists("res://assets/animations/%s.animation.json" % a),
				"entity %s animation missing: %s" % [eid, a])

func test_entity_cross_references() -> void:
	for eid in Registry.entities:
		var e: Dictionary = Registry.entities[eid]
		for t in e.get("techniques", []):
			assert_true(Registry.techniques.has(t), "entity %s unknown technique %s" % [eid, t])
		for p in e.get("phases", []):
			assert_true(Registry.entities.has(p), "entity %s unknown phase %s" % [eid, p])
		if e.has("master"):
			assert_true(Registry.masters.has(e["master"]), "entity %s unknown master %s" % [eid, e["master"]])

func test_required_entities_exist() -> void:
	for eid in ["player", "ki_blast", "ki_beam", "ki_disc", "dragon_ball", "item_drop",
			"shenron", "porunga", "super_shenron", "toronbo", "zuno",
			"saga_raditz", "saga_frieza_first", "master_roshi", "spacepod", "punch_machine"]:
		assert_true(Registry.entities.has(eid), "missing entity " + eid)
	assert_eq(String(Registry.entity("player").get("kind", "")), "player")
	assert_true(Registry.entity("player").has("physics"), "player needs physics constants")

func test_boss_phase_chains() -> void:
	var frieza: Array = Registry.entity("saga_frieza_first").get("phases", [])
	assert_true(frieza.size() >= 3, "Frieza must transform through his forms")
	assert_eq(String(frieza[0]), "saga_frieza_second")
	assert_true(Registry.entity("saga_cell_imperfect").get("phases", []).size() >= 2)

# --- races / forms ----------------------------------------------------------

func test_races() -> void:
	assert_eq(Registry.races.size(), 6)
	for rid in RACE_IDS:
		var r: Dictionary = Registry.race(rid)
		assert_true(not r.is_empty(), "missing race " + rid)
		assert_true(String(r.get("name", "")) != "", "race %s has no name" % rid)
		assert_true(FileAccess.file_exists("res://assets/models/%s.geo.json" % r.get("model", "")),
			"race %s model missing: %s" % [rid, r.get("model", "")])
		assert_true(r.get("classes", {}).size() >= 5, "race %s needs classes" % rid)
		assert_eq(r.get("base_stats", {}).size(), 7, "race %s needs 7 base stats" % rid)
		assert_true(r.get("stat_multipliers", {}).size() > 0, "race %s needs multipliers" % rid)
		assert_true(r.get("form_groups", []).size() >= 3, "race %s needs form groups" % rid)
		assert_true(r.get("textures", {}).get("body", []).size() > 0, "race %s needs body textures" % rid)

func test_forms() -> void:
	assert_true(Registry.forms.size() >= 50, "expected 50+ forms, got %d" % Registry.forms.size())
	var groups := {}
	for fid in Registry.forms:
		var f: Dictionary = Registry.forms[fid]
		assert_true(fid.contains("."), "form id must be <group>.<form>, got " + fid)
		var name: String = f.get("name", "")
		assert_true(name != "" and name != String(f.get("dmz_name", "")),
			"form %s must carry an English name (got %s)" % [fid, name])
		assert_true(Registry.skills.has(f.get("skill", "")), "form %s unknown skill %s" % [fid, f.get("skill", "")])
		var race: String = f.get("race", "")
		assert_true(race == "any" or RACE_IDS.has(race), "form %s bad race %s" % [fid, race])
		assert_true(f.has("strMultiplier"), "form %s must keep the DMZ fields" % fid)
		var mo: String = f.get("model_override", "")
		if mo != "":
			assert_true(FileAccess.file_exists("res://assets/models/%s.geo.json" % mo),
				"form %s model_override missing: %s" % [fid, mo])
		var req: String = f.get("formRequisite", "")
		if req != "":
			assert_true(Registry.forms.has(req), "form %s requisite %s unknown" % [fid, req])
		groups[f.get("group", "")] = true
	assert_true(groups.has("kaioken") and groups.has("ultimate"))

# --- skills / techniques ----------------------------------------------------

func test_skills() -> void:
	assert_true(Registry.skills.size() >= 25, "expected 25+ skills")
	for sid in Registry.skills:
		var s: Dictionary = Registry.skills[sid]
		assert_true(String(s.get("name", "")) != "", "skill %s has no name" % sid)
		var costs: Array = s.get("tp_costs", [])
		assert_true(costs.size() > 0, "skill %s has no tp_costs" % sid)
		assert_eq(int(s.get("max_level", 0)), costs.size(), "skill %s max_level must match tp_costs" % sid)
		assert_true(s.get("effect", {}).size() > 0, "skill %s has no effect" % sid)
		var unlock: String = s.get("unlock", "")
		if unlock != "":
			assert_true(Registry.masters.has(unlock), "skill %s unlock master %s unknown" % [sid, unlock])
	for sid in ["fly", "ki_control", "ki_sense", "meditation", "kaioken", "instant_transmission", "potential_unlock"]:
		assert_true(Registry.skills.has(sid), "missing skill " + sid)

func test_techniques() -> void:
	assert_true(Registry.techniques.size() >= 25, "expected 25+ techniques")
	var anims := {}
	for f in ["movement", "combat", "ki", "transf", "skp"]:
		var d: Variant = JsonUtil.load_file("res://assets/animations/entity/races/%s.animation.json" % f)
		if d is Dictionary:
			for a in (d as Dictionary).get("animations", {}):
				anims[a] = true
	for tid in Registry.techniques:
		var t: Dictionary = Registry.techniques[tid]
		assert_true(String(t.get("name", "")) != "", "technique %s has no name" % tid)
		assert_true(["blast", "beam", "disc", "barrage", "explosion", "buff", "grab", "melee"].has(String(t.get("kind", ""))),
			"technique %s bad kind %s" % [tid, t.get("kind", "")])
		var ki: float = float(t.get("ki_cost", 0.0))
		assert_true(ki >= 0.0 and ki <= 0.6, "technique %s ki_cost out of range: %f" % [tid, ki])
		var dmg: float = float(t.get("damage_mult", 0.0))
		assert_true(dmg >= 0.0 and dmg <= 12.0, "technique %s damage_mult out of range: %f" % [tid, dmg])
		assert_true(String(t.get("color", "")).begins_with("#"), "technique %s needs a hex color" % tid)
		for key in ["cast_anim", "fire_anim"]:
			var a: String = t.get(key, "")
			if a != "":
				assert_true(anims.has(a), "technique %s %s unknown animation %s" % [tid, key, a])
		for key in ["charge_sound", "fire_sound"]:
			var snd: String = t.get(key, "")
			if snd != "":
				assert_true(FileAccess.file_exists("res://assets/audio/sfx/%s.ogg" % snd)
					or FileAccess.file_exists("res://assets/audio/sfx/%s.wav" % snd),
					"technique %s %s missing sfx %s" % [tid, key, snd])
		var unlock: String = t.get("unlock", "")
		if unlock != "":
			assert_true(Registry.masters.has(unlock), "technique %s unlock master %s unknown" % [tid, unlock])
	assert_true(Registry.techniques.has("ki_blast") and Registry.techniques.has("charged_ki_blast"))
	assert_true(Registry.techniques.has("kamehameha") and Registry.techniques.has("galick_gun"))

# --- masters ----------------------------------------------------------------

func test_masters() -> void:
	assert_true(Registry.masters.size() >= 21, "expected 21+ masters, got %d" % Registry.masters.size())
	for mid in Registry.masters:
		var m: Dictionary = Registry.masters[mid]
		assert_true(Registry.entities.has(m.get("entity", "")),
			"master %s unknown entity %s" % [mid, m.get("entity", "")])
		assert_true(String(m.get("name", "")) != "", "master %s has no name" % mid)
		assert_true(String(m.get("structure", "")) != "", "master %s has no structure" % mid)
		for t in m.get("teaches", []):
			assert_true(Registry.skills.has(t) or Registry.techniques.has(t),
				"master %s teaches unknown %s" % [mid, t])
		for qid in m.get("quests", []):
			assert_true(Registry.quests.has(qid), "master %s lists unknown quest %s" % [mid, qid])
		var dialog: Array = m.get("dialog", [])
		assert_true(dialog.size() >= 3 and dialog.size() <= 6,
			"master %s needs 3-6 dialog lines, has %d" % [mid, dialog.size()])

func test_every_skill_and_technique_has_a_teacher() -> void:
	var taught := {}
	for mid in Registry.masters:
		for t in Registry.masters[mid].get("teaches", []):
			taught[t] = true
	for tid in Registry.techniques:
		if String(Registry.techniques[tid].get("unlock", "")) != "":
			assert_true(taught.has(tid), "technique %s has an unlock master that does not teach it" % tid)

# --- wishes / audio ---------------------------------------------------------

func test_wishes() -> void:
	for dragon in ["shenron", "porunga", "super_shenron", "toronbo"]:
		var w: Dictionary = Registry.wishes.get(dragon, {})
		assert_true(not w.is_empty(), "missing wishes for " + dragon)
		assert_true(Registry.entities.has(w.get("entity", "")),
			"wishes %s unknown entity %s" % [dragon, w.get("entity", "")])
		assert_true(int(w.get("wish_count", 0)) >= 1, "%s needs wish_count" % dragon)
		assert_true(w.get("summon_planets", []).size() > 0, "%s needs summon_planets" % dragon)
		var list: Array = w.get("wishes", [])
		assert_true(list.size() > 0, "%s has no wishes" % dragon)
		for e in list:
			assert_true(String(e.get("name", "")) != "", "%s wish without a name" % dragon)
			assert_true(String(e.get("type", "")) != "", "%s wish without a type" % dragon)
			for p in e.get("summon_planets", []):
				assert_true(not String(p).contains(":"), "%s planet keeps a namespace" % dragon)

func test_audio() -> void:
	var sfx: Dictionary = Registry.audio.get("sfx", {})
	var bgm: Dictionary = Registry.audio.get("bgm", {})
	assert_true(sfx.size() >= 100, "expected 100+ logical sfx, got %d" % sfx.size())
	for key in ["punch", "punch_crit", "block", "ki_blast", "transform_on", "senzu", "shenron", "level_up",
			"quest_start", "quest_complete", "step_stone"]:
		assert_true(sfx.has(key) and (sfx[key] as Array).size() > 0, "sfx %s missing or empty" % key)
	for key in sfx:
		for f in sfx[key]:
			assert_true(FileAccess.file_exists("res://assets/audio/sfx/%s.ogg" % f)
				or FileAccess.file_exists("res://assets/audio/sfx/%s.wav" % f),
				"sfx %s references missing file %s" % [key, f])
	for ctx in ["menu", "explore_earth", "explore_namek", "battle", "boss", "transformation", "space",
			"otherworld", "heaven", "hell", "time_chamber"]:
		assert_true(bgm.has(ctx) and (bgm[ctx] as Array).size() > 0, "bgm context %s missing or empty" % ctx)
	for ctx in bgm:
		for f in bgm[ctx]:
			assert_true(FileAccess.file_exists("res://assets/audio/bgm/%s.ogg" % f)
				or FileAccess.file_exists("res://assets/audio/bgm/%s.wav" % f),
				"bgm %s references missing file %s" % [ctx, f])
