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

# =====================================================================================
# Bug 2: "when I look up and down, my character looks up when I drag the screen down".
# Mobile convention (Minecraft / DragonMineZ): drag DOWN -> look DOWN, in every camera mode,
# with "Invert look Y" flipping it. Measured numerically on the live Camera3D basis.
# =====================================================================================

const DRAG_DOWN := Vector2(0.0, 120.0)      # a finger sliding 120 px down the screen

func _live_player() -> Player:
	Game.profile = ProfileFactory.new_profile("Looker", "saiyan", "male", "warrior")
	Game.settings["invert_y"] = false
	var p := Player.new()
	add_node(p)
	p.global_position = Vector3(0.5, 64.0, 0.5)
	return p

func _drop(p: Player) -> void:
	p.queue_free()
	Game.settings["invert_y"] = false
	Game.profile = {}
	Game.player = null

func _settle(rig: CameraRig, frames := 30) -> void:
	for i in frames:
		rig._process(0.05)

func test_dragging_down_looks_down_in_every_camera_mode() -> void:
	for mode in [CameraRig.Mode.SHOULDER, CameraRig.Mode.FIRST, CameraRig.Mode.FRONT]:
		var p := _live_player()
		var rig := p.camera_rig
		rig.mode = mode
		rig.yaw_deg = 0.0
		rig.pitch_deg = 0.0
		_settle(rig)
		var before := rig.camera_forward()
		var aim_before := rig.aim_from_camera()
		rig.apply_look(DRAG_DOWN)
		_settle(rig)
		var after := rig.camera_forward()
		var aim_after := rig.aim_from_camera()
		assert_true(rig.pitch_deg < 0.0, "mode %d: pitch went below the horizon (%f)" % [mode, rig.pitch_deg])
		assert_true(aim_after.y < aim_before.y - 0.1,
			"mode %d: the aim tilted down (%f -> %f)" % [mode, aim_before.y, aim_after.y])
		assert_true(aim_after.y < -0.2, "mode %d: aiming below the horizon (%f)" % [mode, aim_after.y])
		# The selfie camera stands in front of the player and faces back, so its own forward is
		# the mirror of the aim; the two third-person modes and first person agree on the sign.
		if mode == CameraRig.Mode.FRONT:
			assert_true(after.y > before.y, "FRONT: the selfie camera tilts the other way by design")
		else:
			assert_true(after.y < before.y - 0.1,
				"mode %d: camera forward.y fell (%f -> %f)" % [mode, before.y, after.y])
			assert_true(after.y < -0.2, "mode %d: camera looks below the horizon" % mode)
		# Dragging up is the exact opposite.
		rig.apply_look(-DRAG_DOWN)
		_settle(rig)
		assert_near(rig.pitch_deg, 0.0, 0.001, "mode %d: back to the horizon" % mode)
		assert_near(rig.aim_from_camera().y, aim_before.y, 0.02, "mode %d: aim back" % mode)
		_drop(p)

func test_invert_y_flips_the_vertical_look() -> void:
	for mode in [CameraRig.Mode.SHOULDER, CameraRig.Mode.FIRST, CameraRig.Mode.FRONT]:
		var p := _live_player()
		var rig := p.camera_rig
		rig.mode = mode
		rig.yaw_deg = 0.0
		rig.pitch_deg = 0.0
		Game.settings["invert_y"] = true
		_settle(rig)
		var aim_before := rig.aim_from_camera()
		rig.apply_look(DRAG_DOWN)
		_settle(rig)
		assert_true(rig.pitch_deg > 0.0, "mode %d: inverted pitch goes up (%f)" % [mode, rig.pitch_deg])
		assert_true(rig.aim_from_camera().y > aim_before.y + 0.1,
			"mode %d: Invert Y makes a downward drag look up" % mode)
		_drop(p)

func test_the_two_third_person_modes_and_first_person_use_the_same_rate() -> void:
	var pitches: Array[float] = []
	for mode in [CameraRig.Mode.SHOULDER, CameraRig.Mode.FIRST, CameraRig.Mode.FRONT]:
		var p := _live_player()
		var rig := p.camera_rig
		rig.mode = mode
		rig.pitch_deg = 0.0
		Game.settings["sens_first"] = 1.0
		Game.settings["sens_third"] = 1.0
		rig.apply_look(DRAG_DOWN)
		pitches.append(rig.pitch_deg)
		_drop(p)
	for v in pitches:
		assert_near(v, -DRAG_DOWN.y * CameraRig.LOOK_DEG_PER_PX, 0.001, "same degrees per pixel, downwards")

func test_the_character_model_looks_where_the_camera_looks() -> void:
	# Entity.head_pitch_deg is the Bedrock `query.head_x_rotation` convention: POSITIVE = down.
	# Proven here against Entity.look_at_head itself, then asserted for the camera-driven value -
	# feeding CameraRig.pitch_deg (positive = up) straight through is what made the character
	# look up when the finger dragged down.
	var p := _live_player()
	p.look_at_head(p.global_position + Vector3(0.0, -5.0, -5.0))
	assert_true(p.head_pitch_deg > 0.0,
		"looking at a point below gives a positive head pitch (%f)" % p.head_pitch_deg)
	var down_ref := p.head_pitch_deg
	p.camera_rig.mode = CameraRig.Mode.SHOULDER
	p.camera_rig.yaw_deg = 0.0
	p.camera_rig.pitch_deg = 0.0
	p.target = null
	p.input.add_look(DRAG_DOWN)
	p.tick(0.05)
	_settle(p.camera_rig)
	assert_true(p.camera_rig.pitch_deg < 0.0, "camera looks down")
	assert_true(p.head_pitch_deg > 0.0,
		"the model's head looks DOWN with the camera (%f, reference %f)" % [p.head_pitch_deg, down_ref])
	assert_true(p.camera_rig.aim_from_camera().y < 0.0, "and so does the aim")
	# ... and up when the finger drags up.
	p.input.add_look(-DRAG_DOWN * 2.0)
	p.tick(0.05)
	assert_true(p.camera_rig.pitch_deg > 0.0, "camera looks up")
	assert_true(p.head_pitch_deg < 0.0, "the model's head looks up too (%f)" % p.head_pitch_deg)
	_drop(p)

func test_a_downward_drag_through_the_hud_look_region_looks_down() -> void:
	# The whole chain with genuine events: InputEventScreenDrag -> Hud -> PlayerInput ->
	# CameraRig -> Camera3D basis.
	Game.profile = ProfileFactory.new_profile("Looker", "saiyan", "male", "warrior")
	Game.settings["invert_y"] = false
	var ui: UiManager = load("res://scenes/ui/UiManager.tscn").instantiate()
	add_node(ui)
	ui.show_hud(true)
	var hud: Hud = ui.hud
	hud.size = Vector2(1280.0, 720.0)
	hud._on_resize()
	var p := Player.new()
	add_node(p)
	p.global_position = Vector3(0.5, 64.0, 0.5)
	Game.player = p
	var rig := p.camera_rig
	rig.mode = CameraRig.Mode.SHOULDER
	rig.yaw_deg = 0.0
	rig.pitch_deg = 0.0
	_settle(rig)
	var before := rig.camera_forward().y
	var at := Vector2(640.0, 260.0)
	var down := InputEventScreenTouch.new()
	down.index = 0
	down.position = at
	down.pressed = true
	hud._input(down)
	for i in 6:
		at += Vector2(0.0, 20.0)
		var dr := InputEventScreenDrag.new()
		dr.index = 0
		dr.position = at
		dr.relative = Vector2(0.0, 20.0)
		hud._input(dr)
	assert_true(p.input.look_delta.y > 0.0, "the drag reached PlayerInput (%f)" % p.input.look_delta.y)
	p.tick(0.05)
	_settle(rig)
	var up := InputEventScreenTouch.new()
	up.index = 0
	up.position = at
	up.pressed = false
	hud._input(up)
	assert_true(rig.pitch_deg < 0.0, "pitch below the horizon (%f)" % rig.pitch_deg)
	assert_true(rig.camera_forward().y < before - 0.05,
		"the camera really looks down: forward.y %f -> %f" % [before, rig.camera_forward().y])
	assert_true(p.head_pitch_deg > 0.0, "and the character looks down with it")
	ui.close_all()
	ui.queue_free()
	Game.ui = null
	Game.paused_by_ui = false
	_drop(p)
