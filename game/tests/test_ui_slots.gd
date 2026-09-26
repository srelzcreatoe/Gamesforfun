extends TestCase
## Three save slots: listing, creation, copy, delete and per-slot settings isolation.

var _ui_backup: Node = null

func setup() -> void:
	# Screens opened by other test files are only queue_free()d, so they are still connected to
	# Events.settings_changed while this file runs. Detach the UI manager so their rebuilds
	# cannot touch Game.settings mid-test.
	if Game != null:
		_ui_backup = Game.ui
		if _ui_backup != null and _ui_backup.has_method("close_all"):
			_ui_backup.call("close_all")
		Game.ui = null
	UiUtil.ensure_ui_settings()
	_wipe()

func teardown() -> void:
	_wipe()
	SaveSlots.clear_active()
	if Game != null and _ui_backup != null and is_instance_valid(_ui_backup):
		Game.ui = _ui_backup

func _wipe() -> void:
	for i in range(1, SaveSlots.COUNT + 1):
		SaveSlots.delete_slot(i)

func test_there_are_exactly_three_slots() -> void:
	assert_eq(SaveSlots.COUNT, 3, "three slots")
	assert_eq(SaveSlots.list().size(), 3, "three rows")

func test_empty_slots_report_unused() -> void:
	for row in SaveSlots.list():
		assert_true(not bool(row["used"]), "slot %d empty" % int(row["index"]))
		assert_eq(int(row["level"]), 0, "no level")
	assert_eq(SaveSlots.first_empty(), 1, "first empty is 1")

func test_create_fills_the_slot_and_uses_its_own_slug() -> void:
	var info := SaveSlots.create(2, "Kame House", "1234", "story", "hard", false)
	assert_eq(String(info["slug"]), SaveSlots.slug(2), "fixed slug")
	assert_eq(int(info["seed"]), 1234, "seed")
	assert_eq(String(info["difficulty"]), "hard", "difficulty")
	assert_true(not bool(info["keep_inventory"]), "keep inventory off")
	assert_true(SaveSlots.is_used(2), "slot 2 used")
	assert_true(not SaveSlots.is_used(1), "slot 1 still empty")
	assert_eq(SaveSlots.first_empty(), 1, "1 is still the first empty")

func test_profile_shows_up_on_the_card() -> void:
	SaveSlots.create(1, "Test", "7", "story", "normal", true)
	var prof := ProfileFactory.new_profile("Kakarot", "saiyan", "male", "warrior")
	prof["play_time"] = 3725.0
	SaveSlots.write_profile(1, prof)
	var row: Dictionary = SaveSlots.list()[0]
	assert_true(bool(row["used"]), "used")
	assert_eq(String(row["name"]), "Kakarot", "name")
	assert_eq(String(row["race"]), "Saiyan", "race")
	assert_true(int(row["level"]) >= 1, "level computed")
	assert_eq(SaveSlots.format_play_time(float(row["play_time"])), "1h 2m", "play time")

func test_play_time_formats() -> void:
	assert_eq(SaveSlots.format_play_time(0.0), "0s", "zero")
	assert_eq(SaveSlots.format_play_time(45.0), "45s", "seconds")
	assert_eq(SaveSlots.format_play_time(600.0), "10m", "minutes")
	assert_eq(SaveSlots.format_last_played(0), "never", "never played")

func test_settings_are_per_slot() -> void:
	SaveSlots.create(1, "A", "1", "story", "normal", true)
	SaveSlots.create(3, "B", "2", "creative", "easy", true)
	SaveSlots.load_slot(1)
	Game.settings["fov"] = 61.0
	Game.settings["hud_scale"] = 1.3
	SaveSlots.save_slot()
	SaveSlots.load_slot(3)
	Game.settings["fov"] = 97.0
	Game.settings["hud_scale"] = 0.9
	SaveSlots.save_slot()
	# The files are the contract; the in-memory dict follows from them.
	assert_near(float(JsonUtil.load_file(SaveSlots.settings_path(1)).get("fov", 0.0)), 61.0, 0.01,
		"slot 1 file fov")
	assert_near(float(JsonUtil.load_file(SaveSlots.settings_path(3)).get("fov", 0.0)), 97.0, 0.01,
		"slot 3 file fov")
	SaveSlots.load_slot(1)
	assert_near(float(Game.settings["fov"]), 61.0, 0.01, "slot 1 fov")
	assert_near(float(Game.settings["hud_scale"]), 1.3, 0.01, "slot 1 hud scale")
	SaveSlots.load_slot(3)
	assert_near(float(Game.settings["fov"]), 97.0, 0.01, "slot 3 fov")
	assert_eq(SaveSlots.active(), 3, "active slot")

func test_clear_active_returns_to_the_global_settings() -> void:
	SaveSlots.create(1, "A", "1", "story", "normal", true)
	SaveSlots.load_slot(1)
	assert_eq(SaveSlots.active(), 1, "active")
	SaveSlots.clear_active()
	assert_eq(SaveSlots.active(), 0, "no slot")

func test_copy_duplicates_world_and_settings() -> void:
	SaveSlots.create(1, "Origin", "99", "story", "normal", true)
	SaveSlots.write_profile(1, ProfileFactory.new_profile("Goku", "saiyan", "male", "warrior"))
	SaveSlots.load_slot(1)
	Game.settings["fov"] = 88.0
	SaveSlots.save_slot()
	assert_true(SaveSlots.copy_slot(1, 2), "copied")
	assert_true(SaveSlots.is_used(2), "slot 2 used")
	var rows := SaveSlots.list()
	assert_eq(String(rows[1]["name"]), "Goku", "profile copied")
	assert_eq(int(rows[1]["seed"]), 99, "seed copied")
	SaveSlots.load_slot(2)
	assert_near(float(Game.settings["fov"]), 88.0, 0.01, "settings copied")
	assert_true(not SaveSlots.copy_slot(3, 1), "cannot copy an empty slot")

func test_delete_clears_everything() -> void:
	SaveSlots.create(2, "Gone", "5", "story", "normal", true)
	SaveSlots.write_profile(2, ProfileFactory.new_profile("Bye", "human", "male", "warrior"))
	assert_true(SaveSlots.is_used(2), "used")
	SaveSlots.delete_slot(2)
	assert_true(not SaveSlots.is_used(2), "gone")
	assert_true(SaveSlots.profile_of(2).is_empty(), "profile gone")

func test_start_refuses_an_empty_slot() -> void:
	assert_true(not SaveSlots.start(1), "no world")

func test_extra_settings_have_defaults() -> void:
	if FileAccess.file_exists("user://settings.json"):
		DirAccess.remove_absolute("user://settings.json")
	Game.settings.erase("show_coordinates")
	Game.settings.erase("dev_mode")
	Game.settings.erase("hud_scale")
	UiUtil.ensure_ui_settings()
	assert_true(Game.settings.has("show_coordinates"), "coordinates key")
	assert_true(not bool(UiUtil.setting("dev_mode", true)), "dev mode off by default")
	assert_near(float(UiUtil.setting("hud_scale", 0.0)), 1.0, 0.001, "hud scale default")
