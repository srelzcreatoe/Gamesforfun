class_name FxDummy
extends Node3D
## A stand-in Entity used by `scenes/fx/FxPreview.tscn` and by the combat unit tests.
##
## It implements exactly the parts of the `Entity` contract (docs/ARCHITECTURE.md §7)
## that combat and fx touch - the pools, `stats`, `model`, `play_anim`, `take_damage`,
## `aim_direction` - so the real entity engineer's `Entity.gd` can replace it without
## any change to the combat code.

var world: Node = null
var entity_type := "player"
var aabb_size := Vector3(0.6, 1.8, 0.6)
var velocity := Vector3.ZERO
var on_ground := true
var in_liquid := false
var yaw := 0.0
var stats: Stats = null
var health := 100.0
var max_health := 100.0
var ki := 100.0
var max_ki := 100.0
var stamina := 100.0
var max_stamina := 100.0
var faction := "player"
var team_id := 0
var is_flying := false
var current_form := ""
var base_scale := 1.0
var power_release := 1.0
var model: Node3D = null
var target: Node = null
var input_locked := false
var aura_color := "#7FFFFF"
var skills: Dictionary = {"ki_control": 3, "fly": 2, "potential_unlock": 2, "instant_transmission": 3}
var techniques: Array[String] = []
var forms_unlocked: Array[String] = []
var forms_mastery: Dictionary = {}
var model_override := ""

## A stub camera rig (`cinematic_orbit` / `shake`) can be injected here so the
## transformation director hands the camera work to it and leaves the preview camera
## where the verification shot needs it.
var camera_rig: Node = null
var animated := false
var race := "saiyan"
var anim: Node = null

## Test hooks.
var last_anim := ""
var damage_taken := 0.0
var anim_history: PackedStringArray = PackedStringArray()

## `animated` (the fx preview stage) also composes the DMZ race skin, builds the voxel
## hair and drives `entity/races/{movement,transf}` clips, so a transformation cinematic
## can be verified on a real character instead of a T-posed rig. The unit tests leave it
## off: they only need the pools and the hooks.
static func create(race := "saiyan", cls := "warrior", animated := false) -> FxDummy:
	var d := FxDummy.new()
	d.animated = animated
	d.race = race
	d.stats = Stats.create(race, cls)
	d.refresh_derived()
	d.ki = d.max_ki
	d.health = d.max_health
	d.stamina = d.max_stamina
	return d

func _ready() -> void:
	if stats == null:
		stats = Stats.create("saiyan", "warrior")
		refresh_derived()
		ki = max_ki
		health = max_health
		stamina = max_stamina
	if model == null:
		model = _build_model()
		add_child(model)
		if animated:
			_build_anim()

## A DMZ BedrockModel when the entity engineer's script is there, else a capsule.
func _build_model() -> Node3D:
	const BEDROCK := "res://scripts/entity/BedrockModel.gd"
	const TEX_REL := "sagas/saga_goku_early"
	var geo_rel := "entity/races/human"
	if animated:
		geo_rel = RaceSkin.race_model(race)
	if ResourceLoader.exists(BEDROCK) and ResourceLoader.exists("res://assets/models/" + geo_rel + ".geo.json"):
		var script: Variant = load(BEDROCK)
		if script is GDScript:
			var inst: Variant = (script as GDScript).new()
			if inst is Node3D and (inst as Node).has_method("load_geo"):
				var n := inst as Node3D
				n.name = "Model"
				if bool(n.call("load_geo", geo_rel)):
					if animated and not _apply_race_skin(n):
						if n.has_method("set_texture"):
							n.call("set_texture", Textures.entity_texture(TEX_REL))
					elif not animated and n.has_method("set_texture"):
						n.call("set_texture", Textures.entity_texture(TEX_REL))
					return n
				n.free()
			elif inst is Object:
				(inst as Object).free()
	var root := Node3D.new()
	root.name = "Model"
	var mi := MeshInstance3D.new()
	mi.name = "Body"
	var cap := CapsuleMesh.new()
	cap.radius = 0.28
	cap.height = 1.7
	mi.mesh = cap
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.85, 0.72, 0.62)
	m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL
	m.roughness = 0.9
	mi.material_override = m
	mi.position = Vector3(0, 0.85, 0)
	root.add_child(mi)
	var head := MeshInstance3D.new()
	head.name = "Head"
	head.mesh = FxAssets.cube_mesh(0.46)
	var hm := StandardMaterial3D.new()
	hm.albedo_color = Color(0.95, 0.8, 0.7)
	head.material_override = hm
	head.position = Vector3(0, 1.85, 0)
	root.add_child(head)
	return root

## Compose the race skin + voxel hair through the entity engineer's RaceSkin.
func _apply_race_skin(m: Node3D) -> bool:
	var bm: BedrockModel = m as BedrockModel
	if bm == null:
		return false
	RaceSkin.apply_to(bm, {
		"race": race, "gender": "male", "body_type": 0, "hair_type": 2,
		"hair_color": "#222629", "eye_color": "#3B2A1E",
		"skin_color": "#FFD3C9", "skin_color2": "#572117", "skin_color3": "#FFD3C9",
		"has_tail": race == "saiyan",
	}, [])
	return true

## DMZ movement + transformation clips on the model, so `play_anim("transf.ssj3")`
## actually poses the dummy in the preview stage.
func _build_anim() -> void:
	var bm: BedrockModel = model as BedrockModel
	if bm == null:
		return
	var a := BedrockAnimation.new()
	a.name = "Anim"
	add_child(a)
	a.setup(bm, self)
	for pack in ["entity/races/movement", "entity/races/transf"]:
		a.load_clips(pack)
	anim = a
	a.play("idle", 0.0, true, 1.0)

func refresh_derived() -> void:
	if stats == null:
		return
	max_health = stats.max_health()
	max_ki = stats.max_ki()
	max_stamina = stats.max_stamina()
	health = minf(health, max_health)
	ki = minf(ki, max_ki)
	stamina = minf(stamina, max_stamina)

# --- Entity contract ------------------------------------------------------

func play_anim(name: String, blend := 0.15, loop: Variant = true, speed := 1.0) -> bool:
	last_anim = name
	anim_history.append(name)
	if anim != null and is_instance_valid(anim) and anim.has_method("play"):
		return bool(anim.call("play", name, blend, loop, speed))
	return true

func _process(delta: float) -> void:
	if anim != null and is_instance_valid(anim) and anim.has_method("update"):
		anim.call("update", delta)

func take_damage(amount: float, source: Node = null, kind := "melee", knockback := Vector3.ZERO) -> float:
	damage_taken += amount
	health = maxf(0.0, health - amount)
	velocity += knockback
	Events.entity_damaged.emit(self, amount, source, kind, false)
	if health <= 0.0:
		die(source)
	return amount

func heal(amount: float) -> void:
	health = minf(max_health, health + amount)

func die(killer: Node = null) -> void:
	Events.entity_died.emit(self, killer)

func set_target(node: Node) -> void:
	target = node

func face(pos: Vector3) -> void:
	var d := pos - global_position
	if d.length_squared() > 0.001:
		yaw = atan2(-d.x, -d.z)
		rotation.y = yaw

func aim_direction() -> Vector3:
	return -global_transform.basis.z

func skill_level(id: String) -> int:
	return int(skills.get(id, 0))

func set_skill_level(id: String, level: int) -> void:
	skills[id] = level

func knows_technique(id: String) -> bool:
	return techniques.is_empty() or techniques.has(id)

func form_unlocked(id: String) -> bool:
	return forms_unlocked.is_empty() or forms_unlocked.has(id)

func unlock_form(id: String) -> bool:
	if not forms_unlocked.has(id):
		forms_unlocked.append(id)
	return true

func form_mastery(id: String) -> float:
	return float(forms_mastery.get(id, 0.0))

func set_form_mastery(id: String, value: float) -> void:
	forms_mastery[id] = value

func set_model_override(path: String) -> void:
	model_override = path

func set_input_locked(on: bool) -> void:
	input_locked = on

func get_tp() -> int:
	return _tp

func set_tp(value: int) -> void:
	_tp = maxi(0, value)

var _tp := 0
