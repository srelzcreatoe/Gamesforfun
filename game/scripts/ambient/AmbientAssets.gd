class_name AmbientAssets
extends RefCounted
## Textures, materials and meshes shared by every ambient emitter. Everything is built once and
## cached in static vars: the ambient layer never creates a Material, a Mesh or an Image while
## the game is running.

const PARTICLE_DIR := "res://assets/textures/particles/"
const MOTES_SHADER := "res://shaders/ambient_motes.gdshader"
const BUTTERFLY_SHADER := "res://shaders/ambient_butterfly.gdshader"
const BIRDS_SHADER := "res://shaders/ambient_birds.gdshader"

## Sprite sheets from the Fused pack: 4 frames of 16x16 laid out horizontally.
const BUTTERFLY_TEXTURES: Array[String] = [
	"fused/butterfly_blue", "fused/butterfly_orange", "fused/butterfly_white", "fused/butterfly_yellow",
]
const BIRD_TEXTURES: Array[String] = [
	"fused/bird_black", "fused/bird_grey", "fused/bird_blue", "fused/bird_pink",
]
const LEAF_SPRITES: Array[String] = [
	"fused/oak_leaf_a", "fused/oak_leaf_b", "fused/birch_leaf_a", "fused/jungle_leaf_b",
]

static var _tex: Dictionary = {}
static var _mesh: Dictionary = {}
static var _block_color: Dictionary = {}
static var _leaf_mask: Texture2D = null
static var _dot: Texture2D = null
static var _ring: Texture2D = null
static var _streak: Texture2D = null

# --- textures ---------------------------------------------------------------------------------

## A particle sprite by name (relative to assets/textures/particles, no extension), falling back
## to the generated soft dot so nothing is ever magenta.
static func tex(name: String) -> Texture2D:
	if name == "":
		return soft_dot()
	if _tex.has(name):
		return _tex[name]
	var path := PARTICLE_DIR + name + ".png"
	var t: Texture2D = load(path) if ResourceLoader.exists(path) else soft_dot()
	if t == null:
		t = soft_dot()
	_tex[name] = t
	return t

## 16x16 radial falloff, the workhorse sprite for motes, fireflies and glows.
static func soft_dot() -> Texture2D:
	if _dot != null:
		return _dot
	var img := Image.create(16, 16, false, Image.FORMAT_RGBA8)
	for y in 16:
		for x in 16:
			var d := Vector2(float(x) - 7.5, float(y) - 7.5).length() / 7.5
			var a := clampf(1.0 - d, 0.0, 1.0)
			# Squared (not cubed) falloff: a firefly needs a visible halo, not a single pixel.
			img.set_pixel(x, y, Color(1, 1, 1, a * a))
	_dot = ImageTexture.create_from_image(img)
	return _dot

## A thin bright ring, used for the expanding splash ripple on water.
static func ring() -> Texture2D:
	if _ring != null:
		return _ring
	var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
	for y in 32:
		for x in 32:
			var d := Vector2(float(x) - 15.5, float(y) - 15.5).length() / 15.5
			# Bright at d == 0.82, fading either side; nothing outside the disc.
			var a := clampf(1.0 - absf(d - 0.82) / 0.2, 0.0, 1.0)
			a *= clampf((1.0 - d) * 6.0, 0.0, 1.0)
			img.set_pixel(x, y, Color(1, 1, 1, a * a))
	_ring = ImageTexture.create_from_image(img)
	return _ring

## Vertical soft streak for shooting stars (bright head at the top, tail fading down).
static func streak() -> Texture2D:
	if _streak != null:
		return _streak
	var img := Image.create(8, 64, false, Image.FORMAT_RGBA8)
	for y in 64:
		var along := 1.0 - float(y) / 63.0            # 1 at the head (v = 0)
		var head := pow(along, 2.6)
		for x in 8:
			var across := 1.0 - absf(float(x) - 3.5) / 3.5
			img.set_pixel(x, y, Color(1, 1, 1, clampf(across * across * head, 0.0, 1.0)))
	_streak = ImageTexture.create_from_image(img)
	return _streak

## A leaf silhouette with the colour stripped out: white RGB, the sprite's alpha, so the leaf can
## be tinted to the biome's foliage colour at spawn time.
static func leaf_mask() -> Texture2D:
	if _leaf_mask != null:
		return _leaf_mask
	var src: Image = null
	for n in LEAF_SPRITES:
		var path := PARTICLE_DIR + n + ".png"
		if ResourceLoader.exists(path):
			var t: Texture2D = load(path)
			if t != null:
				src = t.get_image()
				break
	if src == null:
		_leaf_mask = soft_dot()
		return _leaf_mask
	if src.is_compressed():
		src.decompress()
	src.convert(Image.FORMAT_RGBA8)
	var w := src.get_width()
	var h := src.get_height()
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	for y in h:
		for x in w:
			var c := src.get_pixel(x, y)
			if c.a < 0.35:
				img.set_pixel(x, y, Color(1, 1, 1, 0))
				continue
			# Keep the sprite's internal shading as a grey ramp so the leaf still reads as a leaf.
			var luma := clampf(0.35 + 0.9 * (c.r * 0.3 + c.g * 0.6 + c.b * 0.1), 0.0, 1.0)
			img.set_pixel(x, y, Color(luma, luma, luma, c.a))
	_leaf_mask = ImageTexture.create_from_image(img)
	return _leaf_mask

# --- block colours ----------------------------------------------------------------------------

## Average colour of a block's texture, used to tint break debris and footstep dust so the puff
## matches the block the player actually hit. Cached per block id.
static func block_color(block_id: int) -> Color:
	if _block_color.has(block_id):
		return _block_color[block_id]
	var c := Color(0.62, 0.6, 0.58)
	if block_id > 0 and Textures != null and Textures.block_array != null:
		var face := 2                                    # top face reads best for ground blocks
		var layer := 0
		if BlockTable.built and block_id * 6 + face < BlockTable.face_layer.size():
			layer = BlockTable.face_layer[block_id * 6 + face]
		else:
			layer = Textures.block_face_layer(block_id, face)
		var img: Image = null
		if layer > 0 and layer < Textures.block_array.get_layers():
			img = Textures.block_array.get_layer_data(layer)
		if img != null:
			var r := 0.0
			var g := 0.0
			var b := 0.0
			var n := 0
			for y in img.get_height():
				for x in img.get_width():
					var p := img.get_pixel(x, y)
					if p.a < 0.5:
						continue
					r += p.r
					g += p.g
					b += p.b
					n += 1
			if n > 0:
				c = Color(r / float(n), g / float(n), b / float(n))
	_block_color[block_id] = c
	return c

## Parse "#RRGGBB" from data/biomes.json; white when the field is missing or malformed.
static func hex_color(s: String, fallback := Color(1, 1, 1)) -> Color:
	if s.length() < 6:
		return fallback
	var t := s
	if not t.begins_with("#"):
		t = "#" + t
	if not t.is_valid_html_color():
		return fallback
	return Color(t)

## The colour a falling leaf should be in this biome: the leaf block's own texture colour, warmed
## by the biome foliage tint when the block is foliage-tinted (oak/jungle/etc.).
static func leaf_color(block_id: int, biome_def: Dictionary) -> Color:
	var base := block_color(block_id)
	var tinted := BlockTable.built and block_id > 0 and block_id < BlockTable.tint.size() \
			and BlockTable.tint[block_id] == BlockTable.Tint.FOLIAGE
	if tinted:
		var f := hex_color(String(biome_def.get("foliage_color", "")), Color(0.47, 0.67, 0.18))
		base = Color(base.r * f.r * 1.9, base.g * f.g * 1.9, base.b * f.b * 1.9)
	# A leaf lit from behind is paler than the canopy it fell out of; without this lift a dark
	# conifer leaf is invisible against the dark conifer it came from.
	base = base.lerp(Color(1, 1, 1), 0.22)
	return Color(clampf(base.r, 0.0, 1.0), clampf(base.g, 0.0, 1.0), clampf(base.b, 0.0, 1.0), 1.0)

# --- meshes -----------------------------------------------------------------------------------

## Unit quad in the XY plane, centred on the origin (the billboard shaders expand it themselves).
static func unit_quad() -> Mesh:
	if _mesh.has("quad"):
		return _mesh["quad"]
	var q := QuadMesh.new()
	q.size = Vector2.ONE
	_mesh["quad"] = q
	return q

## Horizontal quad facing +Y, used for the flat ripple ring on the water surface.
static func flat_quad() -> Mesh:
	if _mesh.has("flat"):
		return _mesh["flat"]
	var p := PlaneMesh.new()
	p.size = Vector2.ONE
	p.orientation = PlaneMesh.FACE_Y
	_mesh["flat"] = p
	return p

## Tall thin quad for the shooting-star streak (particles align their Y axis to velocity).
static func streak_quad() -> Mesh:
	if _mesh.has("streak"):
		return _mesh["streak"]
	var q := QuadMesh.new()
	q.size = Vector2(0.18, 1.0)
	_mesh["streak"] = q
	return q

## Two wing quads hinged at x = 0, lying flat in the XZ plane with the body along Z.
## UVs address the left and right halves of frame 0 of a 4-frame 64x16 butterfly sheet.
## ambient_butterfly.gdshader folds them up and down around the body axis.
static func butterfly_mesh() -> Mesh:
	if _mesh.has("butterfly"):
		return _mesh["butterfly"]
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()
	var mid := 0.125
	var edge_r := 0.25
	var edge_l := 0.0
	# right wing (x 0 -> +1)
	verts.append_array([Vector3(0, 0, -0.5), Vector3(1, 0, -0.5), Vector3(1, 0, 0.5), Vector3(0, 0, 0.5)])
	uvs.append_array([Vector2(mid, 0), Vector2(edge_r, 0), Vector2(edge_r, 1), Vector2(mid, 1)])
	idx.append_array([0, 1, 2, 0, 2, 3])
	# left wing (x 0 -> -1)
	verts.append_array([Vector3(0, 0, -0.5), Vector3(-1, 0, -0.5), Vector3(-1, 0, 0.5), Vector3(0, 0, 0.5)])
	uvs.append_array([Vector2(mid, 0), Vector2(edge_l, 0), Vector2(edge_l, 1), Vector2(mid, 1)])
	idx.append_array([4, 6, 5, 4, 7, 6])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_TEX_UV] = uvs
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	_mesh["butterfly"] = m
	return m

# --- materials --------------------------------------------------------------------------------

## Additive, unshaded billboard material for CPUParticles3D bursts.
static func particle_material(texture: Texture2D, additive := true) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD if additive else BaseMaterial3D.BLEND_MODE_MIX
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.albedo_texture = texture
	m.vertex_color_use_as_albedo = true
	m.disable_receive_shadows = true
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.billboard_keep_scale = true
	return m

## Same, but world-aligned (no billboard) for flat decals lying on the ground or water.
static func decal_material(texture: Texture2D, additive := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD if additive else BaseMaterial3D.BLEND_MODE_MIX
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.albedo_texture = texture
	m.vertex_color_use_as_albedo = true
	m.disable_receive_shadows = true
	m.no_depth_test = false
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	return m

static func shader_material(path: String) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	if ResourceLoader.exists(path):
		var sh: Shader = load(path)
		if sh != null:
			m.shader = sh
	return m

static func motes_material() -> ShaderMaterial:
	return shader_material(MOTES_SHADER)

static func butterfly_material() -> ShaderMaterial:
	return shader_material(BUTTERFLY_SHADER)

static func birds_material() -> ShaderMaterial:
	return shader_material(BIRDS_SHADER)
