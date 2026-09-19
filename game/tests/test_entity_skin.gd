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
	# composition is HD first, so the canvas is the largest layer (capped by
	# RaceSkin.canvas_cap()); everything below samples in 64ths of the sheet
	var img := RaceSkin.compose_image(_character())
	assert_true(img.get_width() >= 64 and img.get_width() % 64 == 0,
		"the canvas is a whole multiple of the 64x64 layout (%d)" % img.get_width())
	assert_eq(img.get_width(), img.get_height())
	assert_eq(img.get_format(), Image.FORMAT_RGBA8)
	var u := img.get_width() / 64                      # pixels per DMZ texel
	var opaque := 0
	for y in 64:
		for x in 64:
			if img.get_pixel(x * u, y * u).a > 0.5:
				opaque += 1
	assert_true(opaque > 800, "the body layer covers a good part of the sheet: %d px" % opaque)
	# skin_color multiplies the base layer: a red skin must produce red-dominant pixels
	var red := RaceSkin.compose_image(_character({"skin_color": "#ff0000"}))
	var ur := red.get_width() / 64
	var sum := Vector3.ZERO
	var n := 0
	for y in 64:
		for x in 64:
			var c := red.get_pixel(x * ur, y * ur)
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
	# the eye pixels sit in the head "front" panel: x 8..16, y 8..16 of the 64x64
	# layout, scaled to whatever canvas the HD layers produced
	var u := blue.get_width() / 64
	for y in range(8 * u, 16 * u):
		for x in range(8 * u, 16 * u):
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
	# HD composition walks up to 1024x1024 x ~10 layers in GDScript, so it is
	# cached per character; the budget here is one composite, not a frame.
	RaceSkin.clear_cache()
	var t0 := Time.get_ticks_usec()
	var img := RaceSkin.compose_image(_character())
	var us := Time.get_ticks_usec() - t0
	print("      RaceSkin.compose_image: %.1f ms (%dpx, HD first)" % [us / 1000.0, img.get_width()])
	assert_true(us < 2500000, "one HD composite takes %.1f ms" % (us / 1000.0))
	# the same character comes straight out of the cache afterwards
	RaceSkin.compose(_character())                      # warm
	t0 = Time.get_ticks_usec()
	for i in 4:
		RaceSkin.compose(_character())
	var cached_us := Time.get_ticks_usec() - t0
	assert_true(cached_us < us / 4, "four cached composes: %.2f ms" % (cached_us / 1000.0))
	# and the 64x64 set stays cheap for anything that opts out
	RaceSkin.hd = false
	RaceSkin.clear_cache()
	t0 = Time.get_ticks_usec()
	var low := RaceSkin.compose_image(_character())
	var low_us := Time.get_ticks_usec() - t0
	RaceSkin.hd = true
	RaceSkin.clear_cache()
	assert_eq(low.get_width(), 64, "the low-res path composes at 64px")
	assert_true(low_us < 200000, "the 64x64 composite takes %.1f ms" % (low_us / 1000.0))

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
	assert_true(img.get_width() >= 64, "composed from loose types (%d px)" % img.get_width())
	var opaque := 0
	var u := img.get_width() / 64
	for y in 64:
		for x in 64:
			if img.get_pixel(x * u, y * u).a > 0.5:
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
	var acc := HairBuilder.accent_color(two_tone, Color.RED)
	assert_true(acc.r > 0.8 and acc.g > 0.7 and acc.b < 0.2, "the strand's own gold is used (%s)" % acc)
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

func test_only_hair_races_get_strand_hair() -> void:
	# HairManager.canUseHair: humans, saiyans and female majins wear the presets;
	# namekians / frost demons / bio androids never do, whatever hair_type says
	assert_true(RaceSkin.can_use_hair({"race": "human"}))
	assert_true(RaceSkin.can_use_hair({"race": "saiyan"}))
	assert_true(RaceSkin.can_use_hair({"race": "majin", "gender": "female"}))
	assert_true(not RaceSkin.can_use_hair({"race": "majin", "gender": "male"}))
	for race in ["namekian", "frostdemon", "bioandroid"]:
		assert_true(not RaceSkin.can_use_hair({"race": race}), "%s has no strand hair" % race)
	model = BedrockModel.new()
	add_node(model)
	model.load_geo("entity/races/human")
	RaceSkin.apply_to(model, {"race": "namekian", "hair_type": 0, "hair_color": "#80FF69"})
	var hair: MeshInstance3D = model.get_bone("head").get_node_or_null("Hair")
	assert_true(hair == null or not hair.visible, "a namekian gets no hair mesh")
	# the mod's own empty preset is the bald choice for a race that can have hair
	var empty := HairBuilder.empty_style_index()
	assert_true(not HairBuilder.has_hair(HairBuilder.style_id(empty)), "preset %d is empty" % empty)
	RaceSkin.apply_to(model, {"race": "saiyan", "hair_type": empty})
	hair = model.get_bone("head").get_node_or_null("Hair")
	assert_true(hair == null or not hair.visible, "the empty preset shows no hair")

func test_creator_options_come_from_the_texture_set() -> void:
	# the character creator builds its rows from these, mirroring DMZ's
	# RaceCharacterConfig (which also enumerates the files on disk)
	for race in ["human", "saiyan", "namekian", "majin", "frostdemon", "bioandroid"]:
		assert_true(RaceSkin.body_type_count(race, "male") >= 1, "%s has a body type" % race)
		assert_eq(RaceSkin.body_type_count(race, "male"), RaceSkin.body_types(race, "male").size())
		var layers := RaceSkin.body_color_layers(race, "male")
		assert_true(layers >= 1 and layers <= 3, "%s tints %d body colours" % [race, layers])
	assert_true(RaceSkin.eye_type_count("saiyan") >= 10, "saiyans have the full eye set (%d)" % RaceSkin.eye_type_count("saiyan"))
	assert_true(RaceSkin.eye_type_count("namekian") >= 3, "namekians have eyes too")
	assert_true(RaceSkin.nose_count("saiyan") >= 5 and RaceSkin.mouth_count("saiyan") >= 8,
		"noses %d mouths %d" % [RaceSkin.nose_count("saiyan"), RaceSkin.mouth_count("saiyan")])
	assert_true(RaceSkin.tattoo_count() >= 1, "tattoos exist")
	# the four files of an eye type and what tints each
	var el := RaceSkin.eye_layers()
	assert_eq(el.size(), 4, "four files per eye type")
	assert_eq(String(el[1]["tint"]), "eye1_color")
	assert_eq(String(el[2]["tint"]), "eye2_color")
	# body types never offer the same art twice (humans/saiyans have no _0 file)
	var bt := RaceSkin.body_types("saiyan", "male")
	var seen := {}
	for b in bt:
		var sig := str(RaceSkin._body_layers(RaceSkin.race_dir("saiyan"), "male", b))
		assert_true(not seen.has(sig), "body type %d is distinct" % b)
		seen[sig] = true

func test_compose_honours_both_creator_key_spellings() -> void:
	# DMZ's keys (body_color1..3 / eyes / eye_color2) and ours (skin_color..3 /
	# eye_type / eye2_color) must compose the same texture
	var dmz := {"race": "saiyan", "gender": "male", "body_type": 0, "eyes": 3,
		"body_color1": "#ffd3c9", "body_color2": "#572117", "body_color3": "#ffd3c9",
		"eye_color": "#2a63c8", "eye_color2": "#66ff00", "hair_color": "#221a14"}
	var ours := {"race": "saiyan", "gender": "male", "body_type": 0, "eye_type": 3,
		"skin_color": "#ffd3c9", "skin_color2": "#572117", "skin_color3": "#ffd3c9",
		"eye1_color": "#2a63c8", "eye2_color": "#66ff00", "hair_color": "#221a14"}
	assert_eq(RaceSkin.cache_key(dmz), RaceSkin.cache_key(ours), "same cache key")
	var a := RaceSkin.compose_image(dmz)
	var b := RaceSkin.compose_image(ours)
	assert_eq(a.get_data(), b.get_data(), "same pixels")
	# the second eye colour really is a second colour: changing it changes both
	# the cache key and the pixels
	var other := dmz.duplicate()
	other["eye_color2"] = "#ff0000"
	assert_ne(RaceSkin.cache_key(other), RaceSkin.cache_key(dmz), "eye_color2 is in the cache key")
	assert_ne(RaceSkin.compose_image(other).get_data(), a.get_data(), "eye_color2 tints a layer")

func test_every_skin_read_survives_an_exported_build() -> void:
	# In an exported build only the imported .ctex exists: FileAccess/
	# Image.load_from_file on a res:// PNG returns null there. Every texture read
	# in this subsystem has to go through ResourceLoader/load() first.
	var dirs := ["res://scripts/entity/RaceSkin.gd", "res://scripts/entity/HairBuilder.gd",
		"res://scripts/entity/BedrockModel.gd", "res://scripts/entity/BedrockAnimation.gd"]
	for path in dirs:
		var f := FileAccess.open(path, FileAccess.READ)
		assert_true(f != null, "read %s" % path)
		if f == null:
			continue
		var src := f.get_as_text()
		f.close()
		for line in src.split("\n"):
			var t := String(line).strip_edges()
			if t.begins_with("#") or t.begins_with("##"):
				continue
			if t.contains(".png") and t.contains("FileAccess.file_exists") and not t.contains("_res_exists"):
				assert_true(false, "%s reads a PNG with FileAccess: %s" % [path, t])
			if t.contains("Image.load_from_file") and not t.contains("editor"):
				# allowed only as the fallback after a ResourceLoader attempt
				assert_true(src.contains("ResourceLoader.exists"), "%s: load_from_file without a ResourceLoader path" % path)
	# and the composed texture is not empty for every race (the phone bug showed
	# as an invisible body)
	for race in ["human", "saiyan", "namekian", "majin", "frostdemon", "bioandroid"]:
		var img := RaceSkin.compose_image({"race": race, "gender": "male", "body_type": 0})
		var opaque := 0
		var step := maxi(2, img.get_width() / 32)
		for y in range(0, img.get_height(), step):
			for x in range(0, img.get_width(), step):
				if img.get_pixel(x, y).a > 0.5:
					opaque += 1
		assert_true(opaque > 40, "%s composes a visible body (%d opaque samples)" % [race, opaque])

func test_tattoo_zero_is_the_mods_own_none() -> void:
	# races.json defaults every race to `defaultTattooType: 0` and DMZ's
	# tattoo_0.png is fully transparent, so the creator can store 0 for "none";
	# a negative index (our older convention) skips the blend and must look the same
	var base := {"race": "saiyan", "gender": "male", "body_type": 0, "hair_color": "#221a14"}
	var none_neg := base.duplicate()
	none_neg["tattoo"] = -1
	var none_zero := base.duplicate()
	none_zero["tattoo"] = 0
	assert_eq(RaceSkin.compose_image(none_zero).get_data(), RaceSkin.compose_image(none_neg).get_data(),
		"tattoo 0 and tattoo -1 compose the same face")
	# and a real tattoo does change the texture
	var inked := base.duplicate()
	inked["tattoo"] = RaceSkin.tattoo_types()[RaceSkin.tattoo_count() - 1]
	assert_ne(RaceSkin.compose_image(inked).get_data(), RaceSkin.compose_image(none_zero).get_data(),
		"a real tattoo blends in")
	assert_ne(RaceSkin.cache_key(inked), RaceSkin.cache_key(none_zero), "and it is in the cache key")

func test_composition_is_hd_first() -> void:
	# the user's request: the DMZ-HD pack replaces the 64x64 set everywhere it exists
	assert_true(RaceSkin.hd, "HD composition is the default")
	for race in ["human", "saiyan"]:
		var img := RaceSkin.compose_image({"race": race, "gender": "male", "body_type": 0,
			"eye_type": 0, "hair_type": 0, "skin_color": "#ffd3c9", "hair_color": "#221a14"})
		assert_true(img.get_width() >= 512, "%s composes at HD (%d px)" % [race, img.get_width()])
		assert_eq(img.get_width(), mini(1024, RaceSkin.canvas_cap()), "canvas = the HD layer size, capped")
	# the HD layer really is the one being read
	var hd_layer := RaceSkin._load_image("races/humansaiyan/bodytype_male_1")
	assert_true(hd_layer != null and hd_layer.get_width() >= 512,
		"the body layer comes from entity/hd (%d px)" % (hd_layer.get_width() if hd_layer else 0))
	# a layer that only exists in low res is scaled up onto the HD canvas, so a
	# mixed set still composes (nothing is skipped and nothing shrinks the sheet)
	var mixed := RaceSkin.compose_image({"race": "bioandroid", "gender": "male", "body_type": 0})
	assert_true(mixed.get_width() >= 512, "bioandroid (partial HD set) still composes HD (%d)" % mixed.get_width())
	var opaque := 0
	var step := maxi(2, mixed.get_width() / 32)
	for y in range(0, mixed.get_height(), step):
		for x in range(0, mixed.get_width(), step):
			if mixed.get_pixel(x, y).a > 0.5:
				opaque += 1
	assert_true(opaque > 40, "and it has a visible body (%d samples)" % opaque)
	# opting out still works (tests and low-end devices)
	RaceSkin.hd = false
	RaceSkin.clear_cache()
	assert_eq(RaceSkin.compose_image({"race": "saiyan", "gender": "male"}).get_width(), 64)
	RaceSkin.hd = true
	RaceSkin.clear_cache()

func test_fixed_character_textures_resolve_to_the_hd_pack() -> void:
	# sagas / masters keep their own sheets, and those come from entity/hd/** when
	# the pack has them (BedrockModel.entity_texture -> Textures.entity_texture)
	var checked := 0
	for rel in ["sagas/saga_a16", "sagas/saga_a17", "master/master_dende", "master/master_cell"]:
		if not ResourceLoader.exists("res://assets/textures/entity/hd/%s.png" % rel):
			continue
		checked += 1
		var tex := BedrockModel.entity_texture(rel)
		assert_true(tex != null, "%s resolves" % rel)
		assert_true(tex.get_width() >= 512, "%s is the HD sheet (%d px)" % [rel, tex.get_width()])
		# an entity that opts out of the HD variant still gets the 64x64 original
		var plain := BedrockModel.entity_texture(rel, false)
		assert_true(plain != null and plain.get_width() <= 256, "%s opt-out is the DMZ sheet (%d px)" % [rel, plain.get_width()])
	assert_true(checked >= 2, "checked %d HD character sheets" % checked)
	# armour overlays prefer armor/hd/** too
	var hd_armor := 0
	for layer in ["a16", "saiyan_armor", "gi_goku"]:
		for i in range(1, 4):
			if ResourceLoader.exists("res://assets/textures/armor/hd/%s_layer%d.png" % [layer, i]):
				var t := RaceSkin._armor_texture(layer, i)
				assert_true(t != null and t.get_width() >= 512,
					"armour %s_layer%d is HD (%d px)" % [layer, i, t.get_width() if t else 0])
				hd_armor += 1
	print("      HD armour layers checked: %d" % hd_armor)
