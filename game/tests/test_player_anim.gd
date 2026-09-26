extends TestCase
## PlayerAnimator: the player's state maps onto the shared animation STATES owned by
## scripts/entity/PlayerModel.gd + AnimSelect.gd (never onto raw clip names).

func _st(over: Dictionary = {}) -> Dictionary:
	var base := {
		"velocity": Vector3.ZERO, "move": Vector2.ZERO, "on_ground": true, "in_water": false,
		"swimming": false, "flying": false, "fly_fast": false, "sneaking": false,
		"sprinting": false, "climbing": false, "crawling": false,
		"dead": false, "mining": false, "ki_charge": false,
	}
	for k in over.keys():
		base[k] = over[k]
	return base

func test_idle_walk_run() -> void:
	assert_eq(PlayerAnimator.locomotion_state(_st()), "idle", "idle")
	assert_eq(PlayerAnimator.locomotion_state(_st({"velocity": Vector3(2, 0, 0), "move": Vector2(0, 1)})),
		"walk", "walk")
	assert_eq(PlayerAnimator.locomotion_state(_st({"velocity": Vector3(5.6, 0, 0), "move": Vector2(0, 1),
		"sprinting": true})), "run", "sprint runs")

func test_sneak_states() -> void:
	assert_eq(PlayerAnimator.locomotion_state(_st({"sneaking": true})), "sneak", "sneak")
	assert_eq(PlayerAnimator.locomotion_state(_st({"sneaking": true, "velocity": Vector3(1.4, 0, 0),
		"move": Vector2(0, 1)})), "sneak_walk", "sneak walk")

func test_jump_and_fall() -> void:
	assert_eq(PlayerAnimator.locomotion_state(_st({"on_ground": false, "velocity": Vector3(0, 5, 0)})),
		"jump", "rising")
	assert_eq(PlayerAnimator.locomotion_state(_st({"on_ground": false, "velocity": Vector3(0, -9, 0)})),
		"fall", "falling")

func test_flight_states() -> void:
	assert_eq(PlayerAnimator.locomotion_state(_st({"flying": true})), "fly_idle", "hover")
	assert_eq(PlayerAnimator.locomotion_state(_st({"flying": true, "velocity": Vector3(6, 0, 0),
		"move": Vector2(0, 1)})), "fly_forward", "fly forward")
	assert_eq(PlayerAnimator.locomotion_state(_st({"flying": true, "fly_fast": true,
		"velocity": Vector3(20, 0, 0), "move": Vector2(0, 1)})), "fly_fast", "fly fast")

func test_swim_charge_and_death_override() -> void:
	assert_eq(PlayerAnimator.locomotion_state(_st({"in_water": true, "swimming": true,
		"velocity": Vector3(2, 0, 0), "move": Vector2(0, 1)})), "swim_forward", "swim")
	assert_eq(PlayerAnimator.locomotion_state(_st({"ki_charge": true, "velocity": Vector3(3, 0, 0),
		"move": Vector2(0, 1)})), "ki_charge", "charging beats walking")
	assert_eq(PlayerAnimator.locomotion_state(_st({"dead": true, "flying": true})), "death", "death wins")
	assert_ne(PlayerAnimator.locomotion_state(_st({"mining": true, "ki_charge": true})), "ki_charge",
		"mining is an upper-body action, not a charge")

func test_every_state_the_animator_uses_exists_in_AnimSelect() -> void:
	var known: Array = AnimSelect.states()
	for st in ["idle", "walk", "run", "jump", "fall", "land", "sneak", "sneak_walk", "swim_forward",
			"swim_idle", "fly_idle", "fly_forward", "fly_fast", "ki_charge", "death"]:
		assert_true(known.has(st), "locomotion state " + st)
	for key in PlayerAnimator.BUTTON_ACTIONS.keys():
		for st in PlayerAnimator.BUTTON_ACTIONS[key]:
			assert_true(known.has(String(st)), "%s action state %s" % [key, st])
	for st in PlayerAnimator.ACTION_HOLD.keys():
		assert_true(known.has(String(st)), "hold table state " + String(st))

func test_touch_buttons_map_to_actions() -> void:
	for b in ["attack", "ki_blast", "ki_charge", "fly", "dash", "transform", "technique"]:
		assert_true(PlayerAnimator.BUTTON_ACTIONS.has(b), "button " + b)
	assert_eq(PlayerAnimator.BUTTON_ACTIONS["attack"].size(), 3, "three punch steps")

func test_state_dict_reads_the_player() -> void:
	Game.profile = ProfileFactory.new_profile("Anim", "saiyan", "male", "warrior")
	var p := Player.new()
	add_node(p)
	p.velocity = Vector3(3.0, 0.0, 0.0)
	p.on_ground = true
	p.input.move = Vector2(0, 1)
	var d := PlayerAnimator.state_dict(p)
	assert_eq(d["on_ground"], true, "on ground")
	assert_eq(Vector3(d["velocity"]).x, 3.0, "velocity")
	assert_eq(PlayerAnimator.locomotion_state(d), "walk", "walking")
	p.queue_free()
	Game.profile = {}
	Game.player = null

func test_animator_drives_a_live_player() -> void:
	Game.profile = ProfileFactory.new_profile("Anim", "saiyan", "male", "warrior")
	var p := Player.new()
	add_node(p)
	assert_true(p.animator != null, "animator built")
	p.input.move = Vector2(0, 1)
	p.velocity = Vector3(3.0, 0.0, 0.0)
	p.on_ground = true
	p.animator.update(0.016)
	assert_eq(p.animator.state, "walk", "walking state")
	p.is_sprinting = true
	p.velocity = Vector3(5.6, 0.0, 0.0)
	p.animator.update(0.016)
	assert_eq(p.animator.state, "run", "running state")
	p.is_flying = true
	p.animator.update(0.016)
	assert_eq(p.animator.state, "fly_forward", "flying state")
	p.is_flying = false
	p.dead = true
	p.animator.update(0.016)
	assert_eq(p.animator.state, "death", "death state")
	p.queue_free()
	Game.profile = {}
	Game.player = null

func test_live_player_actually_plays_the_action_clips() -> void:
	Game.profile = ProfileFactory.new_profile("Anim", "saiyan", "male", "warrior")
	var p := Player.new()
	add_node(p)
	if p.anim == null:
		p.queue_free()
		return                                   # no animation assets in this checkout
	for st in ["idle", "walk", "run", "jump", "attack1", "attack2", "attack3", "ki_blast",
			"ki_charge", "mine", "eat", "transform", "death"]:
		assert_true(p.has_state(st), "model knows state " + st)
		assert_true(String(p.clip_for(st)) != "", "state %s resolves to a clip" % st)
	assert_true(PlayerModel.punch(p, 0), "punch 1 plays")
	assert_true(PlayerModel.punch(p, 1), "punch 2 plays")
	assert_true(PlayerModel.punch(p, 2), "punch 3 plays")
	assert_true(p.play_action("ki_blast"), "ki blast plays")
	assert_true(p.set_locomotion("run", 5.6), "locomotion plays")
	p.queue_free()
	Game.profile = {}
	Game.player = null

func test_combo_cycles_three_punches() -> void:
	var seen := PackedStringArray()
	for i in 4:
		seen.append(String(PlayerAnimator.BUTTON_ACTIONS["attack"][posmod(i, 3)]))
	assert_eq(seen[0], "attack1", "first")
	assert_eq(seen[1], "attack2", "second")
	assert_eq(seen[2], "attack3", "third")
	assert_eq(seen[3], "attack1", "wraps")
