class_name HairBuilder
extends RefCounted
## DragonMineZ's own strand hair, rendered the way the mod renders it.
##
## The 27 presets in `data/dmz_hair_presets.json` are the mod's own: they are
## decoded straight out of `HairManager.initializeDefaultPresets()`'s hair codes
## by `tools/dmz_hair/decode_presets.py` (base62/base64url BigInteger -> raw
## DEFLATE -> NBT -> strands), together with the SSJ / SSJ2 / SSJ3 variants of
## every full-set preset and the two `forcedHairCode` hairs from forms.json.
## NOTHING here is hand authored.
##
## Geometry follows `com.dragonminez.client.render.hair.HairRenderer` with the
## physics/sway terms at rest (verified against `javap -c -p`):
##
##   * A hair has up to 68 strand slots: FRONT is one row of 4, BACK / LEFT /
##     RIGHT / TOP are 4x4. The slot's base position and the face's base rotation
##     come from `CustomHair.getStrandBasePosition/getBaseRotation`: col offsets
##     [-3,-1,1,3], row drops [0,-1.5,-3,-4.5], FRONT -90x, BACK +90x, LEFT +90z,
##     RIGHT -90z, TOP none. A strand's own rotation is added on top.
##   * `translate(base)`, `rotate(rotX, rotY, rotZ)`, `scale(scaleX, Y, Z)`, then
##     a chain of `length` cubes: cube i is `cubeW/H/D * 0.85^i` (SIZE_DECAY) with
##     the height also multiplied by `lengthScale` (the stretch factor), each cube
##     sitting on top of the previous one and turned by `curveX/Y/Z` first.
##   * A cube spans y = [-nudge, height]: the nudge
##     `w/2*sin|curveZ| + d/2*sin|curveX| + 0.24` closes the gap a curve opens.
##   * One `ArrayMesh` is baked per hair and cached, so hair costs one extra draw
##     call and no per-frame work. The colour rides on the material over
##     `races/hair.png`, exactly like DMZ's `HAIR_TEXTURE`.
##
## X is mirrored into Godot space like the rest of BedrockModel, so the rotation
## eulers mirror with it: Rx(x) * Ry(-y) * Rz(-z).

const DATA_PATH := "res://data/dmz_hair_presets.json"
const HAIR_TILE := "races/hair"
const SIZE_DECAY := 0.85                    # HairRenderer.SIZE_DECAY
const GAP_NUDGE := 0.24                     # its 0.015 metres, in model units
const MAX_CUBES := 24

## col / row offsets from CustomHair.computeStrandBasePosition
const COL_OFF := [-3.0, -1.0, 1.0, 3.0]
const ROW_DROP := [0.0, -1.5, -3.0, -4.5]
const FACE_ROT := {
	"FRONT": Vector3(-90, 0, 0), "BACK": Vector3(90, 0, 0),
	"LEFT": Vector3(0, 0, 90), "RIGHT": Vector3(0, 0, -90), "TOP": Vector3(0, 0, 0),
}
const FACE_ORDER := ["FRONT", "BACK", "LEFT", "RIGHT", "TOP"]
const FACE_COLS := {"FRONT": 4, "BACK": 4, "LEFT": 4, "RIGHT": 4, "TOP": 4}
## How much lighter an accent strand is than the main hair. Shared with the
## transformation flicker in scripts/fx/TransformationDirector.gd.
const ACCENT_LIGHTEN := 0.45
## HairManager.DEFAULT_HAIR_RACES: the races that get strand hair at all. DMZ's
## canUseHair() also allows female majins, and any race whose config lists a
## "hair" head bone.
const HAIR_RACES := ["human", "saiyan"]
## forms.json `hairType` -> the variant of the character's preset to use.
const FORM_VARIANTS := {"ssj": "ssj", "ssj2": "ssj2", "ssj3": "ssj3", "1": "ssj", "2": "ssj2", "3": "ssj3"}

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

static func presets() -> Dictionary:
	return data().get("presets", {})

## Selectable preset ids, in the mod's own order ("1".."27").
static func style_order() -> Array:
	var o: Array = data().get("order", [])
	return o if not o.is_empty() else presets().keys()

static func style_count() -> int:
	return maxi(1, style_order().size())

## `hair_type` is the preset index used by profiles / races.json; it wraps.
static func style_id(hair_type: int) -> String:
	var order := style_order()
	if order.is_empty():
		return ""
	return String(order[posmod(hair_type, order.size())])

## Does a style have any strands at all? (DMZ preset 5 is the empty one.)
static func has_hair(id: String) -> bool:
	return not resolve_style(id).get("strands", {}).is_empty()

## Index of the mod's empty preset, for a "no hair" choice in the UI.
static func empty_style_index() -> int:
	for i in style_count():
		if not has_hair(style_id(i)):
			return i
	return 0

## Index of a style id in the selectable order (-1 when it is not one).
static func style_index(id: String) -> int:
	return style_order().find(_base_id(id))

static func style_def(id: String) -> Dictionary:
	return presets().get(_base_id(id), {})

## The hair itself: a preset id ("7"), a variant ("7@ssj") or a forced hair
## ("forced:supersaiyan.supersaiyan4").
static func resolve_style(id: String) -> Dictionary:
	var variant := "base"
	var base := id
	var at := id.find("@")
	if at >= 0:
		base = id.substr(0, at)
		variant = id.substr(at + 1)
	var holder: Dictionary = {}
	if base.begins_with("forced:"):
		holder = data().get("forced", {}).get(base.substr(7), {})
	else:
		holder = presets().get(base, {})
	var variants: Dictionary = holder.get("variants", {})
	if variants.has(variant):
		return variants[variant]
	return variants.get("base", {})

static func style_name(id: String) -> String:
	var def := style_def(id)
	var n := String(def.get("name", ""))
	if n != "" and n.to_lower() != "custom":
		return n
	var idx := int(def.get("index", 0))
	return "Hair %d" % idx if idx > 0 else id.capitalize()

## Does this preset ship SSJ / SSJ2 / SSJ3 hair of its own?
static func is_full_set(id: String) -> bool:
	return bool(style_def(id).get("full_set", false))

## forms.json `hairType` ("", "base", "ssj", "ssj2", "ssj3", "empty", or a legacy
## integer) -> the style to attach for a character wearing `base_style`.
static func form_style_id(base_style: String, hair_type: Variant) -> String:
	var key := str(hair_type).strip_edges().to_lower()
	if key == "" or key == "base" or key == "-1" or key == "0":
		return base_style
	if key == "empty" or key == "none":
		return ""
	var variant := String(FORM_VARIANTS.get(key, ""))
	if variant == "":
		return base_style
	var bare := _base_id(base_style)
	var variants: Dictionary = presets().get(bare, {}).get("variants", {})
	if variants.has(variant):
		return "%s@%s" % [bare, variant]
	return base_style                     # this preset has no full set

## The style for a form's `forcedHairCode`, or "" when it has none.
static func forced_style_id(code: String) -> String:
	if code == "":
		return ""
	for key in data().get("forced", {}).keys():
		if String(data()["forced"][key].get("code", "")) == code:
			return "forced:" + String(key)
	# forms.json and the dump are generated from the same codes, so fall back to
	# matching by form id when the caller passes one
	return "forced:" + code if data().get("forced", {}).has(code) else ""

static func style_color(id: String, fallback: Color) -> Color:
	var c := String(resolve_style(id).get("global_color", ""))
	return RaceSkin._color(c) if c != "" else fallback

## Second (accent) colour of a strand that declares one; a form repaint should
## derive from the FORM colour with `main.lightened(ACCENT_LIGHTEN)` instead.
static func accent_color(id: String, main: Color) -> Color:
	for face in FACE_ORDER:
		for s in resolve_style(id).get("strands", {}).get(face, []):
			var c := String((s as Dictionary).get("c", ""))
			if c != "":
				return RaceSkin._color(c)
	return main.lightened(ACCENT_LIGHTEN)

static func hides_eyebrows(id: String) -> bool:
	return id.ends_with("@ssj3")              # DMZ drops them on SSJ3

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

static func _base_id(id: String) -> String:
	var at := id.find("@")
	return id.substr(0, at) if at >= 0 else id

static func _build_mesh(hair: Dictionary) -> ArrayMesh:
	var by_face: Dictionary = hair.get("strands", {})
	if by_face.is_empty():
		return null
	var main := SurfaceTool.new()
	var accent := SurfaceTool.new()
	main.begin(Mesh.PRIMITIVE_TRIANGLES)
	accent.begin(Mesh.PRIMITIVE_TRIANGLES)
	var any := false
	var any_accent := false
	for face in FACE_ORDER:
		for raw in by_face.get(face, []):
			if not (raw is Dictionary):
				continue
			var s: Dictionary = raw
			var tinted := String(s.get("c", "")) != ""
			var target := accent if tinted else main
			if _add_strand(target, face, s):
				if tinted:
					any_accent = true
				else:
					any = true
	if not any and not any_accent:
		return null
	var mesh := ArrayMesh.new()
	if any:
		main.index()
		main.commit(mesh)
	if any_accent:
		accent.index()
		accent.commit(mesh)
	return mesh

## CustomHair.computeStrandBasePosition: the slot's origin on the head cube.
static func slot_position(face: String, slot: int) -> Vector3:
	var cols: int = int(FACE_COLS.get(face, 4))
	var row := slot / cols
	var col := slot % cols
	var a: float = float(COL_OFF[col % 4])
	var ar: float = float(COL_OFF[row % 4])
	var b: float = float(ROW_DROP[row % 4])
	match face:
		"FRONT": return Vector3(a, 7.25, -4.0)
		"BACK": return Vector3(a, 7.25 + b, 4.0)
		"LEFT": return Vector3(-3.95, 7.25 + b, a)
		"RIGHT": return Vector3(3.95, 7.25 + b, -a)
		"TOP": return Vector3(a, 7.85, ar)
	return Vector3.ZERO

## One strand: HairRenderer.renderStrandInterpolated with the physics at rest.
static func _add_strand(st: SurfaceTool, face: String, s: Dictionary) -> bool:
	var count := clampi(int(s.get("l", 0)), 0, MAX_CUBES)
	if count <= 0:
		return false                                  # HairStrand.isVisible()
	var base := slot_position(face, int(s.get("s", 0)))
	var rot: Vector3 = FACE_ROT.get(face, Vector3.ZERO) + Vector3(
		float(s.get("rx", 0.0)), float(s.get("ry", 0.0)), float(s.get("rz", 0.0)))
	var scale := Vector3(float(s.get("sx", 1.0)), float(s.get("sy", 1.0)), float(s.get("sz", 1.0)))
	var cube := Vector3(float(s.get("cw", 2.0)), float(s.get("ch", 2.0)), float(s.get("cd", 2.0)))
	var curve := Vector3(float(s.get("cx", 0.0)), float(s.get("cy", 0.0)), float(s.get("cz", 0.0)))
	var stretch := float(s.get("ls", 1.0))
	# translate(base) * rotate(rot) * scale(scale), X mirrored into Godot space
	var xf := Transform3D(_rot_basis(rot).scaled(scale), Vector3(-base.x, base.y, base.z))
	var curve_basis := _rot_basis(curve)
	var curved := curve != Vector3.ZERO
	var nudge := 0.0
	if curved:
		nudge = GAP_NUDGE + absf(sin(deg_to_rad(curve.z))) + absf(sin(deg_to_rad(curve.x)))
	var size_mul := 1.0
	var prev_h := 0.0
	var added := false
	for i in count:
		var cw := cube.x * size_mul
		var ch := cube.y * size_mul * stretch
		var cd := cube.z * size_mul
		var down := 0.0
		if i > 0:
			xf = xf.translated_local(Vector3(0.0, prev_h, 0.0))
			if curved:
				xf = xf * Transform3D(curve_basis)
			# the cube reaches below its own origin to close the gap a curve opens
			down = cw * 0.5 * absf(sin(deg_to_rad(curve.z))) \
				+ cd * 0.5 * absf(sin(deg_to_rad(curve.x))) + GAP_NUDGE
		if _add_cube(st, xf, cw, ch, cd, down, float(i) / float(count)):
			added = true
		prev_h = ch
		size_mul *= SIZE_DECAY
	return added

## Rx(x) * Ry(-y) * Rz(-z): Minecraft's PoseStack order, mirrored in X with the
## rest of the model.
static func _rot_basis(deg: Vector3) -> Basis:
	var b := Basis()
	if deg.x != 0.0:
		b = b * Basis(Vector3(1, 0, 0), deg_to_rad(deg.x))
	if deg.y != 0.0:
		b = b * Basis(Vector3(0, 1, 0), deg_to_rad(-deg.y))
	if deg.z != 0.0:
		b = b * Basis(Vector3(0, 0, 1), deg_to_rad(-deg.z))
	return b

## One cube of a strand: x/z centred, y from -down to height (HairRenderer.renderCube).
static func _add_cube(st: SurfaceTool, xf: Transform3D, w: float, h: float, d: float,
		down: float, along: float) -> bool:
	if w <= 0.001 or h <= 0.001 or d <= 0.001:
		return false
	const UVS := [Vector2(0.40, 0.40), Vector2(0.53, 0.40), Vector2(0.53, 0.53), Vector2(0.40, 0.53)]
	var hw := w * 0.5
	var hd := d * 0.5
	var y0 := -down
	var y1 := h
	var c := [
		Vector3(hw, y0, hd), Vector3(hw, y0, -hd), Vector3(-hw, y0, -hd), Vector3(-hw, y0, hd),
		Vector3(hw, y1, hd), Vector3(hw, y1, -hd), Vector3(-hw, y1, -hd), Vector3(-hw, y1, hd),
	]
	var faces := [
		[Vector3(1, 0, 0), 4, 5, 1, 0], [Vector3(-1, 0, 0), 6, 7, 3, 2],
		[Vector3(0, 1, 0), 6, 5, 4, 7], [Vector3(0, -1, 0), 3, 0, 1, 2],
		[Vector3(0, 0, 1), 7, 4, 0, 3], [Vector3(0, 0, -1), 5, 6, 2, 1],
	]
	# facet shading is baked into the vertex colours: DMZ's hair tile is nearly
	# white and a near black hair colour would otherwise read as one flat block
	var tip := 0.88 + 0.12 * along
	for f in faces:
		var n: Vector3 = (xf.basis * (f[0] as Vector3)).normalized()
		var p: Array = []
		for k in range(1, 5):
			p.append(xf * (c[f[k]] as Vector3))
		var b := (0.42 + 0.58 * (0.5 + 0.5 * n.y) - 0.09 * n.z) * tip
		st.set_color(Color(b, b, b, 1.0))
		BedrockModel._add_quad(st, p, UVS, n)
	return true

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
	# One surface keeps using `material_override`, which is what
	# TransformationDirector's hair flicker reaches for; a hair with per strand
	# colours needs a material per surface, so the override is cleared there.
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

## Main hair material of a composed model, whichever slot it ended up in.
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

## Albedo actually used for a hair colour. Very dark hair (DMZ's own presets use
## #0E1011 and #222629) is lifted until the baked facet shading is visible, so a
## head does not render as one black block from behind.
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

## Bounding size of a style in model units (tests / framing).
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
