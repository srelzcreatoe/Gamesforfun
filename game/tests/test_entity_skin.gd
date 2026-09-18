extends TestCase
## RaceSkin composition, hair attachment and armor layers.

var model: BedrockModel = null

func setup() -> void:
	RaceSkin.clear_cache()

func teardown() -> void:
	if model != null:
		if model.is_inside_tree():
			model.get_parent().remove_child(model)
		model.free()
		model = null

func _character(extra := {}) -> Dictionary:
	var c := {
		"race": "saiyan", "gender": "male", "body_type": 0, "hair_type": 2,
		"hair_color": "#221a14", "eye_color": "#3f6fd8", "skin_color": "#ffd3c9",
		"skin_color2": "#572117", "skin_color3": "#ffd3c9",
		"eye_type": 0, "nose": 0, "mouth": 0, "tattoo": -1,
	}
	for k in extra.keys():
		c[k] = extra[k]
	return c

func test_race_directory_mapping() -> void:
	assert_eq(RaceSkin.race_dir("saiyan"), "humansaiyan")
	assert_eq(RaceSkin.race_dir("human"), "humansaiyan")
	assert_eq(RaceSkin.race_dir("namekian"), "namekian")
	assert_eq(RaceSkin.race_dir("majin"), "majin")
	assert_eq(RaceSkin.race_dir("bioandroid"), "bioandroid")
	assert_eq(RaceSkin.race_dir("frostdemon"), "frostdemon")
	assert_eq(RaceSkin.race_dir("unknown_race"), "humansaiyan", "falls back to human/saiyan")

func test_compose_produces_a_tinted_texture() -> void:
	var img := RaceSkin.compose_image(_character())
	assert_eq(img.get_width(), 64, "64x64 DMZ layer composition")
	assert_eq(img.get_height(), 64)
	assert_eq(img.get_format(), Image.FORMAT_RGBA8)
	var opaque := 0
	for y in 64:
		for x in 64:
			if img.get_pixel(x, y).a > 0.5:
				opaque += 1
	assert_true(opaque > 800, "the body layer covers a good part of the sheet: %d px" % opaque)
	# skin_color multiplies the base layer: a red skin must produce red-dominant pixels
	var red := RaceSkin.compose_image(_character({"skin_color": "#ff0000"}))
	var sum := Vector3.ZERO
	var n := 0
	for y in 64:
		for x in 64:
			var c := red.get_pixel(x, y)
			if c.a > 0.5 and (c.r + c.g + c.b) > 0.15:
				sum += Vector3(c.r, c.g, c.b)
				n += 1
	assert_true(n > 100, "sampled pixels: %d" % n)
	sum /= float(n)
	assert_true(sum.x > sum.y * 2.0 and sum.x > sum.z * 2.0, "skin_color tints the body layer: %s" % sum)

func test_eye_and_hair_colours_land_on_the_face() -> void:
	var blue := RaceSkin.compose_image(_character({"eye_color": "#0000ff", "hair_color": "#000000"}))
	var green := RaceSkin.compose_image(_character({"eye_color": "#00ff00", "hair_color": "#000000"}))
	var differing := 0
	# the eye pixels sit in the head "front" panel: x 8..16, y 8..16
	for y in range(8, 16):
		for x in range(8, 16):
			if blue.get_pixel(x, y) != green.get_pixel(x, y):
				differing += 1
	assert_true(differing >= 2, "eye_color changes the iris pixels: %d differ" % differing)

func test_cache_returns_the_same_texture() -> void:
	var a := RaceSkin.compose(_character())
	var b := RaceSkin.compose(_character())
	assert_eq(a, b, "identical characters share one cached ImageTexture")
	var c := RaceSkin.compose(_character({"hair_color": "#ff00ff"}))
	assert_ne(a, c, "a different character composes a new texture")

func test_apply_to_hides_armor_and_attaches_hair() -> void:
	model = BedrockModel.new()
	add_node(model)
	assert_true(model.load_geo("entity/races/human"))
	RaceSkin.apply_to(model, _character())
	for bone in RaceSkin.ALL_ARMOR_BONES:
		if model.has_bone(bone):
			assert_true(not model.is_bone_visible(bone), "%s hidden without armor" % bone)
	assert_true(not model.is_bone_visible("tail1"), "tail hidden for a character without a tail")
	var hair: MeshInstance3D = model.get_bone("head").get_node_or_null("Hair")
	assert_true(hair != null and hair.mesh != null, "voxel hair attached to the head bone")
	assert_eq(HairBuilder.current_style(model), HairBuilder.style_id(2), "style follows hair_type")

func test_armor_layers_use_the_armor_bones() -> void:
	model = BedrockModel.new()
	add_node(model)
	model.load_geo("entity/races/human")
	RaceSkin.apply_to(model, _character())
	var layer := ""
	for id in Registry.items.keys():
		var it: Dictionary = Registry.item(String(id))
		if String(it.get("kind", "")) == "armor" and String(it.get("armor", {}).get("slot", "")) == "chest":
			layer = String(id)
			break
	if layer == "":
		return                      # items.json has no armor yet
	RaceSkin.apply_armor(model, [layer])
	assert_true(model.is_bone_visible("armorBody"), "chest armor shows armorBody")
	var mat := model.bone_material("armorBody")
	assert_true(mat != null and mat.albedo_texture != null, "armor layer texture assigned to the bone")
	assert_true(not model.is_bone_visible("armorHead"), "the helmet bone stays hidden")

func test_compose_cost() -> void:
	RaceSkin.clear_cache()
	var t0 := Time.get_ticks_usec()
	RaceSkin.compose_image(_character())
	var us := Time.get_ticks_usec() - t0
	print("      RaceSkin.compose_image: %.2f ms (64x64, 9 layers)" % (us / 1000.0))
	assert_true(us < 200000, "composition takes %.1f ms" % (us / 1000.0))

func test_form_visuals_accept_scalar_and_array_scaling() -> void:
	assert_near(RaceSkin.form_scale({"modelScaling": 1.25}), 1.25, 0.001, "float")
	assert_near(RaceSkin.form_scale({"modelScaling": [1.1, 1.4, 1.1]}), 1.4, 0.001, "3 element array")
	assert_near(RaceSkin.form_scale({"modelScaling": [1.2, 1.2]}), 1.2, 0.001, "2 element array")
	assert_near(RaceSkin.form_scale({}), 1.0, 0.001, "missing")
	assert_near(RaceSkin.form_scale({"modelScaling": "nope"}), 1.0, 0.001, "invalid")
	model = BedrockModel.new()
	add_node(model)
	model.load_geo("entity/races/human")
	model.set_model_scale(0.9375)
	RaceSkin.apply_to(model, _character())
	RaceSkin.apply_form_visuals(model, {"modelScaling": [1.0, 1.3, 1.0], "hairType": 2})
	assert_near(model.model_scale, 0.9375 * 1.3, 0.001, "array scaling multiplies the base scale")
	RaceSkin.apply_form_visuals(model, {"modelScaling": 1.0})
	assert_near(model.model_scale, 0.9375, 0.001, "reverting restores the base scale")

func test_form_visuals_are_null_safe_without_hair() -> void:
	# a saga model carries its own hair bones and has no "Hair" attachment
	model = BedrockModel.new()
	add_node(model)
	assert_true(model.load_geo("entity/sagas/saga_vegeta"))
	model.set_model_scale(1.0)
	RaceSkin.apply_form_visuals(model, {"modelScaling": [1.2, 1.2, 1.2], "hairType": 3, "hairColor": "#ffe14d", "bodyColor": "#ffeecc"})
	assert_near(model.model_scale, 1.2, 0.001, "scale still applied")
	assert_true(model.material.albedo_color != Color.WHITE, "body tint still applied")
	# and a model with no head bone at all
	var ball := BedrockModel.new()
	add_node(ball)
	ball.load_geo("block/dball")
	RaceSkin.apply_form_visuals(ball, {"modelScaling": 2.0, "hairType": 1})
	assert_near(ball.model_scale, 2.0, 0.001, "no head bone is fine")
	ball.get_parent().remove_child(ball)
	ball.free()

func test_race_model_resolves_to_existing_geometry() -> void:
	# every race the character creation screen offers must map to a real .geo.json
	for r in ["human", "saiyan", "namekian", "majin", "bioandroid", "frostdemon", "unknown"]:
		var path := RaceSkin.race_model(r)
		assert_true(FileAccess.file_exists("res://assets/models/" + path + ".geo.json"),
				"%s -> %s exists" % [r, path])
		var m := BedrockModel.new()
		add_node(m)
		assert_true(m.load_geo(path), "%s geometry loads" % r)
		assert_true(m.has_bone("head"), "%s has a head bone" % r)
		m.get_parent().remove_child(m)
		m.free()
	# DMZ has no namekian body: it uses the human rig (like the mod does)
	assert_eq(RaceSkin.race_model("namekian"), "entity/races/human")
	assert_eq(RaceSkin.race_model("majin"), "entity/races/majin")
	assert_eq(RaceSkin.race_model("majin", "female"), "entity/races/majin_slim")

func test_character_fields_tolerate_strings_and_floats() -> void:
	var loose := {
		"race": "saiyan", "gender": "male", "body_type": "1", "hair_type": 2.0,
		"hair_color": "221a14", "eye_color": "#3f6fd8", "skin_color": "#ffd3c9",
		"eye_type": "0", "nose": 1.0, "mouth": "2", "tattoo": "0",
	}
	var img := RaceSkin.compose_image(loose)
	assert_eq(img.get_width(), 64, "composed from loose types")
	var opaque := 0
	for y in 64:
		for x in 64:
			if img.get_pixel(x, y).a > 0.5:
				opaque += 1
	assert_true(opaque > 800, "body still composed: %d px" % opaque)
	model = BedrockModel.new()
	add_node(model)
	model.load_geo(RaceSkin.race_model("saiyan"))
	RaceSkin.apply_to(model, loose)
	var hm: MeshInstance3D = model.get_bone("head").get_node_or_null("Hair")
	assert_true(hm != null and hm.mesh != null, "hair attached with a float hair_type")
	assert_eq(HairBuilder.current_style(model), HairBuilder.style_id(2), "hair_type 2.0 resolved to style 2")

func _int_of(v: Variant) -> int:
	return int(v) if (v is int or v is float or (v is String and String(v).is_valid_int())) else -1

# --- DMZ preset hair ----------------------------------------------------------

func test_dmz_presets_are_the_mods_own() -> void:
	# data/dmz_hair_presets.json is decoded from the mod's own hair codes by
	# tools/dmz_hair/decode_presets.py - nothing here is hand authored
	assert_eq(HairBuilder.style_count(), 27, "every DMZ preset is selectable")
	var full := 0
	for i in HairBuilder.style_count():
		var id := HairBuilder.style_id(i)
		assert_eq(HairBuilder.style_index(id), i, "%s round trips through the order" % id)
		if HairBuilder.is_full_set(id):
			full += 1
		var hair := HairBuilder.resolve_style(id)
		for face in HairBuilder.FACE_ORDER:
			for raw in hair.get("strands", {}).get(face, []):
				var s: Dictionary = raw
				var slot := int(s.get("s", -1))
				var limit: int = 4 if face == "FRONT" else 16
				assert_true(slot >= 0 and slot < limit, "%s %s slot %d in range" % [id, face, slot])
				assert_true(int(s.get("l", 0)) > 0, "only visible strands are kept")
	assert_true(full >= 24, "%d presets ship SSJ/SSJ2/SSJ3 hair" % full)
	# the two forms.json forcedHairCode hairs came along too
	assert_true(not HairBuilder.forced_style_id("").begins_with("forced:"), "no code -> no style")
	var forced: Dictionary = HairBuilder.data().get("forced", {})
	assert_true(forced.size() == 2, "both forced hairs decoded (%d)" % forced.size())

func test_every_preset_builds_geometry_on_the_head() -> void:
	for i in HairBuilder.style_count():
		var id := HairBuilder.style_id(i)
		var mesh := HairBuilder.style_mesh(id)
		if HairBuilder.resolve_style(id).get("strands", {}).is_empty():
			assert_eq(mesh, null, "%s is the empty preset" % id)
			continue
		assert_true(mesh != null, "%s builds a mesh" % id)
		var box := mesh.get_aabb()
		# head-local model units: the skull is x[-4,4] y[0,8] z[-4,4]
		assert_true(box.position.y + box.size.y > 8.0, "%s rises above the skull (%.1f)" % [id, box.position.y + box.size.y])
		assert_true(box.position.y > -8.0, "%s does not run down the body (%.1f)" % [id, box.position.y])
		assert_true(box.size.x < 40.0 and box.size.z < 40.0, "%s stays near the head (%s)" % [id, box.size])
		# facet shading is baked in, so near black hair still reads as strands
		var cols: PackedColorArray = mesh.surface_get_arrays(0)[Mesh.ARRAY_COLOR]
		assert_true(cols.size() > 0, "%s has vertex colours" % id)

func test_hair_attaches_and_a_form_swaps_the_variant() -> void:
	model = BedrockModel.new()
	add_node(model)
	model.load_geo("entity/races/human")
	RaceSkin.apply_to(model, _character({"hair_type": 0, "hair_color": "#221a14"}))
	var head: Node3D = model.get_bone("head")
	var hair: MeshInstance3D = head.get_node_or_null("Hair")
	assert_true(hair != null and hair.mesh != null, "hair mesh on the head bone")
	assert_eq(HairBuilder.current_style(model), HairBuilder.style_id(0), "preset follows hair_type")
	var mat := HairBuilder.hair_material(model)
	assert_true(mat != null and mat.albedo_texture != null, "races/hair.png on the material")
	assert_eq(mat, hair.material_override, "the flicker hook still finds the material")
	assert_true(mat.vertex_color_use_as_albedo, "facet shading is used")
	assert_near(mat.albedo_color.r, HairBuilder.hair_albedo(Color("#221a14")).r, 0.01, "hair colour")
	# a form takes the preset's own SSJ hair, geometry included
	var base_extent := HairBuilder.style_extent(HairBuilder.style_id(0))
	RaceSkin.apply_form_visuals(model, {"hairType": "ssj", "modelScaling": 1.0})
	assert_eq(HairBuilder.current_style(model), HairBuilder.style_id(0) + "@ssj", "ssj hair")
	assert_ne(HairBuilder.style_extent(HairBuilder.style_id(0) + "@ssj"), base_extent, "different geometry")
	RaceSkin.set_form_hair(model, {"hairType": "ssj3", "hairColor": "#ffe89e"})
	assert_eq(HairBuilder.current_style(model), HairBuilder.style_id(0) + "@ssj3")
	assert_true(HairBuilder.hair_material(model).albedo_color.r > 0.8, "form hair colour wins")
	# SSJ4 forces one specific DMZ hair
	var forced := RaceSkin.set_form_hair(model, {"forcedHairCode": HairBuilder.data()["forced"]["supersaiyan.supersaiyan4"]["code"]})
	assert_true(HairBuilder.current_style(model).begins_with("forced:"), "forcedHairCode wins")
	# and dropping the form restores the character's own preset
	RaceSkin.clear_form_hair(model)
	assert_eq(HairBuilder.current_style(model), HairBuilder.style_id(0), "own preset restored")

func test_hair_is_exactly_one_node_named_hair() -> void:
	# CONTRACT with Forms.gd: `_modulate_recursive()` skips the hair by NAME, so the
	# rig must stay exactly one node called "Hair" under the `head` bone (the bone's
	# own geometry is a sibling called "mesh").
	model = BedrockModel.new()
	add_node(model)
	model.load_geo("entity/races/human")
	var head: Node3D = model.get_bone("head")
	for style in [HairBuilder.style_id(0), HairBuilder.style_id(21), HairBuilder.style_id(4),
			HairBuilder.style_id(0) + "@ssj3"]:
		HairBuilder.attach(model, style, Color("#221a14"))
		var hair_nodes := 0
		for c in head.get_children():
			if c is MeshInstance3D:
				assert_true(c.name == StringName("Hair") or c.name == StringName("mesh"),
					"%s: unexpected mesh %s under the head bone" % [style, c.name])
				if c.name == StringName("Hair"):
					hair_nodes += 1
		assert_eq(hair_nodes, 1, "%s: exactly one hair node" % style)

func test_presets_with_coloured_strands_use_a_second_surface() -> void:
	# two of DMZ's presets tint individual strands (gold tips); those strands go
	# on surface 1 with their own material
	var two_tone := ""
	for i in HairBuilder.style_count():
		var id := HairBuilder.style_id(i)
		var m := HairBuilder.style_mesh(id)
		if m != null and m.get_surface_count() > 1:
			two_tone = id
			break
	assert_true(two_tone != "", "a preset with tinted strands exists")
	model = BedrockModel.new()
	add_node(model)
	model.load_geo("entity/races/human")
	RaceSkin.apply_to(model, _character({"hair_type": HairBuilder.style_index(two_tone),
		"hair_color": "#221a14"}))
	var hair: MeshInstance3D = model.get_bone("head").get_node_or_null("Hair")
	assert_eq(hair.mesh.get_surface_count(), 2, "hair + accent surfaces")
	var main := hair.get_surface_override_material(0) as StandardMaterial3D
	var accent := hair.get_surface_override_material(1) as StandardMaterial3D
	assert_true(main != null and accent != null, "a material per surface")
	assert_ne(main.albedo_color, accent.albedo_color, "the accent is a different colour")
	assert_eq(HairBuilder.accent_color(two_tone, Color.RED), Color("#F5DA0C").lightened(0.0),
		"the strand's own colour is used")
	assert_eq(HairBuilder.accent_color(HairBuilder.style_id(0), Color.RED),
		Color.RED.lightened(HairBuilder.ACCENT_LIGHTEN), "otherwise it derives from the main colour")

func test_apply_to_records_the_character_for_form_reverts() -> void:
	# CONTRACT with Forms.gd / TransformationDirector: they revert hair with
	# clear_form_hair(target) and no character dictionary.
	model = BedrockModel.new()
	add_node(model)
	model.load_geo("entity/races/human")
	RaceSkin.apply_to(model, _character({"hair_type": 6, "hair_color": "#4a2c17"}))
	assert_true(model.has_meta("character"), "the composed character is recorded")
	assert_eq(String(model.get_meta("base_hair_style")), HairBuilder.style_id(6), "base preset kept")
	RaceSkin.set_form_hair(model, {"hairType": "ssj2", "hairColor": "#f5d03a"})
	assert_eq(HairBuilder.current_style(model), HairBuilder.style_id(6) + "@ssj2")
	RaceSkin.clear_form_hair(model)
	assert_eq(HairBuilder.current_style(model), HairBuilder.style_id(6), "own preset restored from the meta")
	assert_near(HairBuilder.hair_material(model).albedo_color.h, Color("#4a2c17").h, 0.03, "own colour restored")

func test_visual_aabb_includes_the_hair() -> void:
	model = BedrockModel.new()
	add_node(model)
	assert_true(model.load_geo("entity/races/human"))
	model.set_model_scale(1.0)
	RaceSkin.apply_to(model, {"race": "saiyan", "hair_type": 4})      # the empty preset
	var bald := model.visual_aabb()
	RaceSkin.apply_to(model, {"race": "saiyan", "hair_type": 7})      # a big mane
	var haired := model.visual_aabb()
	# the character preview frames the camera from this box, so the hair has to be in it
	assert_true(haired.size.y > bald.size.y + 0.1,
		"hair grows the framed box (%.2f -> %.2f)" % [bald.size.y, haired.size.y])
	assert_true(haired.size.y < 4.0, "and stays sane (%.2f)" % haired.size.y)
