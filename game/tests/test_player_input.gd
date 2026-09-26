extends TestCase
## PlayerInput edge flags + KeyboardInput wiring + PlayerStats formulas.

func test_edge_flags_clear_each_frame() -> void:
	var inp := PlayerInput.new()
	inp.press("jump")
	assert_true(inp.jump, "jump held")
	assert_true(inp.jump_pressed, "jump edge")
	inp.press("jump")
	assert_true(inp.jump_pressed, "still set within the frame")
	inp.end_frame()
	assert_true(inp.jump, "still held after end_frame")
	assert_true(not inp.jump_pressed, "edge cleared")
	inp.press("jump")
	assert_true(not inp.jump_pressed, "no new edge while held")
	inp.release("jump")
	inp.press("jump")
	assert_true(inp.jump_pressed, "edge again after release")

func test_all_edge_actions() -> void:
	var inp := PlayerInput.new()
	for a in ["attack", "use", "fly", "dash", "lock_on", "transform", "technique"]:
		inp.press(a)
	assert_true(inp.attack_pressed and inp.use_pressed and inp.fly_pressed, "press edges")
	assert_true(inp.dash_pressed and inp.lock_on_pressed, "dash/lock edges")
	assert_true(inp.transform_pressed and inp.technique_pressed, "virtual edges")
	inp.end_frame()
	assert_true(not inp.transform_pressed, "cleared")

func test_clear_all_resets_everything() -> void:
	var inp := PlayerInput.new()
	inp.move = Vector2(1, 1)
	inp.press("sneak")
	inp.break_held = true
	inp.gesture_sprint = true
	inp.add_look(Vector2(10, 4))
	inp.clear_all()
	assert_eq(inp.move, Vector2.ZERO, "move")
	assert_eq(inp.look_delta, Vector2.ZERO, "look")
	assert_true(not inp.sneak and not inp.break_held and not inp.gesture_sprint, "flags")

func test_wants_sprint_includes_gesture() -> void:
	var inp := PlayerInput.new()
	assert_true(not inp.wants_sprint(), "idle")
	inp.gesture_sprint = true
	assert_true(inp.wants_sprint(), "gesture")
	inp.gesture_sprint = false
	inp.press("sprint")
	assert_true(inp.wants_sprint(), "button")

func test_look_accumulates() -> void:
	var inp := PlayerInput.new()
	inp.add_look(Vector2(3, -2))
	inp.add_look(Vector2(1, 1))
	assert_eq(inp.look_delta, Vector2(4, -1), "sum")

func test_keyboard_input_binds_to_the_same_object() -> void:
	var inp := PlayerInput.new()
	var kb := KeyboardInput.new(inp)
	kb.poll()
	assert_eq(inp.move, Vector2.ZERO, "nothing pressed")
	assert_true(not kb.mouse_captured, "not captured by default")

func test_fall_damage_formula() -> void:
	assert_eq(PlayerStats.fall_damage_raw(3.0), 0.0, "safe")
	assert_eq(PlayerStats.fall_damage_raw(3.4), 0.0, "exactly safe")
	assert_eq(PlayerStats.fall_damage_raw(10.0), float(int((10.0 - 3.4) * 0.9)), "10 blocks")
	assert_eq(PlayerStats.fall_damage_raw(23.4), 18.0, "20 over the limit")

func test_hunger_exhaustion_drains() -> void:
	var st := PlayerStats.new(null)
	st.hunger = 20.0
	st.tick(1.0, 5.0, true, false, true)
	assert_true(st.exhaustion > 0.0, "exhaustion accumulates")
	st.exhaustion = 0.0
	for i in 100:
		st.tick(1.0, 5.0, true, false, true)
	assert_true(st.hunger < 20.0, "sprinting costs hunger")

func test_idle_costs_less_hunger_than_sprinting() -> void:
	var a := PlayerStats.new(null)
	var b := PlayerStats.new(null)
	for i in 50:
		a.tick(1.0, 0.0, false, false, true)
		b.tick(1.0, 5.6, true, false, true)
	assert_true(b.exhaustion > a.exhaustion, "sprinting is more expensive")

func test_oxygen_drains_and_refills() -> void:
	var st := PlayerStats.new(null)
	st.oxygen = PlayerStats.OXYGEN_MAX
	st.tick(1.0, 0.0, false, true, true)
	assert_near(st.oxygen, PlayerStats.OXYGEN_MAX - 1.0, 0.01)
	st.tick(1.0, 0.0, false, false, true)
	assert_near(st.oxygen, PlayerStats.OXYGEN_MAX, 0.01)

func test_no_oxygen_planet_drains_air() -> void:
	var st := PlayerStats.new(null)
	st.oxygen = 2.0
	st.tick(1.0, 0.0, false, false, false)
	assert_near(st.oxygen, 1.0, 0.01)

func test_eating_fills_hunger() -> void:
	var st := PlayerStats.new(null)
	st.hunger = 4.0
	st.eat({"hunger": 6})
	assert_near(st.hunger, 10.0)
	st.eat({"hunger": 99})
	assert_near(st.hunger, PlayerStats.HUNGER_MAX, 0.001, "clamped")

func test_fall_tracking_records_the_peak() -> void:
	var st := PlayerStats.new(null)
	st.note_airborne(10.0, true, false, false)
	st.note_airborne(12.0, false, false, false)
	assert_true(st.falling, "airborne")
	assert_near(st.fall_start_y, 12.0)
	st.note_airborne(2.0, false, false, false)
	assert_near(st.fall_start_y, 12.0, 0.001, "peak kept")
	st.note_airborne(2.0, true, false, false)
	assert_true(not st.falling, "landed")

# =====================================================================================
# Bug 1: "my character keeps mining when I didn't even click anything"
# Bug 3: the jump button doubles as fly (DragonMineZ double tap)
# Every touch below is a genuine InputEventScreenTouch / InputEventScreenDrag object fed to
# Hud._input, i.e. the same path Android uses - no signals, no direct field pokes.
# =====================================================================================

var _ui: UiManager = null
var _p: Player = null
var _world: Node3D = null

class MiningWorld extends Node3D:
	## Just enough World API for Interaction: a raycast that always hits one stone block.
	var block := Vector3i(3, 62, 4)
	var hit := true
	var id := 1
	var set_calls := 0

	func _init() -> void:
		name = "MiningWorld"

	func raycast(_origin: Vector3, _dir: Vector3, _reach: float, _fluids: bool) -> Dictionary:
		if not hit:
			return {"hit": false}
		return {"hit": true, "block": block, "normal": Vector3i.UP,
			"position": Vector3(block) + Vector3(0.5, 1.0, 0.5)}

	func get_block(_x: int, _y: int, _z: int) -> int:
		return id

	func set_block(_x: int, _y: int, _z: int, _bid: int, _meta: int, _update: bool) -> void:
		set_calls += 1

	func is_solid(_x: int, _y: int, _z: int) -> bool:
		return false

	func is_liquid(_x: int, _y: int, _z: int) -> bool:
		return false

	func get_entities() -> Array:
		return []

func _touch(pressed: bool, index: int, at: Vector2) -> InputEventScreenTouch:
	var ev := InputEventScreenTouch.new()
	ev.index = index
	ev.position = at
	ev.pressed = pressed
	return ev

func _drag(index: int, at: Vector2, rel: Vector2) -> InputEventScreenDrag:
	var ev := InputEventScreenDrag.new()
	ev.index = index
	ev.position = at
	ev.relative = rel
	return ev

## A live HUD + Player + fake world, wired exactly as the game wires them.
func _setup_world() -> Hud:
	Game.profile = ProfileFactory.new_profile("Toucher", "saiyan", "male", "warrior")
	Game.paused_by_ui = false
	Game.creative = false
	_ui = load("res://scenes/ui/UiManager.tscn").instantiate()
	add_node(_ui)
	_ui.show_hud(true)
	var hud: Hud = _ui.hud
	hud.size = Vector2(1280.0, 720.0)
	hud._on_resize()
	_p = Player.new()
	add_node(_p)
	_world = MiningWorld.new()
	add_node(_world)
	(_world as MiningWorld).id = maxi(1, Registry.block_id("stone"))
	_p.world = _world
	_p.global_position = Vector3(3.5, 63.0, 4.5)
	Game.player = _p
	return hud

func _teardown_world() -> void:
	if _ui != null and is_instance_valid(_ui):
		_ui.close_all()
		_ui.queue_free()
	if _p != null and is_instance_valid(_p):
		_p.queue_free()
	if _world != null and is_instance_valid(_world):
		_world.queue_free()
	_ui = null
	_p = null
	_world = null
	Game.player = null
	Game.ui = null                               # a leaked Game.ui would pause later tests
	Game.profile = {}
	Game.paused_by_ui = false

## Hold a finger in the look region until the HUD turns it into a mining hold.
func _hold_look(hud: Hud, index := 0, at := Vector2(640.0, 320.0)) -> void:
	hud._input(_touch(true, index, at))
	for i in 12:
		hud._process(0.05)

func _mine_frames(n := 3) -> void:
	for i in n:
		_p.interaction._process(0.05)

func test_press_and_release_on_the_world_leaves_mining_off() -> void:
	var hud := _setup_world()
	_hold_look(hud)
	assert_true(_p.input.break_held, "the long press is a mining hold")
	_mine_frames()
	assert_true(_p.interaction.mining, "mining while the finger is down")
	hud._input(_touch(false, 0, Vector2(640.0, 320.0)))
	assert_true(not _p.input.break_held, "hold cleared on release")
	assert_eq(hud.touch_count(), 0, "no finger down")
	_mine_frames()
	assert_true(not _p.interaction.mining, "mining stopped after the release")
	_teardown_world()

func test_release_outside_the_look_region_still_stops_mining() -> void:
	var hud := _setup_world()
	_hold_look(hud)
	_mine_frames()
	assert_true(_p.interaction.mining, "mining")
	# Finger slid onto the joystick side / off the screen before lifting.
	hud._input(_touch(false, 0, Vector2(-40.0, 980.0)))
	assert_true(not _p.input.break_held, "released although the release was outside the region")
	_mine_frames()
	assert_true(not _p.interaction.mining, "mining stopped")
	_teardown_world()

func test_a_second_finger_cannot_keep_mining_alive() -> void:
	var hud := _setup_world()
	_hold_look(hud)
	_mine_frames()
	# A second finger on the joystick, then released again: the mining hold is finger 0's.
	hud._input(_touch(true, 1, Vector2(120.0, 560.0)))
	hud._process(0.05)
	hud._input(_touch(false, 1, Vector2(120.0, 560.0)))
	hud._process(0.05)
	assert_true(_p.input.break_held, "finger 0 still holds")
	# Now the owner lifts while a third finger is down elsewhere.
	hud._input(_touch(true, 2, Vector2(900.0, 200.0)))
	hud._input(_touch(false, 0, Vector2(640.0, 320.0)))
	assert_true(not _p.input.break_held, "the owner's release ends the hold")
	_mine_frames()
	assert_true(not _p.interaction.mining, "mining stopped with another finger still down")
	hud._input(_touch(false, 2, Vector2(900.0, 200.0)))
	assert_eq(hud.touch_count(), 0, "all fingers up")
	assert_true(not _p.input.break_held and not _p.input.attack, "nothing held")
	_teardown_world()

func test_a_reused_touch_index_drops_the_previous_hold() -> void:
	var hud := _setup_world()
	_hold_look(hud)
	_mine_frames()
	assert_true(_p.interaction.mining, "mining")
	# Android reuses indices: index 0 presses again with no release in between.
	hud._input(_touch(true, 0, hud.button_rect("jump").get_center()))
	hud._process(0.05)
	assert_true(not _p.input.break_held, "the stale hold for index 0 was dropped")
	_mine_frames()
	assert_true(not _p.interaction.mining, "mining stopped")
	hud._input(_touch(false, 0, hud.button_rect("jump").get_center()))
	_teardown_world()

func test_a_ui_screen_opening_mid_hold_stops_mining() -> void:
	var hud := _setup_world()
	_hold_look(hud)
	_mine_frames()
	assert_true(_p.interaction.mining, "mining")
	# Bag / pause opens on top of the HUD: Android never delivers the release.
	_ui.open("inventory")
	assert_true(not _p.input.break_held, "hold dropped when the screen opened")
	assert_eq(hud.touch_count(), 0, "fingers forgotten")
	_p.interaction._process(0.05)
	assert_true(not _p.interaction.mining, "mining stopped")
	Game.paused_by_ui = false
	# ... and it does not come back while the HUD is disabled, even without a release event.
	for i in 10:
		hud._process(0.05)
	_mine_frames()
	assert_true(not _p.input.break_held and not _p.interaction.mining, "still off")
	_ui.close("inventory")
	_teardown_world()

func test_app_paused_mid_hold_stops_mining() -> void:
	var hud := _setup_world()
	_hold_look(hud)
	_mine_frames()
	assert_true(_p.interaction.mining, "mining")
	hud.notification(MainLoop.NOTIFICATION_APPLICATION_PAUSED)
	assert_true(not _p.input.break_held, "hold dropped on app pause")
	_mine_frames()
	assert_true(not _p.interaction.mining, "mining stopped")
	# The release that Android never sent must not resurrect anything either.
	for i in 10:
		hud._process(0.05)
	assert_true(not _p.input.break_held, "still off without the missing release")
	_teardown_world()

func test_the_attack_button_cannot_stay_held() -> void:
	var hud := _setup_world()
	var at := hud.button_rect("attack").get_center()
	hud._input(_touch(true, 0, at))
	hud._process(0.05)
	assert_true(_p.input.attack, "attack held by the button")
	_mine_frames()
	assert_true(_p.interaction.mining, "the attack button mines")
	hud._input(_touch(false, 0, at))
	assert_true(not _p.input.attack, "released")
	_mine_frames()
	assert_true(not _p.interaction.mining, "mining stopped")
	# Same button, but a screen opens instead of the finger lifting.
	hud._input(_touch(true, 0, at))
	hud._process(0.05)
	assert_true(_p.input.attack, "held again")
	_ui.open("inventory")
	assert_true(not _p.input.attack, "the screen opening released it")
	Game.paused_by_ui = false
	_mine_frames()
	assert_true(not _p.interaction.mining, "mining stopped")
	_ui.close("inventory")
	_teardown_world()

func test_watchdog_stops_mining_when_no_touch_is_down() -> void:
	var hud := _setup_world()
	# Forge the exact broken state the bug report describes: a hold with no finger behind it.
	_p.input.set_break_held(true, 4)
	_p.input.set_touch_action("attack", true, 4)
	_p.input.touch_count = 0
	_mine_frames()
	assert_true(not _p.input.break_held, "watchdog dropped the orphan hold")
	assert_true(not _p.input.attack, "watchdog dropped the orphan attack")
	assert_true(not _p.interaction.mining, "not mining")
	assert_eq(hud.touch_count(), 0, "no finger")
	_teardown_world()

func test_mining_stops_when_the_target_block_changes() -> void:
	var hud := _setup_world()
	_hold_look(hud)
	_mine_frames()
	assert_true(_p.interaction.mining, "mining")
	var w: MiningWorld = _world
	w.block = Vector3i(9, 70, 9)
	_p.interaction._process(0.05)
	assert_eq(_p.interaction.break_progress, 0.05, "progress restarted on the new block")
	w.hit = false
	_p.interaction._process(0.05)
	assert_true(not _p.interaction.mining, "nothing under the crosshair -> not mining")
	hud._input(_touch(false, 0, Vector2(640.0, 320.0)))
	_teardown_world()

func test_a_look_drag_is_not_a_mining_hold() -> void:
	var hud := _setup_world()
	hud._input(_touch(true, 0, Vector2(640.0, 320.0)))
	for i in 4:
		hud._input(_drag(0, Vector2(640.0, 320.0 + 20.0 * float(i + 1)), Vector2(0.0, 20.0)))
		hud._process(0.05)
	for i in 8:
		hud._process(0.05)
	assert_true(not _p.input.break_held, "a drag looks around, it does not mine")
	_mine_frames()
	assert_true(not _p.interaction.mining, "not mining")
	hud._input(_touch(false, 0, Vector2(640.0, 420.0)))
	_teardown_world()

func test_keyboard_poll_ignores_the_mouse_button_android_fakes_from_a_touch() -> void:
	# Root cause of the report: `attack` is bound to mouse button 1 and Android's
	# emulate_mouse_from_touch fabricates that button from *any* finger, so polling
	# Input.is_action_pressed("attack") held the mining state down for every touch.
	var inp := PlayerInput.new()
	var kb := KeyboardInput.new(inp)
	assert_true(_is_mouse_bound("attack"), "attack is bound to a mouse button only")
	assert_true(_is_mouse_bound("use"), "use too")
	# What emulate_mouse_from_touch does to the Input singleton when a finger goes down:
	Input.action_press("attack")
	assert_true(Input.is_action_pressed("attack"), "the fake mouse button is down")
	inp.touch_input = true                       # this session is driven by fingers
	kb.poll()
	assert_true(not inp.attack, "the emulated mouse button does not mine")
	inp.touch_input = false
	inp.touch_count = 1
	kb.poll()
	assert_true(not inp.attack, "nor while a finger is down")
	# A real desktop mouse, captured and with no touch in sight, still works.
	inp.touch_count = 0
	kb.mouse_captured = true
	kb.poll()
	assert_true(inp.attack, "a captured desktop mouse still attacks")
	Input.action_release("attack")
	kb.poll()
	assert_true(not inp.attack, "released with the button")

func _is_mouse_bound(action: String) -> bool:
	for ev in InputMap.action_get_events(action):
		if not (ev is InputEventMouseButton):
			return false
	return true

func test_keyboard_poll_does_not_clobber_a_held_touch_button() -> void:
	# The touch HUD's "press" buttons are held state; polling every action each frame used to
	# zero them one frame later (which is why holding Jump while flying never ascended).
	var inp := PlayerInput.new()
	var kb := KeyboardInput.new(inp)
	inp.set_touch_action("jump", true, 0)
	kb.poll()
	assert_true(inp.jump, "the finger still holds jump after a keyboard poll")
	assert_eq(inp.jump_press_count, 1, "exactly one press edge, not one per frame")
	kb.poll()
	assert_eq(inp.jump_press_count, 1, "still one edge")
	inp.release_touch_index(0)
	assert_true(not inp.jump, "released with the finger")

# --- bug 3: jump = fly ------------------------------------------------------

## A player standing on the fallback ground plane, with flight either allowed or not.
func _flyer(can_fly: bool) -> Player:
	Game.profile = ProfileFactory.new_profile("Flyer", "saiyan", "male", "warrior")
	var sk: Dictionary = Game.profile.get("skills", {})
	sk["fly"] = 1 if can_fly else 0
	Game.profile["skills"] = sk
	var p := Player.new()
	add_node(p)
	p.infinite_ki = true
	p.global_position = Vector3(0.5, Player.FALLBACK_GROUND, 0.5)
	p.velocity = Vector3.ZERO
	p.on_ground = true
	p.tick(0.05)                                 # settle on the ground plane
	p.on_ground = true
	return p

func _tap_jump(p: Player, hold_frames := 1, dt := 0.05) -> void:
	p.input.set_touch_action("jump", true, 0)
	p.input.touch_count = 1
	for i in hold_frames:
		p.tick(dt)
	p.input.set_touch_action("jump", false, 0)
	p.input.touch_count = 0

func _wait(p: Player, seconds: float) -> void:
	var n := int(seconds / 0.05)
	for i in n:
		p.tick(0.05)

func test_one_jump_tap_jumps_and_does_not_fly() -> void:
	var p := _flyer(true)
	assert_true(p.flight_allowed(), "flight unlocked")
	_tap_jump(p)
	assert_true(p.velocity.y > 1.0, "jumped: vy=%f" % p.velocity.y)
	assert_true(not p.is_flying, "one tap never takes off")
	p.queue_free()
	Game.profile = {}
	Game.player = null

func test_two_quick_jump_taps_take_off() -> void:
	var p := _flyer(true)
	_tap_jump(p)
	_tap_jump(p)                                 # ~0.05 s later, well inside DOUBLE_TAP_TIME
	assert_true(p.is_flying, "double tap took off")
	assert_true(p.velocity.y >= 0.0, "no second ground jump was queued")
	p.queue_free()
	Game.profile = {}
	Game.player = null

func test_two_quick_jump_taps_while_flying_land() -> void:
	var p := _flyer(true)
	p.is_flying = true
	p.tick(0.05)
	_tap_jump(p)
	_tap_jump(p)
	assert_true(not p.is_flying, "double tap while flying stops the flight")
	p.queue_free()
	Game.profile = {}
	Game.player = null

func test_a_slow_double_tap_is_two_jumps() -> void:
	var p := _flyer(true)
	_tap_jump(p)
	assert_true(p.velocity.y > 1.0, "first jump")
	_wait(p, Player.DOUBLE_TAP_TIME + 0.15)      # outside the window
	p.global_position = Vector3(0.5, Player.FALLBACK_GROUND, 0.5)
	p.velocity = Vector3.ZERO
	p.on_ground = true
	_tap_jump(p)
	assert_true(p.velocity.y > 1.0, "second jump: vy=%f" % p.velocity.y)
	assert_true(not p.is_flying, "a slow double tap never flies")
	p.queue_free()
	Game.profile = {}
	Game.player = null

func test_a_double_tap_does_not_queue_two_jumps() -> void:
	var p := _flyer(true)
	# Both taps inside one frame (a 60 fps phone does this): one jump, then take-off.
	p.input.set_touch_action("jump", true, 0)
	p.input.set_touch_action("jump", false, 0)
	p.input.set_touch_action("jump", true, 0)
	p.input.set_touch_action("jump", false, 0)
	assert_eq(p.input.jump_press_count, 2, "both edges survive inside one frame")
	p.tick(0.05)
	assert_true(p.is_flying, "took off")
	assert_true(p.jump_consumed, "the second tap was consumed by the take-off")
	p.queue_free()
	Game.profile = {}
	Game.player = null

func test_a_double_tap_without_the_fly_skill_is_just_two_jumps() -> void:
	var p := _flyer(false)
	assert_true(not p.flight_allowed(), "fly not unlocked")
	_tap_jump(p)
	var vy := p.velocity.y
	assert_true(vy > 1.0, "still jumps")
	_tap_jump(p)
	assert_true(not p.is_flying, "no flight without the skill")
	p.queue_free()
	Game.profile = {}
	Game.player = null

func test_ki_runs_out_and_the_double_tap_respects_the_unlock() -> void:
	var p := _flyer(true)
	p.infinite_ki = false
	p.creative_flight = false
	_tap_jump(p)
	_tap_jump(p)
	assert_true(p.is_flying, "took off")
	p.ki = 0.0
	p.tick(0.05)
	assert_true(not p.is_flying, "no ki, no flight (Player/_update_modes still rules)")
	p.queue_free()
	Game.profile = {}
	Game.player = null

func test_the_dedicated_fly_button_still_toggles_flight() -> void:
	var p := _flyer(true)
	p.input.toggle_fly = true
	p.tick(0.05)
	assert_true(p.is_flying, "fly button took off")
	p.input.toggle_fly = true
	p.tick(0.05)
	assert_true(not p.is_flying, "fly button landed")
	p.input.press("fly")
	p.tick(0.05)
	assert_true(p.is_flying, "the fly action works too")
	p.input.release("fly")
	p.queue_free()
	Game.profile = {}
	Game.player = null

func test_holding_jump_while_flying_ascends() -> void:
	var p := _flyer(true)
	_tap_jump(p)
	_tap_jump(p)
	assert_true(p.is_flying, "flying")
	p.velocity.y = 0.0
	p.input.set_touch_action("jump", true, 0)
	p.input.touch_count = 1
	for i in 6:
		p.tick(0.05)
	assert_true(p.velocity.y > 1.0, "holding jump climbs: vy=%f" % p.velocity.y)
	var up := p.global_position.y
	p.input.set_touch_action("sneak", true, 1)
	p.input.set_touch_action("jump", false, 0)
	for i in 10:
		p.tick(0.05)
	assert_true(p.velocity.y < 0.0, "holding sneak descends: vy=%f" % p.velocity.y)
	assert_true(p.global_position.y < up + 0.5, "went back down")
	p.input.clear_all()
	p.queue_free()
	Game.profile = {}
	Game.player = null

func test_the_hud_jump_button_drives_the_whole_chain() -> void:
	var hud := _setup_world()
	var sk: Dictionary = Game.profile.get("skills", {})
	sk["fly"] = 1
	Game.profile["skills"] = sk
	_p.infinite_ki = true
	_p.world = null                              # flat fallback ground, no voxel physics needed
	_p.global_position = Vector3(0.5, Player.FALLBACK_GROUND, 0.5)
	_p.on_ground = true
	var at := hud.button_rect("jump").get_center()
	# One real tap on the real button.
	hud._input(_touch(true, 0, at))
	hud._process(0.02)
	_p.tick(0.05)
	hud._input(_touch(false, 0, at))
	assert_true(_p.velocity.y > 1.0, "the HUD jump button jumps: vy=%f" % _p.velocity.y)
	assert_true(not _p.is_flying, "one tap does not fly")
	# A second real tap inside the double-tap window.
	hud._input(_touch(true, 0, at))
	hud._process(0.02)
	_p.tick(0.05)
	hud._input(_touch(false, 0, at))
	assert_true(_p.is_flying, "two taps on the HUD jump button take off")
	assert_true(not _p.input.jump, "the button is not stuck down")
	_teardown_world()
