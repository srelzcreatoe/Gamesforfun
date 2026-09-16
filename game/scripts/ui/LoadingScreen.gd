class_name LoadingScreen
extends ScreenBase
## In-world loading bar with rotating tips (spec §7).

const TIPS := [
	"Hold on the world to mine. Tools break blocks faster.",
	"Charge Ki to fill your ki bar, then tap Fly to take off.",
	"Senzu Beans restore everything at once. Save them.",
	"Masters teach techniques once you are strong enough.",
	"Sprinting drains hunger. Eat before a long trip.",
	"Dragon Balls hide across the planet. A radar points the way.",
	"Training points raise your stats from the Stats screen.",
	"Some blocks need a stronger tool tier before they drop.",
]

var bar: ProgressBar = null
var tip: Label = null
var pct: Label = null
var _tip_t := 0.0
var _tip_i := 0

func _init() -> void:
	screen_name = "loading"

func build() -> void:
	UiUtil.dirt_background(self, 0.22)
	var v := UiUtil.vbox(10.0 * s)
	v.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	add_child(v)
	content = v
	v.add_child(UiUtil.label("Loading world...", UiUtil.font_title(s), UiUtil.TITLE_COLOR, HORIZONTAL_ALIGNMENT_CENTER))
	var h := HBoxContainer.new()
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	bar = ProgressBar.new()
	bar.show_percentage = false
	bar.max_value = 1.0
	bar.step = 0.001
	bar.custom_minimum_size = Vector2(minf(520.0 * s, size.x * 0.7), 22.0 * s)
	bar.add_theme_stylebox_override("background", UiUtil.flat(Color(0, 0, 0, 0.6), Color(0.3, 0.35, 0.45), 2.0, 0.0, 0.0))
	bar.add_theme_stylebox_override("fill", UiUtil.flat(Color(0.45, 0.78, 0.45), Color(0.6, 0.9, 0.6), 0.0, 0.0, 0.0))
	h.add_child(bar)
	v.add_child(h)
	pct = UiUtil.label("0%", UiUtil.font_small(s), UiUtil.DIM_COLOR, HORIZONTAL_ALIGNMENT_CENTER)
	v.add_child(pct)
	_tip_i = randi() % TIPS.size()
	tip = UiUtil.label(TIPS[_tip_i], UiUtil.font_small(s), UiUtil.DIM_COLOR, HORIZONTAL_ALIGNMENT_CENTER)
	tip.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	tip.custom_minimum_size.x = minf(560.0 * s, size.x * 0.8)
	v.add_child(tip)

func _exit_tree() -> void:
	# The combat/world simulation freezes while paused_by_ui is true; make sure it is cleared
	# even when this screen was shown outside UiManager's stack.
	if Game != null and (Game.ui == null or not Game.ui.has_method("is_modal_open") \
			or not bool(Game.ui.call("is_modal_open"))):
		Game.paused_by_ui = false

func _process(delta: float) -> void:
	_tip_t -= delta
	if _tip_t <= 0.0:
		_tip_t = 5.0
		_tip_i = (_tip_i + 1) % TIPS.size()
		if tip != null:
			tip.text = TIPS[_tip_i]
	var p := float(args.get("progress", 0.0))
	if Game != null and Game.world != null and Game.world.has_method("load_progress"):
		p = float(Game.world.call("load_progress"))
	if bar != null:
		bar.value = clampf(p, 0.0, 1.0)
		pct.text = "%d%%" % int(round(clampf(p, 0.0, 1.0) * 100.0))
	if p >= 0.999 and screen_name != "":
		close_self()
