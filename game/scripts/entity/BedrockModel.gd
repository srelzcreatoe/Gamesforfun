class_name BedrockModel
extends Node3D
## Runtime loader/renderer for verbatim Bedrock `*.geo.json` models (DragonMineZ
## assets, docs/ARCHITECTURE.md §7).
##
## BEDROCK -> GODOT CONVENTIONS (every other subsystem must use these)
## -----------------------------------------------------------------------------
## * 1 model unit = 1/16 m. This node's `scale` is `1/16 * user_scale`, so every
##   bone transform, pivot and animation offset below is expressed in MODEL UNITS
##   (exactly the numbers in the json), which makes animation data apply verbatim.
## * Position mapping: `godot = Vector3(-bedrock.x, bedrock.y, bedrock.z)`.
##   The X axis is MIRRORED, which is what puts the bone named `right_arm`
##   (bedrock x = -5) on the entity's right hand side while the head's `north`
##   (-Z) face - the face panel of the skin - keeps pointing along Godot forward
##   (-Z). Feet are at y = 0.
##   The quads are built directly in Godot space (not mirrored after the fact), so
##   each face still samples its own skin panel in the normal reading direction:
##   U runs -X on the front, +X on the back, -Z on the entity's right (+X, the
##   skin's "east"/first panel) and +Z on its left. An asymmetric skin detail -
##   Vegeta's scouter, a one-sleeve gi - therefore stays on the correct side.
##   Triangles are wound CLOCKWISE as seen from the front face, which is what
##   Godot rasterises as front-facing (`_add_quad` enforces it from the normal).
## * Rotation mapping: the three json degrees are used AS IS
##   (`euler = Vector3(rx, ry, rz)` in degrees) and composed Rz * Ry * Rx
##   (`bedrock_basis()`), which reproduces Bedrock/GeckoLib bone order.
##   Verified against the DMZ data: `base.walk` swings the right leg forward while
##   the right arm swings back, and `head.rotation.y = -query.head_y_rotation`
##   turns the head toward the side the entity looks at.
## * Scale mapping: used as is (a mirror does not change a diagonal scale).
## * Box UV layout (confirmed against `armorLeggingsBody`, which ships both the
##   box form and the expanded per-face form of the same cube):
##       up    = (u+d,       v,     w, d)     east = (u,         v+d, d, h)
##       down  = (u+d+w,     v+d,   w, -d)    north= (u+d,       v+d, w, h)
##                                            west = (u+d+w,     v+d, d, h)
##                                            south= (u+d+w+d,   v+d, w, h)
##   UVs are normalised with `texture_width/height` from the geometry
##   description, NOT with the image size, so the DMZ-HD 1024x1024 textures work
##   with no changes.
##
## Meshes are cached per geometry path (one ArrayMesh per bone), so spawning many
## entities of the same type costs one Node3D per bone and no mesh building.

const MODELS_DIR := "res://assets/models/"
const HAIR_BONE_RE := "^(pelo|hair|cabello|cape|capa|cloth|manto|falda|skirt|tela)"

static var prefer_hd := true
## Sign applied to the three Bedrock euler degrees before composing Rz*Ry*Rx.
## Kept as a knob so the convention can be re-verified from ModelPreview
## (--signs=1,-1,-1); the shipped value is the one that renders correctly.
static var euler_signs := Vector3(1.0, 1.0, 1.0)
static var _geo_cache: Dictionary = {}          # rel path -> parsed geometry Dictionary
static var _mesh_cache: Dictionary = {}         # rel path -> {bone: ArrayMesh}
static var _hair_re: RegEx = null

var geo_path := ""
var texture_size := Vector2i(64, 64)
var bounds_size := Vector2(2.0, 2.0)            # visible_bounds_width/height (metres)
var bounds_offset := Vector3(0.0, 1.0, 0.0)     # visible_bounds_offset (metres)
var bones: Dictionary = {}                      # name -> Node3D
var pivots: Dictionary = {}                     # name -> absolute pivot (godot model units)
var nested := false                             # true when parented inside another model
var bone_order: PackedStringArray = PackedStringArray()
var rest_position: Dictionary = {}              # name -> Vector3 (model units)
var rest_rotation: Dictionary = {}              # name -> Vector3 (degrees)
var locators: Dictionary = {}                   # name -> Node3D
var meshes: Dictionary = {}                     # name -> MeshInstance3D
var material: StandardMaterial3D = null         # shared, back-face culled
var material_nocull: StandardMaterial3D = null  # hair / cloth bones
var model_scale := 1.0
var base_scale := 1.0                           # entity base scale; form scaling multiplies it

# --- loading ------------------------------------------------------------------

static func geo_file(path_rel: String) -> String:
	var p := path_rel.trim_suffix(".geo.json")
	if prefer_hd:
		var hd := MODELS_DIR + "hd/" + p + ".geo.json"
		if ResourceLoader.exists(hd) or FileAccess.file_exists(hd):
			return hd
	return MODELS_DIR + p + ".geo.json"

## Parse (cached) `minecraft:geometry[0]` of a geo file. Returns {} on failure.
static func parse_geo(path_rel: String) -> Dictionary:
	var file := geo_file(path_rel)
	if _geo_cache.has(file):
		return _geo_cache[file]
	var geo: Dictionary = {}
	var txt := ""
	if FileAccess.file_exists(file):
		var f := FileAccess.open(file, FileAccess.READ)
		if f != null:
			txt = f.get_as_text()
			f.close()
	if txt != "":
		var parsed: Variant = JSON.parse_string(txt)
		if parsed is Dictionary and parsed.has("minecraft:geometry"):
			var list: Array = parsed["minecraft:geometry"]
			if list.size() > 0 and list[0] is Dictionary:
				geo = list[0]
	if geo.is_empty():
		Log.w("BedrockModel: cannot load geometry " + file)
	_geo_cache[file] = geo
	return geo

## Build the bone hierarchy + meshes. `path_rel` is relative to assets/models and
## carries no extension, e.g. "entity/races/human".
func load_geo(path_rel: String) -> bool:
	_clear()
	var geo := parse_geo(path_rel)
	if geo.is_empty():
		return false
	geo_path = path_rel
	var desc: Dictionary = geo.get("description", {})
	texture_size = Vector2i(int(desc.get("texture_width", 64)), int(desc.get("texture_height", 64)))
	if texture_size.x <= 0:
		texture_size.x = 64
	if texture_size.y <= 0:
		texture_size.y = 64
	bounds_size = Vector2(float(desc.get("visible_bounds_width", 2.0)), float(desc.get("visible_bounds_height", 2.0)))
	bounds_offset = _vec3(desc.get("visible_bounds_offset", [0, 1, 0]))
	_ensure_materials()
	var bone_list: Array = geo.get("bones", [])
	# pivots in godot model space, needed to make child transforms relative
	pivots.clear()
	for b in bone_list:
		if b is Dictionary:
			pivots[String(b.get("name", ""))] = to_godot(b.get("pivot", [0, 0, 0]))
	var parents: Dictionary = {}
	for b in bone_list:
		if not (b is Dictionary):
			continue
		var name := String(b.get("name", ""))
		if name == "":
			continue
		var node := Node3D.new()
		node.name = name
		bones[name] = node
		bone_order.append(name)
		parents[name] = String(b.get("parent", ""))
		var pivot: Vector3 = pivots[name]
		var parent_pivot: Vector3 = pivots.get(parents[name], Vector3.ZERO)
		var rot: Vector3 = _vec3(b.get("rotation", [0, 0, 0]))
		rest_position[name] = pivot - parent_pivot
		rest_rotation[name] = rot
		node.transform = Transform3D(bedrock_basis(rot), pivot - parent_pivot)
	# attach in declaration order (parents always come first in DMZ files, but be safe)
	for name in bone_order:
		var parent_name: String = parents[name]
		var parent_node: Node3D = bones.get(parent_name)
		if parent_node != null and parent_name != name:
			parent_node.add_child(bones[name])
		else:
			add_child(bones[name])
	# meshes (cached per geometry file)
	var cache_key := geo_file(path_rel)
	var mesh_set: Dictionary = _mesh_cache.get(cache_key, {})
	if mesh_set.is_empty():
		mesh_set = _build_meshes(bone_list, pivots)
		_mesh_cache[cache_key] = mesh_set
	for name in mesh_set.keys():
		var node: Node3D = bones.get(name)
		if node == null:
			continue
		var mi := MeshInstance3D.new()
		mi.name = "mesh"
		mi.mesh = mesh_set[name]
		mi.material_override = material_nocull if is_soft_bone(name) else material
		node.add_child(mi)
		meshes[name] = mi
	# locators
	for b in bone_list:
		if not (b is Dictionary) or not b.has("locators"):
			continue
		var host: Node3D = bones.get(String(b.get("name", "")))
		if host == null:
			continue
		var pivot: Vector3 = pivots.get(String(b.get("name", "")), Vector3.ZERO)
		var loc: Dictionary = b["locators"]
		for lname in loc.keys():
			var raw: Variant = loc[lname]
			var pos: Array = raw if raw is Array else raw.get("offset", [0, 0, 0])
			var m := Node3D.new()
			m.name = String(lname)
			m.position = to_godot(pos) - pivot
			host.add_child(m)
			locators[String(lname)] = m
	set_model_scale(model_scale)
	return true

func _clear() -> void:
	for c in get_children():
		remove_child(c)
		c.queue_free()
	bones.clear()
	bone_order = PackedStringArray()
	rest_position.clear()
	rest_rotation.clear()
	locators.clear()
	meshes.clear()
	pivots.clear()

func _ensure_materials() -> void:
	if material != null:
		return
	material = _make_material(BaseMaterial3D.CULL_BACK)
	material_nocull = _make_material(BaseMaterial3D.CULL_DISABLED)

static func _make_material(cull: int) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	m.alpha_scissor_threshold = 0.5
	m.cull_mode = cull
	m.metallic = 0.0
	m.roughness = 1.0
	m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	m.diffuse_mode = BaseMaterial3D.DIFFUSE_LAMBERT
	return m

static func is_soft_bone(name: String) -> bool:
	if _hair_re == null:
		_hair_re = RegEx.new()
		_hair_re.compile(HAIR_BONE_RE)
	return _hair_re.search(name.to_lower()) != null

# --- conventions ---------------------------------------------------------------

static func _vec3(v: Variant) -> Vector3:
	if v is Array and v.size() >= 3:
		return Vector3(float(v[0]), float(v[1]), float(v[2]))
	if v is float or v is int:
		return Vector3(float(v), float(v), float(v))
	return Vector3.ZERO

## Bedrock model position -> Godot model-unit position (X mirrored).
static func to_godot(v: Variant) -> Vector3:
	var b := _vec3(v)
	return Vector3(-b.x, b.y, b.z)

## Bedrock euler degrees -> Basis, composed Rz * Ry * Rx like Bedrock/GeckoLib.
## Written out by hand (6 trig calls, single-axis fast paths) because this runs
## for every animated bone every frame.
static func bedrock_basis(deg: Vector3) -> Basis:
	var x := deg.x * euler_signs.x
	var y := deg.y * euler_signs.y
	var z := deg.z * euler_signs.z
	if x == 0.0:
		if y == 0.0:
			if z == 0.0:
				return Basis()
			var rz := z * 0.017453292519943295
			var cz := cos(rz)
			var sz := sin(rz)
			return Basis(Vector3(cz, sz, 0.0), Vector3(-sz, cz, 0.0), Vector3(0.0, 0.0, 1.0))
		elif z == 0.0:
			var ry := y * 0.017453292519943295
			var cy := cos(ry)
			var sy := sin(ry)
			return Basis(Vector3(cy, 0.0, -sy), Vector3(0.0, 1.0, 0.0), Vector3(sy, 0.0, cy))
	elif y == 0.0 and z == 0.0:
		var rx := x * 0.017453292519943295
		var cx := cos(rx)
		var sx := sin(rx)
		return Basis(Vector3(1.0, 0.0, 0.0), Vector3(0.0, cx, sx), Vector3(0.0, -sx, cx))
	var a := x * 0.017453292519943295
	var b := y * 0.017453292519943295
	var c := z * 0.017453292519943295
	var ca := cos(a)
	var sa := sin(a)
	var cb := cos(b)
	var sb := sin(b)
	var cc := cos(c)
	var sc := sin(c)
	# columns of Rz(c) * Ry(b) * Rx(a)
	return Basis(
		Vector3(cc * cb, sc * cb, -sb),
		Vector3(cc * sb * sa - sc * ca, sc * sb * sa + cc * ca, cb * sa),
		Vector3(cc * sb * ca + sc * sa, sc * sb * ca - cc * sa, cb * ca))

# --- mesh building -------------------------------------------------------------

func _build_meshes(bone_list: Array, pivots: Dictionary) -> Dictionary:
	var out: Dictionary = {}
	var tw := float(texture_size.x)
	var th := float(texture_size.y)
	for b in bone_list:
		if not (b is Dictionary):
			continue
		var cubes: Array = b.get("cubes", [])
		if cubes.is_empty():
			continue
		var name := String(b.get("name", ""))
		var pivot: Vector3 = pivots.get(name, Vector3.ZERO)
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var any := false
		for c in cubes:
			if c is Dictionary:
				any = _add_cube(st, c, pivot, tw, th) or any
		if not any:
			continue
		var mesh := ArrayMesh.new()
		st.index()
		st.commit(mesh)
		out[name] = mesh
	return out

func _add_cube(st: SurfaceTool, cube: Dictionary, bone_pivot: Vector3, tw: float, th: float) -> bool:
	var origin := _vec3(cube.get("origin", [0, 0, 0]))
	var size := _vec3(cube.get("size", [0, 0, 0]))
	var inflate := float(cube.get("inflate", 0.0))
	var mirror := bool(cube.get("mirror", false))
	var uv_raw: Variant = cube.get("uv", [0, 0])
	# box uv is laid out from the UN-inflated size
	var w := size.x
	var h := size.y
	var d := size.z
	var o := origin - Vector3(inflate, inflate, inflate)
	var s := size + Vector3(inflate, inflate, inflate) * 2.0
	# cube extents in GODOT space (X mirrored, see the header)
	var x0 := -(o.x + s.x)
	var x1 := -o.x
	var y0 := o.y
	var y1 := o.y + s.y
	var z0 := o.z
	var z1 := o.z + s.z
	var rot := _vec3(cube.get("rotation", [0, 0, 0]))
	var cube_pivot := to_godot(cube.get("pivot", [0, 0, 0]))
	var basis := bedrock_basis(rot)
	var rotated := rot != Vector3.ZERO

	var rects: Dictionary = {}
	if uv_raw is Dictionary:
		var natural := {
			"up": Vector2(w, d), "down": Vector2(w, d), "east": Vector2(d, h),
			"north": Vector2(w, h), "west": Vector2(d, h), "south": Vector2(w, h),
		}
		for key in ["up", "down", "east", "north", "west", "south"]:
			var fd: Variant = uv_raw.get(key)
			if fd is Dictionary:
				var uv: Vector2 = _vec2(fd.get("uv", [0, 0]))
				var sz: Vector2 = _vec2(fd.get("uv_size", natural[key]))
				rects[key] = Rect2(uv, sz)
	else:
		var u0: float = float(uv_raw[0]) if (uv_raw is Array and uv_raw.size() > 1) else 0.0
		var v0: float = float(uv_raw[1]) if (uv_raw is Array and uv_raw.size() > 1) else 0.0
		rects["up"] = Rect2(u0 + d, v0, w, d)
		rects["down"] = Rect2(u0 + d + w, v0 + d, w, -d)
		rects["east"] = Rect2(u0, v0 + d, d, h)
		rects["north"] = Rect2(u0 + d, v0 + d, w, h)
		rects["west"] = Rect2(u0 + d + w, v0 + d, d, h)
		rects["south"] = Rect2(u0 + d + w + d, v0 + d, w, h)
	if mirror:
		var e: Variant = rects.get("east")
		var wst: Variant = rects.get("west")
		if e != null and wst != null:
			rects["east"] = wst
			rects["west"] = e

	# Godot-space quads: corners are (s,t) = (0,0), (1,0), (1,1), (0,1) of the UV
	# rect, so U runs -X on the front/top, +X on the back, -Z on the entity's
	# right (+X, the skin's "east" panel) and +Z on its left. Building the quads
	# in Godot space (instead of mirroring Bedrock-space quads) keeps every face
	# texture un-mirrored while the geometry stays X mirrored.
	var faces := {
		"north": [[Vector3(x1, y1, z0), Vector3(x0, y1, z0), Vector3(x0, y0, z0), Vector3(x1, y0, z0)], Vector3(0, 0, -1)],
		"south": [[Vector3(x0, y1, z1), Vector3(x1, y1, z1), Vector3(x1, y0, z1), Vector3(x0, y0, z1)], Vector3(0, 0, 1)],
		"east": [[Vector3(x1, y1, z1), Vector3(x1, y1, z0), Vector3(x1, y0, z0), Vector3(x1, y0, z1)], Vector3(1, 0, 0)],
		"west": [[Vector3(x0, y1, z0), Vector3(x0, y1, z1), Vector3(x0, y0, z1), Vector3(x0, y0, z0)], Vector3(-1, 0, 0)],
		"up": [[Vector3(x1, y1, z1), Vector3(x0, y1, z1), Vector3(x0, y1, z0), Vector3(x1, y1, z0)], Vector3(0, 1, 0)],
		"down": [[Vector3(x1, y0, z1), Vector3(x0, y0, z1), Vector3(x0, y0, z0), Vector3(x1, y0, z0)], Vector3(0, -1, 0)],
	}
	var added := false
	for key in faces.keys():
		var rect: Variant = rects.get(key)
		if rect == null:
			continue
		var entry: Array = faces[key]
		var corners: Array = entry[0]
		var p: Array = []
		for i in 4:
			var gp: Vector3 = corners[i]
			if rotated:
				gp = cube_pivot + basis * (gp - cube_pivot)
			p.append(gp - bone_pivot)
		var n: Vector3 = entry[1]
		if rotated:
			n = (basis * n).normalized()
		var r: Rect2 = rect
		var uvs := [
			Vector2(r.position.x, r.position.y) / Vector2(tw, th),
			Vector2(r.position.x + r.size.x, r.position.y) / Vector2(tw, th),
			Vector2(r.position.x + r.size.x, r.position.y + r.size.y) / Vector2(tw, th),
			Vector2(r.position.x, r.position.y + r.size.y) / Vector2(tw, th),
		]
		if mirror:
			var t: Vector2 = uvs[0]
			uvs[0] = uvs[1]
			uvs[1] = t
			t = uvs[3]
			uvs[3] = uvs[2]
			uvs[2] = t
		if _add_quad(st, p, uvs, n):
			added = true
	return added

static func _vec2(v: Variant) -> Vector2:
	if v is Array and v.size() >= 2:
		return Vector2(float(v[0]), float(v[1]))
	if v is Vector2:
		return v
	return Vector2.ZERO

## Emits two triangles, winding them so the front face points along `n`.
static func _add_quad(st: SurfaceTool, p: Array, uvs: Array, n: Vector3) -> bool:
	var a: Vector3 = p[0]
	var b: Vector3 = p[1]
	var c: Vector3 = p[2]
	var cross := (b - a).cross(c - b)
	if cross.length_squared() < 1e-12:
		return false
	# Godot rasterises CLOCKWISE-from-the-front triangles as front faces, so the
	# winding is the reverse of the right-hand-rule order around `n`.
	var order := [3, 2, 1, 0] if cross.dot(n) > 0.0 else [0, 1, 2, 3]
	for tri in [[0, 1, 2], [0, 2, 3]]:
		for k in tri:
			var idx: int = order[k]
			st.set_normal(n)
			st.set_uv(uvs[idx])
			st.add_vertex(p[idx])
	return true

# --- public API ---------------------------------------------------------------

## Set the entity's BASE scale (data/entities.json `scale`). Form scaling goes
## through `set_form_scale()` so it can be reverted.
func set_model_scale(s: float) -> void:
	base_scale = s
	model_scale = s
	scale = Vector3.ONE * (s if nested else s / 16.0)

## Multiply the BASE scale (forms.json `modelScaling`); `1.0` restores it.
func set_form_scale(mult: float) -> void:
	if base_scale <= 0.0:
		base_scale = model_scale
	model_scale = base_scale * maxf(mult, 0.01)
	scale = Vector3.ONE * (model_scale if nested else model_scale / 16.0)

## Current form multiplier on top of the base scale.
func form_scale_mult() -> float:
	return model_scale / maxf(base_scale, 0.0001)

## Mark this model as an attachment inside another BedrockModel's bone (hair,
## armor overlays): its own 1/16 scale is dropped because the parent already has it.
func set_nested(v: bool) -> void:
	nested = v
	scale = Vector3.ONE * (model_scale if nested else model_scale / 16.0)

func set_texture(tex: Texture2D) -> void:
	_ensure_materials()
	material.albedo_texture = tex
	material_nocull.albedo_texture = tex

func set_texture_image(img: Image) -> void:
	if img == null:
		return
	set_texture(ImageTexture.create_from_image(img))

func get_texture() -> Texture2D:
	return material.albedo_texture if material != null else null

func get_bone(name: String) -> Node3D:
	return bones.get(name)

func has_bone(name: String) -> bool:
	return bones.has(name)

func get_locator(name: String) -> Node3D:
	return locators.get(name)

func set_bone_visible(name: String, v: bool) -> void:
	var n: Node3D = bones.get(name)
	if n != null:
		n.visible = v

func is_bone_visible(name: String) -> bool:
	var n: Node3D = bones.get(name)
	return n != null and n.visible

## Hide a list of bones; names ending in "*" hide by prefix.
func hide_layer_bones(names_to_hide: Array) -> void:
	for raw in names_to_hide:
		var pat := String(raw)
		if pat.ends_with("*"):
			var pre := pat.trim_suffix("*")
			for b in bones.keys():
				if String(b).begins_with(pre):
					set_bone_visible(b, false)
		else:
			set_bone_visible(pat, false)

## Toggle only a bone's own mesh, keeping its children visible. Needed for
## attachment models (hair) whose parent chain carries geometry we do not want.
func set_bone_mesh_visible(name: String, v: bool) -> void:
	var mi: MeshInstance3D = meshes.get(name)
	if mi != null:
		mi.visible = v

func is_bone_mesh_visible(name: String) -> bool:
	var mi: MeshInstance3D = meshes.get(name)
	return mi != null and mi.visible and is_bone_visible(name)

## Show the meshes of `keep` only. Bone NODES stay visible so the transform
## chain (and therefore the kept bones' children) keeps working.
func show_only_bones(keep: PackedStringArray) -> void:
	for b in bones.keys():
		var name := String(b)
		set_bone_mesh_visible(name, keep.has(name))

## Per-bone material (armor layers, hair tint, ...). `tex` may be null.
func set_bone_material(name: String, tex: Texture2D, tint := Color.WHITE, nocull := false) -> void:
	var mi: MeshInstance3D = meshes.get(name)
	if mi == null:
		return
	var m: StandardMaterial3D = mi.material_override
	if m == null or m == material or m == material_nocull:
		m = _make_material(BaseMaterial3D.CULL_DISABLED if nocull else BaseMaterial3D.CULL_BACK)
		mi.material_override = m
	m.albedo_texture = tex
	m.albedo_color = tint

func bone_material(name: String) -> StandardMaterial3D:
	var mi: MeshInstance3D = meshes.get(name)
	return mi.material_override if mi != null else null

## Reset every bone to its rest pose (used by the animation player each frame).
func reset_pose() -> void:
	for name in bones.keys():
		var n: Node3D = bones[name]
		n.transform = Transform3D(bedrock_basis(rest_rotation[name]), rest_position[name])
		n.scale = Vector3.ONE

## Tint every material (hit flash, form tint). `1.0` = untinted white.
func set_tint(c: Color) -> void:
	_ensure_materials()
	material.albedo_color = c
	material_nocull.albedo_color = c

func set_emission(c: Color, energy: float) -> void:
	_ensure_materials()
	for m in [material, material_nocull]:
		m.emission_enabled = energy > 0.0
		m.emission = c
		m.emission_energy_multiplier = energy

func bone_count() -> int:
	return bones.size()

## Union of every visible bone mesh in the rest pose, in METRES, relative to the
## model origin (feet at y = 0). Used for camera framing, name tags and health bars.
func visual_aabb() -> AABB:
	var out := AABB()
	var first := true
	for name in meshes.keys():
		var mi: MeshInstance3D = meshes[name]
		var node: Node3D = bones[name]
		if not node.visible:
			continue
		var xf := Transform3D()
		var walk: Node = node
		while walk != null and walk != self:
			if walk is Node3D:
				xf = (walk as Node3D).transform * xf
			walk = walk.get_parent()
		var box: AABB = xf * mi.get_aabb()
		if first:
			out = box
			first = false
		else:
			out = out.merge(box)
	if first:
		return AABB(Vector3.ZERO, Vector3(bounds_size.x, bounds_size.y, bounds_size.x) * model_scale)
	var s := scale.y
	return AABB(out.position * s, out.size * s)

## Model height in metres (for name tags / health bars).
func model_height() -> float:
	var box := visual_aabb()
	return maxf(0.1, box.position.y + box.size.y)
