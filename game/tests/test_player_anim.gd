extends TestCase
## PlayerAnimator: every movement state and every button-driven action maps to a real clip.

func _st(over: Dictionary = {}) -> Dictionary:
	var base := {
		"dead": false, "mining": false, "ki_charge": false, "flying": false, "fly_fast": false,
		"swimming": false, "on_ground": true, "on_ladder": false, "crouching": false,
		"sprinting": false, "speed": 0.0, "vy": 0.0,
	}
	for k in over.keys():
		base[k] = over[k]
	return base

func test_idle_walk_run() -> void:
	assert_eq(PlayerAnimator.locomotion_state(_st()), PlayerAnimator.STATE_IDLE, "idle")
	assert_eq(PlayerAnimator.locomotion_state(_st({"speed": 2.0})), PlayerAnimator.STATE_WALK, "walk")
	assert_eq(PlayerAnimator.locomotion_state(_st({"speed": 5.6, "sprinting": true})),
		PlayerAnimator.STATE_RUN, "sprint runs")
	assert_eq(PlayerAnimator.locomotion_state(_st({"speed": 5.2})), PlayerAnimator.STATE_RUN, "fast = run")

func test_sneak_states() -> void:
	assert_eq(PlayerAnimator.locomotion_state(_st({"crouching": true})), PlayerAnimator.STATE_SNEAK, "sneak")
	assert_eq(PlayerAnimator.locomotion_state(_st({"crouching": true, "speed": 1.4})),
		PlayerAnimator.STATE_SNEAK_WALK, "sneak walk")

func test_jump_and_fall() -> void:
	assert_eq(PlayerAnimator.locomotion_state(_st({"on_ground": false, "vy": 5.0})),
		PlayerAnimator.STATE_JUMP, "rising")
	assert_eq(PlayerAnimator.locomotion_state(_st({"on_ground": false, "vy": -9.0})),
		PlayerAnimator.STATE_FALL, "falling")
	assert_eq(PlayerAnimator.locomotion_state(_st({"on_ground": false, "on_ladder": true})),
		PlayerAnimator.STATE_IDLE, "ladders are not a fall")

func test_flight_states() -> void:
	assert_eq(PlayerAnimator.locomotion_state(_st({"flying": true})), PlayerAnimator.STATE_FLY_IDLE, "hover")
	assert_eq(PlayerAnimator.locomotion_state(_st({"flying": true, "speed": 6.0})),
		PlayerAnimator.STATE_FLY_MOVE, "fly forward")
	assert_eq(PlayerAnimator.locomotion_state(_st({"flying": true, "speed": 20.0, "fly_fast": true})),
		PlayerAnimator.STATE_FLY_FAST, "fly fast")

func test_swim_mine_charge_and_death_take_priority() -> void:
	assert_eq(PlayerAnimator.locomotion_state(_st({"swimming": true, "speed": 2.0})),
		PlayerAnimator.STATE_SWIM, "swim")
	assert_eq(PlayerAnimator.locomotion_state(_st({"mining": true, "speed": 3.0})),
		PlayerAnimator.STATE_MINING, "mining beats walking")
	assert_eq(PlayerAnimator.locomotion_state(_st({"ki_charge": true, "speed": 3.0})),
		PlayerAnimator.STATE_KI_CHARGE, "charge beats walking")
	assert_eq(PlayerAnimator.locomotion_state(_st({"dead": true, "flying": true})),
		PlayerAnimator.STATE_DEAD, "death wins")

func test_every_state_has_clip_candidates() -> void:
	for st in [PlayerAnimator.STATE_IDLE, PlayerAnimator.STATE_WALK, PlayerAnimator.STATE_RUN,
			PlayerAnimator.STATE_SNEAK, PlayerAnimator.STATE_SNEAK_WALK, PlayerAnimator.STATE_JUMP,
			PlayerAnimator.STATE_FALL, PlayerAnimator.STATE_SWIM, PlayerAnimator.STATE_FLY_IDLE,
			PlayerAnimator.STATE_FLY_MOVE, PlayerAnimator.STATE_FLY_FAST, PlayerAnimator.STATE_KI_CHARGE,
			PlayerAnimator.STATE_MINING, PlayerAnimator.STATE_DEAD]:
		var clips := PlayerAnimator.clips_for(st)
		assert_true(clips.size() > 0, st + " has candidates")
		assert_true(String(clips[0]).contains("."), st + " uses a namespaced clip")

func test_action_table_covers_the_touch_buttons() -> void:
	for a in ["attack1", "attack2", "attack3", "ki_blast", "ki_blast_charged", "ki_charge_cast",
			"technique_cast", "technique_fire", "transform", "hurt", "land", "eat", "dash", "death"]:
		assert_true(PlayerAnimator.ACTIONS.has(a), "action " + a)
		assert_true((PlayerAnimator.ACTIONS[a]["clips"] as Array).size() > 0, a + " has clips")
		assert_true(float(PlayerAnimator.ACTIONS[a]["time"]) > 0.0, a + " has a duration")

func test_clips_exist_in_the_shipped_animation_files() -> void:
	# Every first-choice clip must be a real clip name in assets/animations/entity/races/*.
	var known := {}
	for f in JsonUtil.list_files("res://assets/animations/entity/races", ".json", false):
		var d: Variant = JsonUtil.load_file(f)
		if d is Dictionary and (d as Dictionary).has("animations"):
			for k in ((d as Dictionary)["animations"] as Dictionary).keys():
				known[String(k)] = true
	if known.is_empty():
		return                                   # animation assets not built in this checkout
	for st in PlayerAnimator.LOCOMOTION.keys():
		var first := String(PlayerAnimator.LOCOMOTION[st][0])
		assert_true(known.has(first), "locomotion clip %s (%s) exists" % [first, st])
	for a in PlayerAnimator.ACTIONS.keys():
		var c := String(PlayerAnimator.ACTIONS[a]["clips"][0])
		assert_true(known.has(c), "action clip %s (%s) exists" % [c, a])

func test_animator_drives_a_live_player() -> void:
	Game.profile = ProfileFactory.new_profile("Anim", "saiyan", "male", "warrior")
	var p := Player.new()
	add_node(p)
	assert_true(p.animator != null, "animator built")
	p.velocity = Vector3(3.0, 0.0, 0.0)
	p.on_ground = true
	p.animator.update(0.016)
	assert_eq(p.animator.state, PlayerAnimator.STATE_WALK, "walking state")
	p.is_sprinting = true
	p.velocity = Vector3(5.6, 0.0, 0.0)
	p.animator.update(0.016)
	assert_eq(p.animator.state, PlayerAnimator.STATE_RUN, "running state")
	p.is_flying = true
	p.animator.update(0.016)
	assert_eq(p.animator.state, PlayerAnimator.STATE_FLY_MOVE, "flying state")
	p.play_action("attack", 0)
	assert_eq(p.animator.action, "attack1", "combo step 1")
	p.play_action("attack", 2)
	assert_eq(p.animator.action, "attack3", "combo step 3")
	p.animator.update(1.0)
	assert_eq(p.animator.action, "", "action expires")
	p.queue_free()
	Game.profile = {}
	Game.player = null
