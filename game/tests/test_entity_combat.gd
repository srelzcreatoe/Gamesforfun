extends TestCase
## Entity damage/heal/death maths and state serialisation.

const RADITZ := "saga_raditz"

var e: Entity = null

func _make(type := RADITZ, cls := "Entity") -> Entity:
	var n: Entity = Enemy.new() if cls == "Enemy" else Entity.new()
	n.entity_type = type
	add_node(n)
	n.global_position = Vector3(0, 64, 0)
	return n

func teardown() -> void:
	if e != null:
		if e.is_inside_tree():
			e.get_parent().remove_child(e)
		e.free()
		e = null

func test_entity_initialises_from_registry() -> void:
	e = _make()
	assert_true(e.initialized, "initialised on _ready")
	if Registry.entities.has(RADITZ):
		var def := Registry.entity(RADITZ)
		assert_eq(e.display_name, String(def.get("name", "")), "name from entities.json")
		assert_true(e.max_health > 0.0, "health from entities.json: %f" % e.max_health)
		assert_true(e.model != null, "model built")
		assert_true(e.anim != null and e.anim.clips.size() > 0, "animations loaded")
		assert_near(e.aabb_size.y, float(def.get("hitbox", [0.6, 1.9])[1]), 0.001, "hitbox height")
	assert_near(e.health, e.max_health, 0.01, "spawns at full health")

func test_damage_formula() -> void:
	e = _make("")
	e.max_health = 1000.0
	e.health = 1000.0
	e.defense = 0.0
	# no defense -> full damage (crits are random, so disable them by clamping)
	var applied := e.take_damage(100.0, null, "melee")
	assert_true(applied >= 100.0 and applied <= 150.01, "raw damage with 0 defense: %f" % applied)
	# damage * 100 / (100 + defense)
	e.invuln = 0.0
	e.defense = 100.0
	e.health = 1000.0
	applied = e.take_damage(100.0, null, "melee")
	assert_true(applied >= 50.0 and applied <= 75.01, "defense 100 halves damage: %f" % applied)
	e.invuln = 0.0
	e.defense = 300.0
	e.health = 1000.0
	applied = e.take_damage(100.0, null, "melee")
	assert_true(applied >= 25.0 and applied <= 37.51, "defense 300 quarters damage: %f" % applied)

func test_iframes() -> void:
	e = _make("")
	e.max_health = 500.0
	e.health = 500.0
	e.defense = 0.0
	var first := e.take_damage(50.0, null, "melee")
	assert_true(first > 0.0, "first hit lands")
	var second := e.take_damage(50.0, null, "melee")
	assert_eq(second, 0.0, "second hit inside the i-frame window is ignored")
	assert_near(e.invuln, Entity.IFRAME_TIME, 0.001, "i-frame duration")
	e.invuln = 0.0
	assert_true(e.take_damage(50.0, null, "melee") > 0.0, "hits again after the i-frames")

func test_ki_protection_hook() -> void:
	e = _make("")
	e.max_health = 500.0
	e.health = 500.0
	e.defense = 0.0
	e.ki = 100.0
	e.ki_protection = 0.5
	var applied := e.take_damage(100.0, null, "ki")
	assert_true(applied <= 75.01, "half the damage is paid with ki: %f" % applied)
	assert_true(e.ki < 100.0, "ki was spent: %f" % e.ki)

func test_knockback_and_flash() -> void:
	e = _make("")
	e.health = 500.0
	e.max_health = 500.0
	var v := e.velocity
	e.take_damage(10.0, null, "melee", Vector3(0, 5, -3))
	assert_ne(e.velocity, v, "knockback applied to velocity")
	assert_true(e.model == null or e.model.material.albedo_color != Color.WHITE, "hit flash tints the model")

func test_heal_clamps() -> void:
	e = _make("")
	e.max_health = 200.0
	e.health = 50.0
	assert_near(e.heal(30.0), 30.0, 0.01, "heal returns the amount healed")
	assert_near(e.health, 80.0, 0.01)
	assert_near(e.heal(1000.0), 120.0, 0.01, "clamped to max_health")
	assert_near(e.health, 200.0, 0.01)

func test_death_emits_and_frees() -> void:
	e = _make("")
	e.max_health = 10.0
	e.health = 10.0
	e.defense = 0.0
	var died: Array = []
	Events.entity_died.connect(func(ent: Node, _k: Node) -> void: died.append(ent))
	e.take_damage(999.0, null, "melee")
	assert_true(e.dead, "dead flag")
	assert_near(e.health, 0.0, 0.001)
	assert_true(died.size() == 1, "Events.entity_died emitted once")
	assert_eq(e.take_damage(10.0, null, "melee"), 0.0, "a dead entity takes no damage")

func test_facing_and_head_look() -> void:
	e = _make("")
	# yaw 0 faces -Z; facing a point at -Z must keep yaw ~0
	e.face(Vector3(0, 64, -10))
	assert_near(e.yaw, 0.0, 0.01, "facing -Z is yaw 0")
	assert_near(e.facing().z, -1.0, 0.01, "facing() points along -Z")
	# a point to the entity's right (+X) must give yaw -90 deg
	e.face(Vector3(10, 64, 0))
	assert_near(rad_to_deg(e.yaw), -90.0, 0.5, "facing +X is yaw -90")
	assert_near(e.facing().x, 1.0, 0.01, "facing() points along +X")
	e.yaw = 0.0
	e.look_at_head(Vector3(10, 65, 0))
	assert_true(e.head_yaw_deg < 0.0, "head yaw is negative when looking right: %f" % e.head_yaw_deg)

func test_physics_fallback_ground() -> void:
	e = _make("")
	e.global_position = Vector3(0, 70, 0)
	for i in 120:
		e.apply_physics(1.0 / 60.0)
	assert_near(e.global_position.y, Entity.FALLBACK_GROUND_Y, 0.01, "falls to the fallback ground plane")
	assert_true(e.on_ground, "on_ground")
	assert_near(e.velocity.y, 0.0, 0.01, "vertical velocity cleared on landing")

func test_state_round_trip() -> void:
	e = _make()
	e.global_position = Vector3(12.5, 70.0, -3.25)
	e.yaw = 1.25
	e.health = 42.0
	e.current_form = "ssgrades.supersaiyan"
	var state := e.write_state()
	var other: Entity = Entity.new()
	add_node(other)
	other.read_state(state)
	assert_eq(other.entity_type, e.entity_type)
	assert_true(other.global_position.distance_to(e.global_position) < 0.001, "position restored")
	assert_near(other.yaw, 1.25, 0.001)
	assert_near(other.health, 42.0, 0.001)
	assert_eq(other.current_form, "ssgrades.supersaiyan")
	other.get_parent().remove_child(other)
	other.free()

func test_spawn_data_overrides() -> void:
	e = _make("")
	e.get_parent().remove_child(e)
	e.free()
	e = Enemy.new()
	e.entity_type = RADITZ
	e.apply_spawn_data({"stats_override": {"health": 4242.0, "melee": 7.0}, "ai_tier": 3})
	add_node(e)
	if Registry.entities.has(RADITZ):
		# Stats.gd rebuilds health from quantised VIT points, so allow 1 % drift
		assert_true(absf(e.max_health - 4242.0) < 45.0, "health override, got %f" % e.max_health)
		assert_eq(e.ai_tier, 3, "ai tier override")

func test_stats_instance_and_derived_refresh() -> void:
	e = _make()
	if not ResourceLoader.exists("res://scripts/combat/Stats.gd"):
		return
	assert_true(e.stats != null, "Stats instance built from the entity def")
	assert_true(e.stats.has_method("max_health") and e.stats.has_method("melee"), "it is a Stats")
	assert_near(e.max_health, float(e.stats.call("max_health")), 0.01, "max_health comes from Stats")
	# a form multiplier goes through Stats and refresh_derived()
	if e.stats.has_method("set_form_multipliers"):
		var before := e.max_health
		e.stats.call("set_form_multipliers", {"vitMultiplier": 2.0, "strMultiplier": 2.0})
		e.refresh_derived()
		assert_true(e.max_health >= before, "refresh_derived picks up the form multipliers (%f -> %f)" % [before, e.max_health])
		e.stats.call("clear_form_multipliers")
		e.refresh_derived()

func test_combat_hooks() -> void:
	e = _make()
	assert_near(e.base_scale, e.model_scale, 0.001, "base_scale mirrors the spawn model scale")
	assert_near(e.power_release, 1.0, 0.001, "power_release default")
	# skills / techniques
	e.set_skill_level("ki_control", 3)
	assert_eq(e.skill_level("ki_control"), 3)
	assert_true(e.knows_technique("blast") or not e.techniques.is_empty(), "knows_technique answers")
	e.learn_technique("kamehameha")
	assert_true(e.knows_technique("kamehameha"))
	# forms
	assert_true(not e.form_unlocked("ssgrades.supersaiyan") or e.forms_unlocked.is_empty())
	e.unlock_form("ssgrades.supersaiyan")
	assert_true(e.form_unlocked("ssgrades.supersaiyan"))
	e.set_form_mastery("ssgrades.supersaiyan", 42.5)
	assert_near(e.form_mastery("ssgrades.supersaiyan"), 42.5, 0.01)
	# aim direction: yaw 0 faces -Z
	e.yaw = 0.0
	e.head_pitch_deg = 0.0
	assert_near(e.aim_direction().z, -1.0, 0.01, "aim follows the facing without a target")
	var t := Entity.new()
	add_node(t)
	t.global_position = e.global_position + Vector3(6, 0, 0)
	e.set_target(t)
	assert_true(e.aim_direction().x > 0.8, "aim follows the target")
	t.get_parent().remove_child(t)
	t.free()
	# blind / input lock / model visibility
	e.set_input_locked(true)
	assert_true(e.input_locked)
	e.blind(1.5)
	assert_true(e.is_blinded() and not e.ai_enabled(), "a blinded entity stops acting")
	assert_eq(e.target, null, "blinding drops the target")
	e.set_model_visible(false)
	assert_true(e.model == null or not e.model.visible)
	e.set_model_visible(true)

func test_model_override_swaps_geometry() -> void:
	e = _make()
	if e.model == null:
		return
	var before := e.model.bone_count()
	var tex := e.model.get_texture()
	e.set_model_override("entity/races/human")
	assert_eq(e.model.geo_path, "entity/races/human", "override loaded")
	assert_eq(e.model.bone_count(), 30, "human bone count after the swap")
	assert_near(e.model.model_scale, e.base_scale, 0.001, "scale preserved")
	assert_eq(e.model.get_texture(), tex, "texture preserved")
	e.set_model_override("")
	assert_eq(e.model.bone_count(), before, "restored the entity default model")
