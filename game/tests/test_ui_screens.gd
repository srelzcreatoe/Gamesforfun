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
