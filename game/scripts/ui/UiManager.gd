class_name UiManager
extends CanvasLayer
## The one UI root (ARCHITECTURE.md §10). `Game.ui` points here.
## `open(screen, args)` pushes a screen on the stack, `close(screen)` pops it. The HUD and the
## toast layer are always present and are never modal.

const SCREENS := {
	"hud": "res://scenes/ui/Hud.tscn",
	"inventory": "res://scenes/ui/Inventory.tscn",
	"crafting": "res://scenes/ui/Inventory.tscn",
	"quests": "res://scenes/ui/QuestLog.tscn",
	"stats": "res://scenes/ui/StatsScreen.tscn",
	"dialog": "res://scenes/ui/Dialog.tscn",
	"pause": "res://scenes/ui/Pause.tscn",
	"settings": "res://scenes/ui/Settings.tscn",
	"death": "res://scenes/ui/Death.tscn",
	"wish": "res://scenes/ui/WishScreen.tscn",
	"space_map": "res://scenes/ui/SpaceMap.tscn",
	"radial": "res://scenes/ui/Radial.tscn",
	"character_creation": "res://scenes/ui/CharacterCreation.tscn",
	"main_menu": "res://scenes/ui/MainMenu.tscn",
	"world_select": "res://scenes/ui/WorldSelect.tscn",
	"create_world": "res://scenes/ui/CreateWorld.tscn",
	"loading": "res://scenes/ui/Loading.tscn",
	"dev": "res://scenes/ui/DevMenu.tscn",
}
const NON_MODAL := ["hud"]

var stack: Array[String] = []
var open_screens: Dictionary = {}     # name -> Control
var hud: Control = null
var toasts: Control = null

func _ready() -> void:
	name = "UiManager"
	layer = 10
	process_mode = Node.PROCESS_MODE_ALWAYS
	if Game != null:
		Game.ui = self
	UiUtil.ensure_ui_settings()
	toasts = load("res://scripts/ui/ToastLayer.gd").new()
	add_child(toasts)
	Events.player_spawned.connect(_on_player_spawned)
	Events.world_loaded.connect(_on_world_loaded)
	Events.world_unloading.connect(func(_w: Node) -> void: close_all())

func _on_world_loaded(_w: Node) -> void:
	close("loading")
	show_hud(true)

func _on_player_spawned(_p: Node) -> void:
	close("loading")
	show_hud(true)

## While a world is streaming its first chunks there is no player yet: show the loading bar.
func _process(_delta: float) -> void:
	if Game == null:
		return
	var streaming := Game.world != null and (Game.player == null or not is_instance_valid(Game.player))
	if streaming and not is_open("loading") and not is_modal_open():
		open("loading")
	elif not streaming and is_open("loading"):
		close("loading")

# --- hud -------------------------------------------------------------------

func show_hud(on: bool) -> void:
	if on:
		if hud == null or not is_instance_valid(hud):
			hud = _instantiate("hud")
			if hud != null:
				add_child(hud)
				move_child(hud, 0)
		if hud != null:
			hud.visible = true
			_sync_hud_input()
	elif hud != null and is_instance_valid(hud):
		hud.visible = false

func _sync_hud_input() -> void:
	if hud == null or not is_instance_valid(hud):
		return
	var blocked := is_modal_open()
	if hud.has_method("set_input_enabled"):
		hud.call("set_input_enabled", not blocked)

# --- screens ---------------------------------------------------------------

func _instantiate(screen: String) -> Control:
	var path: String = String(SCREENS.get(screen, ""))
	if path == "" or not ResourceLoader.exists(path):
		Log.w("UiManager: no scene for screen '%s'" % screen)
		return null
	var packed: PackedScene = load(path)
	if packed == null:
		return null
	var inst: Variant = packed.instantiate()
	return inst if inst is Control else null

func open(screen: String, screen_args: Dictionary = {}) -> Control:
	if screen == "hud":
		show_hud(true)
		return hud
	if open_screens.has(screen) and is_instance_valid(open_screens[screen]):
		var existing: Control = open_screens[screen]
		if existing.get("args") != null:
			existing.set("args", screen_args)
		if existing.has_method("refresh"):
			existing.call("refresh")
		existing.visible = true
		return existing
	var inst := _instantiate(screen)
	if inst == null:
		return null
	if inst.get("screen_name") != null:
		inst.set("screen_name", screen)
	if inst.get("args") != null or inst.has_method("build"):
		inst.set("args", screen_args)
	open_screens[screen] = inst
	stack.append(screen)
	add_child(inst)
	_update_pause()
	_sync_hud_input()
	Events.ui_opened.emit(screen)
	if is_modal_open():
		_cancel_hud_touches()
	return inst

func close(screen: String) -> void:
	if not open_screens.has(screen):
		return
	var inst: Variant = open_screens[screen]
	open_screens.erase(screen)
	stack.erase(screen)
	if inst is Node and is_instance_valid(inst):
		(inst as Node).queue_free()
	_update_pause()
	_sync_hud_input()
	Events.ui_closed.emit(screen)

func toggle(screen: String, screen_args: Dictionary = {}) -> void:
	if is_open(screen):
		close(screen)
	else:
		open(screen, screen_args)

func close_top() -> void:
	if stack.is_empty():
		return
	close(stack[stack.size() - 1])

func close_all() -> void:
	for s in stack.duplicate():
		close(s)

func is_open(screen: String) -> bool:
	return open_screens.has(screen) and is_instance_valid(open_screens[screen])

func top_screen() -> String:
	return stack[stack.size() - 1] if stack.size() > 0 else ""

func is_modal_open() -> bool:
	for s in stack:
		if not NON_MODAL.has(s) and is_open(s):
			return true
	return false

func _update_pause() -> void:
	if Game == null:
		return
	var modal := is_modal_open()
	Game.paused_by_ui = modal
	if Game.player != null and Game.player.get("keyboard") != null:
		var kb: Variant = Game.player.get("keyboard")
		if kb != null and kb.has_method("set_capture"):
			kb.call("set_capture", not modal and Game.world != null)

func _cancel_hud_touches() -> void:
	if hud != null and is_instance_valid(hud) and hud.has_method("cancel_touches"):
		hud.call("cancel_touches")

# --- toast / hint ----------------------------------------------------------

func toast(title: String, text: String, icon: Texture2D = null) -> void:
	Events.toast.emit(title, text, icon)

func show_hint(text: String, seconds := 5.0) -> void:
	Events.hint.emit(text, seconds)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		var k: InputEventKey = event
		if k.keycode == KEY_ESCAPE and not is_modal_open() and Game != null and Game.world != null:
			get_viewport().set_input_as_handled()
			open("pause")

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST:
		if is_modal_open():
			close_top()
		elif Game != null and Game.world != null:
			open("pause")
