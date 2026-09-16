class_name SlotGrid
## Inventory slot widgets shared by the bag, chest, furnace and crafting screens.
## Spec §3: 4-layer stack (bg black @0.35, selection (0.6,0.9,1.0 @0.35), icon, count 0.75).

const SEL_COLOR := Color(0.6, 0.9, 1.0, 0.35)
const BG_COLOR := Color(0, 0, 0, 0.35)

## One tappable slot. `source` is "inv" | "armor" | "craft" | "output" | "container" | "furnace".
class Slot extends Control:
	signal tapped(slot: Slot)

	var source := "inv"
	var index := 0
	var stack: ItemStack = null
	var selected := false
	var highlight := false
	var scale_px := 1.5
	var draw_bg := true
	var ghost_icon: Texture2D = null      # shown when the slot is empty (armor slot hints)
	var label_text := ""
	var border := false                   # draw an outline (crafting grid / output slot)

	func _init(src := "inv", i := 0) -> void:
		source = src
		index = i
		mouse_filter = Control.MOUSE_FILTER_STOP
		texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST

	func _gui_input(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			accept_event()
			tapped.emit(self)
		elif event is InputEventScreenTouch and event.pressed:
			accept_event()
			tapped.emit(self)

	func _draw() -> void:
		var r := Rect2(Vector2.ZERO, size)
		if draw_bg:
			draw_rect(r, SlotGrid.BG_COLOR)
		if selected:
			draw_rect(r, SlotGrid.SEL_COLOR)
		if border:
			draw_rect(r, Color(0.55, 0.78, 0.92, 0.75), false, maxf(1.0, 1.5 * scale_px))
		if highlight:
			draw_rect(r, Color(1, 1, 1, 0.12))
			draw_rect(r, Color(0.8, 0.95, 1.0, 0.8), false, maxf(1.0, 2.0 * scale_px))
		if stack != null and not stack.is_empty():
			var icon := UiUtil.item_icon(stack.item)
			if icon != null:
				var pad := size.x * 0.12
				draw_texture_rect(icon, Rect2(Vector2(pad, pad), size - Vector2(pad, pad) * 2.0), false)
			if stack.count > 1:
				var f := UiUtil.font()
				var fs := int(maxf(8.0, size.y * 0.32))
				var txt := str(stack.count)
				var w := f.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
				var p := size - Vector2(w + 2.0 * scale_px, 2.0 * scale_px)
				draw_string(f, p + Vector2(2, 2), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(0, 0, 0, 0.75))
				draw_string(f, p, txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color.WHITE)
			if stack.max_durability() > 0 and stack.durability < stack.max_durability():
				var frac := float(stack.durability) / float(stack.max_durability())
				var bh := maxf(2.0, 3.0 * scale_px)
				draw_rect(Rect2(Vector2(2, size.y - bh - 2), Vector2(size.x - 4, bh)), Color(0, 0, 0, 0.8))
				draw_rect(Rect2(Vector2(2, size.y - bh - 2), Vector2((size.x - 4) * frac, bh)),
					Color(1.0 - frac, frac, 0.1))
		elif ghost_icon != null:
			var pad2 := size.x * 0.18
			draw_texture_rect(ghost_icon, Rect2(Vector2(pad2, pad2), size - Vector2(pad2, pad2) * 2.0), false, Color(1, 1, 1, 0.25))
		elif label_text != "":
			var f2 := UiUtil.font()
			var fs2 := int(maxf(8.0, size.y * 0.3))
			draw_string(f2, Vector2(3.0 * scale_px, size.y * 0.65), label_text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs2, Color(1, 1, 1, 0.35))

static func make(source: String, index: int, cell: float, scale_px: float, on_tap: Callable) -> Slot:
	var sl := Slot.new(source, index)
	sl.custom_minimum_size = Vector2(cell, cell)
	sl.size = Vector2(cell, cell)
	sl.scale_px = scale_px
	if on_tap.is_valid():
		sl.tapped.connect(on_tap)
	return sl
