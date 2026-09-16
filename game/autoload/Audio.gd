extends Node
## Sound effects (pooled, positional), loops and cross-faded background music.

const SFX_DIR := "res://assets/audio/sfx/"
const BGM_DIR := "res://assets/audio/bgm/"
const POOL_SIZE := 12
const POOL3D_SIZE := 10

var _pool: Array[AudioStreamPlayer] = []
var _pool3d: Array[AudioStreamPlayer3D] = []
var _loops: Dictionary = {}
var _streams: Dictionary = {}
var _bgm_a: AudioStreamPlayer
var _bgm_b: AudioStreamPlayer
var _bgm_active: AudioStreamPlayer
var _bgm_context := ""
var _bgm_track := ""
var _bgm_fade_t := 0.0
var _bgm_fade_len := 1.0
var _rng := RandomNumberGenerator.new()
var _playlist_pos: Dictionary = {}

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for i in POOL_SIZE:
		var p := AudioStreamPlayer.new()
		p.bus = "Sfx"
		add_child(p)
		_pool.append(p)
	for i in POOL3D_SIZE:
		var p3 := AudioStreamPlayer3D.new()
		p3.bus = "Sfx"
		p3.max_distance = 48.0
		p3.unit_size = 4.0
		p3.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
		add_child(p3)
		_pool3d.append(p3)
	_bgm_a = AudioStreamPlayer.new(); _bgm_a.bus = "Music"; add_child(_bgm_a)
	_bgm_b = AudioStreamPlayer.new(); _bgm_b.bus = "Music"; add_child(_bgm_b)
	_bgm_active = _bgm_a
	_bgm_a.finished.connect(_on_bgm_finished.bind(_bgm_a))
	_bgm_b.finished.connect(_on_bgm_finished.bind(_bgm_b))
	_apply_settings()
	Events.settings_changed.connect(_apply_settings)

func _apply_settings() -> void:
	var s: Dictionary = Game.settings if Game != null else {}
	set_volume("Master", 1.0)
	set_volume("Music", float(s.get("music_volume", 0.7)))
	set_volume("Sfx", float(s.get("sfx_volume", 1.0)))
	set_volume("Ambience", float(s.get("ambience_volume", 0.8)))

func set_volume(bus: String, linear: float) -> void:
	var idx := AudioServer.get_bus_index(bus)
	if idx < 0:
		return
	AudioServer.set_bus_volume_db(idx, linear_to_db(clampf(linear, 0.0, 1.0)) if linear > 0.001 else -80.0)

func _resolve(name: String) -> String:
	## data/audio.json "sfx" map: logical name -> [file names] (random pick). Else the name is the file.
	var sfx: Dictionary = Registry.audio.get("sfx", {}) if Registry.loaded else {}
	if sfx.has(name):
		var v: Variant = sfx[name]
		if v is Array and v.size() > 0:
			return String(v[_rng.randi_range(0, v.size() - 1)])
		if v is String:
			return v
	return name

func _stream(file: String, dir := SFX_DIR) -> AudioStream:
	var path := dir + file + ".ogg"
	if _streams.has(path):
		return _streams[path]
	var st: AudioStream = null
	if ResourceLoader.exists(path):
		st = load(path)
	elif ResourceLoader.exists(dir + file + ".wav"):
		st = load(dir + file + ".wav")
	if st == null:
		Log.w("Missing audio: " + path)
	_streams[path] = st
	return st

func play_sfx(name: String, volume_db := 0.0, pitch := 1.0) -> void:
	var st := _stream(_resolve(name))
	if st == null:
		return
	for p in _pool:
		if not p.playing:
			p.stream = st
			p.volume_db = volume_db
			p.pitch_scale = pitch
			p.play()
			return
	var p0 := _pool[0]
	p0.stream = st; p0.volume_db = volume_db; p0.pitch_scale = pitch; p0.play()

func play_sfx_at(name: String, pos: Vector3, volume_db := 0.0, pitch := 1.0) -> void:
	var st := _stream(_resolve(name))
	if st == null:
		return
	for p in _pool3d:
		if not p.playing:
			p.stream = st
			p.global_position = pos
			p.volume_db = volume_db
			p.pitch_scale = pitch
			p.play()
			return
	var p0 := _pool3d[0]
	p0.stream = st; p0.global_position = pos; p0.volume_db = volume_db; p0.pitch_scale = pitch; p0.play()

func play_loop(name: String, key: String, volume_db := 0.0) -> void:
	if _loops.has(key):
		return
	var st := _stream(_resolve(name))
	if st == null:
		return
	var p := AudioStreamPlayer.new()
	p.bus = "Sfx"
	p.stream = st
	p.volume_db = volume_db
	add_child(p)
	p.play()
	p.finished.connect(func() -> void: if is_instance_valid(p) and _loops.get(key) == p: p.play())
	_loops[key] = p

func stop_loop(key: String, fade := 0.2) -> void:
	if not _loops.has(key):
		return
	var p: AudioStreamPlayer = _loops[key]
	_loops.erase(key)
	if fade <= 0.0:
		p.queue_free()
		return
	var tw := create_tween()
	tw.tween_property(p, "volume_db", -40.0, fade)
	tw.tween_callback(p.queue_free)

func is_loop_playing(key: String) -> bool:
	return _loops.has(key)

func play_bgm(context: String, fade := 1.5) -> void:
	if context == _bgm_context and _bgm_active.playing:
		return
	var lists: Dictionary = Registry.audio.get("bgm", {}) if Registry.loaded else {}
	var tracks: Array = lists.get(context, [])
	if tracks.is_empty():
		Log.w("No BGM playlist for context " + context)
		return
	_bgm_context = context
	var pos: int = _playlist_pos.get(context, _rng.randi_range(0, tracks.size() - 1))
	_playlist_pos[context] = (pos + 1) % tracks.size()
	_play_bgm_track(String(tracks[pos]), fade)

func _play_bgm_track(track: String, fade: float) -> void:
	var st := _stream(track, BGM_DIR)
	if st == null:
		return
	_bgm_track = track
	var next := _bgm_b if _bgm_active == _bgm_a else _bgm_a
	var prev := _bgm_active
	next.stream = st
	next.volume_db = -40.0
	next.play()
	_bgm_active = next
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(next, "volume_db", 0.0, fade)
	if prev.playing:
		tw.tween_property(prev, "volume_db", -40.0, fade)
		tw.chain().tween_callback(prev.stop)

func _on_bgm_finished(player: AudioStreamPlayer) -> void:
	if player != _bgm_active or _bgm_context == "":
		return
	var lists: Dictionary = Registry.audio.get("bgm", {})
	var tracks: Array = lists.get(_bgm_context, [])
	if tracks.is_empty():
		return
	var pos: int = _playlist_pos.get(_bgm_context, 0)
	_playlist_pos[_bgm_context] = (pos + 1) % tracks.size()
	_play_bgm_track(String(tracks[pos]), 0.5)

func stop_bgm(fade := 1.0) -> void:
	_bgm_context = ""
	var prev := _bgm_active
	if not prev.playing:
		return
	var tw := create_tween()
	tw.tween_property(prev, "volume_db", -40.0, fade)
	tw.tween_callback(prev.stop)

func bgm_context() -> String:
	return _bgm_context
