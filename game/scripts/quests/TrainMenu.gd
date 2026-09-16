class_name TrainMenu
extends CanvasLayer
## Master training / barter overlay used by `DialogController` (the UI's dialog screen
## has no page for a master's `teaches` list). Plain Controls so it never depends on
## the UI agent's theme being finished.

const PANEL_W := 460.0
const ROW_H := 30.0

var controller: Node = null
var master_id := ""
var master: Dictionary = {}
var _root: Control = null
var _list: VBoxContainer = null

func _init() -> void:
	name = "TrainMenu"
	layer = 12

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	if Registry != null:
		master = Registry.masters.get(master_id, {})
	_build()

func s() -> float:
	return Game.ui_scale() if Game != null else 1.0

func _build() -> void:
	var sc := s()
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(_root)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.45)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(dim)
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.06, 0.08, 0.07, 0.96)
	sb.border_color = Color(0.45, 0.62, 0.4)
	sb.set_border_width_all(int(maxf(2.0, 2.0 * sc)))
	sb.content_margin_left = 14.0 * sc
	sb.content_margin_right = 14.0 * sc
	sb.content_margin_top = 12.0 * sc
	sb.content_margin_bottom = 12.0 * sc
	panel.add_theme_stylebox_override("panel", sb)
	panel.size = Vector2(minf(PANEL_W * sc, get_viewport().get_visible_rect().size.x - 24.0),
		minf(340.0 * sc, get_viewport().get_visible_rect().size.y - 24.0))
	panel.position = (get_viewport().get_visible_rect().size - panel.size) * 0.5
	_root.add_child(panel)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", int(5.0 * sc))
	panel.add_child(col)
	col.add_child(_label("%s — Training" % String(master.get("name", master_id.capitalize())), 15, Color(1.0, 0.9, 0.5)))
	col.add_child(_label("Training points: %d" % _tp(), 12, Color(0.75, 0.85, 0.95)))
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", int(4.0 * sc))
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_list)
	col.add_child(scroll)
	var close := Button.new()
	close.text = "Leave"
	close.custom_minimum_size = Vector2(120.0 * sc, ROW_H * sc)
	close.pressed.connect(func() -> void: queue_free())
	col.add_child(close)
	refresh()

func refresh() -> void:
	if _list == null:
		return
	for c in _list.get_children():
		c.queue_free()
	var sc := s()
	var offers: Array = []
	if controller != null and controller.has_method("teach_options"):
		offers = controller.call("teach_options", master_id)
	if offers.is_empty():
		_list.add_child(_label("I have nothing left to teach you.", 12, Color(0.75, 0.75, 0.75)))
	for o in offers:
		if not (o is Dictionary):
			continue
		var d: Dictionary = o
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", int(8.0 * sc))
		var text := String(d.get("name", "?"))
		if String(d.get("kind", "")) == "skill":
			text += "  Lv %d/%d" % [int(d.get("level", 0)), int(d.get("max_level", 1))]
		var l := _label(text, 12, Color.WHITE if bool(d.get("affordable", false)) else Color(0.7, 0.7, 0.7))
		l.custom_minimum_size.x = 230.0 * sc
		row.add_child(l)
		var b := Button.new()
		b.text = "%d TP" % int(d.get("cost", 0))
		b.disabled = not bool(d.get("affordable", false))
		b.custom_minimum_size = Vector2(110.0 * sc, ROW_H * sc)
		var kind := String(d.get("kind", ""))
		var id := String(d.get("id", ""))
		b.pressed.connect(func() -> void: _buy(kind, id))
		row.add_child(b)
		_list.add_child(row)
	var barter: Array = []
	if controller != null and controller.has_method("shop_offers"):
		barter = controller.call("shop_offers", master_id)
	if barter.is_empty():
		return
	_list.add_child(_label("Trade", 13, Color(1.0, 0.9, 0.5)))
	for i in barter.size():
		var t: Dictionary = barter[i]
		var row2 := HBoxContainer.new()
		row2.add_theme_constant_override("separation", int(8.0 * sc))
		var l2 := _label(String(t.get("text", "")), 12, Color.WHITE)
		l2.custom_minimum_size.x = 230.0 * sc
		row2.add_child(l2)
		var b2 := Button.new()
		b2.text = "Trade"
		b2.custom_minimum_size = Vector2(110.0 * sc, ROW_H * sc)
		var idx := i
		b2.pressed.connect(func() -> void: _trade(idx))
		row2.add_child(b2)
		_list.add_child(row2)

func _buy(kind: String, id: String) -> void:
	if controller != null and controller.has_method("teach"):
		controller.call("teach", master_id, kind, id)
	refresh()

func _trade(index: int) -> void:
	if controller != null and controller.has_method("trade"):
		controller.call("trade", master_id, index)
	refresh()

func _tp() -> int:
	if Game == null:
		return 0
	return int(Game.profile.get("tp", 0))

func _label(text: String, size_px: int, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", int(maxf(10.0, float(size_px) * s())))
	l.add_theme_color_override("font_color", color)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l
