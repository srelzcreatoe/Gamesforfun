class_name MainMenu
extends ScreenBase
## Title screen: "DRAGON BLOCK SAGAS", a rotating race panorama and the main actions (spec §7).

const RACES := ["saiyan_panorama", "namekian_panorama", "frostdemon_panorama", "majin_panorama",
	"bioandroid_panorama", "human_panorama"]

var panorama: PanoramaCube = null
var _race_i := 0
var _swap_t := 12.0

func _init() -> void:
	screen_name = "main_menu"
	modal = false

func build() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	_race_i = randi() % RACES.size()
	panorama = PanoramaCube.new(size if size.x > 64.0 else Vector2(1280, 720), RACES[_race_i])
	panorama.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(panorama)
	var shade := ColorRect.new()
	shade.color = Color(0, 0, 0, 0.35)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(shade)

	var col := UiUtil.vbox(10.0 * s)
	col.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	add_child(col)
	content = col

	var t := UiUtil.label("DRAGON BLOCK SAGAS", UiUtil.font_title(s), Color(1.0, 0.86, 0.35), HORIZONTAL_ALIGNMENT_CENTER)
	col.add_child(t)
	col.add_child(UiUtil.label("A voxel Dragon Ball action RPG", UiUtil.font_small(s), UiUtil.DIM_COLOR, HORIZONTAL_ALIGNMENT_CENTER))
	col.add_child(UiUtil.spacer(16.0 * s))

	var bw := minf(360.0 * s, size.x * 0.6)
	var rows := UiUtil.vbox(8.0 * s)
	rows.alignment = BoxContainer.ALIGNMENT_CENTER
	var center := HBoxContainer.new()
	center.alignment = BoxContainer.ALIGNMENT_CENTER
	center.add_child(rows)
	col.add_child(center)
	rows.add_child(UiUtil.button("Play", _on_play, bw, 46.0 * s))
	rows.add_child(UiUtil.button("Settings", func() -> void: Game.ui.call("open", "settings"), bw, 46.0 * s))
	rows.add_child(UiUtil.button("How to Play", _on_help, bw, 46.0 * s))
	rows.add_child(UiUtil.button("Credits", _on_credits, bw, 46.0 * s))
	if not Game.is_mobile():
		rows.add_child(UiUtil.button("Quit", func() -> void: get_tree().quit(), bw, 46.0 * s))

	var ver := UiUtil.label("v%s" % Game.version, UiUtil.font_small(s), UiUtil.DIM_COLOR)
	ver.position = Vector2(12.0 * s + insets.x, size.y - 26.0 * s - insets.w)
	add_child(ver)
	Audio.play_bgm("menu")

func _on_play() -> void:
	SaveSlots.clear_active()
	Game.ui.call("open", "world_select")

func _on_help() -> void:
	var txt := "Move with the left stick. Drag the right side to look.\n" \
		+ "Hold on the world to mine, tap to place or talk.\n" \
		+ "Charge Ki, then tap Fly to take off. Tap Technique for the wheel.\n" \
		+ "Bag opens your pack and crafting. Quests and Stats are top right."
	_info_panel("How to Play", txt)

func _on_credits() -> void:
	var txt := "Dragon Block Sagas\n\nBuilt on Godot 4.\n" \
		+ "Content ported from DragonMineZ (GPL-3.0) and DMZ Plus.\n" \
		+ "HD textures: DMZ HD Texturepack (ZoneMC).\n" \
		+ "Blocks: Fused Vanilla pack (Fused Bolt).\n" \
		+ "Font: Monocraft (Idrees Hassan, OFL).\n" \
		+ "Particles: AAA Particles (ChloePrime, MIT)."
	_info_panel("Credits", txt)

func _info_panel(title: String, text: String) -> void:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_STOP
	UiUtil.dim_background(root, 0.6)
	var p := UiUtil.panel()
	var v := UiUtil.vbox(8.0 * s)
	v.add_child(UiUtil.label(title, UiUtil.font_body(s), UiUtil.TITLE_COLOR, HORIZONTAL_ALIGNMENT_CENTER))
	var l := UiUtil.label(text, UiUtil.font_small(s))
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = minf(520.0 * s, size.x - 80.0 * s)
	v.add_child(l)
	var h := HBoxContainer.new()
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_child(UiUtil.flat_button("Back", func() -> void: root.queue_free()))
	v.add_child(h)
	p.add_child(v)
	root.add_child(p)
	add_child(root)
	p.reset_size()
	p.position = (size - p.get_combined_minimum_size()) * 0.5

func _process(delta: float) -> void:
	_swap_t -= delta
	if _swap_t <= 0.0:
		_swap_t = 18.0
		_race_i = (_race_i + 1) % RACES.size()
		if panorama != null:
			panorama.set_prefix(RACES[_race_i])
