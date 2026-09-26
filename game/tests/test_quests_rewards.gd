extends TestCase
## Reward application against a fixture profile (no live player).

var profile: Dictionary = {}

func setup() -> void:
	profile = ProfileFactory.new_profile("Tester", "human", "male", "warrior")
	Game.profile = profile
	Game.world_info = {"slug": "qtest", "planet": "earth", "seed": 1, "difficulty": "normal"}

func teardown() -> void:
	Game.profile = {}
	Game.world_info = {}
	profile = {}

func test_tps_reward() -> void:
	var line := Rewards.apply({"type": "TPS", "amount": 2400}, profile, null)
	assert_eq(int(profile["tp"]), 2400, "tp granted")
	assert_eq(int(profile["tp_total"]), 2400, "tp_total tracked")
	assert_eq(line, "+2400 TP", "toast line")

func test_item_reward_into_profile_inventory() -> void:
	Rewards.apply({"type": "ITEM", "item": "broken_scouter", "count": 1}, profile, null)
	Rewards.apply({"type": "ITEM", "item": "senzu_bean", "count": 3}, profile, null)
	var counts := Requirements.item_counts(profile, null)
	assert_eq(int(counts.get("broken_scouter", 0)), 1, "item added")
	assert_eq(int(counts.get("senzu_bean", 0)), 5, "stacked onto the two starting senzu")

func test_item_reward_respects_stack_limit() -> void:
	Rewards.apply({"type": "ITEM", "item": "senzu_bean", "count": 40}, profile, null)
	var counts := Requirements.item_counts(profile, null)
	assert_eq(int(counts.get("senzu_bean", 0)), 42, "split over several slots")
	var slots: Array = profile["inventory"]["slots"]
	for s in slots:
		if s is Dictionary and String((s as Dictionary)["item"]) == "senzu_bean":
			assert_true(int((s as Dictionary)["count"]) <= int(Registry.item("senzu_bean").get("stack", 16)), "slot within the stack limit")

func test_skill_technique_form_rewards() -> void:
	Rewards.apply({"type": "SKILL", "skill": "fly", "level": 2}, profile, null)
	assert_eq(int(profile["skills"]["fly"]), 2, "skill level set")
	assert_eq(Rewards.apply({"type": "SKILL", "skill": "fly", "level": 1}, profile, null), "", "never lowers a skill")
	Rewards.apply({"type": "TECHNIQUE", "technique": "kamehameha"}, profile, null)
	assert_true((profile["techniques"] as Array).has("kamehameha"), "technique learned")
	var form := String(Registry.forms.keys()[0]) if Registry.forms.size() > 0 else "ssgrades.supersaiyan"
	Rewards.apply({"type": "FORM", "form": form}, profile, null)
	assert_true((profile["forms"]["unlocked"] as Array).has(form), "form unlocked")

func test_alignment_and_planet_rewards() -> void:
	Rewards.apply({"type": "ALIGNMENT", "amount": -20}, profile, null)
	assert_eq(int(profile["alignment"]), 30, "alignment shifted")
	Rewards.apply({"type": "ALIGNMENT", "amount": -100}, profile, null)
	assert_eq(int(profile["alignment"]), 0, "alignment clamped")
	var unlocked: Array = []
	Events.planet_unlocked.connect(func(p: String) -> void: unlocked.append(p), CONNECT_ONE_SHOT)
	Rewards.apply({"type": "UNLOCK_PLANET", "planet": "namek"}, profile, null)
	assert_true((profile["planets_unlocked"] as Array).has("namek"), "planet unlocked")
	assert_eq(unlocked.size(), 1, "planet_unlocked emitted")

func test_difficulty_filtered_rewards() -> void:
	Game.world_info["difficulty"] = "easy"
	var rewards: Array = [
		{"type": "TPS", "amount": 100},
		{"type": "TPS", "amount": 900, "difficulty": ["NORMAL", "HARD"]},
	]
	var lines := Rewards.apply_all(rewards, profile, null)
	assert_eq(int(profile["tp"]), 100, "hard-only reward skipped on easy")
	assert_eq(lines.size(), 1, "one line reported")
	Game.world_info["difficulty"] = "hard"
	Rewards.apply_all(rewards, profile, null)
	assert_eq(int(profile["tp"]), 1100, "both rewards pay out on hard")

func test_real_quest_rewards() -> void:
	var def := Registry.quest("saga_saiyan:1")
	var lines := Rewards.apply_all(def["rewards"], profile, null)
	assert_true(lines.size() >= 2, "Raditz pays TP and an item")
	assert_eq(int(profile["tp"]), 2400, "2400 TP from the quest")
	var counts := Requirements.item_counts(profile, null)
	assert_eq(int(counts.get("broken_scouter", 0)), 1, "broken scouter granted")
	assert_eq(int(counts.get("cooked_dino_meat", 0)), 4, "normal-difficulty bonus granted")
	assert_true(Rewards.describe_all(def["rewards"]).contains("2400 TP"), "describe_all text")

func test_every_quest_reward_type_is_known() -> void:
	var known := ["TPS", "ITEM", "SKILL", "TECHNIQUE", "FORM", "ALIGNMENT", "UNLOCK_PLANET"]
	var unknown: Array = []
	for qid in Registry.quests.keys():
		for r in Registry.quest(String(qid)).get("rewards", []):
			var t := String(r.get("type", ""))
			if not known.has(t) and not unknown.has(t):
				unknown.append(t)
	assert_eq(unknown.size(), 0, "unhandled reward types: %s" % str(unknown))

func test_every_objective_and_condition_type_is_known() -> void:
	var objectives := ["KILL", "TALK", "OBTAIN", "GO_TO", "INTERACT", "SUMMON", "SKILL", "TRAIN", "WAIT"]
	var conditions := ["LEVEL", "PLANET", "BIOME", "STRUCTURE", "SAGA_QUEST", "QUEST", "SKILL", "ITEM", "ALIGNMENT", "TIME"]
	var bad_obj: Array = []
	var bad_cond: Array = []
	for qid in Registry.quests.keys():
		var q := Registry.quest(String(qid))
		for o in q.get("objectives", []):
			var t := String(o.get("type", ""))
			if not objectives.has(t) and not bad_obj.has(t):
				bad_obj.append(t)
		for section in ["requirements", "prerequisites"]:
			for c in q.get(section, {}).get("conditions", []):
				var ct := String(c.get("type", ""))
				if not conditions.has(ct) and not bad_cond.has(ct):
					bad_cond.append(ct)
	assert_eq(bad_obj.size(), 0, "unhandled objective types: %s" % str(bad_obj))
	assert_eq(bad_cond.size(), 0, "unhandled condition types: %s" % str(bad_cond))
