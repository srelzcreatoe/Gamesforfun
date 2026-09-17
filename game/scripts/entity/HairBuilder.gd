class_name HairBuilder
extends RefCounted
## DragonMineZ-style voxel hair: strands of stacked cubes growing out of the head
## bone, built from `data/hair_styles.json`.
##
## The geometry model is DMZ's own, recovered from the mod's bytecode
## (`com.dragonminez.common.hair.CustomHair` / `HairStrand` / `CustomHair$HairFace`
## with `javap -c -p`):
##
##   * Five faces with strand slots: FRONT (1 row x 4 cols), BACK, LEFT, RIGHT and
##     TOP (4 rows x 4 cols each) - 68 slots in total.
##   * Slot base position, in head-local model units (the head cube spans
##     x[-4,4] y[0,8] z[-4,4] with y = 0 at the head pivot):
##         col offsets A = [-3, -1, 1, 3]     row drop B = [0, -1.5, -3, -4.5]
##         FRONT (A[col], 7.25,        -4.0)      BACK  (A[col], 7.25+B[row], 4.0)
##         LEFT  (-3.95,  7.25+B[row], A[col])    RIGHT (3.95,   7.25+B[row], -A[col])
##         TOP   (A[col], 7.85,        A[row])
##   * Slot base rotation: FRONT (-90,0,0) BACK (90,0,0) LEFT (0,0,90)
##     RIGHT (0,0,-90) TOP (0,0,0) - so a strand always grows away from the skull.
##   * A strand is `length` cubes of `cube` size (DMZ default 2x2x2) stacked along
##     its own +Y, each step scaled by `taper` and turned by `curve` degrees, on top
##     of the strand's own `rot`.
##
## X is mirrored into Godot space like the rest of BedrockModel, so DMZ's LEFT face
## lands on the entity's left. One ArrayMesh is baked per style and cached, so hair
## costs a single extra draw call per entity and no per-frame work; the colour rides
## on the material (`races/hair.png` is a near-white shading tile).

const DATA_PATH := "res://data/hair_styles.json"
const HAIR_TILE := "races/hair"
const MAX_LEN := 16

## col / row offsets from CustomHair.computeStrandBasePosition
const COL_OFF := [-3.0, -1.0, 1.0, 3.0]
const ROW_DROP := [0.0, -1.5, -3.0, -4.5]
const FACE_ROT := {
	"FRONT": Vector3(-90, 0, 0), "BACK": Vector3(90, 0, 0),
	"LEFT": Vector3(0, 0, 90), "RIGHT": Vector3(0, 0, -90), "TOP": Vector3(0, 0, 0),
}
const FACE_ROWS := {"FRONT": 1, "BACK": 4, "LEFT": 4, "RIGHT": 4, "TOP": 4}

static var _data: Dictionary = {}
static var _mesh_cache: Dictionary = {}          # style id -> ArrayMesh
static var _loaded := false

# --- data ---------------------------------------------------------------------

static func data() -> Dictionary:
	if not _loaded:
		_loaded = true
		var raw: Variant = JsonUtil.load_file(DATA_PATH)
		_data = raw if raw is Dictionary else {}
		if _data.is_empty():
			Log.w("HairBuilder: cannot load " + DATA_PATH)
	return _data

static func styles() -> Dictionary:
	return data().get("styles", {})

## Ordered list of the selectable (non form) style ids.
static func style_order() -> Array:
	var o: Array = data().get("order", [])
	return o if not o.is_empty() else styles().keys()

static func style_count() -> int:
	return maxi(1, style_order().size())

## `hair_type` is the index used by profiles/entities.json; it wraps.
static func style_id(hair_type: int) -> String:
	var order := style_order()
	if order.is_empty():
		return ""
	return String(order[posmod(hair_type, order.size())])

static func style_def(id: String) -> Dictionary:
	return styles().get(id, {})

static func style_name(id: String) -> String:
	return String(style_def(id).get("name", id.capitalize()))

## forms.json `hairType` (0 base, 1 ssj, 2 ssj2, 3 ssj3) -> style id.
static func form_style_id(hair_type: int) -> String:
	var m: Dictionary = data().get("form_hair", {})
	var key := str(hair_type)
	if m.has(key):
		return String(m[key])
	return "ssj"

static func style_color(id: String, fallback: Color) -> Color:
	var c := String(style_def(id).get("color", ""))
	return RaceSkin._color(c) if c != "" else fallback

static func hides_eyebrows(id: String) -> bool:
	return bool(style_def(id).get("no_eyebrows", false))

# --- building -----------------------------------------------------------------

## Mesh for one style (cached). Vertices are in head-local MODEL units.
static func style_mesh(id: String) -> ArrayMesh:
	if _mesh_cache.has(id):
		return _mesh_cache[id]
	var mesh := _build_mesh(style_def(id))
	_mesh_cache[id] = mesh
	return mesh

static func clear_cache() -> void:
	_mesh_cache.clear()
	_loaded = false
	_data.clear()

static func _build_mesh(style: Dictionary) -> ArrayMesh:
	var groups: Array = style.get("groups", [])
	if groups.is_empty():
		return null
	var defaults: Dictionary = data().get("defaults", {})
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var any := false
	for g in groups:
		if g is Dictionary:
			any = _add_group(st, g, defaults) or any
	if not any:
		return null
	st.index()
	var mesh := ArrayMesh.new()
	st.commit(mesh)
	return mesh

static func _add_group(st: SurfaceTool, g: Dictionary, defaults: Dictionary) -> bool:
	var face := String(g.get("face", "TOP")).to_upper()
	if not FACE_ROT.has(face):
		return false
	var cols: Array = g.get("cols", [0, 1, 2, 3])
	var rows: Array = g.get("rows", [0])
	if face == "FRONT":
		rows = [0]
	var length: int = clampi(int(g.get("len", defaults.get("len", 3))), 1, MAX_LEN)
	var cube: Vector3 = _v3(g.get("cube", defaults.get("cube", [2, 2, 2])))
	var scale: Vector3 = _v3(g.get("scale", defaults.get("scale", [1, 1, 1])))
	var rot: Vector3 = _v3(g.get("rot", defaults.get("rot", [0, 0, 0])))
	var curve: Vector3 = _v3(g.get("curve", defaults.get("curve", [0, 0, 0])))
	var taper := float(g.get("taper", defaults.get("taper", 0.86)))
	var spread := float(g.get("spread", defaults.get("spread", 0.0)))
	var gap := float(g.get("gap", defaults.get("gap", 0.0)))
	var added := false
	for rv in rows:
		for cv in cols:
			var col := int(cv)
			var row := int(rv)
			if col < 0 or col > 3 or row < 0 or row >= int(FACE_ROWS[face]):
				continue
			var base := _slot_position(face, row, col)
			# fan the strands out from the centre line (this is what gives the DMZ
			# silhouette its spiky spread)
			var side := COL_OFF[col] / 3.0
			var srot := rot
			if face == "TOP" or face == "FRONT" or face == "BACK":
				srot += Vector3(0, 0, -spread * side)
			else:
				srot += Vector3(spread * side, 0, 0)
			if _add_strand(st, base, FACE_ROT[face] + srot, length, cube * scale, curve, taper, gap):
				added = true
	return added

static func _slot_position(face: String, row: int, col: int) -> Vector3:
	var a: float = COL_OFF[col]
	var b: float = ROW_DROP[row]
	var ar: float = COL_OFF[row]
	match face:
		"FRONT": return Vector3(a, 7.25, -4.0)
		"BACK": return Vector3(a, 7.25 + b, 4.0)
		"LEFT": return Vector3(-3.95, 7.25 + b, a)
		"RIGHT": return Vector3(3.95, 7.25 + b, -a)
		"TOP": return Vector3(a, 7.85, ar)
	return Vector3.ZERO

## One strand: `length` cubes stacked along the strand's local +Y, turning by
## `curve` each step and shrinking by `taper`.
static func _add_strand(st: SurfaceTool, base: Vector3, rot_deg: Vector3, length: int,
		cube: Vector3, curve: Vector3, taper: float, gap: float) -> bool:
	var basis := BedrockModel.bedrock_basis(rot_deg)
	var origin := Vector3(-base.x, base.y, base.z)          # X mirrored into Godot space
	var size := cube
	var added := false
	for i in length:
		# cube centred on the strand axis, growing along +Y of the current basis
		var half := size * 0.5
		var centre := origin + basis * Vector3(0, half.y, 0)
		if _add_box(st, centre, basis, half):
			added = true
		origin = origin + basis * Vector3(0, size.y + gap, 0)
		size = Vector3(size.x * taper, size.y * taper, size.z * taper)
		if curve != Vector3.ZERO:
			basis = basis * BedrockModel.bedrock_basis(curve)
	return added

static func _add_box(st: SurfaceTool, centre: Vector3, basis: Basis, half: Vector3) -> bool:
	if half.x <= 0.01 or half.y <= 0.01 or half.z <= 0.01:
		return false
	# a hair cube samples the flat shading tile; a small UV window per face keeps
	# nearest filtering happy whatever the tile size is
	const UVS := [Vector2(0.15, 0.15), Vector2(0.85, 0.15), Vector2(0.85, 0.85), Vector2(0.15, 0.85)]
	var faces := [
		[Vector3(1, 0, 0), Vector3(1, 1, 1), Vector3(1, 1, -1), Vector3(1, -1, -1), Vector3(1, -1, 1)],
		[Vector3(-1, 0, 0), Vector3(-1, 1, -1), Vector3(-1, 1, 1), Vector3(-1, -1, 1), Vector3(-1, -1, -1)],
		[Vector3(0, 1, 0), Vector3(-1, 1, -1), Vector3(1, 1, -1), Vector3(1, 1, 1), Vector3(-1, 1, 1)],
		[Vector3(0, -1, 0), Vector3(-1, -1, 1), Vector3(1, -1, 1), Vector3(1, -1, -1), Vector3(-1, -1, -1)],
		[Vector3(0, 0, 1), Vector3(-1, 1, 1), Vector3(1, 1, 1), Vector3(1, -1, 1), Vector3(-1, -1, 1)],
		[Vector3(0, 0, -1), Vector3(1, 1, -1), Vector3(-1, 1, -1), Vector3(-1, -1, -1), Vector3(1, -1, -1)],
	]
	for f in faces:
		var n: Vector3 = (basis * (f[0] as Vector3)).normalized()
		var p: Array = []
		for i in range(1, 5):
			p.append(centre + basis * ((f[i] as Vector3) * half))
		BedrockModel._add_quad(st, p, UVS, n)
	return true

static func _v3(v: Variant) -> Vector3:
	if v is Array and (v as Array).size() >= 3:
		return Vector3(float(v[0]), float(v[1]), float(v[2]))
	if v is Vector3:
		return v
	if v is float or v is int:
		return Vector3(float(v), float(v), float(v))
	return Vector3.ZERO

# --- attaching ----------------------------------------------------------------

## Build (or refresh) the hair on a model's head bone. Returns the hair node.
static func attach(model: BedrockModel, style: String, color: Color) -> Node3D:
	if model == null:
		return null
	var head: Node3D = model.get_bone("head")
	if head == null:
		return null
	var node: MeshInstance3D = head.get_node_or_null("Hair") as MeshInstance3D
	var mesh := style_mesh(style)
	if mesh == null:
		if node != null:
			node.visible = false
		return node
	if node == null:
		node = MeshInstance3D.new()
		node.name = "Hair"
		head.add_child(node)
	node.visible = true
	node.mesh = mesh
	var mat: StandardMaterial3D = node.material_override
	if mat == null:
		mat = BedrockModel._make_material(BaseMaterial3D.CULL_BACK)
		mat.albedo_texture = Textures.entity_texture(HAIR_TILE)
		node.material_override = mat
	mat.albedo_color = color
	node.set_meta("hair_style", style)
	return node

static func current_style(model: BedrockModel) -> String:
	if model == null:
		return ""
	var head: Node3D = model.get_bone("head")
	var node: Node = head.get_node_or_null("Hair") if head != null else null
	return String(node.get_meta("hair_style", "")) if node != null else ""

## Height of a style above the head pivot, in model units (tests / framing).
static func style_height(style: String) -> float:
	var mesh := style_mesh(style)
	if mesh == null:
		return 0.0
	var aabb := mesh.get_aabb()
	return aabb.position.y + aabb.size.y
