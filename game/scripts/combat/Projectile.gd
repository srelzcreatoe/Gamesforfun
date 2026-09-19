class_name KiProjectile
extends Node3D
## Ki blast / destructo disc projectile (script of `scenes/entities/KiBlast.tscn` and
## `scenes/entities/KiDisc.tscn`).
##
## No physics bodies: every frame the projectile sweeps its own segment with
## `World.raycast` for terrain and tests entity AABBs itself (§0 - the physics engine
## is Dummy). Blasts explode on the first thing they touch; discs slice through blocks
## softer than `DISC_HARDNESS` and keep going until their lifetime runs out.
##
##   KiProjectile.spawn(world, caster, origin, dir, {
##       "color": Color("#4FC3FF"), "size": 0.9, "speed": 30.0, "damage": 40.0,
##       "radius": 3.0, "life": 4.0, "mode": "blast", "technique": "kamehameha",
##       "target": some_entity })

const SPHERE_SHADER := "res://shaders/ki_sphere.gdshader"
const DEFAULT_SPEED := 30.0
const DEFAULT_LIFE := 4.0
## Terrain is only destroyed above this much damage (a pea shooter should not dig).
const TERRAIN_DAMAGE_MIN := 25.0
## Discs cut anything softer than this (blocks.json `hardness`).
const DISC_HARDNESS := 3.0
const DISC_CUT_RADIUS := 1
const HOMING_RATE := 2.5

var world: Node = null
var caster: Node = null
var mode := "blast"                 # "blast" | "disc"
var technique_id := ""
var color := Color(0.5, 0.83, 1.0)
var size := 0.6
var speed := DEFAULT_SPEED
var damage := 20.0
var blast_radius := 2.5
var life := DEFAULT_LIFE
var direction := Vector3.FORWARD
var target: Node = null
var destroy_terrain := true
var damage_kind := Damage.KI

var _age := 0.0
var _sphere: MeshInstance3D
var _disc: MeshInstance3D
var _mat: ShaderMaterial
var _trail: CPUParticles3D
var _light: OmniLight3D
var _hit_entities: Dictionary = {}
var _dead := false

# --- spawning -------------------------------------------------------------

static func spawn(world_node: Node, caster_node: Node, origin: Vector3, dir: Vector3,
		cfg: Dictionary) -> KiProjectile:
	var scene_path := "res://scenes/entities/KiDisc.tscn" if String(cfg.get("mode", "blast")) == "disc" else "res://scenes/entities/KiBlast.tscn"
	var p: KiProjectile = null
	if ResourceLoader.exists(scene_path):
		var packed: PackedScene = load(scene_path)
		var inst := packed.instantiate()
		if inst is KiProjectile:
			p = inst
		else:
			inst.queue_free()
	if p == null:
		p = KiProjectile.new()
	p.name = "KiProjectile"
	p.world = world_node
	p.caster = caster_node
	p.mode = String(cfg.get("mode", "blast"))
	p.technique_id = String(cfg.get("technique", ""))
	p.color = cfg.get("color", p.color)
	p.size = float(cfg.get("size", p.size))
	p.speed = float(cfg.get("speed", DEFAULT_SPEED))
	p.damage = float(cfg.get("damage", 20.0))
	p.blast_radius = float(cfg.get("radius", maxf(1.5, p.size * 2.5)))
	p.life = float(cfg.get("life", DEFAULT_LIFE))
	p.direction = dir.normalized() if dir.length_squared() > 0.0001 else Vector3.FORWARD
	p.target = cfg.get("target", null)
	p.destroy_terrain = bool(cfg.get("destroy_terrain", true))
	var parent: Node = world_node if world_node != null and world_node.is_inside_tree() else _fallback_parent()
	if parent == null:
		p.free()
		return null
	parent.add_child(p)
	p.global_position = origin
	return p

static func _fallback_parent() -> Node:
	if Game != null and Game.world != null and Game.world.is_inside_tree():
		return Game.world
	var loop := Engine.get_main_loop()
	if loop is SceneTree:
		return (loop as SceneTree).current_scene
	return null

func _ready() -> void:
	if world == null:
		world = Game.world if Game != null else null
	_build()

func _build() -> void:
	_mat = FxAssets.shader_material(SPHERE_SHADER, {
		"ki_color": color, "core_color": color.lightened(0.75), "intensity": 1.4,
	})
	if mode == "disc":
		_disc = MeshInstance3D.new()
		_disc.name = "Disc"
		var cyl := CylinderMesh.new()
		cyl.top_radius = size
		cyl.bottom_radius = size
		cyl.height = size * 0.14
		cyl.radial_segments = 20
		_disc.mesh = cyl
		_disc.material_override = _mat
		_disc.rotation_degrees = Vector3(90, 0, 0)
		_disc.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(_disc)
	else:
		_sphere = MeshInstance3D.new()
		_sphere.name = "Sphere"
		var sm := SphereMesh.new()
		sm.radius = size
		sm.height = size * 2.0
		sm.radial_segments = 14
		sm.rings = 7
		_sphere.mesh = sm
		_sphere.material_override = _mat
		_sphere.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(_sphere)
	_trail = FxAssets.make_particles("Trail", 18, ["ki_trail0", "ki_trail2", "aura_1"], color)
	_trail.lifetime = 0.35
	_trail.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	_trail.emission_sphere_radius = size * 0.4
	_trail.direction = Vector3.ZERO
	_trail.spread = 25.0
	_trail.initial_velocity_min = 0.0
	_trail.initial_velocity_max = 0.8
	_trail.gravity = Vector3.ZERO
	_trail.scale_amount_min = size * 0.6
	_trail.scale_amount_max = size * 1.6
	add_child(_trail)
	_trail.emitting = true
	if blast_radius > 3.0:
		_light = OmniLight3D.new()
		_light.light_color = color
		_light.light_energy = 2.2
		_light.omni_range = size * 8.0
		_light.shadow_enabled = false
		add_child(_light)

# --- per frame ------------------------------------------------------------

func _process(delta: float) -> void:
	if _dead:
		return
	if Game != null and Game.paused_by_ui:
		return
	_age += delta
	if _age >= life:
		_expire()
		return
	if mode == "disc" and _disc != null:
		_disc.rotate_y(delta * 26.0)
	if target != null and is_instance_valid(target) and target is Node3D:
		var want: Vector3 = ((target as Node3D).global_position + Vector3.UP * 0.9 - global_position).normalized()
		direction = direction.lerp(want, clampf(delta * HOMING_RATE, 0.0, 1.0)).normalized()
	var step := speed * delta
	var from := global_position
	var to := from + direction * step
	# terrain
	if world != null and world.has_method("raycast"):
		var hit: Dictionary = world.call("raycast", from, direction, step + size * 0.5, true)
		if bool(hit.get("hit", false)):
			if mode == "disc":
				_cut_blocks(hit.get("block", Vector3i.ZERO))
			else:
				global_position = hit.get("point", to)
				_impact(hit.get("point", to))
				return
	# entities
	var victim := _first_entity_hit(to)
	if victim != null:
		global_position = to
		_impact(to, victim)
		return
	global_position = to

func _first_entity_hit(pos: Vector3) -> Node:
	var reach := size + 0.5
	var box := AABB(pos - Vector3(reach, reach, reach), Vector3(reach, reach, reach) * 2.0)
	for e in _entities_near(box):
		if e == caster or e == self or not is_instance_valid(e):
			continue
		if _hit_entities.has(e.get_instance_id()):
			continue
		if _same_team(e):
			continue
		if _entity_aabb(e).intersects(box):
			return e
	return null

func _entities_near(box: AABB) -> Array:
	if world == null:
		return []
	if world.has_method("entities_in_aabb"):
		return world.call("entities_in_aabb", box)
	if world.has_method("get_entities"):
		return world.call("get_entities")
	return []

static func entity_aabb(e: Node) -> AABB:
	if not (e is Node3D):
		return AABB()
	var s := Vector3(0.6, 1.8, 0.6)
	if "aabb_size" in e:
		var v: Variant = e.get("aabb_size")
		if v is Vector3:
			s = v
	var p: Vector3 = (e as Node3D).global_position
	return AABB(p - Vector3(s.x * 0.5, 0.0, s.z * 0.5), s)

func _entity_aabb(e: Node) -> AABB:
	return entity_aabb(e)

func _same_team(e: Node) -> bool:
	if caster == null or e == null:
		return false
	if "faction" in caster and "faction" in e:
		var a := String(caster.get("faction"))
		var b := String(e.get("faction"))
		if a == b and a != "":
			return true
		if (a == "player" and b == "z_fighter") or (a == "z_fighter" and b == "player"):
			return true
	return false

# --- impact ---------------------------------------------------------------

func _impact(pos: Vector3, direct_victim: Node = null) -> void:
	if _dead:
		return
	_dead = true
	ExplosionFx.hint_color(color)
	# the ki-specific part of the impact (white flash, coloured sparks, ring, scorch);
	# the explosion itself still comes from Events.explosion -> ExplosionFx
	if mode != "disc":
		KiEffects.blast_impact(pos, color, maxf(0.8, blast_radius * 0.8), get_parent())
	var terrain := destroy_terrain and damage >= TERRAIN_DAMAGE_MIN
	if direct_victim != null:
		_hit_entities[direct_victim.get_instance_id()] = true
		Damage.deal(direct_victim, caster, 1.0, damage_kind, damage, direction)
	if world != null and world.has_method("explode") and terrain:
		# World.explode destroys blocks, damages everyone in range and emits Events.explosion
		world.call("explode", pos, blast_radius, damage, caster)
	else:
		_damage_area(pos)
		Events.explosion.emit(pos, blast_radius, damage)
	Audio.play_sfx_at("ki_explosion_impact", pos)
	_die()

func _damage_area(pos: Vector3) -> void:
	var box := AABB(pos - Vector3.ONE * blast_radius, Vector3.ONE * blast_radius * 2.0)
	for e in _entities_near(box):
		if e == caster or not is_instance_valid(e) or not (e is Node3D):
			continue
		if _hit_entities.has(e.get_instance_id()):
			continue
		if _same_team(e):
			continue
		var d: float = (e as Node3D).global_position.distance_to(pos)
		if d > blast_radius:
			continue
		var falloff := clampf(1.0 - d / maxf(0.1, blast_radius), 0.15, 1.0)
		_hit_entities[e.get_instance_id()] = true
		Damage.deal(e, caster, falloff, Damage.EXPLOSION, damage, (e as Node3D).global_position - pos)

func _expire() -> void:
	if _dead:
		return
	_dead = true
	if mode == "disc":
		_die()
		return
	ExplosionFx.hint_color(color)
	Events.explosion.emit(global_position, blast_radius * 0.6, damage * 0.5)
	_die()

func _die() -> void:
	if _trail != null:
		_trail.emitting = false
	if _sphere != null:
		_sphere.visible = false
	if _disc != null:
		_disc.visible = false
	if _light != null:
		_light.visible = false
	FxAssets.free_after(self, 0.45)

# --- disc cutting ---------------------------------------------------------

## Slice every block softer than DISC_HARDNESS in a small cube around the contact.
func _cut_blocks(block: Vector3i) -> void:
	if world == null or not world.has_method("get_block") or not world.has_method("set_block"):
		return
	var cut := 0
	for dx in range(-DISC_CUT_RADIUS, DISC_CUT_RADIUS + 1):
		for dy in range(-DISC_CUT_RADIUS, DISC_CUT_RADIUS + 1):
			for dz in range(-DISC_CUT_RADIUS, DISC_CUT_RADIUS + 1):
				var p := block + Vector3i(dx, dy, dz)
				var id := int(world.call("get_block", p.x, p.y, p.z))
				if id <= 0:
					continue
				var b: Dictionary = Registry.block(id)
				var hardness := float(b.get("hardness", 1.0))
				if hardness < 0.0 or hardness >= DISC_HARDNESS:
					continue
				world.call("set_block", p.x, p.y, p.z, 0, 0, true)
				cut += 1
	if cut > 0:
		KiEffects.disc_sparks(global_position, color, get_parent())
		Audio.play_sfx_at("break_stone", global_position, -2.0)
