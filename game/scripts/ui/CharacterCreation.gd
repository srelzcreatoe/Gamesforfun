class_name CharacterCreation
extends ScreenBase
## Race / gender / class / body / hair / colours / name with a live 3D preview.
## Builds the profile through ProfileFactory and hands it to Game.start_world.

const HAIR_BUILDER := "res://scripts/entity/HairBuilder.gd"
const CLASSES := ["Warrior", "Martial Artist", "Ki Specialist", "Defender"]
const CLASS_IDS := ["warrior", "martial_artist", "ki_specialist", "defender"]
const GENDERS := ["Male", "Female"]
const COLOR_CHOICES := ["#FFD3C9", "#E8B18F", "#C68642", "#8D5524", "#7FBF7F", "#9AD6F2", "#E7A3E7", "#FFFFFF"]
const HAIR_CHOICES := ["#222629", "#4A2B10", "#B8860B", "#FFE066", "#C0392B", "#2E86C1", "#7D3C98", "#E5E7E9"]

var races: PackedStringArray = PackedStringArray()
var race_i := 0
var gender_i := 0
var class_i := 0
var body_i := 0
var hair_i := 1
var skin_c := 0
var hair_c := 0
var name_edit: LineEdit = null
var preview: CharacterPreview = null
var desc_label: Label = null
var world_info: Dictionary = {}
var slot := 1
## Every arrow row's value refresh, replayed by `_update()` so the labels always show the same
## index the preview model is built from (the race defaults change hair_i after the rows exist).
var _row_refresh: Array[Callable] = []

func _init() -> void:
	screen_name = "character_creation"

func build() -> void:
	world_info = args.get("world", {})
	slot = clampi(int(args.get("slot", int(world_info.get("slot", 1)))), 1, SaveSlots.COUNT)
	races = PackedStringArray(Registry.races.keys()) if Registry != null else PackedStringArray(["saiyan"])
	if races.is_empty():
		races = PackedStringArray(["saiyan"])
	race_i = clampi(races.find("saiyan"), 0, races.size() - 1)
	var body := dmz_page("Create Character", _panorama_for(races[race_i]), "big")
	var row := UiUtil.hbox(14.0 * s)
	row.size_flags_vertical = Control.SIZE_EXPAND_FILL
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(row)

	_row_refresh.clear()
	# left: preview
	var left := UiUtil.vbox(6.0 * s)
	var pw := clampf(size.x * 0.26, 170.0, 300.0)
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

	# right: options
	var opts := UiUtil.vbox(6.0 * s)
	opts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var scroll := UiUtil.scroll(opts)
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var opt_frame := UiUtil.dmz_frame(scroll, "big", 8.0)
	opt_frame.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	opt_frame.size_flags_vertical = Control.SIZE_EXPAND_FILL
	row.add_child(opt_frame)

	opts.add_child(UiUtil.label("Name", UiUtil.font_small(s), UiUtil.DIM_COLOR))
	name_edit = UiUtil.line_edit("Name", "Kakarot", 20)
	opts.add_child(name_edit)
	opts.add_child(_race_row())
	opts.add_child(_arrow_row("Gender", GENDERS, func() -> int: return gender_i,
		func(i: int) -> void: gender_i = i))
	opts.add_child(_arrow_row("Class", CLASSES, func() -> int: return class_i,
		func(i: int) -> void: class_i = i))
	opts.add_child(_arrow_row("Body type", ["A", "B", "C"], func() -> int: return body_i,
		func(i: int) -> void: body_i = i))
	opts.add_child(_arrow_row("Hair", _hair_labels(), func() -> int: return hair_i,
		func(i: int) -> void: hair_i = i))
	opts.add_child(_swatch_row("Skin", COLOR_CHOICES, func(i: int) -> void: skin_c = i; _update()))
	opts.add_child(_swatch_row("Hair colour", HAIR_CHOICES, func(i: int) -> void: hair_c = i; _update()))
	var footer := UiUtil.hbox(10.0 * s)
	footer.alignment = BoxContainer.ALIGNMENT_CENTER
	footer.add_child(UiUtil.button("Play", _start, 260.0 * s, 44.0 * s))
	footer.size_flags_vertical = Control.SIZE_SHRINK_END
	body.add_child(footer)
	_apply_race_defaults()
	_update()

## The race's own DMZ panorama as the backdrop (falls back to the saiyan one).
func _panorama_for(race_id: String) -> String:
	for name in [race_id + "_panorama", "saiyan_panorama"]:
		if ResourceLoader.exists("res://assets/textures/gui/background/%s_0.png" % name):
			return name
	return ""

func _swatch_row(text: String, colors: Array, on_pick: Callable) -> HBoxContainer:
	var row := UiUtil.hbox(6.0 * s)
	var l := UiUtil.label(text, UiUtil.font_small(s))
	l.custom_minimum_size.x = 110.0 * s
	l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(l)
	# A flow container so eight swatches wrap on a narrow canvas instead of running off the page.
	var wrap := HFlowContainer.new()
	wrap.add_theme_constant_override("h_separation", int(4.0 * s))
	wrap.add_theme_constant_override("v_separation", int(4.0 * s))
	wrap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(wrap)
	for i in colors.size():
		var b := Button.new()
		b.custom_minimum_size = Vector2(26.0 * s, 26.0 * s)
		b.focus_mode = Control.FOCUS_NONE
		var c := UiUtil.color_hex(String(colors[i]))
		b.add_theme_stylebox_override("normal", UiUtil.flat(c, Color(0, 0, 0, 0.6), 2.0, 0.0, 0.0))
		b.add_theme_stylebox_override("hover", UiUtil.flat(c, Color.WHITE, 2.0, 0.0, 0.0))
		b.add_theme_stylebox_override("pressed", UiUtil.flat(c, Color.WHITE, 3.0, 0.0, 0.0))
		var idx := i
		b.pressed.connect(func() -> void:
			UiUtil.click()
			on_pick.call(idx))
		wrap.add_child(b)
	return row

## "Label  < value >" with the DMZ character-sheet arrows.
func _arrow_row(text: String, options: Array, get_i: Callable, set_i: Callable,
		icon: Texture2D = null) -> HBoxContainer:
	var row := UiUtil.hbox(6.0 * s)
	var l := UiUtil.label(text, UiUtil.font_small(s))
	l.custom_minimum_size.x = 110.0 * s
	l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(l)
	var value := UiUtil.label("", UiUtil.font_body(s), Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
	value.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	value.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	# The icon rides *inside* the value cell, so the arrows line up in the same two columns on
	# every row (the race row used to push its right arrow out by the icon's width).
	var value_box := UiUtil.hbox(6.0 * s)
	value_box.custom_minimum_size.x = 150.0 * s
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

func _race_row() -> HBoxContainer:
	var names: Array = []
	for r in races:
		names.append(String(Registry.race(r).get("name", String(r).capitalize())))
	return _arrow_row("Race", names, func() -> int: return race_i, func(i: int) -> void:
		race_i = i
		_apply_race_defaults(), UiUtil.race_icon(String(races[race_i])))

func _apply_race_defaults() -> void:
	var r: Dictionary = Registry.race(races[race_i]) if Registry != null else {}
	var skin := String(r.get("defaultBodyColor", r.get("default_body_color", "#FFD3C9")))
	var hair := String(r.get("defaultHairColor", r.get("default_hair_color", "#222629")))
	var si := COLOR_CHOICES.find(skin)
	var hi := HAIR_CHOICES.find(hair)
	skin_c = si if si >= 0 else 0
	hair_c = hi if hi >= 0 else 0
	hair_i = clampi(int(r.get("defaultHairType", r.get("default_hair_type", 1))), 0, _hair_count() - 1)

## Every hair style the entity engineer's HairBuilder exposes (12 today), not a fixed six.
func _hair_count() -> int:
	if ResourceLoader.exists(HAIR_BUILDER):
		var hb: GDScript = load(HAIR_BUILDER)
		if hb != null and hb.has_method("style_count"):
			return clampi(int(hb.call("style_count")), 1, 24)
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
	var rid := String(races[race_i])
	var r: Dictionary = Registry.race(rid) if Registry != null else {}
	return {
		"name": name_edit.text.strip_edges() if name_edit != null else "Kakarot",
		"race": rid, "gender": GENDERS[gender_i].to_lower(), "class": CLASS_IDS[class_i],
		"body_type": body_i, "hair_type": hair_i,
		"hair_color": HAIR_CHOICES[hair_c], "skin_color": COLOR_CHOICES[skin_c],
		"skin_color2": COLOR_CHOICES[skin_c], "skin_color3": COLOR_CHOICES[skin_c],
		"eye_type": 0, "eye_color": String(r.get("defaultEye1Color", "#222629")),
		"nose": 0, "mouth": 0, "tattoo": 0,
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
		var r: Dictionary = Registry.race(races[race_i])
		desc_label.text = String(r.get("desc", ""))

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
