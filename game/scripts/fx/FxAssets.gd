class_name FxAssets
extends RefCounted
## Shared helpers for every fx script: particle textures with fallbacks, pre-configured
## CPUParticles3D, additive billboard materials and the mobile particle budget.
##
## Particle budget (docs/ARCHITECTURE.md §2 performance): the transformation cinematic
## is capped at 300 CPU particles, every other one-shot effect at 120. `budget(n)`
## scales a requested amount by the user's `particles` quality setting.

const PARTICLE_DIR := "res://assets/textures/particles/"
const MAX_TRANSFORM_PARTICLES := 300
const MAX_ONESHOT_PARTICLES := 120

static var _tex_cache: Dictionary = {}
static var _mat_cache: Dictionary = {}

## First existing particle texture among `names` (relative to assets/textures/particles,
## no extension), else a generated 8x8 soft dot so nothing renders magenta.
static func particle(name: String, alt1 := "", alt2 := "") -> Texture2D:
	var candidates: Array[String] = [name, alt1, alt2]
	for n in candidates:
		if n == "":
			continue
		if _tex_cache.has(n):
			return _tex_cache[n]
		var path := PARTICLE_DIR + n + ".png"
		if ResourceLoader.exists(path):
			var t: Texture2D = load(path)
			_tex_cache[n] = t
			return t
	return soft_dot()

static func entity_particle(rel_path: String) -> Texture2D:
	var key := "entity:" + rel_path
	if _tex_cache.has(key):
		return _tex_cache[key]
	var path := "res://assets/textures/entity/" + rel_path + ".png"
	var t: Texture2D = load(path) if ResourceLoader.exists(path) else soft_dot()
	_tex_cache[key] = t
	return t

## Procedural radial gradient dot, used whenever a sprite is missing.
static func soft_dot() -> Texture2D:
	if _tex_cache.has("__dot"):
		return _tex_cache["__dot"]
	var img := Image.create(16, 16, false, Image.FORMAT_RGBA8)
	for y in 16:
		for x in 16:
			var d := Vector2(float(x) - 7.5, float(y) - 7.5).length() / 8.0
			var a := clampf(1.0 - d, 0.0, 1.0)
			img.set_pixel(x, y, Color(1, 1, 1, a * a))
	var t := ImageTexture.create_from_image(img)
	_tex_cache["__dot"] = t
	return t

## Particle count after the user's quality setting, clamped to the one-shot budget.
static func budget(amount: int, cap := MAX_ONESHOT_PARTICLES) -> int:
	var q := 1.0
	if Game != null:
		q = clampf(float(Game.settings.get("particles", 1.0)), 0.25, 1.0)
	return clampi(int(round(float(amount) * q)), 1, cap)

## Additive, unshaded, billboarded particle material.
static func additive_material(tex: Texture2D, billboard := true) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.albedo_texture = tex
	m.vertex_color_use_as_albedo = true
	m.disable_receive_shadows = true
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	if billboard:
		m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
		m.billboard_keep_scale = true
	return m

## Opaque-ish lit material for debris cubes (nearest filtered like the voxel world).
static func debris_material(color: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = color
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	return m

## A CPUParticles3D with sane mobile defaults and an additive billboard material.
static func make_particles(node_name: String, amount: int, textures: Array, color: Color,
		cap := MAX_ONESHOT_PARTICLES) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.name = node_name
	p.amount = budget(amount, cap)
	p.local_coords = false
	p.draw_order = CPUParticles3D.DRAW_ORDER_VIEW_DEPTH
	p.lifetime = 0.8
	p.explosiveness = 0.0
	p.color = color
	p.mesh = QuadMesh.new()
	(p.mesh as QuadMesh).size = Vector2.ONE
	var names: Array[String] = []
	for t in textures:
		names.append(String(t))
	while names.size() < 3:
		names.append("")
	p.material_override = additive_material(particle(names[0], names[1], names[2]))
	var ramp := Gradient.new()
	ramp.set_color(0, Color(1, 1, 1, 1))
	ramp.set_color(1, Color(1, 1, 1, 0))
	p.color_ramp = ramp
	return p

## One-shot burst: emits `amount` particles once then frees itself.
static func burst(parent: Node, pos: Vector3, node_name: String, amount: int, textures: Array,
		color: Color, speed := 6.0, life := 0.7, size := 0.5, gravity := -6.0) -> CPUParticles3D:
	if parent == null or not parent.is_inside_tree():
		return null
	var p := make_particles(node_name, amount, textures, color)
	p.one_shot = true
	p.explosiveness = 0.95
	p.lifetime = life
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	p.emission_sphere_radius = 0.2
	p.direction = Vector3.UP
	p.spread = 180.0
	p.initial_velocity_min = speed * 0.4
	p.initial_velocity_max = speed
	p.gravity = Vector3(0, gravity, 0)
	p.scale_amount_min = size * 0.5
	p.scale_amount_max = size
	parent.add_child(p)
	if p is Node3D:
		p.global_position = pos
	p.emitting = true
	free_after(p, life + 0.4)
	return p

## Free a node after `seconds` (works for every Node, no tween needed).
static func free_after(node: Node, seconds: float) -> void:
	if node == null or not node.is_inside_tree():
		return
	var t := Timer.new()
	t.one_shot = true
	t.wait_time = maxf(0.05, seconds)
	node.add_child(t)
	t.timeout.connect(func() -> void:
		if is_instance_valid(node):
			node.queue_free())
	t.start()

## Additive quad (billboard or ground-facing) used for flashes and rings.
static func make_quad(node_name: String, tex: Texture2D, size: float, color: Color,
		face_y := false) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = node_name
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	if face_y:
		q.orientation = PlaneMesh.FACE_Y
	mi.mesh = q
	var m := additive_material(tex, not face_y)
	m.albedo_color = color
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi

## Unit cube mesh reused by debris and afterimages.
static func cube_mesh(size := 0.25) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = Vector3.ONE * size
	return b

## Shader material for one of our fx shaders with the given parameters.
static func shader_material(path: String, params: Dictionary) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	if ResourceLoader.exists(path):
		m.shader = load(path)
	for k in params.keys():
		m.set_shader_parameter(String(k), params[k])
	return m

## The active Camera3D (viewport camera, or the player camera rig).
static func camera(from: Node) -> Camera3D:
	if from != null and from.is_inside_tree():
		var vp := from.get_viewport()
		if vp != null and vp.get_camera_3d() != null:
			return vp.get_camera_3d()
	return null
