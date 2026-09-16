extends TestCase
## Bedrock geometry parser / mesh builder tests.

var model: BedrockModel = null

func teardown() -> void:
	if model != null and model.is_inside_tree():
		model.get_parent().remove_child(model)
	if model != null:
		model.free()
	model = null

func _load(path: String) -> BedrockModel:
	model = BedrockModel.new()
	add_node(model)
	assert_true(model.load_geo(path), "load_geo(%s)" % path)
	return model

func test_human_geometry() -> void:
	var m := _load("entity/races/human")
	assert_eq(m.bone_count(), 30, "human.geo.json bone count")
	assert_eq(m.texture_size, Vector2i(64, 64), "texture size from the description")
	assert_true(m.has_bone("head"), "head bone")
	assert_eq(m.pivots.get("head"), Vector3(0, 24, 0), "head pivot")
	assert_eq(m.pivots.get("waist"), Vector3(0, 12, 0), "waist pivot")
	# Convention: X is mirrored, so bedrock right_arm (x = -5) is at godot +5,
	# i.e. on the entity's right when the model faces -Z.
	assert_near(float(m.pivots.get("right_arm", Vector3.ZERO).x), 5.0, 0.001, "right arm is on +X")
	assert_near(float(m.pivots.get("left_arm", Vector3.ZERO).x), -5.0, 0.001, "left arm is on -X")
	# hierarchy
	assert_eq(m.get_bone("head").get_parent(), m.get_bone("waist"), "head parented to waist")
	assert_eq(m.get_bone("hat_layer").get_parent(), m.get_bone("head"), "hat_layer parented to head")
	assert_eq(m.get_bone("waist").position, Vector3(0, 12, 0), "bone position is relative to the parent pivot")
	assert_eq(m.get_bone("head").position, Vector3(0, 12, 0), "head offset from waist")
	# locators are kept
	assert_true(m.get_locator("locator") != null, "right hand locator")
	# scale: 1 model unit = 1/16 m
	m.set_model_scale(1.0)
	assert_near(m.scale.x, 1.0 / 16.0, 0.0001, "model scale")

func test_meshes_and_uvs() -> void:
	var m := _load("entity/races/human")
	var head: MeshInstance3D = m.meshes.get("head")
	assert_true(head != null, "head has a mesh")
	var arrays: Array = head.mesh.surface_get_arrays(0)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
	var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
	assert_true(verts.size() >= 24, "head cube has at least 24 vertices, got %d" % verts.size())
	# the head cube spans y 24..32 in model units, local to the pivot at y=24
	var min_y := 1e9
	var max_y := -1e9
	var min_z := 1e9
	for v in verts:
		min_y = minf(min_y, v.y)
		max_y = maxf(max_y, v.y)
		min_z = minf(min_z, v.z)
	assert_near(min_y, 0.0, 0.001, "head bottom at the pivot")
	assert_near(max_y, 8.0, 0.001, "head is 8 units tall")
	assert_near(min_z, -4.0, 0.001, "head front at -Z")
	# UVs are normalised by texture_width/height (64), the face panel starts at u=8/64
	var u_min := 1e9
	for uv in uvs:
		u_min = minf(u_min, uv.x)
	assert_near(u_min, 0.0, 0.001, "head uv starts at 0")
	for uv in uvs:
		assert_true(uv.x >= -0.001 and uv.x <= 1.001 and uv.y >= -0.001 and uv.y <= 1.001, "uv in range: %s" % uv)
	# the face quad (normal -Z) must carry the face panel (u 8..16 -> 0.125..0.25)
	var found_face := false
	for i in verts.size():
		if normals[i].is_equal_approx(Vector3(0, 0, -1)) and uvs[i].x >= 0.124 and uvs[i].x <= 0.251:
			found_face = true
	assert_true(found_face, "the -Z face samples the skin face panel")

func test_hd_texture_size_normalisation() -> void:
	# shenron declares 128x128; UVs must still be 0..1
	var m := _load("entity/dragon/shenron")
	assert_eq(m.texture_size, Vector2i(128, 128), "shenron texture size")
	var any := false
	for name in m.meshes.keys():
		var mi: MeshInstance3D = m.meshes[name]
		var uvs: PackedVector2Array = mi.mesh.surface_get_arrays(0)[Mesh.ARRAY_TEX_UV]
		for uv in uvs:
			any = true
			assert_true(uv.x >= -0.01 and uv.x <= 1.01, "uv.x in range")
	assert_true(any, "shenron has uvs")

func test_per_face_uv_and_rotated_cubes() -> void:
	# armorLeggingsBody ships the expanded per-face form of the same box as
	# armorBody: both must produce the same UV span.
	var m := _load("entity/races/human")
	var box: MeshInstance3D = m.meshes.get("armorBody")
	var per_face: MeshInstance3D = m.meshes.get("armorLeggingsBody")
	assert_true(box != null and per_face != null, "both armor body bones have meshes")
	var a: PackedVector2Array = box.mesh.surface_get_arrays(0)[Mesh.ARRAY_TEX_UV]
	var b: PackedVector2Array = per_face.mesh.surface_get_arrays(0)[Mesh.ARRAY_TEX_UV]
	var ra := _uv_rect(a)
	var rb := _uv_rect(b)
	assert_near(ra.position.x, rb.position.x, 0.002, "box uv and per-face uv agree on u start")
	assert_near(ra.size.x, rb.size.x, 0.002, "box uv and per-face uv agree on u span")
	assert_near(ra.position.y, rb.position.y, 0.002, "box uv and per-face uv agree on v start")

func _uv_rect(uvs: PackedVector2Array) -> Rect2:
	var mn := Vector2(1e9, 1e9)
	var mx := Vector2(-1e9, -1e9)
	for uv in uvs:
		mn = mn.min(uv)
		mx = mx.max(uv)
	return Rect2(mn, mx - mn)

func test_bone_visibility_and_material() -> void:
	var m := _load("entity/races/human")
	m.hide_layer_bones(["armor*"])
	assert_true(not m.is_bone_visible("armorHead"), "armor bones hidden by prefix")
	assert_true(m.is_bone_visible("head"), "head still visible")
	m.set_bone_visible("armorHead", true)
	assert_true(m.is_bone_visible("armorHead"), "re-shown")
	assert_true(m.material != null and m.material.texture_filter == BaseMaterial3D.TEXTURE_FILTER_NEAREST, "nearest filter")
	assert_eq(m.material.transparency, BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR, "alpha scissor")
	assert_near(m.material.alpha_scissor_threshold, 0.5, 0.001)

func test_every_geometry_file_parses() -> void:
	var files := JsonUtil.list_files("res://assets/models", ".json", true)
	assert_true(files.size() > 100, "geo files found: %d" % files.size())
	var built := 0
	for f in files:
		if not f.ends_with(".geo.json"):
			continue
		var rel := f.trim_prefix("res://assets/models/").trim_suffix(".geo.json")
		var geo := BedrockModel.parse_geo(rel)
		if geo.is_empty():
			failures.append("%s: cannot parse %s" % [current, rel])
			continue
		built += 1
		assert_true(geo.has("bones"), "%s has bones" % rel)
	assert_true(built > 200, "geometries parsed: %d" % built)

func test_build_cost() -> void:
	BedrockModel._mesh_cache.clear()
	var t0 := Time.get_ticks_usec()
	var m := _load("entity/sagas/saga_vegeta")
	var cold := Time.get_ticks_usec() - t0
	var t1 := Time.get_ticks_usec()
	var m2 := BedrockModel.new()
	add_node(m2)
	m2.load_geo("entity/sagas/saga_vegeta")
	var warm := Time.get_ticks_usec() - t1
	print("      saga_vegeta (%d bones): first build %.1f ms, cached %.1f ms" % [m.bone_count(), cold / 1000.0, warm / 1000.0])
	m2.get_parent().remove_child(m2)
	m2.free()
	assert_true(warm < cold, "mesh cache makes the second instance cheaper")
