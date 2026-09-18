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
## Hair is DragonMineZ's own strand hair: `HairBuilder` renders the mod's 27 hair
## presets (decoded from its hair codes into data/dmz_hair_presets.json), so a
## character's `hair_type` is a DMZ preset index, not one of our own styles.

static var hd := false
static var _cache: Dictionary = {}          # key -> ImageTexture
static var _armor_cache: Dictionary = {}    # path -> Texture2D

# --- public API ---------------------------------------------------------------

## Geometry every race's body uses. DMZ has no `entity/races/namekian.geo.json`:
## namekians (and every race without its own body) use the human rig, which is
## also what DMZ does - the antennae/ears come from `entity/raceparts.geo.json`.
## Callers should use this instead of hard-coding a path (a missing geo silently
## falls back to a stand-in figure).
const RACE_MODELS := {
	"human": "entity/races/human", "saiyan": "entity/races/human",
	"halfsaiyan": "entity/races/human", "half_saiyan": "entity/races/human",
	"namek": "entity/races/human", "namekian": "entity/races/human",
	"majin": "entity/races/majin", "buu": "entity/races/majin",
	"bioandroid": "entity/races/bioandroid", "android": "entity/races/human",
	"cell": "entity/races/bioandroid",
	"frostdemon": "entity/races/frostdemon", "coldemon": "entity/races/frostdemon",
	"arcosian": "entity/races/frostdemon", "frieza": "entity/races/frostdemon",
	"frieza_race": "entity/races/frostdemon",
}
const MODELS_DIR := "res://assets/models/"

## Body geometry for a race (optionally the slim variant for female bodies).
static func race_model(race_id: String, gender := "male", body_type := 0) -> String:
	var r := race_id.to_lower()
	var def: Dictionary = Registry.race(r) if Registry != null else {}
	var base := String(RACE_MODELS.get(r, "entity/races/human"))
	var explicit := String(def.get("model", ""))
	if explicit != "" and _model_exists(explicit):
		base = explicit
	if gender.to_lower() == "female" or body_type >= 3:
		var slim := base + "_slim"
		if _model_exists(slim):
			return slim
	return base if _model_exists(base) else "entity/races/human"

static func _model_exists(rel: String) -> bool:
	return FileAccess.file_exists(MODELS_DIR + rel + ".geo.json") or FileAccess.file_exists(MODELS_DIR + "hd/" + rel + ".geo.json")

## Character dictionaries come from the UI, a profile or entities.json, so every
## field is read through `_int()` / `_color()` and tolerates String / float input.
static func _int(v: Variant, fallback := 0) -> int:
	if v is int:
		return v
	if v is float:
		return int(v)
	if v is String:
		var t := String(v).strip_edges()
		return int(t) if t.is_valid_int() else (int(float(t)) if t.is_valid_float() else fallback)
	if v is bool:
		return 1 if v else 0
	return fallback

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
		_int(c.get("body_type"), 0), _int(c.get("hair_type"), 1),
		String(c.get("hair_color", "#222629")), String(c.get("eye_color", "#222629")),
		String(c.get("skin_color", "#ffd3c9")), String(c.get("skin_color2", "#572117")),
		String(c.get("skin_color3", "#ffd3c9")), _int(c.get("eye_type"), 0),
		_int(c.get("nose"), 0), _int(c.get("mouth"), 0), _int(c.get("tattoo"), -1),
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
	var body := _int(character.get("body_type"), 0)
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
	var eye := _int(character.get("eye_type"), 0)
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
	_blend(buf, size, _load_image("%s_nose_%d" % [face_dir, _int(character.get("nose"), 0)]), skin)
	_blend(buf, size, _load_image("%s_mouth_%d" % [face_dir, _int(character.get("mouth"), 0)]), skin)
	var tattoo := _int(character.get("tattoo"), -1)
	if tattoo >= 0:
		_blend(buf, size, _load_image("races/tattoos/tattoo_%d" % tattoo), Color.WHITE)
	if can_use_hair(character) and HairBuilder.has_hair(HairBuilder.style_id(_int(character.get("hair_type"), 1))):
		# DMZ paints a hair cap straight onto the head cube's skin. Keep it a shade
		# darker than the voxel strands that sit on top of it, otherwise the head
		# reads as one flat block of colour from behind.
		_blend(buf, size, _load_image("races/hair_base"), hair_col.darkened(0.3))
	return Image.create_from_data(size, size, false, Image.FORMAT_RGBA8, buf)

## Compose + apply to a model: body texture, hair attachment, tail/armor bones.
static func apply_to(model: BedrockModel, character: Dictionary, armor: Array = []) -> void:
	if model == null:
		return
	model.set_texture(compose(character))
	# CONTRACT: the composed character and its haircut stay on the model. Forms.gd
	# and TransformationDirector restore hair through `clear_form_hair(target)` for
	# entities they have no character dictionary for, and that reads these back.
	model.set_meta("character", character.duplicate(true))
	model.set_meta("base_hair_style", HairBuilder.style_id(_int(character.get("hair_type"), 1)))
	model.hide_layer_bones(ALL_ARMOR_BONES)
	if not bool(character.get("has_tail", false)):
		model.hide_layer_bones(["tail1", "tail2", "tail3", "tail4", "tail5", "tailenrolled"])
	attach_hair(model, character)
	apply_armor(model, armor)

## Build (or refresh) the voxel hair on the model's head bone.
static func attach_hair(model: BedrockModel, character: Dictionary) -> Node3D:
	if model == null:
		return null
	if model.has_bone("pelo1") or model.has_bone("hair1"):
		return null                 # saga/master models ship their own hair bones
	if not can_use_hair(character):
		return HairBuilder.attach(model, "", Color.WHITE)     # hides any old hair
	var hair_type := _int(character.get("hair_type"), 1)
	var style := HairBuilder.style_id(hair_type)
	var col := _color(character.get("hair_color", "#222629"))
	return HairBuilder.attach(model, style, col)

## HairManager.canUseHair: strand hair is for humans and saiyans (and female
## majins); the other races are bald or wear their own head geometry.
static func can_use_hair(character: Dictionary) -> bool:
	var race := String(character.get("race", "human")).to_lower()
	if HairBuilder.HAIR_RACES.has(race):
		return true
	return race == "majin" and String(character.get("gender", "male")).to_lower() == "female"

## Style id for a profile `hair_type` index (wraps like the character creation UI).
static func hair_style_id(hair_type: int) -> String:
	return HairBuilder.style_id(hair_type)

static func hair_style_count() -> int:
	return HairBuilder.style_count()

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

## Form visuals: hair set/colour, body tint and model scale (data/forms.json).
## `model` is duck-typed (Forms.gd may hand us a stub model) and everything is
## optional: a model with no hair rig only gets the scale and the tint.
## `modelScaling` is accepted as a float OR a 3 element array (forms.json stores
## vectors); the largest horizontal/vertical component wins, matching Forms.gd.
static func apply_form_visuals(model: Node3D, form_def: Dictionary) -> void:
	if model == null or form_def.is_empty():
		return
	var bm: BedrockModel = model as BedrockModel
	var scaling := form_scale(form_def)
	if bm != null:
		bm.set_form_scale(scaling)
	elif model.has_method("set_model_scale"):
		model.call("set_model_scale", scaling)
	var body_tint := String(form_def.get("bodyColor", form_def.get("body_color", "")))
	if body_tint != "" and model.has_method("set_tint"):
		model.call("set_tint", _color(body_tint))
	if bm == null:
		return
	set_form_hair(bm, form_def)

## Transformation hair: swap the GEOMETRY as well as the colour.
##
## `form_def` is a forms.json entry; its `hairType` is a string ("base", "ssj",
## "ssj2", "ssj3", "empty"; legacy integers still work) and `hairColor` is
## optional. "base" keeps the character's own haircut, "ssj"/"ssj2" derive a
## taller, more upright, gold version OF THAT haircut (so every style keeps its
## identity when it transforms) and "ssj3" swaps in the long mane.
##
## `target` may be the BedrockModel, or an entity that owns one (`model`), which
## is what `TransformationDirector` has at hand. Returns the hair node, or null
## when there is nothing to restyle (saga models with their own hair bones).
static func set_form_hair(target: Object, form_def: Dictionary) -> Node3D:
	var bm := _model_of(target)
	if bm == null or form_def.is_empty():
		return null
	if bm.has_bone("pelo1") or bm.has_bone("hair1") or bm.get_bone("head") == null:
		return null                 # saga / master models ship their own hair
	var hair_type: Variant = form_def.get("hairType", form_def.get("hair_type", ""))
	var hair_color := String(form_def.get("hairColor", form_def.get("hair_color", "")))
	if String(form_def.get("forcedHairCode", "")) == "" and str(hair_type).strip_edges() == "" 			and hair_color == "":
		return null                     # this form does not touch the hair
	var base := String(bm.get_meta("base_hair_style", HairBuilder.current_style(bm)))
	if base == "" or base.contains("@") or base.begins_with("forced:"):
		base = HairBuilder.style_id(_int(_character_of(bm).get("hair_type"), 1))
	bm.set_meta("base_hair_style", base)
	# a form can force one specific DMZ hair (SSJ4 does); otherwise the preset's
	# own SSJ / SSJ2 / SSJ3 variant is used
	var style := HairBuilder.forced_style_id(String(form_def.get("forcedHairCode", "")))
	if style == "":
		style = HairBuilder.form_style_id(base, hair_type)
	var col := HairBuilder.style_color(style, _color(hair_color) if hair_color != "" else _base_hair_color(bm))
	if hair_color != "":
		col = _color(hair_color)
	bm.set_meta("form_hair_color", col.to_html(false))
	return HairBuilder.attach(bm, style, col)

## Put the character's own haircut and colour back (form dropped).
static func clear_form_hair(target: Object, character: Dictionary = {}) -> Node3D:
	var bm := _model_of(target)
	if bm == null:
		return null
	var ch := character if not character.is_empty() else _character_of(bm)
	var base := String(bm.get_meta("base_hair_style", ""))
	if base == "":
		base = HairBuilder.style_id(_int(ch.get("hair_type"), 1))
	if bm.has_meta("form_hair_color"):
		bm.remove_meta("form_hair_color")
	return HairBuilder.attach(bm, base, _color(ch.get("hair_color", "#222629")))

static func _model_of(target: Object) -> BedrockModel:
	if target == null:
		return null
	var bm := target as BedrockModel
	if bm != null:
		return bm
	var inner: Variant = target.get("model")
	return inner as BedrockModel if inner != null else null

## The character dictionary the model was skinned with, when we stored one.
static func _character_of(bm: BedrockModel) -> Dictionary:
	var c: Variant = bm.get_meta("character", {}) if bm.has_meta("character") else {}
	return c if c is Dictionary else {}

static func _base_hair_color(bm: BedrockModel) -> Color:
	var ch := _character_of(bm)
	if ch.has("hair_color"):
		return _color(ch.get("hair_color"))
	return Color(0.13, 0.15, 0.16)

## forms.json `modelScaling`: float, [x, y] or [x, y, z]. Missing / invalid -> 1.0.
static func form_scale(form_def: Dictionary) -> float:
	var sc: Variant = form_def.get("modelScaling", form_def.get("model_scaling", 1.0))
	if sc is Array:
		var a: Array = sc
		var m := 0.0
		for v in a:
			if v is float or v is int:
				m = maxf(m, float(v))
		return m if m > 0.0 else 1.0
	if sc is float or sc is int:
		return float(sc) if float(sc) > 0.0 else 1.0
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
	if s.length() in [6, 8] and ("#" + s).is_valid_html_color():
		return Color.html("#" + s)
	if s.is_valid_int():
		var i := int(s)
		return Color8((i >> 16) & 255, (i >> 8) & 255, i & 255)
	return Color.WHITE
