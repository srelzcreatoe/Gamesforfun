class_name CharacterPreview
extends SubViewportContainer
## Rotating 3D character preview used by the inventory and the character creation screen.
## Uses BedrockModel + RaceSkin when the entity engineer's scripts exist, else a blocky stand-in.

const BEDROCK_MODEL := "res://scripts/entity/BedrockModel.gd"
const RACE_SKIN := "res://scripts/entity/RaceSkin.gd"

var viewport: SubViewport
var pivot: Node3D
var model: Node3D = null
var spin := 0.5
var character: Dictionary = {}
var auto_spin := true

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
	cam.position = Vector3(0, 1.0, 3.1)
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

func set_character(ch: Dictionary) -> void:
	character = ch.duplicate(true)
	rebuild()

func rebuild() -> void:
	if model != null and is_instance_valid(model):
		model.queue_free()
	model = _make_model()
	pivot.add_child(model)

func _make_model() -> Node3D:
	if ResourceLoader.exists(BEDROCK_MODEL):
		var script: GDScript = load(BEDROCK_MODEL)
		if script != null:
			var inst: Variant = script.new()
			if inst is Node3D:
				var m: Node3D = inst
				var geo := "entity/races/" + String(character.get("race", "human"))
				var ok := false
				for fn in ["build", "load_model", "set_geometry", "load_geometry"]:
					if m.has_method(fn):
						m.call(fn, geo)
						ok = true
						break
				if ok:
					if ResourceLoader.exists(RACE_SKIN):
						var rs: GDScript = load(RACE_SKIN)
						if rs != null and rs.has_method("compose") and m.has_method("set_texture"):
							var img: Variant = rs.call("compose", character)
							if img is Image:
								m.call("set_texture", img)
					return m
				m.queue_free()
	return _box_figure()

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
