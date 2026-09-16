class_name ExplosionFx
extends Node3D
## One explosion: white flash sprite, fire + smoke billboards, an expanding
## `shaders/shockwave.gdshader` ring, debris cubes and the sound pair
## `ki_explosion_impact` + `explosion_big`.
##
## Driven by `Events.explosion(center, radius, power)` so that everything that blows
## something up (World.explode, ki blasts, Final Explosion) produces the same visual
## without every caller knowing about fx. `ExplosionFx.hint_color(c)` tints the next
## explosion that arrives within 0.25 s (ki attacks use their technique colour).
##
##   Events.explosion.emit(pos, 4.0, 30.0)      # crater + fx (World.explode does this)
##   ExplosionFx.play(pos, 4.0, Color(...))     # fx only, no terrain damage

const SHOCKWAVE_SHADER := "res://shaders/shockwave.gdshader"
const FLASH_TEX := "aaa/explosion_mini/Flash01"
const FIRE_TEX := "aaa/explosion/fire_tex"
const SMOKE_TEX := "aaa/explosion/smoke_tex"
const DEBRIS_TEX := "rock_particle_0"

const LIFETIME := 1.6
const FIRE_COUNT := 26
const SMOKE_COUNT := 16
const SPARK_COUNT := 20
const DEBRIS_COUNT := 10

static var _hint_color := Color(1.0, 0.75, 0.35)
static var _hint_until := 0

var radius := 4.0
var color := Color(1.0, 0.75, 0.35)
var age := 0.0

var _ring: MeshInstance3D
var _ring_mat: ShaderMaterial
var _flash: MeshInstance3D
var _light: OmniLight3D

## Tint the next Events.explosion (ki attacks pass their technique colour).
static func hint_color(c: Color) -> void:
	_hint_color = c
	_hint_until = Time.get_ticks_msec() + 250

static func _take_hint() -> Color:
	if Time.get_ticks_msec() <= _hint_until:
		return _hint_color
	return Color(1.0, 0.75, 0.35)

## Spawn the visual explosion. Does NOT damage anything (World.explode does that).
static func play(center: Vector3, r := 4.0, c := Color(0, 0, 0, 0), power := 0.0) -> ExplosionFx:
	var parent := _parent()
	if parent == null:
		return null
	var e := ExplosionFx.new()
	e.name = "ExplosionFx"
	e.radius = maxf(0.6, r)
	e.color = c if c.a > 0.0 else _take_hint()
	parent.add_child(e)
	e.global_position = center
	return e

## Events.explosion handler (connected once by ScreenFx so fx work everywhere).
static func on_event(center: Vector3, r: float, power: float) -> void:
	play(center, r, Color(0, 0, 0, 0), power)

static func _parent() -> Node:
	if Game != null and Game.world != null and Game.world.is_inside_tree():
		return Game.world
	var loop := Engine.get_main_loop()
	if loop is SceneTree:
		return (loop as SceneTree).current_scene
	return null

func _ready() -> void:
	var scale_f := clampf(radius / 4.0, 0.35, 3.0)
	_flash = FxAssets.make_quad("Flash", FxAssets.particle(FLASH_TEX, "ki_flash", "ki_exp0"),
		radius * 2.2, Color(1, 1, 1, 1))
	add_child(_flash)

	_ring = MeshInstance3D.new()
	_ring.name = "Shockwave"
	var q := QuadMesh.new()
	q.size = Vector2(radius * 5.0, radius * 5.0)
	q.orientation = PlaneMesh.FACE_Y
	_ring.mesh = q
	_ring_mat = FxAssets.shader_material(SHOCKWAVE_SHADER, {
		"ring_color": Color(color.r, color.g, color.b, 0.95), "progress": 0.0,
		"thickness": 0.07, "intensity": 1.5,
	})
	_ring.material_override = _ring_mat
	_ring.position = Vector3(0, 0.08, 0)
	_ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_ring)

	var fire := FxAssets.make_particles("Fire", int(FIRE_COUNT * scale_f), [FIRE_TEX, "ki_exp2", "explode0"], color)
	fire.one_shot = true
	fire.explosiveness = 0.9
	fire.lifetime = 0.7
	fire.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	fire.emission_sphere_radius = radius * 0.4
	fire.spread = 180.0
	fire.initial_velocity_min = radius * 1.2
	fire.initial_velocity_max = radius * 3.0
	fire.gravity = Vector3(0, -2.0, 0)
	fire.scale_amount_min = radius * 0.25
	fire.scale_amount_max = radius * 0.7
	add_child(fire)
	fire.emitting = true

	var smoke := FxAssets.make_particles("Smoke", int(SMOKE_COUNT * scale_f), [SMOKE_TEX, "aaa/essentials/SMOKE001", "explode4"], Color(0.35, 0.33, 0.3))
	smoke.one_shot = true
	smoke.explosiveness = 0.7
	smoke.lifetime = 1.4
	smoke.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	smoke.emission_sphere_radius = radius * 0.5
	smoke.spread = 180.0
	smoke.initial_velocity_min = radius * 0.4
	smoke.initial_velocity_max = radius * 1.4
	smoke.gravity = Vector3(0, 1.0, 0)
	smoke.scale_amount_min = radius * 0.5
	smoke.scale_amount_max = radius * 1.3
	smoke.material_override.blend_mode = BaseMaterial3D.BLEND_MODE_MIX
	add_child(smoke)
	smoke.emitting = true

	var sparks := FxAssets.make_particles("Sparks", int(SPARK_COUNT * scale_f), ["ki_spark_1", "spark2", "ki_line"], color.lightened(0.4))
	sparks.one_shot = true
	sparks.explosiveness = 1.0
	sparks.lifetime = 0.55
	sparks.spread = 180.0
	sparks.initial_velocity_min = radius * 2.0
	sparks.initial_velocity_max = radius * 5.0
	sparks.gravity = Vector3(0, -12.0, 0)
	sparks.scale_amount_min = 0.15
	sparks.scale_amount_max = 0.4
	add_child(sparks)
	sparks.emitting = true

	var debris := FxAssets.make_particles("Debris", int(DEBRIS_COUNT * scale_f), [DEBRIS_TEX, "rock_particle_5", "block_0"], Color(0.7, 0.66, 0.6))
	debris.one_shot = true
	debris.explosiveness = 1.0
	debris.lifetime = 1.5
	debris.mesh = FxAssets.cube_mesh(0.3)
	debris.material_override = FxAssets.debris_material(Color(0.6, 0.55, 0.5))
	debris.spread = 70.0
	debris.direction = Vector3.UP
	debris.initial_velocity_min = radius * 1.5
	debris.initial_velocity_max = radius * 3.5
	debris.gravity = Vector3(0, -20.0, 0)
	debris.angular_velocity_min = -360.0
	debris.angular_velocity_max = 360.0
	debris.scale_amount_min = 0.5
	debris.scale_amount_max = 1.3
	add_child(debris)
	debris.emitting = true

	# a single light is allowed on mobile (limits/opengl/max_renderable_lights = 8)
	_light = OmniLight3D.new()
	_light.light_color = color
	_light.light_energy = 6.0
	_light.omni_range = radius * 4.0
	_light.shadow_enabled = false
	add_child(_light)

	Audio.play_sfx_at("ki_explosion_impact", global_position)
	Audio.play_sfx_at("explosion_big", global_position, -2.0, clampf(4.0 / radius, 0.7, 1.4))
	ScreenFx.shake(clampf(radius / 5.0, 0.2, 1.4), 0.3 + clampf(radius / 20.0, 0.0, 0.4))
	ScreenFx.flash(color.lightened(0.5), 0.2, clampf(radius / 12.0, 0.1, 0.6))

func _process(delta: float) -> void:
	age += delta
	var t := clampf(age / LIFETIME, 0.0, 1.0)
	if _ring_mat != null:
		_ring_mat.set_shader_parameter("progress", t)
	if _flash != null:
		var m: StandardMaterial3D = _flash.material_override
		var f := clampf(1.0 - age / 0.28, 0.0, 1.0)
		m.albedo_color = Color(1, 1, 1, f)
		_flash.scale = Vector3.ONE * (0.4 + t * 1.6)
		_flash.visible = f > 0.01
	if _light != null:
		_light.light_energy = maxf(0.0, 6.0 * (1.0 - age / 0.4))
		if _light.light_energy <= 0.01:
			_light.visible = false
	if age > LIFETIME + 0.6:
		queue_free()
