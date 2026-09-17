class_name Player
extends Entity
## The player character (docs/ARCHITECTURE.md §6, CUBIC_WORLD_UI_SPEC.md §4):
## movement (walk / sprint / sneak / swim / ladder / ki flight), survival, inventory,
## camera rig and block interaction.
##
## Everything that is not movement/inventory is delegated to the shared systems so there is
## exactly one implementation: `Stats` (RPG stats), `Ki` (pools + charging), `Techniques`
## (blasts/beams), `Forms` (transformations), `Skills` (skill effects), `Training` (TP),
## `LockOn` (targets), `VoxelPhysics` (collision). Each call is guarded so the player still
## runs if one of those is missing.

const DT_MAX := 0.05
const DEFAULT_PHYSICS := {
	"gravity": 23.0, "jump": 7.4, "walk": 4.2, "sprint": 5.6, "sneak": 1.6, "swim": 2.4,
	"fly": 12.0, "fly_fast_mult": 2.2, "step_height": 0.51, "eye_height": 1.62,
}
const TERMINAL_VELOCITY := -50.0
const ACCEL_GROUND := 42.0
const ACCEL_AIR := 10.0
const ACCEL_LIQUID := 16.0
const ACCEL_FLY := 30.0
const LIQUID_SPEED_MULT := 0.55
const LIQUID_GRAVITY := 6.0
const SWIM_UP := 3.4
const LIQUID_VY_MIN := -3.4
const LIQUID_VY_MAX := 4.0
const LADDER_SPEED := 2.6
const FLY_VERTICAL := 9.0
const FLY_VERTICAL_ACCEL := 40.0
const DOUBLE_TAP_TIME := 0.35
const CROUCH_EYE := 1.35
## data/planets.json has 10x (Vegeta) and 20x (Hell); clamp so the planet is still playable.
const GRAVITY_MIN := 0.5
const GRAVITY_MAX := 2.5
const FLY_FAST_STAMINA := 12.0
const KI_FLY_DRAIN := 0.6
const DASH_IMPULSE := 12.0
const DASH_COOLDOWN := 0.9
const DASH_STAMINA := 10.0
const CHARGED_BLAST := "charged_ki_blast"
const BASIC_BLAST := "ki_blast"
# Shared with Entity so the player and other entities agree in a world-less preview.
const FALLBACK_GROUND := Entity.FALLBACK_GROUND_Y

var input: PlayerInput = PlayerInput.new()
var keyboard: KeyboardInput = null
var camera_rig: CameraRig = null
var interaction: Interaction = null
var animator: PlayerAnimator = null
var inventory: Inventory = null
var survival: PlayerStats = null

var is_crouching := false
var is_sprinting := false
var is_swimming := false
var fly_fast := false
var on_ladder := false
var flow := Vector3.ZERO

var hotbar_index: int = 0
var spawn_point := Vector3(0.5, -1.0, 0.5)
var spawn_planet := "earth"

var _phys: Dictionary = DEFAULT_PHYSICS.duplicate()
var _last_jump_time := -10.0
var _dash_cd := 0.0
var _blast_hold := 0.0
var _blast_active := false
var _clock := 0.0
var _position_preset := false
var _blast_charging := false
var _stepper: RefCounted = null          # scripts/audio/Footsteps.gd Stepper (audio engineer)
var _was_in_liquid := false
var _play_time := 0.0          # seconds played in this session
var _play_time_total := 0.0    # seconds carried in from the profile

# --- cheats (Dev mode, scenes/ui/DevMenu.tscn) ------------------------------
var god_mode := false
var infinite_ki := false
var creative_flight := false
var noclip := false

# --- setup -----------------------------------------------------------------

func _ready() -> void:
	entity_type = "player"
	faction = "player"
	kind = "player"
	team_id = 0
	_position_preset = position != Vector3.ZERO
	super._ready()

## Entity.initialize() hook: runs after def / stats / model are ready.
func _configure() -> void:
	var p: Dictionary = def.get("physics", {})
	for k in DEFAULT_PHYSICS.keys():
		_phys[k] = float(p.get(k, DEFAULT_PHYSICS[k]))
	can_fly = true
	inventory = Inventory.new(Inventory.PLAYER_SIZE, true)
	survival = PlayerStats.new(self)
	animator = PlayerAnimator.new(self)
	keyboard = KeyboardInput.new(input)
	camera_rig = CameraRig.new()
	camera_rig.name = "CameraRig"
	camera_rig.eye_height = float(_phys["eye_height"])
	camera_rig.crouch_eye_height = CROUCH_EYE
	add_child(camera_rig)
	camera_rig.set_player(self)
	if ResourceLoader.exists("res://scripts/audio/Footsteps.gd"):
		_stepper = Footsteps.Stepper.new()
	interaction = Interaction.new()
	interaction.name = "Interaction"
	add_child(interaction)
	interaction.setup(self)
	if Game != null:
		Game.player = self
		if not Game.profile.is_empty():
			read_profile(Game.profile)
	apply_appearance()
	refresh_derived()
	set_process_unhandled_input(true)

## Compose the race skin + hair + worn armor onto the Bedrock model.
func apply_appearance() -> void:
	if model == null or Game == null:
		return
	var ch: Dictionary = Game.profile.get("character", {})
	if ch.is_empty():
		return
	var worn: Array = []
	if inventory != null:
		for a in inventory.armor:
			if not a.is_empty():
				worn.append(a.item)
	RaceSkin.apply_to(model, ch, worn)

func _exit_tree() -> void:
	if Game != null and Game.player == self:
		Game.player = null

# --- profile ---------------------------------------------------------------

func read_profile(profile: Dictionary) -> void:
	if stats != null and stats.has_method("from_profile"):
		stats.call("from_profile", profile)
	refresh_derived()
	health = float(profile.get("health", -1))
	if health <= 0.0:
		health = max_health
	ki = float(profile.get("ki", -1))
	if ki <= 0.0:
		ki = max_ki
	stamina = float(profile.get("stamina", -1))
	if stamina <= 0.0:
		stamina = max_stamina
	health = minf(health, max_health)
	ki = minf(ki, max_ki)
	stamina = minf(stamina, max_stamina)
	current_form = String(profile.get("forms", {}).get("current", ""))
	_play_time_total = float(profile.get("play_time", 0.0))
	_play_time = 0.0
	if survival != null:
		survival.load_profile(profile)
	var inv: Variant = profile.get("inventory", {})
	if inv is Dictionary and not (inv as Dictionary).is_empty():
		inventory.from_dict(inv)
	hotbar_index = inventory.hotbar_index
	var pos: Dictionary = profile.get("position", {})
	var sp: Dictionary = profile.get("spawn", {})
	spawn_planet = String(sp.get("planet", pos.get("planet", "earth")))
	spawn_point = Vector3(float(sp.get("x", 0.5)), float(sp.get("y", -1.0)), float(sp.get("z", 0.5)))
	if not _position_preset:
		var want := Vector3(float(pos.get("x", 0.5)), float(pos.get("y", -1.0)), float(pos.get("z", 0.5)))
		if want.y < 0.0:
			want.y = surface_y(want.x, want.z)
		global_position = want
	if spawn_point.y < 0.0:
		spawn_point.y = global_position.y
	yaw = deg_to_rad(float(pos.get("yaw", 0.0)))
	rotation.y = yaw
	if camera_rig != null:
		camera_rig.yaw_deg = float(pos.get("yaw", 0.0))
	_emit_all()

func write_profile(profile: Dictionary) -> void:
	if stats != null and stats.has_method("to_profile"):
		stats.call("to_profile", profile)
	if survival != null:
		survival.write_profile(profile)
	profile["health"] = health
	profile["ki"] = ki
	profile["stamina"] = stamina
	_play_time_total += _play_time
	_play_time = 0.0
	profile["play_time"] = _play_time_total
	inventory.hotbar_index = hotbar_index
	profile["inventory"] = inventory.to_dict()
	var planet := "earth"
	if world != null and world.get("planet_id") != null:
		planet = String(world.get("planet_id"))
	elif Game != null:
		planet = String(Game.world_info.get("planet", "earth"))
	profile["position"] = {
		"planet": planet, "x": global_position.x, "y": global_position.y, "z": global_position.z,
		"yaw": camera_rig.yaw_deg if camera_rig != null else rad_to_deg(yaw),
	}
	profile["spawn"] = {"planet": spawn_planet, "x": spawn_point.x, "y": spawn_point.y, "z": spawn_point.z}
	var f: Dictionary = profile.get("forms", {})
	f["current"] = current_form
	profile["forms"] = f

## Recompute the pools/derived numbers after a stat raise or a transformation.
func refresh_derived() -> void:
	if stats != null:
		max_health = _stat("max_health", max_health)
		max_ki = _stat("max_ki", max_ki)
		max_stamina = _stat("max_stamina", max_stamina)
		melee_damage = _stat("melee", melee_damage)
		defense = _stat("defense", defense)
		speed_mult = _stat("speed_mult", 1.0)
	health = minf(health, max_health)
	ki = minf(ki, max_ki)
	stamina = minf(stamina, max_stamina)
	_emit_all()

func _emit_all() -> void:
	Events.health_changed.emit(health, max_health)
	Events.ki_changed.emit(ki, max_ki)
	Events.stamina_changed.emit(stamina, max_stamina)
	if survival != null:
		Events.hunger_changed.emit(survival.hunger, PlayerStats.HUNGER_MAX)

func surface_y(x: float, z: float) -> float:
	if world != null and world.has_method("get_height"):
		return float(world.call("get_height", int(floor(x)), int(floor(z)))) + 0.1
	return FALLBACK_GROUND

# --- TP (Training reads these) ---------------------------------------------

func get_tp() -> int:
	return int(Game.profile.get("tp", 0)) if Game != null else 0

func set_tp(value: int) -> void:
	if Game != null:
		Game.profile["tp"] = maxi(0, value)

func tp_total() -> int:
	return int(Game.profile.get("tp_total", 0)) if Game != null else 0

## Spend TP on one attribute. The UI calls this (or `stats.raise` as a fallback).
func raise_stat(key: String) -> bool:
	if ResourceLoader.exists("res://scripts/combat/Training.gd"):
		return Training.raise_stat(self, key, 1)
	if stats != null and stats.has_method("raise"):
		stats.call("raise", key, 1)
		refresh_derived()
		return true
	return false

## Freeze player control (transformation cinematics). `input_locked` lives on Entity.
func set_input_locked(on: bool) -> void:
	super.set_input_locked(on)
	if on:
		input.clear_all()
		velocity.x = 0.0
		velocity.z = 0.0

func skill_level(id: String) -> int:
	if Game == null:
		return 0
	return int(Game.profile.get("skills", {}).get(id, 0))

func flight_allowed() -> bool:
	if creative_flight or noclip:
		return true
	if Game != null and Game.creative:
		return true
	return skill_level("fly") >= 1

# --- accessors used by the UI / other subsystems ---------------------------

func selected_stack() -> ItemStack:
	inventory.hotbar_index = hotbar_index
	return inventory.stack_at(hotbar_index)

func select_hotbar(i: int) -> void:
	var n := clampi(i, 0, Inventory.HOTBAR_SIZE - 1)
	if n == hotbar_index:
		return
	hotbar_index = n
	inventory.hotbar_index = n
	Events.hotbar_changed.emit(n)

func eye_height() -> float:
	return CROUCH_EYE if is_crouching else float(_phys["eye_height"])

func eye_position() -> Vector3:
	return global_position + Vector3(0.0, eye_height(), 0.0)

func aim_origin() -> Vector3:
	return camera_rig.aim_origin() if camera_rig != null else eye_position()

func aim_direction() -> Vector3:
	return camera_rig.aim_direction() if camera_rig != null else facing()

func speed_now() -> float:
	return Vector2(velocity.x, velocity.z).length()

func head_in_liquid() -> bool:
	if world == null or not world.has_method("is_liquid"):
		return false
	var e := eye_position()
	return bool(world.call("is_liquid", int(floor(e.x)), int(floor(e.y)), int(floor(e.z))))

func set_model_visible(v: bool) -> void:
	if model != null:
		model.visible = v

func give(item_id: String, count := 1) -> int:
	var left := inventory.add(item_id, count)
	if left < count:
		Audio.play_sfx("pop", linear_to_db(0.8))
		Events.item_picked_up.emit(item_id, count - left)
	return left

# --- input ------------------------------------------------------------------

func _unhandled_input(event: InputEvent) -> void:
	if keyboard != null and keyboard.handle_event(event):
		return
	if not (event is InputEventKey) or not event.is_pressed() or event.is_echo():
		return
	if Game == null or Game.ui == null:
		return
	for pair in [["inventory", "inventory"], ["quests", "quests"], ["stats", "stats"], ["ui_pause", "pause"]]:
		if InputMap.has_action(pair[0]) and event.is_action_pressed(pair[0]):
			Game.ui.call("toggle", pair[1])
			return
	if InputMap.has_action("camera_toggle") and event.is_action_pressed("camera_toggle"):
		camera_rig.cycle_mode()

func _read_input(delta: float) -> void:
	if keyboard != null:
		keyboard.poll()
	if input.hotbar_select == -2:
		select_hotbar(posmod(hotbar_index - 1, Inventory.HOTBAR_SIZE))
	elif input.hotbar_select == -3:
		select_hotbar(posmod(hotbar_index + 1, Inventory.HOTBAR_SIZE))
	elif input.hotbar_select >= 0:
		select_hotbar(input.hotbar_select)
	if camera_rig != null:
		camera_rig.apply_look(input.look_delta)
	if input.jump_pressed:
		if _clock - _last_jump_time < DOUBLE_TAP_TIME:
			toggle_fly()
		_last_jump_time = _clock
	if input.toggle_fly or input.fly_pressed:
		toggle_fly()
	if input.transform_pressed:
		request_transform()
	if input.technique_pressed and Game != null and Game.ui != null:
		Game.ui.call("open", "radial")
	if input.dash_pressed and _dash_cd <= 0.0:
		dash()
	if input.lock_on_pressed:
		LockOn.toggle(self)
	# Ki blast: tap = plain blast, hold >= 0.4 s = charged shot (Techniques.begin -> release,
	# so the combat engineer's charge orb / sound / damage scaling run).
	if input.ki_blast:
		_blast_hold += delta
		_blast_active = true
		if not _blast_charging and _blast_hold >= 0.4:
			_blast_charging = Techniques.begin(self, CHARGED_BLAST)
			if _blast_charging:
				play_state("ki_cast")
	elif _blast_active:
		_blast_active = false
		if _blast_charging:
			Techniques.release(self)
			play_state("ki_blast")
			_blast_charging = false
			if camera_rig != null:
				camera_rig.shake(0.3, 0.2)
		else:
			fire_ki_blast(input.ki_blast_charged)
		_blast_hold = 0.0
	_set_charging(input.ki_charge)

func _set_charging(on: bool) -> void:
	var k := Ki.find_on(self)
	if on and k == null:
		k = Ki.get_for(self)
	if k != null:
		k.set_charging(on)

func toggle_fly() -> void:
	if not flight_allowed():
		if Game != null and Game.ui != null:
			Game.ui.call("show_hint", "You have not learned to fly yet.", 2.5)
		return
	is_flying = not is_flying
	if is_flying:
		on_ground = false
		Audio.play_sfx("fly", -6.0)
		play_state("powerup")
	UiUtil.vibrate(12)

func dash() -> void:
	var k := Ki.get_for(self)
	if k != null and not k.can_spend_stamina(DASH_STAMINA):
		return
	_dash_cd = DASH_COOLDOWN
	var dir := aim_direction()
	if input.move != Vector2.ZERO:
		dir = move_direction()
	velocity += dir.normalized() * DASH_IMPULSE
	if k != null:
		k.spend_stamina(DASH_STAMINA)
	else:
		stamina = maxf(0.0, stamina - DASH_STAMINA)
		Events.stamina_changed.emit(stamina, max_stamina)
	Audio.play_sfx("dash", -4.0)
	play_state("dash")
	if ResourceLoader.exists("res://scripts/fx/Trails.gd"):
		var tr := Trails.get_for(self)
		if tr != null:
			tr.dash(dir.normalized())
	if camera_rig != null:
		camera_rig.shake(0.25, 0.15)

func request_transform() -> void:
	var active: Array[String] = Forms.active(self)
	if not active.is_empty():
		Forms.revert(self)
		return
	play_state("transform")
	var unlocked: Array = Game.profile.get("forms", {}).get("unlocked", []) if Game != null else []
	for fid in unlocked:
		if bool(Forms.can_transform(self, String(fid)).get("ok", false)):
			Forms.transform(self, String(fid))
			return
	if Game != null and Game.ui != null:
		Game.ui.call("open", "stats", {"tab": 3})

func fire_ki_blast(charged := false) -> void:
	var tech := CHARGED_BLAST if charged else BASIC_BLAST
	if Registry != null and Registry.technique(tech).is_empty():
		tech = BASIC_BLAST
	if not Techniques.tap(self, tech):
		return
	play_state("ki_blast")
	if camera_rig != null:
		camera_rig.shake(0.3 if charged else 0.12, 0.2)

## Charge progress of a held ki blast / technique, for the HUD ring (0 when idle).
func charge_progress() -> float:
	return Techniques.charge_progress(self)

# --- movement ---------------------------------------------------------------

func move_direction() -> Vector3:
	var yaw_r := deg_to_rad(camera_rig.yaw_deg) if camera_rig != null else yaw
	var fwd := Vector3(-sin(yaw_r), 0.0, -cos(yaw_r))
	var right := Vector3(cos(yaw_r), 0.0, -sin(yaw_r))
	var d := fwd * input.move.y + right * input.move.x
	if is_flying and absf(input.move.y) > 0.01 and camera_rig != null:
		d = camera_rig.look_direction() * input.move.y + right * input.move.x
	return d.normalized() if d.length() > 0.001 else Vector3.ZERO

func target_speed() -> float:
	var mult := maxf(0.2, speed_mult)
	if is_flying:
		return Skills.fly_speed(self, fly_fast) * mult
	if is_swimming:
		return float(_phys["swim"]) * mult
	if is_crouching:
		return float(_phys["sneak"]) * mult
	if is_sprinting:
		return float(_phys["sprint"]) * Skills.sprint_mult(self) * mult
	return float(_phys["walk"]) * mult

func jump_speed() -> float:
	# Heavier gravity means a shorter jump; 1/sqrt(g) keeps the jump *height* proportional.
	return float(_phys["jump"]) * Skills.jump_mult(self) / sqrt(maxf(0.1, gravity_scale()))

## Planet gravity (clamped) times the training gravity device, if one is running.
func gravity_scale() -> float:
	var g := clampf(planet_gravity(), GRAVITY_MIN, GRAVITY_MAX)
	var tr := Training.find_on(self)
	if tr != null and tr.get("gravity_mult") != null:
		g *= clampf(float(tr.get("gravity_mult")), 1.0, GRAVITY_MAX)
	return clampf(g, GRAVITY_MIN, GRAVITY_MAX * 2.0)

## Entity.tick: the player drives its own movement instead of Entity.apply_physics.
func tick(delta: float) -> void:
	delta = minf(delta, DT_MAX)
	_clock += delta
	if _dash_cd > 0.0:
		_dash_cd = maxf(0.0, _dash_cd - delta)
	if world == null and Game != null:
		world = Game.world
	if Game != null and Game.paused_by_ui:
		input.move = Vector2.ZERO
		input.end_frame()
		return
	if input_locked:
		input.move = Vector2.ZERO
		input.end_frame()
		_update_fluid()
		_apply_motion(Vector3(0.0, velocity.y * delta, 0.0))
		_animate()
		return
	_play_time += delta
	if infinite_ki:
		ki = max_ki
		stamina = max_stamina
	_read_input(delta)
	_update_fluid()
	_update_modes(delta)
	_integrate(delta)
	_survival(delta)
	_animate()
	LockOn.tick(self)
	Skills.tick(self, delta)
	if camera_rig != null:
		camera_rig.set_fov_extra(8.0 if (is_flying and fly_fast) else 0.0)
	input.end_frame()

func _voxel() -> Object:
	return Entity._voxel_physics()

func _update_fluid() -> void:
	in_liquid = false
	submerged = 0.0
	flow = Vector3.ZERO
	on_ladder = false
	if world == null:
		return
	var vp := _voxel()
	if vp != null and vp.has_method("fluid_at"):
		var r: Variant = vp.call("fluid_at", world, aabb())
		if r is Dictionary:
			in_liquid = bool((r as Dictionary).get("in_liquid", false))
			submerged = float((r as Dictionary).get("submerged_fraction", 0.0))
			flow = (r as Dictionary).get("flow", Vector3.ZERO)
	if vp != null and vp.has_method("is_on_ladder"):
		on_ladder = bool(vp.call("is_on_ladder", world, aabb()))

func _update_modes(delta: float) -> void:
	is_crouching = input.sneak and not is_flying
	is_swimming = in_liquid and submerged > 0.35
	var moving := input.move.length() > 0.1
	is_sprinting = input.wants_sprint() and moving and not is_crouching and stamina > 1.0
	fly_fast = is_flying and input.wants_sprint()
	var k := Ki.find_on(self)
	if fly_fast:
		if k != null:
			k.drain_stamina(FLY_FAST_STAMINA * delta)
		else:
			stamina = maxf(0.0, stamina - FLY_FAST_STAMINA * delta)
			Events.stamina_changed.emit(stamina, max_stamina)
		if stamina <= 0.0:
			fly_fast = false
	if is_flying and not (infinite_ki or creative_flight or noclip):
		var drain := KI_FLY_DRAIN * delta * (2.0 if fly_fast else 1.0)
		if k != null:
			k.set_ki(k.ki() - drain)
		else:
			ki = maxf(0.0, ki - drain)
			Events.ki_changed.emit(ki, max_ki)
		if ki <= 0.0:
			is_flying = false
	if is_flying and on_ground and input.sneak:
		is_flying = false

func _integrate(delta: float) -> void:
	var want := move_direction() * target_speed()
	if in_liquid and not is_flying:
		want *= LIQUID_SPEED_MULT
	var accel := ACCEL_GROUND
	if is_flying:
		accel = ACCEL_FLY
	elif in_liquid:
		accel = ACCEL_LIQUID
	elif not on_ground:
		accel = ACCEL_AIR
	velocity.x = move_toward(velocity.x, want.x, accel * delta)
	velocity.z = move_toward(velocity.z, want.z, accel * delta)
	if is_flying or noclip:
		var vy := 0.0
		if input.jump:
			vy = FLY_VERTICAL
		elif input.sneak:
			vy = -FLY_VERTICAL
		elif absf(input.move.y) > 0.01 and camera_rig != null:
			vy = camera_rig.look_direction().y * target_speed() * input.move.y
		velocity.y = move_toward(velocity.y, vy, FLY_VERTICAL_ACCEL * delta)
	elif on_ladder:
		velocity.y = LADDER_SPEED if input.jump else (-LADDER_SPEED if input.sneak else 0.0)
	elif in_liquid:
		velocity.y -= LIQUID_GRAVITY * delta
		if input.jump:
			velocity.y = minf(LIQUID_VY_MAX, velocity.y + SWIM_UP * delta * 6.0)
		elif submerged > 0.6 and not input.sneak:
			velocity.y += 8.8 * delta
		velocity.y = clampf(velocity.y, LIQUID_VY_MIN, LIQUID_VY_MAX)
		velocity += flow * 1.5 * delta
	else:
		velocity.y = maxf(TERMINAL_VELOCITY, velocity.y - float(_phys["gravity"]) * gravity_scale() * delta)
		if input.jump and on_ground:
			velocity.y = jump_speed()
			on_ground = false
			Audio.play_sfx("jump", -12.0)
	_apply_motion(velocity * delta)
	# face the camera direction while moving so the model matches the view
	if camera_rig != null and (input.move.length() > 0.05 or camera_rig.mode != CameraRig.Mode.SHOULDER):
		yaw = deg_to_rad(camera_rig.yaw_deg)
		rotation.y = yaw
	if target != null and is_instance_valid(target):
		look_at_head((target as Node3D).global_position)
	else:
		head_pitch_deg = clampf(camera_rig.pitch_deg if camera_rig != null else 0.0, -50.0, 50.0)
		head_yaw_deg = 0.0

func _apply_motion(motion: Vector3) -> void:
	var was_ground := on_ground
	var vy_before := velocity.y
	var step := float(_phys["step_height"]) if (on_ground or in_liquid) else 0.0
	var vp := _voxel()
	var moved_from := global_position
	if noclip:
		global_position += motion
		on_ground = false
		var dn := global_position - moved_from
		ground_speed = Vector2(dn.x, dn.z).length() / maxf(get_process_delta_time(), 0.0001)
		return
	if vp != null and world != null and vp.has_method("move_aabb"):
		var box := aabb()
		var r: Variant = vp.call("move_aabb", world, box, motion, step)
		if r is Dictionary:
			var nb: AABB = (r as Dictionary).get("aabb", box)
			global_position = nb.position + Vector3(aabb_size.x * 0.5, 0.0, aabb_size.z * 0.5)
			on_ground = bool((r as Dictionary).get("on_ground", false))
			if bool((r as Dictionary).get("hit_y", false)):
				velocity.y = 0.0
			if bool((r as Dictionary).get("hit_x", false)):
				velocity.x = 0.0
			if bool((r as Dictionary).get("hit_z", false)):
				velocity.z = 0.0
		else:
			global_position += motion
	else:
		# No world yet: flat ground plane so the player works in the HUD preview and in tests.
		global_position += motion
		if global_position.y <= FALLBACK_GROUND and not is_flying:
			global_position.y = FALLBACK_GROUND
			velocity.y = 0.0
			on_ground = true
		else:
			on_ground = is_flying
	if is_flying:
		on_ground = false
	if on_ground and not was_ground and vy_before <= 0.0:
		if vy_before < -6.0:
			play_state("land")
		if _stepper != null:
			Footsteps.land(world, global_position, absf(vy_before))
	var d := global_position - moved_from
	ground_speed = Vector2(d.x, d.z).length() / maxf(get_process_delta_time(), 0.0001)
	distance_moved += Vector2(d.x, d.z).length()

func _survival(delta: float) -> void:
	if survival == null:
		return
	survival.note_airborne(global_position.y, on_ground or on_ladder, is_flying, in_liquid)
	var has_o2 := true
	if world != null and Registry != null and world.get("planet_id") != null:
		has_o2 = bool(Registry.planet(String(world.get("planet_id"))).get("oxygen", true))
	survival.tick(delta, speed_now(), is_sprinting, head_in_liquid(), has_o2)
	_footsteps(delta)

## Footstep / landing / splash audio lives in scripts/audio/Footsteps.gd (audio engineer).
func _footsteps(delta: float) -> void:
	if in_liquid and not _was_in_liquid and _stepper != null:
		Footsteps.splash(global_position, clampf(absf(velocity.y) / 6.0, 0.4, 1.5))
	_was_in_liquid = in_liquid
	if _stepper == null:
		return
	_stepper.call("advance", delta, speed_now(), on_ground and not is_flying, world, global_position,
		is_sprinting, is_crouching, is_swimming)

## Locomotion + one-shot actions live in PlayerAnimator (see its LOCOMOTION / ACTIONS tables).
func _animate() -> void:
	if animator != null:
		animator.update(get_process_delta_time())

## Trigger a one-shot animation state through the animator ("attack" picks the combo step).
## `play_action(state)` itself comes from Entity - this is the indexed variant.
func play_combo(index: int) -> void:
	if animator != null:
		animator.play_action("attack", index)

func play_state(action_state: String) -> void:
	if animator != null:
		animator.play_action(action_state)

# --- damage / death --------------------------------------------------------

func take_damage(amount: float, source: Node = null, kind_of := "melee", knockback := Vector3.ZERO) -> float:
	if dead or god_mode:
		return 0.0
	var extra := 0.0
	if inventory != null:
		extra = inventory.armor_defense()
	var before := defense
	defense += extra
	var applied := super.take_damage(amount, source, kind_of, knockback)
	defense = before
	if applied <= 0.0:
		return 0.0
	if knockback.length() > 2.0:
		play_state("hurt")
	Events.health_changed.emit(health, max_health)
	Events.player_damaged.emit(applied, source, kind_of)
	UiUtil.vibrate(40)
	if camera_rig != null:
		camera_rig.shake(0.5, 0.25)
	return applied

func heal(amount: float) -> float:
	var got := super.heal(amount)
	if got > 0.0:
		Events.health_changed.emit(health, max_health)
	return got

func die(killer: Node = null) -> void:
	if dead:
		return
	dead = true
	health = 0.0
	velocity = Vector3.ZERO
	is_flying = false
	input.clear_all()
	Audio.play_sfx("knockback_character")
	_play_death_animation()
	Events.player_died.emit(killer)
	Events.entity_died.emit(self, killer)
	died.emit(killer)
	if Game != null and Game.ui != null:
		Game.ui.call("open", "death", {"killer": killer})

func respawn() -> void:
	dead = false
	health = max_health
	ki = max_ki
	stamina = max_stamina
	if survival != null:
		survival.set_hunger(PlayerStats.HUNGER_MAX)
		survival.oxygen = PlayerStats.OXYGEN_MAX
	Forms.revert_all(self)
	if animator != null:
		animator.clear_action()
	var p := spawn_point
	if p.y < 0.0:
		p.y = surface_y(p.x, p.z)
	global_position = p
	velocity = Vector3.ZERO
	if model != null:
		model.rotation = Vector3.ZERO
		model.scale = Vector3.ONE * model_scale
		model.set_tint(Color.WHITE)
	if Game != null and Game.world_info.get("difficulty", "normal") == "hard" \
			and not bool(Game.world_info.get("keep_inventory", true)):
		inventory.clear()
	_emit_all()
	Events.player_respawned.emit()

## Dev mode helpers used by scenes/ui/DevMenu.tscn.
func set_cheat(name: String, on: bool) -> void:
	match name:
		"god_mode": god_mode = on
		"infinite_ki": infinite_ki = on
		"creative_flight":
			creative_flight = on
			if not on and not flight_allowed():
				is_flying = false
		"noclip":
			noclip = on
			if on:
				is_flying = true
			else:
				is_flying = flight_allowed() and is_flying
	if on and name == "god_mode":
		health = max_health
		Events.health_changed.emit(health, max_health)

func cheat(name: String) -> bool:
	match name:
		"god_mode": return god_mode
		"infinite_ki": return infinite_ki
		"creative_flight": return creative_flight
		"noclip": return noclip
	return false

func teleport(pos: Vector3) -> void:
	global_position = pos
	velocity = Vector3.ZERO

func set_spawn(pos: Vector3, planet := "") -> void:
	spawn_point = pos
	if planet != "":
		spawn_planet = planet
	if Game != null:
		Game.profile["spawn"] = {"planet": spawn_planet, "x": pos.x, "y": pos.y, "z": pos.z}
