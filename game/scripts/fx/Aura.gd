class_name Aura
extends Node3D
## Runtime ki aura attached to an entity (docs/ARCHITECTURE.md §7/§8 fx).
##
## Two additive flame shells (`shaders/aura.gdshader`) plus rising sparks, a ground
## light quad and the optional lightning arcs of `AuraLightning.gd`. Intensity is
## derived from three inputs and the loudest one wins:
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
const AURA_SHADER := "res://shaders/aura.gdshader"
const DMZ_AURA_MODEL := "res://assets/models/entity/races/kiaura.geo.json"
const LOOP_KEY_PREFIX := "aura_loop_"

## Mesh proportions (entity 1.8 m tall; scaled by `body_scale`).
const AURA_HEIGHT := 2.45
const AURA_RADIUS := 0.46
const RINGS := 10
const SEGMENTS := 16

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

var _outer: MeshInstance3D
var _inner: MeshInstance3D
var _ground: MeshInstance3D
var _sparks: CPUParticles3D
var _rise: CPUParticles3D
var _lightning: AuraLightning
var _mat_outer: ShaderMaterial
var _mat_inner: ShaderMaterial
var _mat_ground: StandardMaterial3D
var _intensity := 0.0
var _target := 0.0
var _loop_key := ""

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
	var col: Variant = null
	if Game != null and Game.player == entity:
		col = Game.profile.get("character", {}).get("aura_color", null)
	if col == null and entity != null and "aura_color" in entity:
		col = entity.get("aura_color")
	if col is String and String(col) != "":
		outer_color = Color(String(col))
	elif col is Color:
		outer_color = col

func _build() -> void:
	var mesh := _build_shell(1.0)
	_mat_outer = _make_material(outer_color, inner_color, 3.4, 3.6)
	_outer = MeshInstance3D.new()
	_outer.name = "Outer"
	_outer.mesh = mesh
	_outer.material_override = _mat_outer
	_outer.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_outer.scale = Vector3.ONE * body_scale
	add_child(_outer)

	_mat_inner = _make_material(inner_color, Color(1, 1, 1), 5.0, 4.2)
	_mat_inner.set_shader_parameter("seed", 13.0)
	_mat_inner.set_shader_parameter("tip_fade", 0.55)
	_inner = MeshInstance3D.new()
	_inner.name = "Inner"
	_inner.mesh = _build_shell(0.62)
	_inner.material_override = _mat_inner
	_inner.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_inner.scale = Vector3.ONE * body_scale
	add_child(_inner)

	_build_ground()
	_build_particles()

	_lightning = AuraLightning.new()
	_lightning.name = "Lightning"
	add_child(_lightning)
	_lightning.configure(lightning_color, body_scale)
	_lightning.set_active(false)

func _make_material(c: Color, inner: Color, noise: float, scroll: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	if ResourceLoader.exists(AURA_SHADER):
		m.shader = load(AURA_SHADER)
	m.set_shader_parameter("aura_color", c)
	m.set_shader_parameter("inner_color", inner)
	m.set_shader_parameter("noise_scale", noise)
	m.set_shader_parameter("scroll_speed", scroll)
	m.set_shader_parameter("intensity", 0.0)
	m.set_shader_parameter("seed", randf() * 10.0)
	return m

## Teardrop surface of revolution; the aura shader carves the flame tongues out of it.
func _build_shell(scale_r: float) -> ArrayMesh:
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	var normals := PackedVector3Array()
	var idx := PackedInt32Array()
	for ring in RINGS + 1:
		var t := float(ring) / float(RINGS)
		var y := t * AURA_HEIGHT - 0.12
		# bulge around the hips, taper to a point at the top
		var r := AURA_RADIUS * scale_r * (0.55 + 0.85 * sin(clampf(t, 0.0, 1.0) * PI * 0.92))
		r *= 1.0 - 0.35 * smoothstep(0.65, 1.0, t)
		for seg in SEGMENTS + 1:
			var a := float(seg) / float(SEGMENTS) * TAU
			var dir := Vector3(cos(a), 0.0, sin(a))
			verts.append(dir * r + Vector3(0, y, 0))
			normals.append(dir)
			uvs.append(Vector2(float(seg) / float(SEGMENTS), t))
	for ring in RINGS:
		for seg in SEGMENTS:
			var a0 := ring * (SEGMENTS + 1) + seg
			var a1 := a0 + 1
			var b0 := a0 + SEGMENTS + 1
			var b1 := b0 + 1
			idx.append_array([a0, b0, a1, a1, b0, b1])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = normals
	arr[Mesh.ARRAY_TEX_UV] = uvs
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m

func _build_ground() -> void:
	var q := QuadMesh.new()
	q.size = Vector2(3.0, 3.0)
	q.orientation = PlaneMesh.FACE_Y
	_mat_ground = StandardMaterial3D.new()
	_mat_ground.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mat_ground.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	_mat_ground.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_mat_ground.cull_mode = BaseMaterial3D.CULL_DISABLED
	_mat_ground.no_depth_test = false
	_mat_ground.disable_receive_shadows = true
	_mat_ground.albedo_texture = FxAssets.soft_dot()
	_mat_ground.albedo_color = Color(outer_color.r, outer_color.g, outer_color.b, 0.0)
	_ground = MeshInstance3D.new()
	_ground.name = "GroundGlow"
	_ground.mesh = q
	_ground.material_override = _mat_ground
	_ground.position = Vector3(0, 0.03, 0)
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

func set_color(outer: Color, inner := Color(0, 0, 0, 0)) -> void:
	outer_color = outer
	if inner.a > 0.0:
		inner_color = inner
	else:
		inner_color = outer.lightened(0.55)
	if _mat_outer != null:
		_mat_outer.set_shader_parameter("aura_color", outer_color)
		_mat_outer.set_shader_parameter("inner_color", inner_color)
	if _mat_inner != null:
		_mat_inner.set_shader_parameter("aura_color", inner_color)
	if _sparks != null:
		_sparks.color = outer_color.lightened(0.3)
	if _rise != null:
		_rise.color = outer_color
	if _mat_ground != null:
		_mat_ground.albedo_color = Color(outer_color.r, outer_color.g, outer_color.b, _mat_ground.albedo_color.a)

## Colour / lightning / base intensity straight out of a forms.json entry.
func set_form(form_def: Dictionary) -> void:
	if form_def.is_empty():
		form_intensity = 0.0
		has_lightning = false
		if _lightning != null:
			_lightning.set_active(false)
		_read_entity_defaults()
		set_color(outer_color)
		refresh()
		return
	var ac := String(form_def.get("auraColor", ""))
	if ac != "":
		set_color(Color(ac))
	var extra := String(form_def.get("extraAuraColor", ""))
	if extra != "":
		inner_color = Color(extra)
		if _mat_inner != null:
			_mat_inner.set_shader_parameter("aura_color", inner_color)
	has_lightning = bool(form_def.get("hasLightnings", false))
	var lc := String(form_def.get("lightningColor", ""))
	lightning_color = Color(lc) if lc != "" else outer_color.lightened(0.4)
	if _lightning != null:
		_lightning.configure(lightning_color, body_scale)
		_lightning.set_active(has_lightning)
	form_intensity = 0.7
	refresh()

func set_lightning(on: bool, color := Color(0, 0, 0, 0)) -> void:
	has_lightning = on
	if color.a > 0.0:
		lightning_color = color
	if _lightning != null:
		_lightning.configure(lightning_color, body_scale)
		_lightning.set_active(on)

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

func _process(delta: float) -> void:
	if entity == null or not is_instance_valid(entity):
		queue_free()
		return
	var speed := 8.0 if _target > _intensity else 3.5
	_apply_intensity(lerpf(_intensity, _target, clampf(delta * speed, 0.0, 1.0)))

func _apply_intensity(v: float) -> void:
	_intensity = v
	var vis := v > 0.02
	if _mat_outer != null:
		_mat_outer.set_shader_parameter("intensity", v)
	if _mat_inner != null:
		_mat_inner.set_shader_parameter("intensity", v * 0.85)
	if _outer != null:
		_outer.visible = vis
		_outer.scale = Vector3(1.0 + v * 0.12, 1.0 + v * 0.22, 1.0 + v * 0.12) * body_scale
	if _inner != null:
		_inner.visible = vis
	if _ground != null:
		_ground.visible = vis
		_mat_ground.albedo_color = Color(outer_color.r, outer_color.g, outer_color.b, clampf(v * 0.35, 0.0, 0.5))
		_ground.scale = Vector3.ONE * (0.8 + v * 0.5)
	if _sparks != null:
		_sparks.emitting = v > 0.45
	if _rise != null:
		_rise.emitting = vis
	if _lightning != null:
		_lightning.set_active(has_lightning and v > 0.3)
		_lightning.intensity = v
	_update_loop(vis)

func _update_loop(on: bool) -> void:
	if not (Game != null and Game.player == entity):
		return
	if on and _intensity > 0.5:
		if not Audio.is_loop_playing(_loop_key):
			Audio.play_loop("aura_loop", _loop_key, -8.0)
	elif Audio.is_loop_playing(_loop_key):
		Audio.stop_loop(_loop_key, 0.3)
