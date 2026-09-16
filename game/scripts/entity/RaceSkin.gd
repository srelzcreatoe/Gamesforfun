class_name RaceSkin
extends RefCounted
## Composes a DragonMineZ character skin (one 64x64 RGBA image) from the race
## layer textures plus eyes/nose/mouth/tattoo/hair, and applies hair-bone and
## armor-bone visibility to a BedrockModel (docs/DATA_SCHEMA.md §Profile).
##
## WHICH LAYER FILES ARE TINT MASKS (measured from the shipped DMZ textures with
## tools/PIL; see the analysis in the report):
##   * `races/<dir>/bodytype_*_layerN.png` and `base_*_layerN.png` are GRAYSCALE
##     shading masks (namekian/majin/bioandroid/frostdemon layer2..5 are pure gray,
##     alpha is binary 0/255) -> multiplied by a character colour.
##       layer1 -> skin_color, layer2 -> skin_color2, layer3 -> skin_color3,
##       layer4/layer5 -> untinted (nails, teeth, eye sockets).
##   * `races/humansaiyan/bodytype_<gender>_<n>.png` has no _layerN suffix and is
##     an almost-white warm mask (250,227,217 / 237,184,161 / ... plus black
##     outline pixels) -> treated as layer1 and multiplied by skin_color.
##   * `faces/<dir>_eye_<type>_0.png` = sclera (white, untinted),
##     `_1.png` + `_2.png` = the two irises -> eye_color,
##     `_3.png` = eyebrows -> hair_color.
##   * `faces/<dir>_nose_<n>.png` / `_mouth_<n>.png` are skin-tone masks -> skin_color.
##   * `races/tattoos/tattoo_<n>.png` is already coloured -> untinted.
##   * `races/hair_base.png` is a gray head overlay -> hair_color.
##   * `races/hair.png` (16x16 gray) is the flat shading tile used for the 3D hair
##     bones, tinted with hair_color through the bone material.
##
## Composition happens on the 64x64 DMZ layers (not the 1024x1024 DMZ-HD ones):
## a GDScript per-pixel composite of eight 1024x1024 layers takes seconds, while
## the 64x64 one takes ~1 ms and is cached. Fixed character textures (sagas,
## masters) are unaffected and still load their HD variant through
## `Textures.entity_texture`. Set `RaceSkin.hd = true` to opt into HD composition.

const TEX_DIR := "res://assets/textures/entity/"
const ARMOR_DIR := "res://assets/textures/armor/"
const RACE_DIRS := {
	"human": "humansaiyan", "saiyan": "humansaiyan", "humansaiyan": "humansaiyan",
	"halfsaiyan": "humansaiyan", "half_saiyan": "humansaiyan",
	"namek": "namekian", "namekian": "namekian",
	"majin": "majin", "buu": "majin",
	"bioandroid": "bioandroid", "android": "bioandroid", "cell": "bioandroid",
	"frostdemon": "frostdemon", "coldemon": "frostdemon", "arcosian": "frostdemon",
	"frieza": "frostdemon", "frieza_race": "frostdemon",
}
## Armor slot -> (bone, layer file suffix)
const ARMOR_BONES := {
	"head": [["armorHead", 1]],
	"chest": [["armorBody", 1], ["armorRightArm", 1], ["armorLeftArm", 1]],
	"legs": [["armorLeggingsBody", 2], ["armorRightLeg", 2], ["armorLeftLeg", 2]],
	"feet": [["armorRightBoot", 1], ["armorLeftBoot", 1]],
}
const ALL_ARMOR_BONES := [
	"armorHead", "armorBody", "armorLeggingsBody", "armorRightArm", "armorLeftArm",
	"armorRightLeg", "armorLeftLeg", "armorRightBoot", "armorLeftBoot",
]
const HAIR_MODEL := "entity/sagas/shadow_dummy"
static var HAIR_ROOT_BONES := PackedStringArray(["root", "waist", "head"])

## Hair styles are visibility sets over the 38 `hair*` bones of
## `entity/sagas/shadow_dummy.geo.json` (the only DMZ geometry that ships a
## generic, non-character hair rig - human.geo.json has no hair bones at all).
## Grouped by pivot: left cluster 1-7+12, left-back 8-10, back 13-18+33/34/37,
## right cluster 19-28, right-back 29-32+35/36, crown 11+23/24.
const HAIR_STYLES := {
	0: [],
	1: ["Vegetahair", "hair1", "hair2", "hair4", "hair12", "hair19", "hair26", "hair27"],
	2: ["Vegetahair", "hair1", "hair2", "hair3", "hair4", "hair5", "hair6", "hair7", "hair12",
		"hair19", "hair20", "hair21", "hair22", "hair25", "hair26", "hair27", "hair28"],
	3: ["hair11", "hair23", "hair24", "hair33", "hair34", "hair37", "hair13", "hair14"],
	4: ["hair8", "hair9", "hair10", "hair13", "hair14", "hair15", "hair16", "hair17", "hair18",
		"hair29", "hair30", "hair31", "hair32", "hair33", "hair34", "hair35", "hair36", "hair37"],
	5: ["Vegetahair", "hair1", "hair2", "hair3", "hair4", "hair5", "hair6", "hair7", "hair11",
		"hair12", "hair19", "hair20", "hair21", "hair22", "hair23", "hair24", "hair25", "hair26",
		"hair27", "hair28"],
	6: ["hair11", "hair23", "hair24", "hair34", "hair37", "hair7", "hair28"],
	7: ["Vegetahair", "hair1", "hair19", "hair13", "hair14", "hair33", "hair34", "hair37",
		"hair8", "hair9", "hair10", "hair29"],
}
const HAIR_STYLE_COUNT := 8

static var hd := false
static var _cache: Dictionary = {}          # key -> ImageTexture
static var _armor_cache: Dictionary = {}    # path -> Texture2D

# --- public API ---------------------------------------------------------------

static func race_dir(race_id: String) -> String:
	var r := race_id.to_lower()
	var def: Dictionary = Registry.race(r) if Registry != null else {}
	var explicit := String(def.get("skin_dir", ""))
	if explicit != "":
		return explicit
	return String(RACE_DIRS.get(r, "humansaiyan"))

static func cache_key(c: Dictionary) -> String:
	return "%s|%s|%d|%d|%s|%s|%s|%s|%s|%d|%d|%d|%d" % [
		String(c.get("race", "saiyan")), String(c.get("gender", "male")),
		int(c.get("body_type", 0)), int(c.get("hair_type", 1)),
		String(c.get("hair_color", "#222629")), String(c.get("eye_color", "#222629")),
		String(c.get("skin_color", "#ffd3c9")), String(c.get("skin_color2", "#572117")),
		String(c.get("skin_color3", "#ffd3c9")), int(c.get("eye_type", 0)),
		int(c.get("nose", 0)), int(c.get("mouth", 0)), int(c.get("tattoo", -1)),
	]

## Compose the character body texture (cached).
static func compose(character: Dictionary) -> ImageTexture:
	var key := cache_key(character)
	var cached: Variant = _cache.get(key)
	if cached != null:
		return cached
	var img := compose_image(character)
	var tex := ImageTexture.create_from_image(img)
	_cache[key] = tex
	return tex

static func compose_image(character: Dictionary) -> Image:
	var dir := race_dir(String(character.get("race", "saiyan")))
	var gender := String(character.get("gender", "male")).to_lower()
	var body := int(character.get("body_type", 0))
	var skin := _color(character.get("skin_color", "#ffd3c9"))
	var skin2 := _color(character.get("skin_color2", "#572117"))
	var skin3 := _color(character.get("skin_color3", "#ffd3c9"))
	var hair_col := _color(character.get("hair_color", "#222629"))
	var eye_col := _color(character.get("eye_color", "#222629"))
	var size := 64
	var layers := _body_layers(dir, gender, body)
	if layers.is_empty():
		layers = [["races/base", 1]]
	var first: Image = _load_image(String(layers[0][0]))
	if first != null:
		size = maxi(16, first.get_width())
	var buf := PackedByteArray()
	buf.resize(size * size * 4)
	buf.fill(0)
	for entry in layers:
		var tint := Color.WHITE
		match int(entry[1]):
			1: tint = skin
			2: tint = skin2
			3: tint = skin3
		_blend(buf, size, _load_image(String(entry[0])), tint)
	# face parts
	var eye := int(character.get("eye_type", 0))
	var face_dir := "races/%s/faces/%s" % [dir, dir]
	var sclera := _load_image("%s_eye_%d_0" % [face_dir, eye])
	if sclera == null:
		# bioandroid / some races use a different naming (base_eye_layer0)
		sclera = _load_image("races/%s/faces/base_eye_layer0" % dir)
		_blend(buf, size, sclera, Color.WHITE)
		_blend(buf, size, _load_image("races/%s/faces/base_eye_layer1" % dir), eye_col)
	else:
		_blend(buf, size, sclera, Color.WHITE)
		_blend(buf, size, _load_image("%s_eye_%d_1" % [face_dir, eye]), eye_col)
		_blend(buf, size, _load_image("%s_eye_%d_2" % [face_dir, eye]), eye_col)
		_blend(buf, size, _load_image("%s_eye_%d_3" % [face_dir, eye]), hair_col)
	_blend(buf, size, _load_image("%s_nose_%d" % [face_dir, int(character.get("nose", 0))]), skin)
	_blend(buf, size, _load_image("%s_mouth_%d" % [face_dir, int(character.get("mouth", 0))]), skin)
	var tattoo := int(character.get("tattoo", -1))
	if tattoo >= 0:
		_blend(buf, size, _load_image("races/tattoos/tattoo_%d" % tattoo), Color.WHITE)
	if int(character.get("hair_type", 1)) > 0:
		_blend(buf, size, _load_image("races/hair_base"), hair_col)
	return Image.create_from_data(size, size, false, Image.FORMAT_RGBA8, buf)

## Compose + apply to a model: body texture, hair attachment, tail/armor bones.
static func apply_to(model: BedrockModel, character: Dictionary, armor: Array = []) -> void:
	if model == null:
		return
	model.set_texture(compose(character))
	model.hide_layer_bones(ALL_ARMOR_BONES)
	if not bool(character.get("has_tail", false)):
		model.hide_layer_bones(["tail1", "tail2", "tail3", "tail4", "tail5", "tailenrolled"])
	attach_hair(model, character)
	apply_armor(model, armor)

## Build (or update) the 3D hair attachment on the model's head bone.
static func attach_hair(model: BedrockModel, character: Dictionary) -> Node3D:
	var head: Node3D = model.get_bone("head")
	if head == null:
		return null
	var hair_type := int(character.get("hair_type", 1))
	var existing: Node3D = head.get_node_or_null("Hair")
	var hm: BedrockModel = existing as BedrockModel
	if hm == null:
		if model.has_bone("pelo1") or model.has_bone("hair1"):
			# The model ships its own hair bones (saga/master characters).
			return null
		hm = BedrockModel.new()
		hm.name = "Hair"
		hm.set_nested(true)
		if not hm.load_geo(HAIR_MODEL):
			hm.queue_free()
			return null
		head.add_child(hm)
		hm.position = -model.pivots.get("head", Vector3(0, 24, 0))
	var style: Array = HAIR_STYLES.get(hair_type % HAIR_STYLE_COUNT, HAIR_STYLES[1])
	var keep := PackedStringArray()
	for n in style:
		keep.append(String(n))
	hm.show_only_bones(keep, HAIR_ROOT_BONES)
	var col := _color(character.get("hair_color", "#222629"))
	var tile := Textures.entity_texture("races/hair")
	for n in keep:
		hm.set_bone_material(n, tile, col, true)
	hm.visible = hair_type > 0
	return hm

static func hair_bones_for(hair_type: int) -> Array:
	return HAIR_STYLES.get(hair_type % HAIR_STYLE_COUNT, [])

## `armor` is an array of item ids or item definition dictionaries.
static func apply_armor(model: BedrockModel, armor: Array) -> void:
	for raw in armor:
		if raw == null:
			continue
		var def: Dictionary = raw if raw is Dictionary else Registry.item(String(raw))
		if def.is_empty():
			continue
		var a: Dictionary = def.get("armor", {})
		var slot := String(a.get("slot", ""))
		var layer := String(a.get("layer", def.get("id", "")))
		if slot == "" or layer == "":
			continue
		for pair in ARMOR_BONES.get(slot, []):
			var bone := String(pair[0])
			var tex := _armor_texture(layer, int(pair[1]))
			if tex == null:
				continue
			model.set_bone_visible(bone, true)
			model.set_bone_material(bone, tex, Color.WHITE, false)

## Form visuals: hair/eye colour, body tint, model scale (data/forms.json fields).
static func apply_form_visuals(model: BedrockModel, form_def: Dictionary) -> void:
	if model == null or form_def.is_empty():
		return
	var scaling := float(form_def.get("modelScaling", form_def.get("model_scaling", 1.0)))
	if scaling > 0.0:
		model.set_model_scale(model.model_scale if is_equal_approx(scaling, 1.0) else scaling)
	var hair_type := int(form_def.get("hairType", form_def.get("hair_type", -1)))
	var hair_color := String(form_def.get("hairColor", form_def.get("hair_color", "")))
	var eye_color := String(form_def.get("eyeColor", form_def.get("eye_color", "")))
	var body_tint := String(form_def.get("bodyColor", form_def.get("body_color", "")))
	var head: Node3D = model.get_bone("head")
	var hair: Node3D = head.get_node_or_null("Hair") if head != null else null
	if hair != null and hair is BedrockModel:
		var hm: BedrockModel = hair
		if hair_type >= 0:
			var keep := PackedStringArray()
			for n in _form_hair_bones(hair_type):
				keep.append(String(n))
			hm.show_only_bones(keep, HAIR_ROOT_BONES)
			hm.scale = Vector3.ONE * _form_hair_scale(hair_type)
			if hair_color != "":
				for n in keep:
					hm.set_bone_material(n, Textures.entity_texture("races/hair"), _color(hair_color), true)
	if body_tint != "":
		model.set_tint(_color(body_tint))
	if eye_color != "":
		pass    # eye colour lives in the composed texture; the caller recomposes

## `hairType` values used by forms.json: 0 base, 1 ssj, 2 ssj2, 3 ssj3, 4 ssj4/other.
## DMZ has no dedicated player ssj hair geometry, so the base spiky set is scaled
## up (and the long ssj3 set uses every bone) to approximate it.
static func _form_hair_bones(hair_type: int) -> Array:
	match hair_type:
		0: return HAIR_STYLES[1]
		1, 2: return HAIR_STYLES[5]
		3: return HAIR_STYLES[5] + HAIR_STYLES[4]
	return HAIR_STYLES[5]

static func _form_hair_scale(hair_type: int) -> float:
	match hair_type:
		1: return 1.12
		2: return 1.25
		3: return 1.55
	return 1.0

static func clear_cache() -> void:
	_cache.clear()

# --- internals ----------------------------------------------------------------

static func _body_layers(dir: String, gender: String, body: int) -> Array:
	# Returns [[texture path (relative to entity/), layer index], ...]
	var out: Array = []
	var candidates := [
		"races/%s/bodytype_%s_%d" % [dir, gender, body + 1],
		"races/%s/bodytype_%s_%d" % [dir, gender, body],
		"races/%s/bodytype_%d" % [dir, body],
		"races/%s/base_%d" % [dir, body],
	]
	for base in candidates:
		if _exists(base):
			out.append([base, 1])
			return out
		var found := false
		for l in range(1, 6):
			var p := "%s_layer%d" % [base, l]
			if _exists(p):
				out.append([p, l])
				found = true
		if found:
			return out
	return out

static func _exists(rel: String) -> bool:
	if hd and FileAccess.file_exists(TEX_DIR + "hd/" + rel + ".png"):
		return true
	return FileAccess.file_exists(TEX_DIR + rel + ".png")

static func _load_image(rel: String) -> Image:
	if not _exists(rel):
		return null
	var path := TEX_DIR + rel + ".png"
	if hd and FileAccess.file_exists(TEX_DIR + "hd/" + rel + ".png"):
		path = TEX_DIR + "hd/" + rel + ".png"
	var img: Image = null
	if ResourceLoader.exists(path):
		var tex: Texture2D = load(path)
		if tex != null:
			img = tex.get_image()
	if img == null:
		img = Image.load_from_file(path)
	if img == null:
		return null
	if img.is_compressed():
		img.decompress()
	if img.get_format() != Image.FORMAT_RGBA8:
		img.convert(Image.FORMAT_RGBA8)
	return img

## Multiply `src` by `tint` and alpha-blend it into the RGBA8 byte buffer.
static func _blend(buf: PackedByteArray, size: int, src: Image, tint: Color) -> void:
	if src == null:
		return
	var img := src
	if img.get_width() != size or img.get_height() != size:
		img = src.duplicate()
		img.resize(size, size, Image.INTERPOLATE_NEAREST)
	var sd := img.get_data()
	var n := mini(sd.size(), buf.size())
	var tr := tint.r
	var tg := tint.g
	var tb := tint.b
	var i := 0
	while i < n:
		var sa := sd[i + 3]
		if sa != 0:
			var r := int(sd[i] * tr)
			var g := int(sd[i + 1] * tg)
			var b := int(sd[i + 2] * tb)
			if sa == 255:
				buf[i] = r
				buf[i + 1] = g
				buf[i + 2] = b
				buf[i + 3] = 255
			else:
				var a := float(sa) / 255.0
				var ia := 1.0 - a
				buf[i] = int(r * a + buf[i] * ia)
				buf[i + 1] = int(g * a + buf[i + 1] * ia)
				buf[i + 2] = int(b * a + buf[i + 2] * ia)
				buf[i + 3] = maxi(int(sa), buf[i + 3])
		i += 4

static func _armor_texture(layer: String, index: int) -> Texture2D:
	var path := ARMOR_DIR + "%s_layer%d.png" % [layer, index]
	if _armor_cache.has(path):
		return _armor_cache[path]
	var tex: Texture2D = null
	if ResourceLoader.exists(path):
		tex = load(path)
	elif FileAccess.file_exists(path):
		var img := Image.load_from_file(path)
		if img != null:
			tex = ImageTexture.create_from_image(img)
	_armor_cache[path] = tex
	return tex

static func _color(v: Variant) -> Color:
	if v is Color:
		return v
	var s := String(v).strip_edges()
	if s == "":
		return Color.WHITE
	if s.begins_with("#") or s.is_valid_html_color():
		return Color.html(s)
	if s.is_valid_int():
		var i := int(s)
		return Color8((i >> 16) & 255, (i >> 8) & 255, i & 255)
	return Color.WHITE
