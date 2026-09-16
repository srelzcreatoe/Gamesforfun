class_name Inventory
extends RefCounted
## Slot inventory. The player inventory has 36 slots (0-8 hotbar, 9-35 backpack) plus 4 armor slots
## (0 head, 1 chest, 2 legs, 3 feet). Containers use the same class with another size and no armor.

signal changed()

const PLAYER_SIZE := 36
const HOTBAR_SIZE := 9
const ARMOR_SLOTS := ["head", "chest", "legs", "feet"]

var slots: Array[ItemStack] = []
var armor: Array[ItemStack] = []
var hotbar_index: int = 0
var size: int = PLAYER_SIZE
var has_armor: bool = true

func _init(slot_count := PLAYER_SIZE, with_armor := true) -> void:
	size = slot_count
	has_armor = with_armor
	slots.resize(size)
	for i in size:
		slots[i] = ItemStack.new()
	if with_armor:
		armor.resize(4)
		for i in 4:
			armor[i] = ItemStack.new()

func notify() -> void:
	changed.emit()
	if Events != null and self == _player_inventory():
		Events.inventory_changed.emit()

static func _player_inventory() -> Inventory:
	if Game != null and Game.player != null and Game.player.get("inventory") != null:
		return Game.player.inventory
	return null

func get_stack(i: int) -> ItemStack:
	if i < 0 or i >= size:
		return ItemStack.new()
	return slots[i]

func set_stack(i: int, st: ItemStack) -> void:
	if i < 0 or i >= size:
		return
	slots[i] = st if st != null else ItemStack.new()
	notify()

func selected() -> ItemStack:
	return slots[clampi(hotbar_index, 0, mini(size, HOTBAR_SIZE) - 1)]

func select(i: int) -> void:
	var n := clampi(i, 0, mini(size, HOTBAR_SIZE) - 1)
	if n != hotbar_index:
		hotbar_index = n
		if Events != null and self == _player_inventory():
			Events.hotbar_changed.emit(n)

func stack_limit(item_id: String) -> int:
	if Registry == null:
		return 64
	var d := Registry.item(item_id)
	return maxi(1, int(d.get("stack", 64)))

## Add items; fills existing stacks first, then empty slots (hotbar first). Returns the leftover count.
func add(item_id: String, n: int, data: Dictionary = {}) -> int:
	if n <= 0 or item_id == "":
		return n
	if Registry != null and not Registry.has_item(item_id):
		return n
	var limit := stack_limit(item_id)
	var remaining := n
	if limit > 1:
		for st in slots:
			if not st.is_empty() and st.item == item_id and st.data == data and st.count < limit:
				var take := mini(limit - st.count, remaining)
				st.count += take
				remaining -= take
				if remaining == 0:
					notify()
					return 0
	for st in slots:
		if st.is_empty():
			var take := mini(limit, remaining)
			st.item = item_id
			st.count = take
			st.durability = int((Registry.item(item_id) if Registry != null else {}).get("tool", {}).get("durability", 0))
			st.data = data.duplicate(true)
			remaining -= take
			if remaining == 0:
				break
	if remaining != n:
		notify()
	return remaining

## Add a whole stack (keeps durability/data); returns the leftover count.
func add_stack(st: ItemStack) -> int:
	if st == null or st.is_empty():
		return 0
	if st.max_durability() > 0 or not st.data.is_empty():
		for slot in slots:
			if slot.is_empty():
				slot.copy_from(st)
				notify()
				return 0
		return st.count
	return add(st.item, st.count, st.data)

func count(item_id: String) -> int:
	var total := 0
	for st in slots:
		if not st.is_empty() and st.item == item_id:
			total += st.count
	return total

func has(item_id: String, n := 1) -> bool:
	return count(item_id) >= n

## Remove up to n items of a kind; returns how many were removed.
func remove(item_id: String, n: int) -> int:
	var left := n
	for st in slots:
		if left <= 0:
			break
		if not st.is_empty() and st.item == item_id:
			var take := mini(st.count, left)
			st.count -= take
			left -= take
			if st.count <= 0:
				st.clear()
	if left != n:
		notify()
	return n - left

func consume_selected(n := 1) -> void:
	var st := selected()
	if st.is_empty():
		return
	st.count -= n
	if st.count <= 0:
		st.clear()
	notify()

func is_full() -> bool:
	for st in slots:
		if st.is_empty():
			return false
	return true

func first_empty() -> int:
	for i in size:
		if slots[i].is_empty():
			return i
	return -1

func clear() -> void:
	for st in slots:
		st.clear()
	for st in armor:
		st.clear()
	notify()

func non_empty() -> Array[ItemStack]:
	var out: Array[ItemStack] = []
	for st in slots:
		if not st.is_empty():
			out.append(st)
	return out

## Move `amount` items (all when <= 0) from one slot to another (possibly in another inventory).
## Empty destination -> move; same item -> merge up to the stack size; otherwise swap (whole stacks only).
## Returns true when something changed.
func move(from_index: int, to_inv: Inventory, to_index: int, amount := 0) -> bool:
	if to_inv == null:
		return false
	if to_inv == self and from_index == to_index:
		return false
	var src := get_stack(from_index)
	var dst := to_inv.get_stack(to_index)
	if src.is_empty():
		return false
	if to_inv.has_armor and to_index >= to_inv.size:
		return false
	var n := src.count if amount <= 0 else mini(amount, src.count)
	if dst.is_empty():
		var moved := src.take(n)
		to_inv.slots[to_index] = moved
		_after_move(to_inv)
		return true
	if dst.can_merge(src):
		var space := dst.max_stack() - dst.count
		var take := mini(space, n)
		if take <= 0:
			return false
		dst.count += take
		src.count -= take
		if src.count <= 0:
			src.clear()
		_after_move(to_inv)
		return true
	if n < src.count:
		return false   # cannot swap a partial stack
	var tmp := dst.copy()
	to_inv.slots[to_index] = src.copy()
	slots[from_index] = tmp
	_after_move(to_inv)
	return true

func _after_move(other: Inventory) -> void:
	notify()
	if other != self:
		other.notify()

## Split half of a stack into the first empty slot; returns the destination index or -1.
func split(index: int) -> int:
	var src := get_stack(index)
	if src.is_empty() or src.count < 2:
		return -1
	var dst := first_empty()
	if dst < 0:
		return -1
	slots[dst] = src.split_half()
	notify()
	return dst

# --- armor -----------------------------------------------------------------

static func armor_slot_index(item_id: String) -> int:
	if Registry == null:
		return -1
	var d := Registry.item(item_id)
	if d.get("kind", "") != "armor":
		return -1
	return ARMOR_SLOTS.find(String(d.get("armor", {}).get("slot", "")))

func armor_stack(slot: int) -> ItemStack:
	if not has_armor or slot < 0 or slot > 3:
		return ItemStack.new()
	return armor[slot]

## Equip the stack at `index` into its armor slot; returns false if it is not armor. Previous armor swaps back.
func equip_armor(index: int) -> bool:
	var st := get_stack(index)
	if st.is_empty():
		return false
	var slot := armor_slot_index(st.item)
	if slot < 0 or not has_armor:
		return false
	var prev := armor[slot]
	armor[slot] = st.copy()
	slots[index] = prev
	notify()
	return true

func unequip_armor(slot: int) -> bool:
	if not has_armor or slot < 0 or slot > 3 or armor[slot].is_empty():
		return false
	var dst := first_empty()
	if dst < 0:
		return false
	slots[dst] = armor[slot]
	armor[slot] = ItemStack.new()
	notify()
	return true

## Moves between a normal slot and an armor slot (used by the UI tap-tap flow). `armor_index` 0..3.
func move_to_armor(from_index: int, armor_index: int) -> bool:
	var st := get_stack(from_index)
	if st.is_empty() or not has_armor:
		return false
	if armor_slot_index(st.item) != armor_index:
		return false
	var prev := armor[armor_index]
	armor[armor_index] = st.copy()
	slots[from_index] = prev
	notify()
	return true

func move_from_armor(armor_index: int, to_index: int) -> bool:
	if not has_armor or armor[armor_index].is_empty():
		return false
	var dst := get_stack(to_index)
	if not dst.is_empty():
		if armor_slot_index(dst.item) != armor_index:
			return false
		var tmp := dst.copy()
		slots[to_index] = armor[armor_index]
		armor[armor_index] = tmp
	else:
		slots[to_index] = armor[armor_index]
		armor[armor_index] = ItemStack.new()
	notify()
	return true

func armor_defense() -> float:
	var total := 0.0
	for st in armor:
		if not st.is_empty():
			total += float(st.def().get("armor", {}).get("defense", 0))
	return total

func armor_bonus(key: String) -> float:
	var total := 0.0
	for st in armor:
		if not st.is_empty():
			total += float(st.def().get("armor", {}).get("bonus", {}).get(key, 0.0))
	return total

# --- persistence -------------------------------------------------------------

func to_dict() -> Dictionary:
	var arr: Array = []
	arr.resize(size)
	for i in size:
		arr[i] = slots[i].to_dict()
	var d := {"slots": arr, "hotbar": hotbar_index}
	if has_armor:
		var a: Array = []
		for st in armor:
			a.append(st.to_dict())
		d["armor"] = a
	return d

func from_dict(d: Dictionary) -> void:
	var arr: Array = d.get("slots", [])
	for i in size:
		slots[i] = ItemStack.from_dict(arr[i]) if i < arr.size() else ItemStack.new()
	if has_armor:
		var a: Array = d.get("armor", [])
		for i in 4:
			armor[i] = ItemStack.from_dict(a[i]) if i < a.size() else ItemStack.new()
	hotbar_index = clampi(int(d.get("hotbar", 0)), 0, HOTBAR_SIZE - 1)
	notify()
