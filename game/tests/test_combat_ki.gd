extends TestCase
## Ki pool: charge math, costs, stamina, power release and passive regen.

var dummy: FxDummy
var ki: Ki

func setup() -> void:
	dummy = FxDummy.create("human", "warrior")
	add_node(dummy)
	ki = Ki.get_for(dummy)

func teardown() -> void:
	if dummy != null and is_instance_valid(dummy):
		dummy.queue_free()
	dummy = null
	ki = null

func test_pools_come_from_stats() -> void:
	assert_near(ki.max_ki(), dummy.stats.max_ki())
	assert_near(ki.max_stamina(), dummy.stats.max_stamina())
	assert_near(ki.ki(), dummy.max_ki, 0.001, "starts full")
	assert_near(ki.ki_fraction(), 1.0)

func test_charge_rate_is_twelve_percent_per_level() -> void:
	dummy.skills["ki_control"] = 1
	dummy.skills["ki_boost"] = 0
	assert_near(ki.charge_rate(), 0.12 * ki.max_ki())
	dummy.skills["ki_control"] = 3
	assert_near(ki.charge_rate(), 0.12 * ki.max_ki() * 3.0)

func test_charging_adds_ki_over_time() -> void:
	dummy.skills["ki_control"] = 1
	dummy.skills["ki_boost"] = 0
	ki.set_ki(0.0)
	ki.set_charging(true)
	assert_true(ki.is_charging())
	for i in 10:
		ki._process(0.1)          # one second in ten steps
	assert_near(ki.ki(), 0.12 * ki.max_ki(), 0.5, "12 % of max ki in one second")
	assert_true(ki.charged_amount > 0.0)
	ki.set_charging(false)
	assert_true(not ki.is_charging())

func test_charging_is_capped_at_max() -> void:
	ki.set_ki(ki.max_ki() - 1.0)
	ki.set_charging(true)
	for i in 30:
		ki._process(0.1)
	assert_near(ki.ki(), ki.max_ki(), 0.001)

func test_costs_are_fractions_of_max_ki() -> void:
	assert_near(ki.cost_of(0.3), ki.max_ki() * 0.3)
	var before := ki.ki()
	assert_true(ki.spend_fraction(0.3))
	assert_near(ki.ki(), before - ki.max_ki() * 0.3, 0.001)
	ki.set_ki(1.0)
	assert_true(not ki.can_spend(50.0))
	assert_true(not ki.spend(50.0), "a spend that cannot be paid changes nothing")
	assert_near(ki.ki(), 1.0)

func test_stamina_costs_and_regen() -> void:
	var before := ki.stamina()
	assert_true(ki.spend_stamina(Ki.MELEE_STAMINA))
	assert_near(ki.stamina(), before - Ki.MELEE_STAMINA, 0.001)
	assert_true(ki.stamina_locked > 0.0, "regen is delayed after a spend")
	# burn the lock, then regen
	for i in 10:
		ki._process(0.1)
	var mid := ki.stamina()
	for i in 20:
		ki._process(0.1)
	assert_true(ki.stamina() > mid, "stamina regenerates once the lock expires")
	ki.set_stamina(1.0)
	assert_true(not ki.spend_stamina(50.0))

func test_passive_regen_scales_with_power_release() -> void:
	ki.set_ki(0.0)
	ki.set_power_release(1.0)
	for i in 10:
		ki._process(0.1)
	var high_release := ki.ki()
	ki.set_ki(0.0)
	ki.set_power_release(0.2)
	for i in 10:
		ki._process(0.1)
	assert_true(ki.ki() > high_release, "a low power release regenerates faster")

func test_power_release_bounds_and_potential_unlock() -> void:
	dummy.skills["potential_unlock"] = 0
	ki.set_power_release(5.0)
	assert_near(ki.power_release, 1.0, 0.001, "capped at 100 % without potential unlock")
	ki.set_power_release(0.0)
	assert_near(ki.power_release, Ki.RELEASE_MIN, 0.001)
	dummy.skills["potential_unlock"] = 5
	assert_near(ki.release_cap(), 1.0 + 0.03 * 5.0, 0.0001)
	ki.set_power_release(2.0)
	assert_near(ki.power_release, 1.15, 0.0001)
	assert_near(dummy.stats.power_release, ki.power_release, 0.0001, "pushed into Stats")

func test_get_for_is_idempotent() -> void:
	var again := Ki.get_for(dummy)
	assert_true(again == ki, "one Ki node per entity")
	assert_true(Ki.find_on(dummy) == ki)
	var bare := Node3D.new()
	add_node(bare)
	assert_true(Ki.find_on(bare) == null, "find_on does not create")
	bare.queue_free()
