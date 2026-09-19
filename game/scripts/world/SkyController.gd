class_name SkyController
extends Node
## Drives the procedural sky, sun/moon light, ambient, fog, glow and the full-screen post-process from planet
## data (planets.json `sky`), world time and weather. The World owns a WorldEnvironment + DirectionalLight3D,
## calls `bind(env, light)` once (optional: if not bound they are created as children) and then
## `apply(planet_def, time_ticks, weather, delta)` every frame. It then pushes daylight()/sun_color()/fog_color()/
## ambient_color() into chunk and water materials, or simply calls `apply_to_material(mat)`.
##
## Time: 0 = sunrise (sun rises in the east, +X), 6000 = noon, 12000 = sunset (west, -X), 18000 = midnight.
## Weather strings: "clear", "overcast", "rain", "snow", "thunder" force the Weather child; "auto" lets it cycle.

const SKY_SHADER := "res://shaders/sky.gdshader"
const POST_SCENE := "res://scenes/fx/PostProcess.tscn"
const CLOUDS_SCRIPT := "res://scripts/world/Clouds.gd"
const WEATHER_SCRIPT := "res://scripts/world/Weather.gd"
const ENV_TEX_DIR := "res://assets/textures/environment/"
const MAX_BODIES := 6
const ORBIT_TILT_DEG := 15.0
## planets.json `bodies[].kind` -> sky.gdshader body kind
## 0 shaded sphere (planet), 1 emissive disc + corona (sun/star), 2 additive sprite (galaxy),
## 3 grey shaded sphere (moon), 4 flat alpha sprite (marker, dragon ball)
## Dim blue ambient that a clear moonlit night never goes below (linear colour).
const MOON_AMBIENT := Color(0.42, 0.50, 0.85)

const BODY_KINDS := {
	"planet": 0, "star": 1, "sun": 1, "galaxy": 2, "moon": 3, "sprite": 4,
	"marker": 4, "dragon_ball": 4, "beacon": 4,
}
## planets.json uses DMZ+ sky sizes (9 = a sun disc, 40 = a distant world, 140 = the planet you orbit).
## They are converted to the tangent of the body's angular radius; 140 -> ~35 degrees across.
## Values <= 1.5 are taken as a direct tangent instead (that is what the built-in skies below use).
const BODY_SIZE_TO_TAN := 0.0022
## Draw order preference when a planet has more than MAX_BODIES entries (deep space has 23).
const BODY_PRIORITY := {0: 0, 3: 1, 2: 2, 1: 3, 4: 4}

## Baseline sky used when a planet has no `sky` block (DATA_SCHEMA planets.json).
## Two different floors:
##   `min_daylight` keeps the SKY DOME lit after sundown ("barely night" planets: Namek 0.55,
##                  heaven 0.8, the time chamber 1.0). 0 = a real night sky with stars.
##   `night_light`  is the floor of daylight(), the world lighting multiplier, so a moonlit night
##                  is dark blue instead of pitch black (the chunk/water shaders multiply sky
##                  light by daylight()).
const DEFAULT_SKY := {
	"type": "atmosphere", "day": "#7DAEFF", "horizon": "#CFE4FF", "night": "#050818", "sunset": "#FF8C3A",
	"fog": "#BFD6F5", "stars": 1500, "star_brightness": 0.6, "milky_way": 0.3, "clouds": true, "aurora": false,
	"sun_scale": 1.0, "moon": true, "bodies": [], "suns": 1, "min_daylight": 0.0, "night_light": 0.3, "sun_color": "#FFF1D6",
	"fog_density": 1.0, "cloud_coverage": 0.45, "cloud_tint": "#FFFFFF", "aurora_a": "#20FF70", "aurora_b": "#9030FF",
	"water": "#3F76E4", "milky_way_tilt": 62.0,
}

## Built-in per-planet looks. planets.json `sky` entries override these key by key.
const PLANET_SKIES := {
	"earth": {},
	"namek": {"day": "#63CFA9", "horizon": "#DDF7E8", "night": "#06160F", "sunset": "#FFC24A", "fog": "#C4ECD8",
		"stars": 1200, "milky_way": 0.2, "suns": 3, "moon": false, "min_daylight": 0.55, "sun_color": "#FFF7D0",
		"cloud_coverage": 0.35, "cloud_tint": "#F4FFF6", "water": "#3FCF9E"},
	"vegeta": {"day": "#C85A45", "horizon": "#F3B48F", "night": "#160407", "sunset": "#FF4E1F", "fog": "#D6957B",
		"stars": 2200, "milky_way": 0.45, "cloud_coverage": 0.3, "cloud_tint": "#FFD9C8", "sun_color": "#FFE0B0",
		"bodies": [{"texture": "vegeta", "scale": 0.36, "kind": "planet", "azimuth": 200.0, "elevation": 32.0}]},
	"yardrat": {"day": "#8E6FD6", "horizon": "#EAD8FF", "night": "#0A0518", "sunset": "#FF7AB0", "fog": "#D9C6F2",
		"stars": 1800, "milky_way": 0.5, "cloud_coverage": 0.4, "cloud_tint": "#F6E8FF",
		"bodies": [{"texture": "yardrat", "scale": 0.12, "kind": "moon", "azimuth": 120.0, "elevation": 40.0}]},
	"vampa": {"day": "#C4AC6E", "horizon": "#F2E4B4", "night": "#0D0B05", "sunset": "#FF9A3A", "fog": "#DACB9A",
		"stars": 2600, "milky_way": 0.6, "cloud_coverage": 0.2, "cloud_tint": "#F5E9C9", "fog_density": 1.4,
		"bodies": [{"texture": "vampa", "scale": 0.18, "kind": "planet", "azimuth": 300.0, "elevation": 25.0}]},
	"cereal": {"day": "#79BCE8", "horizon": "#E4F3FF", "night": "#050B1A", "sunset": "#FFA65C", "fog": "#CFE5F5",
		"stars": 1600, "milky_way": 0.35, "cloud_coverage": 0.5,
		"bodies": [{"texture": "cereal", "scale": 0.10, "kind": "moon", "azimuth": 60.0, "elevation": 50.0}]},
	"hell_planet": {"day": "#6E1B14", "horizon": "#C24A2C", "night": "#180303", "sunset": "#FF3A1A", "fog": "#8F2C1B",
		"stars": 300, "star_brightness": 0.3, "milky_way": 0.0, "min_daylight": 0.5, "fog_density": 2.2,
		"cloud_coverage": 0.7, "cloud_tint": "#B04A38", "sun_color": "#FF8A5A", "moon": false, "water": "#8A2A1A"},
	"heaven": {"day": "#A9C8FF", "horizon": "#FFE3F1", "night": "#1A1030", "sunset": "#FFB6D9", "fog": "#E8E2FF",
		"stars": 900, "milky_way": 0.4, "aurora": true, "min_daylight": 0.8, "cloud_coverage": 0.65,
		"cloud_tint": "#FFF4FA", "aurora_a": "#7FE9FF", "aurora_b": "#FF9AE0", "sun_color": "#FFF8EA"},
	"otherworld": {"day": "#E9C85A", "horizon": "#FFF3B0", "night": "#2A1E05", "sunset": "#FF9A40", "fog": "#F2E2A0",
		"stars": 400, "milky_way": 0.1, "min_daylight": 0.75, "cloud_coverage": 0.55, "cloud_tint": "#FFE6F0", "moon": false},
	"sacred_kai_planet": {"day": "#B27ADF", "horizon": "#FFDBF6", "night": "#150726", "sunset": "#FF80C0", "fog": "#E3C8F2",
		"stars": 1000, "milky_way": 0.35, "aurora": true, "min_daylight": 0.8, "aurora_a": "#FFD070", "aurora_b": "#C060FF",
		"bodies": [{"texture": "sacred_kai_planet", "scale": 0.14, "kind": "moon", "azimuth": 250.0, "elevation": 35.0}]},
	"time_chamber": {"day": "#FFFFFF", "horizon": "#FFFFFF", "night": "#FFFFFF", "sunset": "#FFFFFF", "fog": "#FFFFFF",
		"stars": 0, "milky_way": 0.0, "clouds": false, "sun_scale": 0.0, "moon": false, "min_daylight": 1.0, "fog_density": 2.5},
	"universe_7_deep_space": {"type": "space", "day": "#000000", "horizon": "#000000", "night": "#000000", "sunset": "#000000",
		"fog": "#000000", "stars": 9000, "star_brightness": 1.0, "milky_way": 1.0, "clouds": false, "moon": false,
		"sun_scale": 0.55, "fog_density": 0.0, "bodies": [
			{"texture": "galaxy", "scale": 0.55, "kind": "galaxy", "azimuth": 40.0, "elevation": 35.0},
			{"texture": "earth", "scale": 0.16, "kind": "planet", "azimuth": 150.0, "elevation": 10.0},
			{"texture": "namek", "scale": 0.09, "kind": "planet", "azimuth": 250.0, "elevation": 20.0},
			{"texture": "vegeta", "scale": 0.07, "kind": "planet", "azimuth": 320.0, "elevation": -5.0},
			{"texture": "sun_surface", "scale": 0.05, "kind": "star", "azimuth": 100.0, "elevation": 55.0}]},
}

var environment: Environment
var world_environment: WorldEnvironment
var sun_light: DirectionalLight3D
var sky_material: ShaderMaterial
var post_process: CanvasLayer
var post_material: ShaderMaterial
var clouds: Node3D
var weather_node: Node3D

var planet_id := ""
var sky_def: Dictionary = {}
var time_ticks := 0.0
var day_index := 0                      ## drives the moon phase (one cycle per 8 days)
var camera_underwater := false          ## the World/Player sets this when the camera is submerged
var enable_post_process := true
## Push daylight/sun/fog/sky uniforms into the World's chunk materials every frame. The World also
## sets the seven shared uniforms itself; this adds the sky-colour ones the water shader needs for
## its reflections, so no change is required on the voxel side.
var auto_push_world_materials := true
var enable_clouds := true
var enable_weather := true

var _params: Dictionary = {}
var _sun_dir := Vector3(0, 1, 0)
var _moon_dir := Vector3(0, -1, 0)
var _daylight := 1.0
var _sun_color := Color(1, 0.95, 0.85)
var _fog_color := Color(0.75, 0.84, 0.96)
var _ambient_color := Color(0.5, 0.6, 0.8)
var _fog_start := 40.0
var _fog_end := 80.0
var _weather_darkness := 0.0
var _weather_kind := "clear"
var _cloud_coverage := 0.45
var _flash := 0.0
var _time := 0.0
var _bodies_loaded_for := ""
var _colors: Dictionary = {}
var _quality := 2
var _settings_dirty := true

func _ready() -> void:
	if not Events.settings_changed.is_connected(_on_settings_changed):
		Events.settings_changed.connect(_on_settings_changed)

func _on_settings_changed() -> void:
	_settings_dirty = true

## Give the controller the World's environment and sun. Safe to call before or after apply().
func bind(env: WorldEnvironment, light: DirectionalLight3D) -> void:
	world_environment = env
	sun_light = light
	_ensure_nodes()

func _ensure_nodes() -> void:
	if world_environment == null:
		var parent := get_parent()
		if parent != null:
			for c in parent.get_children():
				if c is WorldEnvironment and world_environment == null:
					world_environment = c
				elif c is DirectionalLight3D and sun_light == null:
					sun_light = c
	if world_environment == null:
		world_environment = WorldEnvironment.new()
		world_environment.name = "SkyEnvironment"
		add_child(world_environment)
	if world_environment.environment == null:
		world_environment.environment = Environment.new()
	environment = world_environment.environment
	if sun_light == null:
		sun_light = DirectionalLight3D.new()
		sun_light.name = "Sun"
		add_child(sun_light)
	if sky_material == null:
		sky_material = ShaderMaterial.new()
		if ResourceLoader.exists(SKY_SHADER):
			sky_material.shader = load(SKY_SHADER)
		var sky := Sky.new()
		sky.sky_material = sky_material
		sky.radiance_size = Sky.RADIANCE_SIZE_64
		sky.process_mode = Sky.PROCESS_MODE_REALTIME
		environment.sky = sky
		environment.background_mode = Environment.BG_SKY
		environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		environment.reflected_light_source = Environment.REFLECTION_SOURCE_DISABLED
		environment.fog_enabled = true
		environment.fog_mode = Environment.FOG_MODE_DEPTH
		environment.fog_sky_affect = 0.0
		environment.fog_depth_curve = 1.0
		environment.glow_normalized = false
		# glow_levels/N are indexed properties (1..7), not an array.
		environment.set("glow_levels/1", 0.0)
		environment.set("glow_levels/2", 0.0)
		environment.set("glow_levels/3", 0.8)
		environment.set("glow_levels/4", 1.0)
		environment.set("glow_levels/5", 1.0)
		environment.set("glow_levels/6", 0.5)
		environment.set("glow_levels/7", 0.0)
		environment.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
		environment.glow_hdr_threshold = 0.95
		environment.glow_hdr_scale = 1.6
		environment.glow_bloom = 0.04
		environment.glow_intensity = 0.4
		environment.glow_strength = 1.0
	_apply_settings()

func _apply_settings() -> void:
	_settings_dirty = false
	var s: Dictionary = Game.settings if Game != null else {}
	var preset := String(s.get("quality_preset", "balanced"))
	_quality = 0 if preset == "low" else (1 if preset == "balanced" else 2)
	var want_post := enable_post_process and preset != "low"
	if want_post and post_process == null and ResourceLoader.exists(POST_SCENE):
		var packed: PackedScene = load(POST_SCENE)
		post_process = packed.instantiate()
		add_child(post_process)
		var rect := post_process.get_node_or_null("Rect")
		if rect != null and rect.material is ShaderMaterial:
			post_material = rect.material
	if post_process != null:
		post_process.visible = want_post
	if environment != null:
		environment.glow_enabled = bool(s.get("bloom", true)) and preset != "low"
		environment.tonemap_mode = Environment.TONE_MAPPER_LINEAR if want_post else Environment.TONE_MAPPER_ACES
	if sun_light != null:
		sun_light.shadow_enabled = bool(s.get("shadows", false))
	var want_clouds := enable_clouds and bool(s.get("clouds", true))
	if want_clouds and clouds == null and ResourceLoader.exists(CLOUDS_SCRIPT):
		var script: GDScript = load(CLOUDS_SCRIPT)
		clouds = script.new()
		clouds.name = "Clouds"
		add_child(clouds)
	if clouds != null:
		clouds.visible = want_clouds and bool(sky_def.get("clouds", true))
	if enable_weather and weather_node == null and ResourceLoader.exists(WEATHER_SCRIPT):
		var wscript: GDScript = load(WEATHER_SCRIPT)
		weather_node = wscript.new()
		weather_node.name = "Weather"
		add_child(weather_node)
	if sky_material != null:
		sky_material.set_shader_parameter("quality", _quality)
		_params["quality"] = _quality

# --- static helpers (also used by tests) --------------------------------------------------------

## Direction TO the sun for a world time (ticks in [0, 24000)).
static func sun_dir_for_ticks(ticks: float) -> Vector3:
	var a := fmod(ticks, WorldConst.TICKS_PER_DAY) / WorldConst.TICKS_PER_DAY * TAU
	var tilt := deg_to_rad(ORBIT_TILT_DEG)
	return Vector3(cos(a), sin(a) * cos(tilt), -sin(a) * sin(tilt)).normalized()

static func daylight_for_sun(sun_y: float, min_daylight := 0.0) -> float:
	return maxf(smoothstep(-0.10, 0.20, sun_y), min_daylight)

static func daylight_for_ticks(ticks: float, min_daylight := 0.0) -> float:
	return daylight_for_sun(sun_dir_for_ticks(ticks).y, min_daylight)

static func hex(v: Variant, fallback: Color) -> Color:
	if v is Color:
		return v
	if v is String and Color.html_is_valid(v):
		return Color.html(v)
	return fallback

## Merged sky block for a planet: DEFAULT_SKY <- built-in look <- planets.json `sky`.
static func sky_for_planet(id: String, planet_def: Dictionary) -> Dictionary:
	var out: Dictionary = DEFAULT_SKY.duplicate(true)
	if PLANET_SKIES.has(id):
		for k in PLANET_SKIES[id].keys():
			out[k] = PLANET_SKIES[id][k]
	var custom: Dictionary = planet_def.get("sky", {})
	for k in custom.keys():
		out[k] = custom[k]
	if out.get("type", "atmosphere") == "space":
		out["clouds"] = false
	return out

static func dusk_for_sun(sun_y: float) -> float:
	return (1.0 - smoothstep(0.06, 0.42, sun_y)) * smoothstep(-0.22, -0.03, sun_y)

## GDScript mirror of sky_color() in shaders/lib/sky_common.gdshaderinc (linear colours in, linear out).
static func eval_sky_color(dir: Vector3, sun_dir: Vector3, day_col: Color, horizon_col: Color, night_col: Color, sunset_col: Color, weather: float, min_day := 0.0) -> Color:
	var up := dir.y
	var upc := clampf(up, 0.0, 1.0)
	var day := maxf(smoothstep(-0.10, 0.20, sun_dir.y), min_day)
	var dusk := dusk_for_sun(sun_dir.y)
	var mu := dir.dot(sun_dir)
	var mu_pos := maxf(mu, 0.0)
	var toward := mu * 0.5 + 0.5
	var mid_w := pow(1.0 - upc, 1.7)
	var band_w := pow(1.0 - upc, 6.0)
	var sky := day_col.lerp(horizon_col, clampf(mid_w * 0.55 + band_w * 0.5, 0.0, 1.0))
	sky *= 1.0 + 0.18 * mid_w * (toward * toward * 2.0 - 0.5)
	var deep := Color(0.62, 0.52, 0.72)
	var dk := dusk * (1.0 - mid_w) * 0.8
	sky = sky * Color(1, 1, 1).lerp(deep, dk)
	var sunset_w := clampf(dusk * pow(1.0 - absf(up), 2.2) * (0.25 + 0.75 * toward * toward), 0.0, 1.0)
	var sunset_glow := sunset_col * (1.0 + 0.6 * pow(mu_pos, 4.0))
	sky = sky.lerp(sunset_glow, sunset_w)
	var night := night_col * (1.0 + 1.4 * mid_w + 0.6 * band_w)
	var col := night.lerp(sky, day)
	var g := 0.72
	var g2 := g * g
	var d := 1.0 + g2 - 2.0 * g * mu
	var phase := ((1.0 - g2) / pow(maxf(d, 0.0001), 1.5)) * ((1.0 - g) * (1.0 - g) / (1.0 + g2 - 2.0 * g))
	var lobe := phase * 0.045 + pow(mu_pos, 48.0) * 0.30
	var glow_col := Color(1.0, 0.92, 0.78).lerp(sunset_col * 1.6, dusk)
	col += glow_col * (lobe * (0.6 + 1.6 * dusk) * day * smoothstep(-0.55, -0.15, up))
	var ground := smoothstep(0.02, -0.25, up)
	col = col.lerp(col * Color(0.55, 0.58, 0.64), ground)
	var lum := col.r * 0.30 + col.g * 0.59 + col.b * 0.11
	col = col.lerp(Color(lum * 0.90, lum * 0.95, lum * 1.05), weather * 0.75)
	col *= 1.0 - 0.6 * weather
	col.a = 1.0
	return col

# --- per-frame ---------------------------------------------------------------------------------

## Main entry point. `weather` is the World's weather string ("auto" lets the Weather node cycle by itself).
func apply(planet_def: Dictionary, ticks: float, weather: String, delta := 0.016) -> void:
	_ensure_nodes()
	if _settings_dirty:
		_apply_settings()
	var id := String(planet_def.get("id", planet_id if planet_id != "" else "earth"))
	if id != planet_id or sky_def.is_empty():
		_set_planet(id, planet_def)
	time_ticks = fmod(ticks, WorldConst.TICKS_PER_DAY)
	_time = fmod(_time + delta, 86400.0)
	_update_weather(weather, delta)
	_update_sun()
	_update_colors()
	_update_environment()
	_update_light()
	_update_sky_uniforms()
	_update_clouds()
	_update_post_process()
	if auto_push_world_materials:
		_push_world_materials()

## Feed every chunk/water material the World exposes (ChunkManager.materials()).
func _push_world_materials() -> void:
	var w: Node = Game.world if Game != null else null
	if w == null or not is_instance_valid(w):
		return
	if not ("manager" in w):
		return
	var mgr: Variant = w.get("manager")
	if mgr == null or not (mgr is Object) or not mgr.has_method("materials"):
		return
	var mats: Variant = mgr.call("materials")
	if not (mats is Array):
		return
	for m in mats:
		if m is ShaderMaterial:
			apply_to_material(m)

func _set_planet(id: String, planet_def: Dictionary) -> void:
	planet_id = id
	sky_def = sky_for_planet(id, planet_def)
	_colors = {
		"day": hex(sky_def.get("day"), Color.html("#7DAEFF")).srgb_to_linear(),
		"horizon": hex(sky_def.get("horizon"), Color.html("#CFE4FF")).srgb_to_linear(),
		"night": hex(sky_def.get("night"), Color.html("#050818")).srgb_to_linear(),
		"sunset": hex(sky_def.get("sunset"), Color.html("#FF8C3A")).srgb_to_linear(),
		"fog": hex(sky_def.get("fog"), Color.html("#BFD6F5")).srgb_to_linear(),
		"sun": hex(sky_def.get("sun_color"), Color.html("#FFF1D6")).srgb_to_linear(),
		"cloud": hex(sky_def.get("cloud_tint"), Color.WHITE).srgb_to_linear(),
		"aurora_a": hex(sky_def.get("aurora_a"), Color.html("#20FF70")).srgb_to_linear(),
		"aurora_b": hex(sky_def.get("aurora_b"), Color.html("#9030FF")).srgb_to_linear(),
		"water": hex(sky_def.get("water"), Color.html("#3F76E4")).srgb_to_linear(),
	}
	var space := String(sky_def.get("type", "atmosphere")) == "space"
	_set_param("atmosphere", 0.0 if space else 1.0)
	_set_param("day_color", _colors["day"])
	_set_param("horizon_color", _colors["horizon"])
	_set_param("night_color", _colors["night"])
	_set_param("sunset_color", _colors["sunset"])
	_set_param("sun_scale", float(sky_def.get("sun_scale", 1.0)))
	_set_param("suns", int(sky_def.get("suns", 1)))
	_set_param("moon_enabled", 1.0 if bool(sky_def.get("moon", true)) else 0.0)
	# `stars` is a star count; the shader wants the probability that one of its ~34000 sky cells
	# holds a star. x4 over the physical value because a game night sky should read as dense.
	_set_param("star_density", clampf(float(sky_def.get("stars", 1500)) / 9000.0, 0.0, 0.6))
	_set_param("star_brightness", float(sky_def.get("star_brightness", 0.6)))
	_set_param("milky_way_strength", float(sky_def.get("milky_way", 0.3)))
	_set_param("aurora_strength", 1.0 if bool(sky_def.get("aurora", false)) else 0.0)
	_set_param("aurora_color_a", _colors["aurora_a"])
	_set_param("aurora_color_b", _colors["aurora_b"])
	var mw := ENV_TEX_DIR + "milky_way.png"
	if ResourceLoader.exists(mw):
		_set_param("milky_way_tex", load(mw))
	_load_bodies()
	if clouds != null:
		clouds.visible = enable_clouds and bool(sky_def.get("clouds", true)) and bool(Game.settings.get("clouds", true))
	_cloud_coverage = float(sky_def.get("cloud_coverage", 0.45))
	if weather_node != null and weather_node.has_method("set_base_coverage"):
		weather_node.set_base_coverage(_cloud_coverage)

## Pick at most MAX_BODIES bodies: drop duplicate textures, planets/moons first, then galaxies,
## suns and flat markers (planets.json lists every world of the universe for deep space).
static func select_bodies(bodies: Array) -> Array:
	var seen: Dictionary = {}
	var picked: Array = []
	for b in bodies:
		if not (b is Dictionary):
			continue
		var key := String(b.get("texture", ""))
		if key != "" and seen.has(key):
			continue
		seen[key] = true
		picked.append(b)
	picked.sort_custom(func(a: Dictionary, c: Dictionary) -> bool:
		var ka: Variant = a.get("kind", 0)
		var kc: Variant = c.get("kind", 0)
		var ia: int = int(BODY_KINDS.get(ka, 0)) if ka is String else int(ka)
		var ic: int = int(BODY_KINDS.get(kc, 0)) if kc is String else int(kc)
		var pa: int = int(BODY_PRIORITY.get(ia, 5))
		var pc: int = int(BODY_PRIORITY.get(ic, 5))
		if pa != pc:
			return pa < pc
		return float(a.get("scale", 0.1)) > float(c.get("scale", 0.1)))
	if picked.size() > MAX_BODIES:
		# keep one sun/star in the mix (deep space lists a dozen planets before its suns)
		var has_star := false
		for i in MAX_BODIES:
			var k: Variant = picked[i].get("kind", 0)
			if (int(BODY_KINDS.get(k, 0)) if k is String else int(k)) == 1:
				has_star = true
		if not has_star:
			for b in picked:
				var k2: Variant = b.get("kind", 0)
				if (int(BODY_KINDS.get(k2, 0)) if k2 is String else int(k2)) == 1:
					picked[MAX_BODIES - 1] = b
					break
		picked.resize(MAX_BODIES)
	return picked

static func body_tan_scale(v: float) -> float:
	var tan_r: float = v if v <= 1.5 else v * BODY_SIZE_TO_TAN
	return clampf(tan_r, 0.008, 1.2)

func _load_bodies() -> void:
	var bodies: Array = select_bodies(sky_def.get("bodies", []))
	var n := bodies.size()
	_set_param("body_count", n)
	for i in n:
		var b: Dictionary = bodies[i]
		var tex_name := String(b.get("texture", "earth")).trim_suffix(".png")
		var path := ENV_TEX_DIR + tex_name + ".png"
		if ResourceLoader.exists(path):
			_set_param("body_tex_%d" % i, load(path))
		var dir: Vector3
		if b.has("dir"):
			var arr: Array = b["dir"]
			dir = Vector3(float(arr[0]), float(arr[1]), float(arr[2])).normalized()
		else:
			var az := deg_to_rad(float(b.get("azimuth", fmod(i * 137.5, 360.0))))
			var el := deg_to_rad(float(b.get("elevation", 12.0 + 9.0 * i)))
			dir = Vector3(cos(el) * cos(az), sin(el), cos(el) * sin(az)).normalized()
		_set_param("body_dir_%d" % i, dir)
		_set_param("body_scale_%d" % i, body_tan_scale(float(b.get("scale", 0.1))))
		var kind: Variant = b.get("kind", 0)
		_set_param("body_kind_%d" % i, int(BODY_KINDS.get(kind, 0)) if kind is String else int(kind))

func _update_weather(weather: String, delta: float) -> void:
	var kind := weather
	var coverage := _cloud_coverage
	var darkness := 0.0
	_flash = 0.0
	if weather_node != null and weather_node.has_method("update"):
		if weather != "" and weather != "auto" and weather_node.get("kind") != weather:
			weather_node.call("set_weather", weather)
		var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
		var cam_pos: Vector3 = cam.global_position if cam != null else Vector3.ZERO
		weather_node.call("update", delta, cam_pos, sky_def, _sun_color, _daylight)
		kind = String(weather_node.get("kind"))
		coverage = float(weather_node.call("coverage"))
		darkness = float(weather_node.call("darkness"))
		_flash = float(weather_node.get("flash"))
	else:
		match weather:
			"overcast": coverage = 0.75; darkness = 0.25
			"rain": coverage = 0.9; darkness = 0.55
			"snow": coverage = 0.85; darkness = 0.4
			"thunder": coverage = 0.95; darkness = 0.75
			_: kind = "clear"
	_weather_kind = kind
	_cloud_coverage = coverage
	_weather_darkness = clampf(darkness - _flash * 0.6, 0.0, 1.0)

func _update_sun() -> void:
	_sun_dir = sun_dir_for_ticks(time_ticks)
	_moon_dir = -_sun_dir
	_daylight = maxf(daylight_for_sun(_sun_dir.y, float(sky_def.get("min_daylight", 0.0))),
			float(sky_def.get("night_light", 0.0)))
	# an overcast sky dims the world itself, not just the sky dome
	_daylight *= 1.0 - 0.4 * _weather_darkness
	if String(sky_def.get("type", "atmosphere")) == "space":
		_daylight = 0.15

func _update_colors() -> void:
	var sun_y := _sun_dir.y
	var base_sun: Color = _colors["sun"]
	var low := smoothstep(0.35, -0.05, sun_y)
	var sun := base_sun.lerp(Color(1.0, 0.5, 0.2), low * 0.85)
	var moon := Color(0.42, 0.52, 0.85)
	var night_blend := smoothstep(0.0, -0.12, sun_y)
	if float(sky_def.get("min_daylight", 0.0)) > 0.4:
		night_blend *= 0.3
	sun = sun.lerp(moon, night_blend)
	sun = sun.lerp(Color(sun.get_luminance(), sun.get_luminance(), sun.get_luminance() * 1.05), _weather_darkness * 0.7)
	_sun_color = sun
	_sun_color.a = 1.0
	var w := _weather_darkness
	var min_day := float(sky_def.get("min_daylight", 0.0))
	var zenith := eval_sky_color(Vector3.UP, _sun_dir, _colors["day"], _colors["horizon"], _colors["night"], _colors["sunset"], w, min_day)
	var horizon := _horizon_avg(w)
	var fog_tint: Color = _colors["fog"]
	_fog_color = horizon.lerp(horizon * (fog_tint / maxf(fog_tint.get_luminance(), 0.05)).clamp(Color(0, 0, 0), Color(1.6, 1.6, 1.6)), 0.22)
	_fog_color.a = 1.0
	var amb := zenith * 0.45 + horizon * 0.55
	amb = amb * (0.55 + 0.45 * _daylight) + Color(0.012, 0.014, 0.02)
	# Moonlight floor: the chunk/water shaders multiply sky light by daylight() and by the ambient
	# colour, so without a floor a clear night ends up pure black instead of moonlit blue.
	var moonlit := MOON_AMBIENT * (1.0 if bool(sky_def.get("moon", true)) else 0.55) * (1.0 - 0.6 * _weather_darkness)
	var night_amount := 1.0 - smoothstep(-0.02, 0.22, sun_y)
	amb = Color(maxf(amb.r, moonlit.r * night_amount), maxf(amb.g, moonlit.g * night_amount), maxf(amb.b, moonlit.b * night_amount))
	_ambient_color = amb
	_ambient_color.a = 1.0
	if camera_underwater:
		var water: Color = _colors["water"]
		_fog_color = water * (0.35 + 0.65 * _daylight)
		_fog_color.a = 1.0

func _horizon_avg(w: float) -> Color:
	var min_day := float(sky_def.get("min_daylight", 0.0))
	var flat := Vector3(_sun_dir.x, 0.0, _sun_dir.z)
	if flat.length() < 0.001:
		flat = Vector3.RIGHT
	flat = flat.normalized()
	var side := Vector3(-flat.z, 0.0, flat.x)
	var h := Vector3(0.0, 0.03, 0.0)
	var a := eval_sky_color((flat + h).normalized(), _sun_dir, _colors["day"], _colors["horizon"], _colors["night"], _colors["sunset"], w, min_day)
	var b := eval_sky_color((-flat + h).normalized(), _sun_dir, _colors["day"], _colors["horizon"], _colors["night"], _colors["sunset"], w, min_day)
	var c := eval_sky_color((side + h).normalized(), _sun_dir, _colors["day"], _colors["horizon"], _colors["night"], _colors["sunset"], w, min_day)
	return a * 0.35 + b * 0.25 + c * 0.4

func _update_environment() -> void:
	var render_distance := float(Game.settings.get("render_distance", 5))
	var view := maxf(render_distance * float(WorldConst.CHUNK) - 8.0, 32.0)
	var density := float(sky_def.get("fog_density", 1.0))
	if not bool(sky_def.get("has_fog", true)):
		density = 0.0
	var weather_mult := 1.0 - 0.45 * _weather_darkness
	if camera_underwater:
		_fog_start = 0.0
		_fog_end = 14.0 + 10.0 * _daylight
	elif density <= 0.0:
		_fog_start = view * 4.0
		_fog_end = view * 8.0
	else:
		_fog_end = view * weather_mult / density
		_fog_start = _fog_end * (0.55 - 0.25 * _weather_darkness)
	environment.fog_depth_begin = _fog_start
	environment.fog_depth_end = _fog_end
	environment.fog_light_color = _fog_color
	environment.fog_light_energy = 1.0
	environment.fog_density = 1.0
	environment.ambient_light_color = _ambient_color
	environment.ambient_light_energy = 1.0
	if post_process == null or not post_process.visible:
		environment.tonemap_exposure = 0.95 + 0.35 * (1.0 - _daylight)
	else:
		environment.tonemap_exposure = 1.0
	if environment.glow_enabled:
		environment.glow_intensity = 0.4 + 0.35 * (1.0 - _daylight) + (0.4 if camera_underwater else 0.0)

func _update_light() -> void:
	var sun_y := _sun_dir.y
	var sun_up := smoothstep(-0.10, -0.02, sun_y)
	var dir := _sun_dir if sun_up > 0.5 else _moon_dir
	if String(sky_def.get("type", "atmosphere")) == "space":
		dir = _sun_dir
	var up := Vector3.UP if absf(dir.y) < 0.98 else Vector3.FORWARD
	sun_light.global_transform = Transform3D(Basis.looking_at(-dir, up), Vector3.ZERO)
	var moon_energy := 0.12 * (1.0 - _weather_darkness * 0.7)
	var day_energy := 1.35 * _daylight * (1.0 - 0.55 * _weather_darkness)
	sun_light.light_energy = lerpf(moon_energy, day_energy, sun_up) + _flash * 1.5
	sun_light.light_color = _sun_color.lerp(Color.WHITE, _flash)
	sun_light.light_indirect_energy = 0.0

func _update_sky_uniforms() -> void:
	_set_param("sun_dir", _sun_dir)
	_set_param("moon_dir", _moon_dir)
	_set_param("sun_color", _colors["sun"])
	_set_param("weather_darkness", _weather_darkness)
	_set_param("min_daylight", float(sky_def.get("min_daylight", 0.0)))
	_set_param("time", _time)
	# the moon cycles over 8 in-game days; the World counts days in Game.world_info
	var day: int = day_index
	if Game != null and Game.world_info.has("day"):
		day = int(Game.world_info["day"])
	_set_param("moon_phase", fmod(float(day) / 8.0, 1.0))
	if int(sky_def.get("suns", 1)) >= 2:
		var yaw_b := Basis(Vector3.UP, deg_to_rad(30.0))
		var yaw_c := Basis(Vector3.UP, deg_to_rad(-27.0))
		var b := (yaw_b * _sun_dir + Vector3(0, 0.22, 0)).normalized()
		var c := (yaw_c * _sun_dir + Vector3(0, 0.10, 0)).normalized()
		_set_param("sun_dir_b", b)
		_set_param("sun_dir_c", c)
	var tilt := deg_to_rad(float(sky_def.get("milky_way_tilt", 62.0)))
	var spin := time_ticks / WorldConst.TICKS_PER_DAY * TAU + 1.3
	_set_param("milky_way_basis", Basis(Vector3.RIGHT, tilt) * Basis(Vector3.UP, spin))

func _update_clouds() -> void:
	if clouds == null or not clouds.visible:
		return
	if clouds.has_method("update_clouds"):
		var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
		clouds.call("update_clouds", cam, self, _cloud_coverage, _colors["cloud"])

func _update_post_process() -> void:
	if post_material == null or post_process == null or not post_process.visible:
		return
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	var sun_screen := Vector2(0.5, 0.5)
	var visible := 0.0
	if cam != null:
		var fwd := -cam.global_transform.basis.z
		var facing := fwd.dot(_sun_dir)
		if facing > 0.05:
			var p := cam.unproject_position(cam.global_position + _sun_dir * 100.0)
			var size := get_viewport().get_visible_rect().size
			sun_screen = p / size
			var margin := 0.35
			var inside := sun_screen.x > -margin and sun_screen.x < 1.0 + margin and sun_screen.y > -margin and sun_screen.y < 1.0 + margin
			visible = smoothstep(0.05, 0.25, facing) if inside else 0.0
	var sun_vis := visible * smoothstep(-0.05, 0.05, _sun_dir.y) * (1.0 - _weather_darkness)
	# Packed (shaders/post_process.gdshader): post_params x exposure, y time, z flash, w quality;
	# sun_params xyz sun colour, w god_rays; sun_screen_params xy screen uv, z visibility;
	# underwater_params xyz tint, w submerged.
	var exposure := (0.95 + 0.3 * (1.0 - _daylight)) * (0.85 if camera_underwater else 1.0)
	var rays := 0.45 * _daylight * (1.0 - _weather_darkness) if _quality >= 1 else 0.0
	var wtint: Color = _colors["water"]
	post_material.set_shader_parameter("post_params", Vector4(exposure, _time, _flash, float(_quality)))
	post_material.set_shader_parameter("sun_params", Vector4(_sun_color.r, _sun_color.g, _sun_color.b, rays))
	post_material.set_shader_parameter("sun_screen_params", Vector4(sun_screen.x, sun_screen.y, sun_vis, 0.0))
	post_material.set_shader_parameter("underwater_params",
		Vector4(wtint.r, wtint.g, wtint.b, 1.0 if camera_underwater else 0.0))

func _set_param(name: String, value: Variant) -> void:
	_params[name] = value
	if sky_material != null:
		sky_material.set_shader_parameter(name, value)

# --- public accessors --------------------------------------------------------------------------

func daylight() -> float:
	return _daylight

func sun_color() -> Color:
	return _sun_color

func fog_color() -> Color:
	return _fog_color

func ambient_color() -> Color:
	return _ambient_color

func sun_direction() -> Vector3:
	return _sun_dir

func moon_direction() -> Vector3:
	return _moon_dir

func fog_start() -> float:
	return _fog_start

func fog_end() -> float:
	return _fog_end

func weather_darkness() -> float:
	return _weather_darkness

func weather_kind() -> String:
	return _weather_kind

func cloud_coverage() -> float:
	return _cloud_coverage

func time_seconds() -> float:
	return _time

func water_color() -> Color:
	return _colors.get("water", Color.html("#3F76E4").srgb_to_linear())

## Last value uploaded to the sky shader (tests / debugging).
func sky_param(name: String) -> Variant:
	return _params.get(name)

## Push the shared lighting uniforms into any chunk / water / cloud ShaderMaterial.
##
## They travel PACKED: eight vec4s that every world shader declares with the same payload (see the
## contract at the top of shaders/chunk_opaque.gdshader / water.gdshader). A shader that does not
## need a slot - the chunk shaders take only the first four, the mobile variants fewer still -
## simply does not declare it, and the write is ignored. Unpacked, this was 19 uniforms per
## material, and a phone only guarantees 224 fragment uniform vectors for the whole program.
func apply_to_material(mat: ShaderMaterial) -> void:
	if mat == null:
		return
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	var near := cam.near if cam != null else 0.05
	var fancy := 1.0 if bool(Game.settings.get("fancy_water", true)) and _quality >= 1 else 0.0
	# quality 0..2, then the two flags above it, so one float carries all three (water reads it).
	var flags := float(_quality) + 4.0 * fancy + (8.0 if camera_underwater else 0.0)
	var day: Color = _colors.get("day", Color(0.2, 0.4, 1.0))
	var horizon: Color = _colors.get("horizon", Color(0.6, 0.75, 1.0))
	var night: Color = _colors.get("night", Color(0.002, 0.003, 0.012))
	var sunset: Color = _colors.get("sunset", Color(1.0, 0.26, 0.04))
	mat.set_shader_parameter("sun_params", Vector4(_sun_color.r, _sun_color.g, _sun_color.b, _daylight))
	mat.set_shader_parameter("fog_params", Vector4(_fog_color.r, _fog_color.g, _fog_color.b, _fog_start))
	mat.set_shader_parameter("ambient_params",
		Vector4(_ambient_color.r, _ambient_color.g, _ambient_color.b, _fog_end))
	mat.set_shader_parameter("sun_dir_params", Vector4(_sun_dir.x, _sun_dir.y, _sun_dir.z, _time))
	mat.set_shader_parameter("sky_horizon_params",
		Vector4(horizon.r, horizon.g, horizon.b, _weather_darkness))
	mat.set_shader_parameter("sky_night_params",
		Vector4(night.r, night.g, night.b, float(sky_def.get("min_daylight", 0.0))))
	mat.set_shader_parameter("sky_sunset_params", Vector4(sunset.r, sunset.g, sunset.b, flags))
	mat.set_shader_parameter("sky_day_params", Vector4(day.r, day.g, day.b, near))
