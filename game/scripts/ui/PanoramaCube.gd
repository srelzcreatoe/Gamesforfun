class_name PanoramaCube
extends SubViewportContainer
## Slowly rotating cube panorama behind the main menu (assets/textures/gui/background/<race>_panorama_0..5.png).
## Face order follows Minecraft: 0 front(-Z) 1 right(+X) 2 back(+Z) 3 left(-X) 4 top 5 bottom.

const DIR := "res://assets/textures/gui/background/"

var viewport: SubViewport
var pivot: Node3D
var camera: Camera3D
var spin := 0.035
var tilt := 0.0
var prefix := "saiyan_panorama"

func _init(px: Vector2 = Vector2(1280, 720), tex_prefix := "saiyan_panorama") -> void:
	prefix = tex_prefix
	stretch = true
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	viewport = SubViewport.new()
	viewport.size = Vector2i(maxi(64, int(px.x)), maxi(64, int(px.y)))
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	viewport.own_world_3d = true
	viewport.world_3d = World3D.new()
	viewport.transparent_bg = false
	add_child(viewport)
	pivot = Node3D.new()
	viewport.add_child(pivot)
	camera = Camera3D.new()
	camera.fov = 88.0
	camera.near = 0.05
	camera.far = 10.0
	pivot.add_child(camera)
	_build_cube()

func available(tex_prefix: String) -> bool:
	return ResourceLoader.exists(DIR + tex_prefix + "_0.png")

func set_prefix(tex_prefix: String) -> void:
	if tex_prefix == prefix:
		return
	prefix = tex_prefix
	for c in pivot.get_children():
		if c is MeshInstance3D:
			c.queue_free()
	_build_cube()

func _build_cube() -> void:
	var d := 1.0
	# position, rotation_degrees per face
	var faces := [
		[Vector3(0, 0, -d), Vector3(0, 0, 0)],          # front
		[Vector3(d, 0, 0), Vector3(0, -90, 0)],         # right
		[Vector3(0, 0, d), Vector3(0, 180, 0)],         # back
		[Vector3(-d, 0, 0), Vector3(0, 90, 0)],         # left
		[Vector3(0, d, 0), Vector3(90, 0, 0)],          # top
		[Vector3(0, -d, 0), Vector3(-90, 0, 0)],        # bottom
	]
	for i in 6:
		var path := DIR + prefix + "_%d.png" % i
		if not ResourceLoader.exists(path):
			continue
		var mi := MeshInstance3D.new()
		var qm := QuadMesh.new()
		qm.size = Vector2(2.0 * d, 2.0 * d)
		mi.mesh = qm
		mi.position = faces[i][0]
		mi.rotation_degrees = faces[i][1]
		var mat := StandardMaterial3D.new()
		mat.albedo_texture = load(path)
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
		mi.material_override = mat
		pivot.add_child(mi)

func _process(delta: float) -> void:
	tilt += delta * spin
	pivot.rotation.y += delta * spin * 6.0
	pivot.rotation.x = sin(tilt * 0.6) * 0.08
