class_name CreateWorld
extends ScreenBase
## New world setup: name, seed, mode, difficulty, keep inventory (spec §7).

var name_edit: LineEdit = null
var seed_edit: LineEdit = null
var mode_i := 0
var diff_i := 1
var keep_inv := true
var slot := 1

const MODES := ["Story", "Creative"]
const DIFFS := ["Easy", "Normal", "Hard"]

func _init() -> void:
	screen_name = "create_world"

func build() -> void:
	slot = int(args.get("slot", SaveSlots.first_empty()))
	if slot <= 0:
		slot = 1
	var body := page("New Game - Slot %d" % slot)
	var wrap := VBoxContainer.new()
	wrap.add_theme_constant_override("separation", int(8.0 * s))
	wrap.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	wrap.custom_minimum_size.x = minf(620.0 * s, size.x - 60.0 * s)
	body.add_child(UiUtil.scroll(wrap))

	wrap.add_child(UiUtil.label("World name", UiUtil.font_small(s), UiUtil.DIM_COLOR))
	name_edit = UiUtil.line_edit("New World", "New World", 28)
	wrap.add_child(name_edit)
	wrap.add_child(UiUtil.label("Seed (number or text, blank = random)", UiUtil.font_small(s), UiUtil.DIM_COLOR))
	seed_edit = UiUtil.line_edit("Seed", "", 24)
	wrap.add_child(seed_edit)
	wrap.add_child(UiUtil.option_row("Mode", MODES, mode_i, func(i: int) -> void: mode_i = i))
	wrap.add_child(UiUtil.option_row("Difficulty", DIFFS, diff_i, func(i: int) -> void: diff_i = i))
	wrap.add_child(UiUtil.check_row("Keep inventory on death", keep_inv, func(v: bool) -> void: keep_inv = v))
	wrap.add_child(UiUtil.spacer(10.0 * s))
	var h := UiUtil.hbox(10.0 * s)
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_child(UiUtil.button("Create", _create, 260.0 * s, 46.0 * s))
	wrap.add_child(h)

func _create() -> void:
	var info := SaveSlots.create(slot, name_edit.text, seed_edit.text,
		MODES[mode_i].to_lower(), DIFFS[diff_i].to_lower(), keep_inv)
	Game.ui.call("close", "create_world")
	Game.ui.call("open", "character_creation", {"world": info, "slot": slot})
