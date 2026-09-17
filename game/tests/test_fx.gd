extends TestCase
## VFX: the transformation cinematic's timeline, the per-form colour resolution of every
## form in data/forms.json, the mobile particle/light budget, Engine.time_scale safety,
## node cleanup and the "free when idle" contract of the screen effects.
##
## The director is driven by hand (`step()` calls its `_process` with a fixed delta and
## its own `set_process(false)`), so the whole 5.8 s cinematic is verified
## deterministically in a few milliseconds instead of waiting for real frames.

const EPIC_FORM := "supersaiyan.supersaiyan2"      # order 1 + hasLightnings -> epic
const MINOR_FORM := "kaioken.x2"                   # kaioken -> minor
const GIANT_FORM := "oozaru.oozaru"                # modelScaling 3.8

var dummy: FxDummy
var _time_scale := 1.0

func setup() -> void:
	_time_scale = 1.0
	Engine.time_scale = 1.0
	FormVfx.clear_cache()
	dummy = FxDummy.create("saiyan", "warrior")
	dummy.forms_unlocked = [] as Array[String]
	add_node(dummy)

func teardown() -> void:
	var d := TransformationDirector.running_for(dummy)
	if d != null:
		d.free()
	if dummy != null and is_instance_valid(dummy):
		dummy.free()
	dummy = null
	Engine.time_scale = _time_scale
	ScreenFx.clear_sustained(0.0)

# --- helpers --------------------------------------------------------------

## Director for `form_id`, stepped by hand.
func _director(form_id: String) -> TransformationDirector:
	var d := TransformationDirector.play_for(dummy, form_id)
	if d == null:
		return null
	d.set_process(false)             # we call _process ourselves
	return d

## Advance a hand-driven director by `seconds` in `dt` slices.
func _step(d: TransformationDirector, seconds: float, dt := 1.0 / 60.0) -> void:
	var left := seconds
	while left > 0.0 and is_instance_valid(d) and d.phase != TransformationDirector.Phase.DONE:
		var s: float = minf(dt, left)
		d._process(s * Engine.time_scale)
		left -= s

# --- A. timeline ----------------------------------------------------------

func test_director_runs_the_four_phases_in_order() -> void:
	var d := _director(EPIC_FORM)
	assert_true(d != null, "director created")
	if d == null:
		return
	assert_eq(d.phase_name(), "gather", "starts in the gather phase")
	var seen: Array[String] = []
	var left := d.duration + 0.2
	while left > 0.0 and is_instance_valid(d):
		if seen.is_empty() or seen[-1] != d.phase_name():
			seen.append(d.phase_name())
		d._process(1.0 / 60.0 * Engine.time_scale)
		left -= 1.0 / 60.0
		if d.phase == TransformationDirector.Phase.DONE:
			break
	assert_eq(seen, ["gather", "strain", "burst", "reveal"] as Array[String],
		"phase order was %s" % str(seen))

func test_phase_boundaries_follow_the_form_duration() -> void:
	var d := _director(EPIC_FORM)
	if d == null:
		return
	_step(d, d.duration * 0.20)
	assert_eq(d.phase_name(), "gather")
	_step(d, d.duration * 0.20)
	assert_eq(d.phase_name(), "strain", "strain starts at 26 %")
	_step(d, d.duration * 0.40)
	assert_eq(d.phase_name(), "burst", "climax at 74 %")
	_step(d, d.duration * 0.10)
	assert_eq(d.phase_name(), "reveal", "settles at 82 %")

func test_climax_callback_fires_once_at_the_burst() -> void:
	var calls: Array[int] = []
	var d := TransformationDirector.play_for(dummy, EPIC_FORM, func() -> void: calls.append(1))
	assert_true(d != null)
	if d == null:
		return
	d.set_process(false)
	_step(d, d.duration * 0.70)
	assert_eq(calls.size(), 0, "multipliers must not land before the climax")
	_step(d, d.duration * 0.06)
	assert_eq(calls.size(), 1, "multipliers land exactly at the climax")
	_step(d, d.duration)
	assert_eq(calls.size(), 1, "and only once")

func test_tier_durations_minor_major_epic() -> void:
	assert_near(FormVfx.for_id(MINOR_FORM).duration, 2.6, 0.01, "kaioken is a quick flare")
	assert_near(FormVfx.for_id("ssgrades.supersaiyan").duration, 4.7, 0.01, "a major form")
	assert_near(FormVfx.for_id(EPIC_FORM).duration, 5.8, 0.01, "lightning forms are epic")
	assert_eq(FormVfx.for_id(MINOR_FORM).tier, FormVfx.TIER_MINOR)
	assert_eq(FormVfx.for_id(EPIC_FORM).tier, FormVfx.TIER_EPIC)

func test_director_plays_the_forms_transformation_animation() -> void:
	var d := _director("supersaiyan.supersaiyan3")
	if d == null:
		return
	assert_eq(dummy.last_anim, "transf.ssj3", "the form's own DMZ clip is played")
	_step(d, 0.2)

func test_only_one_director_per_entity() -> void:
	var a := _director(EPIC_FORM)
	assert_true(a != null)
	var b := TransformationDirector.play_for(dummy, MINOR_FORM)
	assert_true(b == null, "a second cinematic must be refused while one runs")
	assert_true(TransformationDirector.is_playing(dummy))

# --- B. per-form colour resolution ---------------------------------------

## Every form that carries a colour anywhere in forms.json must resolve its aura from
## that data - never from the group palette, the race default or the generic fallback.
func test_every_authored_form_resolves_its_own_colour() -> void:
	var checked := 0
	var bad: PackedStringArray = PackedStringArray()
	for id in Registry.forms.keys():
		var def: Dictionary = Registry.forms[String(id)]
		var authored := FormVfx.authored_fields(def)
		if authored.is_empty():
			continue
		checked += 1
		var p := FormVfx.of(def)
		if not authored.has(p.aura_source):
			bad.append("%s -> %s (authored: %s)" % [id, p.aura_source, str(authored)])
	assert_true(checked >= 30, "checked %d authored forms" % checked)
	assert_eq(bad.size(), 0, "forms falling back although they carry colour: %s" % str(bad))

## No form anywhere in the data may end up on the generic fallback colour, and none may
## end up white unless its own data really says white.
func test_no_form_falls_back_to_generic_white() -> void:
	var bad: PackedStringArray = PackedStringArray()
	for id in Registry.forms.keys():
		var def: Dictionary = Registry.forms[String(id)]
		var p := FormVfx.of(def)
		if p.aura_source == "fallback":
			bad.append("%s: no colour at all" % id)
			continue
		if p.aura.s < 0.1 and p.aura.v > 0.9:
			# white is only allowed when the data itself is white
			var authored := FormVfx.authored_fields(def)
			var white_by_data := false
			for f in authored:
				if Color(String(def.get(f, "#000000"))).s < 0.1:
					white_by_data = true
			if not white_by_data:
				bad.append("%s: generic white from %s" % [id, p.aura_source])
	assert_eq(bad.size(), 0, str(bad))

## A DMZ body/hair colour is often a brown-grey skin tone: those must never become the
## aura colour (a "transformation" with a mud coloured aura is not a transformation).
func test_desaturated_body_colours_never_become_the_aura() -> void:
	var evil := FormVfx.for_id("pureforms.evil")
	assert_true(evil.aura.s >= FormVfx.MIN_AURA_SATURATION,
		"majin evil aura %s is too grey" % evil.aura.to_html(false))
	assert_ne(evil.aura, Color("#917979"), "the grey skin tone is not an aura")
	# every form in the data: a saturated aura, or a colour the data authored as an aura
	var bad: PackedStringArray = PackedStringArray()
	for id in Registry.forms.keys():
		var p := FormVfx.for_id(String(id))
		if p.aura.s >= FormVfx.MIN_AURA_SATURATION:
			continue
		if FormVfx.AURA_FIELDS.has(p.aura_source):
			continue          # the data really says "white aura" (Ultimate/Mystic)
		bad.append("%s: %s from %s" % [id, p.aura.to_html(false), p.aura_source])
	assert_eq(bad.size(), 0, str(bad))

func test_form_families_read_differently() -> void:
	var ssj := FormVfx.for_id("ssgrades.supersaiyan")
	var kaio := FormVfx.for_id(MINOR_FORM)
	var namek := FormVfx.for_id("superforms.supernamekian")
	var xeno := FormVfx.for_id("legendaryforms.xeno")
	var majin := FormVfx.for_id("pureforms.evil")
	assert_eq(ssj.aura, Color("#FFD700"), "super saiyan is gold")
	assert_eq(ssj.family, "gold")
	assert_eq(kaio.aura, Color("#DB182C"), "kaioken is crimson")
	assert_eq(namek.aura, Color("#7FFF00"), "super namekian is acid green")
	assert_eq(namek.family, "green")
	assert_eq(xeno.family, "violet", "the xeno forms are violet")
	assert_ne(majin.aura, ssj.aura, "a majin form must not look like a saiyan one")
	# the inner core is never the same flat white for every family
	assert_ne(ssj.inner, namek.inner)
	assert_ne(ssj.inner, xeno.inner)

## A colourless form in a grab-bag group (DMZ dumps the Namekian giant, the Janemba
## forms and the Arcosian metal forms into "legendaryforms"/"superforms") must take its
## RACE colour, not the group signature - a giant Namekian is green, not pale gold.
func test_colourless_forms_take_the_race_colour_in_grab_bag_groups() -> void:
	var giant := FormVfx.for_id("superforms.giant")
	assert_eq(giant.aura_source, "race", "namekian giant follows its race")
	assert_eq(giant.aura, Color("#7FFF00"))
	var demon := FormVfx.for_id("legendaryforms.innocencedemon")
	assert_eq(demon.aura_source, "race", "Janemba follows the majin race colour")
	assert_eq(demon.aura, Color("#FF6DFF"))
	# a group that IS one family keeps its signature palette
	var android := FormVfx.for_id("androidforms.androidbase")
	assert_eq(android.aura_source, "group")
	assert_eq(android.aura, Color("#59C7FF"))
	var oozaru := FormVfx.for_id("oozaru.oozaru")
	assert_eq(oozaru.aura_source, "group", "the great ape keeps its brown gold")

func test_lightning_is_data_driven() -> void:
	assert_true(FormVfx.for_id(EPIC_FORM).lightning, "SSJ2 crackles")
	assert_true(FormVfx.for_id("supersaiyan.supersaiyan3").lightning)
	assert_true(FormVfx.for_id("ssgrades.supersaiyangrade3").lightning, "grade 3 by order")
	assert_true(not FormVfx.for_id(MINOR_FORM).lightning, "kaioken does not crackle")
	assert_true(not FormVfx.for_id("ssgrades.supersaiyan").lightning)
	var l := FormVfx.for_id(EPIC_FORM)
	assert_eq(l.lightning_color, Color("#A1FFF9"), "lightningColor from the data")

func test_giant_forms_scale_and_take_the_long_cinematic() -> void:
	var p := FormVfx.for_id(GIANT_FORM)
	assert_near(p.scale, 3.8, 0.01)
	assert_true(p.giant)
	assert_eq(p.tier, FormVfx.TIER_EPIC, "a giant form is an epic cinematic")
	assert_eq(FormVfx.for_id("ssgrades.supersaiyan").giant, false)

func test_every_form_has_an_animation_state() -> void:
	for id in Registry.forms.keys():
		var p := FormVfx.for_id(String(id))
		assert_true(p.anim != "", "%s has a transformationAnimation" % id)
		assert_true(p.anim_state != "", "%s maps to an anim state" % id)

# --- C. budgets -----------------------------------------------------------

func test_particle_budget_per_phase_within_the_mobile_cap() -> void:
	var d := _director(EPIC_FORM)
	if d == null:
		return
	var peak := 0
	var lights := 0
	var samples: Dictionary = {}
	var left := d.duration
	while left > 0.0 and is_instance_valid(d) and d.phase != TransformationDirector.Phase.DONE:
		d._process(1.0 / 60.0 * Engine.time_scale)
		left -= 1.0 / 60.0
		peak = maxi(peak, d.particle_budget())
		lights = maxi(lights, d.light_count())
		samples[d.phase_name()] = maxi(int(samples.get(d.phase_name(), 0)), d.particle_budget())
	assert_true(peak <= TransformationDirector.MAX_PARTICLES,
		"peak particles %d <= %d" % [peak, TransformationDirector.MAX_PARTICLES])
	assert_true(lights <= TransformationDirector.MAX_LIGHTS, "lights %d <= 2" % lights)
	assert_true(int(samples.get("gather", 0)) > 0, "the gather phase emits something")
	assert_true(int(samples.get("burst", 0)) >= int(samples.get("gather", 0)),
		"the climax is the loudest moment: %s" % str(samples))

func test_minor_forms_are_cheaper_than_epic_ones() -> void:
	var minor := FormVfx.for_id(MINOR_FORM)
	var epic := FormVfx.for_id(EPIC_FORM)
	assert_true(minor.duration < epic.duration)
	var d := _director(MINOR_FORM)
	if d == null:
		return
	_step(d, minor.duration * 0.8)
	assert_true(d.particle_budget() <= TransformationDirector.MAX_PARTICLES)

func test_no_gpu_particles_anywhere_in_the_cinematic() -> void:
	var d := _director(EPIC_FORM)
	if d == null:
		return
	_step(d, d.duration * 0.80)
	assert_eq(_count_class(d, "GPUParticles3D"), 0, "gl_compatibility: CPU particles only")

func _count_class(n: Node, cls: String) -> int:
	var total := 1 if n.is_class(cls) else 0
	for c in n.get_children():
		total += _count_class(c, cls)
	return total

# --- D. safety: time scale, cleanup, idle cost ---------------------------

func test_slow_motion_is_always_restored() -> void:
	var before := Engine.time_scale
	ScreenFx.slow_mo(0.4, 0.2)
	assert_true(Engine.time_scale < before, "slow motion engaged")
	var fx := ScreenFx.get_instance()
	assert_true(fx != null)
	fx._process(0.25 * Engine.time_scale)
	fx._process(0.05 * Engine.time_scale)
	assert_near(Engine.time_scale, before, 0.001, "time scale restored")

func test_hit_stop_is_restored_too() -> void:
	ScreenFx.hit_stop(0.05)
	var fx := ScreenFx.get_instance()
	fx._process(0.06 * Engine.time_scale)
	fx._process(0.01 * Engine.time_scale)
	assert_near(Engine.time_scale, 1.0, 0.001)

func test_director_leaves_no_nodes_behind() -> void:
	var before := _node_names(dummy)
	var d := _director(EPIC_FORM)
	if d == null:
		return
	_step(d, d.duration + 0.5)
	assert_eq(d.phase_name(), "done")
	assert_true(not TransformationDirector.is_playing(dummy), "registry entry released")
	# _finish() queue_free()s the director with everything parented under it
	assert_true(d.is_queued_for_deletion(), "the director frees itself")
	assert_true(d._light == null, "the climax light is released")
	await tree.process_frame
	await tree.process_frame
	var after := _node_names(dummy)
	for n in after:
		if before.has(n):
			continue
		# the persistent aura is meant to stay after a transformation
		assert_true(n == "Aura" or n == "Forms" or n == "Ki" or n == "Trails",
			"unexpected leftover node %s" % n)

func test_input_lock_is_released() -> void:
	var d := _director(EPIC_FORM)
	if d == null:
		return
	assert_true(dummy.input_locked, "the player cannot move during the cinematic")
	_step(d, d.duration + 0.2)
	assert_true(not dummy.input_locked, "input is given back")

func _node_names(n: Node) -> PackedStringArray:
	var out := PackedStringArray()
	for c in n.get_children():
		out.append(String(c.name))
	return out

func test_screen_fx_costs_nothing_while_idle() -> void:
	var fx := ScreenFx.get_instance()
	assert_true(fx != null)
	if fx == null:
		return
	fx.low_health_enabled = false
	fx._process(0.5)
	assert_true(ScreenFx.is_idle(), "idle after settling")
	assert_true(not fx.overlay_visible(), "the additive overlay is hidden")
	assert_true(not fx.screen_pass_active(), "the screen pass is off")
	ScreenFx.flash(Color(1, 1, 1), 0.1, 1.0)
	ScreenFx.radial_blur(0.08, 0.1)
	ScreenFx.chromatic(0.006, 0.1)
	assert_true(not ScreenFx.is_idle(), "running while an effect is up")
	for i in 20:
		fx._process(0.05)
	assert_true(ScreenFx.is_idle(), "back to zero cost when the pulse ends")
	assert_true(not fx.overlay_visible())

func test_impact_pulse_and_dim_release() -> void:
	var fx := ScreenFx.get_instance()
	fx.low_health_enabled = false
	ScreenFx.impact_pulse(1.0)
	ScreenFx.dim(0.6, 0.1, 0.1)
	ScreenFx.glow(0.8, 0.1, 0.1)
	assert_true(not ScreenFx.is_idle())
	for i in 40:
		fx._process(0.05)
	assert_true(ScreenFx.is_idle(), "dim and glow fade back to nothing")

# --- E. runtime aura / ki fx ---------------------------------------------

func test_aura_takes_its_colour_and_lightning_from_the_form() -> void:
	var a := Aura.get_for(dummy)
	assert_true(a != null)
	if a == null:
		return
	var p := FormVfx.for_id(EPIC_FORM)
	a.set_form(Forms.def(EPIC_FORM))
	assert_eq(a.outer_color, p.aura)
	assert_eq(a.has_lightning, true)
	assert_eq(a.lightning_color, p.lightning_color)
	var l: Node = a.get_node_or_null("Lightning")
	assert_true(l is AuraLightning, "lightning node built")
	a.set_form(Forms.def(MINOR_FORM))
	assert_eq(a.outer_color, Color("#DB182C"))
	assert_true(not a.has_lightning, "a kaioken has no arcs")

func test_aura_intensity_follows_its_inputs() -> void:
	var a := Aura.get_for(dummy)
	if a == null:
		return
	a.set_intensity(-1.0)
	a.set_charging(false)
	a.refresh()
	var idle := a._target
	a.set_charging(true)
	a.set_charge_progress(1.0)
	assert_true(a._target > idle, "charging is the loudest aura")
	a.set_visible_aura(false)
	assert_near(a._target, 0.0, 0.001, "the aura_status toggle silences it")

func test_lightning_bolt_budget() -> void:
	var a := Aura.get_for(dummy)
	if a == null:
		return
	a.set_form(Forms.def(EPIC_FORM))
	var l: AuraLightning = a.get_node_or_null("Lightning")
	assert_true(l != null)
	if l == null:
		return
	l.set_active(true)
	l.intensity = 1.4
	for i in 30:
		l._process(0.05)
	assert_true(l.visible_bolts() <= AuraLightning.BOLTS, "at most %d bolts" % AuraLightning.BOLTS)
	l.strike(Vector3.ZERO)
	assert_true(l.visible_bolts() >= 1, "the climax strike is visible")

func test_ki_charge_orb_builds_and_releases() -> void:
	var orb := KiEffects.charge(dummy, Color("#4FC3FF"), 1.0)
	assert_true(orb != null)
	if orb == null:
		return
	orb.set_progress(1.0)
	assert_true(orb.get_node_or_null("Sphere") != null, "the white hot core")
	assert_true(orb.get_node_or_null("Suck") != null, "inward sparkles")
	assert_true(orb.get_node_or_null("Mote0") != null, "orbiting motes")
	orb._process(0.1)
	orb.release()
	assert_true(orb.is_queued_for_deletion(), "the orb frees itself on release")

func test_hit_fx_stays_inside_the_one_shot_budget() -> void:
	# a private host so the count is this hit's particles only (the scene tree root
	# carries whatever the rest of the suite left behind)
	var host := Node3D.new()
	add_node(host)
	var victim := FxDummy.create("saiyan", "warrior")
	host.add_child(victim)
	HitFx.on_hit(victim, Vector3(0, 1.2, 0), 120.0, true, Damage.MELEE)
	var total := 0
	for n in _particles(host):
		total += n.amount
	assert_true(total > 0, "a hit spawns particles")
	assert_true(total <= 240, "a crit hit costs %d particles" % total)
	host.free()

func _particles(n: Node) -> Array[CPUParticles3D]:
	var out: Array[CPUParticles3D] = []
	if n == null:
		return out
	for c in n.get_children():
		if c is CPUParticles3D:
			out.append(c)
		out.append_array(_particles(c))
	return out

## Regression: `aaa/lightning/Smoke` is 60 % alpha-0 pixels with BLACK rgb, so Godot's
## mipmaps bleed black into it and a MIX blended puff renders as a black blob. Smoke and
## dust must therefore start from a texture whose transparent region is bright.
func test_smoke_textures_are_not_black_fringed() -> void:
	var list := FxAssets.smoke()
	assert_true(list.size() >= 1)
	assert_true(not FxAssets.BLACK_FRINGE_TEXTURES.has(list[0]),
		"the first smoke texture (%s) must not be black fringed" % list[0])
	assert_eq(list[0], "aaa/explosion/smoke_tex")

## Regression: a BedrockModel carries its own 1/16 model-unit scale, so copying the
## entity scale onto the duplicate blew the afterimage up 16x (it filled the screen).
func test_afterimage_keeps_the_model_scale() -> void:
	var host := Node3D.new()
	add_node(host)
	var e := FxDummy.create("saiyan", "warrior")
	host.add_child(e)
	if e.model != null:
		e.model.scale = Vector3.ONE * 0.0625
	var ghost := Trails.spawn_ghost(e, e.global_position, Color(1, 0.84, 0.0), 0.2)
	assert_true(ghost != null, "ghost spawned")
	if ghost != null:
		assert_near(ghost.scale.x, 0.0625, 0.0001, "the silhouette is model sized")
		ghost.free()
	host.free()

func test_transformation_uses_at_most_two_lights_at_once() -> void:
	var d := _director(EPIC_FORM)
	if d == null:
		return
	var peak := 0
	var left := d.duration
	while left > 0.0 and is_instance_valid(d) and d.phase != TransformationDirector.Phase.DONE:
		d._process(1.0 / 60.0 * Engine.time_scale)
		left -= 1.0 / 60.0
		peak = maxi(peak, d.light_count())
	assert_true(peak >= 1, "the strain phase lights the character with its own aura")
	assert_true(peak <= TransformationDirector.MAX_LIGHTS, "peak lights %d" % peak)

func test_revert_flash_plays_and_clears() -> void:
	var fx := ScreenFx.get_instance()
	fx.low_health_enabled = false
	fx._process(0.5)
	TransformationDirector.revert_flash(dummy, EPIC_FORM)
	assert_true(not ScreenFx.is_idle(), "the power down flashes")
	for i in 30:
		fx._process(0.05)
	assert_true(ScreenFx.is_idle(), "and releases the screen again")

# --- F. hair ownership during the cinematic -------------------------------

## A character model with the voxel hair of `style` attached, hosted on the dummy.
func _haired_dummy(style: String, color := Color(0.13, 0.15, 0.16)) -> BedrockModel:
	var bm := BedrockModel.new()
	bm.name = "Model"
	if not bm.load_geo("entity/races/human"):
		bm.free()
		return null
	if dummy.model != null and is_instance_valid(dummy.model):
		dummy.model.free()
	dummy.model = bm
	dummy.add_child(bm)
	bm.set_meta("character", {"race": "saiyan", "hair_type": 1, "hair_color": "#221a14"})
	HairBuilder.attach(bm, style, color)
	return bm

## The two tone style ("gotenks": main hair + gold accent spikes) keeps its materials
## per surface with no `material_override`, so a flicker that only looks at the override
## used to miss it and tint the whole body instead.
func test_hair_flicker_finds_a_two_tone_style() -> void:
	var bm := _haired_dummy("gotenks")
	assert_true(bm != null, "model built")
	if bm == null:
		return
	var hair := bm.get_bone("head").get_node_or_null("Hair") as MeshInstance3D
	assert_true(hair != null and hair.mesh.get_surface_count() > 1, "two tone hair has 2 surfaces")
	assert_true(hair.material_override == null, "a two tone style keeps no material_override")
	var main: StandardMaterial3D = hair.get_surface_override_material(0)
	var accent: StandardMaterial3D = hair.get_surface_override_material(1)
	var before_main := main.albedo_color
	var before_accent := accent.albedo_color
	var d := _director(EPIC_FORM)
	if d == null:
		return
	_step(d, d.duration * 0.45)          # inside the strain phase: the hair flickers
	assert_ne(main.albedo_color, before_main, "the form colour reached the main hair")
	assert_ne(accent.albedo_color, before_accent, "and the accent spikes")
	var gold: Color = main.albedo_color
	assert_true(gold.r > gold.b, "the flicker is the form's gold, not the base black")
	# the body is NOT tinted: the model tint fallback must not kick in for this style
	var body := bm.get_bone("body") as MeshInstance3D
	if body != null and body.material_override is StandardMaterial3D:
		var bm2: StandardMaterial3D = body.material_override
		assert_true(bm2.albedo_color.is_equal_approx(Color.WHITE),
			"the body stays untinted (%s)" % str(bm2.albedo_color))

## An aborted cast puts the character's own hair colour back; a cinematic that reaches
## the reveal leaves the form's hair alone (Forms/RaceSkin own it from the climax on)
## and drops the emissive pulse, so nothing keeps glowing after a revert.
func test_hair_is_restored_on_an_interrupt_but_handed_over_on_a_settle() -> void:
	var bm := _haired_dummy("spiky")
	if bm == null:
		return
	var mat := HairBuilder.hair_material(bm)
	assert_true(mat != null, "single surface styles keep the material_override")
	var base := mat.albedo_color
	var d := _director(EPIC_FORM)
	if d == null:
		return
	_step(d, d.duration * 0.45)
	assert_ne(mat.albedo_color, base, "the hair flickers during the strain")
	d.free()                              # interrupted: _release must undo the flicker
	assert_eq(mat.albedo_color, base, "an aborted transformation puts the hair back")
	assert_true(not mat.emission_enabled, "and stops the glow")

	var d2 := _director(EPIC_FORM)
	if d2 == null:
		return
	_step(d2, d2.duration + 0.2)          # all the way through the reveal
	assert_ne(mat.albedo_color, base, "the settled form keeps its own hair colour")
	assert_true(not mat.emission_enabled, "the hair stops pulsing once the aura settles")

## Lightning arcs are placed up to the model's real visual height, which includes the
## hair a form swaps in - the hitbox alone is a metre short of an SSJ3 mane.
func test_lightning_height_follows_the_model_not_the_hitbox() -> void:
	var bm := _haired_dummy("short")
	if bm == null:
		return
	var aura := Aura.get_for(dummy)
	assert_true(aura != null, "aura created")
	if aura == null:
		return
	var short_h := aura.visual_height()
	assert_true(short_h > 1.0, "a real model reports a real height (%.2f m)" % short_h)
	HairBuilder.attach(bm, "ssj3", Color(1, 0.88, 0.3))
	var mane_h := aura.visual_height()
	assert_true(mane_h > short_h, "the SSJ3 mane raises the arcs (%.2f -> %.2f m)" % [short_h, mane_h])
	aura.set_lightning(true, Color(0.6, 0.85, 1.0))
	assert_near(aura._lightning.height, mane_h, 0.01, "the arcs use the visual height")
	# a stub model that cannot report a height falls back to the hitbox default
	var plain := FxDummy.create("saiyan", "warrior")
	add_node(plain)
	if plain.model != null and is_instance_valid(plain.model):
		plain.model.free()
	var stub := Node3D.new()
	stub.name = "Model"
	plain.model = stub
	plain.add_child(stub)
	var pa := Aura.get_for(plain)
	assert_near(pa.visual_height(), 2.0 * pa.body_scale, 0.01, "fallback without model_height()")
	plain.free()
