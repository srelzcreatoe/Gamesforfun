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

func test_hair_styles_are_distinct() -> void:
	var seen: Array = []
	for i in HairBuilder.style_count():
		var id := HairBuilder.style_id(i)
		assert_true(not seen.has(id), "style %d (%s) is distinct" % [i, id])
		seen.append(id)
	assert_eq(HairBuilder.style_id(0), "bald", "index 0 is bald")
	assert_eq(HairBuilder.style_mesh("bald"), null, "bald builds nothing")
	for id in seen:
		if id != "bald":
			assert_true(HairBuilder.style_mesh(String(id)) != null, "%s has geometry" % id)

func test_form_visuals_swap_the_hair_style() -> void:
	model = BedrockModel.new()
	add_node(model)
	model.load_geo("entity/races/human")
	RaceSkin.apply_to(model, _character())
	var before := HairBuilder.current_style(model)
	RaceSkin.apply_form_visuals(model, {"hairType": "ssj3", "hairColor": "#ffe14d", "modelScaling": 1.0})
	var after := HairBuilder.current_style(model)
	assert_ne(after, before, "the form swapped the hair style (%s -> %s)" % [before, after])
	assert_eq(after, HairBuilder.form_style_id(before, "ssj3"), "ssj3 hair")
	# ssj3 is the long mane: much more hair overall, even though the crown is not
	# the tallest of the styles
	assert_true(HairBuilder.style_extent(after).y > HairBuilder.style_extent(before).y * 1.6,
		"ssj3 hair is much bigger (%.1f vs %.1f)" % [HairBuilder.style_extent(after).y, HairBuilder.style_extent(before).y])
	var mat: StandardMaterial3D = HairBuilder.hair_material(model)
	assert_true(mat.albedo_color.r > 0.8 and mat.albedo_color.b < 0.6, "gold hair colour")

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

func test_hair_builder_styles_build_geometry() -> void:
	assert_true(HairBuilder.style_count() >= 8, "8 selectable styles: %d" % HairBuilder.style_count())
	for i in HairBuilder.style_count():
		var id := HairBuilder.style_id(i)
		assert_ne(id, "", "style %d has an id" % i)
		var mesh := HairBuilder.style_mesh(id)
		if id == "bald":
			assert_eq(mesh, null, "bald has no geometry")
			continue
		assert_true(mesh != null, "%s builds a mesh" % id)
		var aabb := mesh.get_aabb()
		# head-local model units: the skull is x[-4,4] y[0,8] z[-4,4]
		assert_true(aabb.position.y + aabb.size.y > 7.0, "%s sits on top of the skull (top %.1f)" % [id, aabb.position.y + aabb.size.y])
		# long styles fall down the back; anything past the knees is a runaway strand
		assert_true(aabb.position.y > -30.0, "%s does not run away downwards (bottom %.1f)" % [id, aabb.position.y])
		assert_true(aabb.size.x < 26.0 and aabb.size.z < 26.0, "%s stays near the head (%s)" % [id, aabb.size])
	# transformation hair is DERIVED from the character's own style: taller and
	# more upright, so every haircut keeps its identity when it goes Super Saiyan
	for base in ["spiky", "flame", "short", "bardock"]:
		var base_h := HairBuilder.style_height(base)
		for form in ["ssj", "ssj2"]:
			var sid := HairBuilder.form_style_id(base, form)
			assert_eq(sid, "%s@%s" % [base, form], "derived id")
			assert_true(HairBuilder.style_height(sid) > base_h * 1.15,
				"%s is clearly taller than %s (%.1f vs %.1f)" % [sid, base, HairBuilder.style_height(sid), base_h])
			assert_true(HairBuilder.style_color(sid, Color.BLACK).r > 0.8, "%s is gold" % sid)
	# "base" keeps the haircut, ssj3 swaps in the long mane, "empty" goes bald
	assert_eq(HairBuilder.form_style_id("flame", "base"), "flame")
	assert_eq(HairBuilder.form_style_id("flame", ""), "flame")
	assert_eq(HairBuilder.form_style_id("flame", "ssj3"), "long@ssj3")
	assert_eq(HairBuilder.form_style_id("flame", "empty"), "bald")
	assert_eq(HairBuilder.form_style_id("flame", 1), "flame@ssj", "legacy numeric hairType")
	assert_true(HairBuilder.hides_eyebrows("ssj3"), "ssj3 loses the eyebrows like in DMZ")

func test_hair_attaches_to_the_head_bone() -> void:
	model = BedrockModel.new()
	add_node(model)
	model.load_geo("entity/races/human")
	RaceSkin.apply_to(model, _character({"hair_type": 2, "hair_color": "#221a14"}))
	var head: Node3D = model.get_bone("head")
	var hair: MeshInstance3D = head.get_node_or_null("Hair")
	assert_true(hair != null and hair.mesh != null, "hair mesh on the head bone")
	assert_eq(HairBuilder.current_style(model), HairBuilder.style_id(2))
	var mat := HairBuilder.hair_material(model)
	assert_true(mat != null and mat.albedo_texture != null, "hair tile texture")
	# single surface styles keep using material_override, which is where
	# TransformationDirector's hair flicker looks for the colour
	assert_eq(mat, hair.material_override, "the flicker hook still finds the material")
	# near black hair is lifted so the baked facet shading stays visible in world
	var want := HairBuilder.hair_albedo(Color("#221a14"))
	assert_near(mat.albedo_color.r, want.r, 0.01, "hair colour on the material")
	assert_near(mat.albedo_color.h, Color("#221a14").h, 0.02, "hue is kept")
	assert_true(mat.vertex_color_use_as_albedo, "facet shading is used")
	# a form swaps the GEOMETRY and the colour without rebuilding the model
	var base_top := HairBuilder.style_height(HairBuilder.style_id(2))
	RaceSkin.apply_form_visuals(model, {"hairType": "ssj", "modelScaling": 1.0})
	assert_eq(HairBuilder.current_style(model), "spiky@ssj", "ssj hair after transforming")
	assert_true(HairBuilder.style_height("spiky@ssj") > base_top * 1.15, "and it is taller")
	var gold := HairBuilder.hair_material(model)
	assert_true(gold.albedo_color.r > 0.8 and gold.albedo_color.b < 0.5, "gold hair")
	# an explicit hairColor still wins, and dropping the form restores the haircut
	RaceSkin.set_form_hair(model, {"hairType": "ssj2", "hairColor": "#9EFE53"})
	assert_eq(HairBuilder.current_style(model), "spiky@ssj2")
	assert_true(HairBuilder.hair_material(model).albedo_color.g > 0.8, "form hair colour wins")
	RaceSkin.clear_form_hair(model)
	assert_eq(HairBuilder.current_style(model), "spiky", "base haircut restored")
	# entities are accepted too (TransformationDirector only has the entity)
	assert_true(RaceSkin.set_form_hair(null, {"hairType": "ssj"}) == null, "null safe")

func test_hair_mesh_is_shaded_and_framed() -> void:
	# every style bakes facet shading into vertex colours, so a near black hair
	# colour still reads as strands (and not as one flat block) under any light
	for id in HairBuilder.style_order():
		var mesh := HairBuilder.style_mesh(String(id))
		if mesh == null:
			continue                                  # bald
		var arrays: Array = mesh.surface_get_arrays(0)
		var cols: PackedColorArray = arrays[Mesh.ARRAY_COLOR]
		assert_true(cols.size() > 0, "%s has vertex colours" % id)
		var lo := 2.0
		var hi := 0.0
		for c in cols:
			lo = minf(lo, c.r)
			hi = maxf(hi, c.r)
		assert_true(hi - lo > 0.2, "%s shading spans %.2f..%.2f" % [id, lo, hi])
	# near black hair is lifted just enough for that shading to be visible
	var lifted := HairBuilder.hair_albedo(Color("#222629"))
	assert_true(lifted.v >= 0.29 and lifted.v < 0.45, "dark hair lifted to v=%.2f" % lifted.v)
	assert_eq(HairBuilder.hair_albedo(Color("#F5D03A")), Color("#F5D03A"), "bright hair is untouched")

func test_visual_aabb_includes_the_hair() -> void:
	model = BedrockModel.new()
	add_node(model)
	assert_true(model.load_geo("entity/races/human"))
	model.set_model_scale(1.0)
	RaceSkin.apply_to(model, {"race": "saiyan", "hair_type": 0, "hair_color": "#221a14"}, [])
	var bald := model.visual_aabb()
	RaceSkin.apply_to(model, {"race": "saiyan", "hair_type": 2, "hair_color": "#221a14"}, [])
	var spiky := model.visual_aabb()
	# the character preview frames the camera from this box, so the hair has to be in it
	assert_true(spiky.size.y > bald.size.y + 0.1,
		"spiky hair grows the framed box (%.2f -> %.2f)" % [bald.size.y, spiky.size.y])
	assert_true(spiky.size.y < 4.0, "and stays sane (%.2f)" % spiky.size.y)

func test_two_tone_hair_uses_two_surfaces() -> void:
	model = BedrockModel.new()
	add_node(model)
	model.load_geo("entity/races/human")
	var gotenks := HairBuilder.style_order().find("gotenks")
	assert_true(gotenks >= 0, "the two tone style is selectable")
	RaceSkin.apply_to(model, _character({"hair_type": gotenks, "hair_color": "#221a14"}))
	var hair: MeshInstance3D = model.get_bone("head").get_node_or_null("Hair")
	assert_true(hair != null and hair.mesh.get_surface_count() == 2, "hair + accent surfaces")
	var main := hair.get_surface_override_material(0) as StandardMaterial3D
	var accent := hair.get_surface_override_material(1) as StandardMaterial3D
	assert_true(main != null and accent != null, "a material per surface")
	assert_ne(main.albedo_color, accent.albedo_color, "the accent is a different colour")
	assert_true(accent.albedo_color.r > 0.8 and accent.albedo_color.b < 0.5, "gold accent")
	# and the single surface styles are untouched
	RaceSkin.apply_to(model, _character({"hair_type": 2, "hair_color": "#221a14"}))
	assert_eq(hair.mesh.get_surface_count(), 1, "back to one surface")
	assert_true(hair.material_override != null, "override restored for the flicker hook")

func test_scalp_shell_covers_the_skull() -> void:
	# the big spike styles wrap the top of the skull, so the hair is not a hat
	# floating above a bare head
	for id in ["spiky", "flame", "bardock", "broly", "gotenks"]:
		var mesh := HairBuilder.style_mesh(id)
		assert_true(mesh != null, "%s builds" % id)
		var box := mesh.get_aabb()
		assert_true(box.position.y < 7.0, "%s reaches down onto the skull (%.1f)" % [id, box.position.y])
		assert_true(box.size.x >= 8.0, "%s covers the width of the head (%.1f)" % [id, box.size.x])
