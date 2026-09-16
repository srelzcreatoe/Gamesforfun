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
const CHUNK_SHADER := "res://shaders/chunk_opaque.gdshader"
const SEA_LEVEL := 0.0
const WATER_EXTENT := Vector2(220.0, 220.0)
const WATER_STEP := 2.5
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
var ground_material: ShaderMaterial

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
	var cam_x := float(args.get("cam_x", 22.0))
	var cam_z := float(args.get("cam_z", 7.0))
	# stand 1.8 m above the ground (eye height) unless a height is given
	var height := terrain_height(cam_x, cam_z) + 1.8
	var pitch := deg_to_rad(float(args.get("pitch", -7.0)))
	if args.has("underwater"):
		height = -1.2
		pitch = deg_to_rad(float(args.get("pitch", 5.0)))
	if args.has("height"):
		height = float(args["height"])
	camera.position = Vector3(cam_x, height, cam_z)
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

## Vertex arrays in the ChunkMesher's format, so the preview ground/props are drawn by the real
## chunk_opaque.gdshader (this doubles as a visual check of the chunk polish pass).
static func _uv2_for(layer: int, frames := 1) -> Vector2:
	return Vector2(float(layer) + float(frames) / 128.0, (15.0 * 16.0) / 255.0)

func _chunk_material() -> ShaderMaterial:
	if ground_material != null:
		return ground_material
	ground_material = ShaderMaterial.new()
	if ResourceLoader.exists(CHUNK_SHADER):
		ground_material.shader = load(CHUNK_SHADER)
	if Textures != null and Textures.block_array != null:
		ground_material.set_shader_parameter("tiles", Textures.block_array)
	return ground_material

func _build_terrain() -> void:
	# "checker quad": alternating sand / grass block tiles, one quad per TERRAIN_STEP metres.
	var layer_a := Textures.layer("sand")
	var layer_b := Textures.layer("grass_top0")
	if layer_b == 0:
		layer_b = Textures.layer("dirt0")
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	var uv2s := PackedVector2Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()
	var nx := int(TERRAIN_EXTENT.x * 2.0 / TERRAIN_STEP)
	var nz := int(TERRAIN_EXTENT.y * 2.0 / TERRAIN_STEP)
	for iz in nz:
		for ix in nx:
			var x0 := -TERRAIN_EXTENT.x + float(ix) * TERRAIN_STEP
			var z0 := -TERRAIN_EXTENT.y + float(iz) * TERRAIN_STEP
			var x1 := x0 + TERRAIN_STEP
			var z1 := z0 + TERRAIN_STEP
			var uv2 := _uv2_for(layer_a if (ix + iz) % 2 == 0 else layer_b)
			var base := verts.size()
			var corners := [Vector2(x0, z0), Vector2(x1, z0), Vector2(x0, z1), Vector2(x1, z1)]
			var uvc := [Vector2(0, 0), Vector2(1, 0), Vector2(0, 1), Vector2(1, 1)]
			for i in 4:
				var c: Vector2 = corners[i]
				verts.append(Vector3(c.x, terrain_height(c.x, c.y), c.y))
				var e := 1.0
				normals.append(Vector3(terrain_height(c.x - e, c.y) - terrain_height(c.x + e, c.y), 2.0 * e,
						terrain_height(c.x, c.y - e) - terrain_height(c.x, c.y + e)).normalized())
				uvs.append(uvc[i])
				uv2s.append(uv2)
				colors.append(Color(1, 1, 1, 1))
			indices.append_array(PackedInt32Array([base, base + 1, base + 2, base + 1, base + 3, base + 2]))
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
	terrain = MeshInstance3D.new()
	terrain.name = "Terrain"
	terrain.mesh = mesh
	terrain.material_override = _chunk_material()
	add_child(terrain)

## A voxel-style box with the chunk vertex stream (UV 0..1 per face, UV2 layer/light, COLOR tint/ao).
static func voxel_box(size: Vector3, layer: int, top_layer := -1) -> ArrayMesh:
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	var uv2s := PackedVector2Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()
	var h := size * 0.5
	var faces := [
		{"n": Vector3(1, 0, 0), "v": [Vector3(h.x, -h.y, h.z), Vector3(h.x, -h.y, -h.z), Vector3(h.x, h.y, h.z), Vector3(h.x, h.y, -h.z)]},
		{"n": Vector3(-1, 0, 0), "v": [Vector3(-h.x, -h.y, -h.z), Vector3(-h.x, -h.y, h.z), Vector3(-h.x, h.y, -h.z), Vector3(-h.x, h.y, h.z)]},
		{"n": Vector3(0, 1, 0), "v": [Vector3(-h.x, h.y, h.z), Vector3(h.x, h.y, h.z), Vector3(-h.x, h.y, -h.z), Vector3(h.x, h.y, -h.z)]},
		{"n": Vector3(0, -1, 0), "v": [Vector3(-h.x, -h.y, -h.z), Vector3(h.x, -h.y, -h.z), Vector3(-h.x, -h.y, h.z), Vector3(h.x, -h.y, h.z)]},
		{"n": Vector3(0, 0, 1), "v": [Vector3(-h.x, -h.y, h.z), Vector3(h.x, -h.y, h.z), Vector3(-h.x, h.y, h.z), Vector3(h.x, h.y, h.z)]},
		{"n": Vector3(0, 0, -1), "v": [Vector3(h.x, -h.y, -h.z), Vector3(-h.x, -h.y, -h.z), Vector3(h.x, h.y, -h.z), Vector3(-h.x, h.y, -h.z)]},
	]
	var uvc := [Vector2(0, 1), Vector2(1, 1), Vector2(0, 0), Vector2(1, 0)]
	for f in faces:
		var n: Vector3 = f["n"]
		var lay := top_layer if (top_layer >= 0 and n.y > 0.5) else layer
		var uv2 := _uv2_for(lay)
		var base := verts.size()
		for i in 4:
			verts.append(f["v"][i])
			normals.append(n)
			uvs.append(uvc[i])
			uv2s.append(uv2)
			colors.append(Color(1, 1, 1, 1))
		indices.append_array(PackedInt32Array([base, base + 1, base + 2, base + 1, base + 3, base + 2]))
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
	return mesh

func _build_water() -> void:
	# One quad per WATER_STEP metres with UV 0..1 per quad and the ChunkMesher's UV2 packing
	# (UV2.x = layer + (frames + sway * 64) / 128, UV2.y = packed light / 255), so the preview
	# feeds the water shader exactly what the real chunk meshes do.
	var lava := args.has("lava")
	var key := "lava_still" if lava else "water_still"
	var layer := float(Textures.layer(key))
	var frames := float(Textures.frames_of.get(key, 32))
	var uv2_x := layer + frames / 128.0
	var uv2_y := (15.0 * 16.0) / 255.0            # full sky light, no block light
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	var uv2s := PackedVector2Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()
	var tint := Color(1, 1, 1, 1) if lava else Color.html("#3F76E4")
	tint.a = 1.0
	var nx := int(WATER_EXTENT.x * 2.0 / WATER_STEP)
	var nz := int(WATER_EXTENT.y * 2.0 / WATER_STEP)
	for iz in nz:
		for ix in nx:
			var x0 := -WATER_EXTENT.x + float(ix) * WATER_STEP
			var z0 := -WATER_EXTENT.y + float(iz) * WATER_STEP
			var x1 := x0 + WATER_STEP
			var z1 := z0 + WATER_STEP
			var base := verts.size()
			verts.append(Vector3(x0, SEA_LEVEL, z0))
			verts.append(Vector3(x1, SEA_LEVEL, z0))
			verts.append(Vector3(x0, SEA_LEVEL, z1))
			verts.append(Vector3(x1, SEA_LEVEL, z1))
			uvs.append(Vector2(0, 0))
			uvs.append(Vector2(1, 0))
			uvs.append(Vector2(0, 1))
			uvs.append(Vector2(1, 1))
			for i in 4:
				normals.append(Vector3.UP)
				uv2s.append(Vector2(uv2_x, uv2_y))
				colors.append(tint)
			indices.append_array(PackedInt32Array([base, base + 1, base + 2, base + 1, base + 3, base + 2]))
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
	water_material.set_shader_parameter("anim_fps", 4.0 if lava else 10.0)
	water_material.set_shader_parameter("is_lava", 1 if lava else 0)
	water_material.set_shader_parameter("cam_near", camera.near)
	water_material.set_shader_parameter("debug_view", int(args.get("water_debug", 0)))
	water_mesh.material_override = water_material
	water_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(water_mesh)

func _build_props() -> void:
	props = Node3D.new()
	props.name = "Props"
	add_child(props)
	var rng := RandomNumberGenerator.new()
	rng.seed = 90210
	var stone := Textures.layer("stone0")
	var planks := Textures.layer("oak_planks")
	var mat := _chunk_material()
	for i in 26:
		var box := MeshInstance3D.new()
		var sx := rng.randf_range(1.0, 4.0)
		var sy := sx * rng.randf_range(0.6, 2.4)
		box.mesh = voxel_box(Vector3(sx, sy, sx), stone if i % 2 == 0 else planks)
		var x := rng.randf_range(-70.0, 40.0)
		var z := rng.randf_range(-60.0, 60.0)
		box.position = Vector3(x, terrain_height(x, z) + sy * 0.5, z)
		box.material_override = mat
		props.add_child(box)
	# tall pillars standing in deep water (reflection / refraction / foam reference)
	for i in 4:
		var pillar := MeshInstance3D.new()
		pillar.mesh = voxel_box(Vector3(2.0, 14.0, 2.0), stone)
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
		var amb := sky.ambient_color()
		_hud.text = "%s t=%d %s daylight %.2f %d fps post=%s clouds=%s rd=%d\namb=(%.2f %.2f %.2f) sun=(%.2f %.2f %.2f) fog=(%.2f %.2f %.2f) fog %d-%d" % [
			planet_id, int(time_ticks), sky.weather_kind(), sky.daylight(), Engine.get_frames_per_second(),
			"on" if sky.post_process != null and sky.post_process.visible else "off",
			"on" if sky.clouds != null and sky.clouds.visible else "off",
			int(Game.settings.get("render_distance", 5)),
			amb.r, amb.g, amb.b, sky.sun_color().r, sky.sun_color().g, sky.sun_color().b,
			sky.fog_color().r, sky.fog_color().g, sky.fog_color().b, int(sky.fog_start()), int(sky.fog_end())]
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
	# command line overrides, so a look can be checked without editing data/planets.json
	for k in ["stars", "star_brightness", "milky_way", "aurora", "sun_scale", "cloud_coverage"]:
		if args.has(k):
			var sky_block: Dictionary = planet_def.get("sky", {})
			sky_block = sky_block.duplicate(true)
			sky_block[k] = float(args[k]) if k != "aurora" else bool(float(args[k]) > 0.5)
			planet_def["sky"] = sky_block
	sky.camera_underwater = camera.global_position.y < SEA_LEVEL - 0.05
	sky.apply(planet_def, time_ticks, weather, delta)
	if ground_material != null:
		sky.apply_to_material(ground_material)
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
