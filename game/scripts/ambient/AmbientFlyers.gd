class_name AmbientFlyers
extends MultiMeshInstance3D
## The butterfly field: two-quad flapping billboards over grass and flowers.
##
## Same idea as AmbientMotes — one MultiMesh, one draw call, and the flight path plus the wing
## fold live in ambient_butterfly.gdshader. Each butterfly costs two quads of the ambient budget.

const AABB_HALF := 120.0

var homes: PackedVector3Array = PackedVector3Array()
var capacity := 0

var _mat: ShaderMaterial = null
var _rng := RandomNumberGenerator.new()

func setup(max_instances: int, seed_value: int = 0) -> void:
	capacity = maxi(0, max_instances)
	_rng.seed = seed_value if seed_value != 0 else 0xb47_7e2f
	name = "AmbientFlyers"
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	custom_aabb = AABB(Vector3(-AABB_HALF, -AABB_HALF, -AABB_HALF), Vector3(AABB_HALF * 2.0, AABB_HALF * 2.0, AABB_HALF * 2.0))
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = false
	mm.use_custom_data = true
	mm.mesh = AmbientAssets.butterfly_mesh()
	mm.instance_count = capacity
	mm.visible_instance_count = 0
	multimesh = mm
	homes.resize(capacity)
	for i in capacity:
		homes[i] = Vector3(0, -9999, 0)
	_mat = AmbientAssets.butterfly_material()
	_mat.set_shader_parameter("sprite", AmbientAssets.tex(AmbientAssets.BUTTERFLY_TEXTURES[0]))
	_mat.set_shader_parameter("size", 0.34)
	_mat.set_shader_parameter("fade_start", 15.0)
	_mat.set_shader_parameter("fade_end", 26.0)
	material_override = _mat
	visible = false

func set_sprite(tex: Texture2D) -> void:
	if _mat != null:
		_mat.set_shader_parameter("sprite", tex)

## Daylight tint so butterflies darken with the evening instead of glowing flat white.
func set_light(color: Color) -> void:
	if _mat != null:
		_mat.set_shader_parameter("light_tint", Vector3(color.r, color.g, color.b))

func set_master_alpha(a: float) -> void:
	if _mat != null:
		_mat.set_shader_parameter("master_alpha", clampf(a, 0.0, 1.0))

func active_count() -> int:
	return multimesh.visible_instance_count if multimesh != null else 0

func set_active_count(n: int) -> void:
	if multimesh == null:
		return
	var v := clampi(n, 0, capacity)
	multimesh.visible_instance_count = v
	visible = v > 0

func place(i: int, pos: Vector3, radius: float) -> void:
	if multimesh == null or i < 0 or i >= capacity:
		return
	homes[i] = pos
	multimesh.set_instance_transform(i, Transform3D(Basis.IDENTITY, pos))
	multimesh.set_instance_custom_data(i, Color(
		_rng.randf(),
		radius * _rng.randf_range(0.7, 1.3),
		_rng.randf_range(0.75, 1.35),
		_rng.randf_range(0.8, 1.25)))

func home_of(i: int) -> Vector3:
	return homes[i] if i >= 0 and i < homes.size() else Vector3.ZERO

func invalidate() -> void:
	for i in homes.size():
		homes[i] = Vector3(0, -9999, 0)
