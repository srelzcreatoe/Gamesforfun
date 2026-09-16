extends TestCase
## Dragon ball state machine: deterministic positions, finding, the summon ritual,
## wishes and the one-week scatter.

const FakeWorld := preload("res://tests/QuestTestWorld.gd")

var world: Node3D = null
var balls: DragonBalls = null
var player: Node3D = null

func setup() -> void:
	Game.profile = ProfileFactory.new_profile("Tester", "saiyan", "male", "warrior")
	Game.world_info = {"slug": "qtest", "planet": "earth", "seed": 4242, "difficulty": "normal"}
	Game.paused_by_ui = false
	world = FakeWorld.new()
	world.seed = 4242
	add_node(world)
	Game.world = world
	player = FakeWorld.FakeEntity.new()
	world.add_child(player)
	player.global_position = Vector3(0, 64, 0)
	Game.player = player
	QuestBoot.install(world)
	balls = DragonBalls.of(world)

func teardown() -> void:
	balls = null
	player = null
	if world != null and is_instance_valid(world):
		world.free()
	world = null
	Game.world = null
	Game.player = null
	Game.profile = {}
	Game.world_info = {}

# --- data / positions ------------------------------------------------------

func test_set_for_planet_and_dragon() -> void:
	assert_eq(balls.set_for_planet("earth"), "earth", "earth set")
	assert_eq(balls.set_for_planet("namek"), "namek", "namek set")
	assert_eq(balls.set_for_planet("universe_7_deep_space"), "super", "super set in deep space")
	assert_eq(balls.set_for_planet("vegeta"), "", "no balls on Vegeta")
	assert_eq(balls.dragon_for_set("earth"), "shenron", "earth -> shenron")
	assert_eq(balls.dragon_for_set("namek"), "porunga", "namek -> porunga")
	assert_eq(balls.dragon_for_set("super"), "super_shenron", "super -> super shenron")

func test_ball_items() -> void:
	assert_eq(balls.ball_item("earth", 3), "dball3", "earth 3 star item")
	assert_eq(balls.ball_item("namek", 1), "dball1_namek", "namek 1 star item")
	assert_eq(balls.ball_item("super", 1), "", "super balls have no item yet")

func test_positions_are_deterministic_and_in_range() -> void:
	var a := balls.positions("earth")
	var b := balls.positions("earth")
	assert_eq(a.size(), 7, "seven balls")
	for i in 7:
		assert_true((a[i] as Vector3).is_equal_approx(b[i]), "same seed -> same position")
		var d: float = Vector2((a[i] as Vector3).x, (a[i] as Vector3).z).length()
		assert_true(d <= balls.range_for_set("earth") + 1.0, "inside the spawn range")
	var namek := balls.positions("namek")
	assert_true(not (namek[0] as Vector3).is_equal_approx(a[0]), "another set scatters differently")

func test_scatter_changes_positions() -> void:
	var before := balls.positions("earth")
	balls.set_state("earth")["scatter"] = 1
	var after := balls.positions("earth")
	assert_true(not (after[0] as Vector3).is_equal_approx(before[0]), "the scatter counter re-rolls positions")

# --- finding ---------------------------------------------------------------

func test_found_state_and_toast() -> void:
	assert_eq(balls.found_count("earth"), 0, "nothing found")
	Events.dragon_ball_found.emit("earth", 4)
	Events.dragon_ball_found.emit("earth", 4)
	assert_eq(balls.found_count("earth"), 1, "duplicates ignored")
	assert_true((balls.found("earth") as Array).has(4), "star recorded")
	assert_true(not balls.has_all("earth"), "not complete")
	for s in [1, 2, 3, 5, 6, 7]:
		Events.dragon_ball_found.emit("earth", s)
	assert_true(balls.has_all("earth"), "all seven found")
	assert_eq(Game.profile["dragon_balls"]["earth"]["found"].size(), 7, "state saved in the profile")

func test_pickup_item_marks_the_ball() -> void:
	Events.item_picked_up.emit("dball7", 1)
	assert_true((balls.found("earth") as Array).has(7), "picking up the item counts as finding it")

func test_ball_entities_stream_in_around_the_player() -> void:
	var list := balls.positions("earth")
	player.global_position = Vector3((list[0] as Vector3).x, 64.0, (list[0] as Vector3).z)
	balls._stream_balls("earth")
	assert_true(world.spawned.size() >= 1, "the nearby ball spawned as a pickup")
	var e: Node3D = world.spawned[0]
	assert_eq(e.entity_type, "dragon_ball", "pickup entity type")
	assert_eq(String(e.spawn_data.get("item", "")), balls.ball_item("earth", 1), "carries the right item")
	balls._stream_balls("earth")
	assert_eq(world.spawned.size(), 1, "no duplicate spawn while it is alive")

# --- radar -----------------------------------------------------------------

func test_radar_direction() -> void:
	var info := balls.radar_direction(Vector3.ZERO, "earth")
	assert_true(bool(info["ok"]), "radar has a signal")
	assert_true(int(info["star"]) >= 1 and int(info["star"]) <= 7, "points at a star")
	assert_true(float(info["distance"]) > 0.0, "distance measured")
	assert_near((info["dir"] as Vector3).length(), 1.0, 0.001, "normalised direction")
	assert_eq(int(info["found"]), 0, "found count reported")
	assert_true(String(info["text"]).contains("0/7"), "readout text: %s" % String(info["text"]))

func test_radar_when_complete_and_when_scattered() -> void:
	for s in range(1, 8):
		Events.dragon_ball_found.emit("earth", s)
	var info := balls.radar_direction(Vector3.ZERO, "earth")
	assert_true(not bool(info["ok"]), "no target left")
	assert_true(String(info["text"]).contains("All seven"), "tells the player to summon")
	balls.set_state("earth")["next_summon_day"] = StoryFlags.day_index() + 7
	var scattered := balls.radar_direction(Vector3.ZERO, "earth")
	assert_true(not bool(scattered["ok"]), "no signal while scattered")
	assert_true(String(scattered["text"]).contains("stone"), "explains the wait: %s" % String(scattered["text"]))
	assert_eq(balls.days_until_return("earth"), 7, "one in-game week")

func test_radar_on_a_world_without_balls() -> void:
	world.planet_id = "vegeta"
	var info := balls.radar_direction(Vector3.ZERO)
	assert_true(not bool(info["ok"]), "no balls on Vegeta")

func test_compass_labels() -> void:
	assert_eq(DragonBalls.compass(Vector3(0, 0, -1)), "N", "north is -Z")
	assert_eq(DragonBalls.compass(Vector3(1, 0, 0)), "E", "east is +X")
	assert_eq(DragonBalls.compass(Vector3(0, 0, 1)), "S", "south is +Z")
	assert_eq(DragonBalls.compass(Vector3(-1, 0, 0)), "W", "west is -X")

# --- ritual / wishes -------------------------------------------------------

func _place_seven(set_id: String, center: Vector3) -> void:
	var st := balls.set_state(set_id)
	var list: Array = st["placed"]
	for star in range(1, 8):
		var angle := TAU * float(star) / 7.0
		var p := center + Vector3(cos(angle) * 1.5, 0.0, sin(angle) * 1.5)
		list.append({"star": star, "x": p.x, "y": p.y, "z": p.z})

func test_ritual_summons_the_dragon() -> void:
	var summoned: Array = []
	Events.dragon_summoned.connect(func(d: String) -> void: summoned.append(d), CONNECT_ONE_SHOT)
	_place_seven("earth", Vector3(0, 64, 0))
	balls._check_ritual("earth")
	assert_true(balls.dragon != null, "a dragon entity was spawned")
	assert_eq(String(balls.current_dragon), "shenron", "Shenron for the earth set")
	assert_eq(int(balls.wishes_left), 1, "Shenron grants one wish")
	assert_eq(summoned.size(), 1, "dragon_summoned emitted")

func test_ritual_needs_seven_close_together() -> void:
	var st := balls.set_state("earth")
	var list: Array = st["placed"]
	for star in range(1, 7):
		list.append({"star": star, "x": 0.0, "y": 64.0, "z": 0.0})
	balls._check_ritual("earth")
	assert_true(balls.dragon == null, "six balls are not enough")
	list.append({"star": 7, "x": 400.0, "y": 64.0, "z": 400.0})
	balls._check_ritual("earth")
	assert_true(balls.dragon == null, "the seventh must be in the same place")

func test_porunga_grants_three_wishes() -> void:
	world.planet_id = "namek"
	Game.world_info["planet"] = "namek"
	_place_seven("namek", Vector3(0, 64, 0))
	balls._check_ritual("namek")
	assert_eq(String(balls.current_dragon), "porunga", "Porunga on Namek")
	assert_eq(int(balls.wishes_left), 3, "three wishes, no Namekian language gate")

func test_summon_refused_on_the_wrong_planet() -> void:
	world.planet_id = "earth"
	assert_true(not balls.summon("namek", Vector3(0, 64, 0)), "Porunga cannot be summoned on Earth")
	assert_true(balls.dragon == null, "no dragon spawned")

func test_wishes_apply() -> void:
	assert_true(balls.grant_wish("shenron", "tps"), "tps wish")
	assert_eq(int(Game.profile["tp"]), 5000, "5000 TP granted")
	assert_true(balls.grant_wish("shenron", "senzu"), "item wish")
	var counts := Requirements.item_counts(Game.profile, null)
	assert_true(int(counts.get("senzu_bean", 0)) >= 16, "senzu beans granted")
	assert_true(balls.grant_wish("porunga", "relocatestats"), "stat reset wish")
	assert_eq(int(Game.profile["tp"]), int(Game.profile["tp_total"]), "all earned TP refunded")
	assert_true(not balls.grant_wish("shenron", "nope"), "unknown wish rejected")
	assert_eq(StoryFlags.counter("wishes_granted"), 3, "wish counter tracked in the story flags")

func test_finish_summon_scatters_for_a_week() -> void:
	for s in range(1, 8):
		Events.dragon_ball_found.emit("earth", s)
	_place_seven("earth", Vector3(0, 64, 0))
	balls._check_ritual("earth")
	balls.grant_wish("shenron", "tps")
	balls.finish_summon()
	assert_eq(balls.found_count("earth"), 0, "found state cleared")
	assert_eq((balls.placed("earth") as Array).size(), 0, "placed balls removed")
	assert_true(balls.is_scattered("earth"), "scattered")
	assert_eq(balls.days_until_return("earth"), 7, "for one in-game week")
	assert_eq(int(balls.set_state("earth")["summons"]), 1, "summon counted")
	assert_true(balls.dragon == null, "dragon dismissed")
	var counts := Requirements.item_counts(Game.profile, null)
	assert_eq(int(counts.get("dball1", 0)), 0, "ball items left the inventory")

func test_story_flag_clock() -> void:
	var before := StoryFlags.days()
	StoryFlags.advance_days(3.5)
	assert_near(StoryFlags.days(), before + 3.5, 0.001, "in-game days accumulate")
	assert_eq(StoryFlags.day_index(), int(floor(before + 3.5)), "day index floors")
	StoryFlags.set_flag("met_roshi", true)
	assert_true(StoryFlags.has_flag("met_roshi"), "flag stored")
	assert_eq(int(Game.profile["flags"]["met_roshi"]), 1, "flag saved in the profile")
