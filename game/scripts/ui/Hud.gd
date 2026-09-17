class_name Hud
extends Control
## Touch HUD: look region, joystick, action buttons, hotbar, status bars, quest tracker,
## damage numbers and mining feedback. Layout and numbers: docs/CUBIC_WORLD_UI_SPEC.md §1.
## All pointers are tracked here so joystick + look + buttons work simultaneously.

const LOOK_MOVE_THRESHOLD := 6.0      # * s
const TAP_TIME := 0.26
const HOLD_TIME := 0.28
const GESTURE_WINDOW := 0.35
const CHARGED_BLAST_HOLD := 0.4
const TUTORIAL_INTERVAL := 9.0
const TUTORIAL_HINTS := [
	"Drag the left stick to move, drag the right side to look around.",
	"Hold on the world to mine the block you are looking at.",
	"Tap the world to place the selected block.",
	"Tap the bag button to open your pack and craft.",
	"Hold Charge to build ki, then tap Fly to take off.",
]

# Buttons: id -> {kind: "press"|"toggle"|"action", glyph, size, rect}
var buttons: Dictionary = {}
var button_order: PackedStringArray = PackedStringArray()

var s := 1.5
var left_handed := false
var input_enabled := true
var insets := Vector4.ZERO

var joystick: HudWidgets.Joystick = null
var hotbar: HudWidgets.Hotbar = null
var reticle: HudWidgets.Reticle = null
var hearts: HudWidgets.IconRow = null
var food: HudWidgets.IconRow = null
var armor: HudWidgets.IconRow = null
var ki_bar: HudWidgets.SpriteBar = null
var stamina_bar: HudWidgets.SpriteBar = null
var oxygen_bar: HudWidgets.SpriteBar = null
var target_bar: HudWidgets.TargetBar = null
var level_label: Label = null
var form_label: Label = null
var hint_label: Label = null
var saving_label: Label = null
var tracker: VBoxContainer = null
var coords_label: Label = null
var dev_tag: Label = null
var damage_layer: Control = null
var water_tint: ColorRect = null
var button_layer: Control = null

var _pointers: Dictionary = {}
var _look_owner := -1
var _joy_owner := -1
var _joy_home := Vector2.ZERO
var _hint_time := 0.0
var _tutorial_t := 3.0
var _tutorial_i := 0
var _gesture_low_t := -10.0
var _gesture_hits := 0
var _saving_t := 0.0
var _damage_numbers: Array = []
var _tracked_quest := ""

func _ready() -> void:
	name = "Hud"
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_refresh_metrics()
	_build()
	resized.connect(_on_resize)
	call_deferred("_on_resize")
	get_viewport().size_changed.connect(_on_resize)
	Events.settings_changed.connect(_on_settings)
	Events.health_changed.connect(func(c: float, m: float) -> void: _set_hearts(c, m))
	Events.hunger_changed.connect(func(c: float, m: float) -> void: food.value = c; food.maximum = m; food.queue_redraw())
	Events.ki_changed.connect(func(c: float, m: float) -> void: ki_bar.value = c / maxf(1.0, m); ki_bar.queue_redraw())
	Events.stamina_changed.connect(func(c: float, m: float) -> void: stamina_bar.value = c / maxf(1.0, m); stamina_bar.queue_redraw())
	Events.oxygen_changed.connect(_on_oxygen)
	Events.inventory_changed.connect(func() -> void: hotbar.queue_redraw())
	Events.hotbar_changed.connect(func(i: int) -> void: hotbar.selected = i; hotbar.queue_redraw())
	Events.hint.connect(show_hint)
	Events.damage_number.connect(_on_damage_number)
	Events.saving_started.connect(func() -> void: _saving_t = 1.2)
	Events.saving_finished.connect(func() -> void: _saving_t = 0.6)
	Events.target_changed.connect(func(_t: Node) -> void: pass)
	Events.tp_changed.connect(func(_a: int, _b: int) -> void: _update_labels())
	Events.stats_changed.connect(_update_labels)
	Events.form_changed.connect(func(_e: Node, _f: String) -> void: _update_labels())
	for sig in ["quest_started", "quest_tracked", "quest_completed", "quest_reward_claimed"]:
		Events.connect(sig, Callable(self, "_refresh_tracker").unbind(1))
	Events.quest_objective_progress.connect(func(_q: String, _i: int, _c: int, _r: int) -> void: _refresh_tracker())
	_refresh_tracker()
	_sync_from_player()

func _refresh_metrics() -> void:
	UiUtil.ensure_ui_settings()
	s = UiUtil.hud_s()
	left_handed = bool(Game.settings.get("left_handed", false)) if Game != null else false
	insets = UiUtil.safe_insets(get_viewport())

func _on_resize() -> void:
	if size.x < 16.0 or size.y < 16.0:
		size = get_viewport_rect().size
	_refresh_metrics()
	relayout()

func _on_settings() -> void:
	_refresh_metrics()
	_apply_opacity()
	relayout()

func player() -> Node:
	return Game.player if Game != null else null

func set_input_enabled(on: bool) -> void:
	input_enabled = on
	if not on:
		cancel_touches()
	if button_layer != null:
		button_layer.modulate.a = 1.0 if on else 0.35

# --- construction -----------------------------------------------------------

func _build() -> void:
	water_tint = ColorRect.new()
	water_tint.color = Color(0.1, 0.3, 0.6, 0.35)
	water_tint.mouse_filter = Control.MOUSE_FILTER_IGNORE
	water_tint.visible = false
	add_child(water_tint)

	reticle = HudWidgets.Reticle.new()
	add_child(reticle)

	joystick = HudWidgets.Joystick.new()
	add_child(joystick)

	button_layer = Control.new()
	button_layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(button_layer)
	_make_buttons()

	hotbar = HudWidgets.Hotbar.new()
	add_child(hotbar)

	var icons := UiUtil.gui_tex("icons")
	var icf := UiUtil.hd_factor(icons)
	hearts = _icon_row(icons, icf, UiUtil.R_HEART_BG, UiUtil.R_HEART_FULL, UiUtil.R_HEART_HALF, false)
	food = _icon_row(icons, icf, UiUtil.R_FOOD_BG, UiUtil.R_FOOD_FULL, UiUtil.R_FOOD_HALF, true)
	armor = _icon_row(icons, icf, UiUtil.R_ARMOR_EMPTY, UiUtil.R_ARMOR_FULL, UiUtil.R_ARMOR_HALF, false)
	armor.show_bg = false

	var xeno := UiUtil.hud_sheet("xenoversehud")
	var xf := UiUtil.hd_factor(xeno)
	ki_bar = _sprite_bar(xeno, xf, UiUtil.R_XENO_KI_BG, UiUtil.R_XENO_KI_SEG, Vector2(2.0, 2.0), Color(0.35, 0.8, 1.0))
	ki_bar.fill_region = Rect2(10, 81, 114, 4)
	ki_bar.tint = Color(0.45, 0.85, 1.0)
	stamina_bar = _sprite_bar(xeno, xf, UiUtil.R_XENO_STM_BG, UiUtil.R_XENO_STM_FILL, Vector2(15.0, 2.0), Color(1.0, 0.82, 0.25))
	oxygen_bar = HudWidgets.SpriteBar.new()
	oxygen_bar.fallback_color = Color(0.3, 0.65, 0.95, 0.95)
	oxygen_bar.visible = false
	add_child(oxygen_bar)

	target_bar = HudWidgets.TargetBar.new()
	target_bar.visible = false
	add_child(target_bar)

	level_label = UiUtil.label("", UiUtil.font_small(s), Color(0.9, 0.95, 1.0))
	add_child(level_label)
	form_label = UiUtil.label("", UiUtil.font_small(s), Color(1.0, 0.85, 0.35))
	add_child(form_label)
	saving_label = UiUtil.label("Saving...", UiUtil.font_small(s), Color(1, 1, 1, 0.8))
	saving_label.visible = false
	add_child(saving_label)

	tracker = UiUtil.vbox(2.0 * s)
	tracker.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(tracker)

	coords_label = UiUtil.label("", UiUtil.font_small(s), Color(0.85, 0.92, 1.0, 0.92))
	coords_label.visible = false
	add_child(coords_label)
	dev_tag = UiUtil.label("DEV", UiUtil.font_small(s), Color(1.0, 0.55, 0.35))
	dev_tag.visible = false
	add_child(dev_tag)

	hint_label = UiUtil.label("", UiUtil.font_body(s), Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
	hint_label.visible = false
	hint_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(hint_label)

	damage_layer = Control.new()
	damage_layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(damage_layer)

	_apply_opacity()

func _icon_row(sheet: Texture2D, f: float, bg: Rect2, full: Rect2, half: Rect2, rtl: bool) -> HudWidgets.IconRow:
	var row := HudWidgets.IconRow.new()
	row.sheet = sheet
	row.factor = f
	row.bg_region = bg
	row.full_region = full
	row.half_region = half
	row.right_to_left = rtl
	add_child(row)
	return row

func _sprite_bar(sheet: Texture2D, f: float, frame: Rect2, fill: Rect2, inset: Vector2, fb: Color) -> HudWidgets.SpriteBar:
	var bar := HudWidgets.SpriteBar.new()
	bar.sheet = sheet
	bar.factor = f
	bar.frame_region = frame
	bar.fill_region = fill
	bar.fill_inset = inset
	bar.fallback_color = fb
	add_child(bar)
	return bar

func _add_button(id: String, kind: String, glyph: String, diameter_units: float, tex_name := "") -> void:
	var tex: Texture2D = null
	if tex_name != "" and ResourceLoader.exists("res://assets/textures/gui/" + tex_name + ".png"):
		tex = UiUtil.gui_tex(tex_name)
	var b := HudWidgets.CircleButton.new(glyph, tex)
	button_layer.add_child(b)
	buttons[id] = {"kind": kind, "node": b, "units": diameter_units, "down": false}
	button_order.append(id)

func _make_buttons() -> void:
	# Vector glyphs where a literal shape reads better than the DMZ sprite.
	_add_button("jump", "press", "jump", 64.0)
	_add_button("sneak", "toggle", "sneak", 54.4)
	_add_button("sprint", "toggle", "sprint", 54.4)
	_add_button("attack", "press", "attack", 64.0)
	_add_button("ki_blast", "press", "ki_blast", 56.0)
	_add_button("ki_charge", "press", "charge", 56.0, "radial/aura")
	_add_button("fly", "toggle", "fly", 48.0, "radial/fly")
	_add_button("dash", "press", "dash", 48.0)
	_add_button("transform", "action", "transform", 48.0, "radial/superforms")
	_add_button("technique", "action", "technique", 48.0, "radial/ultimate")
	_add_button("lock_on", "action", "lock_on", 48.0)
	_add_button("pause", "action", "pause", 52.0)
	_add_button("camera", "action", "camera", 52.0)
	_add_button("quests", "action", "quests", 52.0)
	_add_button("stats", "action", "stats", 52.0)
	_add_button("bag", "action", "bag", 52.0)
	_add_button("dev", "action", "dev", 52.0)

func _apply_opacity() -> void:
	var op := float(Game.settings.get("button_opacity", 0.65)) if Game != null else 0.65
	for id in buttons.keys():
		var b: HudWidgets.CircleButton = buttons[id]["node"]
		b.opacity = clampf(op, 0.2, 1.0)
		b.queue_redraw()

# --- layout -----------------------------------------------------------------

func _from_bottom(x: float, y: float, w: float, h: float) -> Rect2:
	return Rect2(Vector2(x, size.y - y - h), Vector2(w, h))

func hotbar_rect() -> Rect2:
	var bw := minf(512.0 * s, size.x - 200.0 * s)
	var bh := 64.0 * s
	return _from_bottom((size.x - bw) * 0.5, 8.0 * s + insets.w, bw, bh)

func relayout() -> void:
	if joystick == null:
		return
	UiUtil.set_full_rect(water_tint)
	UiUtil.set_full_rect(reticle)
	UiUtil.set_full_rect(damage_layer)
	button_layer.position = Vector2.ZERO
	button_layer.size = size
	var js := 150.0 * s
	var jx := 30.0 * s + insets.x
	if left_handed:
		jx = size.x - 30.0 * s - js - insets.z
	var jr := _from_bottom(jx, 26.0 * s + insets.w, js, js)
	_joy_home = jr.position
	joystick.position = jr.position
	joystick.size = jr.size

	var bar := hotbar_rect()
	hotbar.position = bar.position
	hotbar.size = bar.size
	hotbar.cell = (bar.size.x - 8.0 * s) / 9.0
	hotbar.scale_px = s

	# status rows
	var icon := 17.0 * s
	var pitch := 18.0 * s
	hearts.icon_size = icon
	hearts.pitch = pitch
	food.icon_size = icon
	food.pitch = pitch
	armor.icon_size = icon
	armor.pitch = pitch
	var row_w := pitch * 10.0
	var hr := _from_bottom(bar.position.x + 4.0 * s, 77.0 * s + insets.w, row_w, icon)
	hearts.position = hr.position
	hearts.size = hr.size
	var fr := _from_bottom(bar.end.x - 4.0 * s - row_w, 77.0 * s + insets.w, row_w, icon)
	food.position = fr.position
	food.size = fr.size
	var ar := _from_bottom(bar.position.x + 4.0 * s, 95.0 * s + insets.w, row_w, icon)
	armor.position = ar.position
	armor.size = ar.size
	# oxygen bar (spec: 150*s x 6*s centred) lifted above the armor row so they never overlap
	var ox := _from_bottom((size.x - 150.0 * s) * 0.5, 115.0 * s + insets.w, 150.0 * s, 6.0 * s)
	oxygen_bar.position = ox.position
	oxygen_bar.size = ox.size
	# ki / stamina (xenoversehud) above the hearts
	var kr := _from_bottom(bar.position.x + 4.0 * s, 118.0 * s + insets.w, 236.0 * s, 16.0 * s)
	ki_bar.position = kr.position
	ki_bar.size = kr.size
	var sr := _from_bottom(bar.position.x + 4.0 * s, 137.0 * s + insets.w, 200.0 * s, 14.0 * s)
	stamina_bar.position = sr.position
	stamina_bar.size = sr.size
	level_label.add_theme_font_size_override("font_size", UiUtil.font_small(s))
	form_label.add_theme_font_size_override("font_size", UiUtil.font_small(s))
	level_label.position = _from_bottom(bar.position.x + 4.0 * s, 156.0 * s + insets.w, 300.0 * s, 16.0 * s).position
	form_label.position = _from_bottom(bar.position.x + 4.0 * s, 176.0 * s + insets.w, 300.0 * s, 16.0 * s).position
	saving_label.add_theme_font_size_override("font_size", UiUtil.font_small(s))
	saving_label.position = _from_bottom(14.0 * s + insets.x, 200.0 * s + insets.w, 200.0 * s, 16.0 * s).position

	target_bar.scale_px = s
	var tw := 300.0 * s
	target_bar.position = Vector2((size.x - tw) * 0.5, 72.0 * s + insets.y)
	target_bar.size = Vector2(tw, 18.0 * s)

	tracker.position = Vector2(14.0 * s + insets.x, 14.0 * s + insets.y)
	tracker.size = Vector2(280.0 * s, 160.0 * s)
	coords_label.add_theme_font_size_override("font_size", UiUtil.font_small(s))
	coords_label.size = Vector2(320.0 * s, 96.0 * s)
	_position_coords()
	dev_tag.add_theme_font_size_override("font_size", UiUtil.font_small(s))
	dev_tag.position = Vector2(size.x - 380.0 * s - insets.z, 14.0 * s + insets.y + 54.0 * s)

	hint_label.add_theme_font_size_override("font_size", UiUtil.font_body(s))
	hint_label.size = Vector2(minf(560.0 * s, size.x - 40.0 * s), 60.0 * s)
	hint_label.position = Vector2((size.x - hint_label.size.x) * 0.5, size.y - size.y * 0.68)

	_layout_buttons()
	reticle.scale_px = s

## The action columns need ~341 units of height; shrink the button scale on short screens
## (small phone + a large UI scale setting) so nothing leaves the viewport or hits the hotbar.
func button_scale() -> float:
	# Floor at 1.0 so the smallest (48 unit) button is never under the 48 px touch target.
	return clampf(minf(s, size.y / 420.0), 1.0, 3.0)

func _layout_buttons() -> void:
	var s := button_scale()
	var col_w := 64.0 * s
	var bx := size.x - col_w - 24.0 * s - insets.z
	var dir := -1.0
	if left_handed:
		bx = 24.0 * s + insets.x
		dir = 1.0
	var bx2 := bx + dir * 72.0 * s
	var bx3 := bx + dir * 134.0 * s
	var bottom := insets.w
	# On narrow screens the columns would sit on top of the centred hotbar: lift the whole
	# cluster above it instead of letting the two fight over the same pixels.
	var bar0 := hotbar_rect()
	var overlaps_bar := (bx3 < bar0.end.x + 6.0 * s) if not left_handed \
		else (bx3 + 48.0 * s > bar0.position.x - 6.0 * s)
	var dy := (bar0.size.y + 14.0 * s - 34.0 * s) if overlaps_bar else 0.0
	dy = maxf(0.0, dy)
	_place("jump", bx, 34.0 * s + bottom + dy)
	_place("sneak", bx + 4.8 * s, 108.0 * s + bottom + dy)
	_place("sprint", bx + 4.8 * s, 168.8 * s + bottom + dy)
	_place("attack", bx2, 34.0 * s + bottom + dy)
	_place("ki_blast", bx2 + 4.0 * s, 108.0 * s + bottom + dy)
	_place("ki_charge", bx2 + 4.0 * s, 172.0 * s + bottom + dy)
	_place("fly", bx3 + 8.0 * s, 44.0 * s + bottom + dy)
	_place("dash", bx3 + 8.0 * s, 104.0 * s + bottom + dy)
	# left-top cluster (mirrors with the handedness)
	var lx := 24.0 * s + insets.x
	if left_handed:
		lx = size.x - 24.0 * s - 48.0 * s - insets.z
	var ly := size.y * 0.74
	for i in ["transform", "technique", "lock_on"].size():
		pass
	var cluster := ["transform", "technique", "lock_on"]
	for i in cluster.size():
		_place(cluster[i], lx, ly - float(i) * 58.0 * s)
	# Top-right bar: never mirrored. Spec §1 puts Bag next to the hotbar, but the Dragon Block
	# action columns own that corner, so Bag joins this row instead.
	var ty := size.y - 66.0 * s - insets.y
	_place("pause", size.x - 66.0 * s - insets.z, ty)
	_place("camera", size.x - 130.0 * s - insets.z, ty)
	_place("quests", size.x - 194.0 * s - insets.z, ty)
	_place("stats", size.x - 258.0 * s - insets.z, ty)
	_place("bag", size.x - 322.0 * s - insets.z, ty)
	_place("dev", size.x - 386.0 * s - insets.z, ty)
	if buttons.has("dev"):
		var dev_on := UiUtil.dev_mode()
		(buttons["dev"]["node"] as Control).visible = dev_on

func _place(id: String, x: float, y_from_bottom: float) -> void:
	if not buttons.has(id):
		return
	var d: float = float(buttons[id]["units"]) * button_scale()
	var b: Control = buttons[id]["node"]
	var r := _from_bottom(x, y_from_bottom, d, d)
	b.position = r.position
	b.size = r.size
	b.queue_redraw()

func button_rect(id: String) -> Rect2:
	if not buttons.has(id):
		return Rect2()
	var b: Control = buttons[id]["node"]
	return Rect2(b.position, b.size)

# --- input ------------------------------------------------------------------

func cancel_touches() -> void:
	_pointers.clear()
	_look_owner = -1
	_joy_owner = -1
	if joystick != null:
		joystick.release()
	var p := player()
	if p != null:
		var inp: PlayerInput = p.get("input")
		if inp != null:
			inp.move = Vector2.ZERO
			inp.break_held = false
	for id in buttons.keys():
		if String(buttons[id]["kind"]) != "toggle":
			_set_button_down(id, false)

func _input(event: InputEvent) -> void:
	if not input_enabled or not is_visible_in_tree():
		return
	if event is InputEventScreenTouch:
		var t: InputEventScreenTouch = event
		if t.pressed:
			_touch_down(t.index, t.position)
		else:
			_touch_up(t.index, t.position)
		return
	if event is InputEventScreenDrag:
		var d: InputEventScreenDrag = event
		_touch_move(d.index, d.position, d.relative)

func _joystick_side(pos: Vector2) -> bool:
	if left_handed:
		return pos.x > 0.65 * size.x
	return pos.x < 0.35 * size.x

func _touch_down(index: int, pos: Vector2) -> void:
	# 1. action buttons
	for i in range(button_order.size() - 1, -1, -1):
		var id := button_order[i]
		var r := button_rect(id)
		if r.size.x > 0.0 and pos.distance_to(r.get_center()) <= r.size.x * 0.62:
			_pointers[index] = {"kind": "button", "id": id, "t": 0.0}
			_press_button(id)
			return
	# 2. hotbar
	var bar := hotbar_rect()
	if bar.has_point(pos):
		var slot := hotbar.slot_at(pos - bar.position)
		if slot >= 0:
			_pointers[index] = {"kind": "hotbar", "id": str(slot), "t": 0.0}
			var p := player()
			if p != null and p.has_method("select_hotbar"):
				p.call("select_hotbar", slot)
			UiUtil.click(0.5)
		return
	# 3. joystick side
	if _joy_owner < 0 and _joystick_side(pos):
		_joy_owner = index
		_pointers[index] = {"kind": "joy", "t": 0.0}
		joystick.active = true
		_recentre_joystick(pos)
		_joy_drag(pos)
		return
	# 4. look region
	if _look_owner < 0 and not _joystick_side(pos):
		_look_owner = index
		_pointers[index] = {"kind": "look", "t": 0.0, "moved": false, "acc": Vector2.ZERO}

func _touch_move(index: int, pos: Vector2, rel: Vector2) -> void:
	if not _pointers.has(index):
		return
	var pt: Dictionary = _pointers[index]
	match String(pt["kind"]):
		"joy":
			_joy_drag(pos)
		"look":
			var acc: Vector2 = pt["acc"]
			acc += rel
			pt["acc"] = acc
			if absf(acc.x) + absf(acc.y) > LOOK_MOVE_THRESHOLD * s:
				pt["moved"] = true
			var p := player()
			if p != null:
				var inp: PlayerInput = p.get("input")
				if inp != null:
					inp.add_look(rel)
					if bool(pt["moved"]):
						inp.break_held = false

func _touch_up(index: int, pos: Vector2) -> void:
	if not _pointers.has(index):
		return
	var pt: Dictionary = _pointers[index]
	match String(pt["kind"]):
		"button":
			_release_button(String(pt["id"]), float(pt["t"]))
		"joy":
			joystick.release()
			joystick.position = _joy_home
			_joy_owner = -1
			var p0 := player()
			if p0 != null:
				var inp0: PlayerInput = p0.get("input")
				if inp0 != null:
					inp0.move = Vector2.ZERO
					inp0.gesture_sprint = false
			_gesture_hits = 0
		"look":
			_look_owner = -1
			var p := player()
			var inp: PlayerInput = p.get("input") if p != null else null
			if inp != null:
				if not bool(pt["moved"]) and float(pt["t"]) < TAP_TIME:
					inp.world_tap = true
					UiUtil.vibrate(12)
				inp.break_held = false
	_pointers.erase(index)

## Put the stick under the thumb (clamped on-screen) so the first pixel of drag already moves.
func _recentre_joystick(pos: Vector2) -> void:
	var half := joystick.size * 0.5
	var want := pos - half
	var min_x := insets.x + 6.0 * s
	var max_x := size.x - insets.z - joystick.size.x - 6.0 * s
	var min_y := size.y * 0.32
	var max_y := size.y - insets.w - joystick.size.y - 6.0 * s
	joystick.position = Vector2(clampf(want.x, min_x, maxf(min_x, max_x)),
		clampf(want.y, min_y, maxf(min_y, max_y)))

func _joy_drag(pos: Vector2) -> void:
	var knob := joystick.drag_to(pos - joystick.position)
	var p := player()
	if p == null:
		return
	var inp: PlayerInput = p.get("input")
	if inp == null:
		return
	inp.move = Vector2(knob.x, -knob.y)
	# double-push sprint: knobY (up positive) crossing < 0.45 -> > 0.85 twice within 350 ms
	var up := -knob.y
	var now := float(Time.get_ticks_msec()) / 1000.0
	if up < 0.45:
		_gesture_low_t = now
	elif up > 0.85 and now - _gesture_low_t < GESTURE_WINDOW:
		_gesture_low_t = -10.0
		_gesture_hits += 1
		if _gesture_hits >= 2:
			inp.gesture_sprint = true
	if up < 0.2:
		inp.gesture_sprint = false
		_gesture_hits = 0

func _press_button(id: String) -> void:
	var kind := String(buttons[id]["kind"])
	UiUtil.click(0.6)
	match kind:
		"toggle":
			var b: HudWidgets.CircleButton = buttons[id]["node"]
			b.latched = not b.latched
			b.queue_redraw()
			_apply_toggle(id, b.latched)
		"press":
			_set_button_down(id, true)
			_apply_press(id, true)
		"action":
			_set_button_down(id, true)
			_do_action(id)

func _release_button(id: String, held: float) -> void:
	var kind := String(buttons[id]["kind"])
	if kind == "press":
		_set_button_down(id, false)
		_apply_press(id, false)
		if id == "ki_blast" and held >= CHARGED_BLAST_HOLD:
			var p := player()
			if p != null:
				var inp: PlayerInput = p.get("input")
				if inp != null:
					inp.ki_blast_charged = true
	elif kind == "action":
		_set_button_down(id, false)

func _set_button_down(id: String, down: bool) -> void:
	if not buttons.has(id):
		return
	var b: HudWidgets.CircleButton = buttons[id]["node"]
	b.down = down
	b.queue_redraw()

func _apply_press(id: String, down: bool) -> void:
	var p := player()
	if p == null:
		return
	var inp: PlayerInput = p.get("input")
	if inp == null:
		return
	inp.set_action(id, down)
	if down and id == "attack":
		UiUtil.vibrate(40)

func _apply_toggle(id: String, on: bool) -> void:
	var p := player()
	if p == null:
		return
	var inp: PlayerInput = p.get("input")
	if inp == null:
		return
	if id == "fly":
		inp.toggle_fly = true
		return
	inp.set_action(id, on)

func _do_action(id: String) -> void:
	var p := player()
	var inp: PlayerInput = p.get("input") if p != null else null
	match id:
		"transform":
			if inp != null:
				inp.transform_pressed = true
		"technique":
			if Game != null and Game.ui != null:
				Game.ui.call("open", "radial", {})
		"lock_on":
			if inp != null:
				inp.lock_on_pressed = true
		"pause":
			if Game != null and Game.ui != null:
				Game.ui.call("open", "pause")
		"camera":
			if p != null and p.get("camera_rig") != null:
				(p.get("camera_rig") as CameraRig).cycle_mode()
		"quests":
			if Game != null and Game.ui != null:
				Game.ui.call("open", "quests")
		"stats":
			if Game != null and Game.ui != null:
				Game.ui.call("open", "stats")
		"bag":
			if Game != null and Game.ui != null:
				Game.ui.call("open", "inventory")
		"dev":
			if Game != null and Game.ui != null:
				Game.ui.call("open", "dev")

# --- per frame --------------------------------------------------------------

func _process(delta: float) -> void:
	for idx in _pointers.keys():
		var pt: Dictionary = _pointers[idx]
		pt["t"] = float(pt["t"]) + delta
		if String(pt["kind"]) == "look" and not bool(pt["moved"]) and float(pt["t"]) >= HOLD_TIME:
			var p := player()
			if p != null:
				var inp: PlayerInput = p.get("input")
				if inp != null:
					inp.break_held = true
	_sync_from_player()
	_update_hint(delta)
	_update_damage_numbers(delta)
	_update_coords(delta)
	if _saving_t > 0.0:
		_saving_t = maxf(0.0, _saving_t - delta)
	saving_label.visible = _saving_t > 0.0

func _sync_from_player() -> void:
	var p := player()
	if p == null:
		reticle.progress = 0.0
		reticle.show_crosshair = false
		reticle.queue_redraw()
		return
	if hotbar.inventory == null:
		hotbar.inventory = p.get("inventory")
		hotbar.queue_redraw()
	hotbar.selected = int(p.get("hotbar_index"))
	_set_hearts(float(p.get("health")), float(p.get("max_health")))
	var sv: Variant = p.get("survival")
	if sv is PlayerStats:
		food.value = (sv as PlayerStats).hunger
		food.maximum = PlayerStats.HUNGER_MAX
		food.queue_redraw()
	ki_bar.value = float(p.get("ki")) / maxf(1.0, float(p.get("max_ki")))
	stamina_bar.value = float(p.get("stamina")) / maxf(1.0, float(p.get("max_stamina")))
	ki_bar.queue_redraw()
	stamina_bar.queue_redraw()
	var inv: Inventory = p.get("inventory")
	if inv != null:
		var pts := 0.0
		for a in inv.armor:
			if not a.is_empty():
				pts += float(a.def().get("armor", {}).get("defense", 2))
		armor.value = clampf(pts, 0.0, 20.0)
		armor.visible = pts > 0.0
		armor.queue_redraw()
	var ia: Variant = p.get("interaction")
	reticle.progress = float(ia.call("break_fraction")) if (ia != null and ia.has_method("break_fraction")) else 0.0
	var cam: Variant = p.get("camera_rig")
	reticle.show_crosshair = reticle.progress <= 0.0 and (cam == null or int(cam.get("mode")) != CameraRig.Mode.FRONT)
	reticle.queue_redraw()
	if cam != null and cam.get("mode") != null and p.has_method("set_model_visible"):
		p.call("set_model_visible", int(cam.get("mode")) != CameraRig.Mode.FIRST)
	# The post-process pass owns the underwater tint when SkyController exposes it.
	var own_tint := true
	if cam != null and cam.has_method("sky_handles_underwater"):
		own_tint = not bool(cam.call("sky_handles_underwater"))
	water_tint.visible = own_tint and p.has_method("head_in_liquid") and bool(p.call("head_in_liquid"))
	_update_target_bar(p)
	_update_labels()
	_update_button_feedback(p)

## Charge ring on Ki Blast / Technique and a cooldown shade from the combat engineer's API.
func _update_button_feedback(p: Node) -> void:
	var charge := Techniques.charge_progress(p)
	var state := Techniques.state_of(p)
	for id in ["ki_blast", "technique"]:
		if not buttons.has(id):
			continue
		var b: HudWidgets.CircleButton = buttons[id]["node"]
		var np := charge if state == 1 else 0.0
		var nc := 0.0
		if id == "ki_blast":
			nc = clampf(Techniques.cooldown_left(p, "ki_blast") / 1.0, 0.0, 1.0)
		if absf(np - b.progress) > 0.01 or absf(nc - b.cooldown) > 0.01:
			b.progress = np
			b.cooldown = nc
			b.queue_redraw()
	if buttons.has("fly"):
		var fb: HudWidgets.CircleButton = buttons["fly"]["node"]
		var flying := bool(p.get("is_flying"))
		if fb.latched != flying:
			fb.latched = flying
			fb.queue_redraw()

func _set_hearts(current: float, maximum: float) -> void:
	# 20 half-units on screen regardless of the real max health
	var half := 20.0 * clampf(current / maxf(1.0, maximum), 0.0, 1.0)
	hearts.value = half
	hearts.maximum = 20.0
	hearts.queue_redraw()

func _on_oxygen(current: float, maximum: float) -> void:
	oxygen_bar.value = clampf(current / maxf(0.001, maximum), 0.0, 1.0)
	oxygen_bar.visible = current < maximum - 0.01
	oxygen_bar.queue_redraw()

func _update_target_bar(p: Node) -> void:
	var t: Variant = p.get("target")
	if t == null or not is_instance_valid(t):
		target_bar.visible = false
		return
	var n: Node = t
	var hp := float(n.get("health")) if n.get("health") != null else 0.0
	var hm := float(n.get("max_health")) if n.get("max_health") != null else 1.0
	var nm := String(n.get("entity_type"))
	if Registry != null:
		nm = String(Registry.entity(nm).get("name", nm.capitalize()))
	target_bar.title = "%s  %d/%d" % [nm, int(hp), int(hm)]
	target_bar.value = hp / maxf(1.0, hm)
	target_bar.visible = true
	target_bar.queue_redraw()

func _update_labels() -> void:
	var p := player()
	if p == null:
		return
	var st: Variant = p.get("stats")
	var lvl := 1
	if st != null and st.has_method("level"):
		lvl = int(st.call("level"))
	var tp := Training.tp(p)
	var bp := ""
	if st != null and st.has_method("battle_power"):
		bp = "    BP %d" % int(st.call("battle_power"))
	level_label.text = "Lv %d    TP %d%s" % [lvl, tp, bp]
	var form := String(p.get("current_form"))
	if form != "" and Registry != null:
		form = String(Registry.form(form).get("name", form)).capitalize()
	form_label.text = form
	form_label.visible = form != ""

# --- hints / toasts / damage numbers ---------------------------------------

func show_hint(text: String, seconds := 5.0) -> void:
	hint_label.text = text
	hint_label.visible = true
	_hint_time = seconds
	Audio.play_sfx("toast_tutorial", -10.0)

func _update_hint(delta: float) -> void:
	if _hint_time > 0.0:
		_hint_time = maxf(0.0, _hint_time - delta)
		hint_label.modulate.a = clampf(_hint_time, 0.0, 1.0)
		if _hint_time <= 0.0:
			hint_label.visible = false
		return
	if Game == null or Game.world == null:
		return
	if _tutorial_i >= TUTORIAL_HINTS.size():
		return
	_tutorial_t -= delta
	if _tutorial_t <= 0.0:
		_tutorial_t = TUTORIAL_INTERVAL
		show_hint(TUTORIAL_HINTS[_tutorial_i], 5.0)
		_tutorial_i += 1

func _on_damage_number(pos: Vector3, amount: float, crit: bool, color: Color) -> void:
	var l := UiUtil.label(("%d!" % int(round(amount))) if crit else str(int(round(amount))),
		UiUtil.font_body(s) if not crit else UiUtil.font_title(s), color)
	damage_layer.add_child(l)
	_damage_numbers.append({"node": l, "pos": pos, "t": 1.1})

func _update_damage_numbers(delta: float) -> void:
	if _damage_numbers.is_empty():
		return
	var cam := get_viewport().get_camera_3d()
	var keep: Array = []
	for d in _damage_numbers:
		var l: Label = d["node"]
		d["t"] = float(d["t"]) - delta
		if float(d["t"]) <= 0.0 or not is_instance_valid(l):
			if is_instance_valid(l):
				l.queue_free()
			continue
		var wpos: Vector3 = d["pos"] + Vector3(0, 1.0 - float(d["t"]) * 0.5, 0)
		if cam != null and not cam.is_position_behind(wpos):
			l.position = cam.unproject_position(wpos) - l.size * 0.5
			l.visible = true
		else:
			l.visible = false
		l.modulate.a = clampf(float(d["t"]), 0.0, 1.0)
		keep.append(d)
	_damage_numbers = keep

# --- quest tracker ----------------------------------------------------------

## F3-lite readout under the quest tracker (Settings > Display > Show coordinates).
var _coords_t := 0.0

func _update_coords(delta: float) -> void:
	var want := bool(UiUtil.setting("show_coordinates", false))
	var dev := UiUtil.dev_mode()
	if dev_tag.visible != dev:
		dev_tag.visible = dev
	if buttons.has("dev"):
		var b: Control = buttons["dev"]["node"]
		if b.visible != dev:
			b.visible = dev
	if coords_label.visible != want:
		coords_label.visible = want
	if not want:
		return
	_coords_t -= delta
	if _coords_t > 0.0:
		return
	_coords_t = 0.2
	var p := player()
	if p == null or not (p is Node3D):
		coords_label.text = ""
		return
	var pos: Vector3 = (p as Node3D).global_position
	var rig: Variant = p.get("camera_rig")
	var yaw := float(rig.get("yaw_deg")) if rig != null else rad_to_deg(float(p.get("yaw")))
	var lines := PackedStringArray()
	lines.append("XYZ %.1f / %.1f / %.1f" % [pos.x, pos.y, pos.z])
	lines.append("Facing %s (%.0f)  Chunk %d, %d" % [_compass(yaw), wrapf(yaw, -180.0, 180.0),
		int(floor(pos.x / 16.0)), int(floor(pos.z / 16.0))])
	var w: Node = p.get("world")
	if w != null:
		var biome := "-"
		if w.has_method("get_biome"):
			biome = String(w.call("get_biome", int(floor(pos.x)), int(floor(pos.z))))
			if Registry != null:
				biome = String(Registry.biome(biome).get("name", biome))
		var planet := String(w.get("planet_id")) if w.get("planet_id") != null else "-"
		if Registry != null:
			planet = String(Registry.planet(planet).get("name", planet))
		lines.append("Planet %s   Biome %s" % [planet, biome])
		if w.get("time_ticks") != null:
			lines.append("Time %04d   %d fps" % [int(w.get("time_ticks")), Engine.get_frames_per_second()])
	coords_label.text = "\n".join(lines)

static func _compass(yaw_deg: float) -> String:
	var y := wrapf(yaw_deg, 0.0, 360.0)
	var names := ["N", "NW", "W", "SW", "S", "SE", "E", "NE"]
	return names[int(round(y / 45.0)) % 8]

## The readout hangs under whatever the quest tracker actually occupies, so it never collides
## with the left button cluster when there is no quest.
func _position_coords() -> void:
	if coords_label == null or tracker == null:
		return
	var h := tracker.get_combined_minimum_size().y
	coords_label.position = Vector2(14.0 * s + insets.x, tracker.position.y + h + 6.0 * s)

func _refresh_tracker() -> void:
	for c in tracker.get_children():
		c.queue_free()
	if Game == null:
		return
	var quests: Dictionary = Game.profile.get("quests", {})
	var qid := String(quests.get("tracked", ""))
	var active: Dictionary = quests.get("active", {})
	if qid == "" or not active.has(qid):
		if active.is_empty():
			return
		qid = String(active.keys()[0])
	var def: Dictionary = Registry.quest(qid) if Registry != null else {}
	if def.is_empty():
		return
	var title := UiUtil.label(String(def.get("title", def.get("name", qid))), UiUtil.font_small(s), Color(1.0, 0.9, 0.5))
	tracker.add_child(title)
	var prog: Array = active.get(qid, {}).get("objectives", [])
	var objs: Array = def.get("objectives", [])
	for i in objs.size():
		var o: Dictionary = objs[i]
		var need := int(o.get("count", 1))
		var have := int(prog[i]) if i < prog.size() else 0
		var text := "%s %d/%d" % [_objective_text(o), mini(have, need), need]
		var done := have >= need
		tracker.add_child(UiUtil.label(("[x] " if done else "[ ] ") + text, UiUtil.font_small(s),
			Color(0.6, 0.9, 0.6) if done else UiUtil.DIM_COLOR))
	call_deferred("_position_coords")

func _objective_text(o: Dictionary) -> String:
	match String(o.get("type", "")):
		"KILL": return "Defeat " + String(o.get("entity_name", o.get("entity", "enemy")))
		"TALK": return "Talk to " + String(o.get("npc_name", o.get("npc", "someone")))
		"OBTAIN": return "Collect " + UiUtil.item_name(String(o.get("item", "")))
		"GO_TO": return "Travel to " + String(o.get("biome", o.get("structure", "the marker")))
		"INTERACT": return "Interact with " + String(o.get("block", "the object"))
		"SUMMON": return "Summon " + String(o.get("dragon", "the dragon"))
		"SKILL": return "Learn " + String(o.get("skill", "a skill"))
		"TRAIN": return "Spend training points"
		"WAIT": return "Wait"
	return String(o.get("desc", "Objective"))
