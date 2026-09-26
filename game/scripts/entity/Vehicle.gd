class_name Vehicle
extends Entity
## Space pod / nimbus style rideable prop. It is a static prop until the player
## interacts with it; interacting raises `Events.travel_requested` for the quests
## engineer's SpaceTravel (space pod / ship) or simply mounts the player.

var vehicle_kind := "space_pod"
var destination := ""
var open := true

func _configure() -> void:
	faction = "neutral"
	vehicle_kind = String(def.get("vehicle", spawn_data.get("vehicle", "space_pod")))
	destination = String(spawn_data.get("destination", def.get("destination", "")))
	play_anim("idle")

func tick(delta: float) -> void:
	apply_physics(delta)

func take_damage(_amount: float, _source: Node = null, _kind_of := "melee", _knockback := Vector3.ZERO) -> float:
	return 0.0

func interact(_player: Node = null) -> void:
	if not open:
		return
	if Audio != null:
		Audio.play_sfx_at("spaceship_door", global_position, -2.0)
	if destination != "":
		Events.travel_requested.emit(destination)
	else:
		Events.hint.emit("Choose a destination", 2.0)
		Events.travel_requested.emit("")
