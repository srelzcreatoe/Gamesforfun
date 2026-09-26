class_name ContainerStore
extends RefCounted
## Block-bound storage: chests (27 slots) and furnaces, keyed "planet:x:y:z".
## Persistence: through `Game.world.get_column(cx, cz).extra["containers"]` when the voxel engine exposes
## `extra` on ChunkColumn, otherwise through `Game.profile["containers"]`. Both paths share this in-memory map.

const CHEST_SIZE := 27

var chests: Dictionary = {}     # key -> Inventory
var furnaces: Dictionary = {}   # key -> FurnaceStore
var planet: String = "earth"

static func key_for(planet_id: String, pos: Vector3i) -> String:
	return "%s:%d:%d:%d" % [planet_id, pos.x, pos.y, pos.z]

func _key(pos: Vector3i) -> String:
	return key_for(planet, pos)

func has_container(pos: Vector3i) -> bool:
	var k := _key(pos)
	return chests.has(k) or furnaces.has(k)

func get_chest(pos: Vector3i, size := CHEST_SIZE) -> Inventory:
	var k := _key(pos)
	if not chests.has(k):
		var inv := Inventory.new(size, false)
		_load_into(k, inv, null)
		chests[k] = inv
	return chests[k]

func get_furnace(pos: Vector3i) -> FurnaceStore:
	var k := _key(pos)
	if not furnaces.has(k):
		var f := FurnaceStore.new()
		_load_into(k, null, f)
		furnaces[k] = f
	return furnaces[k]

## Remove a container (block broken) and return its stacks for dropping.
func remove_at(pos: Vector3i) -> Array[ItemStack]:
	var k := _key(pos)
	var out: Array[ItemStack] = []
	if chests.has(k):
		out.append_array(chests[k].non_empty())
		chests.erase(k)
	if furnaces.has(k):
		out.append_array(furnaces[k].all_stacks())
		furnaces.erase(k)
	_erase_persisted(k)
	return out

func tick(delta: float) -> void:
	for f in furnaces.values():
		f.tick(delta)

# --- persistence -----------------------------------------------------------------

func _column_extra(k: String) -> Dictionary:
	## Returns the ChunkColumn.extra dictionary that owns this key, or {} when unavailable.
	if Game == null or Game.world == null or not Game.world.has_method("get_column"):
		return {}
	var parts := k.split(":")
	if parts.size() != 4:
		return {}
	var x := int(parts[1])
	var z := int(parts[3])
	var col: Variant = Game.world.get_column(x >> 4, z >> 4)
	if col == null:
		return {}
	var extra: Variant = col.get("extra")
	if extra is Dictionary:
		if not extra.has("containers"):
			extra["containers"] = {}
		return extra
	return {}

func _profile_store() -> Dictionary:
	if Game == null:
		return {}
	if not Game.profile.has("containers"):
		Game.profile["containers"] = {}
	return Game.profile["containers"]

func _load_into(k: String, inv: Inventory, furnace: FurnaceStore) -> void:
	var data: Variant = null
	var extra := _column_extra(k)
	if not extra.is_empty() and extra["containers"].has(k):
		data = extra["containers"][k]
	else:
		var ps := _profile_store()
		if ps.has(k):
			data = ps[k]
	if data is Dictionary:
		if inv != null and data.has("slots"):
			inv.from_dict(data)
		if furnace != null and data.get("type", "") == "furnace":
			furnace.from_dict(data)

func _erase_persisted(k: String) -> void:
	var extra := _column_extra(k)
	if not extra.is_empty():
		extra["containers"].erase(k)
		_mark_column_modified(k)
	var ps := _profile_store()
	ps.erase(k)

func _mark_column_modified(k: String) -> void:
	if Game == null or Game.world == null or not Game.world.has_method("get_column"):
		return
	var parts := k.split(":")
	var col: Variant = Game.world.get_column(int(parts[1]) >> 4, int(parts[3]) >> 4)
	if col != null and col.get("modified") != null:
		col.set("modified", true)

## Write every open container to its column (when supported) or to the profile.
func save_all() -> void:
	for k in chests.keys():
		_persist(k, chests[k].to_dict(), chests[k].non_empty().is_empty())
	for k in furnaces.keys():
		_persist(k, furnaces[k].to_dict(), furnaces[k].is_empty())

func _persist(k: String, d: Dictionary, empty: bool) -> void:
	var extra := _column_extra(k)
	if not extra.is_empty():
		if empty:
			extra["containers"].erase(k)
		else:
			extra["containers"][k] = d
		_mark_column_modified(k)
		var ps := _profile_store()
		ps.erase(k)
		return
	var ps := _profile_store()
	if empty:
		ps.erase(k)
	else:
		ps[k] = d

func to_dict() -> Dictionary:
	save_all()
	return _profile_store().duplicate(true)
