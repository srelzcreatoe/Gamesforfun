class_name Trails
extends Node3D
## Movement fx for an entity: the ki trail that streams behind a fast flyer and the
## zanzoken dash afterimages (three fading copies of the body).
##
##   var t := Trails.get_for(entity)
##   t.set_flying_fast(true)          # or leave it: _process reads entity.velocity
##   t.dash(direction)                # afterimages + zanzoken sound
##   t.set_color(Color("#7FD4FF"))

const NODE_NAME := "Trails"
const DISSOLVE_SHADER := "res://shaders/dissolve.gdshader"
const TRAIL_TEX := "ki_trail0"
const AFTERIMAGES := 3
const AFTERIMAGE_LIFE := 0.28
const FAST_SPEED := 14.0

var entity: Node = null
var color := Color(0.5, 0.83, 1.0)
var auto_detect := true

var _trail: CPUParticles3D
var _flying_fast := false
var _dash_cooldown := 0.0

static func get_for(entity_node: Node) -> Trails:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var n: Node = entity_node.get_node_or_null(NODE_NAME)
	if n is Trails:
		return n
	var t := Trails.new()
	t.name = NODE_NAME
	t.entity = entity_node
	entity_node.add_child(t)
	return t

static func find_on(entity_node: Node) -> Trails:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var n: Node = entity_node.get_node_or_null(NODE_NAME)
	return n if n is Trails else null

func _ready() -> void:
	if entity == null:
		entity = get_parent()
	var aura := Aura.find_on(entity)
	if aura != null:
		color = aura.outer_color
	_build()

func _build() -> void:
	_trail = FxAssets.make_particles("KiTrail", 24, [TRAIL_TEX, "ki_trail3", "aura_1"], color)
	_trail.lifetime = 0.5
	_trail.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	_trail.emission_sphere_radius = 0.3
	_trail.direction = Vector3.ZERO
	_trail.spread = 30.0
	_trail.initial_velocity_min = 0.2
	_trail.initial_velocity_max = 1.2
	_trail.gravity = Vector3.ZERO
	_trail.scale_amount_min = 0.35
	_trail.scale_amount_max = 0.85
	_trail.position = Vector3(0, 0.9, 0)
	_trail.emitting = false
	add_child(_trail)

func set_color(c: Color) -> void:
	color = c
	if _trail != null:
		_trail.color = c

func set_flying_fast(on: bool) -> void:
	_flying_fast = on
	if _trail != null:
		_trail.emitting = on

func _process(delta: float) -> void:
	if entity == null or not is_instance_valid(entity):
		queue_free()
		return
	if _dash_cooldown > 0.0:
		_dash_cooldown -= delta
	if not auto_detect:
		return
	var speed := 0.0
	if "velocity" in entity:
		var v: Variant = entity.get("velocity")
		if v is Vector3:
			speed = (v as Vector3).length()
	var flying := bool(entity.get("is_flying")) if "is_flying" in entity else false
	var want := flying and speed > FAST_SPEED
	if want != _flying_fast:
		set_flying_fast(want)

## Three fading copies of the body plus the zanzoken sound.
func dash(direction := Vector3.ZERO) -> void:
	if _dash_cooldown > 0.0 or not is_inside_tree():
		return
	_dash_cooldown = 0.12
	var parent := get_parent_node_3d()
	var host: Node = entity.get_parent() if entity != null and entity.get_parent() != null else self
	if entity is Node3D:
		var from: Vector3 = (entity as Node3D).global_position
		var dir := direction
		if dir.length_squared() < 0.001:
			dir = -(entity as Node3D).global_transform.basis.z
		dir = dir.normalized()
		for i in AFTERIMAGES:
			var f := float(i + 1) / float(AFTERIMAGES + 1)
			spawn_ghost(entity, from - dir * (0.9 * float(i + 1)), color, AFTERIMAGE_LIFE * (1.0 - f * 0.4))
		Audio.play_sfx_at("zanzoken", from, -3.0)
		Audio.play_sfx_at("dash", from, -6.0)

## One fading additive copy of an entity's model at `pos`. Used by the dash afterimages
## and by the transformation cinematic's strain phase. Falls back to a capsule when the
## entity has no model yet, and does nothing when it is not in the tree.
static func spawn_ghost(entity_node: Node, pos: Vector3, c: Color, life := AFTERIMAGE_LIFE) -> Node3D:
	if entity_node == null or not is_instance_valid(entity_node) or not entity_node.is_inside_tree():
		return null
	var host: Node = entity_node.get_parent()
	if host == null or not host.is_inside_tree():
		return null
	var ghost: Node3D = null
	var model: Variant = entity_node.get("model") if "model" in entity_node else null
	if model is Node3D and (model as Node3D).is_inside_tree():
		var dup: Node = (model as Node3D).duplicate(DUPLICATE_USE_INSTANTIATION)
		if dup is Node3D:
			ghost = dup as Node3D
			_tint_recursive(ghost, c)
	if ghost == null:
		var mi := MeshInstance3D.new()
		var cap := CapsuleMesh.new()
		cap.radius = 0.3
		cap.height = 1.8
		mi.mesh = cap
		var m := FxAssets.additive_material(null, false)
		m.albedo_color = Color(c.r, c.g, c.b, 0.55)
		mi.material_override = m
		mi.position = Vector3(0, 0.9, 0)
		ghost = Node3D.new()
		ghost.add_child(mi)
	ghost.name = "Afterimage"
	host.add_child(ghost)
	ghost.global_position = pos
	if entity_node is Node3D:
		ghost.global_rotation = (entity_node as Node3D).global_rotation
		ghost.scale = (entity_node as Node3D).scale
	var tw := ghost.create_tween()
	tw.tween_property(ghost, "scale", ghost.scale * 0.85, life)
	tw.tween_callback(ghost.queue_free)
	_fade_recursive(ghost, life)
	return ghost

static func _tint_recursive(node: Node, c: Color) -> void:
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		var m := FxAssets.additive_material(null, false)
		m.albedo_color = Color(c.r, c.g, c.b, 0.5)
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for ch in node.get_children():
		_tint_recursive(ch, c)

static func _fade_recursive(node: Node, seconds: float) -> void:
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		var m: Variant = mi.material_override
		if m is StandardMaterial3D:
			var tw := mi.create_tween()
			tw.tween_property(m, "albedo_color:a", 0.0, seconds)
	for ch in node.get_children():
		_fade_recursive(ch, seconds)
