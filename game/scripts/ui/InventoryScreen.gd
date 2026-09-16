class_name InventoryScreen
extends ScreenBase
## Bag / crafting / chest / furnace screen. Left column = the Minecraft-style inventory.png panel
## with armor slots, character preview and the crafting grid; right column = the touch friendly
## recipe list (CUBIC_WORLD_UI_SPEC.md §3). Opened as:
##   open("inventory")                       -> 2x2 hand crafting
##   open("inventory", {station: "crafting_table"})
##   open("inventory", {chest: Vector3i})    -> 27 slot storage crate
##   open("inventory", {furnace: Vector3i})  -> smelting

const PANEL := Rect2(0, 0, 176, 166)
const ARMOR_POS := [Vector2(8, 8), Vector2(8, 26), Vector2(8, 44), Vector2(8, 62)]
const CRAFT2_POS := [Vector2(98, 18), Vector2(116, 18), Vector2(98, 36), Vector2(116, 36)]
const OUTPUT_POS := Vector2(154, 28)
const PREVIEW_RECT := Rect2(26, 8, 50, 72)
const BACKPACK_ORIGIN := Vector2(8, 84)
const HOTBAR_ORIGIN := Vector2(8, 142)
const SLOT := 16.0
const PITCH := 18.0

static var container_store: ContainerStore = null

var station := "hand"
var grid_size := 2
var chest_pos: Variant = null
var furnace_pos: Variant = null
var container: Inventory = null
var furnace: FurnaceStore = null
var inv: Inventory = null
var craft: Array[ItemStack] = []

var k := 3.0                       # integer pixel scale of the inventory.png panel
var _slots: Array = []             # all Slot widgets
var _sel: Variant = null           # {source, index}
var _recipe_list: VBoxContainer = null
var _output_slot: SlotGrid.Slot = null
var _furnace_bar: ProgressBar = null
var _preview: CharacterPreview = null

func _init() -> void:
	screen_name = "inventory"

func refresh() -> void:
	rebuild()

func build() -> void:
	_read_args()
	UiUtil.dim_background(self, 0.55)
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	content = root
	k = maxf(2.0, floorf(minf(size.y * 0.80, 560.0) / PANEL.size.y))
	var panel_px := PANEL.size * k
	var right_w := minf(300.0 * s, maxf(180.0, size.x - panel_px.x - 80.0 * s))
	var total_w := panel_px.x + right_w + 16.0 * s
	var origin := Vector2((size.x - total_w) * 0.5, (size.y - panel_px.y) * 0.5)
	origin.y = clampf(origin.y, 8.0 * s + insets.y, size.y - panel_px.y - 8.0 * s)

	# --- title
	var title := UiUtil.label(_title_text(), UiUtil.font_body(s), UiUtil.TITLE_COLOR)
	title.position = origin - Vector2(0.0, UiUtil.font_body(s) * 1.5)
	root.add_child(title)

	# --- left: the inventory.png panel
	var left := Control.new()
	left.position = origin
	left.size = panel_px
	left.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(left)
	var bg := TextureRect.new()
	bg.texture = UiUtil.atlas(UiUtil.gui_tex("inventory"), PANEL, UiUtil.hd_factor(UiUtil.gui_tex("inventory")))
	bg.size = panel_px
	bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	bg.stretch_mode = TextureRect.STRETCH_SCALE
	bg.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	left.add_child(bg)
	_slots.clear()
	_build_armor(left)
	_build_preview(left)
	_build_crafting(left)
	_build_backpack(left)

	# --- optional container / furnace panel above
	if container != null:
		_build_container_panel(root, origin, panel_px)
	if furnace != null:
		_build_furnace_panel(root, origin, panel_px)

	# --- right: recipe list + buttons
	var right := VBoxContainer.new()
	right.position = origin + Vector2(panel_px.x + 16.0 * s, 0.0)
	right.size = Vector2(right_w, panel_px.y)
	right.add_theme_constant_override("separation", int(6.0 * s))
	root.add_child(right)
	right.add_child(UiUtil.label("Hand crafting" if station == "hand" else "Recipes", UiUtil.font_small(s), UiUtil.TITLE_COLOR))
	_recipe_list = UiUtil.vbox(4.0 * s)
	var scroll := UiUtil.scroll(_recipe_list, Vector2(right_w, minf(340.0 * s, panel_px.y - 100.0 * s)))
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	right.add_child(scroll)
	var actions := UiUtil.hbox(6.0 * s)
	actions.add_child(UiUtil.flat_button("Discard", _discard_selected, true, 120.0 * s))
	actions.add_child(UiUtil.flat_button("Close", close_self, false, 110.0 * s))
	right.add_child(actions)
	_fill_recipes()
	_sync_slots()
	Audio.play_sfx("click", linear_to_db(0.4))

func _read_args() -> void:
	station = String(args.get("station", "hand"))
	chest_pos = args.get("chest", null)
	furnace_pos = args.get("furnace", null)
	grid_size = 3 if station != "hand" else 2
	craft.clear()
	craft.resize(9)
	for i in 9:
		craft[i] = ItemStack.new()
	inv = _player_inventory()
	if container_store == null:
		container_store = ContainerStore.new()
	if Game != null and not Game.world_info.is_empty():
		container_store.planet = String(Game.world_info.get("planet", "earth"))
	container = null
	furnace = null
	if chest_pos != null:
		container = container_store.get_chest(chest_pos)
	if furnace_pos != null:
		furnace = container_store.get_furnace(furnace_pos)
		station = "furnace"
		grid_size = 0

func _player_inventory() -> Inventory:
	if Game != null and Game.player != null and Game.player.get("inventory") != null:
		return Game.player.get("inventory")
	var i := Inventory.new(Inventory.PLAYER_SIZE, true)
	if Game != null and Game.profile.has("inventory"):
		i.from_dict(Game.profile["inventory"])
	return i

func _title_text() -> String:
	if furnace != null:
		return "Furnace"
	if container != null:
		return "Storage Crate"
	if station == "crafting_table":
		return "Crafting Table"
	if station != "hand":
		return String(station).capitalize().replace("_", " ")
	return "Pack"

# --- slot construction -----------------------------------------------------

func _slot(parent: Control, source: String, index: int, pos: Vector2, cell := SLOT) -> SlotGrid.Slot:
	var sl := SlotGrid.make(source, index, cell * k, s, _on_slot_tapped)
	sl.position = pos * k
	sl.draw_bg = source != "inv" or true
	parent.add_child(sl)
	_slots.append(sl)
	return sl

func _build_armor(parent: Control) -> void:
	for i in 4:
		var sl := _slot(parent, "armor", i, ARMOR_POS[i])
		sl.label_text = ["H", "C", "L", "F"][i]

func _build_preview(parent: Control) -> void:
	var ch: Dictionary = Game.profile.get("character", {}) if Game != null else {}
	_preview = CharacterPreview.new(PREVIEW_RECT.size * k)
	_preview.position = PREVIEW_RECT.position * k
	var worn: Array = []
	if inv != null:
		for a in inv.armor:
			if not a.is_empty():
				worn.append(a.item)
	_preview.set_character(ch, worn)
	parent.add_child(_preview)

func _build_crafting(parent: Control) -> void:
	if furnace != null:
		return
	if grid_size == 2:
		for i in 4:
			_slot(parent, "craft", i, CRAFT2_POS[i]).border = true
	else:
		var cover := ColorRect.new()
		cover.color = Color(0.02, 0.05, 0.08, 0.88)
		cover.position = Vector2(86, 12) * k
		cover.size = Vector2(84, 58) * k
		cover.mouse_filter = Control.MOUSE_FILTER_IGNORE
		parent.add_child(cover)
		for r in 3:
			for c in 3:
				_slot(parent, "craft", r * 3 + c, Vector2(89 + c * 18, 15 + r * 18)).border = true
	_output_slot = _slot(parent, "output", 0, OUTPUT_POS)
	_output_slot.border = true

func _build_backpack(parent: Control) -> void:
	for r in 3:
		for c in 9:
			_slot(parent, "inv", 9 + r * 9 + c, BACKPACK_ORIGIN + Vector2(c * PITCH, r * PITCH))
	for c in 9:
		_slot(parent, "inv", c, HOTBAR_ORIGIN + Vector2(c * PITCH, 0.0))

func _build_container_panel(root: Control, origin: Vector2, panel_px: Vector2) -> void:
	var cell := SLOT * k
	var cols := 9
	var rows := int(ceil(float(container.size) / float(cols)))
	var w := float(cols) * PITCH * k + 8.0 * k
	var h := float(rows) * PITCH * k + 8.0 * k
	var p := Control.new()
	p.position = Vector2(origin.x, maxf(4.0 * s + insets.y, origin.y - h - 10.0 * s))
	p.size = Vector2(w, h)
	var frame := Panel.new()
	frame.add_theme_stylebox_override("panel", UiUtil.flat(UiUtil.PANEL_FILL, UiUtil.PANEL_BORDER, 2.0 * s, 0.0, 0.0))
	frame.size = p.size
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_child(frame)
	root.add_child(p)
	for i in container.size:
		var sl := SlotGrid.make("container", i, cell, s, _on_slot_tapped)
		sl.border = true
		sl.position = Vector2(4.0 * k + float(i % cols) * PITCH * k, 4.0 * k + float(i / cols) * PITCH * k)
		p.add_child(sl)
		_slots.append(sl)

func _build_furnace_panel(root: Control, origin: Vector2, panel_px: Vector2) -> void:
	var cell := SLOT * k
	var p := Control.new()
	p.position = Vector2(origin.x + 88.0 * k, origin.y + 12.0 * k)
	p.size = Vector2(80.0 * k, 58.0 * k)
	var frame := Panel.new()
	frame.add_theme_stylebox_override("panel", UiUtil.flat(Color(0.05, 0.06, 0.1, 0.9), UiUtil.PANEL_BORDER, 2.0 * s, 0.0, 0.0))
	frame.size = p.size
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_child(frame)
	root.add_child(p)
	var names := ["Input", "Fuel", "Out"]
	for i in 3:
		var sl := SlotGrid.make("furnace", i, cell, s, _on_slot_tapped)
		sl.position = Vector2(8.0 * k + float(i) * 24.0 * k, 10.0 * k)
		sl.label_text = names[i]
		sl.border = true
		p.add_child(sl)
		_slots.append(sl)
	_furnace_bar = ProgressBar.new()
	_furnace_bar.show_percentage = false
	_furnace_bar.max_value = 1.0
	_furnace_bar.step = 0.01
	_furnace_bar.position = Vector2(8.0 * k, 36.0 * k)
	_furnace_bar.size = Vector2(64.0 * k, 8.0 * k)
	p.add_child(_furnace_bar)

# --- slot interaction ------------------------------------------------------

func _stack_of(source: String, index: int) -> ItemStack:
	match source:
		"inv": return inv.stack_at(index)
		"armor": return inv.armor_stack(index)
		"craft": return craft[index]
		"container": return container.stack_at(index) if container != null else ItemStack.new()
		"furnace": return furnace.slot(index) if furnace != null else ItemStack.new()
		"output": return _craft_output()
	return ItemStack.new()

func _on_slot_tapped(sl: SlotGrid.Slot) -> void:
	UiUtil.click(0.4)
	if sl.source == "output":
		_take_output()
		return
	if _sel != null and String(_sel["source"]) == sl.source and int(_sel["index"]) == sl.index:
		_split(sl.source, sl.index)
		_sel = null
		_sync_slots()
		return
	if _sel == null:
		if not _stack_of(sl.source, sl.index).is_empty():
			_sel = {"source": sl.source, "index": sl.index}
		_sync_slots()
		return
	_move(String(_sel["source"]), int(_sel["index"]), sl.source, sl.index)
	_sel = null
	_sync_slots()
	_fill_recipes()

func _split(source: String, index: int) -> void:
	var st := _stack_of(source, index)
	if st.count < 2:
		return
	var half := st.split_half()
	if source == "inv" or source == "container":
		var target: Inventory = inv if source == "inv" else container
		var free := target.first_empty()
		if free < 0:
			st.count += half.count
			return
		target.slots[free] = half
		target.notify()
	else:
		var free2 := inv.first_empty()
		if free2 < 0:
			st.count += half.count
			return
		inv.slots[free2] = half
		inv.notify()

func _move(src: String, si: int, dst: String, di: int) -> void:
	# armor slots
	if dst == "armor":
		if src == "inv":
			inv.move_to_armor(si, di)
		return
	if src == "armor":
		if dst == "inv":
			inv.move_from_armor(si, di)
		return
	if src == "inv" and dst == "inv":
		inv.move(si, inv, di)
		return
	if src == "container" and dst == "container":
		container.move(si, container, di)
		return
	if src == "inv" and dst == "container":
		inv.move(si, container, di)
		return
	if src == "container" and dst == "inv":
		container.move(si, inv, di)
		return
	# crafting grid / furnace slots hold single stacks
	var a := _stack_of(src, si)
	var b := _stack_of(dst, di)
	var tmp := a.copy()
	_set_stack(src, si, b.copy())
	_set_stack(dst, di, tmp)
	inv.notify()

func _set_stack(source: String, index: int, st: ItemStack) -> void:
	match source:
		"inv": inv.slots[index] = st
		"armor": inv.armor[index] = st
		"craft": craft[index] = st
		"container":
			if container != null:
				container.slots[index] = st
		"furnace":
			if furnace != null:
				furnace.set_slot(index, st)

func _discard_selected() -> void:
	if _sel == null:
		Game.ui.call("show_hint", "Tap a stack first, then Discard.", 2.0)
		return
	var src := String(_sel["source"])
	var idx := int(_sel["index"])
	UiUtil.confirm(self, "Discard this stack forever?", "Discard", func() -> void:
		_set_stack(src, idx, ItemStack.new())
		inv.notify()
		_sel = null
		_sync_slots()
		_fill_recipes(), true)

# --- crafting --------------------------------------------------------------

func _grid_ids() -> Array:
	var out: Array = []
	var w := maxi(2, grid_size)
	for r in w:
		for c in w:
			out.append(craft[r * 3 + c].item)
	return out

func _matched_recipe() -> Dictionary:
	if grid_size <= 0:
		return {}
	return Crafting.match_grid(_grid_ids(), grid_size, "crafting_table" if grid_size == 3 else "hand")

func _craft_output() -> ItemStack:
	var r := _matched_recipe()
	if r.is_empty():
		return ItemStack.new()
	return ItemStack.make(Crafting.result_item(r), Crafting.result_count(r))

func _take_output() -> void:
	var r := _matched_recipe()
	if r.is_empty():
		return
	var out := ItemStack.make(Crafting.result_item(r), Crafting.result_count(r))
	if inv.add_stack(out) > 0:
		Game.ui.call("show_hint", "No room in your pack.", 2.0)
		return
	var w := maxi(2, grid_size)
	for rr in w:
		for cc in w:
			var st := craft[rr * 3 + cc]
			if not st.is_empty():
				st.count -= 1
				if st.count <= 0:
					st.clear()
	Audio.play_sfx("craft", linear_to_db(0.9))
	inv.notify()
	_sync_slots()
	_fill_recipes()

func _fill_recipes() -> void:
	if _recipe_list == null:
		return
	for c in _recipe_list.get_children():
		c.queue_free()
	var st := station if station != "furnace" else "furnace"
	var list := Crafting.craftable_list(inv, st)
	if list.is_empty():
		_recipe_list.add_child(UiUtil.dim("Nothing discovered yet...", UiUtil.font_small(s)))
		return
	var shown := 0
	for entry in list:
		if shown >= 60:
			break
		shown += 1
		_recipe_list.add_child(_recipe_row(entry))

func _recipe_row(entry: Dictionary) -> Control:
	var recipe: Dictionary = entry["recipe"]
	var can: bool = bool(entry["can"])
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UiUtil.panel_light())
	var row := UiUtil.hbox(6.0 * s)
	var item := Crafting.result_item(recipe)
	row.add_child(UiUtil.icon_rect(UiUtil.item_icon(item), Vector2(30.0 * s, 30.0 * s)))
	var col := UiUtil.vbox(0.0)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_child(UiUtil.label("%s x%d" % [UiUtil.item_name(item), Crafting.result_count(recipe)], UiUtil.font_small(s)))
	var parts := PackedStringArray()
	for n in entry["needs"]:
		parts.append("%s %d/%d" % [UiUtil.item_name(String(n["options"][0])), int(n["have"]), int(n["need"])])
	var ing := UiUtil.dim(", ".join(parts), UiUtil.font_small(s))
	ing.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	ing.custom_minimum_size.x = 170.0 * s
	col.add_child(ing)
	row.add_child(col)
	var b := UiUtil.flat_button("Craft", func() -> void:
		if Crafting.craft_from_inventory(recipe, inv):
			Audio.play_sfx("craft", linear_to_db(0.9))
			_sync_slots()
			_fill_recipes()
		else:
			Game.ui.call("show_hint", "Missing materials.", 1.5), false, 80.0 * s)
	b.disabled = not can
	b.modulate.a = 1.0 if can else 0.4
	row.add_child(b)
	p.add_child(row)
	return p

# --- sync ------------------------------------------------------------------

func _sync_slots() -> void:
	for sl in _slots:
		var slot: SlotGrid.Slot = sl
		slot.stack = _stack_of(slot.source, slot.index)
		slot.selected = _sel != null and String(_sel["source"]) == slot.source and int(_sel["index"]) == slot.index
		slot.queue_redraw()
	if _output_slot != null:
		_output_slot.stack = _craft_output()
		_output_slot.highlight = not _output_slot.stack.is_empty()
		_output_slot.queue_redraw()

func _process(delta: float) -> void:
	if furnace != null:
		furnace.tick(delta)
		if _furnace_bar != null:
			_furnace_bar.value = furnace.cook_progress()
		_sync_slots()

func _exit_tree() -> void:
	# Return anything left in the crafting grid so items are never lost.
	for st in craft:
		if st != null and not st.is_empty():
			inv.add_stack(st)
	if container_store != null:
		container_store.save_all()
	if Game != null and Game.player == null and Game.profile.has("inventory") and inv != null:
		Game.profile["inventory"] = inv.to_dict()
