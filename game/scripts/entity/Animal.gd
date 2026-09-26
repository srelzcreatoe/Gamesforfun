class_name Animal
extends Entity
## Wildlife: wanders, grazes and flees. Dinosaurs (and anything with
## `aggressive: true` in entities.json) fight back once they are hit.

enum { IDLE, WANDER, GRAZE, FLEE, CHASE }

const FLEE_DIST := 8.0
const FLEE_TIME := 5.0
const WANDER_RANGE := 10.0
const WANDER_SPEED := 1.4
const FLEE_SPEED := 4.0
const CHASE_SPEED := 4.6

var state := IDLE
var state_time := 0.0
var aggressive := false
var angry := false
var home := Vector3.ZERO
var wander_point := Vector3.ZERO
var attack_cd := 0.0

func _configure() -> void:
	faction = String(def.get("faction", "wild"))
	aggressive = bool(def.get("aggressive", entity_type.contains("dino") or entity_type.contains("saber")))
	home = global_position
	wander_point = home
	state_time = randf_range(0.0, 2.0)
	set_locomotion("idle")

func tick(delta: float) -> void:
	state_time += delta
	attack_cd = maxf(0.0, attack_cd - delta)
	if ai_enabled():
		_think(delta)
	apply_physics(delta)

func _think(delta: float) -> void:
	var p: Node = Game.player
	var player_pos := Vector3.ZERO
	var dist := 1e9
	if p is Node3D:
		player_pos = (p as Node3D).global_position
		dist = global_position.distance_to(player_pos)
	match state:
		IDLE:
			if state_time > randf_range(2.0, 6.0):
				_set_state(GRAZE if randf() < 0.35 else WANDER)
		GRAZE:
			if state_time > randf_range(3.0, 6.0):
				_set_state(WANDER)
		WANDER:
			var flat := Vector2(wander_point.x - global_position.x, wander_point.z - global_position.z)
			if flat.length() < 0.7 or state_time > 10.0:
				wander_point = home + Vector3(randf_range(-WANDER_RANGE, WANDER_RANGE), 0.0, randf_range(-WANDER_RANGE, WANDER_RANGE))
				_set_state(IDLE)
			else:
				_move_to(wander_point, WANDER_SPEED * speed_mult, delta)
				set_locomotion("walk", ground_speed if ground_speed > 0.1 else WANDER_SPEED * speed_mult)
		FLEE:
			if state_time > FLEE_TIME or dist > FLEE_DIST * 2.5:
				_set_state(IDLE)
			else:
				var away := global_position - player_pos
				away.y = 0.0
				if away.length() < 0.1:
					away = Vector3.FORWARD
				_move_to(global_position + away.normalized() * 4.0, FLEE_SPEED * speed_mult, delta)
				set_locomotion("run", ground_speed if ground_speed > 0.1 else FLEE_SPEED * speed_mult)
		CHASE:
			if not angry or dist > 24.0:
				_set_state(IDLE)
			elif dist < 2.2:
				face(player_pos, false, 6.0, delta)
				if attack_cd <= 0.0:
					attack_cd = 1.6
					# a quadruped's bite is a WHOLE BODY clip (head/neck/jaw bones the
					# upper-body layer is not allowed to touch), so it goes on the base
					# layer as a one shot and the AI puts the locomotion back after it
					play_anim(clip_for("attack1"), 0.08, false)
					if p is Entity:
						var to := (player_pos - global_position).normalized()
						(p as Entity).take_damage(melee_damage, self, "melee", to * 3.0 + Vector3(0, 1.5, 0))
					_play_sound("attack")
				elif attack_cd < 1.0:
					set_locomotion("idle")      # release the one-shot bite
			else:
				_move_to(player_pos, CHASE_SPEED * speed_mult, delta)
				set_locomotion("run", ground_speed if ground_speed > 0.1 else CHASE_SPEED * speed_mult)

func _set_state(s: int) -> void:
	state = s
	state_time = 0.0
	match s:
		IDLE: set_locomotion("idle")
		GRAZE: set_locomotion("graze" if has_state("graze") else "idle")
		WANDER: set_locomotion("walk", WANDER_SPEED * speed_mult)
		FLEE: set_locomotion("run", FLEE_SPEED * speed_mult, 0.1)
		CHASE: set_locomotion("run", CHASE_SPEED * speed_mult)

func _move_to(goal: Vector3, speed: float, delta: float) -> void:
	var d := goal - global_position
	d.y = 0.0
	if d.length() < 0.05:
		return
	d = d.normalized()
	face(goal, false, 5.0, delta)
	velocity.x = d.x * speed
	velocity.z = d.z * speed

func on_damaged(source: Node, _amount: float) -> void:
	if aggressive:
		angry = true
		if source is Node3D:
			set_target(source)
		_set_state(CHASE)
	else:
		_set_state(FLEE)
