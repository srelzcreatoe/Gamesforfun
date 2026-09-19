class_name AmbientMotes
extends MultiMeshInstance3D
## A field of drifting specks: fireflies, pollen, dust, snow sparkle, embers, spirit motes.
##
## Every speck in the field is one MultiMesh instance, so the whole field is a single draw call.
## The instance buffer only changes when a speck has to be re-homed because the player walked
## away from it; ambient_motes.gdshader does the wander, the blink and the billboard, so a field
## that nobody re-homes costs exactly zero main-thread time.

const AABB_HALF := 260.0

var kind := ""
var homes: PackedVector3Array = PackedVector3Array()
var capacity := 0

var _mat: ShaderMaterial = null
var _color := Color(1, 1, 1)
var _radius := 1.2
var _rise := 0.0
var _blink := 0.0
var _rng := RandomNumberGenerator.new()

func setup(max_instances: int, seed_value: int = 0) -> void:
	capacity = maxi(0, max_instances)
	_rng.seed = seed_value if seed_value != 0 else 0x5eed_1a17
	name = "AmbientMotes"
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	custom_aabb = AABB(Vector3(-AABB_HALF, -AABB_HALF, -AABB_HALF), Vector3(AABB_HALF * 2.0, AABB_HALF * 2.0, AABB_HALF * 2.0))
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.use_custom_data = true
	mm.mesh = AmbientAssets.unit_quad()
	mm.instance_count = capacity
	mm.visible_instance_count = 0
	multimesh = mm
	homes.resize(capacity)
	for i in capacity:
		homes[i] = Vector3(0, -9999, 0)
	_mat = AmbientAssets.motes_material()
	material_override = _mat
	visible = false

## Switch the field to a new kind of speck. Cheap: it only writes uniforms.
func configure(new_kind: String, color: Color, sprite: Texture2D, size: float, glow: float,
		wander: float, radius: float, rise: float, blink: float, fade_end: float) -> void:
	kind = new_kind
	_color = color
	_radius = radius
	_rise = rise
	_blink = blink
	if _mat == null:
		return
	_mat.set_shader_parameter("sprite", sprite)
	_mat.set_shader_parameter("tint", Vector3(color.r, color.g, color.b))
	_mat.set_shader_parameter("size", size)
	_mat.set_shader_parameter("glow", glow)
	_mat.set_shader_parameter("wander", wander)
	_mat.set_shader_parameter("fade_start", fade_end * 0.62)
	_mat.set_shader_parameter("fade_end", fade_end)

func set_master_alpha(a: float) -> void:
	if _mat != null:
		_mat.set_shader_parameter("master_alpha", clampf(a, 0.0, 1.0))

func active_count() -> int:
	return multimesh.visible_instance_count if multimesh != null else 0

## Show the first `n` specks. Anything beyond stays in the buffer but is not drawn.
func set_active_count(n: int) -> void:
	if multimesh == null:
		return
	var v := clampi(n, 0, capacity)
	multimesh.visible_instance_count = v
	visible = v > 0

## Park speck `i` at `pos` with a fresh random phase.
func place(i: int, pos: Vector3) -> void:
	if multimesh == null or i < 0 or i >= capacity:
		return
	homes[i] = pos
	var t := Transform3D(Basis.IDENTITY, pos)
	multimesh.set_instance_transform(i, t)
	multimesh.set_instance_color(i, Color(_color.r, _color.g, _color.b, _rng.randf_range(0.65, 1.0)))
	multimesh.set_instance_custom_data(i, Color(
		_rng.randf(),
		_radius * _rng.randf_range(0.6, 1.4),
		_rise * _rng.randf_range(0.7, 1.3),
		_blink * _rng.randf_range(0.75, 1.3)))

func home_of(i: int) -> Vector3:
	return homes[i] if i >= 0 and i < homes.size() else Vector3.ZERO

## Mark every speck as needing a new home (planet change, teleport).
func invalidate() -> void:
	for i in homes.size():
		homes[i] = Vector3(0, -9999, 0)
