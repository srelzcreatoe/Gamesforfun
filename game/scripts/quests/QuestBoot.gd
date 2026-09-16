class_name QuestBoot
extends Node
## Installs the quest subsystem under a World.
##
## Two ways to wire it up (either is enough, both are idempotent):
##   1. `World.start()` (voxel agent) calls
##        if ResourceLoader.exists("res://scripts/quests/QuestBoot.gd"):
##            load("res://scripts/quests/QuestBoot.gd").install(self)
##   2. the integrator adds it as an autoload
##        Quests="*res://scripts/quests/QuestBoot.gd"
##      in which case this node listens for `Events.world_loaded` and installs itself.
##
## Nodes created under the World: StoryFlags, QuestManager, SagaManager,
## DialogController, DragonBalls, SpaceTravel — the names the UI, the player and the
## entity code look up with `get_node_or_null`.

const SCRIPTS := {
	"StoryFlags": "res://scripts/quests/StoryFlags.gd",
	"QuestManager": "res://scripts/quests/QuestManager.gd",
	"SagaManager": "res://scripts/quests/SagaManager.gd",
	"DialogController": "res://scripts/quests/DialogController.gd",
	"DragonBalls": "res://scripts/quests/DragonBalls.gd",
	"SpaceTravel": "res://scripts/quests/SpaceTravel.gd",
}
const ORDER := ["StoryFlags", "QuestManager", "SagaManager", "DialogController", "DragonBalls", "SpaceTravel"]

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	Events.world_loaded.connect(_on_world_loaded)
	if Game != null and Game.world != null:
		QuestBoot.install(Game.world)

func _on_world_loaded(world: Node) -> void:
	QuestBoot.install(world)

## Create the missing quest nodes under `world`. Returns the QuestManager.
static func install(world: Node) -> Node:
	if world == null or not is_instance_valid(world):
		return null
	for key in ORDER:
		var path: String = String(SCRIPTS[key])
		if world.get_node_or_null(key) != null:
			continue
		if not ResourceLoader.exists(path):
			continue
		var scr: GDScript = load(path)
		if scr == null:
			continue
		var inst: Variant = scr.new()
		if not (inst is Node):
			continue
		var node: Node = inst
		node.name = key
		if "world" in node:
			node.set("world", world)
		world.add_child(node)
	return world.get_node_or_null("QuestManager")

## Convenience for tests / tools: install and return every node as a Dictionary.
static func nodes(world: Node) -> Dictionary:
	install(world)
	var out: Dictionary = {}
	if world == null or not is_instance_valid(world):
		return out
	for key in ORDER:
		out[key] = world.get_node_or_null(key)
	return out
