extends TestCase
## Saga chain order, unlocking and the "next story quest" pointer.

const FakeWorld := preload("res://tests/QuestTestWorld.gd")

var world: Node3D = null
var saga: SagaManager = null

func setup() -> void:
	Game.profile = ProfileFactory.new_profile("Tester", "saiyan", "male", "warrior")
	Game.world_info = {"slug": "qtest", "planet": "earth", "seed": 1, "difficulty": "normal"}
	world = FakeWorld.new()
	add_node(world)
	Game.world = world
	QuestBoot.install(world)
	saga = SagaManager.of(world)

func teardown() -> void:
	saga = null
	if world != null and is_instance_valid(world):
		world.free()
	world = null
	Game.world = null
	Game.profile = {}
	Game.world_info = {}

func _finish_saga(saga_id: String) -> void:
	var done: Array = Game.profile["quests"]["completed"]
	for qid in saga.quests_of(saga_id):
		if not done.has(String(qid)):
			done.append(String(qid))

func test_saga_order_from_data() -> void:
	var ids := saga.saga_ids()
	assert_eq(ids[0], "saiyan_saga", "saiyan saga first")
	assert_eq(saga.previous_saga("frieza_saga"), "saiyan_saga", "frieza follows saiyan")
	assert_eq(saga.previous_saga("android_saga"), "frieza_saga", "android follows frieza")
	assert_eq(saga.previous_saga("future_saga"), "android_saga", "future follows android")
	assert_eq(saga.previous_saga("buu_saga"), "android_saga", "buu follows android")
	assert_eq(saga.previous_saga("movies_saga"), "buu_saga", "movies follows buu")

func test_unlock_chain() -> void:
	assert_true(saga.is_unlocked("saiyan_saga"), "first saga open")
	assert_true(not saga.is_unlocked("frieza_saga"), "frieza locked")
	_finish_saga("saiyan_saga")
	assert_true(saga.is_saga_completed("saiyan_saga"), "saiyan complete")
	assert_true(saga.is_unlocked("frieza_saga"), "frieza unlocked")
	assert_true(not saga.is_unlocked("android_saga"), "android still locked")
	_finish_saga("frieza_saga")
	assert_true(saga.is_unlocked("android_saga"), "android unlocked")
	_finish_saga("android_saga")
	assert_true(saga.is_unlocked("future_saga"), "future unlocked by android")
	assert_true(saga.is_unlocked("buu_saga"), "buu unlocked by android")
	assert_true(not saga.is_unlocked("movies_saga"), "movies waits for buu")
	_finish_saga("buu_saga")
	assert_true(saga.is_unlocked("movies_saga"), "movies unlocked")
	var unlocked := saga.unlocked_sagas()
	assert_eq(unlocked.size(), 6, "every saga unlocked at the end of the chain")

func test_next_story_quest_walks_the_chain() -> void:
	assert_eq(saga.next_story_quest(), "saga_saiyan:1", "starts at Defeat Raditz")
	(Game.profile["quests"]["completed"] as Array).append("saga_saiyan:1")
	assert_eq(saga.next_story_quest(), "saga_saiyan:2", "next quest in the saga")
	_finish_saga("saiyan_saga")
	assert_eq(saga.next_story_quest(), "saga_frieza:1", "rolls into the next saga")
	assert_eq(saga.current_saga(), "frieza_saga", "current saga follows")

func test_saga_of_quest() -> void:
	assert_eq(saga.saga_of("saga_buu:3"), "buu_saga", "quest -> saga")
	assert_eq(saga.saga_of("sidequest_training:roshi_basic_training"), "", "sidequests have no saga")

func test_saga_progress_counts() -> void:
	var p := saga.saga_progress("saiyan_saga")
	assert_eq(int(p["total"]), 8, "saiyan saga has 8 quests")
	assert_eq(int(p["done"]), 0, "nothing done")
	(Game.profile["quests"]["claimed"] as Array).append("saga_saiyan:1")
	assert_eq(int(saga.saga_progress("saiyan_saga")["done"]), 1, "claimed counts as done")

func test_saga_completed_signal_fires_once() -> void:
	var completed: Array = []
	Events.saga_completed.connect(func(sid: String) -> void: completed.append(sid))
	_finish_saga("saiyan_saga")
	saga.on_quest_finished("saga_saiyan:8")
	saga.on_quest_finished("saga_saiyan:8")
	assert_eq(completed.size(), 1, "saga_completed emitted exactly once")
	assert_eq(String(completed[0]), "saiyan_saga", "the finished saga")
	Events.saga_completed.disconnect(Events.saga_completed.get_connections()[0]["callable"])

func test_auto_track_points_at_the_story() -> void:
	saga.auto_track()
	assert_eq(String(Game.profile["quests"]["tracked"]), "saga_saiyan:1", "tracks the first story quest")
	var qm := QuestManager.of(world)
	qm._normalise_state()
	qm.start("sidequest_training:roshi_basic_training", true)
	saga.auto_track()
	assert_eq(String(Game.profile["quests"]["tracked"]), "sidequest_training:roshi_basic_training",
		"an active quest keeps the tracker")

func test_boss_bgm_switch() -> void:
	var enemy := FakeWorld.FakeEntity.new()
	world.add_child(enemy)
	Events.boss_engaged.emit(enemy)
	assert_true(saga._boss_bgm, "boss music latched")
	Events.boss_defeated.emit(enemy)
	assert_true(not saga._boss_bgm, "back to exploring")
	assert_eq(saga.explore_context(), "explore_earth", "earth playlist from planets.json")
	enemy.free()
