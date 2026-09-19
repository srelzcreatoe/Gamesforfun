extends TestCase
## Objective progress, quest spawning, failure/restart and claiming.

const FakeWorld := preload("res://tests/QuestTestWorld.gd")

var world: Node3D = null
var qm: QuestManager = null
var player: Node3D = null

func setup() -> void:
	Game.profile = ProfileFactory.new_profile("Tester", "saiyan", "male", "warrior")
	Game.world_info = {"slug": "qtest", "planet": "earth", "seed": 12345, "difficulty": "normal"}
	Game.paused_by_ui = false
	world = FakeWorld.new()
	add_node(world)
	Game.world = world
	player = FakeWorld.FakeEntity.new()
	player.entity_type = "player"
	world.add_child(player)
	player.global_position = Vector3(8, 64, 8)
	Game.player = player
	QuestBoot.install(world)
	qm = QuestManager.of(world)
	qm._normalise_state()

func teardown() -> void:
	qm = null
	player = null
	if world != null and is_instance_valid(world):
		world.free()
	world = null
	Game.world = null
	Game.player = null
	Game.profile = {}
	Game.world_info = {}

func _pump(times := 3) -> void:
	for i in times:
		qm._process(0.05)

func _prog(qid: String) -> Array:
	return qm.progress(qid)

# --- KILL with spawn: QUEST ------------------------------------------------

func test_quest_spawn_uses_overrides_and_completes() -> void:
	assert_true(qm.start("saga_saiyan:1", true), "force start Defeat Raditz")
	assert_true(qm.active().has("saga_saiyan:1"), "quest active")
	_pump()
	assert_eq(world.spawned.size(), 1, "one quest enemy spawned")
	var raditz: Node3D = world.spawned[0]
	assert_eq(raditz.entity_type, "saga_raditz", "Raditz spawned")
	var d: float = Vector2(raditz.global_position.x - player.global_position.x,
		raditz.global_position.z - player.global_position.z).length()
	assert_true(d >= 11.5 and d <= 21.0, "spawned 12-20 m away (got %.1f)" % d)
	var ov: Dictionary = raditz.spawn_data.get("stats_override", {})
	assert_near(float(ov.get("health", 0.0)), 450.0, 0.01, "health override from the quest")
	assert_near(float(ov.get("melee", 0.0)), 22.0, 0.01, "melee override")
	assert_near(float(ov.get("ki", 0.0)), 39.0, 0.01, "ki override")
	assert_eq(raditz.ai_tier, 1, "AITier passed through")
	assert_eq(raditz.target, player, "targets the player")
	# killing it completes the quest
	Events.entity_died.emit(raditz, player)
	assert_true(not qm.active().has("saga_saiyan:1"), "quest left the active list")
	assert_true(qm.completed().has("saga_saiyan:1"), "quest completed")

func test_quest_spawned_only_ignores_unrelated_kills() -> void:
	qm.start("saga_saiyan:1", true)
	_pump()
	var other := FakeWorld.FakeEntity.new()
	other.entity_type = "saga_raditz"
	world.add_child(other)
	Events.entity_died.emit(other, player)
	assert_eq(int(_prog("saga_saiyan:1")[0]), 0, "a Raditz we did not spawn does not count")
	other.free()

func test_kill_respawns_when_the_enemy_is_removed() -> void:
	qm.start("saga_saiyan:1", true)
	_pump()
	var first: Node3D = world.spawned[0]
	first.free()
	qm._sync_objectives("saga_saiyan:1", false)
	_pump(30)
	assert_eq(world.spawned.size(), 2, "a new quest enemy is spawned after the old one vanished")

# --- NATURAL kills ---------------------------------------------------------

func test_natural_kills_count_from_world_deaths() -> void:
	qm.start("sidequest_combat:monster_hunter", true)
	for i in 3:
		var e := FakeWorld.FakeEntity.new()
		e.entity_type = "bandit"
		world.add_child(e)
		Events.entity_died.emit(e, player)
		e.free()
	assert_eq(int(_prog("sidequest_combat:monster_hunter")[0]), 3, "three bandits counted")
	var far := FakeWorld.FakeEntity.new()
	far.entity_type = "bandit"
	world.add_child(far)
	Events.entity_died.emit(far, null)
	far.free()
	assert_eq(int(_prog("sidequest_combat:monster_hunter")[0]), 3, "kills without a killer do not count")

func test_parallel_objectives_progress_together() -> void:
	qm.start("sidequest_combat:monster_hunter", true)
	var def := Registry.quest("sidequest_combat:monster_hunter")
	assert_true(bool(def["parallel_objectives"]), "fixture is a parallel quest")
	var e := FakeWorld.FakeEntity.new()
	e.entity_type = "robot1"
	world.add_child(e)
	Events.entity_died.emit(e, player)
	e.free()
	assert_eq(int(_prog("sidequest_combat:monster_hunter")[2]), 1, "third objective progresses directly")

func test_sequential_objectives_gate_progress() -> void:
	qm.start("sidequest_training:krillin_sparring", true)
	var qid := "sidequest_training:krillin_sparring"
	var e := FakeWorld.FakeEntity.new()
	e.entity_type = "red_ribbon_soldier"
	world.add_child(e)
	Events.entity_died.emit(e, player)
	e.free()
	assert_eq(int(_prog(qid)[1]), 0, "the second objective waits for the first")
	for i in 10:
		var b := FakeWorld.FakeEntity.new()
		b.entity_type = "bandit"
		world.add_child(b)
		Events.entity_died.emit(b, player)
		b.free()
	assert_eq(int(_prog(qid)[0]), 10, "first objective done")
	var s := FakeWorld.FakeEntity.new()
	s.entity_type = "red_ribbon_soldier"
	world.add_child(s)
	Events.entity_died.emit(s, player)
	s.free()
	assert_eq(int(_prog(qid)[1]), 1, "second objective opens after the first")

# --- other objective kinds -------------------------------------------------

func test_obtain_counts_inventory() -> void:
	var qid := "sidequest_collection:chi_chi_provisions"
	qm.start(qid, true)
	Rewards.give_to_profile(Game.profile, "cooked_beef", 32)
	Rewards.give_to_profile(Game.profile, "bread", 10)
	qm.notify_item("cooked_beef", 32)
	assert_eq(int(_prog(qid)[0]), 32, "first OBTAIN satisfied")
	assert_eq(int(_prog(qid)[1]), 10, "second OBTAIN partial")

func test_talk_objective_via_dialog_closed() -> void:
	var qid := "sidequest_collection:bulma_namek_research"
	qm.start(qid, true)
	var objs: Array = Registry.quest(qid)["objectives"]
	var talk_index := objs.size() - 1
	Rewards.give_to_profile(Game.profile, "kikono_shard", 16)
	Rewards.give_to_profile(Game.profile, "kikono_cloth", 8)
	qm._refresh_obtain()
	qm.notify_talk("bulma")
	assert_eq(int(_prog(qid)[talk_index]), 1, "talking to Bulma finishes the quest chain")

func test_go_to_planet_objective() -> void:
	(Game.profile["quests"]["completed"] as Array).append("saga_saiyan:7")
	qm.start("saga_saiyan:8", true)
	qm.notify_location(Vector3.ZERO, "", "namek")
	assert_true(qm.completed().has("saga_saiyan:8"), "arriving on Namek completes 'Head to Namek'")

func test_go_to_biome_objective() -> void:
	var qid := "sidequest_exploration:world_explorer"
	qm.start(qid, true)
	world.default_biome = "desert"
	qm._poll_location()
	assert_eq(int(_prog(qid)[1]), 1, "desert objective ticked")
	world.default_biome = "forest"
	qm._poll_location()
	assert_eq(int(_prog(qid)[2]), 1, "forest objective ticked")

func test_summon_and_skill_objectives() -> void:
	var qid := ""
	for id in Registry.quests.keys():
		for o in Registry.quest(String(id)).get("objectives", []):
			if String(o.get("type", "")) == "SUMMON":
				qid = String(id)
				break
		if qid != "":
			break
	assert_true(qid != "", "a SUMMON quest exists in the data")
	qm.start(qid, true)
	var objs: Array = Registry.quest(qid)["objectives"]
	for i in objs.size():
		if String(objs[i].get("type", "")) == "SUMMON":
			Events.dragon_summoned.emit(String(objs[i].get("dragon", "shenron")))
			assert_eq(int(_prog(qid)[i]), 1, "summon counted")
			break
	qm.notify_skill("fly", 1)          # no crash without a matching objective

func test_wait_and_time_gate() -> void:
	(Game.profile["quests"]["completed"] as Array).append("saga_saiyan:6")
	qm.start("saga_saiyan:7", true)
	var qid := "saga_saiyan:7"
	# finish every objective, the TIME requirement still holds the quest open
	var objs: Array = Registry.quest(qid)["objectives"]
	for i in objs.size():
		qm._set_progress(qid, i, Objectives.required(objs[i]))
	assert_true(qm.active().has(qid), "TIME requirement keeps the quest open")
	(qm.active()[qid] as Dictionary)["elapsed"] = 301.0
	qm._check_complete(qid)
	assert_true(qm.completed().has(qid), "quest completes once the timer elapsed")

# --- failure / claim / tracking -------------------------------------------

func test_player_death_restarts_a_kill_quest() -> void:
	qm.start("sidequest_combat:monster_hunter", true)
	var e := FakeWorld.FakeEntity.new()
	e.entity_type = "bandit"
	world.add_child(e)
	Events.entity_died.emit(e, player)
	e.free()
	assert_eq(int(_prog("sidequest_combat:monster_hunter")[0]), 1, "one kill counted")
	var failed: Array = []
	Events.quest_failed.connect(func(q: String) -> void: failed.append(q), CONNECT_ONE_SHOT)
	Events.player_died.emit(null)
	assert_eq(failed.size(), 1, "quest_failed emitted")
	assert_eq(int(_prog("sidequest_combat:monster_hunter")[0]), 0, "progress reset")
	assert_true(qm.active().has("sidequest_combat:monster_hunter"), "quest restarts instead of ending")

func test_claim_applies_rewards_once() -> void:
	qm.start("saga_saiyan:1", true)
	_pump()
	Events.entity_died.emit(world.spawned[0], player)
	assert_eq(qm.quest_state("saga_saiyan:1"), "complete", "complete before claiming")
	var tp_before := int(Game.profile.get("tp", 0))
	assert_true(qm.claim("saga_saiyan:1"), "claim succeeds")
	assert_eq(qm.quest_state("saga_saiyan:1"), "claimed", "claimed state")
	assert_true(int(Game.profile.get("tp", 0)) > tp_before, "TPS reward granted")
	assert_true(not qm.claim("saga_saiyan:1"), "claiming twice does nothing")

func test_track_and_abandon() -> void:
	qm.start("saga_saiyan:1", true)
	assert_eq(qm.tracked_quest(), "saga_saiyan:1", "starting tracks the quest")
	_pump()
	assert_eq(world.spawned.size(), 1, "enemy spawned")
	qm.abandon("saga_saiyan:1")
	assert_true(not qm.active().has("saga_saiyan:1"), "quest abandoned")
	assert_eq(qm.tracked_quest(), "", "tracker cleared")

func test_quests_for_npc_and_turn_in() -> void:
	var lists := qm.quests_for_npc("roshi")
	assert_true((lists["gives"] as Array).size() > 0, "Roshi offers quests")
	var qid := String((lists["gives"] as Array)[0])
	qm.start(qid, true)
	var objs: Array = Registry.quest(qid)["objectives"]
	for i in objs.size():
		qm._set_progress(qid, i, Objectives.required(objs[i]))
	assert_true(qm.completed().has(qid), "quest complete")
	assert_eq(int(qm.turn_in_all("roshi")), 1, "turned in at the master")
	assert_true(qm.claimed().has(qid), "claimed through the NPC")
