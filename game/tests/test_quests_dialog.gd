extends TestCase
## DialogController: master resolution, quest give/turn-in and paying TP for a
## master's `teaches` list.

const FakeWorld := preload("res://tests/QuestTestWorld.gd")

var world: Node3D = null
var dialog: DialogController = null
var qm: QuestManager = null

func setup() -> void:
	Game.profile = ProfileFactory.new_profile("Tester", "saiyan", "male", "warrior")
	Game.world_info = {"slug": "qtest", "planet": "earth", "seed": 3, "difficulty": "normal"}
	Game.paused_by_ui = false
	world = FakeWorld.new()
	add_node(world)
	Game.world = world
	QuestBoot.install(world)
	dialog = DialogController.of(world)
	qm = QuestManager.of(world)
	qm._normalise_state()

func teardown() -> void:
	dialog = null
	qm = null
	if world != null and is_instance_valid(world):
		world.free()
	world = null
	Game.world = null
	Game.player = null
	Game.profile = {}
	Game.world_info = {}

func _npc(entity_type: String) -> Node3D:
	var n := FakeWorld.FakeEntity.new()
	n.entity_type = entity_type
	world.add_child(n)
	return n

func test_master_resolution_from_entity_def() -> void:
	var roshi := _npc("master_roshi")
	assert_eq(dialog.master_id_of(roshi), "roshi", "entities.json master field")
	var unknown := _npc("dino1")
	assert_eq(dialog.master_id_of(unknown), "", "a dinosaur is not a master")

func test_teach_options_from_master_data() -> void:
	var options := dialog.teach_options("roshi")
	assert_true(options.size() >= 2, "Roshi teaches ki control and techniques")
	var ids: Array = []
	for o in options:
		ids.append(String((o as Dictionary)["id"]))
	assert_true(ids.has("kamehameha"), "kamehameha offered")
	for o in options:
		assert_true(int((o as Dictionary)["cost"]) > 0, "every offer has a TP price")
		assert_true(not bool((o as Dictionary)["affordable"]), "nothing affordable with 0 TP")

func test_teach_spends_tp_and_learns() -> void:
	Game.profile["tp"] = 10000
	var learned: Array = []
	Events.technique_learned.connect(func(id: String) -> void: learned.append(id))
	assert_true(dialog.teach("roshi", "technique", "kamehameha"), "technique taught")
	assert_true((Game.profile["techniques"] as Array).has("kamehameha"), "technique known")
	assert_eq(int(Game.profile["tp"]), 10000 - dialog.technique_cost("kamehameha"), "TP spent")
	assert_eq(learned.size(), 1, "technique_learned emitted")
	assert_true(not dialog.teach("roshi", "technique", "kamehameha"), "cannot learn it twice")
	var before := int(Game.profile["tp"])
	assert_true(dialog.teach("korin", "skill", "fly"), "Korin teaches flight")
	assert_eq(int(Game.profile["skills"]["fly"]), 1, "fly level 1")
	assert_true(int(Game.profile["tp"]) < before, "skill cost paid")
	Events.technique_learned.disconnect(Events.technique_learned.get_connections()[0]["callable"])

func test_teach_refuses_without_tp() -> void:
	Game.profile["tp"] = 10
	assert_true(not dialog.teach("roshi", "technique", "kamehameha"), "not enough TP")
	assert_true(not (Game.profile["techniques"] as Array).has("kamehameha"), "nothing learned")
	assert_eq(int(Game.profile["tp"]), 10, "TP untouched")

func test_dialog_request_turns_in_completed_quests() -> void:
	var qid := "sidequest_training:roshi_basic_training"
	(Game.profile["quests"]["completed"] as Array).append(qid)
	var roshi := _npc("master_roshi")
	Events.dialog_requested.emit(roshi)
	assert_true(qm.claimed().has(qid), "talking to Roshi turned the quest in")
	assert_eq(dialog.current_master, "roshi", "master remembered for the training menu")

func test_dialog_request_marks_talk_objectives() -> void:
	var qid := "sidequest_collection:bulma_namek_research"
	qm.start(qid, true)
	var objs: Array = Registry.quest(qid)["objectives"]
	for i in objs.size():
		if String(objs[i]["type"]) == "OBTAIN":
			qm._set_progress(qid, i, Objectives.required(objs[i]))
	var bulma := _npc("saga_bulma")
	Events.dialog_requested.emit(bulma)
	assert_true(qm.completed().has(qid) or qm.claimed().has(qid), "talking to Bulma finished the quest")

func test_training_menu_opens() -> void:
	dialog.open_training("roshi")
	var menu: Node = dialog.get_node_or_null("TrainMenu")
	assert_true(menu != null, "training overlay created")
	assert_true(menu is TrainMenu, "it is the TrainMenu")

func test_barter_offers_only_for_traders() -> void:
	assert_eq(dialog.shop_offers("roshi").size(), 0, "Roshi is not a trader")
	assert_true(dialog.shop_offers("bulma").size() > 0, "Bulma barters")
	assert_true(dialog.shop_offers("namek_trader").size() == 0, "unknown master id has no offers")
