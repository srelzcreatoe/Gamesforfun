class_name Entity
extends Node3D
## Base class for every living thing in the world (docs/ARCHITECTURE.md §7).
##
## Spawning contract (used by `World.spawn_entity`): instantiate the scene from
## `Registry.entities[type].scene`, set `entity_type` (and optionally
## `spawn_data` / `world`) and add it to the world's `Entities` node. Either
## order works - `_ready()` initialises whatever has not been initialised yet.
##
## Physics uses `VoxelPhysics.move_aabb` when `scripts/world/VoxelPhysics.gd`
## exists and falls back to a flat ground plane at y = `FALLBACK_GROUND_Y` so
## entities work in unit tests and in a world-less preview scene.

signal died(killer: Node)

const FALLBACK_GROUND_Y := 64.0
const BASE_GRAVITY := 23.0
const IFRAME_TIME := 0.25
const ANIM_CULL_DIST := 48.0
const AI_CULL_DIST := 64.0
const ANIM_SLOW_DIST := 24.0
const ANIM_SLOW_INTERVAL := 0.05          # 20 Hz
const DEATH_FREE_TIME := 1.5

# --- identity / data ----------------------------------------------------------
var entity_type := ""
var def: Dictionary = {}
var spawn_data: Dictionary = {}
var world: Node = null
var display_name := ""
var faction := "wild"
var team_id := 0
var kind := "enemy"
var ai_tier := 1

# --- body ---------------------------------------------------------------------
var aabb_size := Vector3(0.6, 1.8, 0.6)
var velocity := Vector3.ZERO
var on_ground := false
var in_liquid := false
var submerged := 0.0
var yaw := 0.0                            # radians, 0 = facing -Z
var head_pitch_deg := 0.0                 # query.head_x_rotation
var head_yaw_deg := 0.0                   # query.head_y_rotation
var ground_speed := 0.0                   # query.ground_speed (m/s)
var distance_moved := 0.0                 # query.modified_distance_moved
var is_flying := false
var can_fly := false
var model_scale := 1.0

# --- stats --------------------------------------------------------------------
var stats: Object = null                  # scripts/combat/Stats.gd when present
var health := 100.0
var max_health := 100.0
var ki := 100.0
var max_ki := 100.0
var stamina := 100.0
var max_stamina := 100.0
var melee_damage := 5.0
var defense := 0.0
var speed_mult := 1.0
var current_form := ""
var ki_protection := 0.0                  # 0..1 fraction of damage paid with ki
var power_release := 1.0                  # read/written by scripts/combat/Ki.gd
var base_scale := 1.0                     # model scale before any form scaling
var aura_color := "#7FFFFF"
var input_locked := false
var model_override := ""
var skills: Dictionary = {}               # skill id -> level (NPC/boss overrides)
var techniques: Array = []                # known technique ids ([] = everything in `def`)
var forms_unlocked: Array = []
var forms_mastery: Dictionary = {}

# --- runtime ------------------------------------------------------------------
var model: BedrockModel = null
var anim: BedrockAnimation = null
var target: Node3D = null
var dead := false
var invuln := 0.0
var life_time := 0.0
var initialized := false

var _flash := 0.0
var _blind := 0.0
var _last_pos := Vector3.ZERO
var _anim_name := ""
var _dist_to_player := 0.0
var _dist_timer := 0.0

static var _vp: Object = null
static var _vp_checked := false

# --- setup --------------------------------------------------------------------

func _ready() -> void:
	if not initialized:
		initialize()

func setup(type: String, w: Node, data: Dictionary = {}) -> void:
	entity_type = type
	world = w
	spawn_data = data
	if is_inside_tree():
		initialize()

## Called by `World.spawn_entity` before the node enters the tree.
func apply_spawn_data(data: Dictionary) -> void:
	for k in data.keys():
		spawn_data[k] = data[k]
	if initialized:
		initialize()

## Reads data/entities.json, builds the model + animation player and stats.
func initialize() -> void:
	if initialized:
		return
	initialized = true
	if world == null:
		world = Game.world
	def = Registry.entity(entity_type) if entity_type != "" else {}
	display_name = String(def.get("name", entity_type.capitalize()))
	kind = String(def.get("kind", kind))
	faction = String(def.get("faction", faction))
	ai_tier = int(def.get("ai_tier", ai_tier))
	can_fly = bool(def.get("can_fly", can_fly))
	model_scale = float(def.get("scale", 1.0)) * float(spawn_data.get("scale", 1.0))
	base_scale = model_scale
	aura_color = String(def.get("aura_color", spawn_data.get("aura_color", aura_color)))
	techniques = def.get("techniques", []).duplicate() if def.has("techniques") else []
	skills = def.get("skills", {}).duplicate() if def.has("skills") else {}
	var hit: Array = def.get("hitbox", [])
	if hit.size() >= 2:
		aabb_size = Vector3(float(hit[0]), float(hit[1]), float(hit[0]))
	_build_stats()
	_build_model()
	_configure()
	_last_pos = global_position

func _configure() -> void:
	pass                                   # subclasses hook here

func _build_stats() -> void:
	var s: Dictionary = def.get("stats", {})
	for k in spawn_data.get("stats_override", {}).keys():
		s = s.duplicate()
		s[k] = spawn_data["stats_override"][k]
	# scripts/combat/Stats.gd owns the real stat model: Stats.new().from_entity_def(def).
	# `spawn_data.stats_override` is merged into the def copy we hand it so quest
	# enemies keep their scaled numbers. Falls back to the raw json numbers when the
	# combat engineer's script is not in the project.
	var script_path := "res://scripts/combat/Stats.gd"
	if ResourceLoader.exists(script_path) and not def.is_empty():
		var sc: Variant = load(script_path)
		if sc != null:
			var inst: Variant = sc.new()
			if inst != null and inst.has_method("from_entity_def"):
				var d2 := def.duplicate()
				d2["stats"] = s
				if "race_id" in inst:
					inst.set("race_id", String(def.get("race", def.get("race_id", "human"))))
				if "class_id" in inst:
					inst.set("class_id", String(def.get("class", "warrior")))
				stats = inst.call("from_entity_def", d2)
				if stats == null:
					stats = inst
	max_health = float(s.get("health", 100.0))
	melee_damage = float(s.get("melee", 5.0))
	max_ki = float(s.get("ki", 100.0))
	defense = float(s.get("defense", 0.0))
	speed_mult = float(s.get("speed", 1.0))
	max_stamina = float(s.get("stamina", 100.0))
	if stats != null:
		max_health = _stat("max_health", max_health)
		max_ki = _stat("max_ki", max_ki)
		max_stamina = _stat("max_stamina", max_stamina)
		melee_damage = _stat("melee", melee_damage)
		defense = _stat("defense", defense)
	var diff := 1.0
	if Game != null and Game.has_method("difficulty_mult"):
		diff = Game.difficulty_mult()
	if faction == "villain" or faction == "wild":
		max_health *= diff
		melee_damage *= diff
	health = float(spawn_data.get("health", max_health))
	ki = max_ki
	stamina = max_stamina

func _stat(name: String, fallback: float) -> float:
	if stats == null:
		return fallback
	var v: Variant = stats.get(name)
	if v is float or v is int:
		return float(v)
	if stats.has_method(name):
		var r: Variant = stats.call(name)
		if r is float or r is int:
			return float(r)
	return fallback

func _build_model() -> void:
	var model_path := String(def.get("model", spawn_data.get("model", "")))
	if model_path == "":
		return
	model = BedrockModel.new()
	model.name = "Model"
	add_child(model)
	if not model.load_geo(model_path):
		model.queue_free()
		model = null
		return
	model.set_model_scale(model_scale)
	var tex := String(def.get("texture", spawn_data.get("texture", "")))
	if def.has("character") or spawn_data.has("character"):
		RaceSkin.apply_to(model, spawn_data.get("character", def.get("character", {})), spawn_data.get("armor", []))
	elif tex != "":
		model.set_texture(Textures.entity_texture(tex))
	anim = BedrockAnimation.new()
	anim.name = "Anim"
	add_child(anim)
	anim.setup(model, self)
	var sets: Array = def.get("animations", [])
	if sets.is_empty():
		sets = ["entity/races/movement"] if model_path.begins_with("entity/races") else []
	for a in sets:
		anim.load_clips(String(a))
	if anim.has_clip("idle"):
		play_anim("idle")

# --- frame --------------------------------------------------------------------

func _process(delta: float) -> void:
	if Game.paused_by_ui:
		return
	life_time += delta
	if invuln > 0.0:
		invuln -= delta
	if _blind > 0.0:
		_blind -= delta
	if _flash > 0.0:
		_flash -= delta
		if _flash <= 0.0 and model != null:
			model.set_tint(Color.WHITE)
	_dist_timer -= delta
	if _dist_timer <= 0.0:
		_dist_timer = 0.25
		_dist_to_player = distance_to_player()
	if not dead:
		tick(delta)
	_update_animation(delta)

## Subclass entry point (AI, movement). Not called while dead.
func tick(delta: float) -> void:
	apply_physics(delta)

func _update_animation(delta: float) -> void:
	if anim == null:
		return
	if _dist_to_player > ANIM_CULL_DIST:
		return
	anim.update_interval = ANIM_SLOW_INTERVAL if _dist_to_player > ANIM_SLOW_DIST else 0.0
	anim.update(delta)

func ai_enabled() -> bool:
	return not dead and not is_blinded() and _dist_to_player <= AI_CULL_DIST and not Game.paused_by_ui

func distance_to_player() -> float:
	var p: Node = Game.player
	if p == null or not (p is Node3D):
		return 0.0
	return global_position.distance_to((p as Node3D).global_position)

# --- physics ------------------------------------------------------------------

static func _voxel_physics() -> Object:
	if not _vp_checked:
		_vp_checked = true
		if ResourceLoader.exists("res://scripts/world/VoxelPhysics.gd"):
			_vp = load("res://scripts/world/VoxelPhysics.gd")
	return _vp

func planet_gravity() -> float:
	if world != null:
		var pid: Variant = world.get("planet_id")
		if pid != null:
			return float(Registry.planet(String(pid)).get("gravity", 1.0))
	return 1.0

func aabb() -> AABB:
	return AABB(global_position - Vector3(aabb_size.x * 0.5, 0.0, aabb_size.z * 0.5), aabb_size)

func apply_physics(delta: float) -> void:
	var g := BASE_GRAVITY * planet_gravity()
	var vp := _voxel_physics()
	if vp != null and world != null and vp.has_method("fluid_at"):
		var fl: Variant = vp.call("fluid_at", world, aabb())
		if fl is Dictionary:
			in_liquid = bool(fl.get("in_liquid", false))
			submerged = float(fl.get("submerged_fraction", 0.0))
			var flow: Vector3 = fl.get("flow", Vector3.ZERO)
			if in_liquid:
				velocity += flow * 1.5 * delta
	if is_flying:
		velocity.y = lerpf(velocity.y, 0.0, clampf(delta * 6.0, 0.0, 1.0))
	elif in_liquid and submerged > 0.6:
		velocity.y += (g * 0.35) * delta            # buoyancy toward the surface
		velocity.y = clampf(velocity.y, -3.0, 3.0)
	else:
		velocity.y -= g * delta
		velocity.y = maxf(velocity.y, -60.0)
	var drag := 0.86 if (is_flying or in_liquid) else 1.0
	velocity.x *= drag
	velocity.z *= drag
	var motion := velocity * delta
	if vp != null and world != null and vp.has_method("move_aabb"):
		var res: Variant = vp.call("move_aabb", world, aabb(), motion, 0.6)
		if res is Dictionary:
			var box: AABB = res.get("aabb", aabb())
			global_position = box.position + Vector3(aabb_size.x * 0.5, 0.0, aabb_size.z * 0.5)
			on_ground = bool(res.get("on_ground", false))
			if bool(res.get("hit_y", false)):
				velocity.y = 0.0
			if bool(res.get("hit_x", false)):
				velocity.x = 0.0
			if bool(res.get("hit_z", false)):
				velocity.z = 0.0
		else:
			global_position += motion
	else:
		global_position += motion
		if global_position.y <= FALLBACK_GROUND_Y:
			global_position.y = FALLBACK_GROUND_Y
			if velocity.y < 0.0:
				velocity.y = 0.0
			on_ground = true
		else:
			on_ground = false
	if is_flying:
		on_ground = false
	var moved := global_position - _last_pos
	ground_speed = Vector2(moved.x, moved.z).length() / maxf(delta, 0.0001)
	distance_moved += Vector2(moved.x, moved.z).length()
	_last_pos = global_position

# --- orientation / animation --------------------------------------------------

func face(pos: Vector3, immediate := true, turn_rate := 8.0, delta := 0.0) -> void:
	var d := pos - global_position
	if absf(d.x) < 0.0001 and absf(d.z) < 0.0001:
		return
	var want := atan2(-d.x, -d.z)
	if immediate:
		yaw = want
	else:
		yaw = _approach_angle(yaw, want, turn_rate * maxf(delta, 0.0001))
	rotation.y = yaw

func look_at_head(pos: Vector3) -> void:
	var d := pos - (global_position + Vector3(0, aabb_size.y * 0.9, 0))
	var want := atan2(-d.x, -d.z)
	head_yaw_deg = clampf(rad_to_deg(wrapf(want - yaw, -PI, PI)), -70.0, 70.0)
	var horiz := Vector2(d.x, d.z).length()
	head_pitch_deg = clampf(rad_to_deg(atan2(-d.y, maxf(horiz, 0.01))), -50.0, 50.0)

static func _approach_angle(from: float, to: float, amount: float) -> float:
	var diff := wrapf(to - from, -PI, PI)
	return from + clampf(diff, -amount, amount)

func facing() -> Vector3:
	return Vector3(-sin(yaw), 0.0, -cos(yaw))

func play_anim(name: String, blend := 0.15, loop: Variant = null, speed := 1.0) -> bool:
	if anim == null:
		return false
	_anim_name = name
	return anim.play(name, blend, loop, speed)

func play_upper_anim(name: String, blend := 0.1) -> bool:
	return anim.play_upper(name, blend) if anim != null else false

func current_anim() -> String:
	return anim.current_clip() if anim != null else ""

func eye_position() -> Vector3:
	return global_position + Vector3(0, aabb_size.y * 0.9, 0)

func center() -> Vector3:
	return global_position + Vector3(0, aabb_size.y * 0.5, 0)

# --- combat -------------------------------------------------------------------

func take_damage(amount: float, source: Node = null, kind_of := "melee", knockback := Vector3.ZERO) -> float:
	if dead or amount <= 0.0 or invuln > 0.0:
		return 0.0
	var applied := amount * 100.0 / (100.0 + maxf(defense, 0.0))
	applied = absorb_with_ki(applied, kind_of)
	var crit := false
	if randf() < 0.08:
		applied *= 1.5
		crit = true
	health = maxf(0.0, health - applied)
	invuln = IFRAME_TIME
	if knockback != Vector3.ZERO:
		velocity += knockback
		if knockback.y > 0.0:
			on_ground = false
	hit_flash()
	_play_sound("hurt")
	Events.entity_damaged.emit(self, applied, source, kind_of, crit)
	on_damaged(source, applied)
	if health <= 0.0:
		die(source)
	return applied

## Ki protection hook: spends ki to soak part of the damage (forms/skills set
## `ki_protection`; the combat engineer can override this in a subclass).
func absorb_with_ki(amount: float, _kind: String) -> float:
	if ki_protection <= 0.0 or ki <= 0.0:
		return amount
	var soak := minf(amount * ki_protection, ki)
	ki -= soak
	return maxf(0.0, amount - soak)

func on_damaged(_source: Node, _amount: float) -> void:
	pass

func heal(amount: float) -> float:
	if dead or amount <= 0.0:
		return 0.0
	var before := health
	health = minf(max_health, health + amount)
	return health - before

func hit_flash() -> void:
	if model != null:
		model.set_tint(Color(1.0, 0.35, 0.35))
	_flash = 0.12

func set_target(node: Node) -> void:
	target = node as Node3D

func is_alive() -> bool:
	return not dead and health > 0.0

func die(killer: Node = null) -> void:
	if dead:
		return
	dead = true
	health = 0.0
	velocity = Vector3.ZERO
	_play_sound("death")
	drop_loot()
	Events.entity_died.emit(self, killer)
	died.emit(killer)
	_play_death_animation()
	var t := create_tween()
	t.tween_interval(DEATH_FREE_TIME * 0.6)
	if model != null:
		t.tween_property(model, "scale", model.scale * 0.05, DEATH_FREE_TIME * 0.4)
	t.tween_callback(queue_free)

func _play_death_animation() -> void:
	if anim != null:
		for n in ["death", "faint_vertical", "base.faint_vertical", "faint_horizontal"]:
			if anim.has_clip(n):
				anim.stop(0.0)
				anim.play(n, 0.1, false)
				return
	if model != null:
		var t := create_tween()
		t.tween_property(model, "rotation", Vector3(deg_to_rad(-80.0), model.rotation.y, 0.0), 0.5)

func drop_loot() -> void:
	var drops: Array = def.get("drops", [])
	if drops.is_empty():
		return
	var scene_path := "res://scenes/entities/Pickup.tscn"
	if not ResourceLoader.exists(scene_path):
		return
	var packed: PackedScene = load(scene_path)
	if packed == null:
		return
	var host: Node = get_parent()
	if host == null:
		return
	for d in drops:
		if not (d is Dictionary):
			continue
		if randf() > float(d.get("chance", 1.0)):
			continue
		var p: Node = packed.instantiate()
		p.set("item_id", String(d.get("item", "")))
		p.set("item_count", int(d.get("count", 1)))
		host.add_child(p)
		if p is Node3D:
			(p as Node3D).global_position = center() + Vector3(randf_range(-0.3, 0.3), 0.2, randf_range(-0.3, 0.3))

func _play_sound(key: String) -> void:
	var sounds: Dictionary = def.get("sounds", {})
	var name := String(sounds.get(key, ""))
	if name == "":
		return
	if Audio != null:
		Audio.play_sfx_at(name, global_position)

# --- persistence --------------------------------------------------------------

func write_state() -> Dictionary:
	return {
		"type": entity_type,
		"pos": [global_position.x, global_position.y, global_position.z],
		"yaw": yaw,
		"health": health,
		"ki": ki,
		"form": current_form,
		"faction": faction,
		"team": team_id,
		"flying": is_flying,
		"data": spawn_data,
	}

func read_state(state: Dictionary) -> void:
	entity_type = String(state.get("type", entity_type))
	var p: Array = state.get("pos", [])
	if p.size() >= 3:
		global_position = Vector3(float(p[0]), float(p[1]), float(p[2]))
	yaw = float(state.get("yaw", yaw))
	rotation.y = yaw
	if state.has("data") and state["data"] is Dictionary:
		spawn_data = state["data"]
	if not initialized:
		initialize()
	health = float(state.get("health", health))
	ki = float(state.get("ki", ki))
	current_form = String(state.get("form", current_form))
	faction = String(state.get("faction", faction))
	team_id = int(state.get("team", team_id))
	is_flying = bool(state.get("flying", is_flying))


# --- optional hooks read by combat / fx (see scripts/fx/FxDummy.gd) -----------

## Recompute the derived pools after a form/skill/stat change.
func refresh_derived() -> void:
	if stats != null:
		max_health = _stat("max_health", max_health)
		max_ki = _stat("max_ki", max_ki)
		max_stamina = _stat("max_stamina", max_stamina)
		melee_damage = _stat("melee", melee_damage)
		defense = _stat("defense", defense)
		speed_mult = _stat("speed_mult", speed_mult)
	health = minf(health, max_health)
	ki = minf(ki, max_ki)
	stamina = minf(stamina, max_stamina)

## Where techniques/projectiles are aimed: the target when there is one, else the
## entity's facing (with the head pitch folded in).
func aim_direction() -> Vector3:
	if target != null and is_instance_valid(target):
		var lift := 0.9
		if target is Entity:
			lift = (target as Entity).aabb_size.y * 0.6
		var d := target.global_position + Vector3(0, lift, 0) - eye_position()
		if d.length_squared() > 0.0001:
			return d.normalized()
	var f := facing()
	var pitch := deg_to_rad(head_pitch_deg)
	return Vector3(f.x * cos(pitch), -sin(pitch), f.z * cos(pitch)).normalized()

func skill_level(id: String) -> int:
	if skills.has(id):
		return int(skills[id])
	if Game.player == self:
		return int(Game.profile.get("skills", {}).get(id, 0))
	# bosses and masters are as trained as their AI tier suggests
	return maxi(0, ai_tier) if kind == "enemy" else 0

func set_skill_level(id: String, level: int) -> void:
	skills[id] = maxi(0, level)
	if Game.player == self:
		var sk: Dictionary = Game.profile.get("skills", {})
		sk[id] = skills[id]
		Game.profile["skills"] = sk

func knows_technique(id: String) -> bool:
	if Game.player == self:
		var known: Array = Game.profile.get("techniques", [])
		return known.is_empty() or known.has(id)
	return techniques.is_empty() or techniques.has(id)

func learn_technique(id: String) -> void:
	if not techniques.has(id):
		techniques.append(id)

func form_unlocked(id: String) -> bool:
	if Game.player == self:
		return Array(Game.profile.get("forms", {}).get("unlocked", [])).has(id)
	return forms_unlocked.is_empty() or forms_unlocked.has(id)

func unlock_form(id: String) -> bool:
	if not forms_unlocked.has(id):
		forms_unlocked.append(id)
	if Game.player == self:
		var f: Dictionary = Game.profile.get("forms", {})
		var un: Array = f.get("unlocked", [])
		if not un.has(id):
			un.append(id)
		f["unlocked"] = un
		Game.profile["forms"] = f
	return true

func form_mastery(id: String) -> float:
	if Game.player == self:
		return float(Game.profile.get("forms", {}).get("mastery", {}).get(id, 0.0))
	return float(forms_mastery.get(id, 0.0))

func set_form_mastery(id: String, value: float) -> void:
	forms_mastery[id] = value
	if Game.player == self:
		var f: Dictionary = Game.profile.get("forms", {})
		var m: Dictionary = f.get("mastery", {})
		m[id] = value
		f["mastery"] = m
		Game.profile["forms"] = f

## Swap the geometry for a transformation model (`""` restores the entity default).
func set_model_override(path: String) -> void:
	if path == model_override:
		return
	model_override = path
	var want := path if path != "" else String(def.get("model", ""))
	if want == "" or model == null:
		return
	var tex: Texture2D = model.get_texture()
	var base_now := model.base_scale
	var mult := model.form_scale_mult()         # keep any form scaling already applied
	if not model.load_geo(want):
		model.load_geo(String(def.get("model", "")))
	model.set_model_scale(base_now)
	if not is_equal_approx(mult, 1.0):
		model.set_form_scale(mult)
	if tex != null:
		model.set_texture(tex)
	if anim != null:
		anim.setup(model, self)
		if _anim_name != "":
			anim.play(_anim_name, 0.0)

func set_model_visible(v: bool) -> void:
	if model != null:
		model.visible = v

func set_input_locked(on: bool) -> void:
	input_locked = on

## Solar flare: the entity cannot see (drops its target and stops its AI).
func blind(seconds: float) -> void:
	_blind = maxf(_blind, seconds)
	target = null

func is_blinded() -> bool:
	return _blind > 0.0
