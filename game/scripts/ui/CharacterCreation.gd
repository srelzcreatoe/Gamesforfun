class_name CharacterCreation
extends ScreenBase
## The DragonMineZ character creator: race, gender, class, body type, hair, eyes, nose, mouth,
## tattoo and every colour layer the race uses, each on an arrow row with a live 3D preview.
## Builds the profile through ProfileFactory and hands it to Game.start_world.
##
## The set of rows is data driven: how many body types / eyes / noses / mouths a race has comes
## from DmzOptions (which probes the DMZ texture set), and a race without a second body colour
## layer or without gender variants simply has no row for it. Changing race therefore rebuilds
## the screen rather than just refreshing the labels.

const HAIR_BUILDER := "res://scripts/entity/HairBuilder.gd"
const CLASSES := ["Warrior", "Martial Artist", "Ki Specialist", "Defender"]
const CLASS_IDS := ["warrior", "martial_artist", "ki_specialist", "defender"]
const GENDERS := ["Male", "Female"]
const GENDER_IDS := ["male", "female"]
## Colour choices per row. The race's own default is inserted at the front when it is not
## already in the list, so index 0 is always "what DMZ ships for this race".
const SKIN_CHOICES := [
	"#FFD3C9", "#E8B18F", "#C68642", "#8D5524", "#5A3413", "#FFFFFF", "#E5E7E9",
	"#1FAA24", "#187600", "#80FF69", "#9FE321", "#FFA4FF", "#E7A3E7", "#9AD6F2",
	"#572117", "#FF86A6", "#E8A2FF", "#FF7600",
]
const HAIR_CHOICES := [
	"#222629", "#4A2B10", "#8D5524", "#B8860B", "#FFE066", "#C0392B", "#FF7600",
	"#2E86C1", "#7D3C98", "#8B1BCC", "#80FF69", "#187600", "#FFA4FF", "#E5E7E9", "#FFFFFF",
]
const EYE_CHOICES := [
	"#222629", "#2E2424", "#4A2B10", "#2E86C1", "#9AD6F2", "#1FAA24", "#80FF69",
	"#B40000", "#FF001D", "#F06F6E", "#7D3C98", "#FFE066", "#E5E7E9", "#FFFFFF",
]
## Colour rows need a wider value cell than the index rows (chip + hex).
const LABEL_W := 104.0
const VALUE_W := 132.0
const ARROW_W := 40.0

var races: PackedStringArray = PackedStringArray()
var race_i := 0
var gender_i := 0
var class_i := 0
var body_i := 0
var hair_i := 1
var eyes_i := 0
var nose_i := 0
var mouth_i := 0
var tattoo_i := -1
var skin_hex := "#FFD3C9"
var skin2_hex := "#572117"
var skin3_hex := "#FFD3C9"
var hair_hex := "#222629"
var eye1_hex := "#222629"
var eye2_hex := "#222629"
var name_edit: LineEdit = null
var preview: CharacterPreview = null
var desc_label: Label = null
var world_info: Dictionary = {}
var slot := 1
## Every arrow row's value refresh, replayed by `_update()` so the labels always show the same
## index the preview model is built from (the race defaults change the indices after the rows
## already exist).
var _row_refresh: Array[Callable] = []
## False until the first build has applied the starting race's defaults; a rebuild (resize,
## race change) must not reset the player's choices.
var _seeded := false

func _init() -> void:
	screen_name = "character_creation"

func build() -> void:
	world_info = args.get("world", {})
	slot = clampi(int(args.get("slot", int(world_info.get("slot", 1)))), 1, SaveSlots.COUNT)
	races = PackedStringArray(Registry.races.keys()) if Registry != null else PackedStringArray(["saiyan"])
	if races.is_empty():
		races = PackedStringArray(["saiyan"])
	if not _seeded:
		race_i = clampi(races.find("saiyan"), 0, races.size() - 1)
		_apply_race_defaults()
		_seeded = true
	race_i = clampi(race_i, 0, races.size() - 1)
	var body := dmz_page("Create Character", _panorama_for(races[race_i]), "big")
	var row := UiUtil.hbox(14.0 * s)
	row.size_flags_vertical = Control.SIZE_EXPAND_FILL
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(row)

	_row_refresh.clear()
	# left: preview
	var left := UiUtil.vbox(6.0 * s)
	var pw := clampf(size.x * 0.24, 170.0, 300.0)
	var ph := minf(pw * 1.40, size.y * 0.44)
	var box := Control.new()
	box.custom_minimum_size = Vector2(pw, ph)
	preview = CharacterPreview.new(Vector2(pw, ph))
	preview.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	box.add_child(preview)
	var frame := UiUtil.dmz_frame(box, "small", 5.0)
	frame.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	frame.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	left.add_child(frame)
	desc_label = UiUtil.dim("", UiUtil.font_small(s))
	desc_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	desc_label.custom_minimum_size.x = pw
	var desc_scroll := UiUtil.scroll(desc_label, Vector2(pw, 92.0 * s))
	desc_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	left.add_child(UiUtil.dmz_frame(desc_scroll, "small", 6.0))
	row.add_child(left)

	# right: the option rows, in one or two columns depending on how wide the screen is
	var opts := _option_area(maxf(size.x - pw - 90.0 * s, 200.0), _option_rows())
	var opt_frame := UiUtil.dmz_frame(opts, "big", 8.0)
	opt_frame.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	opt_frame.size_flags_vertical = Control.SIZE_EXPAND_FILL
	row.add_child(opt_frame)

	var footer := UiUtil.hbox(10.0 * s)
	footer.alignment = BoxContainer.ALIGNMENT_CENTER
	footer.add_child(UiUtil.button("Play", _start, 260.0 * s, 44.0 * s))
	footer.size_flags_vertical = Control.SIZE_SHRINK_END
	body.add_child(footer)
	_update()

## Every row the current race offers, in DMZ's own order.
func _option_rows() -> Array[Control]:
	var rid := String(races[race_i])
	var gid := _gender_id()
	var out: Array[Control] = []
	var name_row := UiUtil.hbox(6.0 * s)
	var nl := UiUtil.label("Name", UiUtil.font_small(s))
	nl.custom_minimum_size.x = LABEL_W * s
	nl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	name_row.add_child(nl)
	name_edit = UiUtil.line_edit("Name", name_edit.text if name_edit != null else "Kakarot", 20)
	name_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_row.add_child(name_edit)
	out.append(name_row)
	out.append(_race_row())
	if _race_has_gender(rid):
		out.append(_arrow_row("Gender", "gender", GENDERS, func() -> int: return gender_i,
			func(i: int) -> void: gender_i = i))
	out.append(_arrow_row("Class", "class", CLASSES, func() -> int: return class_i,
		func(i: int) -> void: class_i = i))
	out.append(_arrow_row("Body type", "body_type", _numbered("Type", DmzOptions.body_types(rid, gid)),
		func() -> int: return body_i, func(i: int) -> void: body_i = i))
	out.append(_arrow_row("Hair", "hair_type", _hair_labels(), func() -> int: return hair_i,
		func(i: int) -> void: hair_i = i))
	out.append(_arrow_row("Eyes", "eye_type", _numbered("Eyes", DmzOptions.eye_types(rid)),
		func() -> int: return eyes_i, func(i: int) -> void: eyes_i = i))
	var noses := DmzOptions.noses(rid)
	if noses > 1:
		out.append(_arrow_row("Nose", "nose", _numbered("Nose", noses),
			func() -> int: return nose_i, func(i: int) -> void: nose_i = i))
	var mouths := DmzOptions.mouths(rid)
	if mouths > 1:
		out.append(_arrow_row("Mouth", "mouth", _numbered("Mouth", mouths),
			func() -> int: return mouth_i, func(i: int) -> void: mouth_i = i))
	var tattoos := DmzOptions.tattoos()
	if tattoos > 0:
		var tlabels: Array = ["None"]
		tlabels.append_array(_numbered("Tattoo", tattoos))
		# `tattoo` is -1 for none, so the row index is one ahead of the character value.
		out.append(_arrow_row("Tattoo", "tattoo", tlabels, func() -> int: return tattoo_i + 1,
			func(i: int) -> void: tattoo_i = i - 1))
	var layers := DmzOptions.body_color_layers(rid, gid)
	out.append(_color_row("Skin" if layers < 2 else "Skin 1", "skin_color", SKIN_CHOICES,
		func() -> String: return skin_hex, func(hex: String) -> void: skin_hex = hex))
	if layers >= 2:
		out.append(_color_row("Skin 2", "skin_color2", SKIN_CHOICES,
			func() -> String: return skin2_hex, func(hex: String) -> void: skin2_hex = hex))
	if layers >= 3:
		out.append(_color_row("Skin 3", "skin_color3", SKIN_CHOICES,
			func() -> String: return skin3_hex, func(hex: String) -> void: skin3_hex = hex))
	out.append(_color_row("Hair colour", "hair_color", HAIR_CHOICES,
		func() -> String: return hair_hex, func(hex: String) -> void: hair_hex = hex))
	out.append(_color_row("Eye colour 1", "eye_color", EYE_CHOICES,
		func() -> String: return eye1_hex, func(hex: String) -> void: eye1_hex = hex))
	out.append(_color_row("Eye colour 2", "eye_color2", EYE_CHOICES,
		func() -> String: return eye2_hex, func(hex: String) -> void: eye2_hex = hex))
	return out

## One scrolling column, or two side by side when the screen is wide enough for them (a 20:9
## phone in landscape has the width for two but only ~8 rows of height).
func _option_area(avail_w: float, rows: Array[Control]) -> Control:
	var col_min := (LABEL_W + VALUE_W + 2.0 * ARROW_W + 24.0) * s
	var columns := 2 if (rows.size() > 6 and avail_w >= col_min * 2.1) else 1
	var holder: Control
	if columns == 1:
		var one := UiUtil.vbox(6.0 * s)
		for r in rows:
			one.add_child(r)
		holder = one
	else:
		var pair := UiUtil.hbox(14.0 * s)
		var per := int(ceil(float(rows.size()) / 2.0))
		for c in 2:
			var col := UiUtil.vbox(6.0 * s)
			col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			for i in range(c * per, mini((c + 1) * per, rows.size())):
				col.add_child(rows[i])
			pair.add_child(col)
		holder = pair
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var scroll := UiUtil.scroll(holder)
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return scroll

## The race's own DMZ panorama as the backdrop (falls back to the saiyan one).
func _panorama_for(race_id: String) -> String:
	for name in [race_id + "_panorama", "saiyan_panorama"]:
		if ResourceLoader.exists("res://assets/textures/gui/background/%s_0.png" % name):
			return name
	return ""

func _numbered(word: String, count: int) -> Array:
	var out: Array = []
	for i in maxi(1, count):
		out.append("%s %d" % [word, i + 1])
	return out

## "Label  < value >" with the DMZ character-sheet arrows. `key` is the character field the row
## drives; it is stored on the row so the touch test can walk them.
func _arrow_row(text: String, key: String, options: Array, get_i: Callable, set_i: Callable,
		icon: Texture2D = null) -> HBoxContainer:
	var row := UiUtil.hbox(6.0 * s)
	row.set_meta("option_key", key)
	var l := UiUtil.label(text, UiUtil.font_small(s))
	l.custom_minimum_size.x = LABEL_W * s
	l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(l)
	var value := UiUtil.label("", UiUtil.font_small(s), Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
	value.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	value.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	value.clip_text = true
	# The icon rides *inside* the value cell, so the arrows line up in the same two columns on
	# every row (the race row used to push its right arrow out by the icon's width).
	var value_box := UiUtil.hbox(6.0 * s)
	value_box.custom_minimum_size.x = VALUE_W * s
	value_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var pic: TextureRect = null
	if icon != null:
		pic = UiUtil.icon_rect(icon, Vector2(26.0 * s, 26.0 * s))
		pic.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		value_box.add_child(pic)
	value_box.add_child(value)
	var refresh := func() -> void:
		var i: int = int(get_i.call())
		value.text = String(options[posmod(i, options.size())]) if options.size() > 0 else ""
		if pic != null:
			pic.texture = UiUtil.race_icon(String(races[clampi(race_i, 0, races.size() - 1)]))
	_row_refresh.append(refresh)
	var step := func(d: int) -> void:
		if options.is_empty():
			return
		set_i.call(posmod(int(get_i.call()) + d, options.size()))
		refresh.call()
		_update()
	row.add_child(UiUtil.arrow_button(-1, func() -> void: step.call(-1)))
	row.add_child(value_box)
	row.add_child(UiUtil.arrow_button(1, func() -> void: step.call(1)))
	refresh.call()
	return row

## A colour arrow row: the value cell shows the swatch and its hex, the arrows walk `choices`
## (with the race's own default inserted first).
func _color_row(text: String, key: String, choices: Array, get_hex: Callable,
		set_hex: Callable) -> HBoxContainer:
	var palette := _palette_for(choices, String(get_hex.call()))
	var row := UiUtil.hbox(6.0 * s)
	row.set_meta("option_key", key)
	var l := UiUtil.label(text, UiUtil.font_small(s))
	l.custom_minimum_size.x = LABEL_W * s
	l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(l)
	var chip := Panel.new()
	chip.custom_minimum_size = Vector2(26.0 * s, 26.0 * s)
	chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var hex_label := UiUtil.label("", UiUtil.font_small(s), Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
	hex_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hex_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	hex_label.clip_text = true
	var value_box := UiUtil.hbox(6.0 * s)
	value_box.custom_minimum_size.x = VALUE_W * s
	value_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	value_box.add_child(chip)
	value_box.add_child(hex_label)
	var refresh := func() -> void:
		var hex := String(get_hex.call())
		chip.add_theme_stylebox_override("panel", UiUtil.flat(UiUtil.color_hex(hex),
			Color(0, 0, 0, 0.7), 2.0 * s, 0.0, 0.0))
		hex_label.text = hex.to_upper()
	_row_refresh.append(refresh)
	var step := func(d: int) -> void:
		var i := palette.find(String(get_hex.call()))
		set_hex.call(String(palette[posmod((i if i >= 0 else 0) + d, palette.size())]))
		refresh.call()
		_update()
	row.add_child(UiUtil.arrow_button(-1, func() -> void: step.call(-1)))
	row.add_child(value_box)
	row.add_child(UiUtil.arrow_button(1, func() -> void: step.call(1)))
	refresh.call()
	return row

func _palette_for(choices: Array, current: String) -> Array:
	var out: Array = choices.duplicate()
	var has := false
	for c in out:
		if String(c).to_lower() == current.to_lower():
			has = true
			break
	if not has and current != "":
		out.insert(0, current)
	return out

func _race_row() -> HBoxContainer:
	var names: Array = []
	for r in races:
		names.append(String(Registry.race(r).get("name", String(r).capitalize())))
	return _arrow_row("Race", "race", names, func() -> int: return race_i, func(i: int) -> void:
		race_i = i
		_apply_race_defaults()
		# The row *set* depends on the race (gender, nose/mouth, extra colour layers), so the
		# screen is rebuilt rather than merely refreshed.
		call_deferred("rebuild"), UiUtil.race_icon(String(races[race_i])))

func _race_def() -> Dictionary:
	return Registry.race(races[clampi(race_i, 0, races.size() - 1)]) if Registry != null else {}

func _race_has_gender(race_id: String) -> bool:
	var r: Dictionary = Registry.race(race_id) if Registry != null else {}
	return bool(r.get("hasGender", r.get("has_gender", true)))

func _gender_id() -> String:
	return GENDER_IDS[clampi(gender_i, 0, GENDER_IDS.size() - 1)]

## Reset every option to what races.json ships for this race, clamped to the variants the
## race's textures actually have.
func _apply_race_defaults() -> void:
	var rid := String(races[clampi(race_i, 0, races.size() - 1)])
	var r: Dictionary = _race_def()
	if not _race_has_gender(rid):
		gender_i = 0
	var gid := _gender_id()
	body_i = clampi(_def(r, "defaultBodyType", 0), 0, DmzOptions.body_types(rid, gid) - 1)
	hair_i = clampi(_def(r, "defaultHairType", 1), 0, _hair_count() - 1)
	eyes_i = clampi(_def(r, "defaultEyesType", 0), 0, DmzOptions.eye_types(rid) - 1)
	nose_i = clampi(_def(r, "defaultNoseType", 0), 0, maxi(1, DmzOptions.noses(rid)) - 1)
	mouth_i = clampi(_def(r, "defaultMouthType", 0), 0, maxi(1, DmzOptions.mouths(rid)) - 1)
	tattoo_i = clampi(_def(r, "defaultTattooType", -1), -1, DmzOptions.tattoos() - 1)
	skin_hex = String(r.get("defaultBodyColor", r.get("default_body_color", "#FFD3C9")))
	skin2_hex = String(r.get("defaultBodyColor2", skin_hex))
	skin3_hex = String(r.get("defaultBodyColor3", skin_hex))
	hair_hex = String(r.get("defaultHairColor", r.get("default_hair_color", "#222629")))
	eye1_hex = String(r.get("defaultEye1Color", "#222629"))
	eye2_hex = String(r.get("defaultEye2Color", eye1_hex))

## races.json uses camelCase; older data files used snake_case.
func _def(r: Dictionary, key: String, fallback: int) -> int:
	var snake := ""
	for i in key.length():
		var ch := key[i]
		snake += ("_" + ch.to_lower()) if ch == ch.to_upper() and ch != ch.to_lower() else ch
	return int(r.get(key, r.get(snake, fallback)))

## Every hair style the entity engineer's HairBuilder exposes (the DMZ presets), not a fixed six.
func _hair_count() -> int:
	if ResourceLoader.exists(HAIR_BUILDER):
		var hb: GDScript = load(HAIR_BUILDER)
		if hb != null and hb.has_method("style_count"):
			return clampi(int(hb.call("style_count")), 1, 64)
	return 6

func _hair_labels() -> Array:
	var out: Array = []
	var hb: GDScript = load(HAIR_BUILDER) if ResourceLoader.exists(HAIR_BUILDER) else null
	var named: bool = hb != null and hb.has_method("style_name") and hb.has_method("style_id")
	for i in _hair_count():
		var name := ""
		if named:
			name = String(hb.call("style_name", String(hb.call("style_id", i))))
		out.append(name if name != "" else str(i + 1))
	return out

func character() -> Dictionary:
	var rid := String(races[clampi(race_i, 0, races.size() - 1)])
	var r: Dictionary = _race_def()
	return {
		"name": name_edit.text.strip_edges() if name_edit != null else "Kakarot",
		"race": rid, "gender": _gender_id(), "class": CLASS_IDS[class_i],
		"body_type": body_i, "hair_type": hair_i,
		"hair_color": hair_hex, "skin_color": skin_hex,
		"skin_color2": skin2_hex, "skin_color3": skin3_hex,
		"eye_type": eyes_i, "eye_color": eye1_hex, "eye_color2": eye2_hex,
		"nose": nose_i, "mouth": mouth_i, "tattoo": tattoo_i,
		"aura_color": String(r.get("defaultAuraColor", "#7FFFFF")),
	}

func _update() -> void:
	for r in _row_refresh:
		if r.is_valid():
			r.call()
	if preview != null:
		preview.set_character(character())
		preview.call_deferred("frame_camera")
	_sync_panorama()
	if desc_label != null and Registry != null:
		desc_label.text = String(_race_def().get("desc", ""))

## Swap the backdrop panorama when the player flips to another race.
func _sync_panorama() -> void:
	var want := _panorama_for(String(races[clampi(race_i, 0, races.size() - 1)]))
	for c in get_children():
		if c is PanoramaCube and want != "":
			(c as PanoramaCube).set_prefix(want)
			return

func _start() -> void:
	var ch := character()
	var prof := ProfileFactory.new_profile(String(ch["name"]), String(ch["race"]), String(ch["gender"]), String(ch["class"]))
	for key in ch.keys():
		prof["character"][key] = ch[key]
	var info: Dictionary = world_info
	if info.is_empty():
		info = SaveSlots.create(slot, "New World", "", "story", "normal", true)
	prof["position"]["planet"] = String(info.get("planet", "earth"))
	prof["spawn"]["planet"] = String(info.get("planet", "earth"))
	SaveSlots.write_profile(slot, prof)
	SaveSlots.load_slot(slot)
	Game.ui.call("close", "character_creation")
	Game.ui.call("close", "world_select")
	info["slot"] = slot
	Game.start_world(info, prof)
