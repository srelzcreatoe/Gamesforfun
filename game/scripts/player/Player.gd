class_name Player
extends PlayerBase
## The player character: movement (walk / sprint / sneak / swim / ladder / ki flight), survival,
## inventory, camera rig and block interaction. ARCHITECTURE.md §6 + CUBIC_WORLD_UI_SPEC.md §4.
##
## Cross-subsystem code is loaded dynamically (VoxelPhysics, BedrockModel, RaceSkin,
## BedrockAnimation, combat Stats) so the player runs before those land.

const VOXEL_PHYSICS := "res://scripts/world/VoxelPhysics.gd"
const BEDROCK_MODEL := "res://scripts/entity/BedrockModel.gd"
const BEDROCK_ANIM := "res://scripts/entity/BedrockAnimation.gd"
const RACE_SKIN := "res://scripts/entity/RaceSkin.gd"

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
const FLY_FAST_STAMINA := 12.0
const DASH_IMPULSE := 12.0
const DASH_COOLDOWN := 0.9
const KI_CHARGE_RATE := 18.0
const KI_FLY_DRAIN := 0.6

var input: PlayerInput = PlayerInput.new()
var keyboard: KeyboardInput = null
var camera_rig: CameraRig = null
var interaction: Node = null
var inventory: Inventory = null

var is_crouching := false
var is_sprinting := false
var is_swimming := false
var fly_fast := false
var on_ladder := false
var submerged := 0.0
var flow := Vector3.ZERO

var hotbar_index: int = 0
var spawn_point := Vector3(0.5, 64.0, 0.5)
var spawn_planet := "earth"
var dead := false

var _phys: Dictionary = DEFAULT_PHYSICS.duplicate()
var _vp: GDScript = null
var _last_jump_time := -10.0
var _dash_cd := 0.0
var _step_dist := 0.0
var _ki_blast_hold := 0.0
var _ki_blast_active := false
var _time := 0.0
var _profile_pos_applied := false
var _fallback_ground := 0.0

func _ready() -> void:
	entity_type = "player"
	faction = "player"
	name = "Player"
	if ResourceLoader.exists(VOXEL_PHYSICS):
		_vp = load(VOXEL_PHYSICS)
	var def: Dictionary = Registry.entity("player") if Registry != null else {}
	var p: Dictionary = def.get("physics", {})
	for k in DEFAULT_PHYSICS.keys():
		_phys[k] = float(p.get(k, DEFAULT_PHYSICS[k]))
	var hb: Array = def.get("hitbox", [0.6, 1.8])
	if hb.size() >= 2:
		aabb_size = Vector3(float(hb[0]), float(hb[1]), float(hb[0]))
	inventory = Inventory.new(Inventory.PLAYER_SIZE, true)
	stats = PlayerStats.new(self)
	keyboard = KeyboardInput.new(input)
	camera_rig = CameraRig.new()
	camera_rig.name = "CameraRig"
	camera_rig.eye_height = float(_phys["eye_height"])
	add_child(camera_rig)
	camera_rig.set_player(self)
	_build_model()
	interaction = load("res://scripts/player/Interaction.gd").new()
	interaction.name = "Interaction"
	add_child(interaction)
	interaction.call("setup", self)
	if Game != null:
		Game.player = self
		world = Game.world
		if not Game.profile.is_empty():
			read_profile(Game.profile)
	Events.player_spawned.emit(self)
	set_process_unhandled_input(true)

# --- profile ---------------------------------------------------------------

func read_profile(profile: Dictionary) -> void:
	var st: PlayerStats = stats
	st.load_profile(profile)
	max_health = st.derived("max_health", 100.0)
	max_ki = st.derived("max_ki", 100.0)
	max_stamina = st.derived("max_stamina", 100.0)
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
	current_form = String(profile.get("forms", {}).get("current", ""))
	var inv: Dictionary = profile.get("inventory", {})
	if inv is Dictionary and not inv.is_empty():
		inventory.from_dict(inv)
	hotbar_index = inventory.hotbar_index
	var pos: Dictionary = profile.get("position", {})
	var sp: Dictionary = profile.get("spawn", {})
	spawn_planet = String(sp.get("planet", pos.get("planet", "earth")))
	spawn_point = Vector3(float(sp.get("x", 0.5)), float(sp.get("y", -1)), float(sp.get("z", 0.5)))
	var want := Vector3(float(pos.get("x", 0.5)), float(pos.get("y", -1)), float(pos.get("z", 0.5)))
	if want.y < 0.0:
		want.y = _surface_y(want.x, want.z)
		spawn_point.y = want.y
	global_position = want
	yaw = deg_to_rad(float(pos.get("yaw", 0.0)))
	if camera_rig != null:
		camera_rig.yaw_deg = float(pos.get("yaw", 0.0))
	_profile_pos_applied = true
	Events.health_changed.emit(health, max_health)
	Events.ki_changed.emit(ki, max_ki)
	Events.stamina_changed.emit(stamina, max_stamina)
	Events.hunger_changed.emit(st.hunger, PlayerStats.HUNGER_MAX)
	Events.inventory_changed.emit()

func write_profile(profile: Dictionary) -> void:
	var st: PlayerStats = stats
	st.write_profile(profile)
	profile["health"] = health
	profile["ki"] = ki
	profile["stamina"] = stamina
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

func _surface_y(x: float, z: float) -> float:
	if world != null and world.has_method("get_height"):
		return float(world.call("get_height", int(floor(x)), int(floor(z)))) + 0.1
	return 64.0

# --- model -----------------------------------------------------------------

func _build_model() -> void:
	if ResourceLoader.exists(BEDROCK_MODEL):
		var built := _try_bedrock_model()
		if built:
			return
	model = _box_model()
	add_child(model)

func _try_bedrock_model() -> bool:
	var script: GDScript = load(BEDROCK_MODEL)
	if script == null:
		return false
	var inst: Variant = script.new()
	if not (inst is Node3D):
		return false
	var m: Node3D = inst
	var def: Dictionary = Registry.entity("player") if Registry != null else {}
	var geo := String(def.get("model", "entity/races/human"))
	var ok := false
	for fn in ["build", "load_model", "set_geometry", "load_geometry"]:
		if m.has_method(fn):
			m.call(fn, geo)
			ok = true
			break
	if not ok:
		m.queue_free()
		return false
	model = m
	add_child(model)
	_apply_race_skin()
	if ResourceLoader.exists(BEDROCK_ANIM):
		var ascript: GDScript = load(BEDROCK_ANIM)
		var ai: Variant = ascript.new()
		if ai is Node:
			anim = ai
			add_child(anim)
			if anim.has_method("setup"):
				anim.call("setup", model)
			for a in def.get("animations", []):
				if anim.has_method("add_clips"):
					anim.call("add_clips", String(a))
	return true

func _apply_race_skin() -> void:
	if model == null or not ResourceLoader.exists(RACE_SKIN):
		return
	var script: GDScript = load(RACE_SKIN)
	if script == null or not script.has_method("compose"):
		return
	var ch: Dictionary = Game.profile.get("character", {}) if Game != null else {}
	var img: Variant = script.call("compose", ch)
	if img is Image and model.has_method("set_texture"):
		model.call("set_texture", img)

## Blocky stand-in figure so the player is visible before the Bedrock models land.
func _box_model() -> Node3D:
	var root := Node3D.new()
	root.name = "BoxModel"
	var ch: Dictionary = Game.profile.get("character", {}) if Game != null else {}
	var skin := UiUtil.color_hex(String(ch.get("skin_color", "#FFD3C9")), Color(1.0, 0.83, 0.79))
	var hair := UiUtil.color_hex(String(ch.get("hair_color", "#222629")), Color(0.13, 0.15, 0.16))
	var gi := Color(0.85, 0.45, 0.1)
	var parts := [
		["Head", Vector3(0.5, 0.5, 0.5), Vector3(0, 1.55, 0), skin],
		["Hair", Vector3(0.54, 0.16, 0.54), Vector3(0, 1.78, 0), hair],
		["Body", Vector3(0.5, 0.6, 0.28), Vector3(0, 1.0, 0), gi],
		["ArmL", Vector3(0.18, 0.6, 0.18), Vector3(-0.34, 1.0, 0), skin],
		["ArmR", Vector3(0.18, 0.6, 0.18), Vector3(0.34, 1.0, 0), skin],
		["LegL", Vector3(0.2, 0.7, 0.2), Vector3(-0.12, 0.35, 0), Color(0.2, 0.3, 0.6)],
		["LegR", Vector3(0.2, 0.7, 0.2), Vector3(0.12, 0.35, 0), Color(0.2, 0.3, 0.6)],
	]
	for p in parts:
		var mi := MeshInstance3D.new()
		mi.name = String(p[0])
		var bm := BoxMesh.new()
		bm.size = p[1]
		mi.mesh = bm
		mi.position = p[2]
		var mat := StandardMaterial3D.new()
		mat.albedo_color = p[3]
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL
		mat.roughness = 1.0
		mi.material_override = mat
		root.add_child(mi)
	return root

func set_model_visible(v: bool) -> void:
	if model != null:
		model.visible = v

# --- accessors used by the UI / other subsystems ---------------------------

func selected_stack() -> ItemStack:
	inventory.hotbar_index = hotbar_index
	return inventory.get_stack(hotbar_index)

func select_hotbar(i: int) -> void:
	var n := clampi(i, 0, Inventory.HOTBAR_SIZE - 1)
	if n == hotbar_index:
		return
	hotbar_index = n
	inventory.hotbar_index = n
	Events.hotbar_changed.emit(n)

func eye_position() -> Vector3:
	return global_position + Vector3(0.0, crouch_eye() , 0.0)

func crouch_eye() -> float:
	return 1.35 if is_crouching else float(_phys["eye_height"])

func aim_origin() -> Vector3:
	return camera_rig.aim_origin() if camera_rig != null else eye_position()

func aim_direction() -> Vector3:
	return camera_rig.aim_direction() if camera_rig != null else Vector3.FORWARD

func skill_level(id: String) -> int:
	if Game == null:
		return 0
	return int(Game.profile.get("skills", {}).get(id, 0))

func can_fly() -> bool:
	return skill_level("fly") >= 1 or (Game != null and Game.creative)

func speed_now() -> float:
	return Vector2(velocity.x, velocity.z).length()

# --- input ------------------------------------------------------------------

func _unhandled_input(event: InputEvent) -> void:
	if keyboard != null and keyboard.handle_event(event):
		return
	if event is InputEventKey and event.pressed and not event.echo:
		var k: InputEventKey = event
		if Game != null and Game.ui != null:
			if InputMap.has_action("inventory") and event.is_action_pressed("inventory"):
				Game.ui.call("toggle", "inventory")
			elif InputMap.has_action("quests") and event.is_action_pressed("quests"):
				Game.ui.call("toggle", "quests")
			elif InputMap.has_action("stats") and event.is_action_pressed("stats"):
				Game.ui.call("toggle", "stats")
			elif InputMap.has_action("ui_pause") and event.is_action_pressed("ui_pause"):
				Game.ui.call("toggle", "pause")
		if InputMap.has_action("camera_toggle") and event.is_action_pressed("camera_toggle"):
			camera_rig.cycle_mode()

func _process_input(delta: float) -> void:
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
	# double-tap jump -> fly toggle
	if input.jump_pressed:
		if _time - _last_jump_time < DOUBLE_TAP_TIME and can_fly():
			_toggle_fly()
		_last_jump_time = _time
	if input.toggle_fly or input.fly_pressed:
		if can_fly():
			_toggle_fly()
	if input.transform_pressed:
		_request_transform()
	if input.technique_pressed and Game != null and Game.ui != null:
		Game.ui.call("open", "radial", {})
	if input.dash_pressed and _dash_cd <= 0.0:
		_dash()
	if input.lock_on_pressed:
		_cycle_lock_on()
	# ki blast: tap = blast, hold >= 0.4 s = charged
	if input.ki_blast:
		_ki_blast_hold += delta
		_ki_blast_active = true
	elif _ki_blast_active:
		_ki_blast_active = false
		_fire_ki_blast(_ki_blast_hold >= 0.4 or input.ki_blast_charged)
		_ki_blast_hold = 0.0
	if input.ki_charge:
		_charge_ki(delta)

func _toggle_fly() -> void:
	if not can_fly():
		if Game != null and Game.ui != null:
			Game.ui.call("show_hint", "You have not learned to fly yet.", 2.5)
		return
	is_flying = not is_flying
	if is_flying:
		on_ground = false
		Audio.play_sfx("fly", -6.0)
	UiUtil.vibrate(12)

func _dash() -> void:
	_dash_cd = DASH_COOLDOWN
	var dir := aim_direction()
	if input.move != Vector2.ZERO:
		dir = _move_dir()
	velocity += dir.normalized() * DASH_IMPULSE
	stamina = maxf(0.0, stamina - 10.0)
	Events.stamina_changed.emit(stamina, max_stamina)
	Audio.play_sfx("dash", -4.0)
	if camera_rig != null:
		camera_rig.shake(0.25, 0.15)

func _request_transform() -> void:
	var forms: Node = null
	if world != null:
		forms = world.get_node_or_null("Forms")
	if forms != null and forms.has_method("cycle_transform"):
		forms.call("cycle_transform", self)
		return
	if Game != null and Game.ui != null:
		Game.ui.call("open", "stats", {"tab": 3})

func _fire_ki_blast(charged: bool) -> void:
	var tech := "charged_ki_blast" if charged else "ki_blast"
	if Registry != null and Registry.technique(tech).is_empty():
		tech = "ki_blast"
	var techs: Node = null
	if world != null:
		techs = world.get_node_or_null("Techniques")
	if techs != null and techs.has_method("cast"):
		techs.call("cast", self, tech)
	else:
		var def: Dictionary = Registry.technique(tech) if Registry != null else {}
		var cost := float(def.get("ki_cost", 0.05)) * max_ki
		if ki < cost:
			return
		set_ki(ki - cost)
		Audio.play_sfx(String(def.get("fire_sound", "kiblast_shoot")))
	Events.technique_fired.emit(self, tech)
	play_anim("ki.barrage_fire", 0.1, false)
	if camera_rig != null:
		camera_rig.shake(0.3 if charged else 0.12, 0.2)

func _charge_ki(delta: float) -> void:
	set_ki(minf(max_ki, ki + KI_CHARGE_RATE * delta))
	if not Audio.is_loop_playing("ki_charge"):
		Audio.play_loop("ki_charge_loop", "ki_charge", -8.0)
		Events.ki_charge_changed.emit(self, true)

func _cycle_lock_on() -> void:
	if world == null or not world.has_method("get_entities"):
		return
	var best: Node = null
	var best_score := -1.0
	var dir := aim_direction()
	for e in world.call("get_entities"):
		if e == self or not (e is Node3D):
			continue
		if String(e.get("faction")) == "player":
			continue
		var d: Vector3 = (e as Node3D).global_position - eye_position()
		var dist := d.length()
		if dist > 48.0:
			continue
		var score := dir.dot(d.normalized()) - dist * 0.01
		if score > best_score:
			best_score = score
			best = e
	set_target(best if best != target else null)

# --- physics ---------------------------------------------------------------

func _move_dir() -> Vector3:
	var yaw_r := deg_to_rad(camera_rig.yaw_deg) if camera_rig != null else yaw
	var fwd := Vector3(-sin(yaw_r), 0.0, -cos(yaw_r))
	var right := Vector3(cos(yaw_r), 0.0, -sin(yaw_r))
	var d := fwd * input.move.y + right * input.move.x
	if is_flying and absf(input.move.y) > 0.01 and camera_rig != null:
		var look := camera_rig.look_direction()
		d = look * input.move.y + right * input.move.x
	return d.normalized() if d.length() > 0.001 else Vector3.ZERO

func target_speed() -> float:
	var mult := 1.0
	var st: PlayerStats = stats
	if st != null:
		mult = st.derived("speed_mult", 1.0)
	if is_flying:
		var fly_speed := float(_phys["fly"]) * (1.0 + 0.15 * float(maxi(0, skill_level("fly") - 1)))
		if fly_fast:
			fly_speed *= float(_phys["fly_fast_mult"])
		return fly_speed * mult
	if is_swimming:
		return float(_phys["swim"]) * mult
	if is_crouching:
		return float(_phys["sneak"]) * mult
	if is_sprinting:
		return float(_phys["sprint"]) * (1.0 + 0.05 * float(skill_level("sprint"))) * mult
	return float(_phys["walk"]) * mult

func _physics_process(delta: float) -> void:
	_time += Time.get_ticks_msec() * 0.0 + delta
	delta = minf(delta, DT_MAX)
	if _dash_cd > 0.0:
		_dash_cd = maxf(0.0, _dash_cd - delta)
	if Game != null and Game.world != null and world == null:
		world = Game.world
	if Game != null and Game.paused_by_ui:
		input.move = Vector2.ZERO
		input.end_frame()
		return
	if dead:
		input.end_frame()
		return
	_process_input(delta)
	if not input.ki_charge and Audio.is_loop_playing("ki_charge"):
		Audio.stop_loop("ki_charge")
		Events.ki_charge_changed.emit(self, false)
	_update_fluid()
	_update_modes(delta)
	_integrate(delta)
	_survival(delta)
	_animate()
	if camera_rig != null:
		camera_rig.set_fov_extra(8.0 if (is_flying and fly_fast) else 0.0)
	input.end_frame()

func _update_fluid() -> void:
	in_liquid = false
	submerged = 0.0
	flow = Vector3.ZERO
	on_ladder = false
	if world == null:
		return
	if _vp != null and _vp.has_method("fluid_at"):
		var r: Dictionary = _vp.call("fluid_at", world, aabb())
		in_liquid = bool(r.get("in_liquid", false))
		submerged = float(r.get("submerged_fraction", 0.0))
		flow = r.get("flow", Vector3.ZERO)
	elif world.has_method("is_liquid"):
		var p := global_position
		in_liquid = bool(world.call("is_liquid", int(floor(p.x)), int(floor(p.y)), int(floor(p.z))))
		submerged = 0.7 if in_liquid else 0.0
	if world.has_method("get_block") and Registry != null:
		var p2 := global_position + Vector3(0, 0.9, 0)
		var id := int(world.call("get_block", int(floor(p2.x)), int(floor(p2.y)), int(floor(p2.z))))
		if id > 0 and String(Registry.block(id).get("shape", "")) == "ladder":
			on_ladder = true

func head_in_liquid() -> bool:
	if world == null or not world.has_method("is_liquid"):
		return false
	var e := eye_position()
	return bool(world.call("is_liquid", int(floor(e.x)), int(floor(e.y)), int(floor(e.z))))

func _update_modes(delta: float) -> void:
	is_crouching = input.sneak and not is_flying
	is_swimming = in_liquid and submerged > 0.35
	var moving := input.move.length() > 0.1
	is_sprinting = input.wants_sprint() and moving and not is_crouching and stamina > 1.0
	fly_fast = is_flying and input.wants_sprint()
	if fly_fast:
		stamina = maxf(0.0, stamina - FLY_FAST_STAMINA * delta)
		if stamina <= 0.0:
			fly_fast = false
		Events.stamina_changed.emit(stamina, max_stamina)
	elif is_sprinting:
		stamina = maxf(0.0, stamina - 4.0 * delta)
		Events.stamina_changed.emit(stamina, max_stamina)
	elif stamina < max_stamina:
		stamina = minf(max_stamina, stamina + 8.0 * delta)
		Events.stamina_changed.emit(stamina, max_stamina)
	if is_flying:
		set_ki(maxf(0.0, ki - KI_FLY_DRAIN * delta * (2.0 if fly_fast else 1.0)))
		if ki <= 0.0:
			is_flying = false
	if is_flying and on_ground and input.sneak:
		is_flying = false

func _integrate(delta: float) -> void:
	var dir := _move_dir()
	var want := dir * target_speed()
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
	if is_flying:
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
			velocity.y += 2.2 * delta * 4.0    # buoyancy toward the surface
		velocity.y = clampf(velocity.y, LIQUID_VY_MIN, LIQUID_VY_MAX)
		velocity += flow * 1.5 * delta
	else:
		velocity.y = maxf(TERMINAL_VELOCITY, velocity.y - float(_phys["gravity"]) * _gravity_scale() * delta)
		if input.jump and on_ground:
			velocity.y = float(_phys["jump"]) * (1.0 + 0.06 * float(skill_level("jump")))
			on_ground = false
			play_anim("base.jump", 0.08, false)
	_apply_motion(velocity * delta, delta)

func _gravity_scale() -> float:
	if world == null or Registry == null:
		return 1.0
	var pid := String(world.get("planet_id")) if world.get("planet_id") != null else "earth"
	return float(Registry.planet(pid).get("gravity", 1.0))

func _apply_motion(motion: Vector3, delta: float) -> void:
	var was_ground := on_ground
	var step := float(_phys["step_height"]) if (on_ground or in_liquid) else 0.0
	if _vp != null and world != null and _vp.has_method("move_aabb"):
		var box := aabb()
		var r: Dictionary = _vp.call("move_aabb", world, box, motion, step)
		var nb: AABB = r.get("aabb", box)
		global_position = nb.position + Vector3(aabb_size.x * 0.5, 0.0, aabb_size.z * 0.5)
		on_ground = bool(r.get("on_ground", false))
		if bool(r.get("hit_y", false)):
			velocity.y = 0.0
		if bool(r.get("hit_x", false)):
			velocity.x = 0.0
		if bool(r.get("hit_z", false)):
			velocity.z = 0.0
	else:
		# No voxel physics available yet: flat ground plane so the player still works alone.
		global_position += motion
		if global_position.y <= _fallback_ground and not is_flying:
			global_position.y = _fallback_ground
			velocity.y = 0.0
			on_ground = true
		else:
			on_ground = is_flying
	if on_ground and not was_ground and velocity.y <= 0.0:
		play_anim("base.landing", 0.1, false)

func _survival(delta: float) -> void:
	var st: PlayerStats = stats
	if st == null:
		return
	st.note_airborne(global_position.y, on_ground or on_ladder, is_flying, in_liquid)
	var has_o2 := true
	if world != null and Registry != null and world.get("planet_id") != null:
		has_o2 = bool(Registry.planet(String(world.get("planet_id"))).get("oxygen", true))
	st.tick(delta, speed_now(), is_sprinting, head_in_liquid(), has_o2)
	# footsteps
	if on_ground and not is_flying:
		var sp := speed_now()
		if sp > 0.3:
			_step_dist += sp * delta
			var interval := clampf(2.2 / maxf(0.5, sp), 0.25, 0.6) * maxf(0.5, sp)
			if _step_dist >= interval:
				_step_dist = 0.0
				_footstep()
	else:
		_step_dist = 0.0

func _footstep() -> void:
	var mat := "stone"
	if world != null and world.has_method("get_block") and Registry != null:
		var p := global_position - Vector3(0, 0.2, 0)
		var id := int(world.call("get_block", int(floor(p.x)), int(floor(p.y)), int(floor(p.z))))
		if id > 0:
			mat = String(Registry.block(id).get("material", "stone"))
	Audio.play_sfx("step_" + mat, linear_to_db(0.35))

func _animate() -> void:
	if is_flying:
		if fly_fast:
			play_anim("base.fly_fast")
		elif input.move.length() > 0.1:
			play_anim("base.fly_front")
		else:
			play_anim("base.fly_idle")
		return
	if is_swimming:
		play_anim("base.swimming")
		return
	if input.ki_charge:
		play_anim("base.ki_charge")
		return
	var sp := speed_now()
	if is_crouching:
		play_anim("base.crouching_walk" if sp > 0.2 else "base.crouching")
	elif sp > 4.6:
		play_anim("base.run")
	elif sp > 0.2:
		play_anim("base.walk")
	else:
		play_anim("base.idle")

# --- damage / death --------------------------------------------------------

func set_ki(v: float) -> void:
	var n := clampf(v, 0.0, max_ki)
	if absf(n - ki) > 0.001:
		ki = n
		Events.ki_changed.emit(ki, max_ki)

func take_damage(amount: float, source: Node = null, kind := "generic", knockback := Vector3.ZERO) -> float:
	if dead or amount <= 0.0:
		return 0.0
	var st: PlayerStats = stats
	var defense := st.derived("defense", 0.0) if st != null else 0.0
	if inventory != null:
		defense += inventory.armor_defense()
	var applied := maxf(1.0, amount - defense * 0.5)
	health = maxf(0.0, health - applied)
	if knockback != Vector3.ZERO:
		velocity += knockback
	Events.health_changed.emit(health, max_health)
	Events.player_damaged.emit(applied, source, kind)
	Events.entity_damaged.emit(self, applied, source, kind, false)
	Audio.play_sfx("hurt")
	UiUtil.vibrate(40)
	if camera_rig != null:
		camera_rig.shake(0.5, 0.25)
	if health <= 0.0:
		die(source)
	return applied

func heal(amount: float) -> void:
	health = clampf(health + amount, 0.0, max_health)
	Events.health_changed.emit(health, max_health)

func die(killer: Node = null) -> void:
	if dead:
		return
	dead = true
	alive = false
	velocity = Vector3.ZERO
	is_flying = false
	input.clear_all()
	Audio.play_sfx("knockback_character")
	Events.player_died.emit(killer)
	Events.entity_died.emit(self, killer)
	if Game != null and Game.ui != null:
		Game.ui.call("open", "death", {"killer": killer})

func respawn() -> void:
	dead = false
	alive = true
	health = max_health
	ki = max_ki
	stamina = max_stamina
	var st: PlayerStats = stats
	if st != null:
		st.set_hunger(PlayerStats.HUNGER_MAX)
		st.oxygen = PlayerStats.OXYGEN_MAX
	var p := spawn_point
	if p.y < 0.0:
		p.y = _surface_y(p.x, p.z)
	global_position = p
	velocity = Vector3.ZERO
	if Game != null and not bool(Game.world_info.get("keep_inventory", true)) and Game.world_info.get("difficulty", "normal") == "hard":
		inventory.clear()
	Events.health_changed.emit(health, max_health)
	Events.ki_changed.emit(ki, max_ki)
	Events.player_respawned.emit()

func set_spawn(pos: Vector3, planet := "") -> void:
	spawn_point = pos
	if planet != "":
		spawn_planet = planet

## Pick an item up (used by drops / rewards). Returns the leftover count.
func give(item_id: String, count := 1) -> int:
	var left := inventory.add(item_id, count)
	if left < count:
		Audio.play_sfx("pop", linear_to_db(0.8))
		Events.item_picked_up.emit(item_id, count - left)
	return left
