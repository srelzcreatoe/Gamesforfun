class_name SkyPreview
extends Node3D
## Standalone scene (scenes/world/SkyPreview.tscn) used to look at and benchmark the sky, clouds,
## water, weather and post-process without the voxel world.
##
## Command line (user args, after "--"):
##   --planet=earth        planet id (uses data/planets.json when present, else SkyController's built-ins)
##   --time=6000           world ticks (0 sunrise, 6000 noon, 12000 sunset, 18000 midnight)
##   --weather=rain        clear | overcast | rain | snow | thunder | auto
##   --daycycle[=speed]    animate the time of day
##   --yaw=180             camera yaw in degrees (180 = looking west, toward the sunset)
##   --underwater          put the camera below the water surface
##   --quality=high        low | balanced | high (overrides Game.settings.quality_preset)
##   --bench               print the average frame time over 3 s (full scene, then sky only)
##   --screenshot=<path> --after=<seconds>   save a PNG and quit (used by tools/screenshot.sh)

const WATER_SHADER := "res://shaders/water.gdshader"
const SEA_LEVEL := 0.0
const WATER_EXTENT := Vector2(300.0, 300.0)
const WATER_STEP := 3.0
const TERRAIN_EXTENT := Vector2(300.0, 300.0)
const TERRAIN_STEP := 5.0

var sky: SkyController
var camera: Camera3D
var sun: DirectionalLight3D
var env: WorldEnvironment
var water_mesh: MeshInstance3D
var water_material: ShaderMaterial
var terrain: MeshInstance3D
var props: Node3D

var planet_id := "earth"
var time_ticks := 6000.0
var weather := "clear"
var day_speed := 0.0
var args: Dictionary = {}

var _shot_path := ""
var _shot_timer := -1.0
var _bench := false
var _bench_phase := 0
var _bench_t := 0.0
var _bench_frames := 0
var _bench_accum := 0.0
var _hud: Label

func _ready() -> void:
	_parse_args()
	if not Registry.loaded:
		Registry.load_all()
	if args.has("quality"):
		Game.settings["quality_preset"] = String(args["quality"])
	_setup_nodes()
	_build_terrain()
	_build_water()
	_build_props()
	_setup_hud()
	if args.has("screenshot"):
		_shot_path = String(args["screenshot"])
		_shot_timer = float(args.get("after", 5.0))
	_bench = args.has("bench")
	# one immediate apply so the first frame is already correct
	_apply(0.016)

func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--"):
			var kv := a.substr(2).split("=", true, 1)
			args[kv[0]] = kv[1] if kv.size() > 1 else true
	planet_id = String(args.get("planet", "earth"))
	time_ticks = float(args.get("time", 6000.0))
	weather = String(args.get("weather", "clear"))
	if args.has("daycycle"):
		day_speed = float(args["daycycle"]) if args["daycycle"] is String else 200.0

func _setup_nodes() -> void:
	env = get_node_or_null("WorldEnvironment") as WorldEnvironment
	if env == null:
		env = WorldEnvironment.new()
		env.name = "WorldEnvironment"
		add_child(env)
	sun = get_node_or_null("Sun") as DirectionalLight3D
	if sun == null:
		sun = DirectionalLight3D.new()
		sun.name = "Sun"
		add_child(sun)
	sun.light_bake_mode = Light3D.BAKE_DISABLED
	camera = get_node_or_null("Camera3D") as Camera3D
	if camera == null:
		camera = Camera3D.new()
		camera.name = "Camera3D"
		add_child(camera)
	camera.fov = 75.0
	camera.near = 0.05
	camera.far = 4000.0
	# yaw 90 = looking west (-X, toward the sunset), 270 = east (+X, toward the sunrise)
	var yaw := deg_to_rad(float(args.get("yaw", 90.0)))
	var height := 4.6
	var pitch := -0.12
	if args.has("underwater"):
		height = -1.2
		pitch = 0.08
	camera.position = Vector3(float(args.get("cam_x", 26.0)), height, float(args.get("cam_z", 0.0)))
	camera.rotation = Vector3(pitch, yaw, 0.0)
	sky = get_node_or_null("SkyController") as SkyController
	if sky == null:
		sky = SkyController.new()
		sky.name = "SkyController"
		add_child(sky)
	sky.bind(env, sun)

## Sloping beach: deep water to the west (-X), dry land to the east (+X).
static func terrain_height(x: float, z: float) -> float:
	var base := -13.0 + smoothstep(-55.0, 34.0, x) * 17.0
	var dunes := sin(z * 0.06) * 1.1 + sin(x * 0.08 + z * 0.03) * 0.9
	# hills only on the dry (+X) side, otherwise the far west would rise out of the sea again
	var land := smoothstep(0.0, 40.0, x)
	var hill := smoothstep(30.0, 90.0, x) * 16.0 + smoothstep(60.0, 120.0, absf(z)) * 8.0 * land
	var h := base + dunes * (0.3 + 0.7 * smoothstep(-20.0, 20.0, x)) + hill
	# sink the rim of the mesh far below the sea so its edges never show above the horizon
	var r := Vector2(x, z).length()
	return h - smoothstep(150.0, 285.0, r) * 40.0

func _build_terrain() -> void:
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()
	var nx := int(TERRAIN_EXTENT.x * 2.0 / TERRAIN_STEP)
	var nz := int(TERRAIN_EXTENT.y * 2.0 / TERRAIN_STEP)
	for iz in nz + 1:
		for ix in nx + 1:
			var x := -TERRAIN_EXTENT.x + float(ix) * TERRAIN_STEP
			var z := -TERRAIN_EXTENT.y + float(iz) * TERRAIN_STEP
			verts.append(Vector3(x, terrain_height(x, z), z))
			var e := 1.0
			var hl := terrain_height(x - e, z)
			var hr := terrain_height(x + e, z)
			var hd := terrain_height(x, z - e)
			var hu := terrain_height(x, z + e)
			normals.append(Vector3(hl - hr, 2.0 * e, hd - hu).normalized())
			uvs.append(Vector2(x, z) * 0.25)
	for iz in nz:
		for ix in nx:
			var a := iz * (nx + 1) + ix
			var b := a + 1
			var c := a + nx + 1
			var d := c + 1
			indices.append_array(PackedInt32Array([a, b, c, b, d, c]))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	terrain = MeshInstance3D.new()
	terrain.name = "Terrain"
	terrain.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = _checker_texture()
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST_WITH_MIPMAPS
	mat.uv1_scale = Vector3(1, 1, 1)
	mat.roughness = 1.0
	mat.metallic = 0.0
	mat.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	terrain.material_override = mat
	add_child(terrain)

func _checker_texture() -> ImageTexture:
	var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
	for y in 32:
		for x in 32:
			var light := ((x / 8) + (y / 8)) % 2 == 0
			var c := Color(0.52, 0.56, 0.46) if light else Color(0.38, 0.44, 0.33)
			c = c.lerp(Color(0.74, 0.68, 0.5), 0.25 * float((x * 7 + y * 13) % 5) / 4.0)
			img.set_pixel(x, y, c)
	return ImageTexture.create_from_image(img)

func _build_water() -> void:
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	var uv2s := PackedVector2Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()
	var layer := float(Textures.layer("water_still")) if Textures != null else 0.0
	var packed_light := 15.0 * 16.0 + 0.0           # full sky light, no block light
	var uv2_y := packed_light / 255.0
	var nx := int(WATER_EXTENT.x * 2.0 / WATER_STEP)
	var nz := int(WATER_EXTENT.y * 2.0 / WATER_STEP)
	for iz in nz + 1:
		for ix in nx + 1:
			var x := -WATER_EXTENT.x + float(ix) * WATER_STEP
			var z := -WATER_EXTENT.y + float(iz) * WATER_STEP
			verts.append(Vector3(x, SEA_LEVEL, z))
			normals.append(Vector3.UP)
			uvs.append(Vector2(x, z))       # one tile per metre, like a voxel water surface
			uv2s.append(Vector2(layer, uv2_y))
			colors.append(Color(1, 1, 1, 1))
	for iz in nz:
		for ix in nx:
			var a := iz * (nx + 1) + ix
			var b := a + 1
			var c := a + nx + 1
			var d := c + 1
			indices.append_array(PackedInt32Array([a, b, c, b, d, c]))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_TEX_UV2] = uv2s
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	water_mesh = MeshInstance3D.new()
	water_mesh.name = "Water"
	water_mesh.mesh = mesh
	water_material = ShaderMaterial.new()
	if ResourceLoader.exists(WATER_SHADER):
		water_material.shader = load(WATER_SHADER)
	if Textures != null and Textures.block_array != null:
		water_material.set_shader_parameter("tiles", Textures.block_array)
	water_material.set_shader_parameter("anim_frames", int(Textures.frames_of.get("water_still", 32)) if Textures != null else 32)
	water_material.set_shader_parameter("anim_fps", 10.0)
	water_material.set_shader_parameter("cam_near", camera.near)
	water_mesh.material_override = water_material
	water_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(water_mesh)

func _build_props() -> void:
	props = Node3D.new()
	props.name = "Props"
	add_child(props)
	var rng := RandomNumberGenerator.new()
	rng.seed = 90210
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = _checker_texture()
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST_WITH_MIPMAPS
	mat.albedo_color = Color(0.85, 0.85, 0.9)
	mat.roughness = 0.9
	mat.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	for i in 26:
		var box := MeshInstance3D.new()
		var bm := BoxMesh.new()
		var s := rng.randf_range(1.0, 4.0)
		bm.size = Vector3(s, s * rng.randf_range(0.6, 2.4), s)
		box.mesh = bm
		var x := rng.randf_range(-70.0, 40.0)
		var z := rng.randf_range(-60.0, 60.0)
		var ground := terrain_height(x, z)
		box.position = Vector3(x, ground + bm.size.y * 0.5, z)
		box.material_override = mat
		box.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		props.add_child(box)
	# a couple of tall pillars poking out of deep water (reflection / refraction reference)
	for i in 4:
		var pillar := MeshInstance3D.new()
		var pm := BoxMesh.new()
		pm.size = Vector3(2.0, 14.0, 2.0)
		pillar.mesh = pm
		pillar.position = Vector3(-14.0 - 11.0 * float(i), -2.0 + 2.0 * float(i % 2), -6.0 + 9.0 * float(i))
		pillar.material_override = mat
		props.add_child(pillar)

func _setup_hud() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 5
	add_child(layer)
	_hud = Label.new()
	_hud.position = Vector2(12, 10)
	_hud.modulate = Color(1, 1, 1, 0.85)
	layer.add_child(_hud)

func _process(delta: float) -> void:
	if day_speed != 0.0:
		time_ticks = fmod(time_ticks + day_speed * delta, WorldConst.TICKS_PER_DAY)
	_apply(delta)
	if _hud != null:
		_hud.text = "%s  t=%d  %s  daylight %.2f  %d fps  post=%s clouds=%s q=%d" % [
			planet_id, int(time_ticks), sky.weather_kind(), sky.daylight(), Engine.get_frames_per_second(),
			"on" if sky.post_process != null and sky.post_process.visible else "off",
			"on" if sky.clouds != null and sky.clouds.visible else "off",
			int(Game.settings.get("render_distance", 5))]
	_run_bench(delta)
	if _shot_timer >= 0.0:
		_shot_timer -= delta
		if _shot_timer < 0.0:
			_save_shot()
			get_tree().quit()

func _apply(delta: float) -> void:
	var planet_def: Dictionary = Registry.planets.get(planet_id, {})
	if planet_def.is_empty():
		planet_def = {"id": planet_id}
	else:
		planet_def = planet_def.duplicate(true)
		planet_def["id"] = planet_id
	sky.camera_underwater = camera.global_position.y < SEA_LEVEL - 0.05
	sky.apply(planet_def, time_ticks, weather, delta)
	if water_material != null:
		sky.apply_to_material(water_material)
		water_material.set_shader_parameter("water_color", sky.water_color())
		water_material.set_shader_parameter("cam_near", camera.near)

func _run_bench(delta: float) -> void:
	if not _bench:
		return
	_bench_t += delta
	if _bench_t < 0.6:
		return                            # warm-up
	_bench_frames += 1
	_bench_accum += delta
	if _bench_accum >= 3.0:
		var ms := _bench_accum / float(_bench_frames) * 1000.0
		match _bench_phase:
			0:
				print("BENCH full scene: %.2f ms/frame (%d frames, %s)" % [ms, _bench_frames, RenderingServer.get_video_adapter_name()])
				water_mesh.visible = false
				terrain.visible = false
				props.visible = false
				if sky.clouds != null:
					sky.clouds.visible = false
				if sky.post_process != null:
					sky.post_process.visible = false
			1:
				print("BENCH sky only: %.2f ms/frame (%d frames)" % [ms, _bench_frames])
				if sky.post_process != null:
					sky.post_process.visible = true
			2:
				print("BENCH sky + post: %.2f ms/frame (%d frames)" % [ms, _bench_frames])
				if sky.clouds != null:
					sky.clouds.visible = true
			3:
				print("BENCH sky + post + clouds: %.2f ms/frame (%d frames)" % [ms, _bench_frames])
				water_mesh.visible = true
				terrain.visible = true
				props.visible = true
			_:
				get_tree().quit()
		_bench_phase += 1
		_bench_frames = 0
		_bench_accum = 0.0

func _save_shot() -> void:
	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(_shot_path)
	print("SCREENSHOT %s -> %s (%s)" % [_shot_path, "ok" if err == OK else str(err), RenderingServer.get_video_adapter_name()])
