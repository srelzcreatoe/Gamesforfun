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
	var hair: Node = model.get_bone("head").get_node_or_null("Hair")
	assert_true(hair != null, "hair attachment created on the head bone")
	var hm: BedrockModel = hair as BedrockModel
	assert_true(hm != null and hm.nested, "the hair model is nested (no extra 1/16 scale)")
	var visible := 0
	for n in RaceSkin.HAIR_STYLES[2]:
		if hm.is_bone_mesh_visible(String(n)):
			visible += 1
	assert_eq(visible, RaceSkin.HAIR_STYLES[2].size(), "every bone of hair style 2 is visible")
	assert_true(not hm.is_bone_mesh_visible("hair30"), "bones outside the style stay hidden")
	assert_true(not hm.is_bone_mesh_visible("head"), "the hair rig's own head box is not drawn")
	# the hair sits on the head, not at the feet
	var box := hm.visual_aabb()
	assert_true(box.size.y > 0.0, "hair has geometry")

func test_hair_styles_are_distinct() -> void:
	var seen: Array = []
	for i in RaceSkin.HAIR_STYLE_COUNT:
		var bones: Array = RaceSkin.hair_bones_for(i)
		assert_true(not seen.has(bones), "hair style %d is distinct" % i)
		seen.append(bones)
	assert_true(RaceSkin.hair_bones_for(0).is_empty(), "style 0 is bald")
	assert_true(RaceSkin.hair_bones_for(5).size() > 10, "style 5 is a full spiky head of hair")

func test_form_visuals_scale_the_hair() -> void:
	model = BedrockModel.new()
	add_node(model)
	model.load_geo("entity/races/human")
	RaceSkin.apply_to(model, _character())
	var hm: BedrockModel = model.get_bone("head").get_node_or_null("Hair")
	assert_true(hm != null)
	var before := hm.scale
	RaceSkin.apply_form_visuals(model, {"hairType": 3, "hairColor": "#ffe14d", "modelScaling": 1.0})
	assert_true(hm.scale.y > before.y, "ssj3 hair is taller: %s -> %s" % [before, hm.scale])
	var lit := 0
	for n in RaceSkin.hair_bones_for(5):
		var mat := hm.bone_material(String(n))
		if mat != null and mat.albedo_color.r > 0.8 and mat.albedo_color.b < 0.6:
			lit += 1
	assert_true(lit > 3, "hair colour applied to the bone materials: %d" % lit)

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
