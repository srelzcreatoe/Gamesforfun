class_name HudPreview
extends Node3D
## Standalone HUD rehearsal scene: a fake ground plane, a light and a real Player so the touch HUD
## can be screenshotted before scenes/world/World.tscn exists.
## Run: tools/screenshot.sh out.png --args "--scene=res://scenes/ui/HudPreview.tscn"

const GROUND_Y := Entity.FALLBACK_GROUND_Y
const DEMO_ITEMS := ["stone", "dirt", "oak_planks", "cobblestone", "oak_log", "sand", "glass", "torch", "crafting_table"]

var player: Node = null

func _ready() -> void:
	name = "HudPreview"
	_environment()
	_ground()
	_scenery()
	_profile()
	_spawn_player()
	if Game != null and Game.ui != null:
		Game.ui.call("show_hud", true)
		Game.ui.call("show_hint", "HUD preview: joystick, buttons, hotbar and status rows.", 999.0)

func _environment() -> void:
	var we := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var mat := ProceduralSkyMaterial.new()
	mat.sky_top_color = Color(0.32, 0.55, 0.9)
	mat.sky_horizon_color = Color(0.75, 0.86, 0.98)
	mat.ground_bottom_color = Color(0.2, 0.28, 0.2)
	mat.ground_horizon_color = Color(0.6, 0.7, 0.6)
	sky.sky_material = mat
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.7
	we.environment = env
	add_child(we)
	var l := DirectionalLight3D.new()
	l.rotation_degrees = Vector3(-52, 38, 0)
	l.light_energy = 1.1
	add_child(l)

func _ground() -> void:
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(96, 96)
	mi.mesh = pm
	mi.position = Vector3(0, GROUND_Y, 0)
	var mat := StandardMaterial3D.new()
	var tex := _block_tex("grass_block_top0")
	if tex == null:
		tex = _block_tex("grass_path_top0")
	if tex != null:
		mat.albedo_texture = tex
		mat.uv1_scale = Vector3(96, 96, 1)
		mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
		mat.albedo_color = Color(0.55, 0.85, 0.45)
	else:
		mat.albedo_color = Color(0.36, 0.6, 0.3)
	mat.roughness = 1.0
	mi.material_override = mat
	add_child(mi)

func _block_tex(key: String) -> Texture2D:
	var p := "res://assets/textures/blocks/%s.png" % key
	return load(p) if ResourceLoader.exists(p) else null

func _scenery() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for i in 26:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3.ONE
		mi.mesh = bm
		var x := rng.randf_range(-22.0, 22.0)
		var z := rng.randf_range(-24.0, -4.0)
		var h := rng.randi_range(1, 4)
		mi.position = Vector3(floor(x) + 0.5, GROUND_Y + float(h) - 0.5, floor(z) + 0.5)
		mi.scale = Vector3(1, float(h), 1)
		var mat := StandardMaterial3D.new()
		var tex := _block_tex(["stone0", "cobblestone", "oak_log", "sand0"][i % 4])
		if tex != null:
			mat.albedo_texture = tex
			mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
		else:
			mat.albedo_color = Color(0.5, 0.5, 0.52)
		mat.roughness = 1.0
		mi.material_override = mat
		add_child(mi)

func _profile() -> void:
	if Game == null:
		return
	UiUtil.apply_cmdline_flags()
	UiUtil.ensure_demo_profile()
	Game.profile["health"] = -1
	Game.profile["hunger"] = 15
	Game.profile["ki"] = -1

func _spawn_player() -> void:
	if not ResourceLoader.exists("res://scenes/player/Player.tscn"):
		return
	var packed: PackedScene = load("res://scenes/player/Player.tscn")
	player = packed.instantiate()
	add_child(player)
	if player is Node3D:
		(player as Node3D).position = Vector3(0.5, GROUND_Y, 6.0)
	if player.get("camera_rig") != null:
		var rig: CameraRig = player.get("camera_rig")
		rig.yaw_deg = 18.0
		rig.pitch_deg = -8.0
