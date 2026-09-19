extends Node3D
## Test double for the voxel World used by the quest tests (preloaded, no class_name).
## Implements just the World API the quest subsystem calls.

var planet_id := "earth"
var seed: int = 12345
var time_ticks := 1000.0
var default_biome := "plains"
var biomes: Dictionary = {}                 ## Vector2i(chunk x, chunk z) -> biome id
var height := 64
var area_loaded := true
var spawned: Array = []
var columns: Dictionary = {}                ## Vector2i -> ChunkColumn

class FakeEntity extends Node3D:
	var entity_type := ""
	var spawn_data: Dictionary = {}
	var dead := false
	var ai_tier := 1
	var target: Node = null
	var health := 100.0

	func face(_pos: Vector3) -> void:
		pass

	func set_target(node: Node) -> void:
		target = node

	func apply_spawn_data(data: Dictionary) -> void:
		for k in data.keys():
			spawn_data[k] = data[k]

func _init() -> void:
	name = "World"

func get_biome(x: int, z: int) -> String:
	var key := Vector2i(x >> 4, z >> 4)
	return String(biomes.get(key, default_biome))

func set_biome_chunk(cx: int, cz: int, biome: String) -> void:
	biomes[Vector2i(cx, cz)] = biome

func get_height(_x: int, _z: int) -> int:
	return height

func is_area_loaded(_pos: Vector3, _radius: float) -> bool:
	return area_loaded

func get_block(_x: int, _y: int, _z: int) -> int:
	return 0

func get_column(cx: int, cz: int) -> ChunkColumn:
	return columns.get(Vector2i(cx, cz), null)

## Add a structure mark in the shape the worldgen agent writes.
func add_structure(cx: int, cz: int, structure_id: String, pos := Vector3.ZERO) -> void:
	var key := Vector2i(cx, cz)
	var col: ChunkColumn = columns.get(key, null)
	if col == null:
		col = ChunkColumn.new(cx, cz)
		columns[key] = col
	col.structure_marks.append({"id": structure_id, "pos": pos})

func spawn_entity(entity_type: String, pos: Vector3, data := {}) -> Node:
	var e := FakeEntity.new()
	e.entity_type = entity_type
	e.name = entity_type
	e.apply_spawn_data(data)
	if data.has("ai_tier"):
		e.ai_tier = int(data["ai_tier"])
	add_child(e)
	e.global_position = pos
	spawned.append(e)
	Events.entity_spawned.emit(e)
	return e
