extends TestCase
## Requirement / prerequisite evaluation against fixture profiles (docs/ARCHITECTURE.md §9).

const FakeWorld := preload("res://tests/QuestTestWorld.gd")

var world: Node3D = null

func setup() -> void:
	Game.profile = ProfileFactory.new_profile("Tester", "saiyan", "male", "warrior")
	Game.world_info = {"slug": "qtest", "planet": "earth", "seed": 12345, "difficulty": "normal"}
	world = FakeWorld.new()
	add_node(world)
	Game.world = world

func teardown() -> void:
	if world != null and is_instance_valid(world):
		world.free()
	world = null
	Game.world = null
	Game.player = null
	Game.profile = {}
	Game.world_info = {}

func _ctx() -> Dictionary:
	return Requirements.build_context(Game.profile, null, world)

func _cond(c: Dictionary) -> bool:
	return bool(Requirements.evaluate_condition(c, _ctx())["ok"])

# --- single conditions -----------------------------------------------------

func test_level_from_profile_stats() -> void:
	# ProfileFactory gives a saiyan 5 in every stat -> level 1 + 35/5 = 8
	assert_eq(Requirements.profile_level(Game.profile), 8, "level from stat total")
	assert_true(_cond({"type": "LEVEL", "minLevel": 8}), "level 8 satisfied")
	assert_true(not _cond({"type": "LEVEL", "minLevel": 9}), "level 9 not satisfied")
	var r := Requirements.evaluate_condition({"type": "LEVEL", "minLevel": 40}, _ctx())
	assert_eq(String(r["reason"]), "Requires level 40", "reason text")

func test_planet_and_biome() -> void:
	assert_true(_cond({"type": "PLANET", "planet": "earth"}), "on earth")
	assert_true(not _cond({"type": "PLANET", "planet": "namek"}), "not on namek")
	assert_true(_cond({"type": "BIOME", "biome": "minecraft:plains"}), "plains quest_tag")
	assert_true(not _cond({"type": "BIOME", "biome": "minecraft:desert"}), "not desert")
	world.default_biome = "desert"
	assert_true(_cond({"type": "BIOME", "biome": "minecraft:desert"}), "desert after move")

func test_structure_marks() -> void:
	assert_true(not _cond({"type": "STRUCTURE", "structure": "dragonminez:roshi_house"}), "no structure yet")
	world.add_structure(0, 0, "roshi_house", Vector3(4, 64, 4))
	var ctx := _ctx()
	assert_true((ctx["structures"] as PackedStringArray).has("dragonminez:roshi_house"), "quest_tag resolved from structures.json")
	assert_true(bool(Requirements.evaluate_condition({"type": "STRUCTURE", "structure": "dragonminez:roshi_house"}, ctx)["ok"]), "structure in range")

func test_structure_out_of_range() -> void:
	world.add_structure(0, 0, "roshi_house", Vector3(900, 64, 900))
	var ctx := _ctx()
	assert_true(not (ctx["structures"] as PackedStringArray).has("dragonminez:roshi_house"), "far marks ignored")

func test_saga_quest_and_quest_conditions() -> void:
	var c := {"type": "SAGA_QUEST", "sagaId": "saiyan_saga", "questId": "1", "quest": "saga_saiyan:1"}
	assert_true(not _cond(c), "quest 1 not done")
	(Game.profile["quests"]["completed"] as Array).append("saga_saiyan:1")
	assert_true(_cond(c), "quest 1 done")
	assert_true(not _cond({"type": "QUEST", "quest": "sidequest_tech:bulma_radar_fusion"}), "other quest not done")

func test_skill_item_alignment() -> void:
	assert_true(_cond({"type": "SKILL", "skill": "ki_control", "minLevel": 1}), "ki_control 1")
	assert_true(not _cond({"type": "SKILL", "skill": "fly", "minLevel": 1}), "fly not learned")
	assert_true(_cond({"type": "ITEM", "item": "senzu_bean", "count": 2}), "two senzu in the fixture")
	assert_true(not _cond({"type": "ITEM", "item": "senzu_bean", "count": 3}), "not three senzu")
	assert_true(_cond({"type": "ALIGNMENT", "min": 0, "max": 100}), "alignment inside window")
	assert_true(not _cond({"type": "ALIGNMENT", "min": 90, "max": 100}), "alignment outside window")

func test_operators() -> void:
	var ctx := _ctx()
	var group_and := {"operator": "AND", "conditions": [
		{"type": "PLANET", "planet": "earth"}, {"type": "LEVEL", "minLevel": 99}]}
	assert_true(not bool(Requirements.evaluate(group_and, ctx)["ok"]), "AND fails on one")
	var group_or := {"operator": "OR", "conditions": [
		{"type": "PLANET", "planet": "namek"}, {"type": "LEVEL", "minLevel": 1}]}
	assert_true(bool(Requirements.evaluate(group_or, ctx)["ok"]), "OR passes on one")
	assert_true(bool(Requirements.evaluate({"operator": "AND", "conditions": []}, ctx)["ok"]), "empty group passes")
	var reasons: PackedStringArray = Requirements.evaluate(group_and, ctx)["reasons"]
	assert_eq(reasons.size(), 1, "one reason reported")

func test_time_gate_is_read_not_blocking() -> void:
	var q := Registry.quest("saga_saiyan:7")
	assert_true(not q.is_empty(), "quest 7 exists")
	assert_near(Requirements.time_gate(q["requirements"]), 300.0, 0.01, "TIME seconds")
	assert_true(_cond({"type": "TIME", "mode": "REAL_TIME", "seconds": 300}), "TIME never blocks starting")

# --- whole quests through the QuestManager ---------------------------------

func _manager() -> QuestManager:
	QuestBoot.install(world)
	var qm := QuestManager.of(world)
	qm._normalise_state()
	return qm

func test_can_start_real_quest() -> void:
	var qm := _manager()
	var r := qm.can_start("saga_saiyan:1")
	assert_true(bool(r["ok"]), "Defeat Raditz is startable on earth/plains at level 8: %s" % str(r["reasons"]))
	var r2 := qm.can_start("saga_saiyan:2")
	assert_true(not bool(r2["ok"]), "quest 2 needs quest 1 and level 8+")
	(Game.profile["quests"]["completed"] as Array).append("saga_saiyan:1")
	assert_true(bool(qm.can_start("saga_saiyan:2")["ok"]), "quest 2 unlocked after quest 1")

func test_can_start_reports_biome_reason() -> void:
	var qm := _manager()
	world.default_biome = "desert"
	var r := qm.can_start("saga_saiyan:1")
	assert_true(not bool(r["ok"]), "wrong biome blocks the quest")
	var reasons: PackedStringArray = r["reasons"]
	assert_true(reasons.size() > 0 and String(reasons[0]).contains("Plains"), "reason names the biome: %s" % str(reasons))

func test_available_quests_and_state() -> void:
	var qm := _manager()
	var avail := qm.available_quests()
	assert_true(avail.has("saga_saiyan:1"), "saga start is available")
	assert_eq(qm.quest_state("saga_saiyan:1"), "available", "state available")
	assert_eq(qm.quest_state("saga_saiyan:2"), "locked", "state locked")
	assert_eq(qm.quest_state("nope:0"), "locked", "unknown quest is locked")

func test_resolve_id_forms() -> void:
	var qm := _manager()
	assert_eq(qm.resolve_id("saga_saiyan:1"), "saga_saiyan:1", "registry id")
	assert_eq(qm.resolve_id("saiyan_saga:1"), "saga_saiyan:1", "saga id + number")
	assert_eq(qm.resolve_id("roshi_basic_training"), "sidequest_training:roshi_basic_training", "bare id")
	assert_eq(qm.resolve_id("not_a_quest"), "", "unknown")
