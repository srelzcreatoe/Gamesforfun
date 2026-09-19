class_name BgmDirector
extends Node
## Picks the background music context from world state, plays the UI / feedback sounds
## and ducks the music while a dialog is open. Owns an `Ambience` child node.
##
## Integration: `World.start()` adds it ("BgmDirector"); if the World does not, call
## `BgmDirector.attach(world)` - the node also re-binds itself on `Events.world_loaded`,
## so it works wherever it is added (World, Main or the scene root).
## The main menu music stays with Main: the director is idle while `Game.world == null`.
##
## Contexts (data/audio.json "bgm" playlists), highest priority first:
##   transformation  Events.transformation_started .. transformation_finished
##   boss            Events.boss_engaged .. boss_defeated
##   battle          a hostile, aggroed enemy within 20 m, or recent combat damage
##   space           deep space / orbit (zero-g planet)
##   <planet music>  planets.json `music` (explore_earth, namek, heaven, hell,
##                   otherworld, time_chamber, space, ...)
##   explore         fallback
## Hysteresis: a context holds for at least MIN_HOLD seconds (an urgent context may
## interrupt it), cross-fade FADE seconds.

const MIN_HOLD := 8.0
const FADE := 3.0
const URGENT_FADE := 1.2
const BATTLE_RADIUS := 20.0
const BATTLE_LINGER := 8.0
const TRANSFORM_TIMEOUT := 12.0
const SCAN_INTERVAL := 0.4
const MAX_SCANNED_ENTITIES := 96
const DIALOG_DUCK := 0.35
const MODAL_DUCK := 0.7
const DUCK_SPEED := 4.0
const SFX_DEDUPE := 0.12
const DEEP_SPACE_PLANETS: Array[String] = ["universe_7_deep_space", "orbit"]
const FALLBACK_CONTEXT := "explore"

## context -> priority (unlisted = 10)
const PRIORITY: Dictionary = {"transformation": 40, "boss": 30, "battle": 20}
## context -> contexts to try when its playlist is empty
const FALLBACKS: Dictionary = {
	"explore_earth": ["explore", "menu"],
	"explore": ["explore_earth", "menu"],
	"namek": ["explore_namek", "explore"],
	"explore_namek": ["namek", "explore"],
	"heaven": ["otherworld", "explore"],
	"hell": ["otherworld", "explore"],
	"otherworld": ["explore", "menu"],
	"time_chamber": ["training", "explore"],
	"training": ["time_chamber", "explore"],
	"space": ["otherworld", "explore"],
	"battle": ["boss", "explore"],
	"boss": ["battle", "explore"],
	"transformation": ["boss", "battle"],
	"sad": ["otherworld", "explore"],
}
## UI screens that must not click (they are not modal panels)
const SILENT_SCREENS: Array[String] = ["hud", "toast", "hint", "damage", "crosshair"]

var enabled := true
## when false the director decides but never touches Audio (unit tests)
var apply_audio := true

var world: Node = null
var ambience: Ambience = null

var _context := ""
var _hold := 0.0
var _scan_t := 0.0
var _hostile_near := false
var _combat_timer := 0.0
var _transform_timer := 0.0
var _boss: Node = null
var _dialogs := 0
var _modals := 0
var _duck := 1.0
var _duck_applied := -1.0
var _recent_sfx: Dictionary = {}
var _clock := 0.0

## Read a boolean property that may not exist at all (Godot errors on bool(null)).
static func flag(obj: Object, property: String) -> bool:
	if obj == null:
		return false
	var v: Variant = obj.get(property)
	return v != null and bool(v)

## Add (or find) a director under `parent`. Safe to call repeatedly.
static func attach(parent: Node) -> Node:
	if parent == null:
		return null
	var existing := parent.get_node_or_null("BgmDirector")
	if existing != null:
		return existing
	var d := BgmDirector.new()
	d.name = "BgmDirector"
	parent.add_child(d)
	return d

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	world = _find_world()
	_connect_events()
	_ensure_ambience()

func _exit_tree() -> void:
	_duck = 1.0
	_apply_duck(true)

func _connect_events() -> void:
	if Events == null:
		return
	Events.world_loaded.connect(_on_world_loaded)
	Events.world_unloading.connect(_on_world_unloading)
	Events.transformation_started.connect(_on_transformation_started)
	Events.transformation_finished.connect(_on_transformation_finished)
	Events.boss_engaged.connect(_on_boss_engaged)
	Events.boss_defeated.connect(_on_boss_defeated)
	Events.entity_damaged.connect(_on_entity_damaged)
	Events.player_damaged.connect(_on_player_damaged)
	Events.entity_died.connect(_on_entity_died)
	Events.planet_changed.connect(_on_planet_changed)
	# --- ui / feedback sounds ---
	Events.ui_opened.connect(_on_ui_opened)
	Events.ui_closed.connect(_on_ui_closed)
	Events.dialog_requested.connect(_on_dialog_requested)
	Events.dialog_closed.connect(_on_dialog_closed)
	Events.quest_started.connect(_on_quest_started)
	Events.quest_completed.connect(_on_quest_completed)
	Events.level_up.connect(_on_level_up)
	Events.toast.connect(_on_toast)
	Events.item_picked_up.connect(_on_item_picked_up)
	Events.dragon_ball_found.connect(_on_dragon_ball_found)
	Events.technique_learned.connect(_on_technique_learned)
	Events.settings_changed.connect(func() -> void: _duck_applied = -1.0)

func _find_world() -> Node:
	if Game != null and Game.world != null and is_instance_valid(Game.world):
		return Game.world
	var p := get_parent()
	while p != null:
		if p.has_method("get_block") and p.has_method("get_biome"):
			return p
		p = p.get_parent()
	return null

func _ensure_ambience() -> void:
	if ambience != null and is_instance_valid(ambience):
		return
	var existing := get_node_or_null("Ambience")
	if existing is Ambience:
		ambience = existing
		return
	ambience = Ambience.new()
	ambience.name = "Ambience"
	add_child(ambience)

# --- event handlers ---------------------------------------------------------

func _on_world_loaded(w: Node) -> void:
	world = w
	_context = ""
	_hold = MIN_HOLD
	_combat_timer = 0.0
	_transform_timer = 0.0
	_boss = null
	_hostile_near = false
	_ensure_ambience()

func _on_world_unloading(_w: Node) -> void:
	world = null
	_boss = null
	_combat_timer = 0.0
	_transform_timer = 0.0
	_context = ""

func _on_planet_changed(_planet_id: String) -> void:
	# a planet change is a hard cut: allow the switch immediately
	_hold = MIN_HOLD
	_boss = null

func _is_cinematic_actor(entity: Node) -> bool:
	if entity == null or not is_instance_valid(entity):
		return false
	if Game != null and entity == Game.player:
		return true
	return flag(entity, "is_boss")

func _on_transformation_started(entity: Node, _form_id: String) -> void:
	if _is_cinematic_actor(entity):
		_transform_timer = TRANSFORM_TIMEOUT

func _on_transformation_finished(entity: Node, _form_id: String) -> void:
	if _is_cinematic_actor(entity):
		_transform_timer = 0.0

func _on_boss_engaged(entity: Node) -> void:
	_boss = entity
	_combat_timer = maxf(_combat_timer, BATTLE_LINGER)

func _on_boss_defeated(entity: Node) -> void:
	if _boss == entity or entity == null:
		_boss = null

func _on_entity_damaged(entity: Node, _amount: float, source: Node, _kind: String, _crit: bool) -> void:
	var player: Node = Game.player if Game != null else null
	if player != null and (source == player or entity == player):
		_combat_timer = BATTLE_LINGER
	elif source != null and entity != null and _near_player(entity):
		_combat_timer = maxf(_combat_timer, BATTLE_LINGER * 0.5)

func _on_player_damaged(_amount: float, _source: Node, _kind: String) -> void:
	_combat_timer = BATTLE_LINGER

func _on_entity_died(entity: Node, _killer: Node) -> void:
	if entity == _boss:
		_boss = null

func _on_ui_opened(screen: String) -> void:
	if SILENT_SCREENS.has(screen):
		return
	_modals += 1
	_sfx("ui_menu_switch", -6.0)

func _on_ui_closed(screen: String) -> void:
	if SILENT_SCREENS.has(screen):
		return
	_modals = maxi(0, _modals - 1)
	_sfx("ui_menu_switch", -8.0, 0.94)

func _on_dialog_requested(_npc: Node) -> void:
	_dialogs += 1

func _on_dialog_closed(_npc: Node) -> void:
	_dialogs = maxi(0, _dialogs - 1)

func _on_quest_started(_quest_id: String) -> void:
	_sfx("quest_start", -3.0)

func _on_quest_completed(_quest_id: String) -> void:
	_sfx("quest_complete", -2.0)

func _on_level_up(_new_level: int) -> void:
	_sfx("level_up", -2.0)

func _on_toast(_title: String, _text: String, _icon: Texture2D) -> void:
	_sfx("toast", -8.0)

func _on_item_picked_up(item_id: String, _count: int) -> void:
	if item_id.begins_with("dball") or item_id.begins_with("sdball") or item_id.contains("dragon_ball"):
		_sfx("dball_pickup", -1.0)
	else:
		_sfx("item_pickup", -7.0)

func _on_dragon_ball_found(_set_id: String, _star: int) -> void:
	_sfx("dball_pickup", 0.0)

func _on_technique_learned(_technique_id: String) -> void:
	_sfx("skill_learned", -3.0)

## Play a feedback sound, swallowing duplicates fired by several systems in the same frame.
func _sfx(name: String, volume_db := 0.0, pitch := 1.0) -> void:
	if not enabled or not apply_audio or Audio == null:
		return
	var last := float(_recent_sfx.get(name, -99.0))
	if _clock - last < SFX_DEDUPE:
		return
	_recent_sfx[name] = _clock
	Audio.play_sfx(name, volume_db, pitch)

# --- per frame --------------------------------------------------------------

func _process(delta: float) -> void:
	_clock += delta
	if not enabled:
		return
	_combat_timer = maxf(0.0, _combat_timer - delta)
	if _transform_timer > 0.0:
		_transform_timer = maxf(0.0, _transform_timer - delta)
	_scan_t -= delta
	if _scan_t <= 0.0:
		_scan_t = SCAN_INTERVAL
		_hostile_near = _scan_hostiles()
	update_context(delta, gather_state())
	_update_duck(delta)

## Current world state for `decide()`. Everything is guarded: no world -> menu state.
func gather_state() -> Dictionary:
	if world == null or not is_instance_valid(world):
		world = _find_world()
	if world == null or not is_instance_valid(world):
		return {"in_world": false}
	var planet := String(world.get("planet_id")) if world.get("planet_id") != null else ""
	var planet_def: Dictionary = Registry.planet(planet) if Registry != null else {}
	var boss_alive := _boss != null and is_instance_valid(_boss) and not flag(_boss, "dead")
	return {
		"in_world": true,
		"planet": planet,
		"planet_music": String(planet_def.get("music", "")),
		"gravity": float(planet_def.get("gravity", 1.0)),
		"transformation": _transform_timer > 0.0,
		"boss": boss_alive,
		"battle": _combat_timer > 0.0 or _hostile_near,
		"deep_space": DEEP_SPACE_PLANETS.has(planet) or float(planet_def.get("gravity", 1.0)) <= 0.01,
	}

## THE decision function: pure, unit tested with fake states.
## Returns "" when there is no world (the main menu owns the music then).
static func decide(state: Dictionary) -> String:
	if not state.get("in_world", false) == true:
		return ""
	var override := String(state.get("override", ""))
	if override != "":
		return override
	if state.get("transformation", false) == true:
		return "transformation"
	if state.get("boss", false) == true:
		return "boss"
	if state.get("battle", false) == true:
		return "battle"
	if state.get("deep_space", false) == true:
		return "space"
	var music := String(state.get("planet_music", ""))
	if music != "":
		return music
	return FALLBACK_CONTEXT

## First context in the fallback chain that has a non-empty playlist in audio.json.
static func resolve_context(context: String) -> String:
	if context == "":
		return ""
	if _has_playlist(context):
		return context
	for alt in FALLBACKS.get(context, []):
		if _has_playlist(String(alt)):
			return String(alt)
	if _has_playlist(FALLBACK_CONTEXT):
		return FALLBACK_CONTEXT
	return context

static func _has_playlist(context: String) -> bool:
	if Registry == null or not Registry.loaded:
		return true      # cannot tell yet: assume the data is fine
	var lists: Dictionary = Registry.audio.get("bgm", {})
	var tracks: Variant = lists.get(context, [])
	return tracks is Array and (tracks as Array).size() > 0

static func priority_of(context: String) -> int:
	return int(PRIORITY.get(context, 10))

## Seconds the current context must hold before `to` may take over.
static func hold_needed(from: String, to: String) -> float:
	if from == "" or to == "":
		return 0.0
	# leaving the transformation cinematic restores the previous music at once
	if from == "transformation":
		return 0.0
	if priority_of(to) > priority_of(from):
		return 0.0
	return MIN_HOLD

## Apply the hysteresis and (unless `apply_audio` is false) drive `Audio.play_bgm`.
## Returns the context the director is on after this tick.
func update_context(delta: float, state: Dictionary) -> String:
	_hold += delta
	_sync_external()
	var want := resolve_context(decide(state))
	if want == "":
		return _context
	if want == _context:
		return _context
	if _hold < hold_needed(_context, want):
		return _context
	var fade := FADE if priority_of(want) <= priority_of(_context) else URGENT_FADE
	_context = want
	_hold = 0.0
	if apply_audio and Audio != null:
		Log.i("BGM context -> %s (fade %.1f)" % [want, fade])
		Audio.play_bgm(want, fade)
	return _context

## Another system (Enemy.on_aggro, SagaManager, Main) may call Audio.play_bgm directly.
## Adopt its context instead of fighting it; our own decision wins again after MIN_HOLD.
func _sync_external() -> void:
	if not apply_audio or Audio == null:
		return
	var actual := String(Audio.bgm_context())
	if actual != "" and actual != _context:
		_context = actual
		_hold = 0.0

func context() -> String:
	return _context

func hold_time() -> float:
	return _hold

func battle_active() -> bool:
	return _combat_timer > 0.0 or _hostile_near

# --- battle proximity -------------------------------------------------------

func _scan_hostiles() -> bool:
	if world == null or not is_instance_valid(world):
		return false
	var player: Node = Game.player if Game != null else null
	if player == null or not is_instance_valid(player) or not (player is Node3D):
		return false
	var list: Array = []
	if world.has_method("get_entities"):
		list = world.call("get_entities")
	else:
		var root := world.get_node_or_null("Entities")
		if root != null:
			list = root.get_children()
	var origin: Vector3 = (player as Node3D).global_position
	var checked := 0
	for e in list:
		if checked >= MAX_SCANNED_ENTITIES:
			break
		if e == null or not is_instance_valid(e) or not (e is Node3D) or e == player:
			continue
		checked += 1
		if flag(e, "dead"):
			continue
		if not _is_hostile(e):
			continue
		if (e as Node3D).global_position.distance_to(origin) > BATTLE_RADIUS:
			continue
		if _is_aggroed(e, player):
			return true
	return false

func _near_player(node: Node) -> bool:
	var player: Node = Game.player if Game != null else null
	if player == null or not is_instance_valid(player) or not (player is Node3D) or not (node is Node3D):
		return false
	return (node as Node3D).global_position.distance_to((player as Node3D).global_position) <= BATTLE_RADIUS

func _is_hostile(e: Node) -> bool:
	var faction: Variant = e.get("faction")
	if faction != null and String(faction) == "villain":
		return true
	var kind: Variant = e.get("kind")
	if kind != null and String(kind) == "enemy":
		return true
	return flag(e, "is_boss")

func _is_aggroed(e: Node, player: Node) -> bool:
	if e.get("target") == player:
		return true
	var ai: Variant = e.get("ai")
	if ai != null and ai is Object and flag(ai as Object, "aggro"):
		return true
	if e.has_method("ai_state"):
		var st := String(e.call("ai_state"))
		return st == "CHASE" or st == "ATTACK"
	return false

# --- music ducking ----------------------------------------------------------

func _update_duck(delta: float) -> void:
	var want := 1.0
	if _dialogs > 0:
		want = DIALOG_DUCK
	elif _modals > 0 or (Game != null and Game.paused_by_ui):
		want = MODAL_DUCK
	_duck = lerpf(_duck, want, clampf(delta * DUCK_SPEED, 0.0, 1.0))
	if absf(_duck - want) < 0.01:
		_duck = want
	_apply_duck(false)

func _apply_duck(force: bool) -> void:
	if not apply_audio or Audio == null:
		return
	if not force and absf(_duck - _duck_applied) < 0.01:
		return
	_duck_applied = _duck
	var base := float(Game.settings.get("music_volume", 0.7)) if Game != null else 0.7
	Audio.set_volume("Music", clampf(base * _duck, 0.0, 1.0))

func duck_factor() -> float:
	return _duck
