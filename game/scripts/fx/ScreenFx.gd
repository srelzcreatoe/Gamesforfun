class_name ScreenFx
extends CanvasLayer
## Full-screen feedback: flashes, damage vignette, low-health pulse, hit-stop /
## slow-motion, radial (zoom) blur, chromatic aberration, scene dim and an
## emissive bloom boost.
##
## There is no autoload for fx, so the node is created lazily under the scene tree
## root the first time anything asks for it and lives as long as the game does:
##   ScreenFx.flash(Color(1,1,1), 0.25)
##   ScreenFx.vignette_pulse(Color(0.6,0,0), 0.6, 0.35)
##   ScreenFx.vignette_hold(Color(0,0,0), 0.55, 2.0)     # sustained, then fades
##   ScreenFx.hit_stop(0.05)
##   ScreenFx.slow_mo(0.6, 1.5)
##   ScreenFx.chromatic(0.006, 0.4)
##   ScreenFx.radial_blur(0.08, 0.3)                     # impact / speed punch
##   ScreenFx.impact_pulse(1.0)                          # blur + aberration + flash
##   ScreenFx.dim(0.55, 2.0)                             # sky darkens (strain phase)
##   ScreenFx.glow(0.8, 2.0)                             # bloom-ish emissive boost
##   ScreenFx.shake(1.0, 0.5)          # forwards to the camera rig + Events.screen_shake
##
## COST WHEN IDLE IS ZERO. The additive overlay is hidden unless a flash/vignette is
## running, and the screen-reading pass (blur/aberration/dim/glow) is either pushed into
## the world's existing `scenes/fx/PostProcess.tscn` pass - so nothing extra is drawn -
## or, when there is no post-process in the scene, done by a second ColorRect that is
## only made visible while an amount is non-zero. `is_idle()` reports it.

const NODE_NAME := "__ScreenFx"
const SHADER := "res://shaders/flash.gdshader"
const SCREEN_SHADER := "res://shaders/fx_screen.gdshader"
const LOW_HEALTH_FRACTION := 0.3

## Screen-pass uniform names added to shaders/post_process.gdshader (all default 0).
const POST_PARAMS := {
	"blur": "fx_blur", "aberration": "fx_aberration",
	"darken": "fx_darken", "glow": "fx_glow", "focus": "fx_focus",
}

static var _instance: ScreenFx = null
## Engine.time_scale is global state: remember what we found so a crash or a freed
## node can never leave the game running in slow motion.
static var _time_scale_restore := 1.0
static var _time_scale_owner := 0

var low_health_enabled := true

var _rect: ColorRect
var _mat: ShaderMaterial
var _screen_rect: ColorRect
var _screen_mat: ShaderMaterial
var _flash := 0.0
var _flash_decay := 4.0
var _vignette := 0.0
var _vignette_decay := 2.0
var _vignette_hold := 0.0
var _aberration := 0.0
var _aberration_decay := 4.0
var _blur := 0.0
var _blur_decay := 4.0
var _darken := 0.0
var _darken_target := 0.0
var _darken_hold := 0.0
var _darken_rate := 2.0
var _glow := 0.0
var _glow_target := 0.0
var _glow_hold := 0.0
var _focus := Vector2(0.5, 0.5)
var _slow_left := 0.0
var _health_frac := 1.0
var _pulse_t := 0.0
var _screen_active := false
var _post_mat: ShaderMaterial = null


# --- access ---------------------------------------------------------------

static func get_instance() -> ScreenFx:
	if _instance != null and is_instance_valid(_instance):
		return _instance
	var loop := Engine.get_main_loop()
	if not (loop is SceneTree):
		return null
	var tree := loop as SceneTree
	if tree.root == null:
		return null
	var found: Node = tree.root.get_node_or_null(NODE_NAME)
	if found is ScreenFx:
		_instance = found
		return _instance
	var s := ScreenFx.new()
	s.name = NODE_NAME
	# deferred: get_instance() is often called from another node's _ready(), and the
	# scene tree root refuses a direct add_child() while it is setting children up
	tree.root.add_child.call_deferred(s)
	_instance = s
	return s

func _init() -> void:
	# built in _init so flash()/vignette() work even before the node enters the tree
	_build()

func _ready() -> void:
	layer = 90
	process_mode = Node.PROCESS_MODE_ALWAYS
	if Events != null:
		Events.health_changed.connect(_on_health_changed)
		# every explosion in the game (World.explode, ki blasts, Final Explosion) is
		# announced through Events.explosion; this is where the visuals hang off it
		if not Events.explosion.is_connected(ExplosionFx.on_event):
			Events.explosion.connect(ExplosionFx.on_event)

func _exit_tree() -> void:
	_restore_time_scale()

func _build() -> void:
	_rect = ColorRect.new()
	_rect.name = "Overlay"
	_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_rect.color = Color(1, 1, 1, 1)
	_mat = FxAssets.shader_material(SHADER, {
		"flash": 0.0, "vignette": 0.0, "aberration": 0.0, "use_screen": 0.0,
		"flash_color": Color(1, 1, 1), "vignette_color": Color(0.55, 0.0, 0.0),
	})
	_rect.material = _mat
	_rect.visible = false
	add_child(_rect)

	# the screen-reading pass, only used when the world has no PostProcess of its own
	_screen_rect = ColorRect.new()
	_screen_rect.name = "ScreenPass"
	_screen_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	_screen_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_screen_rect.color = Color(1, 1, 1, 1)
	_screen_mat = FxAssets.shader_material(SCREEN_SHADER, {
		"blur_amount": 0.0, "aberration": 0.0, "darken": 0.0, "glow_amount": 0.0,
		"focus": Vector2(0.5, 0.5),
	})
	_screen_rect.material = _screen_mat
	_screen_rect.visible = false
	add_child(_screen_rect)
	move_child(_screen_rect, 0)

# --- public (static wrappers) ---------------------------------------------

static func flash(color := Color(1, 1, 1), duration := 0.25, strength := 1.0) -> void:
	var s := get_instance()
	if s != null:
		s.do_flash(color, duration, strength)

static func vignette_pulse(color := Color(0.55, 0, 0), strength := 0.6, duration := 0.4) -> void:
	var s := get_instance()
	if s != null:
		s.do_vignette(color, strength, duration)

## Vignette that stays up for `hold` seconds before it fades (transformation strain).
static func vignette_hold(color: Color, strength: float, hold: float, fade := 0.6) -> void:
	var s := get_instance()
	if s != null:
		s.do_vignette(color, strength, fade)
		s._vignette_hold = maxf(s._vignette_hold, hold)

static func chromatic(amount := 0.006, duration := 0.35) -> void:
	var s := get_instance()
	if s != null:
		s.do_chromatic(amount, duration)

## Zoom blur towards the centre of the screen; decays over `duration`.
static func radial_blur(amount := 0.06, duration := 0.3) -> void:
	var s := get_instance()
	if s != null:
		s.do_radial_blur(amount, duration)

## The climax package: white flash, zoom blur, chromatic split and a hit-stop.
static func impact_pulse(strength := 1.0, color := Color(1, 1, 1)) -> void:
	var s := clampf(strength, 0.1, 1.5)
	flash(color, 0.35 * s, clampf(s, 0.0, 1.0))
	radial_blur(0.075 * s, 0.32)
	chromatic(0.008 * s, 0.32)

## Darken the scene (sky dim during the strain phase). Holds, then fades back.
static func dim(strength := 0.5, hold := 1.5, fade := 0.5) -> void:
	var s := get_instance()
	if s != null:
		s.do_dim(strength, hold, fade)

## Bloom-ish boost for the emissive fx (aura, ki spheres, beams).
static func glow(amount := 0.7, hold := 1.5, fade := 0.6) -> void:
	var s := get_instance()
	if s != null:
		s.do_glow(amount, hold, fade)

## Clear every sustained effect at once (a cinematic ending or being cancelled).
static func clear_sustained(fade := 0.35) -> void:
	var s := get_instance()
	if s != null:
		s.do_dim(0.0, 0.0, fade)
		s.do_glow(0.0, 0.0, fade)
		s._vignette_hold = 0.0

## Freeze the game for a few frames (punch impact, transformation climax).
static func hit_stop(seconds := 0.05) -> void:
	slow_mo(0.001, seconds)

## Slow motion with a guaranteed restore.
static func slow_mo(scale := 0.6, duration := 1.5) -> void:
	var s := get_instance()
	if s != null:
		s.do_slow_mo(scale, duration)

static func shake(strength := 0.5, duration := 0.3) -> void:
	if Events != null:
		Events.screen_shake.emit(strength, duration)
	if Game != null and Game.player != null:
		var rig: Variant = Game.player.get("camera_rig") if "camera_rig" in Game.player else null
		if rig != null and rig is Node and (rig as Node).has_method("shake"):
			(rig as Node).call("shake", strength, duration)

## Damage feedback in one call (used by HitFx).
static func damage_feedback(amount: float, crit: bool) -> void:
	var s := clampf(amount / 60.0, 0.1, 1.2)
	shake(s * (1.6 if crit else 1.0), 0.18 + s * 0.12)
	vignette_pulse(Color(0.6, 0.05, 0.05), clampf(s * 0.6, 0.1, 0.7), 0.35)
	if crit:
		flash(Color(1, 0.95, 0.8), 0.12, 0.45)

## True while nothing is being drawn by either overlay (the mobile "free when idle"
## contract the tests check).
static func is_idle() -> bool:
	var s := _instance
	if s == null or not is_instance_valid(s):
		return true
	return not s.overlay_visible() and not s.screen_pass_active()

func overlay_visible() -> bool:
	return _rect != null and _rect.visible

func screen_pass_active() -> bool:
	return _screen_active

# --- instance methods -----------------------------------------------------

func do_flash(color: Color, duration: float, strength := 1.0) -> void:
	if _mat == null:
		return
	_mat.set_shader_parameter("flash_color", color)
	_flash = clampf(strength, 0.0, 1.0)
	_flash_decay = 1.0 / maxf(0.03, duration)
	_rect.visible = true

func do_vignette(color: Color, strength: float, duration: float) -> void:
	if _mat == null:
		return
	_mat.set_shader_parameter("vignette_color", color)
	_vignette = maxf(_vignette, clampf(strength, 0.0, 1.0))
	_vignette_hold = duration * 0.35
	_vignette_decay = 1.0 / maxf(0.05, duration)
	_rect.visible = true

func do_chromatic(amount: float, duration: float) -> void:
	_aberration = maxf(_aberration, clampf(amount, 0.0, 0.05))
	_aberration_decay = _aberration / maxf(0.05, duration)
	_sync_screen()

func do_radial_blur(amount: float, duration: float) -> void:
	_blur = maxf(_blur, clampf(amount, 0.0, 0.25))
	_blur_decay = _blur / maxf(0.05, duration)
	_sync_screen()

func do_dim(strength: float, hold: float, fade: float) -> void:
	_darken_target = clampf(strength, 0.0, 1.0)
	_darken_hold = maxf(0.0, hold)
	_darken_rate = 1.0 / maxf(0.05, fade)
	_sync_screen()

func do_glow(amount: float, hold: float, fade: float) -> void:
	_glow_target = clampf(amount, 0.0, 2.0)
	_glow_hold = maxf(0.0, hold)
	_darken_rate = maxf(_darken_rate, 1.0 / maxf(0.05, fade))
	_sync_screen()

## Screen-space centre of the blur/aberration (defaults to the middle of the frame).
func set_focus(uv: Vector2) -> void:
	_focus = Vector2(clampf(uv.x, -0.5, 1.5), clampf(uv.y, -0.5, 1.5))

func do_slow_mo(scale: float, duration: float) -> void:
	if _time_scale_owner == 0:
		_time_scale_restore = Engine.time_scale
	_time_scale_owner = get_instance_id()
	Engine.time_scale = clampf(scale, 0.001, 4.0)
	# duration is measured in real time, so scale it back up
	_slow_left = maxf(0.01, duration)

static func _restore_time_scale() -> void:
	if _time_scale_owner != 0:
		Engine.time_scale = _time_scale_restore
		_time_scale_owner = 0

func _on_health_changed(current: float, maximum: float) -> void:
	_health_frac = current / maxf(1.0, maximum)

# --- per frame ------------------------------------------------------------

func _process(delta: float) -> void:
	# real time regardless of our own slow motion, clamped so the frame on which
	# Engine.time_scale changes cannot integrate a huge jump (FxAssets.real_delta)
	var real := FxAssets.real_delta(delta)
	if _slow_left > 0.0:
		_slow_left -= real
		if _slow_left <= 0.0:
			_restore_time_scale()
	_process_overlay(real)
	_process_screen(real)

func _process_overlay(real: float) -> void:
	if _mat == null:
		return
	if _flash > 0.0:
		_flash = maxf(0.0, _flash - _flash_decay * real)
		_mat.set_shader_parameter("flash", _flash)
	if _vignette_hold > 0.0:
		_vignette_hold -= real
	elif _vignette > 0.0:
		_vignette = maxf(0.0, _vignette - _vignette_decay * real)
	var low := 0.0
	if low_health_enabled and _health_frac < LOW_HEALTH_FRACTION:
		_pulse_t += real * 3.2
		var t := (1.0 - _health_frac / LOW_HEALTH_FRACTION)
		low = (0.28 + 0.22 * sin(_pulse_t)) * t
		_mat.set_shader_parameter("vignette_color", Color(0.6, 0.02, 0.02))
	_mat.set_shader_parameter("vignette", maxf(_vignette, low))
	var any := _flash > 0.001 or _vignette > 0.001 or low > 0.001
	_rect.visible = any

func _process_screen(real: float) -> void:
	if _aberration > 0.0:
		_aberration = maxf(0.0, _aberration - _aberration_decay * real)
	if _blur > 0.0:
		_blur = maxf(0.0, _blur - _blur_decay * real)
	if _glow_hold > 0.0:
		_glow_hold -= real
	elif _glow_target > 0.0:
		_glow_target = 0.0
	_glow = move_toward(_glow, _glow_target, _darken_rate * real * 2.0)
	if _darken_hold > 0.0:
		_darken_hold -= real
	elif _darken_target > 0.0:
		_darken_target = 0.0
	_darken = move_toward(_darken, _darken_target, _darken_rate * real)
	_sync_screen()

## Push the screen-pass amounts into the world's post-process material when there is
## one (no extra draw call) or into our own ColorRect when there is not.
func _sync_screen() -> void:
	var active := _blur > 0.0005 or _aberration > 0.0001 or _darken > 0.002 or _glow > 0.002
	if not active and not _screen_active:
		return                                   # idle: not a single uniform is touched
	var post := _post_material()
	if post != null:
		if active or _screen_active:
			post.set_shader_parameter(POST_PARAMS["blur"], _blur)
			post.set_shader_parameter(POST_PARAMS["aberration"], _aberration)
			post.set_shader_parameter(POST_PARAMS["darken"], _darken)
			post.set_shader_parameter(POST_PARAMS["glow"], _glow)
			post.set_shader_parameter(POST_PARAMS["focus"], _focus)
		if _screen_rect != null:
			_screen_rect.visible = false
		_screen_active = active
		return
	if _screen_mat != null and (active or _screen_active):
		_screen_mat.set_shader_parameter("blur_amount", _blur)
		_screen_mat.set_shader_parameter("aberration", _aberration)
		_screen_mat.set_shader_parameter("darken", _darken)
		_screen_mat.set_shader_parameter("glow_amount", _glow)
		_screen_mat.set_shader_parameter("focus", _focus)
	if _screen_rect != null:
		_screen_rect.visible = active
	_screen_active = active

## The world's post-process ShaderMaterial (scenes/fx/PostProcess.tscn, instanced by
## the sky controller). Duck-typed and re-checked when the scene changes.
func _post_material() -> ShaderMaterial:
	if _post_mat != null and is_instance_valid(_post_mat):
		return _post_mat
	_post_mat = null
	if Game == null or Game.world == null or not is_instance_valid(Game.world):
		return null
	# only reached while a screen effect is actually running, so this walk is rare
	_post_mat = _find_post(Game.world, 0)
	return _post_mat

static func _find_post(node: Node, depth: int) -> ShaderMaterial:
	if depth > 3 or node == null:
		return null
	for c in node.get_children():
		if c is CanvasLayer and String(c.name).find("PostProcess") >= 0:
			var rect := c.get_node_or_null("Rect")
			if rect is ColorRect and (rect as ColorRect).material is ShaderMaterial:
				var m := (rect as ColorRect).material as ShaderMaterial
				if m.shader != null and m.shader.code.find("fx_blur") >= 0:
					return m
				return null
		var deeper := _find_post(c, depth + 1)
		if deeper != null:
			return deeper
	return null
