class_name PlayerBase
extends Node3D
## Temporary stand-in for `scripts/entity/Entity.gd` (ARCHITECTURE.md §7), written by the entity
## engineer in parallel. It implements exactly the Entity surface the player needs so that
## `Player.gd` compiles and runs alone.
##
## INTEGRATION: when `res://scripts/entity/Entity.gd` exists, change the single line
## `extends Node3D` below to `extends Entity` and delete the members Entity already provides
## (everything between the ENTITY-CONTRACT markers). Nothing else in scripts/player/ has to change.

# --- ENTITY-CONTRACT BEGIN -------------------------------------------------
var world: Node = null
var entity_type: String = "player"
var aabb_size: Vector3 = Vector3(0.6, 1.8, 0.6)
var velocity: Vector3 = Vector3.ZERO
var on_ground: bool = false
var in_liquid: bool = false
var yaw: float = 0.0
var stats: RefCounted = null
var health: float = 100.0
var max_health: float = 100.0
var ki: float = 100.0
var max_ki: float = 100.0
var stamina: float = 100.0
var max_stamina: float = 100.0
var faction: String = "player"
var team_id: int = 0
var is_flying: bool = false
var current_form: String = ""
var model: Node3D = null
var anim: Node = null
var target: Node = null
var alive: bool = true

var _anim_name: String = ""

func aabb() -> AABB:
	return AABB(global_position - Vector3(aabb_size.x * 0.5, 0.0, aabb_size.z * 0.5), aabb_size)

func take_damage(amount: float, source: Node = null, kind := "generic", knockback := Vector3.ZERO) -> float:
	if not alive or amount <= 0.0:
		return 0.0
	var applied := amount
	health = maxf(0.0, health - applied)
	if knockback != Vector3.ZERO:
		velocity += knockback
	Events.entity_damaged.emit(self, applied, source, kind, false)
	if health <= 0.0:
		die(source)
	return applied

func heal(amount: float) -> void:
	health = clampf(health + amount, 0.0, max_health)

func die(killer: Node = null) -> void:
	if not alive:
		return
	alive = false
	Events.entity_died.emit(self, killer)

func set_target(node: Node) -> void:
	target = node
	Events.target_changed.emit(node)

func play_anim(name: String, blend := 0.15, loop := true) -> void:
	if name == _anim_name:
		return
	_anim_name = name
	if anim != null and anim.has_method("play"):
		anim.call("play", name, blend, loop)

func current_anim() -> String:
	return _anim_name

func face(pos: Vector3) -> void:
	var d := pos - global_position
	if absf(d.x) + absf(d.z) > 0.0001:
		yaw = atan2(-d.x, -d.z)

func apply_physics(delta: float) -> void:
	# The player implements its own movement; kept so the contract is complete.
	global_position += velocity * delta
# --- ENTITY-CONTRACT END ---------------------------------------------------
