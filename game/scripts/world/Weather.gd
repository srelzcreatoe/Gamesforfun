class_name Weather
extends Node3D
## Weather state machine plus the rain/snow sheets around the camera.
##
## SkyController creates this node and calls
## `update(delta, camera_pos, sky_def, sun_color, daylight)` every frame; it then reads
## `kind`, `coverage()`, `darkness()` and `flash` to drive clouds, fog and the sky shader.
## Cycle: clear -> overcast -> rain|snow (snow when the local biome is cold) -> thunder -> clear.
## `set_weather(kind)` forces a state (the World passes its `weather` string through).

const WEATHER_SHADER := "res://shaders/weather.gdshader"
const WEATHER_TEX := "res://assets/textures/environment/weather.png"
const KINDS := ["clear", "overcast", "rain", "snow", "thunder"]

## Sprite regions inside weather.png (x, y, w, h in uv). Rain samples the streak rows; the snow
## rect is kept for reference only - weather.gdshader draws procedural flakes for snow.
const RAIN_RECT := Vector4(0.0, 0.15625, 1.0, 0.46875)
const SNOW_RECT := Vector4(0.0, 0.0, 1.0, 0.09375)

## kind -> {coverage, darkness, precip (0 none, 1 rain, 2 snow), min_seconds, max_seconds}
const STATES := {
	"clear": {"coverage": 0.0, "darkness": 0.0, "precip": 0, "min": 180.0, "max": 420.0},
	"overcast": {"coverage": 0.72, "darkness": 0.22, "precip": 0, "min": 60.0, "max": 150.0},
	"rain": {"coverage": 0.9, "darkness": 0.5, "precip": 1, "min": 60.0, "max": 180.0},
	"snow": {"coverage": 0.86, "darkness": 0.38, "precip": 2, "min": 60.0, "max": 200.0},
	"thunder": {"coverage": 0.95, "darkness": 0.72, "precip": 1, "min": 30.0, "max": 80.0},
}

## layer = {radius, height, tiles, speed, seed}
const LAYERS: Array[Dictionary] = [
	{"radius": 5.0, "height": 22.0, "tiles": Vector2(22.0, 5.0), "speed": 3.4, "seed": 0.0},
	{"radius": 13.0, "height": 34.0, "tiles": Vector2(40.0, 7.0), "speed": 2.4, "seed": 11.0},
]

var kind := "clear"
var flash := 0.0                    ## 0..1 lightning brightness for this frame
var auto_cycle := true
var forced := ""
var intensity := 0.0                ## eased precipitation strength 0..1
var rng := RandomNumberGenerator.new()

var _timer := 120.0
var _coverage := 0.0
var _darkness := 0.0
var _base_coverage := 0.45
var _precip := 0
var _flash_t := -1.0
var _thunder_t := 0.0
var _sheets: Array[MeshInstance3D] = []
var _mats: Array[ShaderMaterial] = []
var _time := 0.0

func _ready() -> void:
	rng.randomize()
	_timer = rng.randf_range(90.0, 240.0)
	_build()

func _build() -> void:
	if not _sheets.is_empty():
		return
	if not ResourceLoader.exists(WEATHER_SHADER):
		return
	var shader: Shader = load(WEATHER_SHADER)
	var tex: Texture2D = load(WEATHER_TEX) if ResourceLoader.exists(WEATHER_TEX) else null
	for i in LAYERS.size():
		var def: Dictionary = LAYERS[i]
		var mesh := CylinderMesh.new()
		mesh.top_radius = float(def["radius"])
		mesh.bottom_radius = float(def["radius"])
		mesh.height = float(def["height"])
		mesh.radial_segments = 24
		mesh.rings = 1
		mesh.cap_top = false
		mesh.cap_bottom = false
		var mi := MeshInstance3D.new()
		mi.name = "Sheet%d" % i
		mi.mesh = mesh
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
		mi.sorting_offset = 40.0 - float(i)
		mi.extra_cull_margin = 64.0
		var mat := ShaderMaterial.new()
		mat.shader = shader
		mat.set_shader_parameter("weather_tex", tex)
		mat.set_shader_parameter("tile_count", def["tiles"])
		mat.set_shader_parameter("fall_speed", float(def["speed"]))
		mat.set_shader_parameter("layer_seed", float(def["seed"]))
		mat.set_shader_parameter("sprite_rect", RAIN_RECT)
		mat.set_shader_parameter("intensity", 0.0)
		mi.material_override = mat
		mi.visible = false
		add_child(mi)
		_sheets.append(mi)
		_mats.append(mat)

# --- public API ---------------------------------------------------------------------------------

func set_base_coverage(c: float) -> void:
	_base_coverage = clampf(c, 0.0, 1.0)

## Force a state. "" or "auto" re-enables the automatic cycle.
func set_weather(new_kind: String) -> void:
	if new_kind == "" or new_kind == "auto":
		forced = ""
		auto_cycle = true
		return
	if not KINDS.has(new_kind):
		return
	forced = new_kind
	auto_cycle = false
	_enter(new_kind)

func coverage() -> float:
	return clampf(maxf(_base_coverage * (1.0 - _coverage * 0.5), _coverage), 0.0, 1.0)

func darkness() -> float:
	return _darkness

func is_precipitating() -> bool:
	return _precip != 0

func precip_kind() -> String:
	return "rain" if _precip == 1 else ("snow" if _precip == 2 else "")

# --- per frame ---------------------------------------------------------------------------------

func update(delta: float, camera_pos: Vector3, sky_def: Dictionary, sun_color: Color, daylight: float) -> void:
	_time += delta
	if _sheets.is_empty():
		_build()
	if auto_cycle and forced == "":
		_timer -= delta
		if _timer <= 0.0:
			_advance(camera_pos)
	var st: Dictionary = STATES.get(kind, STATES["clear"])
	var target_cov := float(st["coverage"])
	var target_dark := float(st["darkness"])
	# planets without clouds never get overcast skies
	if not bool(sky_def.get("clouds", true)):
		target_cov = 0.0
		target_dark = minf(target_dark, 0.15)
	var ease := clampf(delta * 0.6, 0.0, 1.0)
	_coverage = lerpf(_coverage, target_cov, ease)
	_darkness = lerpf(_darkness, target_dark, ease)
	_precip = int(st["precip"])
	if _precip == 1 and _is_cold(camera_pos):
		_precip = 2
	var target_intensity := 0.0
	if _precip == 1:
		target_intensity = 0.9 if kind != "thunder" else 1.0
	elif _precip == 2:
		target_intensity = 0.7
	intensity = lerpf(intensity, target_intensity, clampf(delta * 0.8, 0.0, 1.0))
	_update_thunder(delta)
	_update_sheets(camera_pos, sun_color, daylight)

func _is_cold(pos: Vector3) -> bool:
	var w: Node = Game.world if Game != null else null
	if w != null and w.has_method("get_biome"):
		var biome_id: String = String(w.call("get_biome", int(floor(pos.x)), int(floor(pos.z))))
		var b: Dictionary = Registry.biomes.get(biome_id, {})
		if not b.is_empty():
			return float(b.get("temperature", 0.6)) < 0.25
	if w != null:
		var planet: Dictionary = Registry.planets.get(String(w.get("planet_id")), {})
		if not planet.is_empty():
			return float(planet.get("temperature", 15.0)) < 0.0
	return false

func _advance(camera_pos: Vector3) -> void:
	var next := kind
	match kind:
		"clear":
			next = "overcast"
		"overcast":
			next = "clear" if rng.randf() < 0.35 else ("snow" if _is_cold(camera_pos) else "rain")
		"rain":
			next = "thunder" if rng.randf() < 0.3 else "overcast"
		"snow":
			next = "overcast"
		"thunder":
			next = "rain"
	_enter(next)

func _enter(new_kind: String) -> void:
	if new_kind == kind:
		return
	kind = new_kind
	var st: Dictionary = STATES.get(kind, STATES["clear"])
	_timer = rng.randf_range(float(st["min"]), float(st["max"]))
	_thunder_t = rng.randf_range(2.0, 9.0)
	Events.weather_changed.emit(kind)

func _update_thunder(delta: float) -> void:
	flash = 0.0
	if _flash_t >= 0.0:
		_flash_t -= delta
		# double strike: bright, short, with a dip in the middle
		var x: float = clampf(_flash_t / 0.28, 0.0, 1.0)
		flash = clampf(sin(x * PI * 2.4) * x, 0.0, 1.0)
		if _flash_t < 0.0:
			flash = 0.0
	if kind != "thunder":
		return
	_thunder_t -= delta
	if _thunder_t <= 0.0:
		_thunder_t = rng.randf_range(4.0, 14.0)
		_flash_t = 0.28
		Events.screen_flash.emit(Color(0.85, 0.9, 1.0), 0.14)
		if Audio != null:
			Audio.play_sfx("thunder", -4.0, rng.randf_range(0.9, 1.1))

func _update_sheets(camera_pos: Vector3, sun_color: Color, daylight: float) -> void:
	var visible_now := intensity > 0.01
	for i in _sheets.size():
		var mi: MeshInstance3D = _sheets[i]
		mi.visible = visible_now
		if not visible_now:
			continue
		mi.global_position = camera_pos + Vector3(0.0, float(LAYERS[i]["height"]) * 0.18, 0.0)
		var mat: ShaderMaterial = _mats[i]
		mat.set_shader_parameter("intensity", intensity * (1.0 if i == 0 else 0.7))
		mat.set_shader_parameter("time", _time)
		var snowing := _precip == 2
		var def: Dictionary = LAYERS[i]
		var tiles: Vector2 = def["tiles"]
		var radius := float(def["radius"])
		var height := float(def["height"])
		if snowing:
			tiles = Vector2(tiles.x * 1.5, tiles.y * 3.0)
		mat.set_shader_parameter("tile_count", tiles)
		# cell height / cell width in metres, so round flakes stay round
		var cell_w := TAU * radius / maxf(tiles.x, 1.0)
		var cell_h := height / maxf(tiles.y, 1.0)
		mat.set_shader_parameter("flake_aspect", cell_h / maxf(cell_w, 0.001))
		mat.set_shader_parameter("kind", 1 if snowing else 0)
		mat.set_shader_parameter("sprite_rect", SNOW_RECT if snowing else RAIN_RECT)
		var lit := Color(0.72, 0.78, 0.92).lerp(sun_color, 0.35) * (0.35 + 0.75 * daylight)
		mat.set_shader_parameter("tint", lit)
		mat.set_shader_parameter("quality", int(1 if Game == null else (0 if String(Game.settings.get("quality_preset", "balanced")) == "low" else 2)))

## Weather ambience now belongs to the audio engineer's Ambience node (BgmDirector child),
## which plays rain/wind on the Ambience bus. Nothing to do here.


