extends TestCase
## Damage formulas: defense mitigation, crit chance from SKP, ki protection,
## knockback, kinds and the difficulty multiplier.

func test_defense_mitigation() -> void:
	assert_near(Damage.mitigate(100.0, 0.0), 100.0)
	assert_near(Damage.mitigate(100.0, 100.0), 50.0)
	assert_near(Damage.mitigate(100.0, 300.0), 25.0)
	assert_near(Damage.mitigate(50.0, 25.0), 50.0 * 100.0 / 125.0)
	assert_near(Damage.mitigate(10.0, -50.0), 10.0, 0.001, "negative defense is clamped to 0")

func test_crit_chance_from_skp() -> void:
	assert_near(Damage.crit_chance(0.0), 0.02)
	assert_near(Damage.crit_chance(100.0), 0.02 + 0.3)
	assert_near(Damage.crit_chance(10000.0), 0.5, 0.0001, "capped at 50%")
	assert_true(Damage.CRIT_MULT > 1.0)

func test_crit_roll_is_bounded() -> void:
	Damage.rng.seed = 12345
	var hits := 0
	for i in 400:
		if Damage.roll_crit(0.0):
			hits += 1
	assert_true(hits < 60, "2%% crit chance should not fire 15%% of the time (%d/400)" % hits)
	hits = 0
	for i in 400:
		if Damage.roll_crit(10000.0):
			hits += 1
	assert_true(hits > 140, "50%% crit chance should fire often (%d/400)" % hits)

func test_ki_protection_absorbs_and_costs_ki() -> void:
	var r := Damage.ki_protection(100.0, 4, 1000.0)
	# absorb_per_level 0.05 (data/skills.json) -> 20 % of 100
	assert_near(float(r["absorbed"]), 20.0)
	assert_near(float(r["damage"]), 80.0)
	assert_near(float(r["ki_spent"]), 10.0, 0.001, "0.5 ki per absorbed point")
	assert_near(float(Damage.ki_protection(100.0, 0, 1000.0)["damage"]), 100.0, 0.001, "level 0 does nothing")

func test_ki_protection_limited_by_the_pool() -> void:
	var r := Damage.ki_protection(100.0, 10, 4.0)
	assert_near(float(r["absorbed"]), 8.0, 0.001, "only 4 ki -> 8 damage absorbed")
	assert_near(float(r["damage"]), 92.0)
	assert_near(float(r["ki_spent"]), 4.0)

func test_ki_protection_capped() -> void:
	var r := Damage.ki_protection(100.0, 100, 100000.0)
	assert_near(float(r["absorbed"]), 75.0, 0.001, "cap is 75 %")

func test_resolve_applies_defense_then_protection() -> void:
	var r := Damage.resolve(100.0, 2.0, 100.0, Damage.KI, 0.0, 0, 0.0, false)
	assert_near(float(r["raw"]), 200.0)
	assert_near(float(r["amount"]), 100.0, 0.001, "200 mitigated by 100 defense")
	var crit := Damage.resolve(100.0, 1.0, 0.0, Damage.MELEE, 0.0, 0, 0.0, true)
	assert_true(bool(crit["crit"]))
	assert_near(float(crit["amount"]), 100.0 * Damage.CRIT_MULT)

func test_unmitigated_kinds_ignore_defense() -> void:
	for kind in [Damage.FALL, Damage.DROWN, Damage.VOID, Damage.PLANET]:
		var r := Damage.resolve(80.0, 1.0, 500.0, kind)
		assert_near(float(r["amount"]), 80.0, 0.001, kind + " must ignore defense")
		assert_true(not bool(r["crit"]), kind + " cannot crit")
	assert_true(Damage.is_mitigated(Damage.MELEE))
	assert_true(not Damage.is_mitigated(Damage.VOID))

func test_void_ignores_ki_protection() -> void:
	var r := Damage.resolve(50.0, 1.0, 0.0, Damage.VOID, 0.0, 10, 10000.0)
	assert_near(float(r["amount"]), 50.0, 0.001, "the void does not care about ki")

func test_knockback_direction_and_scale() -> void:
	var kb := Damage.knockback(50.0, Vector3(0, 5, -1))
	assert_near(kb.x, 0.0)
	assert_true(kb.z < 0.0, "pushed along the horizontal part of the direction")
	assert_true(kb.y > 0.0, "with a little lift")
	var big := Damage.knockback(100000.0, Vector3(1, 0, 0))
	assert_true(big.x <= Damage.KNOCKBACK_MAX + 0.001, "knockback is capped")
	var zero := Damage.knockback(10.0, Vector3.ZERO)
	assert_true(zero.length() > 0.0, "a zero direction still pushes somewhere")
	var resisted := Damage.knockback(50.0, Vector3(1, 0, 0), 100.0)
	assert_true(resisted.x < Damage.knockback(50.0, Vector3(1, 0, 0)).x)

func test_difficulty_multiplier() -> void:
	var prev: Dictionary = Game.world_info.duplicate()
	Game.world_info = {"difficulty": "hard"}
	assert_near(Damage.difficulty_mult(), 1.5)
	assert_near(Damage.apply_difficulty(100.0, true), 150.0, 0.001, "the player takes more on hard")
	assert_true(Damage.apply_difficulty(100.0, false) < 100.0, "and deals a little less")
	Game.world_info = {"difficulty": "easy"}
	assert_near(Damage.difficulty_mult(), 0.6)
	Game.world_info = {}
	assert_near(Damage.difficulty_mult(), 1.0)
	Game.world_info = prev

func test_deal_damage_to_a_fake_entity() -> void:
	var attacker := FxDummy.create("saiyan", "warrior")
	var victim := FxDummy.create("human", "tank")
	add_node(attacker)
	add_node(victim)
	victim.faction = "villain"
	var before := victim.health
	Damage.rng.seed = 7
	var applied := Damage.deal(victim, attacker, 1.0, Damage.MELEE)
	assert_true(applied > 0.0, "damage was applied")
	assert_near(victim.health, before - applied, 0.01)
	assert_near(victim.damage_taken, applied, 0.01)
	attacker.queue_free()
	victim.queue_free()
