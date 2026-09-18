extends Node
## Root scene: boot, screen switching (menu / world) and the automated test harness.
##
## Command line user args (after "--"):
##   --screenshot=<abs path>   save a PNG of the viewport after --after seconds and quit
##   --after=<seconds>         default 6
##   --autoplay[=<seed>]       skip menus, create a temporary world and spawn the player
##   --planet=<id>             planet for autoplay (default earth)
##   --race=<id>               race for autoplay (default saiyan)
##   --creative                autoplay in creative mode
##   --scene=<res path>        instantiate this scene under Screen instead of the menu (for UI checks)
##   --quit-after=<seconds>    quit without screenshot

const MAIN_MENU_SCENE := "res://scenes/ui/MainMenu.tscn"
const WORLD_SCENE := "res://scenes/world/World.tscn"
const UI_MANAGER_SCENE := "res://scenes/ui/UiManager.tscn"

@onready var screen_root: Node = $Screen
@onready var ui_layer: CanvasLayer = $UiLayer
@onready var overlay: CanvasLayer = $Overlay

var args: Dictionary = {}
var _shot_timer := -1.0
var _quit_timer := -1.0
var _mem_timer := 0.0
var _fps_label: Label

func _ready() -> void:
	_connect_breadcrumbs()
	Game.main = self
	_parse_args()
	_setup_window()
	if not Registry.loaded:
		Registry.load_all()
	if not Textures.built:
		Textures.build_block_array()
	_setup_ui_manager()
	_setup_fps_label()
	if args.has("scene"):
		var packed: PackedScene = load(String(args["scene"]))
		if packed != null:
			var inst := packed.instantiate()
			screen_root.add_child(inst)
		else:
			Log.e("Cannot load scene " + String(args["scene"]))
	elif args.has("autoplay"):
		_autoplay()
	else:
		show_main_menu()
	if args.has("screenshot"):
		_shot_timer = float(args.get("after", 6.0))
	if args.has("quit-after"):
		_quit_timer = float(args["quit-after"])

func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--"):
			var kv := a.substr(2).split("=", true, 1)
			args[kv[0]] = kv[1] if kv.size() > 1 else true

func _setup_window() -> void:
	if Game.is_mobile():
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
		DisplayServer.screen_set_keep_on(true)
	get_tree().auto_accept_quit = true

func _setup_ui_manager() -> void:
	if ResourceLoader.exists(UI_MANAGER_SCENE):
		var packed: PackedScene = load(UI_MANAGER_SCENE)
		var inst := packed.instantiate()
		ui_layer.add_child(inst)
		Game.ui = inst

func _setup_fps_label() -> void:
	_fps_label = Label.new()
	_fps_label.position = Vector2(12, 40)
	_fps_label.modulate = Color(0.8, 0.9, 1.0, 0.9)
	_fps_label.visible = bool(Game.settings.get("show_fps", false))
	overlay.add_child(_fps_label)
	Events.settings_changed.connect(func() -> void: _fps_label.visible = bool(Game.settings.get("show_fps", false)))

## Boot breadcrumbs: user://boot.log records how far a session got, so a crash on a phone
## (no console) can be located. Rewritten on every launch.
const BOOT_LOG := "user://boot.log"
var _boot_log: FileAccess = null

func _breadcrumb(stage: String) -> void:
	if _boot_log == null:
		_boot_log = FileAccess.open(BOOT_LOG, FileAccess.WRITE)
		if _boot_log == null:
			return
		_boot_log.store_line("Dragon Block Sagas %s | %s | %s | %s" % [Game.version, OS.get_name(),
			OS.get_model_name(), RenderingServer.get_video_adapter_name()])
	_boot_log.store_line("%8.2fs  %s  (static %.0f MB, textures %.0f MB)" % [
		Time.get_ticks_msec() / 1000.0, stage,
		Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0,
		Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED) / 1048576.0])
	_boot_log.flush()

func _connect_breadcrumbs() -> void:
	_breadcrumb("boot")
	Events.world_loaded.connect(func(_w: Node) -> void: _breadcrumb("world loaded"))
	Events.player_spawned.connect(func(_p: Node) -> void: _breadcrumb("player spawned"))
	Events.ui_opened.connect(func(screen: String) -> void: _breadcrumb("ui " + screen))
	Events.planet_changed.connect(func(pid: String) -> void: _breadcrumb("planet " + pid))
	var first_chunk := func(_cx: int, _cz: int) -> void: _breadcrumb("first chunk ready")
	Events.chunk_ready.connect(first_chunk, CONNECT_ONE_SHOT)

func _process(delta: float) -> void:
	if _fps_label.visible:
		_fps_label.text = "%d fps" % Engine.get_frames_per_second()
	if _shot_timer >= 0.0:
		_shot_timer -= delta
		if _shot_timer < 0.0:
			_take_screenshot(String(args["screenshot"]))
			get_tree().quit()
	if _quit_timer >= 0.0:
		_quit_timer -= delta
		if _quit_timer < 0.0:
			get_tree().quit()
	if args.has("profile"):
		_mem_timer -= delta
		if _mem_timer <= 0.0:
			_mem_timer = 5.0
			print("MEM static %.0f MB | textures %.0f MB | buffers %.0f MB | objects %d nodes %d orphans %d" % [
				Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0,
				Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED) / 1048576.0,
				Performance.get_monitor(Performance.RENDER_BUFFER_MEM_USED) / 1048576.0,
				int(Performance.get_monitor(Performance.OBJECT_COUNT)),
				int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
				int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))])

func _take_screenshot(path: String) -> void:
	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(path)
	print("SCREENSHOT %s -> %s (%s)" % [path, "ok" if err == OK else str(err), RenderingServer.get_video_adapter_name()])

func _clear_screen() -> void:
	for c in screen_root.get_children():
		screen_root.remove_child(c)
		c.queue_free()
	Game.world = null
	Game.player = null

func show_main_menu() -> void:
	_clear_screen()
	if ResourceLoader.exists(MAIN_MENU_SCENE):
		var packed: PackedScene = load(MAIN_MENU_SCENE)
		screen_root.add_child(packed.instantiate())
	else:
		var l := Label.new()
		l.text = "Dragon Block Sagas\n(main menu scene missing)"
		l.set_anchors_preset(Control.PRESET_CENTER)
		screen_root.add_child(l)
	Audio.play_bgm("menu")

func enter_world(info: Dictionary) -> void:
	_breadcrumb("enter world %s seed %s" % [str(info.get("planet", "?")), str(info.get("seed", "?"))])
	_clear_screen()
	if not ResourceLoader.exists(WORLD_SCENE):
		Log.e("World scene missing: " + WORLD_SCENE)
		return
	var packed: PackedScene = load(WORLD_SCENE)
	var w := packed.instantiate()
	screen_root.add_child(w)
	Game.world = w
	if w.has_method("start"):
		w.start(info, Game.profile)

func _autoplay() -> void:
	var seed_text := ""
	if args["autoplay"] is String:
		seed_text = String(args["autoplay"])
	var mode := "creative" if args.has("creative") else "story"
	var info := Game.create_world("Autoplay", seed_text if seed_text != "" else "12345", mode, "normal")
	info["planet"] = String(args.get("planet", "earth"))
	info["transient"] = true
	var prof := ProfileFactory.new_profile("Tester", String(args.get("race", "saiyan")), "male", "warrior")
	prof["position"]["planet"] = info["planet"]
	Game.start_world(info, prof)

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_PAUSED or what == NOTIFICATION_WM_GO_BACK_REQUEST:
		if not Game.world_info.is_empty():
			Game.save_all()
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		if not Game.world_info.is_empty() and not Game.world_info.get("transient", false):
			Game.save_all()
