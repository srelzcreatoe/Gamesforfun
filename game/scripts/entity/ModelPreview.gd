extends Node3D
## Visual harness for the Bedrock model/animation pipeline (scenes/entities/ModelPreview.tscn).
##
## tools/screenshot.sh out.png --scene res://scenes/entities/ModelPreview.tscn \
##     --args "--model=entity/sagas/saga_vegeta --texture=sagas/saga_vegeta \
##             --anim=entity/sagas/saga_base --clip=idle --t=0.4"
##
## Args (all optional):
##   --model=<path under assets/models, no extension>
##   --texture=<path under assets/textures/entity, no extension>
##   --race=<race id>       compose a RaceSkin texture instead of a flat texture
##   --gender=male|female --body=0..1 --hair=<int> --hair_color=#rrggbb
##   --anim=<one or more animation paths, comma separated>
##   --clip=<clip name>     --t=<seconds> (static pose) --speed=<f>
##   --scale=<f>            --yaw=<deg>   --view=front|back|side|quarter
##   --grid                 draw a 1 m reference grid
##   --label=<text>

const VIEWS := {
	"front": Vector3(0, 0, -1),
	"back": Vector3(0, 0, 1),
	"side": Vector3(-1, 0, 0),
	"quarter": Vector3(-0.8, 0, -1),
}

var model: BedrockModel
var anim: BedrockAnimation
var _label: Label
var _args: Dictionary = {}
var _pose_t := -1.0
var _clip := ""

func _ready() -> void:
	_parse_args()
	if _args.has("signs"):
		var parts := String(_args["signs"]).split(",")
		if parts.size() == 3:
			BedrockModel.euler_signs = Vector3(float(parts[0]), float(parts[1]), float(parts[2]))
	_build_environment()
	var model_path := String(_args.get("model", "entity/races/human"))
	model = BedrockModel.new()
	model.name = "Model"
	add_child(model)
	if not model.load_geo(model_path):
		_set_label("FAILED to load " + model_path)
		return
	model.set_model_scale(float(_args.get("scale", 1.0)))
	model.rotation.y = deg_to_rad(float(_args.get("yaw", 0.0)))
	_apply_texture()
	_apply_animation()
	_frame_camera()
	var txt := model_path.get_file()
	if _clip != "":
		txt += "  clip=" + _clip
		if _pose_t >= 0.0:
			txt += " t=%.2f" % _pose_t
	txt += "  bones=%d  signs=%s" % [model.bone_count(), str(BedrockModel.euler_signs)]
	_set_label(String(_args.get("label", txt)))

func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--"):
			var kv := a.substr(2).split("=", true, 1)
			_args[kv[0]] = kv[1] if kv.size() > 1 else "1"

func _build_environment() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.11, 0.13, 0.18)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.75, 0.78, 0.85)
	e.ambient_light_energy = 0.75
	env.environment = e
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, 145, 0)
	sun.light_energy = 1.1
	sun.shadow_enabled = false
	add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-15, -40, 0)
	fill.light_energy = 0.45
	fill.shadow_enabled = false
	add_child(fill)
	if _args.has("grid"):
		add_child(_make_grid())
	_label = Label.new()
	_label.position = Vector2(16, 12)
	_label.add_theme_color_override("font_color", Color(1, 1, 1))
	_label.add_theme_font_size_override("font_size", 22)
	add_child(_label)

func _set_label(t: String) -> void:
	if _label != null:
		_label.text = t

func _make_grid() -> MeshInstance3D:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_LINES)
	for i in range(-4, 5):
		st.set_color(Color(0.4, 0.45, 0.5))
		st.add_vertex(Vector3(i, 0, -4))
		st.add_vertex(Vector3(i, 0, 4))
		st.add_vertex(Vector3(-4, 0, i))
		st.add_vertex(Vector3(4, 0, i))
	# -Z axis marker (model forward) in red, +X (entity right) in green
	st.set_color(Color(1, 0.2, 0.2))
	st.add_vertex(Vector3(0, 0.01, 0))
	st.add_vertex(Vector3(0, 0.01, -3))
	st.set_color(Color(0.2, 1, 0.2))
	st.add_vertex(Vector3(0, 0.01, 0))
	st.add_vertex(Vector3(3, 0.01, 0))
	var mesh := ArrayMesh.new()
	st.commit(mesh)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	mi.material_override = m
	return mi

func _apply_texture() -> void:
	if _args.has("race"):
		var character := {
			"race": String(_args.get("race", "saiyan")),
			"gender": String(_args.get("gender", "male")),
			"body_type": int(_args.get("body", 0)),
			"hair_type": int(_args.get("hair", 1)),
			"hair_color": String(_args.get("hair_color", "#2b2b2b")),
			"eye_color": String(_args.get("eye_color", "#3a5fcd")),
			"skin_color": String(_args.get("skin", "#ffd3c9")),
			"eye_type": int(_args.get("eye", 0)),
			"nose": int(_args.get("nose", 0)),
			"mouth": int(_args.get("mouth", 0)),
			"tattoo": int(_args.get("tattoo", -1)),
		}
		RaceSkin.apply_to(model, character)
		if _args.has("hair_style"):
			HairBuilder.attach(model, String(_args["hair_style"]),
					RaceSkin._color(_args.get("hair_color", "#2b2b2b")))
		return
	var tex_path := String(_args.get("texture", ""))
	if tex_path == "":
		return
	model.set_texture(Textures.entity_texture(tex_path))

func _apply_animation() -> void:
	anim = BedrockAnimation.new()
	anim.name = "Anim"
	add_child(anim)
	anim.setup(model, self)
	var list := String(_args.get("anim", "")).split(",", false)
	for p in list:
		var a := p.strip_edges()
		if a.begins_with("spa"):
			anim.load_clips(a, BedrockAnimation.REMAP_SPA)
		else:
			anim.load_clips(a)
	_clip = String(_args.get("clip", ""))
	if _clip == "" or anim.clips.is_empty():
		return
	if _args.has("t"):
		_pose_t = float(_args["t"])
		anim.sample_to(_clip, _pose_t)
		anim.paused = true
	else:
		anim.play(_clip, 0.0, null, float(_args.get("speed", 1.0)))

func _frame_camera() -> void:
	var cam := Camera3D.new()
	cam.fov = 45.0
	add_child(cam)
	var box := model.visual_aabb()
	var h: float = maxf(0.4, box.size.y)
	var w: float = maxf(0.4, maxf(box.size.x, box.size.z))
	var target := box.position + box.size * 0.5
	target.x = 0.0
	target.z = 0.0
	# fit the height into the 45 deg vertical fov with a small margin
	var dist: float = maxf(h, w * 0.7) * 0.5 / tan(deg_to_rad(cam.fov * 0.5)) * 1.25
	var dir: Vector3 = VIEWS.get(String(_args.get("view", "front")), Vector3(0, 0, -1)).normalized()
	cam.position = target + dir * dist + Vector3(0, h * 0.10, 0)
	cam.look_at(target, Vector3.UP)
	cam.make_current()

func _process(delta: float) -> void:
	if anim != null and not anim.paused:
		anim.update(delta)
