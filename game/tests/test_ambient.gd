extends TestCase
## Ambient life (scripts/ambient/): the pure decision layer (what is alive for a given planet /
## biome / clock / weather), the quad budget, the node pools, and the Events handlers — which must
## survive being fired with no world at all.

const DAY := 3000.0 / 24000.0        # mid-morning
const NOON := 6000.0 / 24000.0
const DUSK := 11900.0 / 24000.0
const NIGHT := 17000.0 / 24000.0
const MIDNIGHT := 18000.0 / 24000.0

var _made: Array[Node] = []

func teardown() -> void:
	for n in _made:
		if is_instance_valid(n):
			if n is AmbientLife:
				(n as AmbientLife).unbind()
			if n is AmbientBoot:
				(n as AmbientBoot).install_enabled = false
				(n as AmbientBoot).uninstall()
			if n.get_parent() != null:
				n.get_parent().remove_child(n)
			n.queue_free()
	_made.clear()

func _stub(biome := "forest", planet := "earth", canopy := true) -> AmbientStubWorld:
	var w := AmbientStubWorld.new()
	w.setup(biome, planet, canopy)
	_made.append(w)
	return w

func _life(w: AmbientStubWorld) -> AmbientLife:
	var l := AmbientLife.new()
	add_node(l)
	_made.append(l)
	if w != null:
		l.bind(w)
	return l

func _cls(biome: String) -> int:
	return AmbientRules.classify(biome, Registry.biome(biome))

# --- time of day ------------------------------------------------------------------------------

func test_night_and_day_are_opposites() -> void:
	assert_eq(AmbientRules.night_amount(NOON), 0.0, "noon is not night")
	assert_eq(AmbientRules.night_amount(MIDNIGHT), 1.0, "midnight is fully night")
	assert_true(AmbientRules.is_night(NIGHT), "tick 17000 counts as night")
	assert_true(not AmbientRules.is_night(DAY), "tick 3000 is daytime")
	assert_eq(AmbientRules.day_amount(NOON), 1.0, "full day at noon")
	assert_eq(AmbientRules.day_amount(MIDNIGHT), 0.0, "no day at midnight")

func test_twilight_peaks_at_sunset_only() -> void:
	assert_true(AmbientRules.twilight_amount(DUSK) > 0.4, "dusk is twilight")
	assert_true(AmbientRules.twilight_amount(NOON) < 0.01, "noon is not twilight")
	assert_true(AmbientRules.twilight_amount(MIDNIGHT) < 0.01, "midnight is not twilight")
	assert_true(AmbientRules.twilight_amount(23800.0 / 24000.0) > 0.3, "dawn is twilight too")

# --- biome classification ----------------------------------------------------------------------

func test_biomes_classify_into_the_right_families() -> void:
	assert_eq(_cls("forest"), AmbientRules.Cls.FOREST, "forest")
	assert_eq(_cls("jungle"), AmbientRules.Cls.FOREST, "jungle")
	assert_eq(_cls("plains"), AmbientRules.Cls.PLAINS, "plains")
	assert_eq(_cls("swamp"), AmbientRules.Cls.SWAMP, "swamp")
	assert_eq(_cls("desert"), AmbientRules.Cls.DESERT, "desert")
	assert_eq(_cls("snowy_plains"), AmbientRules.Cls.SNOW, "snowy plains")
	assert_eq(_cls("ocean"), AmbientRules.Cls.WATER, "ocean")
	assert_eq(_cls("deep_space"), AmbientRules.Cls.VOID, "deep space")
	assert_eq(_cls("ajissa_plains"), AmbientRules.Cls.ALIEN, "namek is alien vegetation")
	assert_eq(_cls("hyperbolic_time_chamber"), AmbientRules.Cls.BARREN, "the time chamber is empty")

func test_classify_survives_unknown_biomes() -> void:
	assert_eq(AmbientRules.classify("", {}), AmbientRules.Cls.BARREN, "nothing known -> barren")
	assert_eq(AmbientRules.classify("nonsense_biome", {}), AmbientRules.Cls.PLAINS, "guessable default")

func test_flowers_and_grass_come_from_the_biome_data() -> void:
	assert_true(AmbientRules.has_flowers(Registry.biome("plains")), "plains list dandelions")
	assert_true(not AmbientRules.has_flowers(Registry.biome("desert")), "the desert has no flowers")
	assert_true(AmbientRules.has_grass(Registry.biome("plains")), "plains have grass")

# --- fireflies ---------------------------------------------------------------------------------

func test_fireflies_only_come_out_at_night() -> void:
	var f := AmbientRules.Cls.FOREST
	assert_eq(AmbientRules.firefly_count("earth", f, NOON, "clear", 80), 0, "none at noon")
	assert_true(AmbientRules.firefly_count("earth", f, MIDNIGHT, "clear", 80) > 40, "plenty at midnight")
	assert_true(AmbientRules.firefly_count("earth", AmbientRules.Cls.SWAMP, MIDNIGHT, "clear", 80) > 40, "swamps swarm")
	assert_true(AmbientRules.firefly_count("earth", AmbientRules.Cls.PLAINS, MIDNIGHT, "clear", 80) > 0, "plains have a few")
	assert_eq(AmbientRules.firefly_count("earth", AmbientRules.Cls.SNOW, MIDNIGHT, "clear", 80), 0, "not in the snow")

func test_fireflies_are_put_out_by_rain_and_by_the_void() -> void:
	var f := AmbientRules.Cls.FOREST
	var dry := AmbientRules.firefly_count("earth", f, MIDNIGHT, "clear", 80)
	var wet := AmbientRules.firefly_count("earth", f, MIDNIGHT, "rain", 80)
	assert_true(wet < dry, "rain puts fireflies out (%d < %d)" % [wet, dry])
	assert_eq(AmbientRules.firefly_count("universe_7_deep_space", AmbientRules.Cls.VOID, MIDNIGHT, "clear", 80), 0,
		"nothing lives in deep space")
	assert_eq(AmbientRules.firefly_count("orbit", AmbientRules.Cls.VOID, MIDNIGHT, "clear", 80), 0, "nor in orbit")

func test_firefly_colour_is_per_planet() -> void:
	var earth := AmbientRules.firefly_color("earth")
	var namek := AmbientRules.firefly_color("namek")
	var hell := AmbientRules.firefly_color("hell_planet")
	var vampa := AmbientRules.firefly_color("vampa")
	var other := AmbientRules.firefly_color("otherworld")
	assert_true(namek.g > namek.r and namek.g > namek.b, "Namek glows green")
	assert_true(hell.r > hell.g * 1.5 and hell.b < 0.3, "Hell burns orange")
	assert_eq(vampa, hell, "Vampa matches Hell")
	assert_true(other.r > 0.85 and other.g > 0.85 and other.b > 0.9, "the Other World is white")
	assert_true(earth.r > 0.9 and earth.g > 0.8 and earth.b < 0.6, "Earth fireflies are yellow")

# --- motes, leaves, butterflies, birds ---------------------------------------------------------

func test_mote_kinds_follow_planet_and_biome() -> void:
	assert_eq(AmbientRules.mote_kind("earth", AmbientRules.Cls.PLAINS, DAY, "clear"), AmbientRules.MOTE_POLLEN)
	assert_eq(AmbientRules.mote_kind("earth", AmbientRules.Cls.DESERT, DAY, "clear"), AmbientRules.MOTE_DUST)
	assert_eq(AmbientRules.mote_kind("earth", AmbientRules.Cls.SNOW, DAY, "clear"), AmbientRules.MOTE_SNOW)
	assert_eq(AmbientRules.mote_kind("earth", AmbientRules.Cls.SNOW, MIDNIGHT, "clear"), AmbientRules.MOTE_NONE,
		"snow only sparkles in the sun")
	assert_eq(AmbientRules.mote_kind("vampa", AmbientRules.Cls.BARREN, MIDNIGHT, "clear"), AmbientRules.MOTE_EMBER,
		"Vampa burns day and night")
	assert_eq(AmbientRules.mote_kind("heaven", AmbientRules.Cls.PLAINS, DAY, "clear"), AmbientRules.MOTE_SPIRIT)
	assert_eq(AmbientRules.mote_kind("orbit", AmbientRules.Cls.VOID, DAY, "clear"), AmbientRules.MOTE_NONE)
	assert_eq(AmbientRules.mote_kind("earth", AmbientRules.Cls.PLAINS, DAY, "rain"), AmbientRules.MOTE_NONE,
		"rain washes the pollen out of the air")

func test_mote_counts_respect_the_ceiling() -> void:
	for kind in [AmbientRules.MOTE_POLLEN, AmbientRules.MOTE_DUST, AmbientRules.MOTE_SNOW,
			AmbientRules.MOTE_EMBER, AmbientRules.MOTE_SPIRIT]:
		var n := AmbientRules.mote_count(String(kind), NOON, "clear", 40)
		assert_true(n > 0 and n <= 40, "%s count %d within 0..40" % [kind, n])
	assert_eq(AmbientRules.mote_count(AmbientRules.MOTE_NONE, NOON, "clear", 40), 0, "no kind, no motes")

func test_leaves_fall_harder_in_the_wind() -> void:
	var calm := AmbientRules.leaf_rate(AmbientRules.Cls.FOREST, "clear", 0.0)
	var gusty := AmbientRules.leaf_rate(AmbientRules.Cls.FOREST, "clear", 1.0)
	var storm := AmbientRules.leaf_rate(AmbientRules.Cls.FOREST, "thunder", 0.0)
	assert_true(calm > 0.0, "a forest always sheds something")
	assert_true(gusty > calm * 1.5, "a gust strips the canopy (%f > %f)" % [gusty, calm])
	assert_true(storm > calm * 1.5, "so does a storm, with no wind_gust reported")
	assert_eq(AmbientRules.leaf_rate(AmbientRules.Cls.DESERT, "clear", 1.0), 0.0, "no leaves in the desert")
	assert_eq(AmbientRules.leaf_rate(AmbientRules.Cls.VOID, "clear", 1.0), 0.0, "no leaves in space")

func test_butterflies_are_a_fair_weather_daytime_thing() -> void:
	var p := AmbientRules.Cls.PLAINS
	assert_true(AmbientRules.butterfly_count("earth", p, NOON, "clear", true, 12) > 0, "noon meadow")
	assert_eq(AmbientRules.butterfly_count("earth", p, MIDNIGHT, "clear", true, 12), 0, "not at night")
	assert_eq(AmbientRules.butterfly_count("earth", p, NOON, "rain", true, 12), 0, "not in the rain")
	assert_eq(AmbientRules.butterfly_count("hell_planet", p, NOON, "clear", true, 12), 0, "not in Hell")
	assert_eq(AmbientRules.butterfly_count("orbit", AmbientRules.Cls.VOID, NOON, "clear", false, 12), 0, "not in space")
	var with_flowers := AmbientRules.butterfly_count("earth", AmbientRules.Cls.FOREST, NOON, "clear", true, 12)
	var without := AmbientRules.butterfly_count("earth", AmbientRules.Cls.FOREST, NOON, "clear", false, 12)
	assert_true(with_flowers >= without, "flowers draw more butterflies")

func test_flocks_fly_by_day_and_silhouettes_at_dusk() -> void:
	var f := AmbientRules.Cls.FOREST
	var n := AmbientRules.bird_flock_size("earth", f, NOON, "clear")
	assert_true(n >= 3 and n <= 6, "a flock is 3-6 birds, got %d" % n)
	assert_eq(AmbientRules.bird_flock_size("earth", f, MIDNIGHT, "clear"), 0, "birds roost at night")
	assert_eq(AmbientRules.bird_flock_size("earth", f, NOON, "rain"), 0, "and shelter from rain")
	assert_eq(AmbientRules.bird_flock_size("orbit", AmbientRules.Cls.VOID, NOON, "clear"), 0, "no birds in orbit")
	assert_true(AmbientRules.distant_flock_visible("earth", f, DUSK, "clear"), "distant flock at dusk")
	assert_true(not AmbientRules.distant_flock_visible("earth", f, NOON, "clear"), "not at noon")

func test_night_sky_events() -> void:
	var f := AmbientRules.Cls.FOREST
	assert_true(AmbientRules.shooting_star_interval("earth", f, MIDNIGHT, "clear") > 0.0, "stars fall at night")
	assert_eq(AmbientRules.shooting_star_interval("earth", f, NOON, "clear"), 0.0, "not in daylight")
	assert_eq(AmbientRules.shooting_star_interval("earth", f, MIDNIGHT, "rain"), 0.0, "not under clouds")
	assert_true(AmbientRules.shooting_star_interval("universe_7_deep_space", AmbientRules.Cls.VOID, NOON, "clear") > 0.0,
		"deep space always streaks")
	var storm := AmbientRules.horizon_flash_interval("earth", NOON, "thunder")
	assert_true(storm > 0.0 and storm < 10.0, "thunder flashes often, got %f" % storm)
	assert_true(AmbientRules.horizon_flash_interval("hell_planet", NOON, "clear") > 0.0, "Hell always rumbles")
	assert_eq(AmbientRules.horizon_flash_interval("earth", NOON, "clear"), 0.0, "a clear noon is quiet")
	assert_eq(AmbientRules.horizon_flash_interval("orbit", MIDNIGHT, "clear"), 0.0, "nothing in orbit")

func test_heat_shimmer_is_infernal_only() -> void:
	assert_eq(AmbientRules.heat_shimmer("vampa", AmbientRules.Cls.BARREN), 1.0, "Vampa breathes")
	assert_eq(AmbientRules.heat_shimmer("hell_planet", AmbientRules.Cls.BARREN), 1.0, "so does Hell")
	assert_eq(AmbientRules.heat_shimmer("earth", AmbientRules.Cls.FOREST), 0.0, "a forest does not")
	assert_true(AmbientRules.heat_shimmer("earth", AmbientRules.Cls.DESERT) > 0.0, "a desert wobbles a little")

func test_souls_only_leave_humanoids() -> void:
	assert_true(AmbientRules.is_soul_kind("enemy", 1.8), "an enemy leaves a wisp")
	assert_true(not AmbientRules.is_soul_kind("animal", 1.8), "an animal does not")
	assert_true(not AmbientRules.is_soul_kind("enemy", 0.6), "nor does something tiny")
	assert_ne(AmbientRules.soul_color("villain"), AmbientRules.soul_color("z_fighter"), "factions differ")

# --- budget ------------------------------------------------------------------------------------

func test_budget_never_exceeds_its_cap() -> void:
	var b := AmbientBudget.new(100)
	assert_eq(b.claim("motes", 500), 100, "a greedy claim is clamped to the cap")
	assert_eq(b.total(), 100)
	assert_eq(b.claim("butterflies", 50), 0, "nothing left for the next category")
	assert_true(b.total() <= b.cap, "total stays inside the cap")

func test_budget_serves_reactive_first() -> void:
	var b := AmbientBudget.new(100)
	b.claim("motes", 90)
	assert_eq(b.take("reactive", 20), 10, "a one-shot only gets what is free")
	assert_eq(b.total(), 100)
	b.give_back("reactive", 10)
	assert_eq(b.total(), 90, "giving back frees quads")
	assert_eq(b.claim("motes", 100), 100, "and the field can grow again")

func test_budget_claim_replaces_and_reset_clears() -> void:
	var b := AmbientBudget.new(64)
	b.claim("motes", 30)
	b.claim("motes", 10)
	assert_eq(b.total(), 10, "a claim replaces the previous one")
	b.reset()
	assert_eq(b.total(), 0)
	assert_eq(b.free_quads(), 64)
	assert_eq(b.take("reactive", 0), 0, "asking for nothing takes nothing")

# --- pooling -----------------------------------------------------------------------------------

func test_pool_reuses_nodes_and_stops_growing() -> void:
	var host := Node.new()
	add_node(host)
	_made.append(host)
	var made := [0]
	var pool := AmbientPool.new(host, func() -> Node:
		made[0] = int(made[0]) + 1
		return Node3D.new(), 2)
	var a := pool.acquire()
	var b := pool.acquire()
	assert_true(a != null and b != null, "the pool hands out its two nodes")
	assert_eq(pool.acquire(), null, "and refuses a third while both are busy")
	assert_eq(pool.size(), 2, "the pool never grew past its max")
	pool.release(a)
	var c := pool.acquire()
	assert_eq(c, a, "a released node comes back instead of a new one")
	assert_eq(int(made[0]), 2, "the factory ran exactly twice")
	pool.release_all()
	assert_eq(pool.busy_count(), 0, "release_all frees everything")
	assert_eq(pool.free_count(), 2)
	pool.clear()

# --- the director against a stub world ---------------------------------------------------------

func test_life_spawns_fireflies_at_night_in_a_forest() -> void:
	var w := _stub("forest")
	w.set_phase("night")
	var l := _life(w)
	for _i in 12:
		l.tick()
	assert_eq(l.biome_class, AmbientRules.Cls.FOREST, "forest was classified")
	assert_true(l.motes.active_count() > 0, "fireflies are out")
	assert_eq(l.flyers.active_count(), 0, "butterflies are asleep")
	assert_true(l.motes.home_of(0).y > 0.0, "the first firefly found a home above the ground")

func test_life_spawns_daytime_life_and_no_fireflies() -> void:
	var w := _stub("plains")
	w.set_phase("day")
	var l := _life(w)
	for _i in 12:
		l.tick()
	assert_eq(l.motes.active_count(), 0, "no fireflies by day")
	assert_true(l.motes_b.active_count() > 0, "pollen hangs in the sunlight")
	assert_true(l.flyers.active_count() > 0, "butterflies are up")
	assert_true(l.flock_near.active_count() > 0, "and a flock is crossing")

func test_life_sheds_leaves_under_a_canopy() -> void:
	var w := _stub("forest")
	w.set_phase("day")
	var l := _life(w)
	for _i in 6:
		l.tick()
	assert_true(l.leaves.active > 0, "a leaf emitter is running")
	assert_true(l.leaves.is_parked(0), "and it parked under the canopy")
	var anchor := l.leaves.anchor_of(0)
	assert_true(anchor.y > float(w.canopy_y) - 1.0 and anchor.y < float(w.canopy_y) + 2.0,
		"the emitter sits in the canopy, got y=%f for canopy %d" % [anchor.y, w.canopy_y])

func test_life_keeps_its_swarms_off_the_treetops() -> void:
	# World.get_height returns the top of whatever stands in a column, so a naive spawn puts
	# butterflies on top of the canopy. One canopy inside the spawn ring, and nothing may sit
	# on it: every swarm belongs on the ground the player is standing on.
	var w := _stub("forest")
	w.canopy_centers = PackedVector2Array([Vector2(8.0, 8.0)])
	w.set_phase("day")
	var l := _life(w)
	for _i in 12:
		l.tick()
	assert_near(l.ground_y, float(w.ground_y), 0.01, "the reference height is the focus column")
	var checked := 0
	for i in l.flyers.active_count():
		var h := l.flyers.home_of(i)
		if h.y < -9000.0:
			continue
		checked += 1
		assert_true(h.y <= float(w.ground_y) + 2.5,
			"butterfly %d sits at y=%f, up the canopy at %d" % [i, h.y, w.canopy_y])
	assert_true(checked > 0, "at least one butterfly was placed")

func test_leaf_emitters_are_not_restarted_every_tick() -> void:
	# Writing `amount` or `lifetime` on a CPUParticles3D throws away every live particle, so a
	# per-tick wind refresh must not touch them or no leaf ever finishes falling.
	var w := _stub("forest")
	w.set_phase("day")
	var l := _life(w)
	for _i in 6:
		l.tick()
	assert_true(l.leaves.active > 0 and l.leaves.emitters.size() > 0, "an emitter is running")
	var e: CPUParticles3D = l.leaves.emitters[0]
	var amount := e.amount
	var life_seconds := e.lifetime
	l.leaves.set_wind(0, Vector2(1, 0), 1.0)
	assert_eq(e.amount, amount, "a wind refresh must not reallocate the particle array")
	assert_eq(e.lifetime, life_seconds, "nor change the lifetime")
	for _i in 4:
		l.tick()
	assert_eq(e.amount, amount, "and neither may the following ticks")
	assert_true(e.emitting, "the emitter keeps shedding")

func test_life_is_dead_in_deep_space() -> void:
	var w := _stub("deep_space", "universe_7_deep_space", false)
	w.set_phase("night")
	var l := _life(w)
	for _i in 6:
		l.tick()
	assert_eq(l.biome_class, AmbientRules.Cls.VOID)
	assert_eq(l.motes.active_count(), 0, "no fireflies")
	assert_eq(l.motes_b.active_count(), 0, "no motes")
	assert_eq(l.flyers.active_count(), 0, "no butterflies")
	assert_eq(l.flock_near.active_count(), 0, "no birds")
	assert_eq(l.leaves.active, 0, "no leaves")
	assert_true(not l.shimmer.is_running(), "and no heat haze")

func test_life_shimmers_on_vampa_only() -> void:
	var hot := _stub("vampa_barrens", "vampa", false)
	hot.set_phase("day")
	var l := _life(hot)
	l.tick()
	assert_true(l.shimmer.is_running(), "Vampa shimmers")
	var cool := _stub("forest")
	cool.set_phase("day")
	var l2 := _life(cool)
	l2.tick()
	assert_true(not l2.shimmer.is_running(), "Earth forests do not")

func test_life_stays_inside_the_quad_budget() -> void:
	var w := _stub("forest")
	w.set_phase("night")
	var l := _life(w)
	l.set_quad_cap(60)
	for _i in 20:
		l.tick()
	assert_true(l.budget.total() <= 60, "budget total %d <= 60" % l.budget.total())
	var s := l.stats()
	assert_true(int(s["quads"]) <= int(s["cap"]), "stats agree")

func test_life_budget_survives_an_event_storm() -> void:
	var w := _stub("forest")
	w.set_phase("night")
	var l := _life(w)
	l.set_quad_cap(120)
	l.tick()
	for i in 200:
		Events.splash.emit(Vector3(float(i % 5), 64.0, float(i % 7)), 1.0)
		Events.explosion.emit(Vector3(1, 64, 1), 3.0, 40.0)
	assert_true(l.budget.total() <= 120, "an event storm cannot exceed the cap (%d)" % l.budget.total())
	assert_true(l.reactive.live_count() <= 20, "and the pools cap how many bursts exist at once")

func test_life_rebinding_rehomes_everything() -> void:
	var w := _stub("forest")
	w.set_phase("night")
	var l := _life(w)
	for _i in 12:
		l.tick()
	assert_true(l.motes.active_count() > 0)
	l.unbind()
	assert_eq(l.motes.active_count(), 0, "unbind stops every field")
	assert_eq(l.budget.total(), 0, "and hands the whole budget back")
	l.bind(w)
	for _i in 12:
		l.tick()
	assert_true(l.motes.active_count() > 0, "rebinding brings the fireflies back")

func test_planet_change_recolours_the_fireflies() -> void:
	var w := _stub("ajissa_plains", "namek", false)
	w.set_phase("night")
	var l := _life(w)
	for _i in 6:
		l.tick()
	assert_eq(l.planet_id, "namek", "planet came from the world")
	assert_true(l.motes.active_count() > 0, "Namek has fireflies")
	var c := AmbientRules.firefly_color(l.planet_id)
	assert_true(c.g > c.r, "and they are green")

# --- events with no world ----------------------------------------------------------------------

func test_event_handlers_do_not_crash_without_a_world() -> void:
	var l := _life(null)
	Events.splash.emit(Vector3(0, 64, 0), 1.0)
	Events.block_changed.emit(Vector3i(0, 64, 0), 1, 0)
	Events.explosion.emit(Vector3(0, 64, 0), 4.0, 50.0)
	Events.entity_died.emit(null, null)
	var dummy := Node3D.new()
	add_node(dummy)
	_made.append(dummy)
	Events.entity_died.emit(dummy, null)
	Events.time_changed.emit(12345.0)
	Events.weather_changed.emit("rain")
	l.tick()
	assert_eq(l.reactive.live_count(), 0, "nothing fires with no world bound")
	assert_eq(l.budget.total(), 0, "and nothing is charged to the budget")

func test_tick_without_a_world_is_harmless() -> void:
	var l := _life(null)
	for _i in 4:
		l.tick()
	assert_eq(l.stats()["quads"], 0, "an unbound director draws nothing")
	assert_true(int(l.stats()["ticks"]) >= 4, "but it still ticks")

func test_splash_and_debris_fire_when_bound() -> void:
	var w := _stub("forest")
	var l := _life(w)
	l.tick()
	Events.splash.emit(l.center + Vector3(1, 0, 1), 1.5)
	assert_true(l.reactive.live_count() > 0, "a nearby splash spawns droplets and a ripple")
	var before := l.reactive.live_count()
	Events.splash.emit(l.center + Vector3(900, 0, 0), 1.5)
	assert_eq(l.reactive.live_count(), before, "a splash on the far side of the world is ignored")
	Events.block_changed.emit(Vector3i(int(l.center.x) + 1, 64, int(l.center.z)), Registry.block_id("stone"), 0)
	assert_true(l.reactive.live_count() > before, "breaking a block puffs debris")

func test_block_changed_is_rate_limited() -> void:
	var w := _stub("forest")
	var l := _life(w)
	l.tick()
	var stone := Registry.block_id("stone")
	for i in 40:
		Events.block_changed.emit(Vector3i(int(l.center.x) + (i % 4), 64, int(l.center.z)), stone, 0)
	assert_true(l.reactive.live_count() <= 8,
		"an explosion's worth of block edits cannot flood the pools (%d live)" % l.reactive.live_count())

# --- the autoload ------------------------------------------------------------------------------

## The autoload is inspected, never driven: firing Events.world_loaded here would install a
## quest stack (and anything else listening) into a fake world and leak it into other tests.
func test_boot_autoload_is_wired_to_the_event_bus() -> void:
	var boot: Node = Engine.get_main_loop().root.get_node_or_null("Ambient")
	assert_true(boot != null, "the Ambient autoload is registered in project.godot")
	if boot == null:
		return
	assert_true(boot is AmbientBoot, "and it is an AmbientBoot")
	for sig in ["world_loaded", "world_unloading", "player_spawned", "planet_changed",
			"weather_changed", "time_changed"]:
		assert_true(_listens(boot, String(sig)), "Ambient listens to Events.%s" % sig)

func _listens(node: Node, signal_name: String) -> bool:
	for c in Events.get_signal_connection_list(signal_name):
		var cb: Callable = (c as Dictionary)["callable"]
		if cb.get_object() == node:
			return true
	return false

func test_boot_installs_one_ambient_layer_under_a_world() -> void:
	var b := AmbientBoot.new()
	add_node(b)
	_made.append(b)
	var w := _stub("forest")
	add_node(w)
	var life := b.install(w)
	assert_true(life != null, "install created the layer")
	assert_true(b.is_installed())
	assert_eq(w.get_node_or_null("AmbientLife"), life, "as a child of the world named AmbientLife")
	assert_eq(b.install(w), life, "installing twice reuses the same node")
	assert_eq(life.biome_class, AmbientRules.Cls.FOREST, "and the world was read")
	b.uninstall()
	assert_true(not b.is_installed(), "uninstall detaches it")

func test_boot_detaching_stops_it_listening() -> void:
	var b := AmbientBoot.new()
	add_node(b)
	_made.append(b)
	assert_true(_listens(b, "world_loaded"), "a live boot listens")
	tree.root.remove_child(b)
	assert_true(not _listens(b, "world_loaded"), "a detached boot does not")
	assert_true(not _listens(b, "time_changed"))

func test_boot_flags_default_to_doing_nothing() -> void:
	var b := AmbientBoot.new()
	b.install_enabled = false
	add_node(b)
	_made.append(b)
	assert_eq(b.forced_time, -1.0, "no clock override unless a flag asks for one")
	assert_eq(b.forced_weather, "", "and no weather override")
	assert_true(not b.demo, "and no demo loop")
	assert_eq(b.install(null), null, "installing without a world is a no-op")
	var w := _stub("forest")
	add_node(w)
	assert_eq(b.install(w), null, "--ambient-off means nothing is installed at all")
	b.install_enabled = true
	b.forced_time = 17000.0
	b.install(w)
	assert_true(b.is_installed(), "install binds to the stub world")
	assert_eq(w.time_ticks, 17000.0, "the clock override was applied to the world")
	b.uninstall()

# --- assets ------------------------------------------------------------------------------------

func test_block_colours_are_cached_and_sane() -> void:
	var grass := Registry.block_id("grass_block")
	assert_true(grass > 0, "grass_block exists")
	var c := AmbientAssets.block_color(grass)
	var c2 := AmbientAssets.block_color(grass)
	assert_eq(c, c2, "the colour is cached")
	assert_true(c.g >= c.b, "grass is not blue")
	assert_true(c.a == 1.0)

func test_leaf_colour_follows_the_biome_foliage_tint() -> void:
	var leaves := Registry.block_id("oak_leaves")
	if leaves <= 0:
		return
	var forest := AmbientAssets.leaf_color(leaves, Registry.biome("forest"))
	assert_true(forest.g > forest.b, "leaves are green, not blue")
	assert_true(forest.a == 1.0)
	var hex := AmbientAssets.hex_color("#FF8000")
	assert_near(hex.r, 1.0, 0.01)
	assert_near(hex.b, 0.0, 0.01)
	assert_eq(AmbientAssets.hex_color("nope", Color(0, 1, 0)), Color(0, 1, 0), "malformed hex falls back")

func test_shared_meshes_and_sprites_are_built_once() -> void:
	assert_eq(AmbientAssets.unit_quad(), AmbientAssets.unit_quad(), "one quad for everybody")
	assert_eq(AmbientAssets.soft_dot(), AmbientAssets.soft_dot(), "one dot")
	assert_eq(AmbientAssets.ring(), AmbientAssets.ring(), "one ripple ring")
	assert_eq(AmbientAssets.streak(), AmbientAssets.streak(), "one streak")
	assert_eq(AmbientAssets.butterfly_mesh(), AmbientAssets.butterfly_mesh(), "one butterfly mesh")
	var m := AmbientAssets.butterfly_mesh()
	assert_eq(m.get_surface_count(), 1, "both wings are one surface (one draw call)")
	assert_true(AmbientAssets.leaf_mask() != null, "the leaf mask loaded")

func test_shaders_compile() -> void:
	for path in ["res://shaders/ambient_motes.gdshader", "res://shaders/ambient_butterfly.gdshader",
			"res://shaders/ambient_birds.gdshader", "res://shaders/ambient_shimmer.gdshader"]:
		assert_true(ResourceLoader.exists(path), "%s exists" % path)
		var m := AmbientAssets.shader_material(path)
		assert_true(m.shader != null, "%s loaded as a shader" % path)
		assert_eq(m.shader.get_shader_uniform_list().is_empty(), false, "%s has uniforms" % path)
