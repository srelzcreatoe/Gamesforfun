class_name Enemy
extends Entity
## Hostile entity: drives `EnemyAI`, handles tier reactions (dodge / block +
## counter), boss music + taunts and multi-phase bosses (brief §6).

const DODGE_CHANCE := 0.30
const BLOCK_CHANCE := 0.30
const BLOCK_REDUCTION := 0.35

var ai: EnemyAI = null
var is_boss := false
var phases: Array = []
var phase_index := 0
var taunt := ""
var bgm := ""
var counter_queued := false
var dodge_cd := 0.0

static var _director: Object = null
static var _director_checked := false

func _configure() -> void:
	faction = String(def.get("faction", "villain"))
	taunt = String(def.get("taunt", ""))
	bgm = String(def.get("bgm", ""))
	is_boss = bgm == "boss" or bool(def.get("boss", false))
	phases = def.get("phases", [])
	phase_index = int(spawn_data.get("phase_index", 0))
	if spawn_data.has("ai_tier"):
		ai_tier = int(spawn_data["ai_tier"])
	ai = EnemyAI.new(self)
	if spawn_data.has("target"):
		set_target(spawn_data["target"])
		ai.provoke(target)

func tick(delta: float) -> void:
	dodge_cd = maxf(0.0, dodge_cd - delta)
	if ai != null and ai_enabled():
		ai.tick(delta)
	apply_physics(delta)

func ai_state() -> String:
	return ai.state_name() if ai != null else "NONE"

# --- reactions ----------------------------------------------------------------

func take_damage(amount: float, source: Node = null, kind_of := "melee", knockback := Vector3.ZERO) -> float:
	if dead or invuln > 0.0 or amount <= 0.0:
		return 0.0
	if ai_tier >= 2 and dodge_cd <= 0.0 and randf() < DODGE_CHANCE and kind_of == "melee":
		_dodge(source)
		return 0.0
	var reduced := amount
	if ai_tier >= 3 and randf() < BLOCK_CHANCE:
		reduced *= BLOCK_REDUCTION
		play_upper_anim("base.block", 0.05)
		counter_queued = true
		if Audio != null:
			Audio.play_sfx_at("block", global_position, -2.0)
	var applied := super.take_damage(reduced, source, kind_of, knockback)
	if applied > 0.0 and ai != null and source != null:
		ai.provoke(source)
		if counter_queued and not dead:
			counter_queued = false
			ai.set_state(EnemyAI.ATTACK)
			ai.attack_cd = 0.0
	return applied

func _dodge(source: Node) -> void:
	dodge_cd = 1.2
	invuln = 0.35
	var side := 1.0 if randf() < 0.5 else -1.0
	var clip := "base.evasion_right" if side > 0.0 else "base.evasion_left"
	if anim != null and not anim.has_clip(clip):
		clip = "base.dodge_back"
	play_anim(clip, 0.05, false)
	var right := Vector3(cos(yaw), 0.0, -sin(yaw))
	velocity += right * side * 5.0
	if source is Node3D:
		face((source as Node3D).global_position)
	if ai != null:
		ai.provoke(source)

## The music is NOT driven from here: `scripts/audio/BgmDirector.gd` owns the
## context (it needs its hysteresis, and "explore" is not a valid context on every
## planet). It reacts to Events.boss_engaged/boss_defeated plus its own aggro scan,
## which reads `faction`, `kind`, `is_boss`, `target` and `ai.aggro` / `ai_state()`.
func on_aggro() -> void:
	if taunt != "":
		Events.toast.emit(display_name, taunt, null)
	if is_boss:
		Events.boss_engaged.emit(self)

# --- death / phases -----------------------------------------------------------

func die(killer: Node = null) -> void:
	if dead:
		return
	if _advance_phase():
		return
	if is_boss:
		Events.boss_defeated.emit(self)
	super.die(killer)

## Boss phases: spawn the next phase entity in place, heal it and play the
## transformation cinematic when the fx agent's director is available.
func _advance_phase() -> bool:
	if phases.is_empty() or phase_index >= phases.size():
		return false
	var next_id := String(phases[phase_index])
	if not Registry.entities.has(next_id):
		return false
	var pos := global_position
	var data := {
		"phase_index": phase_index + 1,
		"ai_tier": ai_tier,
		"target": target,
	}
	var next: Node = null
	if world != null and world.has_method("spawn_entity"):
		next = world.call("spawn_entity", next_id, pos, data)
	if next == null:
		return false
	if next is Entity:
		var e: Entity = next
		e.yaw = yaw
		e.rotation.y = yaw
		e.health = e.max_health
		if e is Enemy:
			(e as Enemy).phase_index = phase_index + 1
	_play_transformation(next, next_id)     # Events.transformation_started drives the music
	Events.toast.emit(display_name, "%s transforms!" % display_name, null)
	dead = true
	health = 0.0
	queue_free()
	return true

static func _transformation_director() -> Object:
	if not _director_checked:
		_director_checked = true
		if ResourceLoader.exists("res://scripts/fx/TransformationDirector.gd"):
			_director = load("res://scripts/fx/TransformationDirector.gd")
	return _director

func _play_transformation(node: Node, id: String) -> void:
	var d := _transformation_director()
	if d == null or not d.has_method("play_for"):
		Events.transformation_started.emit(node, id)
		Events.transformation_finished.emit(node, id)
		return
	d.call("play_for", node, id)
