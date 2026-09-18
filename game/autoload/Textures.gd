extends Node
## Builds the block texture array and caches item/entity/gui textures.

const BLOCK_TEX_DIR := "res://assets/textures/blocks/"
const ITEM_TEX_DIR := "res://assets/textures/items/"
const ENTITY_TEX_DIR := "res://assets/textures/entity/"
const GUI_TEX_DIR := "res://assets/textures/gui/"
const PARTICLE_TEX_DIR := "res://assets/textures/particles/"
const TILE := 16

var block_array: Texture2DArray
var layer_of: Dictionary = {}          # texture key -> first layer index
var frames_of: Dictionary = {}         # texture key -> frame count (animated strips)
var block_faces: Array = []            # numeric block id -> PackedInt32Array(6) of base layers (or -1 -> use variants)
var block_variants: Array = []         # numeric block id -> PackedInt32Array of layer indices for variant picks
var built := false
var _cache: Dictionary = {}
var _missing: Texture2D

func _ready() -> void:
	if Registry.loaded:
		build_block_array()
	else:
		call_deferred("build_block_array")

func build_block_array() -> void:
	if built:
		return
	var images: Array[Image] = []
	layer_of.clear()
	frames_of.clear()
	# Layer 0: missing texture (magenta/black checker) so unknown keys are visible, not invisible.
	var miss := Image.create(TILE, TILE, false, Image.FORMAT_RGBA8)
	for y in TILE:
		for x in TILE:
			miss.set_pixel(x, y, Color(1, 0, 1) if ((x / 8 + y / 8) % 2 == 0) else Color(0, 0, 0))
	images.append(miss)
	layer_of["__missing__"] = 0
	var keys := PackedStringArray()
	for b in Registry.blocks:
		for v in b.get("textures", {}).values():
			if not keys.has(v):
				keys.append(v)
		for v in b.get("variants", []):
			if not keys.has(v):
				keys.append(v)
		var pl: Dictionary = b.get("plant", {})
		for v in pl.get("stage_textures", []):
			if not keys.has(v):
				keys.append(v)
	for key in keys:
		var img: Image = _load_tile(key)
		if img == null:
			Log.w("Missing block texture: " + key)
			layer_of[key] = 0
			frames_of[key] = 1
			continue
		var frames := max(1, img.get_height() / TILE)
		layer_of[key] = images.size()
		frames_of[key] = frames
		for f in frames:
			var frame := Image.create(TILE, TILE, false, Image.FORMAT_RGBA8)
			frame.blit_rect(img, Rect2i(0, f * TILE, TILE, TILE), Vector2i.ZERO)
			images.append(frame)
	# Mipmaps for every layer: the chunk shaders sample with a mipmap filter, and a layered
	# texture without a mip chain is handled inconsistently by mobile GPUs (distant blocks
	# go black on some drivers). Every layer is 16x16, so the chains match.
	# Mipmaps only off phones: a mipmapped Texture2DArray is the one boot-time GPU upload
	# that differs between the desktop and the phone builds, so it stays off on Android
	# until the on-device crash is pinned down.
	if not Game.is_mobile():
		for im in images:
			(im as Image).generate_mipmaps()
	block_array = Texture2DArray.new()
	var err := block_array.create_from_images(images)
	if err != OK:
		Log.e("Texture2DArray creation failed: %d" % err)
	# Precompute per-face layers.
	block_faces.clear()
	block_variants.clear()
	for b in Registry.blocks:
		var faces := PackedInt32Array([0, 0, 0, 0, 0, 0])
		var t: Dictionary = b.get("textures", {})
		var all_key: String = t.get("all", "")
		var side_key: String = t.get("side", all_key)
		var names := ["east", "west", "top", "bottom", "south", "north"]
		for i in 6:
			var k: String = t.get(names[i], "")
			if k == "":
				k = side_key if i != 2 and i != 3 else t.get(names[i], all_key)
				if i == 2 and t.has("top"):
					k = t["top"]
				if i == 3 and t.has("bottom"):
					k = t["bottom"]
			faces[i] = layer_of.get(k, 0)
		block_faces.append(faces)
		var vars := PackedInt32Array()
		for v in b.get("variants", []):
			vars.append(layer_of.get(v, 0))
		block_variants.append(vars)
	built = true
	Log.i("Block texture array: %d layers" % images.size())

func _load_tile(key: String) -> Image:
	var path := BLOCK_TEX_DIR + key + ".png"
	if not ResourceLoader.exists(path):
		return null
	var tex: Texture2D = load(path)
	if tex == null:
		return null
	var img: Image = tex.get_image()
	if img == null:
		return null
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGBA8)
	if img.get_width() != TILE:
		var h := int(round(float(img.get_height()) * float(TILE) / float(img.get_width())))
		img.resize(TILE, max(TILE, h), Image.INTERPOLATE_NEAREST)
	if img.get_height() % TILE != 0:
		img.resize(TILE, TILE, Image.INTERPOLATE_NEAREST)
	return img

func layer(tex_key: String) -> int:
	return layer_of.get(tex_key, 0)

func frames(tex_key: String) -> int:
	return frames_of.get(tex_key, 1)

## face: 0=+X east 1=-X west 2=+Y top 3=-Y bottom 4=+Z south 5=-Z north
func block_face_layer(block_id: int, face: int, x := 0, y := 0, z := 0) -> int:
	if block_id < 0 or block_id >= block_faces.size():
		return 0
	var vars: PackedInt32Array = block_variants[block_id]
	if vars.size() > 0 and (face == 2 or Registry.blocks[block_id].get("textures", {}).has("all")):
		var h := (x * 73856093) ^ (y * 19349663) ^ (z * 83492791)
		h = (h ^ (h >> 13)) & 0x7fffffff
		return vars[h % vars.size()]
	return block_faces[block_id][face]

func _load_tex(path: String) -> Texture2D:
	if _cache.has(path):
		return _cache[path]
	var tex: Texture2D = null
	if ResourceLoader.exists(path):
		tex = load(path)
	if tex == null:
		tex = missing_texture()
	_cache[path] = tex
	return tex

func missing_texture() -> Texture2D:
	if _missing == null:
		var img := Image.create(16, 16, false, Image.FORMAT_RGBA8)
		img.fill(Color(1, 0, 1, 1))
		_missing = ImageTexture.create_from_image(img)
	return _missing

func item_icon(item_id: String) -> Texture2D:
	var def := Registry.item(item_id)
	var icon: String = def.get("icon", item_id)
	return _load_tex(ITEM_TEX_DIR + icon + ".png")

func entity_texture(rel_path: String) -> Texture2D:
	var hd := ENTITY_TEX_DIR + "hd/" + rel_path + ".png"
	if ResourceLoader.exists(hd):
		return _load_tex(hd)
	return _load_tex(ENTITY_TEX_DIR + rel_path + ".png")

func entity_image(rel_path: String) -> Image:
	var tex := entity_texture(rel_path)
	var img: Image = tex.get_image()
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGBA8)
	return img

func gui(name: String) -> Texture2D:
	return _load_tex(GUI_TEX_DIR + name + ".png")

func particle(name: String) -> Texture2D:
	return _load_tex(PARTICLE_TEX_DIR + name + ".png")

func misc(name: String) -> Texture2D:
	return _load_tex("res://assets/textures/misc/" + name + ".png")
