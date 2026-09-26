class_name Aura
extends Node3D
## Runtime ki aura attached to an entity (docs/ARCHITECTURE.md §7/§8 fx).
##
## Built the way DragonMineZ builds it (`AuraRenderer.executeAuraShaderDraw`, verified
## with javap): ONE camera facing quad carrying the mod's own 4 frame flame strip
## (`entity/races/aura/<auraType>_aura.png`, 4096x1024 = 4 x 1024) drawn with
## `shaders/aura_sprite.gdshader`, which posterises the strip's mask into four bands of
## the FORM colour and ALPHA blends them; a flat `<auraType>_cross.png` quad on the
## ground that fades in as the camera looks down (DMZ crossfades them past 45 deg of
## pitch); the `sparking_effects.png` shard overlay; rising sparks and the optional
## lightning arcs of `AuraLightning.gd`.
##
## It replaced two ADDITIVE procedural flame shells plus a soft white halo quad, which
## between them washed every aura out to white-ish (a green Namekian aura came out pale
## white-green) and cost 700 shell triangles of noise-fbm fragment work. Two textured
## quads read closer to the mod AND are cheaper on a phone.
##
## Intensity is derived from three inputs and the loudest one wins:
##   * charging (Ki.set_charging)        -> strongest, grows with charge time
##   * power release > 70 %              -> steady aura
##   * current form                      -> form colour + base intensity
##
## Public API (other subsystems):
##   var a := Aura.get_for(entity)        # creates the node on first use
##   a.set_intensity(0.0 .. 1.5)
##   a.set_color(Color, Color)            # outer, inner
##   a.set_form(form_def: Dictionary)     # colour/lightning straight from forms.json
##   a.set_charging(true)                 # hold-to-charge
##   a.set_visible_aura(false)            # aura_status skill toggle
##   Aura.find_on(entity)                 # null when the entity has no aura yet

const NODE_NAME := "Aura"
const AURA_SHADER := "res://shaders/aura_sprite.gdshader"
const AURA_TEX_DIR := "races/aura/"
const FALLBACK_AURA_TYPE := "kakarot"
const LOOP_KEY_PREFIX := "aura_loop_"

## DMZ's own aura quad: 2 units tall/wide x `getAuraScale` (1.05 + 0.1 per active form,
## so 1.15 for a transformed player), centred 0.7 above the feet in that scaled space.
## The flame inside the strip fills ~74 % of the quad, i.e. ~1.7 m across a 0.6 m body.
## (DMZ's 1.15 x 2 units, nudged ~10 % up so the flame's dense band clears the head of
## our slightly differently proportioned voxel characters.)
const QUAD_SIZE := 2.55
const QUAD_CENTRE := 0.88
## Frames in the strips (4096/1024 and 1920/480; DMZ's shader hardcodes 1/4).
const STRIP_FRAMES := 4.0
## DMZ: speed = (tick + partial) * 0.5 -> 10 frames per second.
const STRIP_RATE := 10.0
## The horizontal energy shards (`sparking_effects.png`), at DMZ's own 0.8/0.65 scale.
const SPARKLE_SCALE := Vector2(0.8, 0.65)
const SPARKLE_OFFSET := -0.25
## Camera pitch (deg) past which DMZ fades the billboard out and the ground cross in.
const PITCH_FADE_START := 45.0
## ...and a floor under the ground cross so the aura still marks the ground at the
## shallow pitch a third person camera actually sits at.
const GROUND_FADE_MIN := 0.25

const SPARK_COUNT := 20
const RISE_COUNT := 16

var entity: Node = null
var body_scale := 1.0
var outer_color := Color(0.5, 1.0, 1.0)
var inner_color := Color(1.0, 1.0, 0.9)
var lightning_color := Color(0.65, 0.85, 1.0)
var has_lightning := false

var charging := false
var charge_progress := 0.0
var form_intensity := 0.0
var manual_intensity := -1.0
var aura_enabled := true

## The DMZ flame billboard, the ground cross quad and the shard overlay.
var _outer: MeshInstance3D
var _ground: MeshInstance3D
var _sparkle: MeshInstance3D
var _sparks: CPUParticles3D
var _rise: CPUParticles3D
var _lightning: AuraLightning
var _mat_outer: ShaderMaterial
var _mat_ground: ShaderMaterial
var _mat_sparkle: ShaderMaterial
## `auraType` of the current form: which flame strip the quads sample.
var aura_type := FALLBACK_AURA_TYPE
var _intensity := 0.0
var _target := 0.0
var _loop_key := ""
var _idle_t := 0.0
## Countdown to the next re-read of the model's visual height (see `visual_height`).
var _height_t := 0.0
## Transformation flicker: >0 while the aura is snapping in and out (phase B).
var _flicker := 0.0
var _flicker_white := 0.0
## Last frame's `_flicker_white`, so the colour is pushed once more when it drops to 0.
var _flicker_white_last := 0.0

# --- access ---------------------------------------------------------------

static func get_for(entity_node: Node) -> Aura:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var found := find_on(entity_node)
	if found != null:
		return found
	var a := Aura.new()
	a.name = NODE_NAME
	a.entity = entity_node
	entity_node.add_child(a)
	return a

static func find_on(entity_node: Node) -> Aura:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var n: Node = entity_node.get_node_or_null(NODE_NAME)
	return n if n is Aura else null

func _ready() -> void:
	if entity == null:
		entity = get_parent()
	_loop_key = LOOP_KEY_PREFIX + str(get_instance_id())
	_read_entity_defaults()
	_build()
	refresh()
	_apply_intensity(0.0)

func _exit_tree() -> void:
	Audio.stop_loop(_loop_key, 0.2)

# --- construction ---------------------------------------------------------

func _read_entity_defaults() -> void:
	if entity != null and "aabb_size" in entity:
		var s: Variant = entity.get("aabb_size")
		if s is Vector3 and (s as Vector3).y > 0.1:
			body_scale = (s as Vector3).y / 1.8
	var col := _entity_color()
	if col != null:
		outer_color = col
		inner_color = FormVfx.hot_band(outer_color)

## The character's OWN aura colour (profile for the player, `aura_color` for any other
## entity), or null when it has none. DMZ stores this on the character and only a form
## with its own `auraColor` overrides it.
##
## `Entity.gd` initialises `aura_color` to the generic "#7FFFFF" for every spawn, which
## is NOT a character's choice, so that exact value is ignored for anything but the
## player when the entity's race carries a colour of its own: a Namekian boss must be
## green, not the default cyan.
func _entity_color() -> Variant:
	var col: Variant = null
	var is_player := Game != null and Game.player == entity
	if is_player:
		col = Game.profile.get("character", {}).get("aura_color", null)
	if col == null and entity != null and "aura_color" in entity:
		col = entity.get("aura_color")
	var c: Variant = null
	if col is String and String(col) != "":
		c = Color(String(col))
	elif col is Color:
		c = col
	if c == null:
		return null
	if not is_player and (c as Color) == FormVfx.DEFAULT_AURA and _race_color() != null:
		return null
	return c

## `races.json` colour of the entity's race, or null.
func _race_color() -> Variant:
	if Registry == null or entity == null or not ("race" in entity):
		return null
	var r: Dictionary = Registry.race(String(entity.get("race")))
	var hex := String(r.get("defaultAuraColor", ""))
	return Color(hex) if hex.begins_with("#") else null

func _build() -> void:
	var quad := QuadMesh.new()
	quad.size = Vector2.ONE                  # scaled per frame, so one mesh fits all
	_mat_outer = _make_material(_strip("aura"), true, 0.0)
	_outer = MeshInstance3D.new()
	_outer.name = "Flame"
	_outer.mesh = quad
	_outer.material_override = _mat_outer
	_outer.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_outer)

	# the shards ride the same strip animation a quarter turn out of phase, so they do
	# not pop in lockstep with the flame
	_mat_sparkle = _make_material(_strip("sparking"), true, 1.7)
	_sparkle = MeshInstance3D.new()
	_sparkle.name = "Sparking"
	_sparkle.mesh = quad
	_sparkle.material_override = _mat_sparkle
	_sparkle.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_sparkle)

	_build_ground()
	_build_particles()

	_lightning = AuraLightning.new()
	_lightning.name = "Lightning"
	add_child(_lightning)
	_lightning.configure(lightning_color, body_scale, visual_height())
	_lightning.set_active(false)

## One of the mod's own aura strips, e.g. "kakarot_aura" / "god_cross" /
## "sparking_effects". Falls back to the kakarot strip when a form names an aura type we
## have no texture for (`entity_particle` would otherwise hand back a soft dot, which is
## not a 4 frame strip).
func _strip(kind: String) -> Texture2D:
	var tex_name := "sparking_effects" if kind == "sparking" else "%s_%s" % [aura_type, kind]
	for rel: String in [AURA_TEX_DIR + tex_name, AURA_TEX_DIR + "%s_%s" % [FALLBACK_AURA_TYPE, kind]]:
		if ResourceLoader.exists("res://assets/textures/entity/" + rel + ".png"):
			return FxAssets.entity_particle(rel)
	return FxAssets.entity_particle(AURA_TEX_DIR + tex_name)

func _make_material(tex: Texture2D, billboard: bool, phase: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	if ResourceLoader.exists(AURA_SHADER):
		m.shader = load(AURA_SHADER)
	m.set_shader_parameter("aura_tex", tex)
	m.set_shader_parameter("aura_color", outer_color)
	m.set_shader_parameter("intensity", 0.0)
	m.set_shader_parameter("fade", 1.0)
	m.set_shader_parameter("frames", STRIP_FRAMES)
	m.set_shader_parameter("anim_rate", STRIP_RATE)
	m.set_shader_parameter("phase", phase + randf())
	m.set_shader_parameter("billboard", billboard)
	return m

## The flat `<auraType>_cross.png` quad DMZ draws on the ground under the aura.
func _build_ground() -> void:
	var q := QuadMesh.new()
	q.size = Vector2.ONE
	q.orientation = PlaneMesh.FACE_Y
	_mat_ground = _make_material(_strip("cross"), false, 0.9)
	_ground = MeshInstance3D.new()
	_ground.name = "GroundGlow"
	_ground.mesh = q
	_ground.material_override = _mat_ground
	_ground.position = Vector3(0, 0.04, 0)
	_ground.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_ground)

func _build_particles() -> void:
	_sparks = FxAssets.make_particles("Sparks", SPARK_COUNT, ["ki_spark_0", "ki_spark_1", "spark1"], outer_color)
	_sparks.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	_sparks.emission_sphere_radius = 0.55 * body_scale
	_sparks.direction = Vector3.UP
	_sparks.spread = 35.0
	_sparks.initial_velocity_min = 1.6
	_sparks.initial_velocity_max = 4.2
	_sparks.gravity = Vector3(0, -1.2, 0)
	_sparks.scale_amount_min = 0.12
	_sparks.scale_amount_max = 0.28
	_sparks.lifetime = 0.55
	_sparks.position = Vector3(0, 0.9 * body_scale, 0)
	_sparks.emitting = false
	add_child(_sparks)

	_rise = FxAssets.make_particles("Rising", RISE_COUNT, ["ki_trail0", "aura_2", "ki_spark_1"], outer_color)
	_rise.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	_rise.emission_box_extents = Vector3(0.32, 0.1, 0.32) * body_scale
	_rise.direction = Vector3.UP
	_rise.spread = 8.0
	_rise.initial_velocity_min = 2.0
	_rise.initial_velocity_max = 4.0
	_rise.gravity = Vector3.ZERO
	_rise.scale_amount_min = 0.16
	_rise.scale_amount_max = 0.42
	_rise.lifetime = 0.55
	_rise.position = Vector3(0, 0.1, 0)
	_rise.emitting = false
	add_child(_rise)

# --- configuration --------------------------------------------------------

## Aura colour. `inner` is the hot band the sparks and other fx borrow; the aura's own
## bands are derived from `outer` INSIDE the shader exactly as DMZ derives them
## (x1.6 / x1.3 / x1.0 / x0.75), so the flame can never drift off the form's hue.
func set_color(outer: Color, inner := Color(0, 0, 0, 0)) -> void:
	outer_color = outer
	inner_color = inner if inner.a > 0.0 else FormVfx.hot_band(outer)
	_push_color()
	if _sparks != null:
		_sparks.color = inner_color
	if _rise != null:
		_rise.color = outer_color

## Colour (and the white flash of a transformation) into the three quad materials.
func _push_color() -> void:
	var c := outer_color if _flicker_white <= 0.0 else outer_color.lerp(Color(1, 1, 1), _flicker_white)
	for m: ShaderMaterial in [_mat_outer, _mat_ground, _mat_sparkle]:
		if m != null:
			m.set_shader_parameter("aura_color", c)

## Colour / lightning / base intensity straight out of a forms.json entry.
##
## `FormVfx` resolves the colour the way the mod does: the form's own `auraColor`, else
## the race default. When the form itself carries no colour, DMZ keeps the CHARACTER's
## own aura colour, so an entity/profile colour wins over the race default here.
func set_form(form_def: Dictionary) -> void:
	if form_def.is_empty():
		form_intensity = 0.0
		has_lightning = false
		if _lightning != null:
			_lightning.set_active(false)
		_read_entity_defaults()
		_set_aura_type(FormVfx.DEFAULT_AURA_TYPE)
		set_color(outer_color)
		refresh()
		return
	var p := FormVfx.of(form_def)
	var c := p.aura
	if not p.aura_from_form:
		var own := _entity_color()
		if own != null:
			c = own            # the character's personal aura colour, DMZ's own rule
	_set_aura_type(p.aura_type)
	set_color(c, FormVfx.hot_band(c))
	has_lightning = p.lightning
	lightning_color = p.lightning_color
	if _lightning != null:
		_lightning.configure(lightning_color, body_scale, visual_height())
		_lightning.set_active(has_lightning)
	# DMZ draws a third person aura at alp1 = 1.0 (the 0.45 in its renderer is the
	# first person pass), so a held form shows its flame at full strength.
	form_intensity = 1.0
	refresh()

## Swap the flame strips when a form asks for another `auraType` (kakarot / god).
func _set_aura_type(t: String) -> void:
	var want := t.strip_edges().to_lower()
	if want == "" or want == aura_type:
		return
	aura_type = want
	if _mat_outer != null:
		_mat_outer.set_shader_parameter("aura_tex", _strip("aura"))
	if _mat_ground != null:
		_mat_ground.set_shader_parameter("aura_tex", _strip("cross"))

## Grow the whole aura with the body (giant forms such as Oozaru). Cheap: the quads are
## re-scaled, never rebuilt.
func set_body_scale(s: float) -> void:
	body_scale = maxf(0.1, s)
	if _lightning != null:
		_lightning.configure(lightning_color, body_scale, visual_height())
	if _sparks != null:
		_sparks.emission_sphere_radius = 0.55 * body_scale
		_sparks.position = Vector3(0, 0.9 * body_scale, 0)
	if _rise != null:
		_rise.emission_box_extents = Vector3(0.32, 0.1, 0.32) * body_scale
	_apply_intensity(_intensity)     # re-scales the quads for the new body

func set_lightning(on: bool, color := Color(0, 0, 0, 0)) -> void:
	has_lightning = on
	if color.a > 0.0:
		lightning_color = color
	if _lightning != null:
		_lightning.configure(lightning_color, body_scale, visual_height())
		_lightning.set_active(on)

## How tall the aura effects may reach, in metres. The hitbox is only 1.8 m, but a
## transformed model is much taller than that (a form swaps in taller hair: SSJ3's mane
## alone adds most of a metre), so the entity's model is asked for its real visual
## height when it can report one. Guarded and duck-typed: a stub model or a plain
## capsule just gets the hitbox-derived default.
func visual_height() -> float:
	var fallback := 2.0 * body_scale
	if entity == null or not is_instance_valid(entity) or not ("model" in entity):
		return fallback
	var m: Variant = entity.get("model")
	if not (m is Node) or not (m as Node).has_method("model_height"):
		return fallback
	var h := float((m as Node).call("model_height"))
	if h <= 0.5:
		return fallback
	# a little headroom above the hair, and a ceiling so a giant form cannot make the
	# arcs spawn hundreds of metres up if a model reports nonsense
	return clampf(h * 1.06, fallback, 12.0 * body_scale)

## How far the lightning arcs reach out of the body (0 hugs the aura, 1 is the wild
## strain-phase crackle). Cheap: it only changes where the next bolt re-rolls.
func set_lightning_reach(amount: float) -> void:
	if _lightning != null:
		_lightning.reach = clampf(amount, 0.0, 1.5)

func set_charging(on: bool) -> void:
	charging = on
	if not on:
		charge_progress = 0.0
	refresh()

func set_charge_progress(p: float) -> void:
	charge_progress = clampf(p, 0.0, 1.0)
	refresh()

## Force an intensity; pass a negative value to go back to the automatic behaviour.
func set_intensity(v: float) -> void:
	manual_intensity = v
	refresh()

func set_visible_aura(on: bool) -> void:
	aura_enabled = on
	refresh()

func intensity() -> float:
	return _intensity

## Recompute the target intensity from charging / power release / form.
func refresh() -> void:
	if not aura_enabled:
		_target = 0.0
		return
	if manual_intensity >= 0.0:
		_target = manual_intensity
		return
	var t := form_intensity
	var k := Ki.find_on(entity)
	var release := k.power_release if k != null else 1.0
	if release > 0.7:
		t = maxf(t, 0.35 + (release - 0.7) * 1.4)
	if charging:
		t = maxf(t, 0.85 + charge_progress * 0.65)
	_target = clampf(t, 0.0, 1.6)

# --- per frame ------------------------------------------------------------

## Flicker the aura in and out (transformation "strain" phase). `white` blows the whole
## shell out to a white-hot sheet for a frame or two.
func set_flicker(amount: float, white := 0.0) -> void:
	_flicker = clampf(amount, 0.0, 1.0)
	_flicker_white = clampf(white, 0.0, 1.0)

func _process(delta: float) -> void:
	if entity == null or not is_instance_valid(entity):
		queue_free()
		return
	var _cpu0 := Time.get_ticks_usec()          # fx CPU accounting (FxAssets.cpu_usec)
	_idle_t += delta
	var speed := 8.0 if _target > _intensity else 3.5
	_apply_intensity(lerpf(_intensity, _target, clampf(delta * speed, 0.0, 1.0)))
	# The model grows during a transformation (giant forms, and the taller hair a form
	# swaps in lands after `set_form`), so re-read how high the arcs may go twice a
	# second instead of trusting the height we had when the form was applied.
	if has_lightning and _lightning != null:
		_height_t -= delta
		if _height_t <= 0.0:
			_height_t = 0.5
			var h := visual_height()
			if absf(h - _lightning.height) > 0.08:
				_lightning.configure(lightning_color, body_scale, h)
	FxAssets.cpu_add(Time.get_ticks_usec() - _cpu0)

func _apply_intensity(v: float) -> void:
	_intensity = v
	var vis := v > 0.02
	# idle motion: the flame breathes so a standing aura is never a frozen quad even
	# when the intensity does not change (the strip animation does the rest)
	var breath := 1.0 + sin(_idle_t * 2.3) * 0.05 + sin(_idle_t * 5.7) * 0.02
	var shown := v * (1.0 - _flicker * (0.5 + 0.5 * sin(_idle_t * 34.0)))
	if _flicker_white > 0.0 or _flicker_white_last > 0.0:
		_push_color()                       # the transformation's white-hot flash
		_flicker_white_last = _flicker_white
	# DMZ fades the billboard out and the ground cross in past 45 deg of camera pitch,
	# so a flat quad is never seen edge on.
	var down := _pitch_progress()
	var size := QUAD_SIZE * body_scale * (1.0 + v * 0.10)
	if _mat_outer != null:
		_mat_outer.set_shader_parameter("intensity", shown)
		_mat_outer.set_shader_parameter("fade", 1.0 - down)
	if _outer != null:
		_outer.visible = vis and down < 1.0
		_outer.scale = Vector3(size, size * breath * (1.0 - 0.5 * down), 1.0)
		_outer.position = Vector3(0, QUAD_CENTRE * body_scale * (1.0 + v * 0.06), 0)
	if _sparkle != null:
		_sparkle.visible = vis and down < 1.0
		var sp := 1.0 + 0.05 * sin(_idle_t * 3.2)        # DMZ's own shard pulse
		_sparkle.scale = Vector3(size * SPARKLE_SCALE.x * sp, size * SPARKLE_SCALE.y * sp, 1.0)
		_sparkle.position = Vector3(0, (QUAD_CENTRE + SPARKLE_OFFSET) * body_scale, 0)
		_mat_sparkle.set_shader_parameter("intensity", shown * 0.85)
		_mat_sparkle.set_shader_parameter("fade", 1.0 - down)
	if _ground != null:
		_ground.visible = vis
		_mat_ground.set_shader_parameter("intensity", shown)
		_mat_ground.set_shader_parameter("fade", maxf(down, GROUND_FADE_MIN))
		# body_scale like every other member: an Oozaru lights up a 3.8x patch of ground
		_ground.scale = Vector3.ONE * size * (1.0 + 0.04 * sin(_idle_t * 3.1))
	if _sparks != null:
		_sparks.emitting = v > 0.45
	if _rise != null:
		_rise.emitting = vis
	if _lightning != null:
		_lightning.set_active(has_lightning and v > 0.3)
		_lightning.intensity = v
	_update_loop(vis)

## How far past DMZ's 45 deg pitch threshold the camera is looking down (0..1): the
## billboard fades out over it and the ground cross fades in. 0 when there is no camera.
func _pitch_progress() -> float:
	var cam := FxAssets.camera(self)
	if cam == null or not cam.is_inside_tree():
		return 0.0
	var pitch := absf(rad_to_deg(asin(clampf(-cam.global_transform.basis.z.y, -1.0, 1.0))))
	if pitch <= PITCH_FADE_START:
		return 0.0
	var p := (pitch - PITCH_FADE_START) / PITCH_FADE_START
	return clampf(p * p, 0.0, 1.0)

func _update_loop(on: bool) -> void:
	if not (Game != null and Game.player == entity):
		return
	if on and _intensity > 0.5:
		if not Audio.is_loop_playing(_loop_key):
			Audio.play_loop("aura_loop", _loop_key, -8.0)
	elif Audio.is_loop_playing(_loop_key):
		Audio.stop_loop(_loop_key, 0.3)
