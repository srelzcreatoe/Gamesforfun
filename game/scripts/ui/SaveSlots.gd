class_name SaveSlots
## Exactly three save slots. A slot owns one world, one character profile and its own copy of
## the settings, so two players on the same phone never share a control layout or a render
## distance.
##
##   SaveSlots.list()          -> [{index, used, name, race, level, planet, play_time, last_played}]
##   SaveSlots.load_slot(i)    -> pulls the slot's settings into Game.settings (call before playing)
##   SaveSlots.save_slot()     -> writes the active slot's settings (called by the Settings screen)
##   SaveSlots.start(i)        -> enters the world, or returns false when the slot is empty
##   SaveSlots.create(i, info, profile)
##   SaveSlots.copy_slot(a, b) / SaveSlots.delete_slot(i)
##
## Layout: settings at `user://slots/<i>/settings.json`, the world in Game's own worlds folder
## under the fixed slug `slot_<i>` so SaveManager / Game.list_worlds keep working unchanged.

const COUNT := 3
const DIR := "user://slots"

static func slug(index: int) -> String:
	return "slot_%d" % clampi(index, 1, COUNT)

static func slot_dir(index: int) -> String:
	return DIR.path_join(str(clampi(index, 1, COUNT)))

static func settings_path(index: int) -> String:
	return slot_dir(index).path_join("settings.json")

static func active() -> int:
	if Game == null:
		return 0
	return clampi(int(UiUtil.setting("slot", 0)), 0, COUNT)

static func world_info(index: int) -> Dictionary:
	var p: Variant = JsonUtil.load_file(Game.world_dir(slug(index)).path_join("world.json"))
	return p if p is Dictionary else {}

static func profile_of(index: int) -> Dictionary:
	return Game.load_profile(slug(index))

static func is_used(index: int) -> bool:
	return not world_info(index).is_empty()

## One row per slot for the slot screen; empty slots come back with `used = false`.
static func list() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for i in range(1, COUNT + 1):
		var info := world_info(i)
		var prof := profile_of(i) if not info.is_empty() else {}
		var ch: Dictionary = prof.get("character", {})
		out.append({
			"index": i,
			"used": not info.is_empty(),
			"world": info,
			"name": String(ch.get("name", "")),
			"race": _race_name(String(ch.get("race", ""))),
			"class": String(ch.get("class", "")).capitalize(),
			"level": _level_of(prof),
			"planet": _planet_name(String(info.get("planet", prof.get("position", {}).get("planet", "earth")))),
			"mode": String(info.get("mode", "story")).capitalize(),
			"difficulty": String(info.get("difficulty", "normal")).capitalize(),
			"play_time": float(prof.get("play_time", 0.0)),
			"last_played": int(info.get("last_played", 0)),
			"seed": int(info.get("seed", 0)),
		})
	return out

static func _race_name(id: String) -> String:
	if id == "":
		return ""
	if Registry != null:
		return String(Registry.race(id).get("name", id.capitalize()))
	return id.capitalize()

static func _planet_name(id: String) -> String:
	if Registry != null:
		return String(Registry.planet(id).get("name", id.capitalize()))
	return id.capitalize()

static func _level_of(profile: Dictionary) -> int:
	if profile.is_empty():
		return 0
	if ResourceLoader.exists("res://scripts/combat/Stats.gd"):
		var st: Object = load("res://scripts/combat/Stats.gd").new()
		if st != null and st.has_method("from_profile"):
			st.call("from_profile", profile)
			if st.has_method("level"):
				return int(st.call("level"))
	var total := 0
	for v in profile.get("stats", {}).values():
		total += int(v)
	return 1 + total / 5

static func format_play_time(seconds: float) -> String:
	var t := int(maxf(0.0, seconds))
	if t < 60:
		return "%ds" % t
	if t < 3600:
		return "%dm" % (t / 60)
	return "%dh %dm" % [t / 3600, (t % 3600) / 60]

static func format_last_played(unix: int) -> String:
	if unix <= 0:
		return "never"
	return Time.get_datetime_string_from_unix_time(unix, true).replace("T", " ").left(16)

# --- settings ---------------------------------------------------------------

## Make `index` the active slot and pull its settings into Game.settings.
static func load_slot(index: int) -> void:
	var i := clampi(index, 1, COUNT)
	UiUtil.ensure_ui_settings()
	var saved: Variant = JsonUtil.load_file(settings_path(i))
	if saved is Dictionary:
		for k in (saved as Dictionary).keys():
			Game.settings[k] = (saved as Dictionary)[k]
	Game.settings["slot"] = i
	Events.settings_changed.emit()

## Write the settings of the active slot (and keep the global defaults in step).
static func save_slot() -> void:
	UiUtil.ensure_ui_settings()
	var i := active()
	if i > 0:
		DirAccess.make_dir_recursive_absolute(slot_dir(i))
		JsonUtil.save_file(settings_path(i), Game.settings, true)
	# The global defaults file must never remember which slot was open.
	Game.settings["slot"] = 0
	Game.save_settings()
	Game.settings["slot"] = i

## Drop back to the global defaults (leaving a world / returning to the title).
static func clear_active() -> void:
	if Game == null:
		return
	var raw: Variant = JsonUtil.load_file("user://settings.json")
	if raw is Dictionary:
		for k in (raw as Dictionary).keys():
			Game.settings[k] = (raw as Dictionary)[k]
	Game.settings["slot"] = 0
	Events.settings_changed.emit()

# --- lifecycle --------------------------------------------------------------

## Create the world + profile for an empty slot. Returns the world info.
static func create(index: int, name: String, seed_text: String, mode: String, difficulty: String,
		keep_inventory: bool) -> Dictionary:
	var i := clampi(index, 1, COUNT)
	delete_slot(i)
	var info := Game.create_world(name, seed_text, mode, difficulty)
	# Game.create_world picks its own slug; move the folder to this slot's fixed slug.
	info = _rename_slug(info, slug(i))
	info["slot"] = i
	info["keep_inventory"] = keep_inventory
	JsonUtil.save_file(Game.world_dir(slug(i)).path_join("world.json"), info, true)
	return info

static func _rename_slug(info: Dictionary, want: String) -> Dictionary:
	var from := String(info.get("slug", ""))
	if from == want or from == "":
		info["slug"] = want
		return info
	var src := Game.world_dir(from)
	var dst := Game.world_dir(want)
	DirAccess.make_dir_recursive_absolute(dst)
	_copy_dir(src, dst)
	Game.delete_world(from)
	info["slug"] = want
	return info

static func write_profile(index: int, profile: Dictionary) -> void:
	JsonUtil.save_file(Game.world_dir(slug(index)).path_join("profile.json"), profile, false)

## Enter the world stored in a slot. Returns false when the slot is empty.
static func start(index: int) -> bool:
	var i := clampi(index, 1, COUNT)
	var info := world_info(i)
	if info.is_empty():
		return false
	var prof := profile_of(i)
	if prof.is_empty():
		return false
	info["slug"] = slug(i)
	info["slot"] = i
	load_slot(i)
	Game.start_world(info, prof)
	return true

static func delete_slot(index: int) -> void:
	var i := clampi(index, 1, COUNT)
	Game.delete_world(slug(i))
	var d := slot_dir(i)
	if DirAccess.dir_exists_absolute(d):
		for f in JsonUtil.list_files(d, ".json", false):
			DirAccess.remove_absolute(f)
		DirAccess.remove_absolute(d)

static func copy_slot(from_index: int, to_index: int) -> bool:
	var a := clampi(from_index, 1, COUNT)
	var b := clampi(to_index, 1, COUNT)
	if a == b or not is_used(a):
		return false
	delete_slot(b)
	var src := Game.world_dir(slug(a))
	var dst := Game.world_dir(slug(b))
	DirAccess.make_dir_recursive_absolute(dst)
	_copy_dir(src, dst)
	var info := world_info(b)
	info["slug"] = slug(b)
	info["slot"] = b
	info["name"] = String(info.get("name", "World")) + " copy"
	JsonUtil.save_file(dst.path_join("world.json"), info, true)
	var sp := settings_path(a)
	if FileAccess.file_exists(sp):
		DirAccess.make_dir_recursive_absolute(slot_dir(b))
		var cfg: Variant = JsonUtil.load_file(sp)
		if cfg is Dictionary:
			JsonUtil.save_file(settings_path(b), cfg, true)
	return true

static func first_empty() -> int:
	for i in range(1, COUNT + 1):
		if not is_used(i):
			return i
	return 0

static func _copy_dir(src: String, dst: String) -> void:
	var d := DirAccess.open(src)
	if d == null:
		return
	DirAccess.make_dir_recursive_absolute(dst)
	d.list_dir_begin()
	var n := d.get_next()
	while n != "":
		if d.current_is_dir():
			if not n.begins_with("."):
				_copy_dir(src.path_join(n), dst.path_join(n))
		else:
			d.copy(src.path_join(n), dst.path_join(n))
		n = d.get_next()
	d.list_dir_end()
