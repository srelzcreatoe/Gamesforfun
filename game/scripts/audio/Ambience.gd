class_name Ambience
extends Node
## Biome / planet ambience loops on the "Ambience" bus, cross-faded by listener position.
##
## Layers (all logical names from data/audio.json):
##   wind    - open sky (plains, mountains, wastelands; louder high up)
##   ocean   - water nearby / ocean & beach biomes / under water
##   cave    - underground (sky light 0 below the surface)
##   rain    - while it rains or thunders
##   space   - deep space / orbit (zero-g planets)
##   hell    - hell planet rumble
##   heaven  - heaven / sacred kai / other world choir
##
## `compute_weights()` is a pure function of a state dictionary so it can be unit tested;
## `_process` samples the live world into that dictionary at 4 Hz and cross-fades the
## per-layer volumes towards the computed weights.
## The node is created by BgmDirector (or add it anywhere under the World yourself).

const BUS := "Ambience"
## layer -> {sfx, db (at weight 1.0)}
const LAYERS: Dictionary = {
	"wind": {"sfx": "ambience_wind", "db": -13.0},
	"ocean": {"sfx": "ambience_ocean", "db": -12.0},
	"cave": {"sfx": "ambience_cave", "db": -13.0},
	"rain": {"sfx": "ambience_rain", "db": -9.0},
	"space": {"sfx": "ambience_space", "db": -14.0},
	"hell": {"sfx": "ambience_hell", "db": -12.0},
	"heaven": {"sfx": "ambience_heaven", "db": -15.0},
}
const SILENT_DB := -60.0
const SAMPLE_INTERVAL := 0.25
## seconds for a full cross-fade
const FADE_TIME := 2.0
const WATER_PROBE_RADIUS := 5
const EXTENSIONS: Array[String] = [".ogg", ".wav"]
const DEEP_SPACE_PLANETS: Array[String] = ["universe_7_deep_space", "orbit"]
const HELL_PLANETS: Array[String] = ["hell_planet"]
const HEAVEN_PLANETS: Array[String] = ["heaven", "sacred_kai_planet", "otherworld"]
## biome id fragment -> wind exposure
const WIND_BY_BIOME: Dictionary = {
	"mountain": 1.0, "ice_spikes": 1.0, "snowy": 0.95, "desert": 0.95, "badlands": 0.9,
	"savanna": 0.9, "plains": 0.85, "meadow": 0.85, "wasteland": 1.0, "barrens": 1.0,
	"mesa": 0.95, "hills": 0.8, "rocky": 0.9, "beach": 0.8, "ocean": 0.9, "river": 0.6,
	"forest": 0.4, "jungle": 0.35, "swamp": 0.4, "taiga": 0.5, "grove": 0.5,
	"deep_space": 0.0, "asteroid": 0.0, "orbit": 0.0, "time_chamber": 0.15,
}

var enabled := true
var sample_interval := SAMPLE_INTERVAL

var _players: Dictionary = {}          # layer -> AudioStreamPlayer
var _current: Dictionary = {}          # layer -> current linear weight
var _target: Dictionary = {}           # layer -> target linear weight
var _sample_t := 0.0
var _weather := "clear"
var _state: Dictionary = {}

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for key in LAYERS:
		_current[key] = 0.0
		_target[key] = 0.0
	if Events != null:
		Events.weather_changed.connect(_on_weather_changed)
		Events.world_unloading.connect(_on_world_unloading)
	var w: Node = Game.world if Game != null else null
	if w != null:
		_weather = String(w.get("weather") if w.get("weather") != null else "clear")

func _exit_tree() -> void:
	for key in _players:
		var p: AudioStreamPlayer = _players[key]
		if is_instance_valid(p):
			p.stop()

func _on_weather_changed(kind: String) -> void:
	_weather = kind

func _on_world_unloading(_w: Node) -> void:
	for key in _target:
		_target[key] = 0.0

# --- per frame ---------------------------------------------------------------

func _process(delta: float) -> void:
	_sample_t -= delta
	if _sample_t <= 0.0:
		_sample_t = sample_interval
		_state = sample_state()
		_target = compute_weights(_state)
	var step := clampf(delta / maxf(FADE_TIME, 0.01), 0.0, 1.0)
	for key in LAYERS:
		var want := 0.0 if not enabled else float(_target.get(key, 0.0))
		var cur := float(_current.get(key, 0.0))
		cur = lerpf(cur, want, step)
		if absf(cur - want) < 0.005:
			cur = want
		_current[key] = cur
		_apply_layer(key, cur)

func _apply_layer(key: String, weight: float) -> void:
	var p: AudioStreamPlayer = _players.get(key)
	if weight <= 0.01:
		if p != null and is_instance_valid(p) and p.playing:
			p.stop()
		return
	if p == null or not is_instance_valid(p):
		p = _make_player(key)
		if p == null:
			return
	p.volume_db = float(LAYERS[key]["db"]) + linear_to_db(clampf(weight, 0.02, 1.0))
	if not p.playing:
		p.play()

func _make_player(key: String) -> AudioStreamPlayer:
	var st := _load_stream(String(LAYERS[key]["sfx"]))
	if st == null:
		return null
	var p := AudioStreamPlayer.new()
	p.name = "amb_" + key
	p.bus = BUS
	p.stream = st
	p.volume_db = SILENT_DB
	p.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(p)
	# The ambience wavs import with loop_mode = forward. A file that does not loop is
	# restarted from _apply_layer (once per frame) - never from the `finished` signal,
	# because a very short stream would then re-enter play() forever.
	_players[key] = p
	return p

## Resolve a logical audio.json name and load the file (never warns twice, no
## "Missing audio" spam: a missing layer is simply silent).
func _load_stream(logical: String) -> AudioStream:
	var file := logical
	var sfx: Dictionary = Registry.audio.get("sfx", {}) if Registry != null and Registry.loaded else {}
	if sfx.has(logical):
		var v: Variant = sfx[logical]
		if v is Array and (v as Array).size() > 0:
			file = String((v as Array)[0])
		elif v is String:
			file = String(v)
	for ext in EXTENSIONS:
		var path := "res://assets/audio/sfx/" + file + ext
		if ResourceLoader.exists(path):
			return load(path)
	Log.w("Ambience: missing audio res://assets/audio/sfx/%s" % file)
	return null

# --- state ------------------------------------------------------------------

## Read the live world into the dictionary consumed by `compute_weights`.
func sample_state() -> Dictionary:
	var w: Node = Game.world if Game != null else null
	if w == null or not is_instance_valid(w):
		return {"in_world": false}
	var pos := listener_position(w)
	var planet := String(w.get("planet_id")) if w.get("planet_id") != null else ""
	var planet_def: Dictionary = Registry.planet(planet) if Registry != null else {}
	var x := int(floor(pos.x))
	var y := int(floor(pos.y))
	var z := int(floor(pos.z))
	var st := {
		"in_world": true,
		"planet": planet,
		"gravity": float(planet_def.get("gravity", 1.0)),
		"biome": String(w.call("get_biome", x, z)) if w.has_method("get_biome") else "",
		"sky_light": int(w.call("get_sky_light", x, y + 1, z)) if w.has_method("get_sky_light") else 15,
		"y": pos.y,
		"surface_y": float(w.call("get_height", x, z)) if w.has_method("get_height") else pos.y,
		"weather": _weather,
		"water_near": _water_near(w, x, y, z),
		"underwater": _underwater(),
		# another system (Weather.gd) may already own a rain loop
		"external_rain": Audio != null and Audio.is_loop_playing("weather"),
	}
	return st

func listener_position(w: Node) -> Vector3:
	var p: Node = Game.player if Game != null else null
	if p != null and is_instance_valid(p) and p is Node3D:
		return (p as Node3D).global_position
	var cam: Variant = w.get("debug_camera")
	if cam != null and cam is Node3D and is_instance_valid(cam):
		return (cam as Node3D).global_position
	var vp := get_viewport()
	if vp != null:
		var c := vp.get_camera_3d()
		if c != null:
			return c.global_position
	return Vector3(0.0, float(WorldConst.SEA_LEVEL), 0.0)

func _underwater() -> bool:
	var p: Node = Game.player if Game != null else null
	if p != null and is_instance_valid(p) and p.has_method("head_in_liquid"):
		return bool(p.call("head_in_liquid"))
	return false

## Fraction of nearby probe points that are liquid (0..1).
func _water_near(w: Node, x: int, y: int, z: int) -> float:
	if not w.has_method("is_liquid"):
		return 0.0
	var points := 0
	var hits := 0
	for a in 8:
		var ang := TAU * float(a) / 8.0
		for ring in [WATER_PROBE_RADIUS, WATER_PROBE_RADIUS * 2]:
			points += 1
			var px := x + int(round(cos(ang) * float(ring)))
			var pz := z + int(round(sin(ang) * float(ring)))
			for dy in [0, -1, -2]:
				if bool(w.call("is_liquid", px, y + dy, pz)):
					hits += 1
					break
	if points == 0:
		return 0.0
	return clampf(float(hits) / float(points) * 1.8, 0.0, 1.0)

# --- the pure decision function ---------------------------------------------

## Layer weights (0..1) for a world state. Pure: unit tested with fake states.
static func compute_weights(state: Dictionary) -> Dictionary:
	var w: Dictionary = {}
	for key in LAYERS:
		w[key] = 0.0
	if not bool(state.get("in_world", false)):
		return w
	var planet := String(state.get("planet", ""))
	var biome := String(state.get("biome", ""))
	var gravity := float(state.get("gravity", 1.0))
	var sky_light := int(state.get("sky_light", 15))
	var y := float(state.get("y", 64.0))
	var surface_y := float(state.get("surface_y", y))
	var weather := String(state.get("weather", "clear"))
	var water := clampf(float(state.get("water_near", 0.0)), 0.0, 1.0)
	var underwater := bool(state.get("underwater", false))

	# deep space / orbit: only the hum, no wind, no rain
	if DEEP_SPACE_PLANETS.has(planet) or gravity <= 0.01 or biome.contains("deep_space") \
			or biome.contains("asteroid") or biome == "orbit":
		w["space"] = 1.0
		return w

	var underground := sky_light <= 0 and y < surface_y - 1.0
	# Standing on (or above) the terrain top always counts as open sky: an ungenerated
	# or not yet lit column reports sky light 0 and would otherwise fall silent.
	var openness := clampf(float(sky_light) / 15.0, 0.0, 1.0)
	if y >= surface_y - 1.0:
		openness = 1.0

	if HELL_PLANETS.has(planet) or biome.contains("hell"):
		w["hell"] = 1.0
	if HEAVEN_PLANETS.has(planet) or biome.contains("heaven") or biome.contains("sacred") \
			or biome.contains("king_kai") or biome == "other_world":
		w["heaven"] = 1.0

	if underground:
		w["cave"] = 1.0
		w["wind"] = 0.0
		w["ocean"] = water * 0.25
	else:
		w["cave"] = 0.0
		w["wind"] = clampf(openness * _wind_factor(biome) + clampf((y - 96.0) / 96.0, 0.0, 0.3), 0.0, 1.0)
		var shore := 0.0
		if biome.contains("ocean") or biome.contains("beach") or biome.contains("river"):
			shore = 0.55
		w["ocean"] = clampf(maxf(water * (0.55 + 0.45 * openness), shore), 0.0, 1.0)

	match weather:
		"rain", "thunder":
			w["rain"] = 0.45 if underground else 1.0
		"snow":
			w["wind"] = maxf(float(w["wind"]), 0.2 if underground else 0.85)
		_:
			w["rain"] = 0.0
	if bool(state.get("external_rain", false)):
		w["rain"] = 0.0

	if underwater:
		w["ocean"] = 1.0
		w["wind"] = 0.0
		w["rain"] = 0.0
		w["cave"] = float(w["cave"]) * 0.4

	# planet flavour dominates the earthly layers
	var flavour := maxf(float(w["hell"]), float(w["heaven"]))
	if flavour > 0.0:
		w["wind"] = float(w["wind"]) * (1.0 - 0.55 * flavour)
		w["ocean"] = float(w["ocean"]) * (1.0 - 0.7 * flavour)
	for key in w:
		w[key] = clampf(float(w[key]), 0.0, 1.0)
	return w

static func _wind_factor(biome: String) -> float:
	for frag in WIND_BY_BIOME:
		if biome.contains(String(frag)):
			return float(WIND_BY_BIOME[frag])
	return 0.6

# --- introspection (tests / debug) ------------------------------------------

func layer_weights() -> Dictionary:
	return _current.duplicate()

func target_weights() -> Dictionary:
	return _target.duplicate()

func last_state() -> Dictionary:
	return _state.duplicate()

## Loudest layer, "" when silent (debug overlay / tests).
func dominant_layer() -> String:
	var best := ""
	var best_w := 0.02
	for key in _current:
		if float(_current[key]) > best_w:
			best_w = float(_current[key])
			best = String(key)
	return best

## Force a state (tests / cutscenes): skips the world sampling for one interval.
func apply_state(state: Dictionary) -> void:
	_state = state
	_target = compute_weights(state)
	_sample_t = sample_interval
