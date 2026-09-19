extends TestCase
## Stats math: level, derived values, race/class/form multipliers, raise costs.

func _base() -> Stats:
	# human/warrior: every class multiplier is 1.0 (warrior is the reference scaling)
	return Stats.create("human", "warrior")

func test_level_from_total_points() -> void:
	var s := _base()
	assert_eq(s.total_points(), 35, "7 stats x 5 points")
	assert_eq(s.level(), 8, "1 + 35/5")
	s.points["STR"] = 105
	assert_eq(s.total_points(), 135)
	assert_eq(s.level(), 28)

func test_derived_values() -> void:
	var s := _base()
	# human ENE multiplier is 1.1 -> effective ENE = 5.5
	assert_near(s.effective("VIT"), 5.0)
	assert_near(s.effective("ENE"), 5.5)
	assert_near(s.max_health(), 100.0 + 5.0 * 10.0)
	assert_near(s.max_ki(), 100.0 + 5.5 * 8.0)
	assert_near(s.max_stamina(), 100.0 + 5.0 * 6.0)
	assert_near(s.melee(), 5.0 + 5.0 * 1.2)
	assert_near(s.ki_damage(), 5.0 + 5.0 * 1.4)
	assert_near(s.defense(), 5.0 * 0.9)

func test_power_release_scales_offense_not_pools() -> void:
	var s := _base()
	var hp := s.max_health()
	var melee := s.melee()
	s.power_release = 0.5
	assert_near(s.max_health(), hp, 0.001, "pools ignore power release")
	assert_near(s.melee(), melee * 0.5, 0.001)
	assert_near(s.defense(), 5.0 * 0.9 * 0.5)

func test_form_multipliers_multiply() -> void:
	var s := _base()
	var base_melee := s.melee()
	s.set_form_multipliers({"STR": 1.5, "PWR": 1.5, "RES": 1.3125, "SPEED": 1.1})
	assert_near(s.effective("STR"), 7.5)
	assert_near(s.melee(), 5.0 + 7.5 * 1.2)
	assert_true(s.melee() > base_melee)
	assert_near(s.defense(), 5.0 * 1.3125 * 0.9)
	s.clear_form_multipliers()
	assert_near(s.melee(), base_melee)

func test_race_multipliers_come_from_data() -> void:
	var saiyan := Stats.create("saiyan", "warrior")
	# data/races.json: saiyan STR 1.1, PWR 1.1
	assert_near(saiyan.race_mult("STR"), 1.1, 0.0001, "saiyan STR multiplier")
	assert_near(saiyan.effective("STR"), 5.5)
	var unknown := Stats.create("no_such_race", "no_such_class")
	assert_near(unknown.race_mult("STR"), 1.0, 0.0001, "unknown race falls back to 1.0")
	assert_near(unknown.class_mult("STR"), 1.0, 0.0001)

func test_raise_cost_curve() -> void:
	var s := _base()
	# floor(40 * 1.08 ^ (points_in_stat / 5))
	assert_eq(s.next_cost("STR"), 40)
	assert_eq(s.raise_cost("STR", 1), 40)
	assert_eq(s.raise_cost("STR", 5), int(floor(40.0 * pow(1.08, 0.0))) + int(floor(40.0 * pow(1.08, 0.2)))
		+ int(floor(40.0 * pow(1.08, 0.4))) + int(floor(40.0 * pow(1.08, 0.6))) + int(floor(40.0 * pow(1.08, 0.8))))

func test_raise_applies_points_and_returns_cost() -> void:
	var s := _base()
	var cost := s.raise("STR", 3)
	assert_eq(s.raw("STR"), 8)
	assert_eq(int(s.bought["STR"]), 3)
	assert_eq(cost, s.raise_cost("STR", 0) + 40 + int(floor(40.0 * pow(1.08, 0.2))) + int(floor(40.0 * pow(1.08, 0.4))))
	# the curve keeps climbing
	assert_true(s.next_cost("STR") >= 40)
	assert_eq(s.raise("NOPE", 3), 0, "unknown stat costs nothing and changes nothing")

func test_profile_round_trip() -> void:
	var s := _base()
	s.raise("VIT", 7)
	s.power_release = 0.8
	var profile := {"character": {"race": "human", "class": "warrior"}, "stats": {}}
	s.to_profile(profile)
	var s2 := Stats.new().from_profile(profile)
	assert_eq(s2.raw("VIT"), s.raw("VIT"))
	assert_eq(int(s2.bought["VIT"]), 7)
	assert_near(s2.power_release, 0.8)
	assert_near(s2.max_health(), s.max_health())

func test_from_entity_def() -> void:
	var s := Stats.new().from_entity_def({"stats": {"health": 450, "melee": 22, "ki": 39, "defense": 4}})
	assert_true(s.max_health() >= 400.0, "health from the entity def: " + str(s.max_health()))
	assert_true(s.melee() >= 20.0, "melee from the entity def: " + str(s.melee()))
	assert_true(s.defense() > 0.0)

func test_regen_from_class_data() -> void:
	var s := _base()
	# warrior baseHp5 1.75 / 5 s + 0.06/5 per VIT
	# human race multipliers: health_regen 1.0, ki_regen 1.15 (data/races.json)
	assert_near(s.health_regen(), (1.75 + 0.06 * 5.0) / 5.0 * s.race_mult("health_regen"), 0.0001)
	assert_near(s.ki_regen(), (4.0 + 0.08 * 5.5) / 5.0 * s.race_mult("ki_regen"), 0.0001)
	assert_near(s.stamina_regen(), (12.0 + 0.12 * 5.0) / 5.0, 0.0001)

func test_speed_and_battle_power_are_sane() -> void:
	var s := _base()
	assert_near(s.speed_mult(), 1.0 + 5.0 * 0.004)
	s.set_form_multipliers({"SPEED": 1.2})
	assert_true(s.speed_mult() > 1.2 * 0.9)
	assert_true(s.battle_power() > 0.0)
