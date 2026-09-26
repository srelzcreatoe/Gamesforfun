extends Node3D
## Visual harness for the Bedrock model/animation/hair pipeline
## (scenes/entities/ModelPreview.tscn).
##
## tools/screenshot.sh out.png --scene res://scenes/entities/ModelPreview.tscn \
##     --args "--model=entity/sagas/saga_vegeta --texture=sagas/saga_vegeta \
##             --anim=entity/sagas/saga_base --clip=idle --t=0.4"
##
## The scene takes its OWN screenshot: `tools/screenshot.sh` appends
## `--screenshot=<abs path> --after=<seconds>` and only `scenes/main/Main.gd`
## used to honour them, so every preview run used to hang until the 300 s
## timeout killed it and no PNG was ever written. `_process` now saves and quits
## exactly like Main.gd does.
##
## SINGLE MODEL args (all optional):
##   --model=<path under assets/models, no extension>
##   --texture=<path under assets/textures/entity, no extension>
##   --nohd                 force the 64x64 original instead of the DMZ-HD art
##   --race=<race id>       compose a RaceSkin texture instead of a flat texture
##   --gender=male|female --body=0..1 --hair=<int> --hair_color=#rrggbb
##   --anim=<one or more animation paths, comma separated>
##   --clip=<clip name>     --t=<seconds> (static pose) --speed=<f>
##   --upper=<clip>         second clip on the upper-body layer --upper_t=<s>
##   --scale=<f>            --yaw=<deg>   --view=front|back|side|quarter
##   --grid                 draw a 1 m reference grid
##   --label=<text>
##
## CONTACT SHEET args (render many things in one image; each cell frames itself):
##   --sheet=all|<entity id,...>   every entity in data/entities.json, or a list
##   --page=<n> --per=<n>          page through `all` (default 12 per sheet)
##   --kind=enemy|master|animal|npc|dragon|pickup|vehicle   filter `all`
##   --cols=<n>                    grid columns (default fits `per`)
##   --sheet_clip=<clip>           pose every cell with this state/clip
##   --sheet_t=<seconds>
##   --strip=<t0,t1,t2,...>        one model, one cell per animation time
##   --hair_sheet=<form id,...>|all  form hair; --presets=1,7,25 picks haircuts
##
## Every cell is an own-world SubViewport, so 12 characters cost 12 tiny 3D
## worlds and one composite frame - cheap enough that all 216 entity types can
## be swept in 18 screenshots on llvmpipe.

const VIEWS := {
	"front": Vector3(0, 0, -1),
	"back": Vector3(0, 0, 1),
	"side": Vector3(-1, 0, 0),
	"quarter": Vector3(-0.8, 0, -1),
}
const BG := Color(0.11, 0.13, 0.18)

var model: BedrockModel
var anim: BedrockAnimation
var _label: Label
var _args: Dictionary = {}
var _pose_t := -1.0
var _clip := ""
var _shot_path := ""
var _shot_timer := -1.0
var _cells: Array[Dictionary] = []          # {anim, t} for animated sheets

func _ready() -> void:
	_parse_args()
	_shot_path = String(_args.get("screenshot", ""))
	if _shot_path != "":
		_shot_timer = float(_args.get("after", 2.0))
	if _args.has("signs"):
		var parts := String(_args["signs"]).split(",")
		if parts.size() == 3:
			BedrockModel.euler_signs = Vector3(float(parts[0]), float(parts[1]), float(parts[2]))
	if _args.has("sheet") or _args.has("strip") or _args.has("hair_sheet"):
		_build_sheet()
		return
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
	add_child(_make_env())
	for l in _make_lights():
		add_child(l)
	if _args.has("grid"):
		add_child(_make_grid())
	_label = Label.new()
	_label.position = Vector2(16, 12)
	_label.add_theme_color_override("font_color", Color(1, 1, 1))
	_label.add_theme_font_size_override("font_size", 22)
	add_child(_label)

static func _make_env() -> WorldEnvironment:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = BG
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.75, 0.78, 0.85)
	e.ambient_light_energy = 0.75
	env.environment = e
	return env

static func _make_lights() -> Array[DirectionalLight3D]:
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, 145, 0)
	sun.light_energy = 1.1
	sun.shadow_enabled = false
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-15, -40, 0)
	fill.light_energy = 0.45
	fill.shadow_enabled = false
	var out: Array[DirectionalLight3D] = [sun, fill]
	return out

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

func _character_args() -> Dictionary:
	return {
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

func _apply_texture() -> void:
	if _args.has("race"):
		RaceSkin.apply_to(model, _character_args())
		if _args.has("hair_style"):
			HairBuilder.attach(model, String(_args["hair_style"]),
					RaceSkin._color(_args.get("hair_color", "#2b2b2b")))
		return
	var tex_path := String(_args.get("texture", ""))
	if tex_path == "":
		return
	model.set_texture(BedrockModel.entity_texture(tex_path, not _args.has("nohd")))

func _apply_animation() -> void:
	anim = BedrockAnimation.new()
	anim.name = "Anim"
	add_child(anim)
	anim.setup(model, self)
	_load_anim_list(anim, String(_args.get("anim", "")))
	_clip = String(_args.get("clip", ""))
	if _clip == "" or anim.clips.is_empty():
		return
	if _args.has("t"):
		_pose_t = float(_args["t"])
		anim.sample_to(_clip, _pose_t)
		var up := String(_args.get("upper", ""))
		if up != "":
			anim.sample_upper_to(up, float(_args.get("upper_t", _pose_t)))
		anim.paused = true
	else:
		anim.play(_clip, 0.0, null, float(_args.get("speed", 1.0)))
		var up2 := String(_args.get("upper", ""))
		if up2 != "":
			anim.play_upper(up2, 0.0)

static func _load_anim_list(a: BedrockAnimation, list_str: String) -> void:
	for p in list_str.split(",", false):
		var path := p.strip_edges()
		if path == "":
			continue
		if path.begins_with("spa"):
			a.load_clips(path, BedrockAnimation.REMAP_SPA)
		else:
			a.load_clips(path)

func _frame_camera() -> void:
	var cam := Camera3D.new()
	cam.fov = 45.0
	add_child(cam)
	_aim_camera(cam, model, String(_args.get("view", "front")))
	cam.make_current()

## Fit `m` into `cam`'s vertical fov from the named direction.
static func _aim_camera(cam: Camera3D, m: BedrockModel, view: String) -> void:
	var box := m.visual_aabb()
	var h: float = maxf(0.4, box.size.y)
	var w: float = maxf(0.4, maxf(box.size.x, box.size.z))
	var target := box.position + box.size * 0.5
	target.x = 0.0
	target.z = 0.0
	var dist: float = maxf(h, w * 0.7) * 0.5 / tan(deg_to_rad(cam.fov * 0.5)) * 1.25
	var dir: Vector3 = (VIEWS.get(view, Vector3(0, 0, -1)) as Vector3).normalized()
	var pos: Vector3 = target + dir * dist + Vector3(0, h * 0.10, 0)
	# Node3D.look_at() needs the node inside the tree; a contact-sheet cell is
	# aimed while it is still being assembled, so build the basis by hand.
	cam.transform = Transform3D(Basis.looking_at(target - pos, Vector3.UP), pos)

# --- contact sheets ------------------------------------------------------------

func _build_sheet() -> void:
	var entries: Array[Dictionary] = []
	if _args.has("strip"):
		entries = _strip_entries()
	elif _args.has("hair_sheet"):
		entries = _hair_entries()
	else:
		entries = _entity_entries()
	var per := int(_args.get("per", 12))
	var page := int(_args.get("page", 0))
	if not _args.has("strip") and not _args.has("hair_sheet"):
		var from := page * per
		entries = entries.slice(from, mini(from + per, entries.size()))
	var n: int = maxi(1, entries.size())
	var cols := int(_args.get("cols", 0))
	if cols <= 0:
		cols = int(ceil(sqrt(float(n) * 1.5)))
		cols = clampi(cols, 1, 6)
	var rows := int(ceil(float(n) / float(cols)))
	var vp_size := get_viewport().get_visible_rect().size
	var cw := int(vp_size.x) / cols
	var ch := int(vp_size.y) / rows
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(root)
	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(bg)
	for i in entries.size():
		var cell := _make_cell(entries[i], Vector2i(cw, ch))
		cell.position = Vector2((i % cols) * cw, (i / cols) * ch)
		root.add_child(cell)
	var title := Label.new()
	title.position = Vector2(8, vp_size.y - 22)
	title.add_theme_color_override("font_color", Color(1, 1, 0.6))
	title.add_theme_font_size_override("font_size", 16)
	title.text = String(_args.get("label", "%d cells  page %d" % [entries.size(), page]))
	root.add_child(title)

func _make_cell(entry: Dictionary, size: Vector2i) -> Control:
	var holder := Control.new()
	holder.custom_minimum_size = size
	holder.size = size
	var vpc := SubViewportContainer.new()
	vpc.stretch = true
	vpc.size = size
	holder.add_child(vpc)
	var vp := SubViewport.new()
	vp.size = size
	vp.own_world_3d = true
	vp.transparent_bg = false
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	vpc.add_child(vp)
	var note := String(entry.get("note", ""))
	vp.add_child(_make_env())
	for l in _make_lights():
		vp.add_child(l)
	var m := BedrockModel.new()
	vp.add_child(m)
	var ok := m.load_geo(String(entry.get("model", "")))
	if not ok:
		note = "NO GEO"
	else:
		m.set_model_scale(float(entry.get("scale", 1.0)))
		m.rotation.y = deg_to_rad(float(entry.get("yaw", _args.get("yaw", 0.0))))
		var character: Variant = entry.get("character", null)
		if character is Dictionary:
			RaceSkin.apply_to(m, character)
			var hair_style := String(entry.get("hair_style", ""))
			var form: Variant = entry.get("form", null)
			if hair_style != "":
				HairBuilder.attach(m, hair_style, RaceSkin._color((character as Dictionary).get("hair_color", "#2b2b2b")))
			if form is Dictionary:
				RaceSkin.set_form_hair(m, form)
			var hair_node: Node = m.get_bone("head").get_node_or_null("Hair") if m.get_bone("head") != null else null
			var tris := 0
			if hair_node is MeshInstance3D and (hair_node as MeshInstance3D).visible:
				var mesh: Mesh = (hair_node as MeshInstance3D).mesh
				if mesh != null:
					for s in mesh.get_surface_count():
						tris += (mesh.surface_get_arrays(s)[Mesh.ARRAY_INDEX] as PackedInt32Array).size() / 3
			note += "  tris=%d" % tris
			if tris == 0:
				note += " NO HAIR"
		else:
			var t := String(entry.get("texture", ""))
			if t != "":
				m.set_texture(BedrockModel.entity_texture(t, bool(entry.get("hd", true))))
		var a := BedrockAnimation.new()
		vp.add_child(a)
		a.setup(m, self)
		_load_anim_list(a, String(entry.get("anim", "")))
		var clip := String(entry.get("clip", ""))
		if clip != "" and not a.clips.is_empty():
			var resolved := AnimSelect.choose(clip, a)
			if resolved == "":
				resolved = clip
			if a.has_clip(resolved):
				a.sample_to(resolved, float(entry.get("t", 0.0)))
				var up := String(entry.get("upper", ""))
				if up != "":
					var ru := AnimSelect.choose(up, a)
					a.sample_upper_to(ru if ru != "" else up, float(entry.get("upper_t", 0.0)))
				note += "  " + resolved
			else:
				note += "  NO CLIP " + clip
		var cam := Camera3D.new()
		cam.fov = 45.0
		vp.add_child(cam)
		_aim_camera(cam, m, String(entry.get("view", _args.get("view", "front"))))
		cam.make_current()
	var lab := Label.new()
	lab.position = Vector2(4, 2)
	lab.add_theme_color_override("font_color", Color(1, 1, 1))
	lab.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	lab.add_theme_constant_override("outline_size", 4)
	lab.add_theme_font_size_override("font_size", 14)
	lab.text = String(entry.get("name", "")) + ("\n" + note if note != "" else "")
	holder.add_child(lab)
	return holder

## One cell per entity type in data/entities.json (model + texture + its clips).
func _entity_entries() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var want := String(_args.get("sheet", "all"))
	var kind_filter := String(_args.get("kind", ""))
	var ids: Array = []
	if want == "all" or want == "1":
		ids = Registry.entities.keys()
		ids.sort()
	else:
		for s in want.split(",", false):
			ids.append(s.strip_edges())
	for id in ids:
		var d: Dictionary = Registry.entity(String(id))
		if d.is_empty() or String(d.get("model", "")) == "":
			continue
		if kind_filter != "" and String(d.get("kind", "")) != kind_filter:
			continue
		out.append({
			"name": String(id),
			"model": String(d.get("model", "")),
			"texture": String(d.get("texture", "")),
			"hd": bool(d.get("hd_texture", true)),
			"scale": float(d.get("scale", 1.0)),
			"anim": ",".join(PackedStringArray(d.get("animations", []))),
			"clip": String(_args.get("sheet_clip", "idle")),
			"t": float(_args.get("sheet_t", 0.0)),
		})
	return out

## One cell per animation time of a single model (walk-cycle evidence).
func _strip_entries() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var base := {
		"model": String(_args.get("model", "entity/races/human")),
		"texture": String(_args.get("texture", "")),
		"hd": not _args.has("nohd"),
		"scale": float(_args.get("scale", 1.0)),
		"anim": String(_args.get("anim", "")),
		"clip": String(_args.get("clip", "walk")),
		"view": String(_args.get("view", "side")),
		"upper": String(_args.get("upper", "")),
	}
	var times := String(_args["strip"]).split(",", false)
	for i in times.size():
		var t := float(times[i].strip_edges())
		var e: Dictionary = base.duplicate()
		e["t"] = t
		e["upper_t"] = float(_args.get("upper_t", t))
		e["name"] = "t=%.2f" % t
		out.append(e)
	return out

## One cell per (form, haircut preset): form hair geometry evidence.
func _hair_entries() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var want := String(_args.get("hair_sheet", "all"))
	var ids: Array = []
	if want == "all" or want == "1":
		ids = Registry.forms.keys()
		ids.sort()
	else:
		for s in want.split(",", false):
			ids.append(s.strip_edges())
	var presets: Array = []
	for p in String(_args.get("presets", "1")).split(",", false):
		presets.append(p.strip_edges())
	for id in ids:
		var f: Dictionary = Registry.form(String(id))
		if f.is_empty():
			continue
		for p in presets:
			var ch := _character_args()
			ch["race"] = "saiyan"
			ch["hair_type"] = HairBuilder.style_index(String(p))
			out.append({
				"name": String(id).get_slice(".", 1) + " p" + String(p),
				"model": "entity/races/human",
				"character": ch,
				"form": f,
				"scale": 1.0,
				"view": String(_args.get("view", "quarter")),
				"note": String(f.get("hairType", "")),
			})
	return out

# --- frame --------------------------------------------------------------------

func _process(delta: float) -> void:
	if anim != null and not anim.paused:
		anim.update(delta)
	if _shot_timer >= 0.0:
		_shot_timer -= delta
		if _shot_timer < 0.0:
			_take_screenshot()
			get_tree().quit()

func _take_screenshot() -> void:
	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(_shot_path)
	print("SCREENSHOT %s -> %s (%s)" % [_shot_path, "ok" if err == OK else str(err),
			RenderingServer.get_video_adapter_name()])
