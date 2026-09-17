class_name AuraLightning
extends Node3D
## Crackling lightning around a transformed body (`hasLightnings` in forms.json).
##
## Two kinds of bolt, mixed so the effect reads as chaotic energy rather than a looping
## animation:
##   * RIBBONS - procedural jagged strips built into an `ImmediateMesh`, tapered at both
##     ends, with a hot white core and a coloured fringe, sometimes with a fork. They are
##     rebuilt every 60-160 ms, which is what makes the arcs "crawl" over the body.
##   * BILLBOARDS - the DMZ/AAA `Thunder_Bold` / `Thunder_Thin` sprites, which carry the
##     hand-drawn look the source game has.
## Both are additive and camera facing; the whole node costs `BOLTS` draw calls and no
## allocation per frame beyond the strip rebuild of the bolts that re-roll this frame.
##
##   var l := AuraLightning.new(); add_child(l)
##   l.configure(Color("#8AD8FF"), body_scale)
##   l.set_active(true); l.intensity = 1.2
##   l.strike(Vector3.UP * 2.0)      # one big ground-to-body bolt (climax)

const BOLTS := 8
const RIBBON_BOLTS := 5              # of BOLTS, the rest are sprites
const SEGMENTS := 7
const BOLD_TEX := "aaa/lightning/Thunder_Bold"
const THIN_TEX := "aaa/lightning/Thunder_Thin"
const CRACK_SOUND := "lightning_crack"

var intensity := 1.0
var color := Color(0.65, 0.85, 1.0)
var core_color := Color(1, 1, 1)
var body_scale := 1.0
var radius := 0.75
var height := 2.0
## Extra arcs that reach out from the body; used during the strain phase.
var reach := 0.0

var _bolts: Array[MeshInstance3D] = []
var _ribbon: Array[bool] = []
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
	core_color = c.lerp(Color(1, 1, 1), 0.65)
	body_scale = maxf(0.2, scale_body)
	radius = 0.75 * body_scale
	height = 2.0 * body_scale
	for i in _bolts.size():
		var m: StandardMaterial3D = _bolts[i].material_override
		if m != null:
			m.albedo_color = Color(color.r, color.g, color.b, 1.0)

func _build() -> void:
	if not _bolts.is_empty():
		return
	_timers.resize(BOLTS)
	for i in BOLTS:
		var mi: MeshInstance3D
		var is_ribbon := i < RIBBON_BOLTS
		if is_ribbon:
			mi = MeshInstance3D.new()
			mi.name = "Ribbon%d" % i
			mi.mesh = ImmediateMesh.new()
			var m := FxAssets.additive_material(null, false)
			m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
			m.billboard_keep_scale = true
			m.vertex_color_use_as_albedo = true
			m.albedo_color = Color(color.r, color.g, color.b, 1.0)
			mi.material_override = m
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		else:
			var tex := FxAssets.particle(BOLD_TEX if i % 2 == 0 else THIN_TEX, "ki_line", "spark1")
			mi = FxAssets.make_quad("Bolt%d" % i, tex, 1.0, Color(color.r, color.g, color.b, 1.0))
			var m2: StandardMaterial3D = mi.material_override
			m2.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
			m2.billboard_keep_scale = true
		mi.visible = false
		add_child(mi)
		_bolts.append(mi)
		_ribbon.append(is_ribbon)
		_timers[i] = _rng.randf() * 0.25

func set_active(on: bool) -> void:
	_active = on
	if not on:
		for b in _bolts:
			b.visible = false

func is_active() -> bool:
	return _active

## Number of bolts currently on screen (used by the budget test).
func visible_bolts() -> int:
	var n := 0
	for b in _bolts:
		if b.visible:
			n += 1
	return n

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
		_crack_timer = _rng.randf_range(0.7, 2.2)
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
	var r := radius * _rng.randf_range(0.7, 1.35) * (1.0 + reach)
	var y := _rng.randf_range(0.1, height * 0.95)
	b.position = Vector3(cos(a) * r, y, sin(a) * r)
	var alpha := clampf(0.4 + intensity * 0.45, 0.0, 0.95)
	var m: StandardMaterial3D = b.material_override
	if _ribbon[i]:
		b.scale = Vector3.ONE
		_build_ribbon(b, alpha)
		if m != null:
			m.albedo_color = Color(1, 1, 1, 1)
	else:
		var s := _rng.randf_range(0.30, 0.75) * body_scale * (0.75 + intensity * 0.45)
		b.scale = Vector3(s * _rng.randf_range(0.35, 0.8), s * 1.9, s)
		if m != null:
			m.albedo_color = Color(color.r, color.g, color.b, alpha * 0.85)
	_timers[i] = _rng.randf_range(0.06, 0.16)

## Jagged tapered strip in the local XY plane (the material billboards the whole mesh,
## so "up" here is whatever is up on screen).
func _build_ribbon(mi: MeshInstance3D, alpha: float) -> void:
	var im: ImmediateMesh = mi.mesh as ImmediateMesh
	if im == null:
		return
	im.clear_surfaces()
	var length := _rng.randf_range(0.7, 1.7) * body_scale * (0.8 + intensity * 0.4)
	var tilt := _rng.randf_range(-0.9, 0.9)
	var width := _rng.randf_range(0.022, 0.055) * body_scale * (0.8 + intensity * 0.5)
	var jitter := _rng.randf_range(0.06, 0.20) * body_scale
	_strip(im, Vector2.ZERO, tilt, length, width, jitter, alpha)
	# a fork off the middle of the bolt, half the time
	if _rng.randf() < 0.5:
		var t := _rng.randf_range(0.3, 0.7)
		var from := Vector2(sin(tilt) * length * t * 0.35, length * t)
		_strip(im, from, tilt + _rng.randf_range(-1.1, 1.1), length * 0.45,
			width * 0.7, jitter * 0.7, alpha * 0.8)

func _strip(im: ImmediateMesh, origin: Vector2, tilt: float, length: float,
		width: float, jitter: float, alpha: float) -> void:
	im.surface_begin(Mesh.PRIMITIVE_TRIANGLE_STRIP)
	var dir := Vector2(sin(tilt), cos(tilt))
	var side := Vector2(dir.y, -dir.x)
	for s in SEGMENTS + 1:
		var t := float(s) / float(SEGMENTS)
		var taper := sin(t * PI)                      # thin at both ends, fat in the middle
		var off := (_rng.randf() - 0.5) * 2.0 * jitter * (1.0 - absf(t * 2.0 - 1.0))
		var p := origin + dir * (length * t) + side * off
		var w := width * (0.25 + taper)
		var c := core_color.lerp(color, t * 0.7)
		c.a = alpha * (0.35 + 0.65 * taper)
		im.surface_set_color(c)
		im.surface_add_vertex(Vector3(p.x - side.x * w, p.y - side.y * w, 0.0))
		im.surface_set_color(c)
		im.surface_add_vertex(Vector3(p.x + side.x * w, p.y + side.y * w, 0.0))
	im.surface_end()

## One deliberate bolt from `from_local` up into the body (transformation climax).
func strike(from_local: Vector3) -> void:
	if _bolts.is_empty():
		return
	for i in _bolts.size():
		if not _ribbon[i]:
			continue
		var b := _bolts[i]
		b.visible = true
		b.position = from_local
		b.scale = Vector3.ONE
		var im: ImmediateMesh = b.mesh as ImmediateMesh
		if im != null:
			im.clear_surfaces()
			_strip(im, Vector2.ZERO, _rng.randf_range(-0.35, 0.35),
				height * 1.4, 0.09 * body_scale, 0.22 * body_scale, 1.0)
		_timers[i] = 0.28
		return
