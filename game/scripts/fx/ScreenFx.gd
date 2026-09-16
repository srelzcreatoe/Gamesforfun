class_name ScreenFx
extends CanvasLayer
## Full-screen feedback: flashes, damage vignette, low-health pulse, hit-stop /
## slow-motion and a cheap chromatic aberration (`shaders/flash.gdshader`).
##
## There is no autoload for fx, so the node is created lazily under the scene tree
## root the first time anything asks for it and lives as long as the game does:
##   ScreenFx.flash(Color(1,1,1), 0.25)
##   ScreenFx.vignette_pulse(Color(0.6,0,0), 0.6, 0.35)
##   ScreenFx.hit_stop(0.05)
##   ScreenFx.slow_mo(0.6, 1.5)
##   ScreenFx.chromatic(0.006, 0.4)
##   ScreenFx.shake(1.0, 0.5)          # forwards to the camera rig + Events.screen_shake

const NODE_NAME := "__ScreenFx"
const SHADER := "res://shaders/flash.gdshader"
const LOW_HEALTH_FRACTION := 0.3

static var _instance: ScreenFx = null
## Engine.time_scale is global state: remember what we found so a crash or a freed
## node can never leave the game running in slow motion.
static var _time_scale_restore := 1.0
static var _time_scale_owner := 0

var low_health_enabled := true

var _rect: ColorRect
var _mat: ShaderMaterial
var _flash := 0.0
var _flash_decay := 4.0
var _vignette := 0.0
var _vignette_decay := 2.0
var _vignette_hold := 0.0
var _aberration := 0.0
var _aberration_decay := 4.0
var _slow_left := 0.0
var _health_frac := 1.0
var _pulse_t := 0.0

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
	tree.root.add_child(s)
	_instance = s
	return s

func _ready() -> void:
	layer = 90
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build()
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

# --- public (static wrappers) ---------------------------------------------

static func flash(color := Color(1, 1, 1), duration := 0.25, strength := 1.0) -> void:
	var s := get_instance()
	if s != null:
		s.do_flash(color, duration, strength)

static func vignette_pulse(color := Color(0.55, 0, 0), strength := 0.6, duration := 0.4) -> void:
	var s := get_instance()
	if s != null:
		s.do_vignette(color, strength, duration)

static func chromatic(amount := 0.006, duration := 0.35) -> void:
	var s := get_instance()
	if s != null:
		s.do_chromatic(amount, duration)

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
	if _mat == null:
		return
	_aberration = clampf(amount, 0.0, 0.02)
	_aberration_decay = _aberration / maxf(0.05, duration)
	_mat.set_shader_parameter("use_screen", 1.0)
	_rect.visible = true

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

func _process(delta: float) -> void:
	# real time regardless of Engine.time_scale
	var real := delta / maxf(0.001, Engine.time_scale)
	if _slow_left > 0.0:
		_slow_left -= real
		if _slow_left <= 0.0:
			_restore_time_scale()
	if _mat == null:
		return
	if _flash > 0.0:
		_flash = maxf(0.0, _flash - _flash_decay * real)
		_mat.set_shader_parameter("flash", _flash)
	if _vignette_hold > 0.0:
		_vignette_hold -= real
	elif _vignette > 0.0:
		_vignette = maxf(0.0, _vignette - _vignette_decay * real)
	if _aberration > 0.0:
		_aberration = maxf(0.0, _aberration - _aberration_decay * real)
		_mat.set_shader_parameter("aberration", _aberration)
		if _aberration <= 0.0:
			_mat.set_shader_parameter("use_screen", 0.0)
	var low := 0.0
	if low_health_enabled and _health_frac < LOW_HEALTH_FRACTION:
		_pulse_t += real * 3.2
		var t := (1.0 - _health_frac / LOW_HEALTH_FRACTION)
		low = (0.28 + 0.22 * sin(_pulse_t)) * t
		_mat.set_shader_parameter("vignette_color", Color(0.6, 0.02, 0.02))
	_mat.set_shader_parameter("vignette", maxf(_vignette, low))
	var any := _flash > 0.001 or _vignette > 0.001 or _aberration > 0.0001 or low > 0.001
	_rect.visible = any
