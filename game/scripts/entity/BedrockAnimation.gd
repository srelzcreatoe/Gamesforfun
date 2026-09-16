class_name BedrockAnimation
extends Node
## Plays verbatim Bedrock `*.animation.json` clips on a `BedrockModel`
## (docs/ARCHITECTURE.md §7).
##
## * `load_clips("entity/races/movement")` merges any number of files into one
##   clip table; clip names keep their DMZ spelling ("base.walk", "idle", ...) and
##   `play("walk")` also resolves "base.walk" (suffix match) so the same gameplay
##   code drives humans, animals and bosses.
## * Two channels: LAYER_BASE (full body) and LAYER_UPPER (upper-body override,
##   e.g. a punch while running). The upper layer only writes the bones it
##   animates that are in `UPPER_BONES`.
## * Keyframes support `vector` (numbers OR Molang strings evaluated per frame),
##   `pre`/`post` keys, `lerp_mode: catmullrom`, `easing`, the shorthand forms
##   (bare array / bare number) and `loop: true|false|"hold_on_last_frame"`.
## * Offsets are applied ON TOP of the model rest pose using the conventions
##   documented in BedrockModel.gd (position mirrored on X, euler degrees as is,
##   composed Rz*Ry*Rx). Positions are in model units (1/16 m).
## * Compiled Molang programs and parsed clips are cached statically per file, so
##   a spawned entity costs no parsing. Cost is ~0.02-0.05 ms per animated entity
##   (see tests/test_bedrock_anim.gd for the measured number).

signal clip_finished(clip_name: String)

const ANIM_DIR := "res://assets/animations/"
const LAYER_BASE := 0
const LAYER_UPPER := 1
const LOOP_NONE := 0
const LOOP_YES := 1
const LOOP_HOLD := 2
const LERP_LINEAR := 0
const LERP_CATMULLROM := 1

## Bones the upper-body override layer is allowed to touch.
const UPPER_BONES := [
	"head", "hat_layer", "armorHead", "body", "armorBody", "body_layer", "armorLeggingsBody",
	"right_arm", "left_arm", "right_forearm", "left_forearm", "armorRightArm", "armorLeftArm",
	"right_arm_layer", "left_arm_layer", "right_hand_item", "left_hand_item", "waist",
]

static var prefer_hd := true
static var _file_cache: Dictionary = {}          # file path -> {clip name: Clip}

var model: BedrockModel = null
var entity: Node = null                          # owner, queried for head/motion state
var clips: Dictionary = {}                       # name -> Clip
var update_interval := 0.0                       # >0 throttles updates (distance LOD)
var paused := false

var _layers: Array[LayerState] = []
var _ctx: Dictionary = {}
var _touched: Dictionary = {}                     # bone -> true, written last frame
var _accum := 0.0
var _life_time := 0.0

# --- parsed data ---------------------------------------------------------------

class Chan extends RefCounted:
	var has_keys := false
	var vec: Array = []                           # [Molang, Molang, Molang]
	var times: PackedFloat32Array = PackedFloat32Array()
	var keys: Array = []                          # [Key]

	func sample(t: float, ctx: Dictionary, default: Vector3) -> Vector3:
		if not has_keys:
			if vec.is_empty():
				return default
			return Vector3(vec[0].evaluate(ctx), vec[1].evaluate(ctx), vec[2].evaluate(ctx))
		var n := keys.size()
		if n == 0:
			return default
		if n == 1 or t <= times[0]:
			return (keys[0] as Key).eval_pre(ctx)
		if t >= times[n - 1]:
			return (keys[n - 1] as Key).eval_post(ctx)
		var lo := 0
		var hi := n - 1
		while lo + 1 < hi:
			var mid := (lo + hi) >> 1
			if times[mid] <= t:
				lo = mid
			else:
				hi = mid
		var k0: Key = keys[lo]
		var k1: Key = keys[lo + 1]
		var span := times[lo + 1] - times[lo]
		var f := 0.0 if span <= 0.0 else (t - times[lo]) / span
		var a := k0.eval_post(ctx)
		var b := k1.eval_pre(ctx)
		if k0.lerp_mode == LERP_CATMULLROM:
			var pa: Vector3 = (keys[maxi(lo - 1, 0)] as Key).eval_post(ctx)
			var pb: Vector3 = (keys[mini(lo + 2, n - 1)] as Key).eval_pre(ctx)
			return _catmullrom(pa, a, b, pb, f)
		return a.lerp(b, BedrockAnimation.ease_value(k0.easing, f))

	static func _catmullrom(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: float) -> Vector3:
		var t2 := t * t
		var t3 := t2 * t
		return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3)

class Key extends RefCounted:
	var t := 0.0
	var pre: Array = []
	var post: Array = []
	var lerp_mode := 0
	var easing := "linear"

	func eval_pre(ctx: Dictionary) -> Vector3:
		return Vector3(pre[0].evaluate(ctx), pre[1].evaluate(ctx), pre[2].evaluate(ctx))

	func eval_post(ctx: Dictionary) -> Vector3:
		return Vector3(post[0].evaluate(ctx), post[1].evaluate(ctx), post[2].evaluate(ctx))

class Clip extends RefCounted:
	var name := ""
	var loop := 0
	var length := 0.0
	var bones: Dictionary = {}                    # bone -> {"rotation": Chan, "position": Chan, "scale": Chan}
	var bone_names: PackedStringArray = PackedStringArray()

class LayerState extends RefCounted:
	var clip: Clip = null
	var time := 0.0
	var speed := 1.0
	var weight := 1.0
	var blend := 0.0
	var blend_left := 0.0
	var frozen: Dictionary = {}                   # bone -> Array[pos, rot, scale] snapshot
	var finished := false
	var fading_out := false
	var loop_override := -1                       # -1 = use the clip's own loop mode

	func loop_mode() -> int:
		if loop_override >= 0:
			return loop_override
		return clip.loop if clip != null else 0

# --- setup --------------------------------------------------------------------

func _init() -> void:
	_layers = [LayerState.new(), LayerState.new()]

func setup(m: BedrockModel, owner_entity: Node = null) -> void:
	model = m
	entity = owner_entity

static func anim_file(path_rel: String) -> String:
	var p := path_rel.trim_suffix(".animation.json")
	if prefer_hd:
		var hd := ANIM_DIR + "hd/" + p + ".animation.json"
		if FileAccess.file_exists(hd):
			return hd
	return ANIM_DIR + p + ".animation.json"

## Load and merge a clip file (relative to assets/animations, no extension).
## Returns the number of clips now known.
func load_clips(path_rel: String) -> int:
	var file := anim_file(path_rel)
	var parsed: Dictionary = _file_cache.get(file, {})
	if parsed.is_empty():
		parsed = _parse_file(file)
		_file_cache[file] = parsed
	for k in parsed.keys():
		clips[k] = parsed[k]
	return clips.size()

func load_clip_sets(paths: Array) -> int:
	for p in paths:
		load_clips(String(p))
	return clips.size()

static func _parse_file(file: String) -> Dictionary:
	var out: Dictionary = {}
	if not FileAccess.file_exists(file):
		Log.w("BedrockAnimation: missing " + file)
		return out
	var f := FileAccess.open(file, FileAccess.READ)
	if f == null:
		return out
	var txt := f.get_as_text()
	f.close()
	var data: Variant = JSON.parse_string(txt)
	if not (data is Dictionary):
		Log.w("BedrockAnimation: bad json " + file)
		return out
	var anims: Variant = data.get("animations", {})
	if not (anims is Dictionary):
		return out
	for name in anims.keys():
		var raw: Variant = anims[name]
		if raw is Dictionary:
			out[String(name)] = _parse_clip(String(name), raw)
	return out

static func _parse_clip(name: String, raw: Dictionary) -> Clip:
	var clip := Clip.new()
	clip.name = name
	var loop_raw: Variant = raw.get("loop", false)
	if loop_raw is String:
		clip.loop = LOOP_HOLD if String(loop_raw) == "hold_on_last_frame" else LOOP_YES
	elif loop_raw is bool:
		clip.loop = LOOP_YES if loop_raw else LOOP_NONE
	var bones: Variant = raw.get("bones", {})
	var max_t := 0.0
	if bones is Dictionary:
		for bname in bones.keys():
			var ch: Variant = bones[bname]
			if not (ch is Dictionary):
				continue
			var entry: Dictionary = {}
			for cname in ["rotation", "position", "scale"]:
				if not ch.has(cname):
					continue
				var chan := _parse_channel(ch[cname])
				if chan == null:
					continue
				entry[cname] = chan
				if chan.has_keys and chan.times.size() > 0:
					max_t = maxf(max_t, chan.times[chan.times.size() - 1])
			if not entry.is_empty():
				clip.bones[String(bname)] = entry
				clip.bone_names.append(String(bname))
	var len_raw: Variant = raw.get("animation_length")
	clip.length = float(len_raw) if (len_raw is float or len_raw is int) else max_t
	return clip

static func _parse_channel(raw: Variant) -> Chan:
	var chan := Chan.new()
	if raw is Array or raw is float or raw is int or raw is String:
		chan.vec = _parse_vector(raw)
		return chan
	if not (raw is Dictionary):
		return null
	var d: Dictionary = raw
	if d.has("vector"):
		chan.vec = _parse_vector(d["vector"])
		return chan
	# time -> keyframe map (json keys are strings: "0.0", "0.125", "2")
	var stamps: Array = []
	for k in d.keys():
		var ks := String(k)
		if ks.is_valid_float():
			stamps.append([float(ks), d[k]])
	if stamps.is_empty():
		return null
	stamps.sort_custom(func(a: Array, b: Array) -> bool: return float(a[0]) < float(b[0]))
	chan.has_keys = true
	for pair in stamps:
		var t: float = pair[0]
		var kf: Variant = pair[1]
		var key := Key.new()
		key.t = t
		if kf is Dictionary:
			var kd: Dictionary = kf
			var post_raw: Variant = kd.get("post", kd.get("vector", kd.get("pre")))
			var pre_raw: Variant = kd.get("pre", kd.get("vector", post_raw))
			key.post = _parse_vector(post_raw.get("vector") if post_raw is Dictionary else post_raw)
			key.pre = _parse_vector(pre_raw.get("vector") if pre_raw is Dictionary else pre_raw)
			key.lerp_mode = LERP_CATMULLROM if String(kd.get("lerp_mode", "linear")) == "catmullrom" else LERP_LINEAR
			key.easing = String(kd.get("easing", "linear"))
		else:
			key.pre = _parse_vector(kf)
			key.post = key.pre
		chan.keys.append(key)
		chan.times.append(t)
	return chan

static func _parse_vector(raw: Variant) -> Array:
	var out: Array = []
	if raw is Array:
		for i in 3:
			out.append(Molang.of(raw[i] if i < raw.size() else 0.0))
	elif raw is float or raw is int or raw is String:
		var m := Molang.of(raw)
		out = [m, m, m]
	else:
		var z := Molang.compile("0")
		out = [z, z, z]
	for i in 3:
		if out[i] == null:
			out[i] = Molang.compile("0")
	return out

static func ease_value(easing: String, f: float) -> float:
	match easing:
		"linear", "":
			return f
		"easeInQuad":
			return f * f
		"easeOutQuad":
			return 1.0 - (1.0 - f) * (1.0 - f)
		"easeInOutQuad":
			return 2.0 * f * f if f < 0.5 else 1.0 - pow(-2.0 * f + 2.0, 2.0) * 0.5
		"easeInCubic":
			return f * f * f
		"easeOutCubic":
			return 1.0 - pow(1.0 - f, 3.0)
		"easeInOutCubic":
			return 4.0 * f * f * f if f < 0.5 else 1.0 - pow(-2.0 * f + 2.0, 3.0) * 0.5
		"easeInQuart":
			return pow(f, 4.0)
		"easeOutQuart":
			return 1.0 - pow(1.0 - f, 4.0)
		"easeInQuint":
			return pow(f, 5.0)
		"easeOutQuint":
			return 1.0 - pow(1.0 - f, 5.0)
		"easeInExpo":
			return 0.0 if f <= 0.0 else pow(2.0, 10.0 * f - 10.0)
		"easeOutExpo":
			return 1.0 if f >= 1.0 else 1.0 - pow(2.0, -10.0 * f)
		"easeInSine":
			return 1.0 - cos(f * PI * 0.5)
		"easeOutSine":
			return sin(f * PI * 0.5)
	return f

# --- playback -----------------------------------------------------------------

func has_clip(name: String) -> bool:
	return resolve(name) != null

## Resolve "walk" -> "base.walk" when there is no exact match.
func resolve(name: String) -> Clip:
	if name == "":
		return null
	var c: Variant = clips.get(name)
	if c != null:
		return c
	var suffix := "." + name
	for k in clips.keys():
		if String(k).ends_with(suffix):
			return clips[k]
	return null

func play(name: String, blend := 0.15, loop_override: Variant = null, speed := 1.0) -> bool:
	return play_on(LAYER_BASE, name, blend, loop_override, speed)

func play_upper(name: String, blend := 0.12, loop_override: Variant = null, speed := 1.0) -> bool:
	return play_on(LAYER_UPPER, name, blend, loop_override, speed)

func play_on(layer_idx: int, name: String, blend := 0.15, loop_override: Variant = null, speed := 1.0) -> bool:
	var clip := resolve(name)
	if clip == null:
		return false
	var st: LayerState = _layers[layer_idx]
	if st.clip == clip and not st.finished and is_equal_approx(st.speed, speed):
		return true
	if st.clip != null and blend > 0.0:
		st.frozen = _pose_of(st, true)
		st.blend = blend
		st.blend_left = blend
	else:
		st.frozen = {}
		st.blend_left = 0.0
	st.clip = clip
	st.time = 0.0
	st.speed = speed
	st.weight = 1.0
	st.finished = false
	st.fading_out = false
	st.loop_override = -1
	if loop_override is bool:
		st.loop_override = LOOP_YES if loop_override else LOOP_NONE
	elif loop_override is String:
		st.loop_override = LOOP_HOLD if String(loop_override) == "hold_on_last_frame" else LOOP_YES
	elif loop_override is int:
		st.loop_override = clampi(int(loop_override), 0, 2)
	return true

func stop(blend := 0.15, layer_idx := -1) -> void:
	var list := [layer_idx] if layer_idx >= 0 else [LAYER_BASE, LAYER_UPPER]
	for i in list:
		var st: LayerState = _layers[i]
		if st.clip == null:
			continue
		if blend > 0.0:
			st.frozen = _pose_of(st, true)
			st.blend = blend
			st.blend_left = blend
			st.fading_out = true
		else:
			st.frozen = {}
			st.blend_left = 0.0
		st.clip = null
		st.finished = true

func stop_upper(blend := 0.12) -> void:
	stop(blend, LAYER_UPPER)

func is_playing(name := "") -> bool:
	for st in _layers:
		if st.clip == null:
			continue
		if name == "" or st.clip.name == name or st.clip.name.ends_with("." + name):
			return true
	return false

func current_clip(layer_idx := LAYER_BASE) -> String:
	var st: LayerState = _layers[layer_idx]
	return st.clip.name if st.clip != null else ""

func clip_length(name: String) -> float:
	var c := resolve(name)
	return c.length if c != null else 0.0

func time_of(layer_idx := LAYER_BASE) -> float:
	return (_layers[layer_idx] as LayerState).time

func set_time(t: float, layer_idx := LAYER_BASE) -> void:
	(_layers[layer_idx] as LayerState).time = t

# --- per frame ----------------------------------------------------------------

func update(delta: float) -> void:
	if paused or model == null:
		return
	_life_time += delta
	if update_interval > 0.0:
		_accum += delta
		if _accum < update_interval:
			return
		delta = _accum
		_accum = 0.0
	_update_context()
	var pose: Dictionary = {}
	for i in _layers.size():
		var st: LayerState = _layers[i]
		if st.clip == null and st.blend_left <= 0.0:
			continue
		_advance(st, delta)
		var p := _pose_of(st, false)
		if st.blend_left > 0.0 and st.blend > 0.0:
			var w := 1.0 - st.blend_left / st.blend
			p = _blend_poses(st.frozen, p, w)
		if i == LAYER_UPPER:
			for b in p.keys():
				if UPPER_BONES.has(b):
					pose[b] = p[b]
		else:
			for b in p.keys():
				pose[b] = p[b]
	_apply(pose)

func _advance(st: LayerState, delta: float) -> void:
	if st.blend_left > 0.0:
		st.blend_left = maxf(0.0, st.blend_left - delta)
	if st.clip == null:
		return
	st.time += delta * st.speed
	var length := st.clip.length
	if length > 0.0:
		match st.loop_mode():
			LOOP_YES:
				st.time = fposmod(st.time, length)
			LOOP_HOLD:
				st.time = minf(st.time, length)
			_:
				if st.time >= length and not st.finished:
					st.time = length
					st.finished = true
					clip_finished.emit(st.clip.name)

func _update_context() -> void:
	_ctx["query.life_time"] = _life_time
	var pitch := 0.0
	var yaw := 0.0
	var on_ground := 1.0
	var speed := 0.0
	var moved := 0.0
	var flying := 0.0
	if entity != null:
		pitch = float(entity.get("head_pitch_deg") if entity.get("head_pitch_deg") != null else 0.0)
		yaw = float(entity.get("head_yaw_deg") if entity.get("head_yaw_deg") != null else 0.0)
		var og: Variant = entity.get("on_ground")
		if og != null:
			on_ground = 1.0 if og else 0.0
		var gs: Variant = entity.get("ground_speed")
		if gs != null:
			speed = float(gs)
		var dm: Variant = entity.get("distance_moved")
		if dm != null:
			moved = float(dm)
		var fl: Variant = entity.get("is_flying")
		if fl != null:
			flying = 1.0 if fl else 0.0
	_ctx["query.head_x_rotation"] = pitch
	_ctx["query.head_y_rotation"] = yaw
	_ctx["query.target_x_rotation"] = pitch
	_ctx["query.target_y_rotation"] = yaw
	_ctx["query.is_on_ground"] = on_ground
	_ctx["query.ground_speed"] = speed
	_ctx["query.modified_distance_moved"] = moved
	_ctx["query.modified_move_speed"] = speed
	_ctx["query.is_flying"] = flying
	_ctx["query.is_in_water"] = 0.0
	_ctx["this"] = 0.0

## bone -> [position offset (model units), rotation offset (degrees), scale]
func _pose_of(st: LayerState, snapshot: bool) -> Dictionary:
	var out: Dictionary = {}
	if st.clip == null:
		return out
	var t := st.time
	_ctx["query.anim_time"] = t
	for bname in st.clip.bone_names:
		var entry: Dictionary = st.clip.bones[bname]
		var pos := Vector3.ZERO
		var rot := Vector3.ZERO
		var scl := Vector3.ONE
		var chan: Chan = entry.get("position")
		if chan != null:
			var v := chan.sample(t, _ctx, Vector3.ZERO)
			pos = Vector3(-v.x, v.y, v.z)
		chan = entry.get("rotation")
		if chan != null:
			rot = chan.sample(t, _ctx, Vector3.ZERO)
		chan = entry.get("scale")
		if chan != null:
			scl = chan.sample(t, _ctx, Vector3.ONE)
		out[bname] = [pos, rot, scl]
	return out

static func _blend_poses(from: Dictionary, to: Dictionary, w: float) -> Dictionary:
	var out: Dictionary = {}
	for b in to.keys():
		var a: Array = from.get(b, [Vector3.ZERO, Vector3.ZERO, Vector3.ONE])
		var c: Array = to[b]
		out[b] = [
			(a[0] as Vector3).lerp(c[0], w),
			(a[1] as Vector3).lerp(c[1], w),
			(a[2] as Vector3).lerp(c[2], w),
		]
	for b in from.keys():
		if not out.has(b):
			var a2: Array = from[b]
			out[b] = [
				(a2[0] as Vector3) * (1.0 - w),
				(a2[1] as Vector3) * (1.0 - w),
				Vector3.ONE.lerp(a2[2], 1.0 - w),
			]
	return out

func _apply(pose: Dictionary) -> void:
	var bones: Dictionary = model.bones
	for bname in pose.keys():
		var node: Node3D = bones.get(bname)
		if node == null:
			continue
		var v: Array = pose[bname]
		var rest_p: Vector3 = model.rest_position.get(bname, Vector3.ZERO)
		var rest_r: Vector3 = model.rest_rotation.get(bname, Vector3.ZERO)
		node.transform = Transform3D(BedrockModel.bedrock_basis(rest_r + (v[1] as Vector3)), rest_p + (v[0] as Vector3))
		var s: Vector3 = v[2]
		if not s.is_equal_approx(Vector3.ONE):
			node.scale = s
		_touched[bname] = true
	# bones animated last frame but not this one go back to their rest pose
	var stale: PackedStringArray = PackedStringArray()
	for bname in _touched.keys():
		if not pose.has(bname):
			stale.append(String(bname))
	for bname in stale:
		var node2: Node3D = bones.get(bname)
		if node2 != null:
			node2.transform = Transform3D(BedrockModel.bedrock_basis(model.rest_rotation.get(bname, Vector3.ZERO)), model.rest_position.get(bname, Vector3.ZERO))
			node2.scale = Vector3.ONE
		_touched.erase(bname)

## Test/preview helper: pose the model at an absolute time of one clip.
func sample_to(name: String, t: float) -> bool:
	var clip := resolve(name)
	if clip == null or model == null:
		return false
	var st: LayerState = _layers[LAYER_BASE]
	st.clip = clip
	st.time = t
	st.blend_left = 0.0
	st.frozen = {}
	st.finished = false
	_update_context()
	_apply(_pose_of(st, false))
	return true

## Test helper: sampled channel value without touching the model.
func sample_channel(clip_name: String, bone: String, channel: String, t: float) -> Vector3:
	var clip := resolve(clip_name)
	if clip == null or not clip.bones.has(bone):
		return Vector3.ZERO
	var entry: Dictionary = clip.bones[bone]
	var chan: Chan = entry.get(channel)
	if chan == null:
		return Vector3.ZERO
	_update_context()
	_ctx["query.anim_time"] = t
	return chan.sample(t, _ctx, Vector3.ONE if channel == "scale" else Vector3.ZERO)
