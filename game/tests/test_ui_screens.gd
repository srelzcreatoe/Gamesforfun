extends TestCase
## UiManager stack behaviour and that every screen scene instantiates and lays out.

const SCREENS := ["main_menu", "world_select", "create_world", "character_creation", "settings",
	"pause", "death", "inventory", "quests", "stats", "radial", "wish", "space_map", "loading"]

var ui: UiManager = null

func setup() -> void:
	Game.profile = ProfileFactory.new_profile("Tester", "saiyan", "male", "warrior")
	Game.world_info = {"name": "T", "slug": "__t", "seed": 1, "mode": "story", "difficulty": "normal",
		"planet": "earth", "keep_inventory": true, "transient": true}
	Game.paused_by_ui = false
	ui = load("res://scenes/ui/UiManager.tscn").instantiate()
	add_node(ui)

func teardown() -> void:
	if ui != null and is_instance_valid(ui):
		ui.close_all()
		ui.queue_free()
		ui = null
	Game.paused_by_ui = false
	Game.profile = {}
	Game.world_info = {}

func test_open_and_close_tracks_the_stack() -> void:
	assert_true(not ui.is_modal_open(), "nothing open")
	assert_true(ui.open("settings") != null, "settings opened")
	assert_true(ui.is_open("settings"), "is_open")
	assert_true(ui.is_modal_open(), "modal")
	assert_eq(ui.top_screen(), "settings", "top")
	assert_true(Game.paused_by_ui, "game paused by ui")
	ui.open("pause")
	assert_eq(ui.top_screen(), "pause", "pause on top")
	ui.close_top()
	assert_eq(ui.top_screen(), "settings", "back to settings")
	ui.close("settings")
	assert_true(not ui.is_modal_open(), "closed")
	assert_true(not Game.paused_by_ui, "unpaused")

func test_hud_is_never_modal() -> void:
	ui.show_hud(true)
	assert_true(ui.hud != null, "hud created")
	assert_true(not ui.is_modal_open(), "hud is not modal")
	assert_true(ui.hud.buttons.size() >= 16, "all HUD buttons exist: %d" % ui.hud.buttons.size())

func test_toggle_flips_a_screen() -> void:
	ui.toggle("stats")
	assert_true(ui.is_open("stats"), "opened")
	ui.toggle("stats")
	assert_true(not ui.is_open("stats"), "closed")

func test_reopening_a_screen_reuses_it() -> void:
	var a := ui.open("quests")
	var b := ui.open("quests")
	assert_eq(a, b, "same instance")
	assert_eq(ui.stack.size(), 1, "not stacked twice")

func test_unknown_screen_is_ignored() -> void:
	assert_eq(ui.open("not_a_screen"), null, "no crash")
	assert_true(not ui.is_modal_open(), "nothing opened")

func test_every_screen_instantiates_and_sizes() -> void:
	for name in SCREENS:
		var inst: Control = ui.open(name, {"dragon": "shenron"})
		assert_true(inst != null, "opened " + name)
		if inst == null:
			continue
		assert_true(inst.get_child_count() > 0, name + " built content")
		ui.close(name)

func test_hud_layout_places_widgets_inside_the_viewport() -> void:
	ui.show_hud(true)
	var hud: Hud = ui.hud
	hud.size = Vector2(1280, 720)
	hud.insets = Vector4.ZERO
	hud.s = 1.5
	hud.relayout()
	var bar := hud.hotbar_rect()
	assert_true(bar.position.x >= 0.0 and bar.end.x <= 1280.0, "hotbar inside: %s" % str(bar))
	assert_true(bar.end.y <= 720.0, "hotbar above the bottom edge")
	for id in hud.buttons.keys():
		var r := hud.button_rect(id)
		assert_true(r.size.x > 0.0, id + " has a size")
		assert_true(r.position.x >= -1.0 and r.end.x <= 1281.0, id + " inside horizontally: %s" % str(r))
		assert_true(r.position.y >= -1.0 and r.end.y <= 721.0, id + " inside vertically: %s" % str(r))

func test_hud_buttons_do_not_overlap() -> void:
	ui.show_hud(true)
	var hud: Hud = ui.hud
	hud.insets = Vector4.ZERO
	for sz in [Vector2(1280, 720), Vector2(1600, 720), Vector2(1024, 768), Vector2(854, 480)]:
		hud.size = sz
		hud.insets = Vector4.ZERO
		hud.s = clampf(sz.y / 480.0, 0.8, 3.0)
		hud.relayout()
		_assert_no_button_overlap(hud, sz)

func _assert_no_button_overlap(hud: Hud, sz: Vector2) -> void:
	var ids: Array = hud.buttons.keys()
	for i in ids.size():
		for j in range(i + 1, ids.size()):
			var a := hud.button_rect(ids[i])
			var b := hud.button_rect(ids[j])
			var overlap := a.grow(-2.0).intersects(b.grow(-2.0))
			assert_true(not overlap, "%s overlaps %s at %s (%s / %s)" % [ids[i], ids[j], str(sz), str(a), str(b)])
	var bar := hud.hotbar_rect()
	for id in ids:
		var r := hud.button_rect(id)
		assert_true(r.position.x >= -1.0 and r.end.x <= sz.x + 1.0, "%s inside %s: %s" % [id, str(sz), str(r)])
		assert_true(r.position.y >= -1.0 and r.end.y <= sz.y + 1.0, "%s inside %s: %s" % [id, str(sz), str(r)])
		assert_true(not r.grow(-2.0).intersects(bar.grow(-2.0)), "%s overlaps the hotbar at %s" % [id, str(sz)])

func test_hud_cancel_touches_clears_input() -> void:
	ui.show_hud(true)
	var hud: Hud = ui.hud
	hud.cancel_touches()
	assert_eq(hud._pointers.size(), 0, "pointers cleared")
	hud.set_input_enabled(false)
	assert_true(not hud.input_enabled, "input off")
	hud.set_input_enabled(true)
	assert_true(hud.input_enabled, "input on")

func test_toast_and_hint_do_not_throw() -> void:
	ui.toast("Title", "Body", null)
	ui.show_hint("Hello", 1.0)
	assert_true(ui.toasts != null, "toast layer present")

# --- character creation: every DMZ option is offered, and every arrow is tappable ----------

func _creation() -> CharacterCreation:
	var cc: CharacterCreation = ui.open("character_creation")
	cc.size = Vector2(1280, 720)
	cc.insets = Vector4.ZERO
	cc.rebuild()
	return cc

## Walks the option rows and returns {option_key: [left arrow, right arrow]}.
func _arrow_rows(root: Node, out := {}) -> Dictionary:
	if root is Control and (root as Control).has_meta("option_key"):
		var arrows: Array[Button] = []
		for c in root.get_children():
			if c is Button:
				arrows.append(c)
		out[String((root as Control).get_meta("option_key"))] = arrows
	for c in root.get_children():
		_arrow_rows(c, out)
	return out

func test_character_creation_offers_every_dmz_option() -> void:
	var cc := _creation()
	var rows := _arrow_rows(cc)
	for key in ["race", "gender", "class", "body_type", "hair_type", "eye_type", "nose", "mouth",
			"tattoo", "skin_color", "hair_color", "eye_color", "eye_color2"]:
		assert_true(rows.has(key), "saiyan creation has a %s row" % key)
	var ch := cc.character()
	for key in ["race", "gender", "class", "body_type", "hair_type", "eye_type", "nose", "mouth",
			"tattoo", "skin_color", "skin_color2", "skin_color3", "hair_color", "eye_color",
			"eye_color2"]:
		assert_true(ch.has(key), "character dict carries " + key)
	ui.close("character_creation")

func test_creation_arrows_are_touch_sized_and_change_the_value() -> void:
	var cc := _creation()
	var rows := _arrow_rows(cc)
	for key in rows.keys():
		if key == "race":
			continue        # the race arrow rebuilds the screen; covered separately below
		var arrows: Array = rows[key]
		assert_eq(arrows.size(), 2, "%s row has two arrows" % key)
		for b in arrows:
			var btn := b as Button
			assert_true(btn.size.x >= 48.0 and btn.size.y >= 48.0,
				"%s arrow is touch sized: %s" % [key, str(btn.size)])
			assert_true(btn.mouse_filter == Control.MOUSE_FILTER_STOP, "%s arrow takes input" % key)
			assert_true(btn.action_mode == BaseButton.ACTION_MODE_BUTTON_PRESS,
				"%s arrow fires on press" % key)
			assert_true(not btn.disabled, "%s arrow enabled" % key)
		var before: Variant = cc.character().get(key)
		arrows[1].emit_signal("pressed")
		assert_true(cc.character().get(key) != before,
			"%s changed on the right arrow (was %s)" % [key, str(before)])
		arrows[0].emit_signal("pressed")
		assert_eq(str(cc.character().get(key)), str(before), "%s came back on the left arrow" % key)
	ui.close("character_creation")

func test_creation_race_arrow_switches_race_and_rebuilds() -> void:
	var cc := _creation()
	var rows := _arrow_rows(cc)
	var first := String(cc.character()["race"])
	(rows["race"][1] as Button).emit_signal("pressed")
	assert_true(String(cc.character()["race"]) != first, "race changed")
	cc.rebuild()
	var again := _arrow_rows(cc)
	assert_true(again.has("body_type"), "rows rebuilt for the new race")
	# Namekian and frost demon ship extra body colour layers; a race that has them must offer them.
	while String(cc.character()["race"]) != "namekian":
		(again["race"][1] as Button).emit_signal("pressed")
		cc.rebuild()
		again = _arrow_rows(cc)
	assert_true(again.has("skin_color2"), "namekian offers its second body colour")
	assert_true(again.has("skin_color3"), "namekian offers its third body colour")
	ui.close("character_creation")

func test_creation_option_counts_match_the_dmz_textures() -> void:
	# Indices the arrows can reach must all resolve to a texture RaceSkin can compose.
	for race in ["saiyan", "namekian", "frostdemon", "majin", "bioandroid"]:
		assert_true(DmzOptions.body_types(race, "male") >= 1, race + " has a body type")
		assert_true(DmzOptions.eye_types(race) >= 1, race + " has an eye type")
		var layers := DmzOptions.body_color_layers(race, "male")
		assert_true(layers >= 1 and layers <= 3, "%s colour layers: %d" % [race, layers])
	assert_true(DmzOptions.eye_types("saiyan") > 1, "saiyan has several eye variants")
	assert_true(DmzOptions.noses("saiyan") > 1, "saiyan has several noses")
	assert_true(DmzOptions.mouths("saiyan") > 1, "saiyan has several mouths")
	assert_true(DmzOptions.body_color_layers("namekian", "male") == 3, "namekian tints 3 layers")
	assert_true(DmzOptions.tattoos() > 0, "tattoos exist")

func test_creation_fits_a_20_by_9_phone() -> void:
	var cc: CharacterCreation = ui.open("character_creation")
	for px in [Vector2(1280, 720), Vector2(1600, 720), Vector2(1024, 768)]:
		cc.size = px
		cc.insets = Vector4.ZERO
		cc.rebuild()
		var rows := _arrow_rows(cc)
		assert_true(rows.size() >= 12, "all rows built at %s" % str(px))
		for key in rows.keys():
			for b in rows[key]:
				var r := (b as Button).get_global_rect()
				assert_true(r.position.x >= -1.0 and r.end.x <= px.x + 1.0,
					"%s arrow inside %s: %s" % [key, str(px), str(r)])
	ui.close("character_creation")
