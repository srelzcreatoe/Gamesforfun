extends TestCase
## SkyController: sun/moon direction and daylight over a day, weather driven fog and per-planet
## sky overrides (shaders agent).

var _made: Array[Node] = []

func teardown() -> void:
	for n in _made:
		if is_instance_valid(n):
			n.get_parent().remove_child(n)
			n.queue_free()
	_made.clear()

func _make() -> SkyController:
	var sky := SkyController.new()
	sky.enable_post_process = false
	sky.enable_clouds = false
	sky.enable_weather = true
	add_node(sky)
	_made.append(sky)
	return sky

func _def(id: String) -> Dictionary:
	var d: Dictionary = Registry.planets.get(id, {})
	d = d.duplicate(true) if not d.is_empty() else {}
	d["id"] = id
	return d

# --- static maths (no nodes needed) ------------------------------------------------------------

func test_sun_rises_in_the_east() -> void:
	var d := SkyController.sun_dir_for_ticks(0.0)
	assert_near(d.x, 1.0, 0.02, "at tick 0 the sun sits in the east (+X)")
	assert_near(d.y, 0.0, 0.02, "and on the horizon")

func test_sun_is_up_at_noon() -> void:
	var d := SkyController.sun_dir_for_ticks(6000.0)
	assert_true(d.y > 0.9, "noon sun is overhead, got y=%f" % d.y)

func test_sun_sets_in_the_west() -> void:
	var d := SkyController.sun_dir_for_ticks(12000.0)
	assert_near(d.x, -1.0, 0.02, "at tick 12000 the sun sits in the west (-X)")
	assert_near(d.y, 0.0, 0.02)

func test_sun_is_down_at_midnight() -> void:
	var d := SkyController.sun_dir_for_ticks(18000.0)
	assert_true(d.y < -0.9, "midnight sun is below the world, got y=%f" % d.y)

func test_daylight_curve() -> void:
	assert_near(SkyController.daylight_for_ticks(6000.0), 1.0, 0.001, "full daylight at noon")
	assert_eq(SkyController.daylight_for_ticks(18000.0), 0.0, "raw daylight is 0 at midnight")
	assert_true(SkyController.daylight_for_ticks(0.0) > 0.2, "sunrise is already partly lit")
	assert_true(SkyController.daylight_for_ticks(13000.0) < 0.5, "just after sunset it is nearly dark")
	assert_eq(SkyController.daylight_for_sun(-1.0, 0.55), 0.55, "min_daylight is a floor")

func test_dusk_peaks_on_the_horizon() -> void:
	var on_horizon := SkyController.dusk_for_sun(0.0)
	assert_true(on_horizon > 0.8, "dusk peaks with the sun on the horizon, got %f" % on_horizon)
	assert_true(SkyController.dusk_for_sun(0.8) < 0.05, "no dusk tint at noon")
	assert_true(SkyController.dusk_for_sun(-0.5) < 0.05, "no dusk tint at night")

func test_sky_for_planet_merges_data_over_builtin() -> void:
	var merged := SkyController.sky_for_planet("namek", {"sky": {"day": "#112233"}})
	assert_eq(String(merged["day"]), "#112233", "planets.json wins over the built-in look")
	assert_eq(int(merged["suns"]), 3, "the built-in Namek look keeps its three suns")
	assert_true(merged.has("fog"), "unset keys fall back to DEFAULT_SKY")

func test_space_skies_have_no_clouds() -> void:
	var merged := SkyController.sky_for_planet("universe_7_deep_space", {})
	assert_eq(bool(merged["clouds"]), false)

func test_body_scale_mapping() -> void:
	assert_near(SkyController.body_tan_scale(140.0), 140.0 * SkyController.BODY_SIZE_TO_TAN, 0.001, "planets.json sizes are DMZ+ units")
	assert_true(SkyController.body_tan_scale(140.0) > SkyController.body_tan_scale(40.0), "bigger size = bigger disc")
	assert_near(SkyController.body_tan_scale(0.36), 0.36, 0.001, "small values are already tangents")

func test_body_selection_caps_and_prioritises() -> void:
	var bodies: Array = []
	for i in 10:
		bodies.append({"texture": "sun_surface", "scale": 100.0, "kind": "sun"})
	bodies.append({"texture": "earth", "scale": 40.0, "kind": "planet"})
	var picked := SkyController.select_bodies(bodies)
	assert_true(picked.size() <= SkyController.MAX_BODIES, "at most 6 bodies reach the shader")
	assert_eq(String(picked[0]["texture"]), "earth", "planets are drawn before suns")
	assert_eq(picked.size(), 2, "duplicate textures are dropped")

# --- live controller ---------------------------------------------------------------------------

func test_apply_sets_sun_and_light() -> void:
	var sky := _make()
	sky.apply(_def("earth"), 6000.0, "clear", 0.016)
	assert_true(sky.daylight() > 0.95, "noon on earth is full daylight")
	assert_true(sky.sun_direction().y > 0.9)
	assert_true(sky.moon_direction().y < -0.9, "the moon sits opposite the sun")
	assert_true(sky.sun_light != null and sky.sun_light.light_energy > 0.5, "the directional light follows the sun")
	# a DirectionalLight3D shines along its -Z, so +Z must point at the sun
	assert_near(sky.sun_direction().dot(sky.sun_light.global_transform.basis.z), 1.0, 0.02,
			"the light shines from the sun toward the world")
	assert_true(sky.sky_param("sun_dir") != null, "sky uniforms are uploaded")

func test_night_is_dark_but_not_black() -> void:
	var sky := _make()
	sky.apply(_def("earth"), 18000.0, "clear", 0.016)
	var day := sky.daylight()
	assert_true(day > 0.05 and day < 0.45, "moonlit night keeps a little light, got %f" % day)
	assert_true(sky.ambient_color().get_luminance() > 0.05, "ambient never collapses to black")
	assert_true(sky.sun_color().b > sky.sun_color().r, "night light is blue (moonlight)")

func test_sunset_light_turns_warm() -> void:
	var sky := _make()
	sky.apply(_def("earth"), 6000.0, "clear", 0.016)
	var noon := sky.sun_color()
	sky.apply(_def("earth"), 11800.0, "clear", 0.016)
	var dusk := sky.sun_color()
	assert_true(dusk.r / maxf(dusk.b, 0.001) > noon.r / maxf(noon.b, 0.001), "sunset light is redder than noon")

func test_fog_follows_the_weather() -> void:
	var sky := _make()
	sky.apply(_def("earth"), 6000.0, "clear", 0.016)
	var clear_fog := sky.fog_color()
	var clear_end := sky.fog_end()
	for i in 40:
		sky.apply(_def("earth"), 6000.0, "thunder", 0.5)
	var storm_fog := sky.fog_color()
	assert_eq(sky.weather_kind(), "thunder", "the forced weather reaches the Weather node")
	assert_true(sky.weather_darkness() > 0.3, "a thunderstorm darkens the sky, got %f" % sky.weather_darkness())
	assert_true(storm_fog.get_luminance() < clear_fog.get_luminance(), "storm fog is darker than clear fog")
	assert_true(sky.fog_end() < clear_end, "fog closes in during a storm")
	assert_true(sky.cloud_coverage() > 0.8, "storm clouds cover the sky")

func test_planet_overrides_are_applied() -> void:
	var sky := _make()
	sky.apply(_def("namek"), 18000.0, "clear", 0.016)
	assert_eq(int(sky.sky_param("suns")), 3, "Namek has three suns")
	assert_true(sky.daylight() >= 0.55, "Namek is barely dark at night, got %f" % sky.daylight())
	assert_eq(float(sky.sky_param("moon_enabled")), 0.0, "Namek has no moon")
	sky.apply(_def("time_chamber"), 6000.0, "clear", 0.016)
	assert_eq(float(sky.sky_param("sun_scale")), 0.0, "the time chamber has no sun disc")
	sky.apply(_def("vegeta"), 6000.0, "clear", 0.016)
	assert_true(int(sky.sky_param("body_count")) >= 1, "Vegeta shows at least one celestial body")
	assert_true(float(sky.sky_param("body_scale_0")) > 0.3, "and it is a big one")

func test_deep_space_has_no_atmosphere_and_many_stars() -> void:
	var sky := _make()
	sky.apply(_def("universe_7_deep_space"), 6000.0, "clear", 0.016)
	assert_eq(float(sky.sky_param("atmosphere")), 0.0, "deep space is airless")
	assert_true(float(sky.sky_param("star_density")) > 0.05, "deep space is full of stars")
	assert_true(sky.fog_end() > 200.0, "no distance fog in space")
	assert_true(int(sky.sky_param("body_count")) > 1, "several planets are visible from orbit")

func test_apply_to_material_fills_the_chunk_contract() -> void:
	var sky := _make()
	sky.apply(_def("earth"), 6000.0, "clear", 0.016)
	var mat := ShaderMaterial.new()
	if ResourceLoader.exists("res://shaders/water.gdshader"):
		mat.shader = load("res://shaders/water.gdshader")
	sky.apply_to_material(mat)
	for name in ["daylight", "sun_color", "fog_color", "fog_start", "fog_end", "time", "ambient_color",
			"sun_dir", "day_color", "horizon_color", "night_color", "sunset_color", "weather_darkness"]:
		assert_true(mat.get_shader_parameter(name) != null, "material uniform " + name + " must be set")

func test_underwater_fog_turns_to_water_colour() -> void:
	var sky := _make()
	sky.apply(_def("earth"), 6000.0, "clear", 0.016)
	var dry := sky.fog_end()
	sky.camera_underwater = true
	sky.apply(_def("earth"), 6000.0, "clear", 0.016)
	assert_true(sky.fog_end() < dry * 0.5, "vision is short underwater")
	assert_true(sky.fog_color().b > sky.fog_color().r, "underwater fog takes the water colour")
