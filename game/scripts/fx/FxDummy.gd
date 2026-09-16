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

## Test hooks.
var last_anim := ""
var damage_taken := 0.0
var anim_history: PackedStringArray = PackedStringArray()

static func create(race := "saiyan", cls := "warrior") -> FxDummy:
	var d := FxDummy.new()
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

## A DMZ BedrockModel when the entity engineer's script is in the tree, else a capsule.
func _build_model() -> Node3D:
	const BEDROCK := "res://scripts/entity/BedrockModel.gd"
	const GEO := "res://assets/models/entity/races/human.geo.json"
	if ResourceLoader.exists(BEDROCK) and ResourceLoader.exists(GEO):
		var script: Variant = load(BEDROCK)
		if script is GDScript:
			var inst: Variant = (script as GDScript).new()
			if inst is Node3D:
				var n := inst as Node3D
				n.name = "Model"
				if n.has_method("load_geometry"):
					n.call("load_geometry", GEO)
				elif n.has_method("build"):
					n.call("build", GEO)
				return n
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

func play_anim(name: String, blend := 0.15, loop := true) -> void:
	last_anim = name
	anim_history.append(name)

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
