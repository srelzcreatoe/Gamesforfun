class_name EnemyAI
extends RefCounted
## Hostile behaviour state machine (docs/ARCHITECTURE.md §7, brief §6).
##
##   IDLE --(timer)--> WANDER --(player within AGGRO_DIST or damaged)--> CHASE
##   CHASE --(within KEEP_DIST)--> ATTACK --(target lost/dead)--> WANDER
##   ATTACK/CHASE --(tier >= 2 and hp < 20%)--> RETREAT --(healed/timer)--> CHASE
##
## Attacks: a 3 hit melee combo whose damage lands at 40 % of the clip, a ki
## blast at 6-20 m every 2-4 s and, for tier >= 2, a beam with a 1.2 s telegraph.
## Techniques are delegated to `scripts/combat/Techniques.gd` when it exists and
## fall back to `SimpleProjectile`.

enum { IDLE, WANDER, CHASE, ATTACK, RETREAT, DEAD }

const AGGRO_DIST := 24.0
const KEEP_DIST := 2.0
const MELEE_REACH := 2.8
const LOSE_DIST := 40.0
const BLAST_MIN := 6.0
const BLAST_MAX := 20.0
const BEAM_TELEGRAPH := 1.2
const TIER1_WINDUP := 0.6
const COMBO_CLIPS := ["base.jab_right", "base.jab_left", "base.combo_1", "base.attack1", "attack"]

var e: Entity = null
var state := IDLE
var state_time := 0.0
var wander_point := Vector3.ZERO
var wander_wait := 0.0
var blast_cd := 3.0
var combo_index := 0
var attack_cd := 0.0
var swing_time := -1.0            # seconds until the current swing lands
var swing_kind := "melee"
var windup := 0.0
var beam_time := -1.0
var beam_id := ""
var beam_delegated := false
var aggro := false
var home := Vector3.ZERO

static var _techniques: Object = null
static var _tech_checked := false

func _init(owner_entity: Entity) -> void:
	e = owner_entity
	home = e.global_position
	wander_point = home
	blast_cd = randf_range(2.0, 4.0)

func state_name() -> String:
	match state:
		IDLE: return "IDLE"
		WANDER: return "WANDER"
		CHASE: return "CHASE"
		ATTACK: return "ATTACK"
		RETREAT: return "RETREAT"
	return "DEAD"

func set_state(s: int) -> void:
	if state == s:
		return
	state = s
	state_time = 0.0
	match s:
		IDLE:
			e.play_anim("idle")
		WANDER:
			e.play_anim("walk")
		CHASE:
			e.play_anim("run" if e.anim != null and e.anim.has_clip("run") else "walk")
		RETREAT:
			e.is_flying = e.can_fly
			e.play_anim("fly_fast" if e.can_fly else "run")
		DEAD:
			pass

func tick(delta: float) -> void:
	if e == null or e.dead:
		set_state(DEAD)
		return
	state_time += delta
	attack_cd = maxf(0.0, attack_cd - delta)
	blast_cd = maxf(0.0, blast_cd - delta)
	if swing_time >= 0.0:
		swing_time -= delta
		if swing_time <= 0.0:
			swing_time = -1.0
			_land_hit()
	if beam_time >= 0.0:
		beam_time -= delta
		if beam_time <= 0.0:
			beam_time = -1.0
			_fire_beam()
	_acquire_target()
	match state:
		IDLE:
			if state_time > randf_range(2.0, 5.0):
				set_state(WANDER)
		WANDER:
			_wander(delta)
		CHASE:
			_chase(delta)
		ATTACK:
			_attack(delta)
		RETREAT:
			_retreat(delta)

# --- targeting ----------------------------------------------------------------

func _acquire_target() -> void:
	if e.target != null and e.target is Entity and not (e.target as Entity).is_alive():
		e.target = null
	if e.target == null:
		var p: Node = Game.player
		if p is Node3D:
			var d := e.global_position.distance_to((p as Node3D).global_position)
			if d <= AGGRO_DIST or aggro:
				e.set_target(p)
				if not aggro:
					aggro = true
					e.on_aggro()
	if e.target != null:
		var dist := e.global_position.distance_to(e.target.global_position)
		if dist > LOSE_DIST:
			e.target = null
			aggro = false
			set_state(WANDER)
		elif state == IDLE or state == WANDER:
			set_state(CHASE)

func provoke(source: Node) -> void:
	if source is Node3D:
		e.set_target(source)
	if not aggro:
		aggro = true
		e.on_aggro()
	if state == IDLE or state == WANDER:
		set_state(CHASE)

# --- states -------------------------------------------------------------------

func _wander(delta: float) -> void:
	if wander_wait > 0.0:
		wander_wait -= delta
		if e.anim != null and e.current_anim().ends_with("walk"):
			e.play_anim("idle")
		return
	var flat := Vector2(wander_point.x - e.global_position.x, wander_point.z - e.global_position.z)
	if flat.length() < 0.8 or state_time > 12.0:
		wander_point = home + Vector3(randf_range(-8.0, 8.0), 0.0, randf_range(-8.0, 8.0))
		wander_wait = randf_range(1.5, 4.0)
		state_time = 0.0
		e.play_anim("idle")
		return
	e.play_anim("walk")
	_step_toward(wander_point, 1.6 * e.speed_mult, delta)

func _chase(delta: float) -> void:
	if e.target == null:
		set_state(WANDER)
		return
	var tp: Vector3 = e.target.global_position
	var dist := e.global_position.distance_to(tp)
	e.look_at_head(tp + Vector3(0, 1.4, 0))
	if _maybe_retreat():
		return
	if dist <= KEEP_DIST + 0.6:
		set_state(ATTACK)
		return
	if e.can_fly and (tp.y - e.global_position.y) > 2.5:
		e.is_flying = true
		e.play_anim("fly_front")
	var speed := 4.2 * e.speed_mult * (1.0 if not e.is_flying else 1.6)
	_step_toward(tp, speed, delta)
	if dist > BLAST_MIN and dist < BLAST_MAX and blast_cd <= 0.0:
		_start_ranged(dist)

func _attack(delta: float) -> void:
	if e.target == null:
		set_state(WANDER)
		return
	var tp: Vector3 = e.target.global_position
	var dist := e.global_position.distance_to(tp)
	e.face(tp, false, 6.0, delta)
	e.look_at_head(tp + Vector3(0, 1.4, 0))
	if _maybe_retreat():
		return
	if dist > MELEE_REACH + 1.0:
		set_state(CHASE)
		return
	if dist < KEEP_DIST - 0.4:
		_step_toward(e.global_position * 2.0 - tp, 1.5, delta)
	if windup > 0.0:
		windup -= delta
		return
	if attack_cd <= 0.0 and swing_time < 0.0:
		_start_melee()

func _retreat(delta: float) -> void:
	if e.target == null or state_time > 6.0 or e.health > e.max_health * 0.4:
		e.is_flying = false
		set_state(CHASE)
		return
	var away := (e.global_position - e.target.global_position).normalized()
	if away == Vector3.ZERO:
		away = Vector3.FORWARD
	var goal := e.global_position + away * 6.0 + Vector3(0, 2.0 if e.can_fly else 0.0, 0)
	_step_toward(goal, 7.0 * e.speed_mult, delta)
	e.face(e.target.global_position, false, 3.0, delta)
	if state_time > 1.5 and e.health < e.max_health:
		e.heal(e.max_health * 0.06 * delta)
		if not e.current_anim().ends_with("ki_charge"):
			e.play_anim("ki_charge")
			Events.ki_charge_changed.emit(e, true)

func _maybe_retreat() -> bool:
	if e.ai_tier >= 2 and e.health < e.max_health * 0.2 and state != RETREAT:
		set_state(RETREAT)
		return true
	return false

func _step_toward(goal: Vector3, speed: float, delta: float) -> void:
	var d := goal - e.global_position
	d.y = 0.0
	if d.length() < 0.05:
		return
	d = d.normalized()
	e.face(goal, false, 7.0, delta)
	e.velocity.x = d.x * speed
	e.velocity.z = d.z * speed
	if e.is_flying:
		var dy := goal.y - e.global_position.y
		e.velocity.y = clampf(dy * 2.0, -speed, speed)
	elif e.on_ground and randf() < delta * 0.5 and e.velocity.length() < 0.2:
		e.velocity.y = 6.0                      # small hop when stuck

# --- attacks ------------------------------------------------------------------

func _start_melee() -> void:
	var clip := ""
	if e.anim != null:
		for c in COMBO_CLIPS:
			if e.anim.has_clip(c):
				clip = c
				break
	var length := 0.6
	if clip != "":
		e.play_upper_anim(clip, 0.06)
		length = maxf(e.anim.clip_length(clip), 0.4)
	windup = TIER1_WINDUP if e.ai_tier <= 1 else 0.12
	swing_time = windup + length * 0.4
	swing_kind = "melee"
	attack_cd = windup + length + (0.55 if e.ai_tier >= 2 else 0.9)
	combo_index = (combo_index + 1) % 3
	e._play_sound("attack")

func _land_hit() -> void:
	if e.target == null or not (e.target is Entity):
		return
	var t: Entity = e.target
	if not t.is_alive():
		return
	if swing_kind == "melee":
		var to := t.global_position - e.global_position
		if to.length() > MELEE_REACH + 0.6:
			return
		var kb := to.normalized() * 4.0 + Vector3(0, 2.2, 0)
		t.take_damage(e.melee_damage, e, "melee", kb)
		Events.screen_shake.emit(0.18, 0.12)

func _start_ranged(dist: float) -> void:
	blast_cd = randf_range(2.0, 4.0)
	if e.ai_tier >= 2 and dist > 8.0 and randf() < 0.35:
		_begin_beam()
		return
	var blast_id := _technique_of_kind("blast")
	if blast_id != "" and _tap_technique(blast_id):
		return
	_spawn_placeholder(e.melee_damage * 0.9, 24.0)

func _begin_beam() -> void:
	beam_time = BEAM_TELEGRAPH
	beam_delegated = false
	beam_id = _technique_of_kind("beam")
	var api := _techniques_api()
	# Charged technique: `Techniques.begin(entity, id)`; auto_release (on for every
	# non-player) fires it when the charge completes.
	if beam_id != "" and api != null and api.has_method("begin"):
		if not e.has_method("knows_technique") or e.knows_technique(beam_id):
			beam_delegated = bool(api.call("begin", e, beam_id))
	if not beam_delegated:
		e.play_anim("ki_charge")
		if Audio != null:
			Audio.play_sfx_at("ki_charge", e.global_position, -3.0)
	Events.technique_started.emit(e, beam_id if beam_id != "" else "beam")

func _fire_beam() -> void:
	var api := _techniques_api()
	if e.target == null:
		if beam_delegated and api != null and api.has_method("cancel"):
			api.call("cancel", e)
		return
	e.face(e.target.global_position)
	if beam_delegated:
		# Techniques sets auto_release for every non-player entity, so the charge
		# fires itself; nothing to do here beyond keeping the aim on the target.
		return
	e.play_anim("idle", 0.1)
	_spawn_placeholder(e.melee_damage * 1.6, 34.0, Color(1.0, 0.85, 0.45), 0.55)

func _spawn_placeholder(damage: float, speed: float, color := Color(0.55, 0.85, 1.0), radius := 0.35) -> void:
	if e.target == null:
		return
	var p := SimpleProjectile.new()
	p.speed = speed
	p.color = color
	p.radius = radius
	var host: Node = e.get_parent()
	if host == null:
		return
	host.add_child(p)
	var from := e.eye_position() + e.facing() * 0.6
	var dir: Vector3 = (e.target.global_position + Vector3(0, 1.0, 0) - from).normalized()
	p.launch(from, dir, damage, e)
	Events.technique_fired.emit(e, "blast")
	if Audio != null:
		Audio.play_sfx_at("kiblast_shoot", from, -3.0)

## Delegation to the combat engineer's `scripts/combat/Techniques.gd`
## (Techniques.tap / begin / release). Everything falls back to
## `SimpleProjectile` when that script is not in the project yet.
static func _techniques_api() -> Object:
	if not _tech_checked:
		_tech_checked = true
		if ResourceLoader.exists("res://scripts/combat/Techniques.gd"):
			_techniques = load("res://scripts/combat/Techniques.gd")
	return _techniques

## First technique of this entity whose data/techniques.json `kind` matches.
func _technique_of_kind(kind: String) -> String:
	var ids: Array = e.def.get("techniques", [])
	for id in ids:
		var d: Dictionary = Registry.technique(String(id))
		if String(d.get("kind", "blast")) == kind:
			return String(id)
	if kind == "blast":
		for fallback in ["ki_blast", "blast"]:
			if Registry.techniques.has(fallback):
				return fallback
	return ""

## Instant technique: `Techniques.tap(entity, id)` (begin + release).
func _tap_technique(tech_id: String) -> bool:
	var api := _techniques_api()
	if api == null or tech_id == "":
		return false
	if e.has_method("knows_technique") and not e.knows_technique(tech_id):
		return false
	for m in ["tap", "cast_for", "cast", "execute", "fire"]:
		if api.has_method(m):
			var r: Variant = api.call(m, e, tech_id)
			return r == null or r == true
	return false
