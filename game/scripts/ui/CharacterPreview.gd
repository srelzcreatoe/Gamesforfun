class_name CharacterPreview
extends SubViewportContainer
## Rotating 3D character preview used by the inventory and the character creation screen.
## Uses BedrockModel + RaceSkin when the entity engineer's scripts exist, else a blocky stand-in.

const BEDROCK_MODEL := "res://scripts/entity/BedrockModel.gd"
const RACE_SKIN := "res://scripts/entity/RaceSkin.gd"
const RACE_MODELS := {
	"human": "entity/races/human", "saiyan": "entity/races/human",
	"namekian": "entity/races/namekian", "frostdemon": "entity/races/frostdemon",
	"majin": "entity/races/majin", "bioandroid": "entity/races/bioandroid",
}

var viewport: SubViewport
var pivot: Node3D
var camera: Camera3D = null
var model: Node3D = null
var spin := 0.5
var character: Dictionary = {}
var armor: Array = []
var auto_spin: bool = _no_screenshot_arg()

func _init(size_px := Vector2(120, 180)) -> void:
	stretch = true
	custom_minimum_size = size_px
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	viewport = SubViewport.new()
	viewport.transparent_bg = true
	viewport.size = Vector2i(maxi(16, int(size_px.x)), maxi(16, int(size_px.y)))
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	viewport.own_world_3d = true
	viewport.world_3d = World3D.new()
	add_child(viewport)
	pivot = Node3D.new()
	viewport.add_child(pivot)
	var cam := Camera3D.new()
	cam.position = Vector3(0, 1.0, -3.1)  # models face -Z
	cam.fov = 38.0
	cam.near = 0.05
	viewport.add_child(cam)
	var l := DirectionalLight3D.new()
	l.rotation_degrees = Vector3(-35, 35, 0)
	l.light_energy = 1.3
	viewport.add_child(l)
	var l2 := DirectionalLight3D.new()
	l2.rotation_degrees = Vector3(-20, -140, 0)
	l2.light_energy = 0.55
	viewport.add_child(l2)
	camera = cam

func set_character(ch: Dictionary, worn: Array = []) -> void:
	character = ch.duplicate(true)
	armor = worn
	rebuild()

func rebuild() -> void:
	if model != null and is_instance_valid(model):
		pivot.remove_child(model)
		model.queue_free()
	model = _make_model()
	pivot.add_child(model)
	call_deferred("frame_camera")

## Fit the whole figure in view whatever model was built.
func frame_camera() -> void:
	if camera == null or model == null or not is_instance_valid(model):
		return
	var box := _model_aabb(model)
	if box.size.y <= 0.01:
		box = AABB(Vector3(-0.4, 0.0, -0.4), Vector3(0.8, 1.9, 0.8))
	var center := box.position + box.size * 0.5
	var height := maxf(box.size.y, box.size.x * 1.4)
	var vfov := deg_to_rad(camera.fov)
	var dist := (height * 0.5) / maxf(0.05, tan(vfov * 0.5)) * 1.18
	camera.position = Vector3(0.0, center.y, -dist)  # models face -Z
	camera.look_at_from_position(camera.position, Vector3(0.0, center.y, 0.0), Vector3.UP)

static func _model_aabb(root: Node) -> AABB:
	var out := AABB()
	var first := true
	for c in root.get_children():
		if c is MeshInstance3D:
			var mi: MeshInstance3D = c
			if mi.mesh == null or not mi.visible:
				continue
			var b: AABB = mi.get_aabb()
			b = mi.transform * b
			out = b if first else out.merge(b)
			first = false
		if c is Node3D:
			var sub := _model_aabb(c)
			if sub.size.length() > 0.0001:
				sub = (c as Node3D).transform * sub
				out = sub if first else out.merge(sub)
				first = false
	return out

func _make_model() -> Node3D:
	if not ResourceLoader.exists(BEDROCK_MODEL) or not ResourceLoader.exists(RACE_SKIN):
		return _box_figure()
	var race := String(character.get("race", "human"))
	# RaceSkin owns the geometry choice (race + gender + body type).
	var geo := String(RaceSkin.race_model(race, String(character.get("gender", "male")),
		int(character.get("body_type", 0))))
	var m := BedrockModel.new()
	if not m.load_geo(geo):
		m.queue_free()
		return _box_figure()
	m.set_model_scale(1.0)
	var ch := character.duplicate(true)
	if race == "saiyan":
		ch["has_tail"] = bool(ch.get("has_tail", false))
	RaceSkin.apply_to(m, ch, armor)
	var root := Node3D.new()
	root.add_child(m)
	return root

func _box_figure() -> Node3D:
	var root := Node3D.new()
	var skin := UiUtil.color_hex(String(character.get("skin_color", "#FFD3C9")), Color(1.0, 0.83, 0.79))
	var hair := UiUtil.color_hex(String(character.get("hair_color", "#222629")), Color(0.13, 0.15, 0.16))
	var eye := UiUtil.color_hex(String(character.get("eye_color", "#222629")), Color(0.1, 0.1, 0.12))
	var gi := UiUtil.color_hex(String(character.get("aura_color", "#E8721B")), Color(0.85, 0.45, 0.1))
	var parts := [
		[Vector3(0.52, 0.52, 0.52), Vector3(0, 1.56, 0), skin],
		[Vector3(0.56, 0.18, 0.56), Vector3(0, 1.80, 0), hair],
		[Vector3(0.12, 0.08, 0.06), Vector3(-0.12, 1.60, 0.27), eye],
		[Vector3(0.12, 0.08, 0.06), Vector3(0.12, 1.60, 0.27), eye],
		[Vector3(0.52, 0.62, 0.30), Vector3(0, 0.99, 0), gi],
		[Vector3(0.18, 0.62, 0.18), Vector3(-0.35, 0.99, 0), skin],
		[Vector3(0.18, 0.62, 0.18), Vector3(0.35, 0.99, 0), skin],
		[Vector3(0.22, 0.68, 0.22), Vector3(-0.13, 0.34, 0), Color(0.22, 0.30, 0.6)],
		[Vector3(0.22, 0.68, 0.22), Vector3(0.13, 0.34, 0), Color(0.22, 0.30, 0.6)],
	]
	for p in parts:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = p[0]
		mi.mesh = bm
		mi.position = p[1]
		var mat := StandardMaterial3D.new()
		mat.albedo_color = p[2]
		mat.roughness = 1.0
		mi.material_override = mat
		root.add_child(mi)
	return root

func _process(delta: float) -> void:
	if auto_spin and pivot != null:
		pivot.rotate_y(delta * spin)


static func _no_screenshot_arg() -> bool:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--screenshot"):
			return false
	return true
