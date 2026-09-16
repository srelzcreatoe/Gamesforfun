class_name QuestManager
extends Node
## The quest engine (docs/ARCHITECTURE.md §9). Lives under the World as "QuestManager"
## so the UI can find it with `Game.world.get_node_or_null("QuestManager")`.
##
## State is kept in `Game.profile.quests`:
##   {active: {quest_id: {objectives: [int...], spawned: [{id, obj, entity}], elapsed: float,
##                        obj_time: float}},
##    completed: [quest_id...], claimed: [quest_id...], tracked: quest_id}
##
## Quest ids are Strings of the form "<category>:<id>" (docs/DATA_SCHEMA.md).
##
## Cmdline: `--quest=<id>` force-starts a quest as soon as the player spawns (used by
## tools/screenshot.sh to verify a saga fight renders).

const NODE_NAME := "QuestManager"

const SPAWN_MIN_DIST := 12.0
const SPAWN_MAX_DIST := 20.0
const SPAWN_RETRY := 1.0
const BIOME_SEARCH_COLUMNS := 5          ## how many chunks out we look for the required biome
const LOCATION_INTERVAL := 0.5
const FAIL_RESTART_DELAY := 2.5

var world: Node = null
var force_quest := ""

var _loc_t := 0.0
var _tp_prev := -1
var _pending_spawns: Dictionary = {}     ## "qid#index" -> retry timer
var _restart: Dictionary = {}            ## qid -> seconds until the failed quest restarts
var _connected := false

# --- lifecycle -------------------------------------------------------------

static func of(world_node: Node) -> QuestManager:
	if world_node == null or not is_instance_valid(world_node):
		return null
	var n: Node = world_node.get_node_or_null(NODE_NAME)
	return n as QuestManager if n is QuestManager else null

func _ready() -> void:
	name = NODE_NAME
	if world == null:
		world = get_parent()
	_parse_cmdline()
	_connect_signals()
	call_deferred("_late_start")

func _parse_cmdline() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--quest="):
			force_quest = a.substr(8)
		elif a.begins_with("--quest") and a.length() == 7:
			force_quest = ""

func _connect_signals() -> void:
	if _connected:
		return
	_connected = true
	Events.entity_died.connect(_on_entity_died)
	Events.player_died.connect(_on_player_died)
	Events.item_picked_up.connect(_on_item_picked_up)
	Events.inventory_changed.connect(_on_inventory_changed)
	Events.dialog_closed.connect(_on_dialog_closed)
	Events.dragon_summoned.connect(notify_summon)
	Events.skill_changed.connect(notify_skill)
	Events.tp_changed.connect(_on_tp_changed)
	Events.planet_changed.connect(_on_planet_changed)
	Events.player_spawned.connect(_on_player_spawned)
	Events.technique_learned.connect(_on_technique_learned)

func _late_start() -> void:
	_normalise_state()
	_resume_active()
	if force_quest != "":
		var qid := resolve_id(force_quest)
		if qid != "":
			Log.i("QuestManager: force-starting %s (--quest)" % qid)
			start(qid, true)
		else:
			Log.w("QuestManager: --quest=%s is not a known quest" % force_quest)

func _on_player_spawned(_p: Node) -> void:
	_resume_active()

# --- profile state ---------------------------------------------------------

func state() -> Dictionary:
	if Game == null:
		return {}
	if Game.profile.is_empty():
		Game.profile = {}
	var q: Variant = Game.profile.get("quests", null)
	if not (q is Dictionary):
		q = {"active": {}, "completed": [], "claimed": [], "tracked": ""}
		Game.profile["quests"] = q
	return q

func _normalise_state() -> void:
	var s := state()
	if s.is_empty():
		return
	for key in ["active", "completed", "claimed"]:
		if not s.has(key) or (key == "active" and not (s[key] is Dictionary)) \
				or (key != "active" and not (s[key] is Array)):
			s[key] = {} if key == "active" else []
	if not s.has("tracked"):
		s["tracked"] = ""

func active() -> Dictionary:
	var s := state()
	return s.get("active", {}) if s.has("active") else {}

func completed() -> Array:
	var s := state()
	return s.get("completed", []) if s.has("completed") else []

func claimed() -> Array:
	var s := state()
	return s.get("claimed", []) if s.has("claimed") else []

func player() -> Node:
	return Game.player if Game != null else null

func profile() -> Dictionary:
	return Game.profile if Game != null else {}

# --- quest lookup ----------------------------------------------------------

func quest(qid: String) -> Dictionary:
	return Registry.quest(qid) if Registry != null else {}

## Accept a registry id, a bare quest id or a "<saga>:<number>" pair and return the
## registry id ("saga_saiyan:1"). Empty when nothing matches.
func resolve_id(text: String) -> String:
	if text == "" or Registry == null:
		return ""
	if Registry.quests.has(text):
		return text
	var wanted := text
	var saga := ""
	if text.contains(":"):
		saga = text.get_slice(":", 0)
		wanted = text.get_slice(":", 1)
	for qid in Registry.quests.keys():
		var q: Dictionary = Registry.quests[qid]
		if String(q.get("id", "")) != wanted:
			continue
		if saga == "":
			return String(qid)
		if String(q.get("saga", "")) == saga or String(q.get("category", "")) == saga:
			return String(qid)
	for qid in Registry.quests.keys():
		if String(qid).ends_with(":" + wanted):
			return String(qid)
	return ""

func quest_state(qid: String) -> String:
	if claimed().has(qid):
		return "claimed"
	if completed().has(qid):
		return "complete"
	if active().has(qid):
		return "active"
	return "available" if bool(can_start(qid)["ok"]) else "locked"

func context() -> Dictionary:
	return Requirements.build_context(profile(), player(), world)

## Every quest that could be started right now.
func available_quests() -> Array:
	var out: Array = []
	if Registry == null:
		return out
	var ctx := context()
	for qid in Registry.quests.keys():
		var id := String(qid)
		if active().has(id) or completed().has(id) or claimed().has(id):
			continue
		if bool(_can_start_with(id, ctx)["ok"]):
			out.append(id)
	out.sort()
	return out

func can_start(qid: String) -> Dictionary:
	return _can_start_with(qid, context())

func _can_start_with(qid: String, ctx: Dictionary) -> Dictionary:
	var def := quest(qid)
	if def.is_empty():
		return {"ok": false, "reasons": PackedStringArray(["Unknown quest"])}
	if active().has(qid):
		return {"ok": false, "reasons": PackedStringArray(["Already in progress"])}
	if completed().has(qid) or claimed().has(qid):
		return {"ok": false, "reasons": PackedStringArray(["Already finished"])}
	var reasons := PackedStringArray()
	var pre := Requirements.evaluate(def.get("prerequisites", {}), ctx)
	if not bool(pre["ok"]):
		reasons.append_array(pre["reasons"])
	var req := Requirements.evaluate(def.get("requirements", {}), ctx)
	if not bool(req["ok"]):
		reasons.append_array(req["reasons"])
	return {"ok": reasons.is_empty(), "reasons": reasons}

# --- start / abandon / claim ----------------------------------------------

func start(qid: String, force := false) -> bool:
	var id := qid if quest(qid).size() > 0 else resolve_id(qid)
	var def := quest(id)
	if def.is_empty():
		return false
	if active().has(id):
		track(id)
		return true
	if not force:
		var check := can_start(id)
		if not bool(check["ok"]):
			var why: PackedStringArray = check["reasons"]
			if Game != null and Game.ui != null and why.size() > 0:
				Game.ui.call("show_hint", String(why[0]), 3.0)
			return false
	var objs: Array = def.get("objectives", [])
	var progress: Array = []
	for _o in objs:
		progress.append(0)
	active()[id] = {
		"objectives": progress,
		"spawned": [],
		"elapsed": 0.0,
		"obj_time": 0.0,
		"failures": 0,
	}
	if force and completed().has(id):
		completed().erase(id)
	track(id)
	# The audio agent's BgmDirector plays quest_start/quest_complete from the Events.
	Events.quest_started.emit(id)
	_toast("Quest started", String(def.get("title", def.get("name", id))))
	_sync_objectives(id, true)
	Log.i("QuestManager: started %s" % id)
	return true

func abandon(qid: String) -> void:
	if not active().has(qid):
		return
	_despawn_quest_entities(qid)
	active().erase(qid)
	_pending_spawns.clear()
	if String(state().get("tracked", "")) == qid:
		state()["tracked"] = ""
	Events.quest_failed.emit(qid)
	_toast("Quest abandoned", String(quest(qid).get("title", qid)))

## Claim the rewards of a completed quest. `from_npc` is the master id when the player
## turns it in through dialog; `claim_mode` TREE_OR_NPC accepts both.
func claim(qid: String, from_npc := "") -> bool:
	var def := quest(qid)
	if def.is_empty():
		return false
	if not completed().has(qid) or claimed().has(qid):
		return false
	var mode := String(def.get("claim_mode", "TREE_OR_NPC")).to_upper()
	if mode == "NPC" and from_npc != "" and String(def.get("turn_in", "")) != from_npc:
		return false
	claimed().append(qid)
	var lines := Rewards.apply_all(def.get("rewards", []), profile(), player())
	Events.quest_reward_claimed.emit(qid)
	_toast(String(def.get("title", qid)), "Rewards: " + ", ".join(lines) if lines.size() > 0 else "Rewards claimed")
	Events.stats_changed.emit()
	var saga := SagaManager.of(world)
	if saga != null and saga.has_method("on_quest_finished"):
		saga.on_quest_finished(qid)
	return true

func track(qid: String) -> void:
	state()["tracked"] = qid
	Events.quest_tracked.emit(qid)

func tracked_quest() -> String:
	return String(state().get("tracked", ""))

func progress(qid: String) -> Array:
	return active().get(qid, {}).get("objectives", [])

## Index of the objective the player is working on (sequential quests) or -1 when done.
func current_objective(qid: String) -> int:
	var def := quest(qid)
	var objs: Array = def.get("objectives", [])
	var prog: Array = progress(qid)
	for i in objs.size():
		var need := Objectives.required(objs[i])
		var have := int(prog[i]) if i < prog.size() else 0
		if have < need:
			return i
	return -1

func is_objective_open(qid: String, index: int) -> bool:
	var def := quest(qid)
	if bool(def.get("parallel_objectives", false)):
		var prog: Array = progress(qid)
		var objs: Array = def.get("objectives", [])
		if index < 0 or index >= objs.size():
			return false
		return int(prog[index]) < Objectives.required(objs[index])
	return current_objective(qid) == index

# --- progress --------------------------------------------------------------

func _set_progress(qid: String, index: int, value: int) -> void:
	var st: Dictionary = active().get(qid, {})
	if st.is_empty():
		return
	var prog: Array = st.get("objectives", [])
	if index < 0 or index >= prog.size():
		return
	var objs: Array = quest(qid).get("objectives", [])
	var need := Objectives.required(objs[index]) if index < objs.size() else 1
	var v: int = clampi(value, 0, need)
	if int(prog[index]) == v:
		return
	var was_open := is_objective_open(qid, index)
	prog[index] = v
	Events.quest_objective_progress.emit(qid, index, v, need)
	if v >= need and was_open:
		if Audio != null:
			Audio.play_sfx("pip_menu", -8.0)
		st["obj_time"] = 0.0
	_check_complete(qid)
	if active().has(qid):
		_sync_objectives(qid, false)

func _add_progress(qid: String, index: int, amount := 1) -> void:
	var prog: Array = progress(qid)
	if index < 0 or index >= prog.size():
		return
	_set_progress(qid, index, int(prog[index]) + amount)

func _check_complete(qid: String) -> void:
	if not active().has(qid):
		return
	if current_objective(qid) != -1:
		return
	var def := quest(qid)
	var gate := Requirements.time_gate(def.get("requirements", {}))
	var st: Dictionary = active()[qid]
	if gate > 0.0 and float(st.get("elapsed", 0.0)) < gate:
		return
	_complete(qid)

func _complete(qid: String) -> void:
	var def := quest(qid)
	_despawn_quest_entities(qid)
	active().erase(qid)
	if not completed().has(qid):
		completed().append(qid)
	Events.quest_completed.emit(qid)
	var turn_in := String(def.get("turn_in", ""))
	var tail := "Rewards ready in the quest log."
	if turn_in != "":
		tail = "Report back to %s." % Objectives._npc_name(turn_in)
	_toast("Quest complete", "%s — %s" % [String(def.get("title", qid)), tail])
	var saga := SagaManager.of(world)
	if saga != null and saga.has_method("on_quest_finished"):
		saga.on_quest_finished(qid)

# --- notifications ---------------------------------------------------------

func notify_kill(entity_type: String, entity_node: Node = null) -> void:
	var instance_id := entity_node.get_instance_id() if entity_node != null else 0
	for qid in active().keys().duplicate():
		var def := quest(String(qid))
		var objs: Array = def.get("objectives", [])
		for i in objs.size():
			var o: Dictionary = objs[i]
			if Objectives.kind(o) != Objectives.KILL:
				continue
			if not is_objective_open(String(qid), i):
				continue
			if not Objectives.kill_matches(o, entity_type):
				continue
			if Objectives.quest_spawned_only(o) and not _was_quest_spawned(String(qid), i, instance_id):
				continue
			_forget_spawn(String(qid), instance_id)
			_add_progress(String(qid), i, 1)
			break

func notify_talk(npc_id: String) -> void:
	if npc_id == "":
		return
	for qid in active().keys().duplicate():
		var objs: Array = quest(String(qid)).get("objectives", [])
		for i in objs.size():
			var o: Dictionary = objs[i]
			if Objectives.kind(o) != Objectives.TALK:
				continue
			if not is_objective_open(String(qid), i):
				continue
			if Objectives.matches_talk(o, npc_id):
				_add_progress(String(qid), i, 1)
				break

func notify_item(item_id: String, _count := 1) -> void:
	if item_id == "":
		return
	_refresh_obtain()

func notify_location(pos: Vector3, biome: String, planet: String) -> void:
	var ctx := context()
	if biome != "":
		ctx["biome_id"] = biome
		ctx["biome"] = Requirements.biome_tag(biome)
	if planet != "":
		ctx["planet"] = planet
	ctx["position"] = pos
	for qid in active().keys().duplicate():
		var objs: Array = quest(String(qid)).get("objectives", [])
		for i in objs.size():
			var o: Dictionary = objs[i]
			if Objectives.kind(o) != Objectives.GO_TO:
				continue
			if not is_objective_open(String(qid), i):
				continue
			if Objectives.matches_location(o, ctx):
				_add_progress(String(qid), i, Objectives.required(o))
				break

func notify_summon(dragon_id: String) -> void:
	for qid in active().keys().duplicate():
		var objs: Array = quest(String(qid)).get("objectives", [])
		for i in objs.size():
			var o: Dictionary = objs[i]
			if Objectives.kind(o) != Objectives.SUMMON:
				continue
			if not is_objective_open(String(qid), i):
				continue
			if Objectives.matches_summon(o, dragon_id):
				_add_progress(String(qid), i, 1)
				break

func notify_skill(skill_id: String, level: int) -> void:
	for qid in active().keys().duplicate():
		var objs: Array = quest(String(qid)).get("objectives", [])
		for i in objs.size():
			var o: Dictionary = objs[i]
			if Objectives.kind(o) != Objectives.SKILL:
				continue
			if not is_objective_open(String(qid), i):
				continue
			if Objectives.matches_skill(o, skill_id, level):
				_add_progress(String(qid), i, 1)
				break

## Called by the player's Interaction (or a block) when something is used.
func notify_interact(block_id: String, structure_tag := "") -> void:
	for qid in active().keys().duplicate():
		var objs: Array = quest(String(qid)).get("objectives", [])
		for i in objs.size():
			var o: Dictionary = objs[i]
			if Objectives.kind(o) != Objectives.INTERACT:
				continue
			if not is_objective_open(String(qid), i):
				continue
			if Objectives.matches_interact(o, block_id, structure_tag):
				_add_progress(String(qid), i, 1)
				break

func notify_train(tp_spent: int) -> void:
	if tp_spent <= 0:
		return
	for qid in active().keys().duplicate():
		var objs: Array = quest(String(qid)).get("objectives", [])
		for i in objs.size():
			var o: Dictionary = objs[i]
			if Objectives.kind(o) != Objectives.TRAIN:
				continue
			if not is_objective_open(String(qid), i):
				continue
			_add_progress(String(qid), i, tp_spent)
			break

## Re-read the inventory for every open OBTAIN objective (parallel quests have several).
func _refresh_obtain() -> void:
	var ctx := context()
	for qid in active().keys().duplicate():
		var objs: Array = quest(String(qid)).get("objectives", [])
		for i in objs.size():
			if not active().has(qid):
				break
			var o: Dictionary = objs[i]
			if Objectives.kind(o) != Objectives.OBTAIN:
				continue
			if not is_objective_open(String(qid), i):
				continue
			var have := Objectives.obtain_progress(o, ctx)
			var prog: Array = progress(String(qid))
			if i < prog.size() and have > int(prog[i]):
				_set_progress(String(qid), i, have)

# --- signal handlers -------------------------------------------------------

func _on_entity_died(entity: Node, killer: Node) -> void:
	if entity == null:
		return
	if entity == player():
		return
	var etype := ""
	if "entity_type" in entity:
		etype = String(entity.get("entity_type"))
	var by_player := killer != null and (killer == player() or killer == Game.player)
	var instance_id := entity.get_instance_id()
	var was_quest := _is_quest_spawn(instance_id)
	if not by_player and not was_quest:
		return
	notify_kill(etype, entity)
	var kills: Variant = profile().get("kills", null)
	if kills is Dictionary and etype != "":
		(kills as Dictionary)[etype] = int((kills as Dictionary).get(etype, 0)) + 1

func _on_player_died(_killer: Node) -> void:
	for qid in active().keys().duplicate():
		var id := String(qid)
		var idx := current_objective(id)
		if idx < 0:
			continue
		var objs: Array = quest(id).get("objectives", [])
		if idx >= objs.size() or Objectives.kind(objs[idx]) != Objectives.KILL:
			continue
		_fail(id)

func _fail(qid: String) -> void:
	var st: Dictionary = active().get(qid, {})
	if st.is_empty():
		return
	_despawn_quest_entities(qid)
	var prog: Array = st.get("objectives", [])
	for i in prog.size():
		prog[i] = 0
	st["elapsed"] = 0.0
	st["obj_time"] = 0.0
	st["failures"] = int(st.get("failures", 0)) + 1
	Events.quest_failed.emit(qid)
	_toast("Quest failed", "%s restarts." % String(quest(qid).get("title", qid)))
	_restart[qid] = FAIL_RESTART_DELAY

func _on_item_picked_up(item_id: String, count: int) -> void:
	notify_item(item_id, count)

func _on_inventory_changed() -> void:
	_refresh_obtain()

func _on_dialog_closed(npc: Node) -> void:
	notify_talk(_npc_identity(npc))

func _on_technique_learned(_id: String) -> void:
	pass

func _on_tp_changed(tp: int, _total: int) -> void:
	if _tp_prev >= 0 and tp < _tp_prev:
		notify_train(_tp_prev - tp)
	_tp_prev = tp

func _on_planet_changed(planet_id: String) -> void:
	var p := player()
	var pos := (p as Node3D).global_position if p is Node3D else Vector3.ZERO
	notify_location(pos, "", planet_id)

func _npc_identity(npc: Node) -> String:
	if npc == null or not is_instance_valid(npc):
		return ""
	for key in ["master_id", "npc_id"]:
		if key in npc and String(npc.get(key)) != "":
			return String(npc.get(key))
	if "entity_type" in npc:
		var m := Requirements.master_of_entity(String(npc.get("entity_type")))
		if m != "":
			return m
	return ""

# --- quest spawning --------------------------------------------------------

## Make sure the open objectives of `qid` have their quest-spawned enemies alive.
func _sync_objectives(qid: String, starting: bool) -> void:
	var def := quest(qid)
	var objs: Array = def.get("objectives", [])
	for i in objs.size():
		var o: Dictionary = objs[i]
		if Objectives.kind(o) != Objectives.KILL:
			continue
		if Objectives.spawn_mode(o) != "QUEST":
			continue
		if not is_objective_open(qid, i):
			continue
		if _live_spawns(qid, i) > 0:
			continue
		_pending_spawns["%s#%d" % [qid, i]] = 0.0 if starting else SPAWN_RETRY * 0.25

func _resume_active() -> void:
	for qid in active().keys().duplicate():
		var st: Dictionary = active()[qid]
		st["spawned"] = []
		_sync_objectives(String(qid), false)

func _process_spawns(delta: float) -> void:
	if _pending_spawns.is_empty():
		return
	for key in _pending_spawns.keys().duplicate():
		var t := float(_pending_spawns[key]) - delta
		if t > 0.0:
			_pending_spawns[key] = t
			continue
		var qid := String(key).get_slice("#", 0)
		var index := int(String(key).get_slice("#", 1))
		if not active().has(qid) or not is_objective_open(qid, index):
			_pending_spawns.erase(key)
			continue
		if _spawn_objective(qid, index):
			_pending_spawns.erase(key)
		else:
			_pending_spawns[key] = SPAWN_RETRY

func _spawn_objective(qid: String, index: int) -> bool:
	var objs: Array = quest(qid).get("objectives", [])
	if index < 0 or index >= objs.size():
		return true
	var o: Dictionary = objs[index]
	var p := player()
	if p == null or not is_instance_valid(p) or not (p is Node3D):
		return false
	if world == null or not is_instance_valid(world):
		return false
	var entity_id := String(o.get("entity", ""))
	if entity_id == "" or Registry == null or not Registry.entities.has(entity_id):
		Log.w("QuestManager: quest %s objective %d has unknown entity '%s'" % [qid, index, entity_id])
		return true
	var origin: Vector3 = (p as Node3D).global_position
	var pos := find_spawn_position(origin, Objectives.required_biome(o))
	var remaining: int = maxi(1, Objectives.required(o) - int(progress(qid)[index]))
	var to_spawn: int = remaining if Objectives.quest_spawned_only(o) else 1
	var spawned_any := false
	for n in mini(to_spawn, 4):
		var offset := Vector3(cos(TAU * float(n) / 4.0) * 1.5, 0.0, sin(TAU * float(n) / 4.0) * 1.5) if n > 0 else Vector3.ZERO
		var node := _spawn_enemy(entity_id, pos + offset, Objectives.stats_override(o), Objectives.ai_tier(o))
		if node == null:
			continue
		spawned_any = true
		_remember_spawn(qid, index, node, entity_id)
		if node.has_method("face"):
			node.call("face", (p as Node3D).global_position)
		elif node is Node3D:
			var to: Vector3 = (p as Node3D).global_position - (node as Node3D).global_position
			(node as Node3D).rotation.y = atan2(to.x, to.z) + PI
		if "target" in node:
			node.set("target", p)
		if node.has_method("set_target"):
			node.call("set_target", p)
	if spawned_any:
		Log.i("QuestManager: spawned %s for %s (objective %d) at %s" % [entity_id, qid, index, str(pos)])
		var label := String(o.get("entity_name", entity_id.capitalize()))
		Events.hint.emit("%s appears!" % label, 3.0)
	return spawned_any

func _spawn_enemy(entity_id: String, pos: Vector3, stats_override: Dictionary, ai_tier: int) -> Node:
	var spawner: Node = world.get_node_or_null("Spawner")
	if spawner != null and spawner.has_method("spawn_quest_enemy"):
		var n: Variant = spawner.call("spawn_quest_enemy", entity_id, pos, stats_override, ai_tier)
		if n is Node:
			return n
	if not world.has_method("spawn_entity"):
		return null
	var data := {"quest": true}
	if not stats_override.is_empty():
		data["stats_override"] = stats_override
	if ai_tier >= 0:
		data["ai_tier"] = ai_tier
	var node: Variant = world.call("spawn_entity", entity_id, pos, data)
	if node is Node and ai_tier >= 0 and "ai_tier" in node:
		(node as Node).set("ai_tier", ai_tier)
	return node as Node

## A ground position 12-20 m from `origin`, preferring a column whose biome quest_tag
## matches `biome_tag` (falls back to any direction around the player).
func find_spawn_position(origin: Vector3, biome_tag := "") -> Vector3:
	var best := Vector3.INF
	for attempt in 24:
		var angle := TAU * float(attempt) / 24.0 + randf() * 0.2
		var dist := randf_range(SPAWN_MIN_DIST, SPAWN_MAX_DIST)
		var x := origin.x + cos(angle) * dist
		var z := origin.z + sin(angle) * dist
		var pos := _ground(Vector3(x, origin.y, z))
		if pos == Vector3.INF:
			continue
		if biome_tag != "" and world != null and world.has_method("get_biome"):
			var bid := String(world.call("get_biome", int(floor(x)), int(floor(z))))
			if Requirements.biome_tag(bid) != biome_tag:
				if best == Vector3.INF:
					best = pos
				continue
		return pos
	if biome_tag != "":
		var found := _search_biome(origin, biome_tag)
		if found != Vector3.INF:
			return found
	if best != Vector3.INF:
		return best
	return origin + Vector3(SPAWN_MIN_DIST, 0.0, 0.0)

func _ground(pos: Vector3) -> Vector3:
	if world == null or not world.has_method("get_height"):
		return pos
	if world.has_method("is_area_loaded") and not bool(world.call("is_area_loaded", pos, 1.0)):
		return Vector3.INF
	var h := int(world.call("get_height", int(floor(pos.x)), int(floor(pos.z))))
	if h <= 0:
		return Vector3.INF
	return Vector3(floor(pos.x) + 0.5, float(h) + 0.05, floor(pos.z) + 0.5)

## Look through the loaded columns around the player for the required biome.
func _search_biome(origin: Vector3, biome_tag: String) -> Vector3:
	if world == null or not world.has_method("get_biome"):
		return Vector3.INF
	var cx := int(floor(origin.x / 16.0))
	var cz := int(floor(origin.z / 16.0))
	for ring in range(1, BIOME_SEARCH_COLUMNS + 1):
		for dz in range(-ring, ring + 1):
			for dx in range(-ring, ring + 1):
				if maxi(absi(dx), absi(dz)) != ring:
					continue
				var x := (cx + dx) * 16 + 8
				var z := (cz + dz) * 16 + 8
				var bid := String(world.call("get_biome", x, z))
				if bid == "" or Requirements.biome_tag(bid) != biome_tag:
					continue
				var p := _ground(Vector3(float(x), origin.y, float(z)))
				if p != Vector3.INF and p.distance_to(origin) >= SPAWN_MIN_DIST:
					return p
	return Vector3.INF

# --- spawn bookkeeping -----------------------------------------------------

func _remember_spawn(qid: String, index: int, node: Node, entity_id: String) -> void:
	var st: Dictionary = active().get(qid, {})
	if st.is_empty():
		return
	var list: Variant = st.get("spawned", null)
	if not (list is Array):
		list = []
		st["spawned"] = list
	(list as Array).append({"id": int(node.get_instance_id()), "obj": index, "entity": entity_id})

func _was_quest_spawned(qid: String, index: int, instance_id: int) -> bool:
	for e in active().get(qid, {}).get("spawned", []):
		if e is Dictionary and int((e as Dictionary).get("id", 0)) == instance_id \
				and int((e as Dictionary).get("obj", -1)) == index:
			return true
	return false

func _is_quest_spawn(instance_id: int) -> bool:
	for qid in active().keys():
		for e in active()[qid].get("spawned", []):
			if e is Dictionary and int((e as Dictionary).get("id", 0)) == instance_id:
				return true
	return false

func _forget_spawn(qid: String, instance_id: int) -> void:
	var list: Array = active().get(qid, {}).get("spawned", [])
	for i in range(list.size() - 1, -1, -1):
		var e: Variant = list[i]
		if e is Dictionary and int((e as Dictionary).get("id", 0)) == instance_id:
			list.remove_at(i)

func _live_spawns(qid: String, index: int) -> int:
	var list: Array = active().get(qid, {}).get("spawned", [])
	var n := 0
	for i in range(list.size() - 1, -1, -1):
		var e: Variant = list[i]
		if not (e is Dictionary):
			continue
		if int((e as Dictionary).get("obj", -1)) != index:
			continue
		var node: Object = instance_from_id(int((e as Dictionary).get("id", 0)))
		if node == null or not is_instance_valid(node):
			list.remove_at(i)
			continue
		if node is Node and (node as Node).get("dead") == true:
			continue
		n += 1
	return n

func _despawn_quest_entities(qid: String) -> void:
	var list: Array = active().get(qid, {}).get("spawned", [])
	for e in list:
		if not (e is Dictionary):
			continue
		var node: Object = instance_from_id(int((e as Dictionary).get("id", 0)))
		if node != null and is_instance_valid(node) and node is Node:
			(node as Node).queue_free()
	list.clear()
	for key in _pending_spawns.keys().duplicate():
		if String(key).begins_with(qid + "#"):
			_pending_spawns.erase(key)

# --- npc helpers -----------------------------------------------------------

## Quests this master hands out / takes in, split by state for the dialog.
func quests_for_npc(master_id: String) -> Dictionary:
	var gives: Array = []
	var turn_in: Array = []
	if Registry == null or master_id == "":
		return {"gives": gives, "turn_in": turn_in}
	var master: Dictionary = Registry.masters.get(master_id, {})
	var listed: Array = master.get("gives_quests", master.get("quests", []))
	var ctx := context()
	for raw in listed:
		var qid := resolve_id(String(raw))
		if qid == "":
			continue
		if completed().has(qid) and not claimed().has(qid):
			turn_in.append(qid)
		elif not active().has(qid) and not claimed().has(qid) and bool(_can_start_with(qid, ctx)["ok"]):
			gives.append(qid)
	for raw in master.get("turn_in_quests", []):
		var qid2 := resolve_id(String(raw))
		if qid2 != "" and completed().has(qid2) and not claimed().has(qid2) and not turn_in.has(qid2):
			turn_in.append(qid2)
	return {"gives": gives, "turn_in": turn_in}

## Claim every completed quest this master takes in. Returns how many were claimed.
func turn_in_all(master_id: String) -> int:
	var n := 0
	for qid in quests_for_npc(master_id)["turn_in"]:
		if claim(String(qid), master_id):
			n += 1
	return n

# --- per frame -------------------------------------------------------------

func _process(delta: float) -> void:
	if Game == null or Game.profile.is_empty():
		return
	if not Game.paused_by_ui:
		_advance_timers(delta)
		_process_spawns(delta)
	_loc_t -= delta
	if _loc_t <= 0.0:
		_loc_t = LOCATION_INTERVAL
		_poll_location()

func _advance_timers(delta: float) -> void:
	for qid in _restart.keys().duplicate():
		var t := float(_restart[qid]) - delta
		if t <= 0.0:
			_restart.erase(qid)
			if active().has(qid):
				_sync_objectives(String(qid), true)
		else:
			_restart[qid] = t
	for qid in active().keys().duplicate():
		var st: Dictionary = active()[qid]
		st["elapsed"] = float(st.get("elapsed", 0.0)) + delta
		st["obj_time"] = float(st.get("obj_time", 0.0)) + delta
		var idx := current_objective(String(qid))
		if idx >= 0:
			var objs: Array = quest(String(qid)).get("objectives", [])
			if idx < objs.size() and Objectives.kind(objs[idx]) == Objectives.WAIT:
				_set_progress(String(qid), idx, int(floor(float(st.get("obj_time", 0.0)))))
		else:
			_check_complete(String(qid))

func _poll_location() -> void:
	if active().is_empty():
		return
	var p := player()
	if p == null or not is_instance_valid(p) or not (p is Node3D):
		return
	var has_go_to := false
	for qid in active().keys():
		for o in quest(String(qid)).get("objectives", []):
			if Objectives.kind(o) == Objectives.GO_TO:
				has_go_to = true
				break
		if has_go_to:
			break
	if not has_go_to:
		return
	var pos: Vector3 = (p as Node3D).global_position
	var biome := Requirements.biome_at(world, pos)
	var planet := String(world.get("planet_id")) if world != null and world.get("planet_id") != null else ""
	notify_location(pos, biome, planet)

# --- ui helpers ------------------------------------------------------------

func _toast(title: String, text: String) -> void:
	if Game != null and Game.ui != null and Game.ui.has_method("toast"):
		Game.ui.call("toast", title, text, null)
	else:
		Events.toast.emit(title, text, null)
