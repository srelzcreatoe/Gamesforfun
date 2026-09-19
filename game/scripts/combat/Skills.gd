class_name Skills
extends RefCounted
## Skill level lookups and the per-frame effects they grant (docs/ARCHITECTURE.md §8,
## data/skills.json `effect` blocks). All static: the player and every AI entity read
## the same helpers, so a skill only has to be tuned in one place.
##
## Levels come from `Game.profile.skills` for the player and from an entity method
## `skill_level(id)` (or an `skills` Dictionary property) for anyone else.

const BASE_FLY_SPEED := 12.0
const FLY_FAST_MULT := 2.2
const BASE_JUMP := 7.4
const BASE_SPRINT := 5.6
const BASE_WALK := 4.2

## Potential unlock pushes the power-release cap above 100 %.
const RELEASE_CAP_BASE := 1.0
const RELEASE_PER_POTENTIAL := 0.03

const IT_RANGE_PER_LEVEL := 32.0
const IT_KI_COST := 0.08            # fraction of max ki
const IT_COOLDOWN := 8.0

static var _it_cooldowns: Dictionary = {}

# --- levels ---------------------------------------------------------------

static func level(entity: Node, skill_id: String) -> int:
	if entity == null or not is_instance_valid(entity):
		return 0
	if entity.has_method("skill_level"):
		return int(entity.call("skill_level", skill_id))
	if "skills" in entity:
		var v: Variant = entity.get("skills")
		if v is Dictionary:
			return int((v as Dictionary).get(skill_id, 0))
	if Game != null and Game.player == entity:
		return int(Game.profile.get("skills", {}).get(skill_id, 0))
	return 0

static func has(entity: Node, skill_id: String) -> bool:
	return level(entity, skill_id) > 0

static func max_level(skill_id: String) -> int:
	var s: Dictionary = Registry.skill(skill_id)
	return int(s.get("max_level", 5))

static func effect(skill_id: String) -> Dictionary:
	var s: Dictionary = Registry.skill(skill_id)
	var e: Variant = s.get("effect", {})
	return e if e is Dictionary else {}

static func _eff(skill_id: String, key: String, fallback: float) -> float:
	return float(effect(skill_id).get(key, fallback))

# --- movement -------------------------------------------------------------

## Flight speed in m/s (fly skill). `fast` doubles it (ki "fly fast", costs stamina).
static func fly_speed(entity: Node, fast := false) -> float:
	var lvl := level(entity, "fly")
	var base := _eff("fly", "base_speed", BASE_FLY_SPEED)
	var per := _eff("fly", "speed_per_level", 0.15)
	var s := base * (1.0 + per * float(maxi(0, lvl - 1)))
	return s * (FLY_FAST_MULT if fast else 1.0)

static func can_fly(entity: Node) -> bool:
	return level(entity, "fly") > 0

static func jump_mult(entity: Node) -> float:
	return 1.0 + _eff("jump", "jump_mult_per_level", 0.1) * float(level(entity, "jump"))

static func sprint_mult(entity: Node) -> float:
	return 1.0 + _eff("sprint", "speed_per_level", 0.1) * float(level(entity, "sprint"))

## Combined movement speed multiplier (skills + stats + form).
static func speed_mult(entity: Node, sprinting := false) -> float:
	var m := 1.0
	if sprinting:
		m *= sprint_mult(entity)
	if entity != null and "stats" in entity:
		var v: Variant = entity.get("stats")
		if v is Stats:
			m *= (v as Stats).speed_mult()
	return m

# --- ki / stats -----------------------------------------------------------

## Power release cap: 100 % plus 3 % per potential_unlock level.
static func release_cap(entity: Node) -> float:
	var per := _eff("potential_unlock", "release_per_level", RELEASE_PER_POTENTIAL)
	return RELEASE_CAP_BASE + per * float(level(entity, "potential_unlock"))

## Extra passive ki regen (percent of max ki per second) from meditation.
static func meditation_regen(entity: Node) -> float:
	return _eff("meditation", "passive_ki_regen_per_level", 0.1) * float(level(entity, "meditation"))

## Fraction added to melee damage by ki_infusion / ki_manipulation.
static func melee_bonus(entity: Node) -> float:
	var b := _eff("ki_infusion", "melee_bonus_per_level", 0.05) * float(level(entity, "ki_infusion"))
	b += _eff("ki_manipulation", "melee_from_ki_per_level", 0.1) * float(level(entity, "ki_manipulation")) * 0.5
	return b

## Fraction of the target defense ignored (defense_penetration).
static func defense_pen(entity: Node) -> float:
	return _eff("defense_penetration", "per_level", 0.02) * float(level(entity, "defense_penetration"))

## Ki-sense radius in metres (0 = no sense).
static func sense_range(entity: Node) -> float:
	return _eff("ki_sense", "range_per_level", 16.0) * float(level(entity, "ki_sense"))

# --- instant transmission -------------------------------------------------

static func it_range(entity: Node) -> float:
	return _eff("instant_transmission", "range_per_level", IT_RANGE_PER_LEVEL) * float(level(entity, "instant_transmission"))

static func it_ready(entity: Node) -> bool:
	var id := entity.get_instance_id() if entity != null else 0
	return Time.get_ticks_msec() >= int(_it_cooldowns.get(id, 0))

## Teleport `entity` to `target_pos` (clamped to the skill range, snapped onto solid
## ground when the world is there). Plays the teleport sound and a white flash.
## Returns false when the skill, the ki or the cooldown says no.
static func instant_transmission(entity: Node, target_pos: Vector3) -> bool:
	if entity == null or not (entity is Node3D):
		return false
	if level(entity, "instant_transmission") <= 0 or not it_ready(entity):
		return false
	var k := Ki.get_for(entity)
	if k != null and not k.spend_fraction(IT_KI_COST):
		return false
	var node := entity as Node3D
	var from := node.global_position
	var to := target_pos
	var d := to - from
	var r := it_range(entity)
	if d.length() > r:
		to = from + d.normalized() * r
	var world: Node = entity.get("world") if "world" in entity else Game.world
	if world != null and world.has_method("get_height"):
		var h := int(world.call("get_height", int(floor(to.x)), int(floor(to.z))))
		if h > 0:
			to.y = clampf(to.y, float(h), float(h) + 40.0)
	KiEffects.teleport_flash(entity, from)
	node.global_position = to
	KiEffects.teleport_flash(entity, to)
	Audio.play_sfx_at("teleport", to)
	Audio.play_sfx_at("zanzoken", from, -4.0)
	_it_cooldowns[entity.get_instance_id()] = Time.get_ticks_msec() + int(IT_COOLDOWN * 1000.0)
	return true

# --- per frame ------------------------------------------------------------

## Apply the continuous skill effects that are not read on demand: ki_boost regen and
## the release cap clamp. Called once per frame by the player / entity controller;
## safe to call on any entity (no-op without a Ki node).
static func tick(entity: Node, delta: float) -> void:
	if entity == null or not is_instance_valid(entity):
		return
	var k := Ki.of(entity)
	if k == null:
		return
	if k.power_release > release_cap(entity):
		k.set_power_release(release_cap(entity))
	var boost := level(entity, "ki_boost")
	if boost > 0 and k.is_charging():
		k.add_ki(_eff("ki_boost", "active_regen_per_level", 0.25) * float(boost) * delta)
