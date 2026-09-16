extends TestCase
## Player profile roundtrip and the survival/movement wiring, with no world present.

var player: Player = null

func setup() -> void:
	Game.profile = {}
	Game.world_info = {}

func teardown() -> void:
	if player != null and is_instance_valid(player):
		player.queue_free()
		player = null
	Game.player = null
	Game.profile = {}

func _spawn() -> Player:
	var p := Player.new()
	add_node(p)
	return p

func _item() -> String:
	for c in ["stone", "dirt", "cobblestone"]:
		if Registry.has_item(c):
			return c
	return "stone"

func test_player_builds_its_parts() -> void:
	player = _spawn()
	assert_true(player.inventory != null, "inventory")
	assert_true(player.input != null, "input")
	assert_true(player.camera_rig != null, "camera rig")
	assert_true(player.interaction != null, "interaction")
	assert_true(player.stats is PlayerStats, "stats is PlayerStats")
	assert_true(player.model != null, "a model exists")
	assert_eq(player.aabb_size.x, 0.6, "aabb width")
	assert_eq(player.aabb_size.y, 1.8, "aabb height")

func test_profile_roundtrip() -> void:
	var prof := ProfileFactory.new_profile("Tester", "saiyan", "male", "warrior")
	prof["position"] = {"planet": "earth", "x": 12.5, "y": 70.0, "z": -4.5, "yaw": 33.0}
	prof["spawn"] = {"planet": "earth", "x": 1.5, "y": 65.0, "z": 2.5}
	prof["hunger"] = 13
	prof["tp"] = 250
	Game.profile = prof
	player = _spawn()
	player.inventory.clear()
	player.inventory.add(_item(), 23)
	player.select_hotbar(5)
	var out: Dictionary = {}
	player.write_profile(out)
	assert_near(out["position"]["x"], 12.5)
	assert_near(out["position"]["z"], -4.5)
	assert_near(out["position"]["yaw"], 33.0, 0.01)
	assert_near(out["spawn"]["y"], 65.0)
	assert_eq(int(out["inventory"]["hotbar"]), 5, "hotbar index")
	assert_eq(int(out["tp"]), 250, "tp")
	assert_near(float(out["hunger"]), 13.0)
	# read it back into a second player
	player.queue_free()
	Game.profile = out
	var p2 := _spawn()
	assert_near(p2.global_position.x, 12.5, 0.001)
	assert_eq(p2.hotbar_index, 5, "hotbar restored")
	assert_eq(p2.inventory.count(_item()), 23, "items restored")
	assert_eq((p2.stats as PlayerStats).tp, 250, "tp restored")
	p2.queue_free()
	player = null

func test_health_and_death_flow() -> void:
	Game.profile = ProfileFactory.new_profile("Tester", "human", "male", "warrior")
	player = _spawn()
	var start := player.health
	assert_true(start > 0.0, "spawned alive")
	var dealt := player.take_damage(10.0, null, "test")
	assert_true(dealt > 0.0, "damage applied")
	assert_true(player.health < start, "health dropped")
	player.take_damage(99999.0, null, "test")
	assert_true(player.dead, "dead")
	player.respawn()
	assert_true(not player.dead, "respawned")
	assert_near(player.health, player.max_health)

func test_selected_stack_follows_the_hotbar() -> void:
	Game.profile = ProfileFactory.new_profile("Tester", "human", "male", "warrior")
	player = _spawn()
	player.inventory.clear()
	player.inventory.set_stack(3, ItemStack.make(_item(), 4))
	player.select_hotbar(3)
	assert_eq(player.selected_stack().item, _item(), "selected")
	player.select_hotbar(0)
	assert_true(player.selected_stack().is_empty(), "empty slot")

func test_eye_and_aim() -> void:
	player = _spawn()
	player.global_position = Vector3(0, 10, 0)
	assert_near(player.eye_position().y, 10.0 + 1.62, 0.01)
	player.is_crouching = true
	assert_near(player.eye_position().y, 10.0 + 1.35, 0.01)
	assert_near(player.aim_direction().length(), 1.0, 0.001)

func test_target_speed_by_mode() -> void:
	Game.profile = ProfileFactory.new_profile("Tester", "human", "male", "warrior")
	player = _spawn()
	var walk := player.target_speed()
	player.is_sprinting = true
	assert_true(player.target_speed() > walk, "sprint faster than walk")
	player.is_sprinting = false
	player.is_crouching = true
	assert_true(player.target_speed() < walk, "sneak slower")
	player.is_crouching = false
	player.is_flying = true
	assert_true(player.target_speed() >= 12.0, "flight speed")

func test_flight_needs_the_skill() -> void:
	Game.profile = ProfileFactory.new_profile("Tester", "saiyan", "male", "warrior")
	Game.profile["skills"]["fly"] = 0
	Game.creative = false
	player = _spawn()
	assert_true(not player.can_fly(), "no skill, no flight")
	Game.profile["skills"]["fly"] = 1
	assert_true(player.can_fly(), "skill 1 flies")

func test_fallback_physics_keeps_the_player_on_the_ground() -> void:
	player = _spawn()
	player.global_position = Vector3(0, 6, 0)
	for i in 120:
		player._physics_process(1.0 / 60.0)
	assert_true(player.global_position.y <= 0.001, "fell to the fallback ground: %f" % player.global_position.y)
	assert_true(player.on_ground, "on ground")
