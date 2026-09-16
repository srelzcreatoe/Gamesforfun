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
