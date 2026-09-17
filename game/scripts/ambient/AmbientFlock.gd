class_name AmbientFlock
extends MultiMeshInstance3D
## One flock of birds crossing the sky in a V, 3-6 strong, with a two-frame wing flap.
##
## The instance transforms hold only the formation offsets; ambient_birds.gdshader flies the
## whole flock along `heading` from `origin`, fading in and out at the ends of the pass. The CPU
## touches the flock only when it re-seeds it (roughly once per pass), so it is free to keep.

const AABB_HALF := 400.0

var capacity := 0
var origin := Vector3.ZERO
var heading := Vector3.RIGHT
var period := 52.0
var span := 260.0

var _mat: ShaderMaterial = null
var _rng := RandomNumberGenerator.new()

func setup(max_birds: int, seed_value: int = 0) -> void:
	capacity = maxi(0, max_birds)
	_rng.seed = seed_value if seed_value != 0 else 0xb12d_5107
	name = "AmbientFlock"
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	custom_aabb = AABB(Vector3(-AABB_HALF, -AABB_HALF, -AABB_HALF), Vector3(AABB_HALF * 2.0, AABB_HALF * 2.0, AABB_HALF * 2.0))
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = false
	mm.use_custom_data = true
	mm.mesh = AmbientAssets.unit_quad()
	mm.instance_count = capacity
	mm.visible_instance_count = 0
	multimesh = mm
	_mat = AmbientAssets.birds_material()
	_mat.set_shader_parameter("sprite", AmbientAssets.tex(AmbientAssets.BIRD_TEXTURES[0]))
	material_override = _mat
	visible = false
	_build_formation()

## Lay the birds out in a V: leader in front, wings trailing back and out.
func _build_formation() -> void:
	if multimesh == null:
		return
	var spacing := 1.6
	for i in capacity:
		var k := (i + 1) / 2
		var side := 1.0 if i % 2 == 1 else -1.0
		if i == 0:
			side = 0.0
		var slot := Vector3(side * float(k) * spacing, _rng.randf_range(-0.5, 0.5), float(k) * spacing * 0.85)
		multimesh.set_instance_transform(i, Transform3D(Basis.IDENTITY, slot))
		multimesh.set_instance_custom_data(i, Color(_rng.randf(), 0, 0, 0))

func active_count() -> int:
	return multimesh.visible_instance_count if multimesh != null else 0

func set_active_count(n: int) -> void:
	if multimesh == null:
		return
	var v := clampi(n, 0, capacity)
	multimesh.visible_instance_count = v
	visible = v > 0

func configure(sprite: Texture2D, tint: Color, size: float, flap: float, fly_span: float, fly_period: float) -> void:
	span = fly_span
	period = fly_period
	if _mat == null:
		return
	_mat.set_shader_parameter("sprite", sprite)
	_mat.set_shader_parameter("tint", Vector4(tint.r, tint.g, tint.b, tint.a))
	_mat.set_shader_parameter("size", size)
	_mat.set_shader_parameter("flap_speed", flap)
	_mat.set_shader_parameter("span", span)
	_mat.set_shader_parameter("period", period)

func set_master_alpha(a: float) -> void:
	if _mat != null:
		_mat.set_shader_parameter("master_alpha", clampf(a, 0.0, 1.0))

## Send the flock past `center` at `height` metres above it, on a fresh random heading.
func reseed(center: Vector3, height: float, side_offset: float) -> void:
	var a := _rng.randf() * TAU
	heading = Vector3(cos(a), 0.0, sin(a))
	var side := Vector3(-heading.z, 0.0, heading.x)
	origin = Vector3(center.x, center.y + height, center.z) + side * _rng.randf_range(-side_offset, side_offset)
	if _mat != null:
		_mat.set_shader_parameter("origin", origin)
		_mat.set_shader_parameter("heading", heading)
		_mat.set_shader_parameter("phase", _rng.randf())

## How far the flock's path is from `pos` horizontally (used to decide when to re-seed).
func distance_to(pos: Vector3) -> float:
	return Vector2(origin.x - pos.x, origin.z - pos.z).length()
