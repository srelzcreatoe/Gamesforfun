class_name DialogController
extends Node
## Drives NPC conversations (docs/ARCHITECTURE.md §9): opens the UI dialog on
## `Events.dialog_requested`, hands out / turns in quests, teaches the master's
## `teaches` list for TP and offers simple item barter to traders.
##
## Dragons (shenron/porunga/...) raise the same signal, so this is also where a
## dragon interaction re-opens the wish screen.

const NODE_NAME := "DialogController"
const MASTER_SKILL_COST := 900            ## fallback when skills.json has no positive cost
const MASTER_TECHNIQUE_COST := 1500
const TRAIN_INTERCEPT_WINDOW := 1.5       ## seconds after a dialog opened that "stats" means "train"

## Item barter offers (DMZ has no currency). give -> get.
const BARTER := [
	{"give": {"item": "senzu_bean", "count": 1}, "get": {"item": "kikono_shard", "count": 8}},
	{"give": {"item": "kikono_shard", "count": 12}, "get": {"item": "senzu_bean", "count": 1}},
	{"give": {"item": "iron_ingot", "count": 8}, "get": {"item": "radar_piece", "count": 1}},
]

var world: Node = null
var intercept_train := true
var current_npc: Node = null
var current_master := ""

var _dialog_t := 0.0
var _menu: TrainMenu = null

static func of(world_node: Node) -> DialogController:
	if world_node == null or not is_instance_valid(world_node):
		return null
	var n: Node = world_node.get_node_or_null(NODE_NAME)
	return n as DialogController if n is DialogController else null

func _ready() -> void:
	name = NODE_NAME
	if world == null:
		world = get_parent()
	Events.dialog_requested.connect(_on_dialog_requested)
	Events.dialog_closed.connect(_on_dialog_closed)
	Events.ui_opened.connect(_on_ui_opened)

func _process(delta: float) -> void:
	if _dialog_t > 0.0:
		_dialog_t = maxf(0.0, _dialog_t - delta)

# --- dialog ----------------------------------------------------------------

func _on_dialog_requested(npc: Node) -> void:
	if npc == null or not is_instance_valid(npc):
		return
	if _is_dragon(npc):
		_open_wish(npc)
		return
	current_npc = npc
	current_master = master_id_of(npc)
	_dialog_t = TRAIN_INTERCEPT_WINDOW
	var qm := QuestManager.of(world)
	if qm != null and current_master != "":
		qm.notify_talk(current_master)
		var turned := qm.turn_in_all(current_master)
		if turned > 0 and Audio != null:
			Audio.play_sfx("quest_complete", -4.0)
		var offers: Array = qm.quests_for_npc(current_master)["gives"]
		if offers.size() > 0:
			Events.hint.emit("%s has a request for you." % _master_name(current_master), 4.0)
	open_dialog(npc)

func open_dialog(npc: Node) -> void:
	if Game == null or Game.ui == null:
		return
	var mid := master_id_of(npc)
	var args := {"npc": npc, "master": mid}
	var qm := QuestManager.of(world)
	if qm != null and mid != "":
		var lists: Dictionary = qm.quests_for_npc(mid)
		args["quests"] = (lists["gives"] as Array) + (lists["turn_in"] as Array)
	Game.ui.call("open", "dialog", args)

func _on_dialog_closed(npc: Node) -> void:
	if npc != null and is_instance_valid(npc) and npc == current_npc:
		current_npc = null
	_dialog_t = 0.0

## `DialogScreen`'s Train button falls back to the stats screen; turn that into the
## master's own training menu while a master dialog is open.
func _on_ui_opened(screen: String) -> void:
	if not intercept_train or screen != "stats":
		return
	if _dialog_t <= 0.0 or current_master == "":
		return
	var m: Dictionary = Registry.masters.get(current_master, {}) if Registry != null else {}
	if not bool(m.get("trains", false)):
		return
	if teach_options(current_master).is_empty() and shop_offers(current_master).is_empty():
		return
	var mid := current_master
	call_deferred("_swap_to_training", mid)

func _swap_to_training(mid: String) -> void:
	if Game != null and Game.ui != null and Game.ui.has_method("close"):
		Game.ui.call("close", "stats")
	open_training(mid)

func master_id_of(npc: Node) -> String:
	if npc == null or not is_instance_valid(npc):
		return ""
	if "master_id" in npc and String(npc.get("master_id")) != "":
		return String(npc.get("master_id"))
	if "entity_type" in npc and Registry != null:
		var def: Dictionary = Registry.entity(String(npc.get("entity_type")))
		var mid := String(def.get("master", ""))
		if mid != "":
			return mid
	if "npc_id" in npc:
		var nid := String(npc.get("npc_id"))
		if Registry != null and Registry.masters.has(nid):
			return nid
	return ""

func _master_name(mid: String) -> String:
	if Registry == null:
		return mid.capitalize()
	return String(Registry.masters.get(mid, {}).get("name", mid.capitalize()))

func _is_dragon(npc: Node) -> bool:
	if "dragon_id" in npc:
		return true
	if "entity_type" in npc and Registry != null:
		return String(Registry.entity(String(npc.get("entity_type"))).get("kind", "")) == "dragon"
	return false

func _open_wish(npc: Node) -> void:
	var balls := DragonBalls.of(world)
	var did := ""
	if "dragon_id" in npc:
		did = String(npc.get("dragon_id"))
	if did == "" and "entity_type" in npc:
		did = String(npc.get("entity_type"))
	if Game == null or Game.ui == null or did == "":
		return
	var args := {"dragon": did}
	if balls != null:
		args["callback"] = Callable(balls, "on_wish_chosen")
	Game.ui.call("open", "wish", args)

# --- training --------------------------------------------------------------

func open_training(mid: String) -> void:
	if mid == "":
		return
	if _menu != null and is_instance_valid(_menu):
		_menu.queue_free()
	_menu = TrainMenu.new()
	_menu.controller = self
	_menu.master_id = mid
	add_child(_menu)

func player() -> Node:
	return Game.player if Game != null else null

func tp() -> int:
	if Game == null:
		return 0
	return int(Game.profile.get("tp", 0))

## What this master can still teach: [{kind, id, name, cost, level, max_level, affordable}]
func teach_options(mid: String) -> Array:
	var out: Array = []
	if Registry == null or mid == "":
		return out
	var m: Dictionary = Registry.masters.get(mid, {})
	var skills: Array = m.get("teaches_skills", [])
	var techniques: Array = m.get("teaches_techniques", [])
	if skills.is_empty() and techniques.is_empty():
		for t in m.get("teaches", []):
			if Registry.skills.has(String(t)):
				skills.append(t)
			elif Registry.techniques.has(String(t)):
				techniques.append(t)
	var have_tp := tp()
	var profile: Dictionary = Game.profile if Game != null else {}
	var known_skills: Dictionary = profile.get("skills", {})
	var known_tech: Array = profile.get("techniques", [])
	for raw in skills:
		var sid := String(raw)
		var def: Dictionary = Registry.skill(sid)
		if def.is_empty():
			continue
		var level := int(known_skills.get(sid, 0))
		var max_level := int(def.get("max_level", 1))
		if level >= max_level:
			continue
		var cost := skill_cost(sid, level)
		out.append({"kind": "skill", "id": sid, "name": String(def.get("name", sid.capitalize())),
			"cost": cost, "level": level, "max_level": max_level, "affordable": have_tp >= cost})
	for raw in techniques:
		var tid := String(raw)
		var def2: Dictionary = Registry.technique(tid)
		if def2.is_empty() or known_tech.has(tid):
			continue
		var cost2 := technique_cost(tid)
		out.append({"kind": "technique", "id": tid, "name": String(def2.get("name", tid.capitalize())),
			"cost": cost2, "level": 0, "max_level": 1, "affordable": have_tp >= cost2})
	return out

func skill_cost(skill_id: String, level: int) -> int:
	var def: Dictionary = Registry.skill(skill_id) if Registry != null else {}
	var costs: Array = def.get("tp_costs", [])
	if level < costs.size() and int(costs[level]) > 0:
		return int(costs[level])
	return MASTER_SKILL_COST * (level + 1)

func technique_cost(technique_id: String) -> int:
	var def: Dictionary = Registry.technique(technique_id) if Registry != null else {}
	var cost := int(def.get("tp_cost", 0))
	return cost if cost > 0 else MASTER_TECHNIQUE_COST

## Buy one skill level / one technique from a master. Returns false when the TP is short.
func teach(mid: String, kind: String, id: String) -> bool:
	var p := player()
	var profile: Dictionary = Game.profile if Game != null else {}
	if profile.is_empty():
		return false
	if kind == "skill":
		var level := int(profile.get("skills", {}).get(id, 0))
		var cost := skill_cost(id, level)
		if not _spend(p, profile, cost):
			return _deny()
		var skills: Dictionary = profile.get("skills", {})
		skills[id] = level + 1
		profile["skills"] = skills
		Events.skill_changed.emit(id, level + 1)
		_learned("%s taught you %s (level %d)" % [_master_name(mid), Requirements.skill_name(id), level + 1])
		return true
	if kind == "technique":
		var cost2 := technique_cost(id)
		var known: Array = profile.get("techniques", [])
		if known.has(id):
			return false
		if not _spend(p, profile, cost2):
			return _deny()
		known.append(id)
		profile["techniques"] = known
		Events.technique_learned.emit(id)
		_learned("%s taught you %s" % [_master_name(mid), String(Registry.technique(id).get("name", id)) if Registry != null else id])
		return true
	return false

func _spend(p: Node, profile: Dictionary, cost: int) -> bool:
	if cost <= 0:
		return true
	if p != null and is_instance_valid(p) and ResourceLoader.exists("res://scripts/combat/Training.gd"):
		return Training.spend(p, cost)
	if int(profile.get("tp", 0)) < cost:
		return false
	profile["tp"] = int(profile.get("tp", 0)) - cost
	Events.tp_changed.emit(int(profile["tp"]), int(profile.get("tp_total", 0)))
	return true

func _deny() -> bool:
	Events.hint.emit("Not enough training points.", 2.5)
	if Audio != null:
		Audio.play_sfx("error", -8.0)
	return false

func _learned(text: String) -> void:
	if Audio != null:
		Audio.play_sfx("skill_learned", -3.0)
	if Game != null and Game.ui != null:
		Game.ui.call("toast", "Training", text, null)
	else:
		Events.toast.emit("Training", text, null)

# --- barter ----------------------------------------------------------------

## Trades a trader offers, with the ones the player can afford marked in the text.
func shop_offers(mid: String) -> Array:
	if Registry == null or mid == "":
		return []
	var m: Dictionary = Registry.masters.get(mid, {})
	var is_trader := String(m.get("entity", "")).contains("trader") or mid == "bulma" or mid == "toribot"
	if not is_trader:
		return []
	var out: Array = []
	for offer in BARTER:
		var give: Dictionary = offer["give"]
		var get_it: Dictionary = offer["get"]
		if not Registry.has_item(String(give["item"])) or not Registry.has_item(String(get_it["item"])):
			continue
		out.append({
			"give": give, "get": get_it,
			"text": "%d %s  ->  %d %s" % [int(give["count"]), Requirements.item_name(String(give["item"])),
				int(get_it["count"]), Requirements.item_name(String(get_it["item"]))],
		})
	return out

func trade(mid: String, index: int) -> bool:
	var offers := shop_offers(mid)
	if index < 0 or index >= offers.size():
		return false
	var offer: Dictionary = offers[index]
	var give: Dictionary = offer["give"]
	var get_it: Dictionary = offer["get"]
	var p := player()
	if p == null or not is_instance_valid(p) or not ("inventory" in p):
		return false
	var inv: Variant = p.get("inventory")
	if inv == null or not is_instance_valid(inv as Object):
		return false
	if not bool((inv as Object).call("has", String(give["item"]), int(give["count"]))):
		Events.hint.emit("You do not have %s." % Requirements.item_name(String(give["item"])), 2.5)
		return false
	(inv as Object).call("remove", String(give["item"]), int(give["count"]))
	if p.has_method("give"):
		p.call("give", String(get_it["item"]), int(get_it["count"]))
	if Audio != null:
		Audio.play_sfx("item_pickup", -4.0)
	Events.toast.emit("Trade", String(offer["text"]), null)
	return true
