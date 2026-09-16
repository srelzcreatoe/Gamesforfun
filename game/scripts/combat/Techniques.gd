class_name Techniques
extends Node
## Technique executor for ANY entity - the player, an NPC master or a boss all run the
## same state machine (docs/ARCHITECTURE.md §8). One `Techniques` node per entity,
## created on demand by `Techniques.get_for(entity)`.
##
## State machine:  IDLE -> CHARGING -(release)-> ACTIVE (beam / barrage) -> COOLDOWN
##
## Public API:
##   Techniques.begin(entity, "kamehameha")    # ki check, cast anim, charge sound + orb
##   Techniques.charge_progress(entity)        # 0..1 while charging
##   Techniques.release(entity)                # fire (damage scales with the charge)
##   Techniques.stop(entity)                   # let go of a held beam / barrage
##   Techniques.cancel(entity)                 # abort a charge, no cost
##   Techniques.tap(entity, id)                # begin + release for instant techniques
##   Techniques.cooldown_left(entity, id) -> seconds
##   Techniques.can_use(entity, id) -> {ok, reason}
##   Techniques.state(entity) -> int (IDLE/CHARGING/ACTIVE/COOLDOWN)
##
## data/techniques.json entry (DATA_SCHEMA.md): kind, charge, ki_cost (fraction of max
## ki), damage_mult, cast_anim, fire_anim, charge_sound, fire_sound, color, size, speed,
## duration, cooldown. `FALLBACK` below keeps the executor usable (and testable) before
## the data engineer's file exists.

const NODE_NAME := "TechniqueState"

enum State { IDLE, CHARGING, ACTIVE, COOLDOWN }

const BARRAGE_RATE := 10.0           # blasts per second
const GRAB_DASH_SPEED := 26.0
const MELEE_SPECIAL_RANGE := 4.5
const MIN_CHARGE_FRACTION := 0.4     # damage at 0 % charge
const CHARGE_LOOP_KEY := "tech_charge"

## Minimal built-in definitions: enough to run and test the executor stand-alone.
const FALLBACK := {
	"ki_blast": {"kind": "blast", "charge": 0.0, "ki_cost": 0.05, "damage_mult": 1.0,
		"fire_anim": "ki.barrage_fire", "fire_sound": "kiblast_shoot", "color": "#7FD4FF",
		"size": 0.4, "speed": 30.0, "duration": 3.0, "cooldown": 1.0},
	"charged_ki_blast": {"kind": "blast", "charge": 1.0, "ki_cost": 0.15, "damage_mult": 2.5,
		"cast_anim": "ki.large_ball_cast", "fire_anim": "ki.large_ball_fire",
		"charge_sound": "ki_charge_loop", "fire_sound": "kiblast_shoot", "color": "#7FD4FF",
		"size": 0.9, "speed": 24.0, "duration": 4.0, "cooldown": 3.5},
	"kamehameha": {"kind": "beam", "charge": 2.0, "ki_cost": 0.3, "damage_mult": 5.0,
		"cast_anim": "ki.kameha_cast", "fire_anim": "ki.kameha_fire",
		"charge_sound": "ki_kame_charge", "fire_sound": "ki_kame_fire", "color": "#4FC3FF",
		"size": 1.2, "speed": 40.0, "duration": 3.0, "cooldown": 7.0},
	"ki_barrage": {"kind": "barrage", "charge": 0.5, "ki_cost": 0.2, "damage_mult": 0.8,
		"cast_anim": "ki.barrage_cast", "fire_anim": "ki.barrage_fire",
		"charge_sound": "ki_charge_loop", "fire_sound": "kiblast_shoot", "color": "#7FD4FF",
		"size": 0.4, "speed": 32.0, "duration": 2.5, "cooldown": 2.5},
	"kienzan": {"kind": "disc", "charge": 1.2, "ki_cost": 0.2, "damage_mult": 4.0,
		"cast_anim": "ki.kienzan_cast", "fire_anim": "ki.kienzan_fire",
		"charge_sound": "ki_disk_charge", "fire_sound": "ki_disk_fire", "color": "#FFD24D",
		"size": 1.4, "speed": 28.0, "duration": 4.0, "cooldown": 4.8},
	"final_explosion": {"kind": "explosion", "charge": 3.0, "ki_cost": 0.6, "damage_mult": 12.0,
		"cast_anim": "ki.explosion_cast", "fire_anim": "ki.explosion_fire",
		"charge_sound": "ki_explosion_charge", "fire_sound": "ki_explosion_impact",
		"color": "#FFF176", "size": 8.0, "speed": 0.0, "duration": 1.5, "cooldown": 13.2},
	"solar_flare": {"kind": "buff", "charge": 0.3, "ki_cost": 0.1, "damage_mult": 0.0,
		"fire_anim": "ki.solarflare_fire", "fire_sound": "ki_sparks", "color": "#FFFFFF",
		"size": 6.0, "speed": 0.0, "duration": 4.0, "cooldown": 6.0},
	"dragon_fist": {"kind": "melee", "charge": 0.4, "ki_cost": 0.25, "damage_mult": 6.0,
		"fire_anim": "skp.dragon_fist", "charge_sound": "ki_charge_loop",
		"fire_sound": "dragon_fist", "color": "#FFD740", "size": 1.5, "speed": 0.0,
		"duration": 1.5, "cooldown": 4.4},
	"grab": {"kind": "grab", "charge": 0.0, "ki_cost": 0.1, "damage_mult": 1.2,
		"fire_anim": "skp.grab", "fire_sound": "golpe4", "color": "#FFFFFF",
		"size": 1.0, "speed": 0.0, "duration": 1.6, "cooldown": 5.0},
}

## Kaioken-style buffs map onto a form instead of a projectile.
const BUFF_FORMS := {"kaioken": "kaioken.kaioken", "kaioken_x2": "kaioken.kaiokenx2"}

var entity: Node = null
var state: int = State.IDLE
var current_id := ""
var charge_time := 0.0
var _cooldowns: Dictionary = {}          # technique id -> msec when it is ready again
var _orb: KiEffects = null
var _beam: KiBeam = null
var _active_left := 0.0
var _barrage_accum := 0.0
var _loop_key := ""
var _auto_release := false
var _grab_target: Node = null
var _grab_left := 0.0

# --- access ---------------------------------------------------------------

static func get_for(entity_node: Node) -> Techniques:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var n: Node = entity_node.get_node_or_null(NODE_NAME)
	if n is Techniques:
		return n
	var t := Techniques.new()
	t.name = NODE_NAME
	t.entity = entity_node
	entity_node.add_child(t)
	return t

static func find_on(entity_node: Node) -> Techniques:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var n: Node = entity_node.get_node_or_null(NODE_NAME)
	return n if n is Techniques else null

func _ready() -> void:
	if entity == null:
		entity = get_parent()
	_loop_key = CHARGE_LOOP_KEY + str(get_instance_id())

func _exit_tree() -> void:
	Audio.stop_loop(_loop_key, 0.1)

# --- data ----------------------------------------------------------------

static func def(technique_id: String) -> Dictionary:
	var d: Dictionary = Registry.technique(technique_id)
	if not d.is_empty():
		return d
	return FALLBACK.get(technique_id, {})

static func color_of(d: Dictionary) -> Color:
	var c := String(d.get("color", "#7FD4FF"))
	return Color(c) if c != "" else Color(0.5, 0.83, 1.0)

# --- static wrappers -----------------------------------------------------

static func begin(entity_node: Node, technique_id: String) -> bool:
	var t := get_for(entity_node)
	return t != null and t.do_begin(technique_id)

static func release(entity_node: Node) -> bool:
	var t := find_on(entity_node)
	return t != null and t.do_release()

static func stop(entity_node: Node) -> void:
	var t := find_on(entity_node)
	if t != null:
		t.do_stop()

static func cancel(entity_node: Node) -> void:
	var t := find_on(entity_node)
	if t != null:
		t.do_cancel()

## Fire a technique that needs no charge (or accept a partial charge immediately).
static func tap(entity_node: Node, technique_id: String) -> bool:
	if not begin(entity_node, technique_id):
		return false
	return release(entity_node)

static func charge_progress(entity_node: Node) -> float:
	var t := find_on(entity_node)
	return t.progress() if t != null else 0.0

static func state_of(entity_node: Node) -> int:
	var t := find_on(entity_node)
	return t.state if t != null else State.IDLE

static func cooldown_left(entity_node: Node, technique_id: String) -> float:
	var t := find_on(entity_node)
	return t.cooldown_of(technique_id) if t != null else 0.0

static func can_use(entity_node: Node, technique_id: String) -> Dictionary:
	var t := get_for(entity_node)
	return t.check(technique_id) if t != null else {"ok": false, "reason": "no entity"}

# --- checks --------------------------------------------------------------

func cooldown_of(technique_id: String) -> float:
	var ready_at := int(_cooldowns.get(technique_id, 0))
	return maxf(0.0, float(ready_at - Time.get_ticks_msec()) / 1000.0)

func progress() -> float:
	if state != State.CHARGING:
		return 1.0 if state == State.ACTIVE else 0.0
	var d := def(current_id)
	var need := float(d.get("charge", 0.0))
	if need <= 0.0:
		return 1.0
	return clampf(charge_time / need, 0.0, 1.0)

func ki_cost(technique_id: String) -> float:
	var k := Ki.get_for(entity)
	var frac := float(def(technique_id).get("ki_cost", 0.05))
	return k.cost_of(frac) if k != null else frac * 100.0

func check(technique_id: String) -> Dictionary:
	var d := def(technique_id)
	if d.is_empty():
		return {"ok": false, "reason": "unknown technique"}
	if state != State.IDLE:
		return {"ok": false, "reason": "busy"}
	if cooldown_of(technique_id) > 0.0:
		return {"ok": false, "reason": "cooling down"}
	if not _knows(technique_id):
		return {"ok": false, "reason": "not learned"}
	var k := Ki.get_for(entity)
	if k != null and not k.can_spend(ki_cost(technique_id)):
		return {"ok": false, "reason": "not enough ki"}
	return {"ok": true, "reason": ""}

func _knows(technique_id: String) -> bool:
	if entity == null:
		return false
	if entity.has_method("knows_technique"):
		return bool(entity.call("knows_technique", technique_id))
	if Game != null and Game.player == entity:
		var arr: Array = Game.profile.get("techniques", [])
		return arr.is_empty() or arr.has(technique_id)
	if "entity_type" in entity:
		var e: Dictionary = Registry.entity(String(entity.get("entity_type")))
		var list: Array = e.get("techniques", [])
		if not list.is_empty():
			return list.has(technique_id)
	return true

# --- begin ---------------------------------------------------------------

func do_begin(technique_id: String) -> bool:
	var c := check(technique_id)
	if not bool(c["ok"]):
		if Game != null and Game.player == entity and String(c["reason"]) == "not enough ki":
			Audio.play_sfx("no_ki_form")
		return false
	var d := def(technique_id)
	current_id = technique_id
	charge_time = 0.0
	state = State.CHARGING
	_auto_release = not (Game != null and Game.player == entity)
	var cast_anim := String(d.get("cast_anim", ""))
	if cast_anim != "" and entity != null and entity.has_method("play_anim"):
		entity.call("play_anim", cast_anim, 0.1, true)
	var cs := String(d.get("charge_sound", ""))
	if cs != "":
		if float(d.get("charge", 0.0)) >= 0.75:
			Audio.play_loop(cs, _loop_key, -3.0)
		else:
			Audio.play_sfx_at(cs, _pos())
	var col := color_of(d)
	if float(d.get("charge", 0.0)) > 0.05:
		_orb = KiEffects.charge(entity, col, maxf(0.35, float(d.get("size", 0.6)) * 1.1))
		KiEffects.aura_pulse(entity, 1.15, maxf(0.3, float(d.get("charge", 0.3))))
	Events.technique_started.emit(entity, technique_id)
	return true

func do_cancel() -> void:
	if state != State.CHARGING:
		return
	_cleanup_charge()
	state = State.IDLE
	current_id = ""

func do_stop() -> void:
	if _beam != null and is_instance_valid(_beam):
		_beam.release()
	if state == State.ACTIVE:
		_active_left = minf(_active_left, 0.05)

# --- release -------------------------------------------------------------

func do_release() -> bool:
	if state != State.CHARGING:
		return false
	var technique_id := current_id
	var d := def(technique_id)
	var k := Ki.get_for(entity)
	var cost := ki_cost(technique_id)
	if k != null and not k.spend(cost):
		do_cancel()
		return false
	var p := progress()
	var power := MIN_CHARGE_FRACTION + (1.0 - MIN_CHARGE_FRACTION) * p
	_cleanup_charge(true)
	var fire_anim := String(d.get("fire_anim", ""))
	if fire_anim != "" and entity != null and entity.has_method("play_anim"):
		entity.call("play_anim", fire_anim, 0.05, false)
	var fs := String(d.get("fire_sound", ""))
	if fs != "":
		Audio.play_sfx_at(fs, _pos())
	var kind := String(d.get("kind", "blast"))
	var dmg := _damage(d) * power
	state = State.IDLE
	match kind:
		"blast":
			_fire_blast(d, dmg)
		"beam":
			_fire_beam(d, dmg)
		"disc":
			_fire_disc(d, dmg)
		"barrage":
			_start_barrage(d, dmg)
		"explosion":
			_fire_explosion(d, dmg, technique_id)
		"buff":
			_fire_buff(d, technique_id)
		"grab":
			_start_grab(d, dmg)
		"melee":
			_fire_melee(d, dmg)
		_:
			_fire_blast(d, dmg)
	_set_cooldown(technique_id, d)
	Events.technique_fired.emit(entity, technique_id)
	current_id = technique_id if state != State.IDLE else ""
	return true

func _damage(d: Dictionary) -> float:
	var s: Variant = entity.get("stats") if entity != null and "stats" in entity else null
	var base := (s as Stats).ki_damage() if s is Stats else 12.0
	return base * float(d.get("damage_mult", 1.0))

func _set_cooldown(technique_id: String, d: Dictionary) -> void:
	var cd := float(d.get("cooldown", 1.0))
	_cooldowns[technique_id] = Time.get_ticks_msec() + int(cd * 1000.0)

func _cleanup_charge(released := false) -> void:
	Audio.stop_loop(_loop_key, 0.1)
	if _orb != null and is_instance_valid(_orb):
		if released:
			_orb.release()
		else:
			_orb.fade_out(0.2)
	_orb = null

# --- kinds ---------------------------------------------------------------

func _origin() -> Vector3:
	return KiEffects.hand_position(entity)

func _aim() -> Vector3:
	return KiEffects.aim_direction(entity)

func _pos() -> Vector3:
	return (entity as Node3D).global_position if entity is Node3D and entity.is_inside_tree() else Vector3.ZERO

func _world() -> Node:
	if entity != null and "world" in entity:
		var w: Variant = entity.get("world")
		if w is Node:
			return w
	return Game.world if Game != null else null

func _target() -> Node:
	if entity != null and "target" in entity:
		var t: Variant = entity.get("target")
		if t is Node and is_instance_valid(t):
			return t
	return null

func _fire_blast(d: Dictionary, dmg: float) -> void:
	KiProjectile.spawn(_world(), entity, _origin(), _aim(), {
		"mode": "blast", "color": color_of(d), "size": float(d.get("size", 0.5)),
		"speed": float(d.get("speed", 30.0)), "damage": dmg,
		"radius": maxf(1.5, float(d.get("size", 0.5)) * 2.6),
		"life": float(d.get("duration", 3.0)), "technique": current_id,
		"target": _target() if float(d.get("speed", 30.0)) < 20.0 else null,
	})

func _fire_disc(d: Dictionary, dmg: float) -> void:
	KiProjectile.spawn(_world(), entity, _origin(), _aim(), {
		"mode": "disc", "color": color_of(d), "size": float(d.get("size", 1.2)) * 0.5,
		"speed": float(d.get("speed", 28.0)), "damage": dmg, "radius": 1.5,
		"life": float(d.get("duration", 4.0)), "technique": current_id,
	})

func _fire_beam(d: Dictionary, dmg: float) -> void:
	_beam = KiBeam.fire(_world(), entity, {
		"color": color_of(d), "size": float(d.get("size", 1.0)), "damage": dmg,
		"duration": float(d.get("duration", 3.0)), "technique": current_id,
		"fire_sound": "",
	})
	if _beam != null:
		state = State.ACTIVE
		_active_left = float(d.get("duration", 3.0))

func _start_barrage(d: Dictionary, dmg: float) -> void:
	state = State.ACTIVE
	_active_left = float(d.get("duration", 2.5))
	_barrage_accum = 0.0

func _fire_explosion(d: Dictionary, dmg: float, technique_id: String) -> void:
	KiExplosion.detonate(_world(), entity, _pos() + Vector3.UP * 0.9,
		float(d.get("size", 6.0)), dmg, {
			"color": color_of(d),
			"drain_all_ki": technique_id == "final_explosion",
		})

func _fire_buff(d: Dictionary, technique_id: String) -> void:
	if BUFF_FORMS.has(technique_id):
		Forms.transform(entity, String(BUFF_FORMS[technique_id]))
		return
	if technique_id.begins_with("kaioken"):
		Forms.transform(entity, "kaioken.kaioken")
		return
	# solar flare / fake moon: blind everything looking at the flash
	KiEffects.solar_flare(entity, _pos() + Vector3.UP * 1.2, color_of(d),
		float(d.get("duration", 4.0)), maxf(4.0, float(d.get("size", 6.0)) * 2.5))

## Grab: dash onto the target and land a multi-hit using the `skp.*` combo.
func _start_grab(d: Dictionary, dmg: float) -> void:
	var t := _target()
	if t == null:
		t = LockOn.nearest(entity, 12.0)
	if t == null or not (t is Node3D) or not (entity is Node3D):
		return
	_grab_target = t
	_grab_left = maxf(0.3, float(d.get("duration", 1.6)))
	state = State.ACTIVE
	_active_left = _grab_left
	var tr := Trails.get_for(entity)
	if tr != null:
		tr.dash(((t as Node3D).global_position - (entity as Node3D).global_position).normalized())
	_grab_damage = dmg
	_grab_hits = 0

var _grab_damage := 0.0
var _grab_hits := 0

## Melee specials: close the distance and hit hard once (dragon_fist, meteor,
## wolf_fang, deadly_dance all use the same path with their own animation).
func _fire_melee(d: Dictionary, dmg: float) -> void:
	var t := _target()
	if t == null:
		t = LockOn.nearest(entity, MELEE_SPECIAL_RANGE * 2.0)
	if entity is Node3D:
		var tr := Trails.get_for(entity)
		if tr != null and t is Node3D:
			tr.dash(((t as Node3D).global_position - (entity as Node3D).global_position).normalized())
	if t == null:
		HitFx.miss(_pos())
		return
	var hits := int(maxf(1.0, float(d.get("size", 1.0)) * 2.0))
	for i in hits:
		var mult := 1.0 / float(hits)
		Damage.deal(t, entity, mult, Damage.MELEE, dmg, _aim())
	ScreenFx.shake(0.7, 0.3)

# --- per frame -----------------------------------------------------------

func _process(delta: float) -> void:
	if entity == null or not is_instance_valid(entity):
		queue_free()
		return
	if Game != null and Game.paused_by_ui:
		return
	match state:
		State.CHARGING:
			charge_time += delta
			if _orb != null and is_instance_valid(_orb):
				_orb.set_progress(progress())
				_orb.follow(entity)
			if _auto_release and progress() >= 1.0:
				do_release()
		State.ACTIVE:
			_active_left -= delta
			if _grab_target != null:
				_tick_grab(delta)
			elif _beam != null and is_instance_valid(_beam):
				pass
			else:
				_tick_barrage(delta)
			if _active_left <= 0.0:
				if _beam != null and is_instance_valid(_beam):
					_beam.release()
				_beam = null
				_grab_target = null
				state = State.IDLE
				current_id = ""

func _tick_barrage(delta: float) -> void:
	var d := def(current_id)
	if String(d.get("kind", "")) != "barrage":
		return
	_barrage_accum += delta * BARRAGE_RATE
	while _barrage_accum >= 1.0:
		_barrage_accum -= 1.0
		var spread := 0.06
		var dir := _aim() + Vector3(randf_range(-spread, spread), randf_range(-spread, spread), randf_range(-spread, spread))
		KiProjectile.spawn(_world(), entity, _origin(), dir.normalized(), {
			"mode": "blast", "color": color_of(d), "size": float(d.get("size", 0.4)),
			"speed": float(d.get("speed", 32.0)), "damage": _damage(d) * 0.35,
			"radius": 1.6, "life": 2.5, "technique": current_id, "destroy_terrain": false,
		})
		Audio.play_sfx_at("kiblast_shoot", _origin(), -6.0, randf_range(0.9, 1.15))

func _tick_grab(delta: float) -> void:
	if _grab_target == null or not is_instance_valid(_grab_target) or not (entity is Node3D):
		_grab_target = null
		return
	var me := entity as Node3D
	var tp: Vector3 = (_grab_target as Node3D).global_position
	var to := tp - me.global_position
	if to.length() > 1.4:
		me.global_position += to.normalized() * GRAB_DASH_SPEED * delta
		return
	var hits := int(3 + Skills.level(entity, "ki_manipulation"))
	var want := int(float(hits) * (1.0 - _active_left / maxf(0.1, _grab_left)))
	while _grab_hits < want and _grab_hits < hits:
		_grab_hits += 1
		Damage.deal(_grab_target, entity, 1.0 / float(hits), Damage.MELEE, _grab_damage, to)
	if _active_left <= 0.05 and _grab_hits >= hits:
		Damage.deal(_grab_target, entity, 0.6, Damage.MELEE, _grab_damage, to)
		HitFx.knockdown(tp)
