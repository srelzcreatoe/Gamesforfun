class_name ToastLayer
extends Control
## Stacked toast notifications (Events.toast) in the top centre, plus the pickup pop sound.

const LIFETIME := 3.4
const MAX_TOASTS := 4

var _items: Array = []

func _ready() -> void:
	name = "ToastLayer"
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	process_mode = Node.PROCESS_MODE_ALWAYS
	Events.toast.connect(add_toast)
	Events.item_picked_up.connect(_on_pickup)

func _on_pickup(item_id: String, count: int) -> void:
	add_toast(UiUtil.item_name(item_id), "+%d" % count, UiUtil.item_icon(item_id))

func add_toast(title: String, text: String, icon: Texture2D = null) -> void:
	var s := UiUtil.s()
	var p := UiUtil.panel(UiUtil.nine(UiUtil.gui_tex("inventory"), Rect2(0, 164, 120, 33), 10, 1.0, s))
	var row := UiUtil.hbox(8.0 * s)
	if icon != null:
		row.add_child(UiUtil.icon_rect(icon, Vector2(28.0 * s, 28.0 * s)))
	var col := UiUtil.vbox(0.0)
	col.add_child(UiUtil.label(title, UiUtil.font_small(s), Color(1.0, 0.95, 0.7)))
	if text != "":
		col.add_child(UiUtil.dim(text, UiUtil.font_small(s)))
	row.add_child(col)
	p.add_child(row)
	add_child(p)
	p.reset_size()
	_items.append({"node": p, "t": LIFETIME})
	while _items.size() > MAX_TOASTS:
		var old: Dictionary = _items.pop_front()
		if is_instance_valid(old["node"]):
			old["node"].queue_free()
	Audio.play_sfx("pop", linear_to_db(0.8))
	_relayout()

func _relayout() -> void:
	var s := UiUtil.s()
	var ins := UiUtil.safe_insets(get_viewport())
	var y := 14.0 * s + ins.y
	for it in _items:
		var p: Control = it["node"]
		if not is_instance_valid(p):
			continue
		var sz := p.get_combined_minimum_size()
		p.size = sz
		p.position = Vector2(size.x - sz.x - 20.0 * s - ins.z, y)
		y += sz.y + 6.0 * s

func _process(delta: float) -> void:
	if _items.is_empty():
		return
	var keep: Array = []
	for it in _items:
		it["t"] = float(it["t"]) - delta
		var p: Control = it["node"]
		if not is_instance_valid(p):
			continue
		if float(it["t"]) <= 0.0:
			p.queue_free()
			continue
		p.modulate.a = clampf(float(it["t"]) / 0.6, 0.0, 1.0)
		keep.append(it)
	if keep.size() != _items.size():
		_items = keep
		_relayout()
