class_name Clouds
extends Node3D
## Two huge cloud planes that ride with the camera in XZ and are painted by shaders/clouds.gdshader.
##
## SkyController creates this node (when Game.settings.clouds is on) and calls
## `update_clouds(camera, sky_controller, coverage, tint)` every frame. The two layers scroll at
## different speeds and scales, which gives a cheap parallax "volume" without any raymarching.

const CLOUD_SHADER := "res://shaders/clouds.gdshader"
const PLANE_SIZE := 3000.0

## layer = {height, scale, parallax, opacity, wind}
const LAYERS: Array[Dictionary] = [
	{"height": 140.0, "scale": 0.0024, "parallax": 1.0, "opacity": 0.95, "wind": Vector2(0.75, 0.22), "softness": 0.26},
	{"height": 182.0, "scale": 0.0016, "parallax": 0.62, "opacity": 0.6, "wind": Vector2(0.52, 0.38), "softness": 0.34},
]

var planes: Array[MeshInstance3D] = []
var materials: Array[ShaderMaterial] = []
var wind_offset := 0.0

func _ready() -> void:
	_build()

func _build() -> void:
	if not planes.is_empty():
		return
	var shader: Shader = load(CLOUD_SHADER) if ResourceLoader.exists(CLOUD_SHADER) else null
	var mesh := PlaneMesh.new()
	mesh.size = Vector2(PLANE_SIZE, PLANE_SIZE)
	mesh.subdivide_width = 0
	mesh.subdivide_depth = 0
	for i in LAYERS.size():
		var def: Dictionary = LAYERS[i]
		var mi := MeshInstance3D.new()
		mi.name = "CloudLayer%d" % i
		mi.mesh = mesh
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
		mi.extra_cull_margin = 16384.0
		mi.sorting_offset = -200.0 - float(i)          # always behind other transparent surfaces
		var mat := ShaderMaterial.new()
		mat.shader = shader
		mat.set_shader_parameter("layer_scale", float(def["scale"]))
		mat.set_shader_parameter("layer_parallax", float(def["parallax"]))
		mat.set_shader_parameter("layer_opacity", float(def["opacity"]))
		mat.set_shader_parameter("wind", def["wind"])
		mat.set_shader_parameter("softness", float(def["softness"]))
		mat.set_shader_parameter("fade_start", 260.0 + 140.0 * float(i))
		mat.set_shader_parameter("fade_end", 1500.0)
		mi.material_override = mat
		add_child(mi)
		planes.append(mi)
		materials.append(mat)

## Called by SkyController every frame. `sky` is the SkyController (used for its colour accessors).
func update_clouds(camera: Camera3D, sky: Node, coverage: float, tint: Color) -> void:
	if planes.is_empty():
		_build()
	var cam_pos := Vector3.ZERO
	if camera != null:
		cam_pos = camera.global_position
	elif sky != null and sky.has_method("get_viewport"):
		cam_pos = Vector3.ZERO
	for i in planes.size():
		var def: Dictionary = LAYERS[i]
		var mi: MeshInstance3D = planes[i]
		# Follow the camera in XZ so the planes never run out; snap to whole metres to avoid jitter.
		mi.global_position = Vector3(roundf(cam_pos.x), float(def["height"]), roundf(cam_pos.z))
		var mat: ShaderMaterial = materials[i]
		if sky != null and sky.has_method("apply_to_material"):
			sky.call("apply_to_material", mat)
		mat.set_shader_parameter("coverage", clampf(coverage, 0.0, 1.0) * (1.0 if i == 0 else 0.82))
		mat.set_shader_parameter("cloud_tint", tint)
		# Layers above the camera are seen from below; when the camera climbs above a layer we see
		# its top, so flip the plane's shading by pushing it further and softening it.
		var above := cam_pos.y > float(def["height"])
		mat.set_shader_parameter("layer_opacity", float(def["opacity"]) * (0.65 if above else 1.0))
		mi.visible = absf(cam_pos.y - float(def["height"])) > 1.5

## Height of the lowest cloud layer (the World uses it to know when the player is inside the clouds).
func base_height() -> float:
	return float(LAYERS[0]["height"])
