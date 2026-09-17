extends Node
## Global game state: settings, worlds, profile, scene flow.

const SETTINGS_PATH := "user://settings.json"
const WORLDS_DIR := "user://worlds"
const DEFAULT_SETTINGS := {
	"music_volume": 0.7, "sfx_volume": 1.0, "ambience_volume": 0.8,
	"sens_first": 1.0, "sens_third": 0.9, "fov": 75.0, "view_bobbing": true, "vibration": true,
	"left_handed": false, "ui_scale": 1.0, "button_opacity": 0.65, "high_contrast_outline": false,
	"show_fps": false, "render_distance": 5, "sim_distance": 3, "quality_preset": "balanced",
	"autosave_minutes": 2, "shadows": false, "bloom": true, "clouds": true, "fancy_water": true,
	"particles": 1.0, "camera_mode": 0, "invert_y": false, "touch_layout": "default",
	"show_coordinates": false, "dev_mode": false, "hud_scale": 1.0, "slot": -1,
}

var settings: Dictionary = {}
var world: Node = null
var player: Node = null
var ui: Node = null
var main: Node = null
var profile: Dictionary = {}
var world_info: Dictionary = {}
var paused_by_ui := false
var creative := false
var version := "0.1.0"

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	version = ProjectSettings.get_setting("application/config/version", "0.1.0")
	load_settings()
	if not DirAccess.dir_exists_absolute(WORLDS_DIR):
		DirAccess.make_dir_recursive_absolute(WORLDS_DIR)

# --- settings --------------------------------------------------------------

func load_settings() -> void:
	settings = DEFAULT_SETTINGS.duplicate(true)
	var d: Variant = JsonUtil.load_file(SETTINGS_PATH)
	if d is Dictionary:
		for k in d.keys():
			if settings.has(k):
				settings[k] = d[k]
	if is_mobile():
		# Phones default to the balanced preset.
		pass
	else:
		if not (d is Dictionary):
			settings["render_distance"] = 8
			settings["sim_distance"] = 4
			settings["quality_preset"] = "high"

func save_settings() -> void:
	JsonUtil.save_file(SETTINGS_PATH, settings, true)
	Events.settings_changed.emit()

func setting(key: String, default: Variant = null) -> Variant:
	return settings.get(key, default)

func apply_quality_preset(name: String) -> void:
	settings["quality_preset"] = name
	match name:
		"low":
			settings["render_distance"] = 3; settings["sim_distance"] = 2; settings["shadows"] = false; settings["bloom"] = false; settings["clouds"] = false; settings["fancy_water"] = false; settings["particles"] = 0.5
		"balanced":
			settings["render_distance"] = 5; settings["sim_distance"] = 3; settings["shadows"] = false; settings["bloom"] = true; settings["clouds"] = true; settings["fancy_water"] = true; settings["particles"] = 1.0
		"high":
			settings["render_distance"] = 7; settings["sim_distance"] = 4; settings["shadows"] = true; settings["bloom"] = true; settings["clouds"] = true; settings["fancy_water"] = true; settings["particles"] = 1.0
	save_settings()

func is_mobile() -> bool:
	return OS.has_feature("mobile") or OS.get_name() in ["Android", "iOS"]

func ui_scale() -> float:
	var h := float(get_viewport().get_visible_rect().size.y) if get_viewport() != null else 720.0
	return clampf(h / 480.0, 0.8, 3.0) * float(settings.get("ui_scale", 1.0))

# --- worlds ----------------------------------------------------------------

static func slugify(name: String) -> String:
	var s := name.strip_edges().to_lower()
	var out := ""
	for c in s:
		if (c >= "a" and c <= "z") or (c >= "0" and c <= "9"):
			out += c
		elif c == " " or c == "-" or c == "_":
			out += "_"
	if out == "":
		out = "world"
	return out.left(32)

func world_dir(slug: String) -> String:
	return WORLDS_DIR.path_join(slug)

func list_worlds() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var d := DirAccess.open(WORLDS_DIR)
	if d == null:
		return out
	d.list_dir_begin()
	var n := d.get_next()
	while n != "":
		if d.current_is_dir() and not n.begins_with("."):
			var info: Variant = JsonUtil.load_file(world_dir(n).path_join("world.json"))
			if info is Dictionary:
				info["slug"] = n
				out.append(info)
		n = d.get_next()
	d.list_dir_end()
	out.sort_custom(func(a, b): return int(a.get("last_played", 0)) > int(b.get("last_played", 0)))
	return out

func create_world(name: String, seed_text: String, mode := "story", difficulty := "normal") -> Dictionary:
	var slug := slugify(name)
	var base := slug
	var i := 2
	while DirAccess.dir_exists_absolute(world_dir(slug)):
		slug = "%s_%d" % [base, i]
		i += 1
	var seed_val: int
	if seed_text.strip_edges() == "":
		seed_val = randi()
	elif seed_text.strip_edges().is_valid_int():
		seed_val = int(seed_text.strip_edges())
	else:
		seed_val = seed_text.hash()
	var info := {
		"name": name.strip_edges().left(28), "slug": slug, "seed": seed_val, "mode": mode, "difficulty": difficulty,
		"planet": "earth", "created": int(Time.get_unix_time_from_system()), "last_played": int(Time.get_unix_time_from_system()),
		"version": version, "time_ticks": 1000.0, "day": 0, "keep_inventory": true,
	}
	DirAccess.make_dir_recursive_absolute(world_dir(slug))
	JsonUtil.save_file(world_dir(slug).path_join("world.json"), info, true)
	return info

func delete_world(slug: String) -> void:
	var dir := world_dir(slug)
	if not DirAccess.dir_exists_absolute(dir):
		return
	_rm_rf(dir)

func _rm_rf(path: String) -> void:
	var d := DirAccess.open(path)
	if d == null:
		return
	d.list_dir_begin()
	var n := d.get_next()
	while n != "":
		var p := path.path_join(n)
		if d.current_is_dir():
			_rm_rf(p)
		else:
			DirAccess.remove_absolute(p)
		n = d.get_next()
	d.list_dir_end()
	DirAccess.remove_absolute(path)

func load_profile(slug: String) -> Dictionary:
	var p: Variant = JsonUtil.load_file(world_dir(slug).path_join("profile.json"))
	return p if p is Dictionary else {}

func save_profile() -> void:
	if world_info.is_empty():
		return
	if player != null and player.has_method("write_profile"):
		player.write_profile(profile)
	JsonUtil.save_file(world_dir(world_info["slug"]).path_join("profile.json"), profile, false)

func save_world_info() -> void:
	if world_info.is_empty():
		return
	world_info["last_played"] = int(Time.get_unix_time_from_system())
	if world != null:
		world_info["time_ticks"] = world.get("time_ticks")
		world_info["planet"] = world.get("planet_id")
	JsonUtil.save_file(world_dir(world_info["slug"]).path_join("world.json"), world_info, true)

func save_all() -> void:
	Events.saving_started.emit()
	save_world_info()
	save_profile()
	if world != null and world.has_method("save_modified_chunks"):
		world.save_modified_chunks()
	Events.saving_finished.emit()

# --- flow ------------------------------------------------------------------

func start_world(info: Dictionary, new_profile: Dictionary) -> void:
	world_info = info
	profile = new_profile
	creative = info.get("mode", "story") == "creative"
	_resolve_spawn()
	if main != null and main.has_method("enter_world"):
		main.enter_world(info)

## A fresh profile carries the y = -1 placeholder from ProfileFactory; replace it with a real
## surface spawn (and remember it as the respawn point) before the world is entered.
func _resolve_spawn() -> void:
	var pos: Dictionary = profile.get("position", {})
	if float(pos.get("y", -1.0)) >= 0.0:
		return
	var planet_id: String = str(pos.get("planet", world_info.get("planet", "earth")))
	var p: Vector3 = spawn_point_for(planet_id, int(world_info.get("seed", 0)))
	profile["position"] = {"planet": planet_id, "x": p.x, "y": p.y, "z": p.z, "yaw": 0.0}
	profile["spawn"] = {"planet": planet_id, "x": p.x, "y": p.y, "z": p.z}

func change_planet(planet_id: String, arrival: Variant = null) -> void:
	if world_info.is_empty():
		return
	save_all()
	world_info["planet"] = planet_id
	if arrival != null:
		profile["position"] = {"planet": planet_id, "x": arrival.x, "y": arrival.y, "z": arrival.z, "yaw": 0.0}
	else:
		var p: Vector3 = spawn_point_for(planet_id, int(world_info.get("seed", 0)))
		profile["position"] = {"planet": planet_id, "x": p.x, "y": p.y, "z": p.z, "yaw": 0.0}
	if main != null and main.has_method("enter_world"):
		main.enter_world(world_info)
	Events.planet_changed.emit(planet_id)

## Save slots (three of them, each with its own world, profile and settings copy).
## The slot logic lives in scripts/ui/SaveSlots.gd; these are the canonical entry points.
func load_slot(index: int) -> void:
	SaveSlots.load_slot(index)

func save_slot() -> void:
	SaveSlots.save_slot()

## Surface spawn for a planet: never in water, as close to (0,0) as the terrain allows.
func spawn_point_for(planet_id: String, seed_val: int) -> Vector3:
	var def: Dictionary = Registry.planet(planet_id)
	if def.is_empty():
		return Vector3(0.5, 72.0, 0.5)
	return WorldGenFactory.spawn_point(def, seed_val)

func goto_main_menu() -> void:
	if main != null and main.has_method("show_main_menu"):
		main.show_main_menu()

func quit_to_menu() -> void:
	save_all()
	world_info = {}
	profile = {}
	goto_main_menu()

func difficulty_mult() -> float:
	match world_info.get("difficulty", "normal"):
		"easy": return 0.6
		"hard": return 1.5
	return 1.0
