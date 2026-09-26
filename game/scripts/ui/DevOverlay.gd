class_name DevOverlay
extends Node3D
## Dev-mode wireframes: entity hitboxes and chunk borders. Created on demand by DevMenu and
## parked under the World so it is thrown away with it.

const NODE_NAME := "DevOverlay"

var show_hitboxes := false
var show_chunks := false

var _mesh: ImmediateMesh
var _mi: MeshInstance3D
var _t := 0.0

static func get_for(world: Node) -> DevOverlay:
	if world == null:
		return null
	var existing: Node = world.get_node_or_null(NODE_NAME)
	if existing is DevOverlay:
		return existing
	var o := DevOverlay.new()
	o.name = NODE_NAME
	world.add_child(o)
	return o

func _ready() -> void:
	_mesh = ImmediateMesh.new()
	_mi = MeshInstance3D.new()
	_mi.mesh = _mesh
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.vertex_color_use_as_albedo = true
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.no_depth_test = true
	_mi.material_override = mat
	_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_mi)

func enabled() -> bool:
	return show_hitboxes or show_chunks

func _process(delta: float) -> void:
	_mi.visible = enabled()
	if not enabled():
		return
	_t -= delta
	if _t > 0.0:
		return
	_t = 0.1
	_mesh.clear_surfaces()
	_mesh.surface_begin(Mesh.PRIMITIVE_LINES)
	if show_hitboxes:
		_draw_hitboxes()
	if show_chunks:
		_draw_chunks()
	_mesh.surface_end()

func _draw_hitboxes() -> void:
	var world := get_parent()
	if world == null or not world.has_method("get_entities"):
		return
	for e in world.call("get_entities"):
		if not (e is Node3D):
			continue
		var n: Node3D = e
		var sz: Variant = n.get("aabb_size")
		var size3: Vector3 = sz if sz is Vector3 else Vector3(0.6, 1.8, 0.6)
		var col := Color(0.4, 1.0, 0.5, 0.9)
		if Game != null and e == Game.player:
			col = Color(0.4, 0.8, 1.0, 0.9)
		elif String(n.get("faction")) == "villain":
			col = Color(1.0, 0.4, 0.4, 0.9)
		_box(AABB(n.global_position - Vector3(size3.x * 0.5, 0.0, size3.z * 0.5), size3), col)

func _draw_chunks() -> void:
	var focus := Vector3.ZERO
	if Game != null and Game.player != null and Game.player is Node3D:
		focus = (Game.player as Node3D).global_position
	var cx := int(floor(focus.x / 16.0))
	var cz := int(floor(focus.z / 16.0))
	var col := Color(1.0, 0.95, 0.4, 0.8)
	for dx in range(-1, 2):
		for dz in range(-1, 2):
			var x0 := float((cx + dx) * 16)
			var z0 := float((cz + dz) * 16)
			var y0 := floorf(focus.y) - 24.0
			var y1 := floorf(focus.y) + 24.0
			for corner in [Vector2(x0, z0), Vector2(x0 + 16.0, z0), Vector2(x0, z0 + 16.0), Vector2(x0 + 16.0, z0 + 16.0)]:
				_line(Vector3(corner.x, y0, corner.y), Vector3(corner.x, y1, corner.y), col)
			for y in [y0, focus.y, y1]:
				_line(Vector3(x0, y, z0), Vector3(x0 + 16.0, y, z0), col)
				_line(Vector3(x0, y, z0), Vector3(x0, y, z0 + 16.0), col)

func _line(a: Vector3, b: Vector3, col: Color) -> void:
	_mesh.surface_set_color(col)
	_mesh.surface_add_vertex(a)
	_mesh.surface_set_color(col)
	_mesh.surface_add_vertex(b)

func _box(box: AABB, col: Color) -> void:
	var a := box.position
	var b := box.end
	var pts := [
		[Vector3(a.x, a.y, a.z), Vector3(b.x, a.y, a.z)], [Vector3(b.x, a.y, a.z), Vector3(b.x, a.y, b.z)],
		[Vector3(b.x, a.y, b.z), Vector3(a.x, a.y, b.z)], [Vector3(a.x, a.y, b.z), Vector3(a.x, a.y, a.z)],
		[Vector3(a.x, b.y, a.z), Vector3(b.x, b.y, a.z)], [Vector3(b.x, b.y, a.z), Vector3(b.x, b.y, b.z)],
		[Vector3(b.x, b.y, b.z), Vector3(a.x, b.y, b.z)], [Vector3(a.x, b.y, b.z), Vector3(a.x, b.y, a.z)],
		[Vector3(a.x, a.y, a.z), Vector3(a.x, b.y, a.z)], [Vector3(b.x, a.y, a.z), Vector3(b.x, b.y, a.z)],
		[Vector3(b.x, a.y, b.z), Vector3(b.x, b.y, b.z)], [Vector3(a.x, a.y, b.z), Vector3(a.x, b.y, b.z)],
	]
	for e in pts:
		_line(e[0], e[1], col)
