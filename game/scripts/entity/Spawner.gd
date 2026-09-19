class_name Spawner
extends Node
## Natural mob spawning for the World (brief §8).
##
## Every `SPAWN_INTERVAL` seconds it picks a random position inside the
## simulation distance around the player, reads the biome's `mobs` table from
## `data/biomes.json` and spawns one entity there (hostiles only at night).
## Entities further than `DESPAWN_DIST` from the player are removed, and the
## live count is capped at `MAX_ENTITIES`.
##
## `spawn_quest_enemy()` is the entry point for the quest engineer.

const SPAWN_INTERVAL := 3.0
const DESPAWN_INTERVAL := 5.0
const MAX_ENTITIES := 24
const DESPAWN_DIST := 96.0
const MIN_SPAWN_DIST := 18.0
const MAX_SPAWN_DIST := 48.0
const NIGHT_START := 13000.0
const NIGHT_END := 23000.0

var world: Node = null
var enabled := true
var max_entities := MAX_ENTITIES

var _spawn_t := 1.0
var _despawn_t := 2.0
var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	if world == null:
		world = get_parent()
	_rng.randomize()

func _process(delta: float) -> void:
	if not enabled or world == null or Game.paused_by_ui:
		return
	_spawn_t -= delta
	_despawn_t -= delta
	if _despawn_t <= 0.0:
		_despawn_t = DESPAWN_INTERVAL
		_despawn_far()
	if _spawn_t <= 0.0:
		_spawn_t = SPAWN_INTERVAL
		try_spawn()

# --- natural spawning ---------------------------------------------------------

func natural_entities() -> Array:
	var out: Array = []
	if world == null or not world.has_method("get_entities"):
		return out
	for e in world.call("get_entities"):
		if e is Entity and bool((e as Entity).spawn_data.get("natural", false)):
			out.append(e)
	return out

func try_spawn() -> Node:
	var player: Node = Game.player
	if not (player is Node3D):
		return null
	if natural_entities().size() >= max_entities:
		return null
	var center: Vector3 = (player as Node3D).global_position
	var angle := _rng.randf() * TAU
	var dist := _rng.randf_range(MIN_SPAWN_DIST, MAX_SPAWN_DIST)
	var x := center.x + cos(angle) * dist
	var z := center.z + sin(angle) * dist
	var sim_blocks := float(Game.settings.get("sim_distance", 3)) * 16.0
	if dist > maxf(sim_blocks, MIN_SPAWN_DIST + 4.0):
		return null
	if world.has_method("is_area_loaded") and not bool(world.call("is_area_loaded", Vector3(x, center.y, z), 2.0)):
		return null
	var biome := String(world.call("get_biome", int(floor(x)), int(floor(z)))) if world.has_method("get_biome") else ""
	var mobs: Array = Registry.biome(biome).get("mobs", [])
	if mobs.is_empty():
		return null
	var pick := _weighted_pick(mobs)
	if pick.is_empty():
		return null
	var entity_id := String(pick.get("entity", ""))
	if entity_id == "" or not Registry.entities.has(entity_id):
		return null
	var def := Registry.entity(entity_id)
	if _is_hostile(def) and not is_night():
		return null
	var y := float(world.call("get_height", int(floor(x)), int(floor(z)))) if world.has_method("get_height") else center.y
	if y <= 0.0:
		return null
	var pos := Vector3(floor(x) + 0.5, y, floor(z) + 0.5)
	var count := _rng.randi_range(int(pick.get("min", 1)), maxi(int(pick.get("min", 1)), int(pick.get("max", 1))))
	var first: Node = null
	for i in count:
		var offset := Vector3(_rng.randf_range(-2.0, 2.0), 0.0, _rng.randf_range(-2.0, 2.0))
		var node := _spawn(entity_id, pos + offset, {"natural": true})
		if first == null:
			first = node
	return first

func _spawn(entity_id: String, pos: Vector3, data: Dictionary) -> Node:
	if world == null or not world.has_method("spawn_entity"):
		return null
	return world.call("spawn_entity", entity_id, pos, data)

func _weighted_pick(mobs: Array) -> Dictionary:
	var total := 0.0
	for m in mobs:
		total += float(m.get("weight", 1.0))
	if total <= 0.0:
		return {}
	var r := _rng.randf() * total
	for m in mobs:
		r -= float(m.get("weight", 1.0))
		if r <= 0.0:
			return m
	return mobs[mobs.size() - 1]

static func _is_hostile(def: Dictionary) -> bool:
	return String(def.get("kind", "")) == "enemy" or String(def.get("faction", "")) == "villain"

func is_night() -> bool:
	if world == null:
		return false
	var t: Variant = world.get("time_ticks")
	if t == null:
		return false
	var ticks := float(t)
	return ticks >= NIGHT_START and ticks <= NIGHT_END

func _despawn_far() -> void:
	var player: Node = Game.player
	if not (player is Node3D):
		return
	var pp: Vector3 = (player as Node3D).global_position
	for e in natural_entities():
		var ent: Entity = e
		if ent.global_position.distance_to(pp) > DESPAWN_DIST:
			ent.queue_free()

# --- quest / scripted spawning ------------------------------------------------

## Spawn a quest enemy with overridden stats and AI tier (quest engineer entry point).
func spawn_quest_enemy(entity_id: String, pos: Vector3, stats_override: Dictionary = {}, ai_tier := -1) -> Enemy:
	var data := {"quest": true}
	if not stats_override.is_empty():
		data["stats_override"] = stats_override
	if ai_tier >= 0:
		data["ai_tier"] = ai_tier
	var node := _spawn(entity_id, pos, data)
	return node as Enemy

## Free spot near `around` at ground level, used for quest spawns.
func find_spawn_position(around: Vector3, min_dist := 6.0, max_dist := 14.0) -> Vector3:
	for i in 12:
		var a := _rng.randf() * TAU
		var d := _rng.randf_range(min_dist, max_dist)
		var x := around.x + cos(a) * d
		var z := around.z + sin(a) * d
		var y := around.y
		if world != null and world.has_method("get_height"):
			y = float(world.call("get_height", int(floor(x)), int(floor(z))))
			if y <= 0.0:
				continue
		return Vector3(floor(x) + 0.5, y, floor(z) + 0.5)
	return around + Vector3(min_dist, 0.0, 0.0)
