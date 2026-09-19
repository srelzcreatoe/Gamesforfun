class_name StoryFlags
extends Node
## Persistent story state: named flags, counters and the in-game clock the dragon balls
## and timed quests need (docs/ARCHITECTURE.md §9).
##
## Everything lives in `Game.profile.flags` so it is saved with the character:
##   flags["_days"]            float, in-game days elapsed in this world
##   flags["<name>"]           bool / int / String set by quests, dialogs and wishes
##
## All accessors are static so tests and other systems can use them without the node.

const NODE_NAME := "StoryFlags"
const DAY_SECONDS := 1200.0            ## one in-game day = 20 real minutes (ARCHITECTURE §2)
const DAYS_KEY := "_days"

var world: Node = null

# --- node ------------------------------------------------------------------

static func of(world_node: Node) -> StoryFlags:
	if world_node == null or not is_instance_valid(world_node):
		return null
	var n: Node = world_node.get_node_or_null(NODE_NAME)
	return n as StoryFlags if n is StoryFlags else null

func _ready() -> void:
	name = NODE_NAME
	if world == null:
		world = get_parent()

func _process(delta: float) -> void:
	if Game == null or Game.profile.is_empty():
		return
	if Game.paused_by_ui:
		return
	advance_days(delta / DAY_SECONDS)

# --- flag store ------------------------------------------------------------

static func store() -> Dictionary:
	if Game == null:
		return {}
	if Game.profile.is_empty():
		return {}
	var f: Variant = Game.profile.get("flags", null)
	if not (f is Dictionary):
		f = {}
		Game.profile["flags"] = f
	return f

static func set_flag(key: String, value: Variant = true) -> void:
	var f := store()
	if f.is_empty() and (Game == null or Game.profile.is_empty()):
		return
	f[key] = value

static func flag(key: String, default: Variant = null) -> Variant:
	return store().get(key, default)

static func has_flag(key: String) -> bool:
	var v: Variant = store().get(key, null)
	if v == null:
		return false
	if v is bool:
		return v
	if v is int or v is float:
		return float(v) != 0.0
	if v is String:
		return String(v) != ""
	return true

static func clear_flag(key: String) -> void:
	store().erase(key)

static func inc(key: String, amount := 1) -> int:
	var f := store()
	var v := int(f.get(key, 0)) + amount
	f[key] = v
	return v

static func counter(key: String) -> int:
	return int(store().get(key, 0))

static func all_flags() -> Dictionary:
	return store()

# --- in-game clock ---------------------------------------------------------

## In-game days elapsed (fractional) since the character was created.
static func days() -> float:
	return float(store().get(DAYS_KEY, 0.0))

static func day_index() -> int:
	return int(floor(days()))

static func advance_days(amount: float) -> void:
	if amount <= 0.0:
		return
	var f := store()
	if f.is_empty() and (Game == null or Game.profile.is_empty()):
		return
	f[DAYS_KEY] = float(f.get(DAYS_KEY, 0.0)) + amount

## Convenience for "one in-game week from now" (dragon ball scatter timer).
static func day_index_in(days_ahead: int) -> int:
	return day_index() + days_ahead
