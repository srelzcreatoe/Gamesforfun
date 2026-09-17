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
## A style can also place strands EXPLICITLY (`strands: [...]`, each with `at`,
## `rot`, `len`, `cube`, `point`, `mirror`), which is what the big iconic Dragon
## Ball silhouettes use: a handful of large tapered spikes reads far better than
## 68 small slot strands. `point` narrows a strand's cross section along its
## length, so a spike ends in a point instead of a flat cube, and `accent: true`
## puts a strand on a second surface with its own colour (two tone hair).
##
## Transformation hair is DERIVED from the character's own style instead of being
## hand authored per race: `form_style_id()` returns an id like "spiky@ssj" and
## `resolve_style()` rebuilds that style with longer, more upright spikes (see
## FORM_DERIVE), so every haircut keeps its identity when it goes Super Saiyan.
##
## X is mirrored into Godot space like the rest of BedrockModel, so DMZ's LEFT face
## lands on the entity's left. One ArrayMesh is baked per style and cached, so hair
## costs a single extra draw call per entity and no per-frame work; the colour rides
## on the material (`races/hair.png` is a near-white shading tile).

const DATA_PATH := "res://data/hair_styles.json"
const HAIR_TILE := "races/hair"
const MAX_LEN := 20
## How much lighter an undeclared accent colour is than the main hair. Shared with
## the transformation flicker in scripts/fx/TransformationDirector.gd, which anchors
## the accent to the FORM colour using the same constant.
const ACCENT_LIGHTEN := 0.45

## forms.json `hairType` -> how the character's own style is stretched. `upright`
## is how far every strand is rotated towards straight up (0 = unchanged, 1 = vertical).
const FORM_DERIVE := {
	"ssj": {"len_mult": 1.35, "upright": 0.45, "point": 0.12, "grow": 1.06, "color": "#F5D03A"},
	"ssj2": {"len_mult": 1.75, "upright": 0.62, "point": 0.10, "grow": 1.10, "color": "#F7DC4B"},
	"ssj3": {"len_mult": 1.35, "upright": 0.30, "point": 0.12, "grow": 1.06, "color": "#F8E066"},
}

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

## Style definition for an id, expanding a derived "<base>@<variant>" id
## (transformation hair) through FORM_DERIVE.
static func resolve_style(id: String) -> Dictionary:
	var at := id.find("@")
	if at < 0:
		var def := style_def(id)
		var alias := String(def.get("alias", ""))
		if alias == "" or alias == id:
			return def
		# an alias entry ("ssj" -> "spiky@ssj") resolves to its target, keeping any
		# colour / eyebrow overrides it declares itself
		var target := resolve_style(alias).duplicate(true)
		for k in def.keys():
			if k != "alias":
				target[k] = def[k]
		return target
	var base := style_def(id.substr(0, at))
	var spec: Dictionary = FORM_DERIVE.get(id.substr(at + 1), {})
	if base.is_empty() or spec.is_empty():
		return base
	return _derive(base, spec)

## Longer, more upright, pointier copy of a style (Super Saiyan and friends).
static func _derive(style: Dictionary, spec: Dictionary) -> Dictionary:
	var out := style.duplicate(true)
	var len_mult := float(spec.get("len_mult", 1.0))
	var upright := clampf(float(spec.get("upright", 0.0)), 0.0, 1.0)
	var point := float(spec.get("point", 1.0))
	var grow := float(spec.get("grow", 1.0))
	var defaults: Dictionary = data().get("defaults", {})
	var def_len := int(defaults.get("len", 3))
	if spec.has("color"):
		out["color"] = spec["color"]
	for key in ["groups", "strands"]:
		var list: Array = out.get(key, [])
		for i in list.size():
			if not (list[i] is Dictionary):
				continue
			var g: Dictionary = list[i]
			g["len"] = clampi(int(ceil(float(int(g.get("len", def_len))) * len_mult)), 1, MAX_LEN)
			g["point"] = minf(float(g.get("point", 1.0)), point)
			var cube: Vector3 = _v3(g.get("cube", defaults.get("cube", [2, 2, 2])))
			g["cube"] = [cube.x * grow, cube.y * grow, cube.z * grow]
			# rotate the strand towards straight up, keeping the style's character
			var face := String(g.get("face", "")).to_upper()
			var base_rot: Vector3 = FACE_ROT.get(face, Vector3.ZERO)
			var rot: Vector3 = _v3(g.get("rot", [0, 0, 0]))
			var tx := (base_rot.x + rot.x) * (1.0 - upright) - base_rot.x
			var tz := (base_rot.z + rot.z) * (1.0 - upright) - base_rot.z
			g["rot"] = [tx, rot.y, tz]
			list[i] = g
	return out

static func style_name(id: String) -> String:
	return String(style_def(id).get("name", id.capitalize()))

## forms.json `hairType` ("base", "ssj", "ssj2", "ssj3", "empty", or a legacy
## integer) -> the style to attach, given the character's own base style.
## "" / "base" keeps the character's haircut, "@<variant>" derives from it and
## anything else is an explicit style id.
static func form_style_id(base_style: String, hair_type: Variant) -> String:
	var key := str(hair_type).strip_edges().to_lower()
	if key == "" or key == "base" or key == "-1":
		return base_style
	var m: Dictionary = data().get("form_hair", {})
	if not m.has(key):
		# legacy numeric hairType (0 base, 1 ssj, 2 ssj2, 3 ssj3)
		var legacy := ["base", "ssj", "ssj2", "ssj3"]
		var idx := int(key) if key.is_valid_int() else -1
		key = legacy[idx] if idx >= 0 and idx < legacy.size() else key
	var v := String(m.get(key, ""))
	if v == "":
		return base_style
	if v.begins_with("@"):
		return base_style + v
	return v

static func style_color(id: String, fallback: Color) -> Color:
	var c := String(resolve_style(id).get("color", ""))
	return RaceSkin._color(c) if c != "" else fallback

## Second (accent) colour of a two tone style. This is the CHARACTER's accent: an
## authored `accent_color` wins outright and ignores `main`, so do NOT use it to
## repaint a transformed character (a blue god form would keep gotenks' gold
## streak) - derive from the form colour with `main.lightened(ACCENT_LIGHTEN)`
## instead, which is what this returns for a style that declares none.
static func accent_color(id: String, main: Color) -> Color:
	var c := String(resolve_style(id).get("accent_color", ""))
	return RaceSkin._color(c) if c != "" else main.lightened(ACCENT_LIGHTEN)

static func hides_eyebrows(id: String) -> bool:
	return bool(resolve_style(id).get("no_eyebrows", false))

# --- building -----------------------------------------------------------------

## Mesh for one style (cached). Vertices are in head-local MODEL units.
static func style_mesh(id: String) -> ArrayMesh:
	if _mesh_cache.has(id):
		return _mesh_cache[id]
	var mesh := _build_mesh(resolve_style(id))
	_mesh_cache[id] = mesh
	return mesh

static func clear_cache() -> void:
	_mesh_cache.clear()
	_loaded = false
	_data.clear()

static func _build_mesh(style: Dictionary) -> ArrayMesh:
	var groups: Array = style.get("groups", [])
	var strands: Array = style.get("strands", [])
	if groups.is_empty() and strands.is_empty():
		return null
	var defaults: Dictionary = data().get("defaults", {})
	# surface 0 = the hair colour, surface 1 = the accent colour (two tone styles)
	var st := SurfaceTool.new()
	var acc := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	acc.begin(Mesh.PRIMITIVE_TRIANGLES)
	var any := false
	var any_acc := false
	for g in groups:
		if not (g is Dictionary):
			continue
		var accent := bool((g as Dictionary).get("accent", false))
		var target := acc if accent else st
		if _add_group(target, g, defaults):
			if accent:
				any_acc = true
			else:
				any = true
	for sp in strands:
		if not (sp is Dictionary):
			continue
		var accent2 := bool((sp as Dictionary).get("accent", false))
		var target2 := acc if accent2 else st
		if _add_placed_strand(target2, sp, defaults):
			if accent2:
				any_acc = true
			else:
				any = true
	if not any and not any_acc:
		return null
	var mesh := ArrayMesh.new()
	if any:
		st.index()
		st.commit(mesh)
	if any_acc:
		acc.index()
		acc.commit(mesh)
	return mesh


## One hand placed spike: `at` is a head-local Bedrock position, `rot` its own
## euler (no face base rotation), `mirror` also emits the X mirrored twin.
static func _add_placed_strand(st: SurfaceTool, g: Dictionary, defaults: Dictionary) -> bool:
	var at: Vector3 = _v3(g.get("at", [0, 8, 0]))
	var rot: Vector3 = _v3(g.get("rot", defaults.get("rot", [0, 0, 0])))
	var length: int = clampi(int(g.get("len", defaults.get("len", 3))), 1, MAX_LEN)
	var cube: Vector3 = _v3(g.get("cube", defaults.get("cube", [2, 2, 2])))
	var scale: Vector3 = _v3(g.get("scale", defaults.get("scale", [1, 1, 1])))
	var curve: Vector3 = _v3(g.get("curve", defaults.get("curve", [0, 0, 0])))
	var taper := float(g.get("taper", defaults.get("taper", 0.86)))
	var point := float(g.get("point", 1.0))
	var gap := float(g.get("gap", defaults.get("gap", 0.0)))
	var added := _add_strand(st, at, rot, length, cube * scale, curve, taper, gap, point)
	if bool(g.get("mirror", false)):
		var m_at := Vector3(-at.x, at.y, at.z)
		var m_rot := Vector3(rot.x, -rot.y, -rot.z)
		var m_curve := Vector3(curve.x, -curve.y, -curve.z)
		added = _add_strand(st, m_at, m_rot, length, cube * scale, m_curve, taper, gap, point) or added
	return added


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
	var point := float(g.get("point", 1.0))
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
			var side: float = float(COL_OFF[col]) / 3.0
			var srot := rot
			if face == "TOP" or face == "FRONT" or face == "BACK":
				srot += Vector3(0, 0, -spread * side)
			else:
				srot += Vector3(spread * side, 0, 0)
			if _add_strand(st, base, FACE_ROT[face] + srot, length, cube * scale, curve, taper, gap):
				added = true
	return added

static func _slot_position(face: String, row: int, col: int) -> Vector3:
	var a := float(COL_OFF[col])
	var b := float(ROW_DROP[row])
	var ar := float(COL_OFF[row])
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
		cube: Vector3, curve: Vector3, taper: float, gap: float, point := 1.0) -> bool:
	var basis := BedrockModel.bedrock_basis(rot_deg)
	var origin := Vector3(-base.x, base.y, base.z)          # X mirrored into Godot space
	var size := cube
	var added := false
	var n := float(length)
	for i in length:
		# segment centred on the strand axis, growing along +Y of the current basis.
		# `point` narrows the cross section along the strand, so the last segment
		# ends in a spike instead of a flat cube.
		var half := size * 0.5
		var w0 := lerpf(1.0, point, float(i) / n)
		var w1 := lerpf(1.0, point, float(i + 1) / n)
		var centre := origin + basis * Vector3(0, half.y, 0)
		# tips read slightly lighter than the roots, like DMZ's shaded strands
		var tip := 0.88 + 0.12 * (float(i) / maxf(1.0, float(length - 1)))
		if _add_box(st, centre, basis, half, tip, w0, w1):
			added = true
		origin = origin + basis * Vector3(0, size.y + gap, 0)
		size = Vector3(size.x * taper, size.y * taper, size.z * taper)
		if curve != Vector3.ZERO:
			basis = basis * BedrockModel.bedrock_basis(curve)
	return added

static func _add_box(st: SurfaceTool, centre: Vector3, basis: Basis, half: Vector3,
		tip := 1.0, w0 := 1.0, w1 := 1.0) -> bool:
	if half.x <= 0.01 or half.y <= 0.01 or half.z <= 0.01:
		return false
	# a hair cube samples the flat shading tile; a small UV window per face keeps
	# nearest filtering happy whatever the tile size is
	const UVS := [Vector2(0.40, 0.40), Vector2(0.53, 0.40), Vector2(0.53, 0.53), Vector2(0.40, 0.53)]
	# corners: -Y face uses w0, +Y face uses w1, so a strand can taper to a point
	var a0 := Vector3(half.x * w0, -half.y, half.z * w0)
	var a1 := Vector3(half.x * w1, half.y, half.z * w1)
	var c := {
		# (x sign, z sign) -> [bottom, top]
		"pp": [Vector3(a0.x, a0.y, a0.z), Vector3(a1.x, a1.y, a1.z)],
		"pn": [Vector3(a0.x, a0.y, -a0.z), Vector3(a1.x, a1.y, -a1.z)],
		"np": [Vector3(-a0.x, a0.y, a0.z), Vector3(-a1.x, a1.y, a1.z)],
		"nn": [Vector3(-a0.x, a0.y, -a0.z), Vector3(-a1.x, a1.y, -a1.z)],
	}
	var faces := [
		# normal, then the four corners (top pair first so the winding matches a box)
		[Vector3(1, 0, 0), c["pp"][1], c["pn"][1], c["pn"][0], c["pp"][0]],
		[Vector3(-1, 0, 0), c["np"][1], c["nn"][1], c["nn"][0], c["np"][0]],
		[Vector3(0, 1, 0), c["nn"][1], c["pn"][1], c["pp"][1], c["np"][1]],
		[Vector3(0, -1, 0), c["np"][0], c["pp"][0], c["pn"][0], c["nn"][0]],
		[Vector3(0, 0, 1), c["np"][1], c["pp"][1], c["pp"][0], c["np"][0]],
		[Vector3(0, 0, -1), c["pn"][1], c["nn"][1], c["nn"][0], c["pn"][0]],
	]
	var pointed := w1 <= 0.02
	for f in faces:
		var n: Vector3 = (basis * (f[0] as Vector3)).normalized()
		if pointed and (f[0] as Vector3).y > 0.5:
			continue                                        # the tip closed to a point
		var p: Array = []
		for i in range(1, 5):
			p.append(centre + basis * (f[i] as Vector3))
		# Bake the facet shading into vertex colours: a near black hair colour under
		# a lit material otherwise reads as one flat silhouette (the "black cube on
		# the head" look), because every strand face gets the same albedo.
		var b := (0.42 + 0.58 * (0.5 + 0.5 * n.y) - 0.09 * n.z) * tip
		st.set_color(Color(b, b, b, 1.0))
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
			node.set_meta("hair_style", style)
		return node
	if node == null:
		node = MeshInstance3D.new()
		node.name = "Hair"
		head.add_child(node)
	node.visible = true
	node.mesh = mesh
	# One surface (every style but the two tone ones) keeps using `material_override`,
	# because that is what TransformationDirector's hair flicker reaches for. A two
	# tone style needs a material per surface, so the override is cleared there.
	var two_tone := mesh.get_surface_count() > 1
	if two_tone:
		node.material_override = null
		var mat2 := _surface_material(node, 0)
		mat2.albedo_color = hair_albedo(color)
		var acc := _surface_material(node, 1)
		acc.albedo_color = hair_albedo(accent_color(style, color))
	else:
		node.set_surface_override_material(0, null)
		var mat := node.material_override as StandardMaterial3D
		if mat == null:
			mat = _new_material()
			node.material_override = mat
		mat.albedo_color = hair_albedo(color)
	node.set_meta("hair_style", style)
	return node

## Main hair material of a composed model, whichever slot it ended up in
## (`material_override`, or surface 0 of a two tone style). Null when there is no
## voxel hair. This is what a form flicker should recolour.
static func hair_material(model: BedrockModel) -> StandardMaterial3D:
	if model == null:
		return null
	var head: Node3D = model.get_bone("head")
	var node := head.get_node_or_null("Hair") as MeshInstance3D if head != null else null
	if node == null:
		return null
	var mat := node.material_override as StandardMaterial3D
	return mat if mat != null else node.get_surface_override_material(0) as StandardMaterial3D

static func _new_material() -> StandardMaterial3D:
	var mat := BedrockModel._make_material(BaseMaterial3D.CULL_BACK)
	mat.albedo_texture = Textures.entity_texture(HAIR_TILE)
	mat.vertex_color_use_as_albedo = true
	return mat

static func _surface_material(node: MeshInstance3D, surface: int) -> StandardMaterial3D:
	var mat := node.get_surface_override_material(surface) as StandardMaterial3D
	if mat == null:
		mat = _new_material()
		node.set_surface_override_material(surface, mat)
	return mat

## Albedo actually used for a hair colour. Very dark hair (DMZ's default is
## #222629) is lifted until the baked facet shading is visible, so the head does
## not render as one black block from behind.
static func hair_albedo(c: Color) -> Color:
	if c.v >= 0.30:
		return c
	return Color.from_hsv(c.h, c.s, 0.30, c.a)


static func current_style(model: BedrockModel) -> String:
	if model == null:
		return ""
	var head: Node3D = model.get_bone("head")
	var node: Node = head.get_node_or_null("Hair") if head != null else null
	return String(node.get_meta("hair_style", "")) if node != null else ""

## Bounding size of a style in model units (tests: how much hair there is).
static func style_extent(style: String) -> Vector3:
	var mesh := style_mesh(style)
	return mesh.get_aabb().size if mesh != null else Vector3.ZERO

## Height of a style above the head pivot, in model units (tests / framing).
static func style_height(style: String) -> float:
	var mesh := style_mesh(style)
	if mesh == null:
		return 0.0
	var aabb := mesh.get_aabb()
	return aabb.position.y + aabb.size.y
