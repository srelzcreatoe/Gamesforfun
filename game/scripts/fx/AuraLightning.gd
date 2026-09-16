class_name AuraLightning
extends Node3D
## Crackling lightning arcs around a transformed body (`hasLightnings` in forms.json).
##
## Eight AAA-particles lightning billboards (`aaa/lightning/Thunder_Bold.png` and
## `Thunder_Thin.png`) are re-positioned, re-scaled and re-rolled a few times a second
## around the entity; each bolt lives for 60-140 ms so the effect reads as a jitter
## instead of an animation. Occasionally a `lightning_crack` sound plays.

const BOLTS := 8
const BOLD_TEX := "aaa/lightning/Thunder_Bold"
const THIN_TEX := "aaa/lightning/Thunder_Thin"
const CRACK_SOUND := "lightning_crack"

var intensity := 1.0
var color := Color(0.65, 0.85, 1.0)
var body_scale := 1.0
var radius := 0.75
var height := 2.0

var _bolts: Array[MeshInstance3D] = []
var _timers: PackedFloat32Array = PackedFloat32Array()
var _active := false
var _crack_timer := 0.0
var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	_rng.randomize()
	_build()
	set_active(_active)

func configure(c: Color, scale_body := 1.0) -> void:
	color = c
	body_scale = maxf(0.2, scale_body)
	radius = 0.75 * body_scale
	height = 2.0 * body_scale
	for b in _bolts:
		var m: StandardMaterial3D = b.material_override
		if m != null:
			m.albedo_color = Color(color.r, color.g, color.b, 1.0)

func _build() -> void:
	if not _bolts.is_empty():
		return
	_timers.resize(BOLTS)
	for i in BOLTS:
		var tex := FxAssets.particle(BOLD_TEX if i % 2 == 0 else THIN_TEX, "ki_line", "spark1")
		var mi := FxAssets.make_quad("Bolt%d" % i, tex, 1.0, Color(color.r, color.g, color.b, 1.0))
		var m: StandardMaterial3D = mi.material_override
		m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
		m.billboard_keep_scale = true
		mi.visible = false
		add_child(mi)
		_bolts.append(mi)
		_timers[i] = _rng.randf() * 0.25

func set_active(on: bool) -> void:
	_active = on
	if not on:
		for b in _bolts:
			b.visible = false

func is_active() -> bool:
	return _active

func _process(delta: float) -> void:
	if not _active or _bolts.is_empty():
		return
	for i in _bolts.size():
		_timers[i] -= delta
		if _timers[i] > 0.0:
			continue
		_reroll(i)
	_crack_timer -= delta
	if _crack_timer <= 0.0:
		_crack_timer = _rng.randf_range(0.8, 2.4)
		if intensity > 0.6 and is_inside_tree():
			Audio.play_sfx_at(CRACK_SOUND, global_position, -12.0, _rng.randf_range(0.9, 1.3))

func _reroll(i: int) -> void:
	var b := _bolts[i]
	var on := _rng.randf() < clampf(0.35 + intensity * 0.5, 0.0, 0.95)
	b.visible = on
	if not on:
		_timers[i] = _rng.randf_range(0.04, 0.12)
		return
	var a := _rng.randf() * TAU
	var r := radius * _rng.randf_range(0.7, 1.35)
	var y := _rng.randf_range(-0.1, height)
	b.position = Vector3(cos(a) * r, y, sin(a) * r)
	var s := _rng.randf_range(0.5, 1.5) * body_scale * (0.7 + intensity * 0.6)
	b.scale = Vector3(s * _rng.randf_range(0.35, 0.8), s * 1.6, s)
	b.rotation.z = _rng.randf_range(-0.6, 0.6)
	var m: StandardMaterial3D = b.material_override
	if m != null:
		m.albedo_color = Color(color.r, color.g, color.b, clampf(0.55 + intensity * 0.6, 0.0, 1.0))
	_timers[i] = _rng.randf_range(0.06, 0.16)
