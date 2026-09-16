class_name KiBeam
extends Node3D
## Continuous ki beam (script of `scenes/entities/KiBeam.tscn`).
##
## A cylinder with `shaders/ki_beam.gdshader` starts at the caster's hand, grows along
## the aim direction until it hits terrain or reaches `max_length`, then stays alive
## while the player keeps holding (up to the technique `duration`). It ticks damage on
## everything inside its capsule, pushes victims along the beam, blows a crater at the
## far end when it stops and shakes the camera the whole time.
##
##   KiBeam.fire(world, caster, {"color": Color("#4FC3FF"), "size": 1.2,
##       "damage": 90.0, "duration": 3.0, "max_length": 64.0, "technique": "kamehameha",
##       "fire_sound": "ki_kame_fire"})
##   beam.held = false        # the player let go -> the beam retracts and craters

const BEAM_SHADER := "res://shaders/ki_beam.gdshader"
const GROW_SPEED := 90.0          # m/s the beam front travels
const TICK_INTERVAL := 0.2        # damage tick
const PUSH_PER_TICK := 3.5
const DEFAULT_MAX_LENGTH := 64.0
const CRATER_MIN_DAMAGE := 25.0
const SHAKE_PER_SECOND := 0.22

var world: Node = null
var caster: Node = null
var technique_id := ""
var color := Color(0.31, 0.76, 1.0)
var radius := 0.6
var damage := 40.0
var duration := 3.0
var max_length := DEFAULT_MAX_LENGTH
var held := true
var crater_radius := 3.5
var destroy_terrain := true

var length := 0.0
var age := 0.0

var _mesh: MeshInstance3D
var _mat: ShaderMaterial
var _cyl: CylinderMesh
var _muzzle: KiEffects
var _impact_particles: CPUParticles3D
var _tick := 0.0
var _origin := Vector3.ZERO
var _dir := Vector3.FORWARD
var _end := Vector3.ZERO
var _finished := false
var _loop_key := ""

# --- spawning -------------------------------------------------------------

static func fire(world_node: Node, caster_node: Node, cfg: Dictionary) -> KiBeam:
	var b: KiBeam = null
	const PATH := "res://scenes/entities/KiBeam.tscn"
	if ResourceLoader.exists(PATH):
		var inst := (load(PATH) as PackedScene).instantiate()
		if inst is KiBeam:
			b = inst
		else:
			inst.queue_free()
	if b == null:
		b = KiBeam.new()
	b.name = "KiBeam"
	b.world = world_node
	b.caster = caster_node
	b.technique_id = String(cfg.get("technique", ""))
	b.color = cfg.get("color", b.color)
	b.radius = maxf(0.1, float(cfg.get("size", 1.0)) * 0.5)
	b.damage = float(cfg.get("damage", 40.0))
	b.duration = float(cfg.get("duration", 3.0))
	b.max_length = float(cfg.get("max_length", DEFAULT_MAX_LENGTH))
	b.crater_radius = float(cfg.get("crater_radius", maxf(2.0, b.radius * 4.0)))
	b.destroy_terrain = bool(cfg.get("destroy_terrain", true))
	var parent: Node = world_node if world_node != null and world_node.is_inside_tree() else _fallback_parent()
	if parent == null:
		b.free()
		return null
	parent.add_child(b)
	var fs := String(cfg.get("fire_sound", "ki_beam_fire"))
	if fs != "":
		Audio.play_sfx_at(fs, b.global_position)
	return b

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
	_loop_key = "beam_" + str(get_instance_id())
	_build()
	_update_transform(0.0)

func _exit_tree() -> void:
	Audio.stop_loop(_loop_key, 0.2)

func _build() -> void:
	_cyl = CylinderMesh.new()
	_cyl.top_radius = radius
	_cyl.bottom_radius = radius
	_cyl.height = 1.0
	_cyl.radial_segments = 16
	_cyl.rings = 1
	_mesh = MeshInstance3D.new()
	_mesh.name = "Beam"
	_mesh.mesh = _cyl
	_mat = FxAssets.shader_material(BEAM_SHADER, {
		"beam_color": color, "core_color": color.lightened(0.85), "intensity": 1.5,
		"fade_in": 0.0, "core_width": 0.45,
	})
	_mesh.material_override = _mat
	_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_mesh)

	# the charging ball that stays in the hands while the beam is sustained
	_muzzle = KiEffects.charge(self, color, radius * 3.0)
	if _muzzle != null:
		_muzzle.set_progress(1.0)

	_impact_particles = FxAssets.make_particles("Impact", 24, ["aaa/lightning/Particle_Soft", "ki_flash1", "spark1"], color)
	_impact_particles.lifetime = 0.4
	_impact_particles.spread = 120.0
	_impact_particles.initial_velocity_min = 3.0
	_impact_particles.initial_velocity_max = 9.0
	_impact_particles.gravity = Vector3.ZERO
	_impact_particles.scale_amount_min = radius * 0.8
	_impact_particles.scale_amount_max = radius * 2.4
	_impact_particles.emitting = false
	add_child(_impact_particles)
	Audio.play_loop("laserbeam", _loop_key, -6.0)

# --- per frame ------------------------------------------------------------

func _process(delta: float) -> void:
	if _finished:
		return
	if Game != null and Game.paused_by_ui:
		return
	age += delta
	if age >= duration or not held or caster == null or not is_instance_valid(caster):
		_finish()
		return
	_update_transform(delta)
	_tick += delta
	if _tick >= TICK_INTERVAL:
		_tick -= TICK_INTERVAL
		_damage_tick()
	ScreenFx.shake(SHAKE_PER_SECOND * delta * 60.0 * 0.05, 0.1)

func _update_transform(delta: float) -> void:
	_origin = KiEffects.hand_position(caster) if caster != null else global_position
	_dir = KiEffects.aim_direction(caster) if caster != null else _dir
	var want := max_length
	if world != null and world.has_method("raycast"):
		var hit: Dictionary = world.call("raycast", _origin, _dir, max_length, true)
		if bool(hit.get("hit", false)):
			want = float(hit.get("dist", max_length))
	length = minf(want, length + GROW_SPEED * delta) if delta > 0.0 else minf(want, 1.0)
	length = maxf(0.5, minf(length, want))
	_end = _origin + _dir * length
	# the cylinder mesh is Y-up and centred, so place it half way and align Y to _dir
	global_position = _origin + _dir * (length * 0.5)
	var up := Vector3.UP
	if absf(_dir.dot(up)) > 0.98:
		up = Vector3.FORWARD
	look_at_from_position(global_position, global_position + _dir, up)
	rotate_object_local(Vector3.RIGHT, PI * 0.5)     # -Z forward -> +Y along the beam
	_cyl.height = length
	if _mat != null:
		_mat.set_shader_parameter("fade_in", clampf(length / maxf(1.0, want), 0.0, 1.0))
		_mat.set_shader_parameter("intensity", 1.2 + 0.5 * sin(age * 18.0))
	if _muzzle != null and is_instance_valid(_muzzle):
		_muzzle.global_position = _origin
	if _impact_particles != null:
		_impact_particles.global_position = _end
		_impact_particles.emitting = length >= want - 0.6

## Damage everything inside the beam capsule and push it along the beam.
func _damage_tick() -> void:
	var box := AABB(_origin, Vector3.ZERO).expand(_end).grow(radius + 0.6)
	var list: Array = []
	if world != null and world.has_method("entities_in_aabb"):
		list = world.call("entities_in_aabb", box)
	elif world != null and world.has_method("get_entities"):
		list = world.call("get_entities")
	var per_tick := damage * TICK_INTERVAL / maxf(0.2, duration) * 3.0
	for e in list:
		if e == caster or not is_instance_valid(e) or not (e is Node3D):
			continue
		if _same_team(e):
			continue
		var p: Vector3 = (e as Node3D).global_position + Vector3.UP * 0.9
		var d := _distance_to_segment(p, _origin, _end)
		if d > radius + 0.7:
			continue
		Damage.deal(e, caster, 1.0, Damage.KI, per_tick, _dir)
		if "velocity" in e:
			var v: Variant = e.get("velocity")
			if v is Vector3:
				e.set("velocity", (v as Vector3) + _dir * PUSH_PER_TICK)

static func _distance_to_segment(p: Vector3, a: Vector3, b: Vector3) -> float:
	var ab := b - a
	var l2 := ab.length_squared()
	if l2 < 0.0001:
		return p.distance_to(a)
	var t := clampf((p - a).dot(ab) / l2, 0.0, 1.0)
	return p.distance_to(a + ab * t)

func _same_team(e: Node) -> bool:
	if caster == null or e == null:
		return false
	if "faction" in caster and "faction" in e:
		var x := String(caster.get("faction"))
		var y := String(e.get("faction"))
		if x == y and x != "":
			return true
		if (x == "player" and y == "z_fighter") or (x == "z_fighter" and y == "player"):
			return true
	return false

# --- end ------------------------------------------------------------------

func _finish() -> void:
	if _finished:
		return
	_finished = true
	Audio.stop_loop(_loop_key, 0.15)
	KiEffects.beam_impact(_end, color, radius * 2.0, get_parent())
	ExplosionFx.hint_color(color)
	if destroy_terrain and damage >= CRATER_MIN_DAMAGE and world != null and world.has_method("explode"):
		world.call("explode", _end, crater_radius, damage, caster)
	else:
		Events.explosion.emit(_end, crater_radius * 0.7, damage * 0.5)
	ScreenFx.shake(0.8, 0.4)
	if _muzzle != null and is_instance_valid(_muzzle):
		_muzzle.fade_out(0.2)
	if _impact_particles != null:
		_impact_particles.emitting = false
	# retract the beam then disappear
	var tw := create_tween()
	tw.tween_method(func(v: float) -> void:
		if _mat != null:
			_mat.set_shader_parameter("fade_in", v), 1.0, 0.0, 0.25)
	tw.tween_callback(queue_free)

## Stop holding the beam (the player let go of the button).
func release() -> void:
	held = false
