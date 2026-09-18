class_name FxAssets
extends RefCounted
## Shared helpers for every fx script: particle textures with fallbacks, pre-configured
## CPUParticles3D, additive billboard materials and the mobile particle budget.
##
## Particle budget (docs/ARCHITECTURE.md §2 performance): the ONE authority for the
## transformation cinematic is `TransformationDirector.MAX_PARTICLES` (700 CPU particles
## alive at the climax, counted on screen by `TransformationDirector.particle_budget()`);
## every other one-shot effect is capped here at `MAX_ONESHOT_PARTICLES`. `budget(n)`
## scales a requested amount by the user's `particles` quality setting.

const PARTICLE_DIR := "res://assets/textures/particles/"
const MAX_ONESHOT_PARTICLES := 120

## The longest real-time step any fx clock may take in one frame. The cinematic's own
## clock, the preview stages and ScreenFx all divide by `Engine.time_scale` to run in
## real time, and a hit-stop drops that to 0.001 - so a single frame rendered while the
## scale is changing (or a streaming hitch under llvmpipe) would otherwise integrate a
## 70 s jump and skip whole phases. See `real_delta`.
const MAX_REAL_DELTA := 0.1

## Particle sprites whose RGB is (almost) black: they are alpha masks meant to be
## colourised by the game, so they are INVISIBLE in an additive material and render
## as black blobs in a mix material. Never pass these to make_particles/burst; the
## bright DMZ/AAA equivalents listed next to them read correctly.
##   dust_particle_0..3, rock_particle_0..11, explode0,
##   aaa/essentials/SHINE_001, aaa/essentials/SMOKE001/003/004,
##   aaa/explosion/fire_tex, aaa/explosion_mini/Flash01, hit, Particle1,
##   ef_common_flashlight01_t, tex_eff_light02, aaa/atmosphere/Full_Black
## bright smoke: aaa/explosion/smoke_tex, aaa/explosion/howaa128 (both measured 100 %
##   white in their transparent pixels, which is what `smoke()` hands out)
## bright fire: ki_exp0..6, explode1..5
const DARK_MASK_TEXTURES: Array[String] = [
	"dust_particle_0", "dust_particle_1", "dust_particle_2", "dust_particle_3",
	"explode0", "aaa/essentials/SHINE_001", "aaa/essentials/SMOKE001",
	"aaa/essentials/SMOKE003", "aaa/essentials/SMOKE004", "aaa/explosion/fire_tex",
	"aaa/explosion_mini/Flash01", "aaa/explosion_mini/hit",
]

## Textures whose TRANSPARENT pixels are black. Measured on the source PNGs:
## `aaa/lightning/Smoke` and `aaa/missile_boost/Smoke` are 59 % alpha-0 with RGB (0,0,0),
## `block_0/1/2` are 41-72 % alpha-0 with RGB (0,0,0). Godot filters straight (non
## premultiplied) alpha, so the black bleeds into the soft edge of a MIX-blended puff.
## They are fine in an additive material (black adds nothing) but must never appear in
## a MIX list - not even as a fallback, which is why `smoke()` lists none of them.
const BLACK_FRINGE_TEXTURES: Array[String] = [
	"aaa/lightning/Smoke", "aaa/lightning/Fire", "aaa/missile_boost/Smoke",
	"block_0", "block_1", "block_2",
]

## Texture name list for MIX-blended smoke / dust puffs, safest first. Every entry is
## verified white-fringed; if none of them resolve, `particle()` falls back to the
## procedural white `soft_dot()`, which is safe in a MIX material as well.
static func smoke() -> Array[String]:
	return ["aaa/explosion/smoke_tex", "aaa/explosion/howaa128"] as Array[String]

## Switch a dust/smoke emitter to MIX blending. It ALSO forces `local_coords = true`,
## and that is not cosmetic:
##
## a CPUParticles3D with `local_coords = false` keeps its particles in world space by
## re-deriving the emission transform from its own global transform every frame. When
## the node that owns it has its global transform RE-ASSIGNED every frame - which is
## exactly what the transformation cinematic does, `global_position = entity.global_position`
## on a `top_level` director - some instance slots reach the renderer zeroed. Because the
## material is `BILLBOARD_PARTICLES`, the vertex stage throws the instance basis away and
## rebuilds it from the view matrix, so a zeroed slot still covers pixels, and it covers
## them with instance colour (0,0,0): a PURE BLACK quad. In an additive material black
## adds nothing and the bug is invisible, which is why only the MIX-blended emitters ever
## showed it. `local_coords = true` keeps the particles in the emitter's own space, so
## there is no per-frame emission transform to corrupt.
##
## Reproduced and bisected with `tools/screenshot.sh ... --args "--scene=res://scenes/fx/FxPreview.tscn --fx=dustdiag"`:
## the only column that goes black is the one parented to a moving `top_level` node with
## `local_coords = false`; the material, blend mode, particle scale, emitter warm-up,
## emission radius, texture, fog and glow were each ruled out first.
static func mix_dust(p: CPUParticles3D) -> void:
	if p == null:
		return
	var m: StandardMaterial3D = p.material_override as StandardMaterial3D
	if m != null:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_MIX
	p.local_coords = true

## `delta` converted to real seconds (undoing slow motion / hit stop) and clamped to
## `MAX_REAL_DELTA`, so every fx clock advances the same way and a frame rendered while
## `Engine.time_scale` is changing cannot jump the timeline.
static func real_delta(delta: float) -> float:
	return minf(delta / maxf(0.001, Engine.time_scale), MAX_REAL_DELTA)

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
		# BILLBOARD_PARTICLES reads INSTANCE_CUSTOM and is only valid on a particle
		# material; single quads (make_quad) use the plain billboard instead.
		m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
		m.billboard_keep_scale = true
	return m

## Opaque-ish lit material for debris cubes (nearest filtered like the voxel world).
static func debris_material(color: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	# SHADED, unlike every other fx material here. Debris is solid geometry, not light:
	# an unshaded dark rock is a flat black slab in a sunlit voxel world (that is exactly
	# how the levitating rocks read in the in-world transformation shot), while a lit one
	# picks up the sun and the aura light and reads as torn-up ground. No texture and no
	# specular, so it is still one cheap opaque draw per chunk of debris.
	m.albedo_color = color
	m.roughness = 1.0
	m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	# a floor for scenes with no light at all (the fx preview studio), so debris never
	# goes fully black there either
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = 0.25
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
	var m := additive_material(tex, false)
	if not face_y:
		m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
		m.billboard_keep_scale = true
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
