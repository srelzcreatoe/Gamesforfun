class_name RadialMenu
extends ScreenBase
## 8 slot technique / action wheel. Drag out from the centre to pick, release to fire.

const SLOTS := 8
const ICONS := ["radial/fly", "radial/aura", "radial/sprint", "radial/kaioken",
	"radial/kiweapon", "radial/ultimate", "radial/superforms", "radial/more"]

var entries: Array = []          # {label, icon, action: Callable}
var hover := -1
var centre := Vector2.ZERO
var radius := 150.0
var wheel: Control = null

func _init() -> void:
	screen_name = "radial"

func build() -> void:
	var shade := UiUtil.dim_background(self, 0.45)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_collect()
	radius = minf(size.y * 0.32, 220.0 * s / 1.5)
	centre = size * 0.5
	wheel = Control.new()
	wheel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	wheel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	wheel.draw.connect(_draw_wheel)
	add_child(wheel)
	content = wheel
	var hint := UiUtil.label("Drag to a technique and release", UiUtil.font_small(s), UiUtil.DIM_COLOR, HORIZONTAL_ALIGNMENT_CENTER)
	hint.size = Vector2(size.x, 30.0 * s)
	hint.position = Vector2(0.0, size.y - 46.0 * s)
	add_child(hint)

func _collect() -> void:
	entries.clear()
	var known: Array = Game.profile.get("techniques", []) if Game != null else []
	for tid in known:
		if entries.size() >= SLOTS - 2:
			break
		var def: Dictionary = Registry.technique(String(tid)) if Registry != null else {}
		var id := String(tid)
		entries.append({
			"label": String(def.get("name", id.capitalize())),
			"icon": null,
			"orb": UiUtil.color_hex(String(def.get("color", "#7FD4FF")), Color(0.5, 0.83, 1.0)),
			"action": func() -> void: _cast(id),
		})
	entries.append({"label": "Charge Ki", "icon": UiUtil.gui_tex("radial/aura"), "orb": null,
		"action": func() -> void: _hold("ki_charge")})
	entries.append({"label": "Fly", "icon": UiUtil.gui_tex("radial/fly"), "orb": null,
		"action": func() -> void: _toggle_fly()})
	while entries.size() < SLOTS:
		entries.append({"label": "", "icon": null, "orb": null, "action": Callable()})

func _draw_wheel() -> void:
	wheel.draw_circle(centre, radius + 42.0 * s / 1.5, Color(0.05, 0.07, 0.12, 0.72))
	wheel.draw_arc(centre, radius + 42.0 * s / 1.5, 0.0, TAU, 64, Color(0.45, 0.62, 0.85, 0.8), 2.0 * s, false)
	var f := UiUtil.font()
	var fs := UiUtil.font_small(s)
	for i in SLOTS:
		var a := -PI * 0.5 + TAU * float(i) / float(SLOTS)
		var p := centre + Vector2(cos(a), sin(a)) * radius
		var r := 30.0 * s
		var sel := i == hover
		var e: Dictionary = entries[i]
		var empty := String(e["label"]) == ""
		wheel.draw_circle(p, r, Color(0.1, 0.13, 0.2, 0.9 if not empty else 0.4))
		wheel.draw_arc(p, r - 1.0, 0.0, TAU, 32, Color(1.0, 0.9, 0.5, 0.95) if sel else Color(0.45, 0.62, 0.85, 0.7), 2.0 * s, false)
		if e["icon"] != null:
			wheel.draw_texture_rect(e["icon"], Rect2(p - Vector2(r, r) * 0.55, Vector2(r, r) * 1.1), false,
				Color(1, 1, 1, 1.0 if not empty else 0.3))
		elif e.get("orb") != null:
			var oc: Color = e["orb"]
			wheel.draw_circle(p, r * 0.5, Color(oc.r, oc.g, oc.b, 0.35))
			wheel.draw_circle(p, r * 0.34, oc)
			wheel.draw_circle(p, r * 0.16, Color(1, 1, 1, 0.9))
		if not empty:
			var w := f.get_string_size(String(e["label"]), HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
			wheel.draw_string(f, p + Vector2(-w * 0.5, r + fs), String(e["label"]),
				HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1, 1, 1, 0.95) if sel else Color(0.8, 0.85, 0.92, 0.9))
	wheel.draw_circle(centre, 18.0 * s, Color(0.15, 0.2, 0.3, 0.9))

func _slot_at(pos: Vector2) -> int:
	var d := pos - centre
	if d.length() < 32.0 * s:
		return -1
	var a := atan2(d.y, d.x) + PI * 0.5
	var i := int(round(a / (TAU / float(SLOTS))))
	return posmod(i, SLOTS)

func _gui_input(event: InputEvent) -> void:
	var pos := Vector2.INF
	var release := false
	if event is InputEventMouseMotion:
		pos = (event as InputEventMouseMotion).position
	elif event is InputEventScreenDrag:
		pos = (event as InputEventScreenDrag).position
	elif event is InputEventMouseButton:
		pos = (event as InputEventMouseButton).position
		release = not (event as InputEventMouseButton).pressed
	elif event is InputEventScreenTouch:
		pos = (event as InputEventScreenTouch).position
		release = not (event as InputEventScreenTouch).pressed
	if pos == Vector2.INF:
		return
	var h := _slot_at(pos)
	if h != hover:
		hover = h
		if wheel != null:
			wheel.queue_redraw()
		if h >= 0:
			UiUtil.click(0.3)
	if release:
		_pick(hover)

func _pick(i: int) -> void:
	if i < 0 or i >= entries.size():
		close_self()
		return
	var e: Dictionary = entries[i]
	var cb: Callable = e["action"]
	if cb.is_valid():
		cb.call()
	close_self()

func _cast(tech_id: String) -> void:
	var p: Node = Game.player if Game != null else null
	if p == null:
		return
	var check := Techniques.can_use(p, tech_id)
	if not bool(check.get("ok", false)):
		Game.ui.call("show_hint", String(check.get("reason", "Not ready.")), 2.0)
		return
	if not Techniques.tap(p, tech_id):
		Techniques.begin(p, tech_id)

func _hold(action: String) -> void:
	var p: Node = Game.player if Game != null else null
	if p == null:
		return
	var inp: Variant = p.get("input")
	if inp != null:
		inp.call("set_action", action, true)

func _toggle_fly() -> void:
	var p: Node = Game.player if Game != null else null
	if p == null:
		return
	var inp: Variant = p.get("input")
	if inp != null:
		inp.set("toggle_fly", true)
