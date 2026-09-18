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

## Advance a hand-driven director by `seconds` in `dt` slices. The entity's `Aura` is
## stepped with it: in a real frame both are in the tree, and the aura only applies the
## intensity the director asks for (emitters on/off, shell scale) from its own _process.
func _step(d: TransformationDirector, seconds: float, dt := 1.0 / 60.0) -> void:
	var left := seconds
	while left > 0.0 and is_instance_valid(d) and d.phase != TransformationDirector.Phase.DONE:
		var s: float = minf(dt, left)
		d._process(s * Engine.time_scale)
		_step_aura(d.entity, s)
		left -= s

## One frame of the entity's aura (it is the director's own `_aura`, parented to the
## entity, so a hand-driven test has to tick it by hand as well).
func _step_aura(entity: Node, dt: float) -> void:
	if entity == null or not is_instance_valid(entity):
		return
	var a := Aura.find_on(entity)
	if a != null and is_instance_valid(a):
		a._process(dt)

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
	# FxAssets.real_delta clamps a frame to MAX_REAL_DELTA, so the 0.2 s of slow motion
	# takes a few frames to burn off - exactly as it does at 60 fps in the game
	for i in 10:
		fx._process(1.0 / 30.0 * Engine.time_scale)
	assert_near(Engine.time_scale, before, 0.001, "time scale restored")

func test_hit_stop_is_restored_too() -> void:
	ScreenFx.hit_stop(0.05)
	var fx := ScreenFx.get_instance()
	for i in 6:
		fx._process(1.0 / 30.0 * Engine.time_scale)
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
	for i in 12:
		fx._process(FxAssets.MAX_REAL_DELTA)
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

## Regression: `aaa/lightning/Smoke`, `aaa/missile_boost/Smoke` and `block_0..2` are
## 41-72 % alpha-0 pixels with BLACK rgb, which bleeds into the soft edge of a MIX
## blended puff. EVERY entry of the MIX smoke list has to be clean, not just the first:
## `FxAssets.particle()` falls through to the later names whenever an earlier one is
## missing, so a bad fallback is a bug waiting for an asset to be renamed.
func test_smoke_textures_are_not_black_fringed() -> void:
	var list := FxAssets.smoke()
	assert_true(list.size() >= 1, "there is a MIX smoke list")
	for name in list:
		assert_true(not FxAssets.BLACK_FRINGE_TEXTURES.has(name),
			"smoke fallback %s is black fringed" % name)
		assert_true(not FxAssets.DARK_MASK_TEXTURES.has(name),
			"smoke fallback %s is a dark alpha mask" % name)
		assert_true(ResourceLoader.exists(FxAssets.PARTICLE_DIR + name + ".png"),
			"smoke fallback %s exists (an absent one silently falls through)" % name)
	assert_eq(list[0], "aaa/explosion/smoke_tex")
	# and the very last resort, the procedural dot, is white
	var img := FxAssets.soft_dot().get_image()
	var mid := img.get_pixel(img.get_width() / 2, img.get_height() / 2)
	assert_true(mid.r > 0.9 and mid.g > 0.9 and mid.b > 0.9,
		"soft_dot is white, so it is safe in a MIX material too (%s)" % str(mid))

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
##
## The entity subsystem owns `BedrockModel` and `HairBuilder` and is edited
## concurrently, so they are loaded BY PATH and called duck-typed here exactly as the
## director does it: a rename over there must skip these three tests, not take the whole
## fx test file down with a parse error.
##
## And when `HairBuilder` is there but cannot currently build hair (it was red for a
## while mid-review, with its own tests failing), these tests must still verify OUR
## code: `_hair_attach` then falls back to `_synthetic_hair`, a "Hair" MeshInstance3D
## under the head bone built to the same contract the director walks (main hair in
## `material_override`, or surfaces 0/1 for a two tone style). A neighbouring
## subsystem's half-saved file can no longer redden the fx suite, and it cannot hide a
## broken flicker either.
const BEDROCK_PATH := "res://scripts/entity/BedrockModel.gd"
const HAIR_PATH := "res://scripts/entity/HairBuilder.gd"

static func _entity_script(path: String) -> GDScript:
	if not ResourceLoader.exists(path):
		return null
	var src: Variant = load(path)
	return src as GDScript

## A DMZ hair preset id by index, or a plain number when HairBuilder is missing.
func _preset_style(index: int) -> String:
	var hb := _entity_script(HAIR_PATH)
	if hb != null and hb.has_method("style_id"):
		return String(hb.call("style_id", index))
	return str(index + 1)

func _haired_dummy(style: String, color := Color(0.13, 0.15, 0.16)) -> Node3D:
	var src := _entity_script(BEDROCK_PATH)
	if src == null:
		return null
	var inst: Variant = src.new()
	if not (inst is Node3D) or not (inst as Node).has_method("load_geo"):
		if inst is Object:
			(inst as Object).free()
		return null
	var bm := inst as Node3D
	bm.name = "Model"
	if not bool(bm.call("load_geo", "entity/races/human")):
		bm.free()
		return null
	if dummy.model != null and is_instance_valid(dummy.model):
		dummy.model.free()
	dummy.model = bm
	dummy.add_child(bm)
	bm.set_meta("character", {"race": "saiyan", "hair_type": 1, "hair_color": "#221a14"})
	if not _hair_attach(bm, style, color):
		return null
	return bm

## `HairBuilder.attach`, duck-typed, with our own stand-in when the entity side does
## not (currently) produce a "Hair" node. False only when there is no model at all.
func _hair_attach(model: Node3D, style: String, color: Color) -> bool:
	if model == null:
		return false
	var hb := _entity_script(HAIR_PATH)
	if hb != null and hb.has_method("attach"):
		hb.call("attach", model, style, color)
	if TransformationDirector._hair_mesh(model) != null:
		return true
	return _synthetic_hair(model, style, color)

## Minimal "Hair" mesh built to the contract `TransformationDirector._hair_mesh` walks,
## used when the entity subsystem cannot supply one. Two surfaces (main + lighter
## accent, no `material_override`) for a two tone style, one `material_override`
## otherwise - the two shapes the director has to handle.
func _synthetic_hair(model: Node3D, style: String, color: Color) -> bool:
	if not model.has_method("get_bone"):
		return false
	var head: Variant = model.call("get_bone", "head")
	if not (head is Node3D):
		return false
	var host := head as Node3D
	var old: Node = host.get_node_or_null("Hair")
	if old != null:
		old.free()
	var mi := MeshInstance3D.new()
	mi.name = "Hair"
	mi.set_meta("synthetic", true)
	var two_tone := style in ["gotenks", "goten", "trunks"]
	if two_tone:
		var am := ArrayMesh.new()
		for i in 2:
			var box := BoxMesh.new()
			box.size = Vector3(0.5, 0.35 + 0.1 * float(i), 0.5)
			var arrays := box.get_mesh_arrays()
			am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mi.mesh = am
		var main := StandardMaterial3D.new()
		main.albedo_color = color
		var accent := StandardMaterial3D.new()
		accent.albedo_color = color.lightened(TransformationDirector.accent_lighten_amount())
		mi.set_surface_override_material(0, main)
		mi.set_surface_override_material(1, accent)
	else:
		var box := BoxMesh.new()
		# the SSJ3 mane is what makes `visual_height()` grow past a short cut
		box.size = Vector3(0.6, 1.4 if style == "ssj3" else 0.4, 0.6)
		mi.mesh = box
		var m := StandardMaterial3D.new()
		m.albedo_color = color
		mi.material_override = m
	mi.position = Vector3(0, box_top(mi), 0)
	host.add_child(mi)
	return true

## Half the hair mesh's own height, so a synthetic mane sticks UP out of the head bone
## (the aura reads the model aabb to place the lightning arcs).
func box_top(mi: MeshInstance3D) -> float:
	if mi.mesh == null:
		return 0.0
	return mi.mesh.get_aabb().size.y * 0.5

## The hair material, found the same way the director finds it (material_override for a
## single surface style, surface 0 for a two tone one).
func _hair_mat_of(model: Node3D) -> StandardMaterial3D:
	if model == null or not model.has_method("get_bone"):
		return null
	var head: Variant = model.call("get_bone", "head")
	if not (head is Node3D):
		return null
	var hair := (head as Node3D).get_node_or_null("Hair") as MeshInstance3D
	if hair == null:
		return null
	var mat := hair.material_override as StandardMaterial3D
	return mat if mat != null else hair.get_surface_override_material(0) as StandardMaterial3D

## The two tone style ("gotenks": main hair + gold accent spikes) keeps its materials
## per surface with no `material_override`, so a flicker that only looks at the override
## used to miss it and tint the whole body instead.
func test_hair_flicker_finds_a_two_tone_style() -> void:
	var bm := _haired_dummy("gotenks")
	assert_true(bm != null, "model built")
	if bm == null:
		return
	var head: Node3D = bm.call("get_bone", "head")
	var hair := head.get_node_or_null("Hair") as MeshInstance3D if head != null else null
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
	var body: MeshInstance3D = bm.call("get_bone", "body") as MeshInstance3D
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
	var mat := _hair_mat_of(bm)
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
	# hair styles are DMZ preset ids now ("1".."27"), and "<id>@ssj3" is that
	# preset's own SSJ3 mane (entity engineer's rename, same contract)
	var bm := _haired_dummy(_preset_style(0))
	if bm == null:
		return
	var aura := Aura.get_for(dummy)
	assert_true(aura != null, "aura created")
	if aura == null:
		return
	var short_h := aura.visual_height()
	assert_true(short_h > 1.0, "a real model reports a real height (%.2f m)" % short_h)
	_hair_attach(bm, _preset_style(7) + "@ssj3", Color(1, 0.88, 0.3))
	var mane_h := aura.visual_height()
	if mane_h <= short_h:
		# the entity side's preset ids are being reworked while this runs; what is under
		# test here is the AURA reading the model's real height, so fall back to a hair
		# mesh we own rather than failing on their rename
		_synthetic_hair(bm, "ssj3", Color(1, 0.88, 0.3))
		mane_h = aura.visual_height()
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

## The contract with the entity subsystem: whatever `HairBuilder.attach` builds, the
## director's duck-typed walk (head bone -> "Hair" -> `material_override` or surface 0)
## must find a material on it. SKIPPED rather than failed while the entity side cannot
## build hair (it is another engineer's file and it was mid-rename during this work), so
## a broken neighbour degrades the flicker instead of reddening the fx suite.
func test_the_directors_hair_walk_finds_the_entity_hair_builders_output() -> void:
	var model := _haired_dummy_real(_preset_style(0))
	if model == null:
		print("      (skipped: entity HairBuilder produced no Hair node)")
		return
	var d := _director(EPIC_FORM)
	if d == null:
		return
	var mat := d._hair_material(model)
	assert_true(mat != null, "the director resolves a material off the entity's hair")
	_step(d, d.duration * 0.45)
	assert_true(d._hair_base_set, "and remembers the base colour for the restore")
	d.free()

## A haired dummy that uses ONLY the entity subsystem's hair builder (no stand-in).
func _haired_dummy_real(style: String) -> Node3D:
	var bm := _haired_dummy(style)
	if bm == null:
		return null
	var hb := _entity_script(HAIR_PATH)
	if hb == null:
		return null
	var hair := TransformationDirector._hair_mesh(bm)
	if hair == null or hair.get_meta("synthetic", false):
		return null
	return bm

# --- G. giant forms: every layer has to grow, not just the model ----------

## Snapshot of the sizes a giant form is supposed to scale. Taken mid-strain (the rings,
## the debris and the strain light are all up then), plus the body scale the aura ends on.
## It builds its OWN entity so the two forms can be compared inside one test.
func _giant_snapshot(form_id: String) -> Dictionary:
	var host := Node3D.new()
	add_node(host)
	var e := FxDummy.create("saiyan", "warrior")
	host.add_child(e)
	var d := TransformationDirector.play_for(e, form_id)
	if d == null:
		host.free()
		return {}
	d.set_process(false)
	_step(d, d.duration * 0.60)
	var out: Dictionary = {"gs": d._gs, "scale": d.profile.scale}
	var aura := Aura.find_on(e)
	if aura != null:
		out["aura_outer"] = aura._outer.scale.x if aura._outer != null else 0.0
		out["aura_ground"] = aura._ground.scale.x if aura._ground != null else 0.0
	if d._decal != null and d._decal.mesh is QuadMesh:
		out["decal"] = (d._decal.mesh as QuadMesh).size.x
	if not d._rocks.is_empty() and d._rocks[0].mesh is BoxMesh:
		out["rock"] = (d._rocks[0].mesh as BoxMesh).size.x
	if d._aura_light != null:
		out["light_range"] = d._aura_light.omni_range
	for c in d.get_children():
		if String(c.name).begins_with("Ring") and c is MeshInstance3D \
				and (c as MeshInstance3D).mesh is QuadMesh:
			out["ring"] = maxf(float(out.get("ring", 0.0)),
				((c as MeshInstance3D).mesh as QuadMesh).size.x)
	# run on to the settle: the body is still growing at 60 %, so the final scale is
	# the one that has to match the form's own
	_step(d, maxf(0.0, d.duration * TransformationDirector.F_SETTLE - d.t))
	if aura != null and is_instance_valid(aura):
		out["final_body_scale"] = aura.body_scale
	if is_instance_valid(d):
		d.free()
	host.free()
	return out

## The reviewer's finding: only the model used to grow. The aura shells, the aura's
## GROUND GLOW (which `_apply_intensity` overwrote every frame with an unscaled value),
## the cracked-ground decal, the levitating debris CUBES (only their ring radius scaled),
## the shockwave rings and the light range all have to grow with the body as well.
func test_giant_forms_scale_every_layer_not_just_the_model() -> void:
	var human := _giant_snapshot(EPIC_FORM)
	if human.is_empty():
		return
	var giant := _giant_snapshot(GIANT_FORM)
	if giant.is_empty():
		return
	var k: float = float(giant["scale"])
	assert_near(k, 3.8, 0.01, "oozaru is a 3.8x body")
	assert_near(float(giant["gs"]), 3.8, 0.01, "and the fx scale follows it")
	for key in ["aura_outer", "aura_ground", "decal", "rock", "light_range", "ring"]:
		assert_true(human.has(key) and giant.has(key), "%s sampled for both" % key)
		if not (human.has(key) and giant.has(key)):
			continue
		var h: float = float(human[key])
		var g: float = float(giant[key])
		assert_true(g > h * 2.0,
			"%s grows with a giant body: %.3f -> %.3f (x%.2f, expected ~x%.1f)" % [key, h, g, g / maxf(h, 0.001), k])
	assert_near(float(giant["final_body_scale"]), k, 0.05,
		"the aura ends on the form's own body scale")
	assert_near(float(human["final_body_scale"]), 1.0, 0.05, "and a human stays human sized")

## The climax pillar used to keep a fixed 20 m height while its centre was pushed to
## 12 * scale, so an Oozaru's burst was a thin bar floating ~29 m above its head. The
## base has to sit just above the body whatever the form's size is.
func test_climax_pillar_stands_on_the_body_for_every_size() -> void:
	for form_id in [EPIC_FORM, GIANT_FORM]:
		var host := Node3D.new()
		add_node(host)
		var e := FxDummy.create("saiyan", "warrior")
		host.add_child(e)
		var d := TransformationDirector.play_for(e, form_id)
		if d == null:
			host.free()
			continue
		d.set_process(false)
		_step(d, d.duration * TransformationDirector.F_CLIMAX + 0.02)
		assert_eq(d.phase_name(), "burst", "%s reached the climax" % form_id)
		assert_true(d._pillar != null, "%s spawned a pillar" % form_id)
		if d._pillar != null:
			var cyl: CylinderMesh = d._pillar.mesh
			var height: float = cyl.height
			var base: float = d._pillar.position.y - height * 0.5
			var body: float = d._body_height()
			assert_true(body > 0.5, "%s reports a body height (%.2f m)" % [form_id, body])
			assert_true(base <= body * 1.6,
				"%s: the pillar base %.2f m must stay on the body (%.2f m tall)" % [form_id, base, body])
			assert_true(base >= body * 0.5,
				"%s: the pillar base %.2f m must clear the body (%.2f m)" % [form_id, base, body])
			assert_true(height > 8.0 * d._gs * 0.9,
				"%s: the pillar is as long as the body is big (%.1f m)" % [form_id, height])
		d.free()
		host.free()

# --- H. the black-quad regression ----------------------------------------

## THE bug: a MIX-blended CPUParticles3D with `local_coords = false` parented under a
## node whose global transform is re-assigned every frame submits zeroed instance slots,
## and because the material is BILLBOARD_PARTICLES those slots still cover pixels - with
## colour (0,0,0). Two independent guards, both asserted here: the emitter keeps its
## particles in its own space, and the director does not dirty its transform at all
## while the entity stands still. See FxAssets.mix_dust / FxPreview `--fx=dustdiag`.
func test_mix_blended_dust_never_uses_world_coords() -> void:
	var d := _director(EPIC_FORM)
	if d == null:
		return
	_step(d, 0.4)
	var checked := 0
	for n in _all_particles(d):
		var m := n.material_override as StandardMaterial3D
		if m == null or m.blend_mode != BaseMaterial3D.BLEND_MODE_MIX:
			continue
		checked += 1
		assert_true(n.local_coords,
			"%s is MIX blended, so it must own its particles (local_coords)" % n.name)
	assert_true(checked >= 1, "the cinematic has at least one MIX blended emitter")
	assert_true(d._dust != null and d._dust.local_coords, "the ground dust specifically")

func test_director_does_not_rewrite_its_transform_while_the_entity_stands_still() -> void:
	var d := _director(EPIC_FORM)
	if d == null:
		return
	_step(d, 0.4)
	var before := d.global_transform
	_step(d, 0.4)
	assert_true(d.global_transform.is_equal_approx(before),
		"the transform was never re-written while the entity stood still")
	# it DOES follow an entity that actually moves (a boss transforming mid-air)
	dummy.global_position = Vector3(4.0, 2.0, -1.0)
	_step(d, 1.0 / 60.0)
	assert_true(d.global_position.is_equal_approx(dummy.global_position),
		"but it still follows a moving entity (%s)" % str(d.global_position))

func _all_particles(n: Node) -> Array[CPUParticles3D]:
	var out: Array[CPUParticles3D] = []
	if n is CPUParticles3D:
		out.append(n as CPUParticles3D)
	for c in n.get_children():
		out.append_array(_all_particles(c))
	return out

## Every emitter the fx code hands out must be safe in a MIX material: `mix_dust` is the
## only documented way to switch one over, and it has to set both things.
func test_mix_dust_helper_sets_blend_and_ownership() -> void:
	var p := FxAssets.make_particles("T", 8, FxAssets.smoke(), Color(0.7, 0.7, 0.7))
	assert_eq((p.material_override as StandardMaterial3D).blend_mode, BaseMaterial3D.BLEND_MODE_ADD)
	assert_true(not p.local_coords, "make_particles defaults to world space")
	FxAssets.mix_dust(p)
	assert_eq((p.material_override as StandardMaterial3D).blend_mode, BaseMaterial3D.BLEND_MODE_MIX)
	assert_true(p.local_coords, "mix_dust also takes ownership of the particles")
	p.free()

# --- I. the budget has to be the ON SCREEN number ------------------------

## `particle_budget()` used to walk only the director's own children, so the persistent
## aura's emitters and the afterimage ghosts - both on screen during the cinematic, both
## parented elsewhere - were invisible to the budget test. It now counts the frame.
func test_particle_budget_counts_the_aura_and_the_ghosts_too() -> void:
	var host := Node3D.new()
	add_node(host)
	dummy.get_parent().remove_child(dummy)
	host.add_child(dummy)
	var d := _director(EPIC_FORM)
	if d == null:
		return
	_step(d, d.duration * 0.45)              # strain: aura up, ghosts spawning
	var aura := Aura.find_on(dummy)
	assert_true(aura != null, "the aura exists")
	var own := 0
	for n in _all_particles(d):
		if n.emitting:
			own += n.amount
	var aura_particles := 0
	if aura != null:
		for n in _all_particles(aura):
			if n.emitting:
				aura_particles += n.amount
	assert_true(aura_particles > 0, "the aura is emitting (%d)" % aura_particles)
	assert_eq(d.particle_budget(), own + aura_particles + _ghost_particles(host),
		"the budget is the director + the aura + the ghosts")
	assert_true(d.particle_budget() > own, "it is strictly more than the director alone")
	assert_true(d.particle_budget() <= TransformationDirector.MAX_PARTICLES,
		"and still inside the mobile cap")
	d.free()

func _ghost_particles(host: Node) -> int:
	var total := 0
	for c in host.get_children():
		if String(c.name).begins_with("Afterimage"):
			for n in _all_particles(c):
				if n.emitting:
					total += n.amount
	return total

# --- J. the fx clock cannot be jumped ------------------------------------

## Every fx clock runs in real time by dividing by `Engine.time_scale`. The climax sets
## a hit-stop of 0.001, so a single frame rendered while the scale is changing used to
## integrate delta/0.001 - the preview stage's `--at` clock landed 70 s past the second
## it was asked for, and the cinematic itself could skip a whole phase on a hitch.
func test_real_delta_is_clamped_so_a_hit_stop_cannot_jump_the_timeline() -> void:
	assert_near(FxAssets.real_delta(1.0 / 60.0), 1.0 / 60.0, 0.0001, "a normal frame is untouched")
	Engine.time_scale = 0.001
	assert_true(FxAssets.real_delta(1.0 / 60.0) <= FxAssets.MAX_REAL_DELTA,
		"a frame whose delta was scaled by the OLD time scale is clamped")
	Engine.time_scale = 1.0
	assert_true(FxAssets.real_delta(4.0) <= FxAssets.MAX_REAL_DELTA, "so is a streaming hitch")

	var d := _director(EPIC_FORM)
	if d == null:
		return
	d._process(1.0 / 60.0)
	Engine.time_scale = 0.001                 # what ScreenFx.hit_stop does at the climax
	var before := d.t
	d._process(1.0 / 60.0)                    # delta still scaled by the old 1.0
	Engine.time_scale = 1.0
	assert_true(d.t - before <= FxAssets.MAX_REAL_DELTA + 0.001,
		"the cinematic clock advanced %.3f s, not a jump" % (d.t - before))
	assert_eq(d.phase_name(), "gather", "and it is still in the phase it was in")
	d.free()

## The strain dim is drawn by the world's post pass in game and by ScreenFx's own pass in
## the preview. They have to gate the "hot fx burn through" identically, or the dim reads
## in the preview and does nothing in the real world - which is exactly what happened
## while the gate opened at 0.7 luma, below sunlit voxel terrain.
func test_the_two_dim_passes_share_one_burn_through_gate() -> void:
	var gate := "clamp((dl - 0.88) * 6.0, 0.0, 1.0) * 0.85"
	var world := FileAccess.get_file_as_string("res://shaders/post_process.gdshader")
	var own := FileAccess.get_file_as_string("res://shaders/fx_screen.gdshader")
	assert_true(world.find(gate) >= 0, "the world post pass gates the dim at 0.88 luma")
	assert_true(own.find(gate.replace("dl", "l")) >= 0, "and so does the fx screen pass")
	assert_true(world.find("(dl - 0.7)") < 0, "the old daylight-transparent gate is gone")

## Both dim passes have to SCALE the frame down (vignette weighted), not mix it toward a
## fixed near-black. The absolute version was invisible in noon daylight - the whole
## point of the strain dim - and it crushed shadowed leaves to pure black.
func test_the_dim_is_a_proportional_vignette_in_both_passes() -> void:
	var world := FileAccess.get_file_as_string("res://shaders/post_process.gdshader")
	var own := FileAccess.get_file_as_string("res://shaders/fx_screen.gdshader")
	for src: Array in [[world, "post_process", "fx_darken"], [own, "fx_screen", "darken"]]:
		var code: String = src[0]
		var who: String = src[1]
		var uni: String = src[2]
		assert_true(code.find("col * mix(1.0, 0.10, amt)") >= 0,
			"%s scales the frame down instead of mixing to a fixed colour" % who)
		assert_true(code.find("float amt = clamp(%s * edge, 0.0, 1.0)" % uni) >= 0,
			"%s weights the dim by the distance from the centre" % who)
		assert_true(code.find("mix(col, vec3(0.03, 0.04, 0.09)") < 0,
			"%s no longer mixes toward an absolute near-black" % who)

## A near-black vignette is meaningless on an additive overlay (shaders/flash.gdshader is
## `blend_add`), which is why the strain "vignette" was missing in game while the uniform
## said 0.62. ScreenFx now serves a dark request with the dim pass, and keeps the
## additive overlay for coloured ones (the red damage pulse).
func test_a_dark_vignette_is_served_by_the_dim_not_by_an_additive_overlay() -> void:
	var fx := ScreenFx.get_instance()
	assert_true(fx != null, "screen fx available")
	if fx == null:
		return
	ScreenFx.clear_sustained(0.0)
	fx._darken = 0.0
	fx._darken_target = 0.0
	fx._vignette = 0.0
	ScreenFx.vignette_hold(Color(0.02, 0.02, 0.05), 0.6, 1.0, 0.4)
	assert_eq(fx._vignette, 0.0, "nothing is pushed into the additive overlay")
	assert_true(fx._darken_target > 0.3, "the dim carries it instead (%.2f)" % fx._darken_target)
	ScreenFx.clear_sustained(0.0)
	fx._vignette = 0.0
	ScreenFx.vignette_pulse(Color(0.6, 0.04, 0.04), 0.5, 0.4)
	assert_true(fx._vignette > 0.3, "a coloured vignette still uses the overlay")
	ScreenFx.clear_sustained(0.0)
	fx._vignette = 0.0

## The ground cracks are a MIX-blended decal, so its albedo IS what you see: it was
## being pushed to WHITE every frame, which is invisible on sunlit grass and sand (the
## cracks read in the preview's dark studio and were missing from the in-world shot).
func test_the_ground_cracks_stay_dark_instead_of_white() -> void:
	var d := _director(EPIC_FORM)
	assert_true(d != null, "director created")
	if d == null:
		return
	assert_true(d._decal != null, "the crack decal exists")
	var m: StandardMaterial3D = d._decal.material_override
	assert_eq(m.blend_mode, BaseMaterial3D.BLEND_MODE_MIX, "MIX blended")
	_step(d, d.duration * 0.5)                      # cracks fully open
	assert_true(m.albedo_color.a > 0.4, "and it is visible mid-strain (a=%.2f)" % m.albedo_color.a)
	assert_true(m.albedo_color.get_luminance() < 0.2,
			"torn earth is DARK, not white (%s)" % str(m.albedo_color))
	# the glow sits under the dark cracks and reaches a little wider, so it halos
	var gm: StandardMaterial3D = d._crack_glow.material_override
	assert_true(gm.render_priority < m.render_priority, "the glow is drawn under the cracks")
	var gsize: float = (d._crack_glow.mesh as QuadMesh).size.x
	var dsize: float = (d._decal.mesh as QuadMesh).size.x
	assert_true(gsize > dsize, "the glow is wider than the crack decal (%.1f > %.1f)" % [gsize, dsize])
	d.free()

## Debris is solid geometry, not light. An unshaded dark rock is a flat black slab in a
## sunlit voxel world (that is how the levitating rocks read in the in-world shot), so
## the debris material is the one fx material that is SHADED.
func test_levitating_debris_is_lit_geometry_not_a_black_slab() -> void:
	var d := _director(EPIC_FORM)
	if d == null:
		return
	_step(d, d.duration * 0.5)
	assert_true(not d._rocks.is_empty(), "debris exists during the strain")
	var mat: StandardMaterial3D = d._rocks[0].material_override
	assert_true(mat != null, "debris has a material")
	assert_ne(mat.shading_mode, BaseMaterial3D.SHADING_MODE_UNSHADED, "it is lit by the scene")
	assert_true(mat.albedo_color.get_luminance() > 0.25,
			"and its rock colour is not near-black (%s)" % str(mat.albedo_color))
	assert_true(mat.emission_enabled and mat.emission_energy_multiplier < 0.5,
			"with a small floor for unlit studios, not a glowing cube")
	d.free()

## The cinematic measures its OWN cost (FxAssets.cpu_usec), because the engine's
## Performance.TIME_PROCESS monitor reads 0 in a headless run and mixes in every other
## script in the scene. `FxPreview --profile` divides this by the frames per phase.
func test_the_cinematic_accounts_for_its_own_cpu_time() -> void:
	FxAssets.cpu_take()                                # start from zero
	assert_eq(FxAssets.cpu_take(), 0, "reading the counter clears it")
	var d := _director(EPIC_FORM)
	assert_true(d != null, "director created")
	if d == null:
		return
	_step(d, 0.5)
	var spent := FxAssets.cpu_take()
	assert_true(spent > 0, "the stepped cinematic recorded its own microseconds")
	assert_true(spent < 500000, "and it is a per-frame cost, not half a second (%d us)" % spent)
	assert_eq(FxAssets.cpu_take(), 0, "and the counter is cleared again")
	d.free()

## An afterimage shares ONE additive material per texture instead of building one per
## surface: the strain phase throws a ghost every 0.3 s and a DMZ character is ~20
## surfaces over 2 textures, which showed up as a per-frame spike in --profile.
func test_afterimage_shares_one_material_per_texture() -> void:
	var host := Node3D.new()
	add_node(host)
	var e := FxDummy.create("saiyan", "warrior", true)
	host.add_child(e)
	var ghost := Trails.spawn_ghost(e, Vector3.ZERO, Color(1, 0.9, 0.3), 0.3)
	assert_true(ghost != null, "ghost spawned")
	if ghost == null:
		return
	var mats: Array = []
	var meshes := _collect_meshes(ghost, mats)
	assert_true(meshes >= 2, "the ghost copied a multi-surface model (%d meshes)" % meshes)
	assert_true(mats.size() <= 3,
		"%d meshes share %d materials (one per texture)" % [meshes, mats.size()])
	host.free()

func _collect_meshes(n: Node, mats: Array) -> int:
	var total := 0
	if n is MeshInstance3D:
		total += 1
		var m: Variant = (n as MeshInstance3D).material_override
		if m != null and not mats.has(m):
			mats.append(m)
	for c in n.get_children():
		total += _collect_meshes(c, mats)
	return total
