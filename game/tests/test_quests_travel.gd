extends TestCase
## Space travel unlock rules, arrival points and the deep space body markers.

const FakeWorld := preload("res://tests/QuestTestWorld.gd")

var world: Node3D = null
var travel: SpaceTravel = null

func setup() -> void:
	Game.profile = ProfileFactory.new_profile("Tester", "saiyan", "male", "warrior")
	Game.world_info = {"slug": "qtest", "planet": "earth", "seed": 7, "difficulty": "normal"}
	Game.paused_by_ui = false
	world = FakeWorld.new()
	add_node(world)
	Game.world = world
	QuestBoot.install(world)
	travel = SpaceTravel.of(world)

func teardown() -> void:
	if travel != null and is_instance_valid(travel):
		travel.launching = false
	travel = null
	if world != null and is_instance_valid(world):
		world.free()
	world = null
	Game.world = null
	Game.player = null
	Game.profile = {}
	Game.world_info = {}

# --- unlock rules ----------------------------------------------------------

func test_always_and_never_rules() -> void:
	assert_true(travel.is_unlocked("namek"), "namek travel is ALWAYS")
	var r := travel.can_travel("cereal")
	assert_true(not bool(r["ok"]), "cereal travel is NEVER")
	assert_true(String((r["reasons"] as PackedStringArray)[0]).contains("No route"), "reason given")
	assert_true(not bool(travel.can_travel("earth")["ok"]), "cannot travel to the planet you are on")
	assert_true(not bool(travel.can_travel("nowhere")["ok"]), "unknown planet refused")

func test_quest_rule() -> void:
	var r := travel.can_travel("otherworld")
	assert_true(not bool(r["ok"]), "otherworld needs Bulma's otherworld drive quest")
	(Game.profile["quests"]["completed"] as Array).append("sidequest_tech:bulma_otherworld_drive")
	assert_true(bool(travel.can_travel("otherworld")["ok"]), "unlocked once the quest is done")

func test_quest_rule_with_saga_style_id() -> void:
	var r := travel.can_travel("sacred_kai_planet")
	assert_true(not bool(r["ok"]), "sacred world needs a buu saga quest")
	(Game.profile["quests"]["claimed"] as Array).append("saga_buu:23")
	assert_true(bool(travel.can_travel("sacred_kai_planet")["ok"]), "QUEST:buu_saga:23 resolves to saga_buu:23")

func test_planet_rule() -> void:
	assert_true(not bool(travel.can_travel("vegeta")["ok"]), "vegeta needs namek first")
	StoryFlags.set_flag("visited_namek", true)
	assert_true(bool(travel.can_travel("vegeta")["ok"]), "vegeta opens after visiting namek")

func test_item_rule() -> void:
	assert_true(not bool(travel.can_travel("universe_7_deep_space")["ok"]), "deep space needs a ship")
	Rewards.give_to_profile(Game.profile, "saiyan_ship", 1)
	assert_true(bool(travel.can_travel("universe_7_deep_space")["ok"]), "ship in the inventory unlocks deep space")

func test_profile_unlock_list_overrides_rules() -> void:
	(Game.profile["planets_unlocked"] as Array).append("cereal")
	assert_true(travel.is_unlocked("cereal"), "an explicitly unlocked planet is always reachable")
	var list := travel.unlocked_planets()
	assert_true(list.has("cereal") and list.has("namek"), "unlocked_planets lists both")

func test_unlock_planet_reward_feeds_travel() -> void:
	Rewards.apply({"type": "UNLOCK_PLANET", "planet": "yardrat"}, Game.profile, null)
	assert_true(travel.is_unlocked("yardrat"), "quest reward unlocks travel")

# --- arrival / markers -----------------------------------------------------

func test_arrival_points_from_planets_json() -> void:
	var earth := travel.arrival_point("earth")
	assert_true(earth.y < 0.0, "earth drops the player onto the surface")
	var otherworld := travel.arrival_point("otherworld")
	assert_near(otherworld.y, 41.0, 0.01, "otherworld has a fixed arrival height")
	assert_near(travel.arrival_point("universe_7_deep_space").y, 800.0, 0.01, "deep space arrival")

func test_target_aliases() -> void:
	assert_eq(SpaceTravel.resolve_target("overworld"), "earth", "DMZ+ overworld is earth")
	assert_eq(SpaceTravel.resolve_target("namek"), "namek", "planet ids pass through")
	assert_eq(SpaceTravel.resolve_target("namek_system"), "", "suns are not landable")
	assert_eq(SpaceTravel.resolve_target("super_dball_3"), "", "dragon balls are not planets")

func test_deep_space_markers() -> void:
	world.planet_id = "universe_7_deep_space"
	Game.world_info["planet"] = "universe_7_deep_space"
	travel._refresh_planet()
	assert_true(travel.deep_space, "deep space mode detected from gravity/oxygen")
	var markers := travel.body_markers()
	assert_true(markers.size() >= 10, "planets, suns and the seven super balls: %d" % markers.size())
	var landable := 0
	var dragon_balls := 0
	for m in markers:
		if String((m as Dictionary)["planet"]) != "":
			landable += 1
		if String((m as Dictionary)["kind"]) == "dragon_ball":
			dragon_balls += 1
	assert_true(landable >= 5, "several landable bodies (%d)" % landable)
	assert_eq(dragon_balls, 7, "seven super dragon balls")
	var again := travel.body_markers()
	assert_true((again[0]["position"] as Vector3).is_equal_approx(markers[0]["position"]), "markers are stable")

func test_nearest_body_and_descend_distance() -> void:
	world.planet_id = "universe_7_deep_space"
	Game.world_info["planet"] = "universe_7_deep_space"
	travel._refresh_planet()
	var markers := travel.body_markers()
	var target: Dictionary = {}
	for m in markers:
		if String((m as Dictionary)["planet"]) != "":
			target = m
			break
	assert_true(not target.is_empty(), "a landable body exists")
	var near := travel.nearest_body(target["position"] as Vector3)
	assert_eq(String(near["target"]), String(target["target"]), "nearest body found")
	assert_true(float(near["distance"]) < 0.001, "distance measured from the body")
	assert_near(SpaceTravel.DESCEND_DIST, 24.0, 0.01, "descends within 24 m as specified")

func test_travel_to_locked_planet_is_refused() -> void:
	assert_true(not travel.travel_to("cereal"), "locked planet refused")
	assert_true(not travel.launching, "no cinematic started")

func test_travel_to_unlocked_planet_starts_the_launch() -> void:
	assert_true(travel.travel_to("namek"), "launch accepted")
	assert_true(travel.launching, "cinematic running")
	assert_true(not travel.travel_to("namek"), "a second launch is ignored while one runs")
	travel.launching = false

func test_space_suit_detection_without_armor() -> void:
	assert_true(not travel.has_space_suit(), "no player, no suit")

func test_nimbus_toggle() -> void:
	var player := FakeWorld.FakeEntity.new()
	world.add_child(player)
	Game.player = player
	assert_true(travel.use_vehicle("flying_nimbus"), "nimbus is used, not the map")
	assert_true(travel.nimbus, "nimbus active")
	assert_true(StoryFlags.has_flag(SpaceTravel.NIMBUS_FLAG), "flag stored")
	travel.mount_nimbus("flying_nimbus")
	assert_true(not travel.nimbus, "second use dismisses it")
