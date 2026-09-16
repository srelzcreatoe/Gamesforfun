class_name CharacterCreation
extends ScreenBase
## Race / gender / class / body / hair / colours / name with a live 3D preview.
## Builds the profile through ProfileFactory and hands it to Game.start_world.

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

func _init() -> void:
	screen_name = "character_creation"

func build() -> void:
	world_info = args.get("world", {})
	races = PackedStringArray(Registry.races.keys()) if Registry != null else PackedStringArray(["saiyan"])
	if races.is_empty():
		races = PackedStringArray(["saiyan"])
	race_i = clampi(races.find("saiyan"), 0, races.size() - 1)
	var body := page("Create Character")
	var row := UiUtil.hbox(14.0 * s)
	row.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(row)

	# left: preview
	var left := UiUtil.vbox(6.0 * s)
	var pw := minf(260.0 * s, size.x * 0.28)
	preview = CharacterPreview.new(Vector2(pw, pw * 1.45))
	left.add_child(preview)
	desc_label = UiUtil.dim("", UiUtil.font_small(s))
	desc_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	desc_label.custom_minimum_size = Vector2(pw, 120.0 * s)
	left.add_child(desc_label)
	row.add_child(left)

	# right: options
	var opts := UiUtil.vbox(6.0 * s)
	opts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var scroll := UiUtil.scroll(opts)
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(scroll)

	opts.add_child(UiUtil.label("Name", UiUtil.font_small(s), UiUtil.DIM_COLOR))
	name_edit = UiUtil.line_edit("Name", "Kakarot", 20)
	opts.add_child(name_edit)
	var race_names: Array = []
	for r in races:
		race_names.append(String(Registry.race(r).get("name", String(r).capitalize())))
	opts.add_child(UiUtil.option_row("Race", race_names, race_i, func(i: int) -> void:
		race_i = i
		_apply_race_defaults()
		_update()))
	opts.add_child(UiUtil.option_row("Gender", GENDERS, gender_i, func(i: int) -> void: gender_i = i; _update()))
	opts.add_child(UiUtil.option_row("Class", CLASSES, class_i, func(i: int) -> void: class_i = i; _update()))
	opts.add_child(UiUtil.option_row("Body type", ["A", "B", "C"], body_i, func(i: int) -> void: body_i = i; _update()))
	opts.add_child(UiUtil.option_row("Hair", ["1", "2", "3", "4", "5", "6"], hair_i, func(i: int) -> void: hair_i = i; _update()))
	opts.add_child(_swatch_row("Skin", COLOR_CHOICES, func(i: int) -> void: skin_c = i; _update()))
	opts.add_child(_swatch_row("Hair colour", HAIR_CHOICES, func(i: int) -> void: hair_c = i; _update()))
	opts.add_child(UiUtil.spacer(10.0 * s))
	var h := UiUtil.hbox(10.0 * s)
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_child(UiUtil.button("Play", _start, 240.0 * s, 46.0 * s))
	opts.add_child(h)
	_apply_race_defaults()
	_update()

func _swatch_row(text: String, colors: Array, on_pick: Callable) -> HBoxContainer:
	var row := UiUtil.hbox(6.0 * s)
	var l := UiUtil.label(text, UiUtil.font_small(s))
	l.custom_minimum_size.x = 150.0 * s
	row.add_child(l)
	for i in colors.size():
		var b := Button.new()
		b.custom_minimum_size = Vector2(30.0 * s, 30.0 * s)
		b.focus_mode = Control.FOCUS_NONE
		var c := UiUtil.color_hex(String(colors[i]))
		b.add_theme_stylebox_override("normal", UiUtil.flat(c, Color(0, 0, 0, 0.6), 2.0, 0.0, 0.0))
		b.add_theme_stylebox_override("hover", UiUtil.flat(c, Color.WHITE, 2.0, 0.0, 0.0))
		b.add_theme_stylebox_override("pressed", UiUtil.flat(c, Color.WHITE, 3.0, 0.0, 0.0))
		var idx := i
		b.pressed.connect(func() -> void:
			UiUtil.click()
			on_pick.call(idx))
		row.add_child(b)
	return row

func _apply_race_defaults() -> void:
	var r: Dictionary = Registry.race(races[race_i]) if Registry != null else {}
	var skin := String(r.get("defaultBodyColor", r.get("default_body_color", "#FFD3C9")))
	var hair := String(r.get("defaultHairColor", r.get("default_hair_color", "#222629")))
	var si := COLOR_CHOICES.find(skin)
	var hi := HAIR_CHOICES.find(hair)
	skin_c = si if si >= 0 else 0
	hair_c = hi if hi >= 0 else 0
	hair_i = clampi(int(r.get("defaultHairType", r.get("default_hair_type", 1))), 0, 5)

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
	if preview != null:
		preview.set_character(character())
	if desc_label != null and Registry != null:
		var r: Dictionary = Registry.race(races[race_i])
		desc_label.text = String(r.get("desc", ""))

func _start() -> void:
	var ch := character()
	var prof := ProfileFactory.new_profile(String(ch["name"]), String(ch["race"]), String(ch["gender"]), String(ch["class"]))
	for key in ch.keys():
		prof["character"][key] = ch[key]
	var info: Dictionary = world_info
	if info.is_empty():
		info = Game.create_world("New World", "", "story", "normal")
	prof["position"]["planet"] = String(info.get("planet", "earth"))
	prof["spawn"]["planet"] = String(info.get("planet", "earth"))
	JsonUtil.save_file(Game.world_dir(String(info["slug"])).path_join("profile.json"), prof, false)
	Game.ui.call("close", "character_creation")
	Game.ui.call("close", "world_select")
	Game.start_world(info, prof)
