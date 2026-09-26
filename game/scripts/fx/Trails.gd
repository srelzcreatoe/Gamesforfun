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

## A REUSABLE afterimage: the silhouette is built once (the expensive part - duplicating
## a DMZ character model measured 13 ms of the 13.2 ms worst fx frame in
## `FxPreview --profile`) and then re-shown with `flash_ghost` as often as the caller
## likes. The transformation cinematic throws one every 0.3 s for seconds on end and only
## ever has one alive, so it builds one of these at the start of the strain and re-flashes
## it instead of duplicating the model a dozen times.
##
## The node is returned UNPARENTED and hidden; the caller owns it (the cinematic parents
## it to itself, so it is freed with the director and nothing is left in the world).
static func make_ghost(entity_node: Node, c: Color) -> Node3D:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var model: Variant = entity_node.get("model") if "model" in entity_node else null
	if not (model is Node3D) or not (model as Node3D).is_inside_tree():
		return null
	var dup: Node = (model as Node3D).duplicate(DUPLICATE_USE_INSTANTIATION)
	if not (dup is Node3D):
		if dup != null:
			dup.free()
		return null
	var ghost := dup as Node3D
	ghost.name = "Afterimage"
	var mats := _tint_recursive(ghost, c)
	ghost.set_meta("fx_ghost_mats", mats)
	ghost.set_meta("fx_ghost_model_scale", (model as Node3D).scale)
	ghost.visible = false
	return ghost

## Show a `make_ghost` silhouette at `pos` and fade it out over `life` seconds. Restarts
## cleanly when it is still fading from the previous flash.
static func flash_ghost(ghost: Node3D, pos: Vector3, rot: Vector3, entity_scale: Vector3,
		life := AFTERIMAGE_LIFE) -> void:
	if ghost == null or not is_instance_valid(ghost) or not ghost.is_inside_tree():
		return
	if ghost.has_meta("fx_ghost_tween"):
		var old: Variant = ghost.get_meta("fx_ghost_tween")
		if old is Tween and (old as Tween).is_valid():
			(old as Tween).kill()
	var model_scale := Vector3.ONE
	if ghost.has_meta("fx_ghost_model_scale"):
		model_scale = ghost.get_meta("fx_ghost_model_scale")
	ghost.visible = true
	ghost.global_position = pos
	ghost.global_rotation = rot
	ghost.scale = model_scale * entity_scale
	var mats: Array = ghost.get_meta("fx_ghost_mats") if ghost.has_meta("fx_ghost_mats") else []
	var tw := ghost.create_tween().set_parallel(true)
	for m in mats:
		if m is StandardMaterial3D:
			(m as StandardMaterial3D).albedo_color.a = 0.38
			tw.tween_property(m, "albedo_color:a", 0.0, life)
	tw.tween_property(ghost, "scale", ghost.scale * 0.85, life)
	tw.chain().tween_callback(func() -> void:
		if is_instance_valid(ghost):
			ghost.visible = false)
	ghost.set_meta("fx_ghost_tween", tw)

## One fading additive copy of an entity's model at `pos`. Used by the dash afterimages
## and by the transformation cinematic's strain phase. Falls back to a capsule when the
## entity has no model yet, and does nothing when it is not in the tree.
static func spawn_ghost(entity_node: Node, pos: Vector3, c: Color, life := AFTERIMAGE_LIFE) -> Node3D:
	if entity_node == null or not is_instance_valid(entity_node) or not entity_node.is_inside_tree():
		return null
	var host: Node = entity_node.get_parent()
	if host == null or not host.is_inside_tree():
		return null
	_ghost_mats = [] as Array[StandardMaterial3D]    # consumed by _fade below
	var ghost: Node3D = null
	var from_model := false
	var model_scale := Vector3.ONE
	var model: Variant = entity_node.get("model") if "model" in entity_node else null
	if model is Node3D and (model as Node3D).is_inside_tree():
		var dup: Node = (model as Node3D).duplicate(DUPLICATE_USE_INSTANTIATION)
		if dup is Node3D:
			ghost = dup as Node3D
			from_model = true
			# a BedrockModel carries its own (1/16 model unit) scale: overwriting it with
			# the entity scale below would blow the silhouette up 16x
			model_scale = (model as Node3D).scale
			_ghost_mats = _tint_recursive(ghost, c)
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
		ghost.scale = model_scale * (entity_node as Node3D).scale if from_model \
			else (entity_node as Node3D).scale
	var tw := ghost.create_tween()
	tw.tween_property(ghost, "scale", ghost.scale * 0.85, life)
	tw.tween_callback(ghost.queue_free)
	_fade(ghost, life)
	return ghost

## Turn a duplicated model into an additive silhouette in `c`. The original texture is
## kept when there is one, so an afterimage reads as a glowing copy of the character
## instead of a solid coloured box.
##
## ONE MATERIAL PER TEXTURE, SHARED between the surfaces that use it (a DMZ character is
## ~20 MeshInstance3D over 2 textures: body + hair). The cinematic throws an afterimage
## every 0.3 s during the strain, and building a material and a tween per surface put a
## measurable spike in the frame (`FxPreview --profile` showed the strain max at ~9 ms of
## fx script time); 2 materials and 2 tweens instead of ~20 of each removes most of it
## and looks identical. Returns the materials so the fade can drive them directly.
static func _tint_recursive(node: Node, c: Color, out: Array[StandardMaterial3D] = [],
		by_tex: Dictionary = {}) -> Array[StandardMaterial3D]:
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		var tex: Texture2D = null
		var old: Variant = mi.material_override
		if old is BaseMaterial3D:
			tex = (old as BaseMaterial3D).albedo_texture
		var key: String = tex.resource_path if tex != null else "<none>"
		var m: StandardMaterial3D = by_tex.get(key, null)
		if m == null:
			m = FxAssets.additive_material(tex, false)
			m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
			m.albedo_color = Color(c.r, c.g, c.b, 0.38)
			by_tex[key] = m
			out.append(m)
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for ch in node.get_children():
		_tint_recursive(ch, c, out, by_tex)
	return out

## Fade the silhouette out: one tween per shared material (see `_tint_recursive`), or a
## walk when the ghost is the capsule fallback.
static func _fade(ghost: Node3D, seconds: float) -> void:
	if not _ghost_mats.is_empty():
		for m in _ghost_mats:
			var tw := ghost.create_tween()
			tw.tween_property(m, "albedo_color:a", 0.0, seconds)
		_ghost_mats = [] as Array[StandardMaterial3D]
		return
	_fade_recursive(ghost, seconds)

static var _ghost_mats: Array[StandardMaterial3D] = []

static func _fade_recursive(node: Node, seconds: float) -> void:
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		var m: Variant = mi.material_override
		if m is StandardMaterial3D:
			var tw := mi.create_tween()
			tw.tween_property(m, "albedo_color:a", 0.0, seconds)
	for ch in node.get_children():
		_fade_recursive(ch, seconds)
