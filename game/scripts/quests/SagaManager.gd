class_name SagaManager
extends Node
## Saga chains (data/sagas.json): unlock order, the "next story quest" pointer, saga
## completion celebration and the boss BGM switch (docs/ARCHITECTURE.md §9).
##
## The chain is saiyan_saga -> frieza_saga -> android_saga -> {future_saga, buu_saga}
## -> movies_saga, driven entirely by `requirements.previousSaga`.

const NODE_NAME := "SagaManager"
const DEFAULT_EXPLORE := "explore"

var world: Node = null
var announce := true

var _boss_bgm := false

static func of(world_node: Node) -> SagaManager:
	if world_node == null or not is_instance_valid(world_node):
		return null
	var n: Node = world_node.get_node_or_null(NODE_NAME)
	return n as SagaManager if n is SagaManager else null

func _ready() -> void:
	name = NODE_NAME
	if world == null:
		world = get_parent()
	Events.boss_engaged.connect(_on_boss_engaged)
	Events.boss_defeated.connect(_on_boss_defeated)
	Events.quest_completed.connect(_on_quest_event)
	Events.quest_reward_claimed.connect(_on_quest_event)
	call_deferred("auto_track")

# --- data ------------------------------------------------------------------

func sagas() -> Array:
	return Registry.sagas if Registry != null else []

func saga(saga_id: String) -> Dictionary:
	for s in sagas():
		if String(s.get("id", "")) == saga_id:
			return s
	return {}

func saga_ids() -> PackedStringArray:
	var out := PackedStringArray()
	for s in sagas():
		out.append(String(s.get("id", "")))
	return out

func quests_of(saga_id: String) -> Array:
	var s := saga(saga_id)
	var list: Variant = s.get("quests", [])
	return list if list is Array else []

## Saga id a quest belongs to ("" for sidequests).
func saga_of(quest_id: String) -> String:
	if Registry == null:
		return ""
	var q: Dictionary = Registry.quest(quest_id)
	var direct := String(q.get("saga", ""))
	if direct != "":
		return direct
	for s in sagas():
		if quests_of(String(s.get("id", ""))).has(quest_id):
			return String(s.get("id", ""))
	return ""

func previous_saga(saga_id: String) -> String:
	return String(saga(saga_id).get("requirements", {}).get("previousSaga", ""))

# --- state -----------------------------------------------------------------

func _finished() -> Array:
	if Game == null:
		return []
	var q: Dictionary = Game.profile.get("quests", {})
	var out: Array = []
	for qid in q.get("completed", []):
		out.append(String(qid))
	for qid in q.get("claimed", []):
		if not out.has(String(qid)):
			out.append(String(qid))
	return out

func is_quest_finished(quest_id: String) -> bool:
	return _finished().has(quest_id)

func saga_progress(saga_id: String) -> Dictionary:
	var list := quests_of(saga_id)
	var done := 0
	var fin := _finished()
	for qid in list:
		if fin.has(String(qid)):
			done += 1
	return {"done": done, "total": list.size()}

func is_saga_completed(saga_id: String) -> bool:
	var p := saga_progress(saga_id)
	return int(p["total"]) > 0 and int(p["done"]) >= int(p["total"])

## A saga is playable when its `previousSaga` is finished (or it has none).
func is_unlocked(saga_id: String) -> bool:
	var prev := previous_saga(saga_id)
	if prev == "":
		return true
	if saga(prev).is_empty():
		return true
	return is_saga_completed(prev)

func unlocked_sagas() -> PackedStringArray:
	var out := PackedStringArray()
	for sid in saga_ids():
		if is_unlocked(sid):
			out.append(sid)
	return out

## First unfinished quest of the earliest unlocked, unfinished saga.
func next_story_quest() -> String:
	var fin := _finished()
	for s in sagas():
		var sid := String(s.get("id", ""))
		if not is_unlocked(sid):
			continue
		for qid in quests_of(sid):
			if not fin.has(String(qid)):
				return String(qid)
	return ""

func current_saga() -> String:
	return saga_of(next_story_quest())

# --- tracking --------------------------------------------------------------

## Point the HUD tracker at the story quest the player should do next, unless the
## player is already tracking something that is still active.
func auto_track() -> void:
	if Game == null or Game.profile.is_empty():
		return
	var q: Dictionary = Game.profile.get("quests", {})
	var active: Dictionary = q.get("active", {})
	var tracked := String(q.get("tracked", ""))
	if tracked != "" and active.has(tracked):
		return
	if not active.is_empty():
		for qid in active.keys():
			if saga_of(String(qid)) != "":
				q["tracked"] = String(qid)
				Events.quest_tracked.emit(String(qid))
				return
		q["tracked"] = String(active.keys()[0])
		Events.quest_tracked.emit(String(q["tracked"]))
		return
	var next := next_story_quest()
	if next == "" or next == tracked:
		return
	q["tracked"] = next
	Events.quest_tracked.emit(next)

## Called by the QuestManager right after a quest completes or is claimed.
func on_quest_finished(quest_id: String) -> void:
	_on_quest_event(quest_id)

func _on_quest_event(quest_id: String) -> void:
	var sid := saga_of(quest_id)
	if sid != "" and is_saga_completed(sid):
		_celebrate(sid)
	auto_track()

func _celebrate(saga_id: String) -> void:
	var flag := "saga_done_" + saga_id
	if StoryFlags.has_flag(flag):
		return
	StoryFlags.set_flag(flag, true)
	Events.saga_completed.emit(saga_id)
	if not announce:
		return
	var name := String(saga(saga_id).get("name", saga_id.capitalize()))
	var next := ""
	for s in sagas():
		if previous_saga(String(s.get("id", ""))) == saga_id:
			next = String(s.get("name", ""))
			break
	var text := "%s complete!" % name
	if next != "":
		text += " %s begins." % next
	if Game != null and Game.ui != null:
		Game.ui.call("toast", "Saga complete", text, null)
	else:
		Events.toast.emit("Saga complete", text, null)

# --- boss music ------------------------------------------------------------

## The audio agent's BgmDirector owns the boss/explore BGM switch (it listens to the same
## Events). We only track the state so the saga logic can ask about it.
func _on_boss_engaged(_entity: Node) -> void:
	_boss_bgm = true

func _on_boss_defeated(_entity: Node) -> void:
	_boss_bgm = false

## BGM context for the current planet ("explore" when the planet has no playlist).
func explore_context() -> String:
	if world == null or Registry == null:
		return DEFAULT_EXPLORE
	var pid: Variant = world.get("planet_id")
	if pid == null:
		return DEFAULT_EXPLORE
	var music := String(Registry.planet(String(pid)).get("music", ""))
	if music == "":
		return DEFAULT_EXPLORE
	var bgm: Dictionary = Registry.audio.get("bgm", {}) if Registry.audio is Dictionary else {}
	return music if bgm.has(music) else DEFAULT_EXPLORE
