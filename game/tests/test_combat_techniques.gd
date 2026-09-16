extends TestCase
## Technique executor: ki cost, charge, the release state machine and cooldowns.
## Uses FxDummy as the fake entity, so nothing here needs a world.

var dummy: FxDummy
var tech: Techniques
var ki: Ki
var _prev_player: Node = null

func setup() -> void:
	dummy = FxDummy.create("saiyan", "warrior")
	dummy.stats.raise("ENE", 200)          # a pool big enough for a kamehameha
	dummy.stats.raise("PWR", 100)
	dummy.refresh_derived()
	dummy.ki = dummy.max_ki
	add_node(dummy)
	ki = Ki.get_for(dummy)
	tech = Techniques.get_for(dummy)
	# the executor holds the charge for the player and auto-fires for the AI
	_prev_player = Game.player
	Game.player = dummy
	tech.auto_release = false

func teardown() -> void:
	Game.player = _prev_player
	if dummy != null and is_instance_valid(dummy):
		dummy.queue_free()
	dummy = null
	tech = null
	ki = null

func test_definitions_load_from_data_with_a_fallback() -> void:
	var kame := Techniques.def("kamehameha")
	assert_eq(String(kame.get("kind", "")), "beam")
	assert_near(float(kame.get("charge", 0.0)), 2.0)
	assert_true(Techniques.def("no_such_technique").is_empty())
	assert_eq(String(Techniques.def("ki_blast").get("kind", "")), "blast")

func test_begin_requires_ki() -> void:
	ki.set_ki(0.0)
	var c := tech.check("kamehameha")
	assert_true(not bool(c["ok"]))
	assert_eq(String(c["reason"]), "not enough ki")
	assert_true(not Techniques.begin(dummy, "kamehameha"))
	assert_eq(tech.state, Techniques.State.IDLE)

func test_begin_enters_charging_and_plays_the_cast_anim() -> void:
	assert_true(Techniques.begin(dummy, "kamehameha"))
	assert_eq(tech.state, Techniques.State.CHARGING)
	assert_eq(tech.current_id, "kamehameha")
	assert_eq(dummy.last_anim, "ki.kameha_cast")
	assert_near(Techniques.charge_progress(dummy), 0.0)
	assert_true(not Techniques.begin(dummy, "ki_blast"), "busy while charging")
	assert_true(not tech.auto_release, "the player holds the charge")

func test_charge_progress_reaches_one() -> void:
	Techniques.begin(dummy, "kamehameha")
	for i in 10:
		tech._process(0.1)
	assert_near(Techniques.charge_progress(dummy), 0.5, 0.02)
	for i in 15:
		tech._process(0.1)
	assert_near(Techniques.charge_progress(dummy), 1.0, 0.001, "clamped at 1")

func test_release_spends_ki_and_scales_damage_with_the_charge() -> void:
	var before := ki.ki()
	Techniques.begin(dummy, "kamehameha")
	for i in 20:
		tech._process(0.1)
	assert_true(Techniques.release(dummy))
	var cost := ki.max_ki() * 0.3
	assert_near(ki.ki(), before - cost, 0.5, "ki_cost is a fraction of max ki")
	assert_eq(dummy.last_anim, "ki.kameha_fire")
	# a beam keeps the executor ACTIVE for its duration
	assert_eq(tech.state, Techniques.State.ACTIVE)
	assert_true(Techniques.cooldown_left(dummy, "kamehameha") > 0.0)

func test_release_without_a_charge_does_nothing() -> void:
	assert_true(not Techniques.release(dummy), "nothing to release")
	assert_eq(tech.state, Techniques.State.IDLE)

func test_cancel_refunds_everything() -> void:
	var before := ki.ki()
	Techniques.begin(dummy, "kamehameha")
	tech._process(0.5)
	Techniques.cancel(dummy)
	assert_eq(tech.state, Techniques.State.IDLE)
	assert_near(ki.ki(), before, 0.001, "a cancelled charge costs no ki")

func test_cooldown_blocks_reuse() -> void:
	Techniques.begin(dummy, "ki_blast")
	assert_true(Techniques.release(dummy))
	var left := Techniques.cooldown_left(dummy, "ki_blast")
	assert_true(left > 0.0 and left <= 1.01, "ki_blast cooldown is 1 s, got " + str(left))
	var c := tech.check("ki_blast")
	assert_true(not bool(c["ok"]))
	assert_eq(String(c["reason"]), "cooling down")
	# a different technique is unaffected
	assert_true(bool(tech.check("kamehameha")["ok"]))

func test_instant_technique_can_be_tapped() -> void:
	var before := ki.ki()
	assert_true(Techniques.tap(dummy, "ki_blast"))
	assert_near(ki.ki(), before - ki.max_ki() * 0.05, 0.5)
	assert_eq(tech.state, Techniques.State.IDLE, "a blast leaves no active state")

func test_barrage_stays_active_for_its_duration() -> void:
	Techniques.begin(dummy, "ki_barrage")
	for i in 6:
		tech._process(0.1)
	assert_true(Techniques.release(dummy))
	assert_eq(tech.state, Techniques.State.ACTIVE)
	for i in 30:
		tech._process(0.1)
	assert_eq(tech.state, Techniques.State.IDLE, "the barrage ends after `duration`")

func test_explosion_technique_returns_to_idle_immediately() -> void:
	dummy.stats.raise("ENE", 2000)
	dummy.refresh_derived()
	dummy.ki = dummy.max_ki
	Techniques.begin(dummy, "final_explosion")
	for i in 40:
		tech._process(0.1)
	assert_true(Techniques.release(dummy))
	assert_near(ki.ki(), 0.0, 0.001, "Final Explosion drains all ki")
	assert_eq(tech.state, Techniques.State.IDLE)

func test_unknown_technique_is_rejected() -> void:
	var c := tech.check("not_a_technique")
	assert_true(not bool(c["ok"]))
	assert_eq(String(c["reason"]), "unknown technique")

func test_ai_auto_releases_when_fully_charged() -> void:
	Game.player = _prev_player          # the dummy is an NPC in this test
	dummy.faction = "villain"
	assert_true(Techniques.begin(dummy, "kienzan"))
	assert_true(tech.auto_release, "a non-player entity fires by itself")
	for i in 20:
		tech._process(0.1)
	assert_true(tech.state != Techniques.State.CHARGING, "the AI let it go")

func test_knows_technique_gate() -> void:
	dummy.techniques = ["ki_blast"] as Array[String]
	assert_true(bool(tech.check("ki_blast")["ok"]))
	var c := tech.check("kamehameha")
	assert_true(not bool(c["ok"]))
	assert_eq(String(c["reason"]), "not learned")
