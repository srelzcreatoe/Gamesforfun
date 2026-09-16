extends TestCase
## Camera pull-in maths, look clamping, mode cycling and the mining break-time formula.

func test_pull_in_returns_full_distance_in_open_air() -> void:
	var solid := func(_x: int, _y: int, _z: int) -> bool: return false
	assert_near(CameraRig.pull_in_distance(solid, Vector3(0.5, 10.5, 0.5), Vector3(0, 0, 1), 3.4), 3.4)

func test_pull_in_stops_before_a_wall() -> void:
	# wall at z >= 2
	var solid := func(_x: int, _y: int, z: int) -> bool: return z >= 2
	var d := CameraRig.pull_in_distance(solid, Vector3(0.5, 10.5, 0.5), Vector3(0, 0, 1), 3.4)
	assert_true(d < 3.4, "pulled in, got %f" % d)
	assert_true(d >= CameraRig.PULL_START, "never closer than the minimum")
	# first sample inside the wall is at 1.65 (0.4 + 5*0.25 = 1.65 -> floor(0.5+1.65)=2)
	assert_near(d, maxf(1.65 - CameraRig.PULL_BACKOFF, CameraRig.PULL_START), 0.001)

func test_pull_in_clamps_to_the_minimum_when_in_a_corner() -> void:
	var solid := func(_x: int, _y: int, _z: int) -> bool: return true
	assert_near(CameraRig.pull_in_distance(solid, Vector3.ZERO, Vector3.FORWARD, 3.4), CameraRig.PULL_START)

func test_look_clamps_pitch_and_wraps_yaw() -> void:
	var rig := CameraRig.new()
	add_node(rig)
	rig.yaw_deg = 0.0
	rig.pitch_deg = 0.0
	rig.apply_look(Vector2(0, -100000))
	assert_true(rig.pitch_deg <= CameraRig.PITCH_LIMIT, "pitch top")
	assert_near(rig.pitch_deg, CameraRig.PITCH_LIMIT, 0.001)
	rig.apply_look(Vector2(0, 200000))
	assert_near(rig.pitch_deg, -CameraRig.PITCH_LIMIT, 0.001)
	rig.yaw_deg = 179.0
	rig.apply_look(Vector2(-100, 0))
	assert_true(rig.yaw_deg >= -180.0 and rig.yaw_deg <= 180.0, "yaw wrapped: %f" % rig.yaw_deg)
	rig.queue_free()

func test_look_delta_uses_the_spec_scale() -> void:
	var rig := CameraRig.new()
	add_node(rig)
	Game.settings["sens_third"] = 1.0
	rig.mode = CameraRig.Mode.SHOULDER
	rig.yaw_deg = 0.0
	rig.apply_look(Vector2(10, 0))
	assert_near(rig.yaw_deg, -10.0 * CameraRig.LOOK_DEG_PER_PX, 0.0001)
	rig.queue_free()

func test_mode_cycles_through_three_modes() -> void:
	var rig := CameraRig.new()
	add_node(rig)
	rig.set_mode(CameraRig.Mode.SHOULDER)
	rig.cycle_mode()
	assert_eq(rig.mode, CameraRig.Mode.FIRST, "shoulder -> first")
	rig.cycle_mode()
	assert_eq(rig.mode, CameraRig.Mode.FRONT, "first -> front")
	rig.cycle_mode()
	assert_eq(rig.mode, CameraRig.Mode.SHOULDER, "front -> shoulder")
	rig.queue_free()

func test_far_plane_follows_render_distance() -> void:
	var rig := CameraRig.new()
	add_node(rig)
	Game.settings["render_distance"] = 5
	assert_near(rig.far_distance(), 5.0 * 16.0 + 32.0)
	Game.settings["render_distance"] = 8
	assert_near(rig.far_distance(), 8.0 * 16.0 + 32.0)
	rig.queue_free()

func test_look_direction_is_normalised_and_faces_minus_z_at_zero() -> void:
	var rig := CameraRig.new()
	add_node(rig)
	rig.yaw_deg = 0.0
	rig.pitch_deg = 0.0
	var d := rig.look_direction()
	assert_near(d.length(), 1.0, 0.0001)
	assert_near(d.z, -1.0, 0.0001)
	rig.pitch_deg = 90.0
	assert_near(rig.look_direction().y, 1.0, 0.0001)
	rig.queue_free()

func test_break_time_formula() -> void:
	var block := {"hardness": 1.5, "tool": "pickaxe", "min_tier": 0}
	assert_near(Interaction.break_time(block, ItemStack.new()), 1.5)
	assert_near(Interaction.break_time({"hardness": 0.02}, ItemStack.new()), Interaction.MIN_BREAK)
	assert_eq(Interaction.break_time({"hardness": -1.0}, ItemStack.new()), -1.0, "unbreakable")

func test_tool_speed_by_tier() -> void:
	var block := {"hardness": 8.0, "tool": "pickaxe"}
	var pick := ItemStack.new()
	pick.item = "stone"
	assert_near(Interaction.tool_speed(block, pick), 1.0, 0.001, "block is not a tool")
	assert_near(Interaction.tool_speed(block, ItemStack.new()), 1.0, 0.001, "bare hand")
	assert_eq(Interaction.TIER_SPEED[1], 2.0, "wood")
	assert_eq(Interaction.TIER_SPEED[2], 4.0, "stone")
	assert_eq(Interaction.TIER_SPEED[3], 6.0, "iron")
	assert_eq(Interaction.TIER_SPEED[4], 8.0, "diamond")
	assert_eq(Interaction.TIER_SPEED[5], 9.0, "kikono")
	assert_eq(Interaction.TIER_SPEED[6], 12.0, "gete")

func test_can_harvest_respects_min_tier() -> void:
	assert_true(Interaction.can_harvest({"min_tier": 0}, ItemStack.new()), "hand mines tier 0")
	assert_true(not Interaction.can_harvest({"min_tier": 2}, ItemStack.new()), "hand cannot mine tier 2")

func test_reach_matches_the_spec() -> void:
	assert_near(Interaction.REACH, 4.6)
