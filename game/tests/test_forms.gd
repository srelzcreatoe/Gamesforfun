extends TestCase
## Forms: unlock rules, multipliers, ki/health drain, mastery, stacking and revert.
## Fixtures are injected into Registry.forms so the test does not depend on the
## designers' data/forms.json staying the same.

const A := "test.form_a"
const B := "test.form_b"
const C := "test.form_c"

var dummy: FxDummy
var forms: Forms
var ki: Ki
var _saved: Dictionary = {}

func _fixture_a() -> Dictionary:
	return {
		"id": A, "name": "Form A", "race": "saiyan", "group": "test",
		"form_type": "superforms", "skill": "superforms", "unlockOnSkillLevel": 2,
		"strMultiplier": 1.5, "skpMultiplier": 1.5, "stmMultiplier": 1.0,
		"defMultiplier": 2.0, "vitMultiplier": 1.0, "pwrMultiplier": 1.5,
		"eneMultiplier": 1.0, "speedMultiplier": 1.1,
		"energyDrain": 10.0, "healthDrain": 2.0,
		"maxMastery": 100.0, "masteryPerHitDealt": 0.5, "masteryPerHitReceived": 0.25,
		"passiveMasteryEveryFiveSeconds": 1.0, "maxCostMultiplier": 0.5,
		"stackOnMastery": 0.0, "instantTransformOnMastery": 40.0,
		"formStackable": true, "stackDrainMultiplier": 2.0,
		"incompatibleWith": [C], "shareMasteryWith": [B], "shareMasteryMultiplier": 0.5,
		"formRequisite": "", "unlock_tp_cost": 100, "model_override": "",
		"auraColor": "#FFD700", "hasLightnings": true, "lightningColor": "#8AD8FF",
		"modelScaling": [1.0, 1.0, 1.0],
	}

func _fixture_b() -> Dictionary:
	var d := _fixture_a()
	d["id"] = B
	d["name"] = "Form B"
	d["unlockOnSkillLevel"] = 3
	d["formRequisite"] = A
	d["unlockOnMastery"] = 25.0
	d["strMultiplier"] = 2.0
	d["pwrMultiplier"] = 2.0
	d["defMultiplier"] = 1.0
	d["energyDrain"] = 20.0
	d["healthDrain"] = 0.0
	d["shareMasteryWith"] = []
	d["incompatibleWith"] = []
	d["stackOnMastery"] = 50.0
	return d

func _fixture_c() -> Dictionary:
	var d := _fixture_a()
	d["id"] = C
	d["name"] = "Form C"
	d["unlockOnSkillLevel"] = 1
	d["formStackable"] = false
	d["incompatibleWith"] = [A]
	d["shareMasteryWith"] = []
	d["energyDrain"] = 5.0
	d["healthDrain"] = 0.0
	d["strMultiplier"] = 3.0
	d["defMultiplier"] = 1.0
	d["unlock_tp_cost"] = -1
	return d

func setup() -> void:
	_saved = {}
	for id in [A, B, C]:
		if Registry.forms.has(id):
			_saved[id] = Registry.forms[id]
	Registry.forms[A] = _fixture_a()
	Registry.forms[B] = _fixture_b()
	Registry.forms[C] = _fixture_c()
	dummy = FxDummy.create("saiyan", "warrior")
	dummy.skills = {"superforms": 3, "ki_control": 1}
	dummy.forms_unlocked = [A, B, C] as Array[String]
	dummy.forms_mastery = {}
	dummy.stats.raise("ENE", 100)
	dummy.refresh_derived()
	dummy.ki = dummy.max_ki
	add_node(dummy)
	ki = Ki.get_for(dummy)
	forms = Forms.get_for(dummy)

func teardown() -> void:
	for id in [A, B, C]:
		if _saved.has(id):
			Registry.forms[id] = _saved[id]
		else:
			Registry.forms.erase(id)
	if dummy != null and is_instance_valid(dummy):
		dummy.queue_free()
	dummy = null
	forms = null
	ki = null

# --- unlocking ------------------------------------------------------------

func test_can_unlock_requires_skill_level() -> void:
	dummy.forms_unlocked = ["nothing"] as Array[String]
	dummy.skills["superforms"] = 1
	var r := Forms.can_unlock(dummy, A)
	assert_true(not bool(r["ok"]))
	assert_true(String(r["reason"]).contains("superforms"))
	dummy.skills["superforms"] = 2
	assert_true(bool(Forms.can_unlock(dummy, A)["ok"]))

func test_can_unlock_requires_prerequisite_mastery() -> void:
	dummy.forms_unlocked = [A] as Array[String]
	dummy.skills["superforms"] = 3
	var r := Forms.can_unlock(dummy, B)
	assert_true(not bool(r["ok"]), "needs 25 % mastery of form A")
	Forms.set_mastery(dummy, A, 30.0)
	assert_true(bool(Forms.can_unlock(dummy, B)["ok"]))

func test_quest_only_forms_cannot_be_bought() -> void:
	dummy.forms_unlocked = ["nothing"] as Array[String]
	var r := Forms.can_unlock(dummy, C)
	assert_true(not bool(r["ok"]))
	assert_eq(String(r["reason"]), "unlocked by a quest")
	assert_eq(Forms.unlock_cost(C), -1)
	assert_eq(Forms.unlock_cost(A), 100)

func test_unlock_records_the_form() -> void:
	dummy.forms_unlocked = [] as Array[String]
	dummy.forms_unlocked.append("nothing")
	assert_true(Forms.unlock(dummy, A))
	assert_true(dummy.forms_unlocked.has(A))

# --- transform ------------------------------------------------------------

func test_unmastered_transform_waits_for_the_cinematic() -> void:
	Forms.set_mastery(dummy, A, 0.0)
	assert_true(not Forms.is_instant(dummy, A))
	assert_true(Forms.transform(dummy, A))
	assert_true(forms.transforming, "the director runs before the form lands")
	assert_true(Forms.active(dummy).is_empty(), "multipliers land at the climax")
	assert_near(dummy.stats.form_mult("STR"), 1.0, 0.0001)
	# a second transformation is refused while one is playing
	var r := Forms.can_transform(dummy, B)
	assert_true(not bool(r["ok"]))
	assert_eq(String(r["reason"]), "already transforming")

func test_transform_applies_multipliers_instantly_when_mastered() -> void:
	Forms.set_mastery(dummy, A, 100.0)         # >= instantTransformOnMastery
	var melee_before := dummy.stats.melee()
	assert_true(Forms.transform(dummy, A))
	assert_eq(Forms.current(dummy), A)
	assert_eq(dummy.current_form, A)
	assert_near(dummy.stats.form_mult("STR"), 1.5)
	assert_true(dummy.stats.melee() > melee_before)
	assert_near(dummy.stats.form_mult("RES"), 2.0)
	assert_near(dummy.stats.form_mult("SPEED"), 1.1)

func test_transform_is_refused_without_ki() -> void:
	ki.set_ki(1.0)
	var r := Forms.can_transform(dummy, A)
	assert_true(not bool(r["ok"]))
	assert_eq(String(r["reason"]), "not enough ki")
	assert_true(not Forms.transform(dummy, A))

func test_transform_is_refused_when_locked() -> void:
	dummy.forms_unlocked = [B] as Array[String]
	var r := Forms.can_transform(dummy, A)
	assert_true(not bool(r["ok"]))
	assert_eq(String(r["reason"]), "form not unlocked")

func test_cannot_transform_into_the_active_form() -> void:
	Forms.set_mastery(dummy, A, 100.0)
	Forms.transform(dummy, A)
	var r := Forms.can_transform(dummy, A)
	assert_true(not bool(r["ok"]))
	assert_eq(String(r["reason"]), "already active")

# --- stacking -------------------------------------------------------------

func test_stacking_multiplies_and_needs_mastery() -> void:
	Forms.set_mastery(dummy, A, 100.0)
	Forms.transform(dummy, A)
	Forms.set_mastery(dummy, B, 10.0)
	var r := Forms.can_transform(dummy, B)
	assert_true(not bool(r["ok"]), "B needs 50 % mastery to stack")
	Forms.set_mastery(dummy, B, 100.0)
	assert_true(bool(Forms.can_transform(dummy, B)["ok"]))
	Forms.transform(dummy, B)
	assert_eq(Forms.active(dummy).size(), 2)
	assert_near(dummy.stats.form_mult("STR"), 1.5 * 2.0, 0.0001, "stacked multipliers multiply")

func test_incompatible_forms_cannot_stack() -> void:
	Forms.set_mastery(dummy, A, 100.0)
	Forms.transform(dummy, A)
	Forms.set_mastery(dummy, C, 100.0)
	var r := Forms.can_transform(dummy, C)
	assert_true(not bool(r["ok"]))
	assert_true(String(r["reason"]).contains("incompatible"))

func test_non_stackable_form_replaces_the_stack() -> void:
	Forms.set_mastery(dummy, B, 100.0)
	Forms.transform(dummy, B)
	assert_eq(Forms.active(dummy).size(), 1)
	# C is not stackable and not incompatible with B -> it replaces B
	Forms.set_mastery(dummy, C, 100.0)
	Forms.transform(dummy, C)
	assert_eq(Forms.active(dummy), [C] as Array[String])
	assert_near(dummy.stats.form_mult("STR"), 3.0)

# --- drain ----------------------------------------------------------------

func test_ki_drain_formula() -> void:
	Forms.set_mastery(dummy, A, 0.0)
	# mastery 0 would play the cinematic, so ask for the instant path
	Forms.transform(dummy, A, true)
	# energyDrain * max_ki / 100, mastery 0 -> cost multiplier 1.0
	assert_near(forms.drain_per_second(), 10.0 * ki.max_ki() / 100.0, 0.001)

func test_mastery_reduces_the_drain() -> void:
	Forms.set_mastery(dummy, A, 100.0)
	Forms.transform(dummy, A)
	# maxCostMultiplier 0.5 at full mastery
	assert_near(forms.drain_per_second(), 10.0 * ki.max_ki() / 100.0 * 0.5, 0.001)

func test_stacked_forms_use_the_stack_drain_multiplier() -> void:
	Forms.set_mastery(dummy, A, 100.0)
	Forms.set_mastery(dummy, B, 100.0)
	Forms.transform(dummy, A)
	Forms.transform(dummy, B)
	var expected := 10.0 * ki.max_ki() / 100.0 * 0.5 + 20.0 * ki.max_ki() / 100.0 * 0.5 * 2.0
	assert_near(forms.drain_per_second(), expected, 0.001)

func test_health_drain_is_summed() -> void:
	Forms.set_mastery(dummy, A, 100.0)
	Forms.transform(dummy, A)
	assert_near(forms.health_drain_per_second(), 2.0)
	var before := dummy.health
	forms._process(1.0)
	assert_true(dummy.health < before, "healthDrain hurts over time")

func test_revert_on_ki_depletion() -> void:
	Forms.set_mastery(dummy, A, 100.0)
	Forms.transform(dummy, A)
	ki.set_ki(0.5)
	forms._process(1.0)
	assert_true(Forms.active(dummy).is_empty(), "the form drops when the ki runs out")
	assert_near(dummy.stats.form_mult("STR"), 1.0, 0.0001, "multipliers are gone")
	assert_eq(dummy.current_form, "")

# --- mastery --------------------------------------------------------------

func test_mastery_from_hits_and_sharing() -> void:
	Forms.set_mastery(dummy, A, 100.0)
	Forms.transform(dummy, A)
	Forms.set_mastery(dummy, A, 0.0)
	forms.on_hit_dealt()
	assert_near(Forms.mastery(dummy, A), 0.5)
	assert_near(Forms.mastery(dummy, B), 0.25, 0.001, "shareMasteryWith at 0.5x")
	forms.on_hit_received()
	assert_near(Forms.mastery(dummy, A), 0.75)

func test_passive_mastery_every_five_seconds() -> void:
	Forms.set_mastery(dummy, A, 100.0)
	Forms.transform(dummy, A)
	Forms.set_mastery(dummy, A, 0.0)
	forms._process(4.0)
	assert_near(Forms.mastery(dummy, A), 0.0, 0.001, "not yet")
	forms._process(1.5)
	assert_near(Forms.mastery(dummy, A), 1.0, 0.001, "passiveMasteryEveryFiveSeconds")

func test_mastery_is_capped() -> void:
	Forms.set_mastery(dummy, A, 1000.0)
	assert_near(Forms.mastery(dummy, A), 100.0, 0.001, "maxMastery")
	assert_near(Forms.mastery_fraction(dummy, A), 1.0)

func test_instant_flag_follows_mastery() -> void:
	Forms.set_mastery(dummy, A, 10.0)
	assert_true(not Forms.is_instant(dummy, A))
	Forms.set_mastery(dummy, A, 55.0)
	assert_true(Forms.is_instant(dummy, A), "instantTransformOnMastery 40")

func test_revert_all_clears_every_form() -> void:
	Forms.set_mastery(dummy, A, 100.0)
	Forms.set_mastery(dummy, B, 100.0)
	Forms.transform(dummy, A)
	Forms.transform(dummy, B)
	assert_eq(Forms.active(dummy).size(), 2)
	Forms.revert(dummy)
	assert_eq(Forms.active(dummy), [A] as Array[String])
	Forms.revert_all(dummy)
	assert_true(Forms.active(dummy).is_empty())
	assert_near(dummy.stats.form_mult("STR"), 1.0, 0.0001)

func test_real_data_forms_are_readable() -> void:
	# sanity check against the designers' file: the DMZ field names must survive
	var ssj := Forms.def("ssgrades.supersaiyan")
	assert_true(not ssj.is_empty(), "ssgrades.supersaiyan must exist (data or fallback)")
	assert_near(Forms.mult_of(ssj, "STR"), 1.5, 0.001)
	assert_true(float(ssj.get("energyDrain", 0.0)) > 0.0)
	assert_eq(String(ssj.get("skill", "")), "superforms")
