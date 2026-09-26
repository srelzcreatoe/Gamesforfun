class_name SimpleProjectile
extends Node3D
## Placeholder ki projectile used by `EnemyAI` when the combat engineer's
## `scripts/combat/Techniques.gd` (and `scenes/entities/KiBlast.tscn`) are not
## available yet. Moves in a straight line, raycasts the voxel world when there
## is one and damages the first entity it touches.

var direction := Vector3.FORWARD
var speed := 22.0
var damage := 5.0
var radius := 0.35
var life := 3.0
var source: Node = null
var faction := "villain"
var color := Color(0.55, 0.85, 1.0)
var world: Node = null

var _mesh: MeshInstance3D = null

func _ready() -> void:
	var sphere := SphereMesh.new()
	sphere.radius = radius
	sphere.height = radius * 2.0
	sphere.radial_segments = 8
	sphere.rings = 4
	_mesh = MeshInstance3D.new()
	_mesh.mesh = sphere
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = color
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = 2.0
	_mesh.material_override = m
	add_child(_mesh)

func launch(from: Vector3, dir: Vector3, dmg: float, src: Node) -> void:
	global_position = from
	direction = dir.normalized()
	damage = dmg
	source = src
	if src is Entity:
		faction = (src as Entity).faction
		world = (src as Entity).world

func _process(delta: float) -> void:
	if Game.paused_by_ui:
		return
	life -= delta
	if life <= 0.0:
		queue_free()
		return
	var step := direction * speed * delta
	var next := global_position + step
	if world != null and world.has_method("raycast"):
		var hit: Variant = world.call("raycast", global_position, direction, step.length() + radius, true)
		if hit is Dictionary and bool(hit.get("hit", false)):
			_explode(hit.get("point", next))
			return
	global_position = next
	for e in _nearby():
		if e == source or not (e is Entity):
			continue
		var ent: Entity = e
		if ent.faction == faction or not ent.is_alive():
			continue
		if ent.center().distance_to(global_position) <= radius + maxf(ent.aabb_size.x, 0.4):
			ent.take_damage(damage, source, "ki", direction * 4.0)
			_explode(global_position)
			return

func _nearby() -> Array:
	if world != null and world.has_method("entities_in_aabb"):
		var box := AABB(global_position - Vector3.ONE * 2.0, Vector3.ONE * 4.0)
		var r: Variant = world.call("entities_in_aabb", box)
		if r is Array:
			return r
	var host := get_parent()
	return host.get_children() if host != null else []

func _explode(at: Vector3) -> void:
	Events.explosion.emit(at, 1.2, damage * 0.25)
	if Audio != null:
		Audio.play_sfx_at("kiblast_explosion", at, -4.0)
	queue_free()
