class_name ItemStack
extends RefCounted
## One inventory slot: item id, count, tool durability and free-form data. Empty when item == "" or count <= 0.

var item: String = ""
var count: int = 0
var durability: int = 0
var data: Dictionary = {}

static func make(item_id: String, n := 1, dur := -1) -> ItemStack:
	var st := ItemStack.new()
	st.item = item_id
	st.count = n
	if dur >= 0:
		st.durability = dur
	else:
		var d := Registry.item(item_id) if Registry != null else {}
		st.durability = int(d.get("tool", {}).get("durability", 0))
	return st

func is_empty() -> bool:
	return item == "" or count <= 0

func clear() -> void:
	item = ""
	count = 0
	durability = 0
	data = {}

func def() -> Dictionary:
	if is_empty() or Registry == null:
		return {}
	return Registry.item(item)

func kind() -> String:
	return String(def().get("kind", "misc"))

func display_name() -> String:
	if is_empty():
		return ""
	return String(def().get("name", item.capitalize()))

func max_stack() -> int:
	if is_empty():
		return 64
	return maxi(1, int(def().get("stack", 64)))

func max_durability() -> int:
	return int(def().get("tool", {}).get("durability", 0))

func can_merge(other: ItemStack) -> bool:
	if other == null or other.is_empty() or is_empty():
		return false
	return other.item == item and max_stack() > 1 and data == other.data

func copy() -> ItemStack:
	var st := ItemStack.new()
	st.item = item
	st.count = count
	st.durability = durability
	st.data = data.duplicate(true)
	return st

func copy_from(other: ItemStack) -> void:
	item = other.item
	count = other.count
	durability = other.durability
	data = other.data.duplicate(true)

## Take up to n items out into a new stack; returns the taken stack.
func take(n: int) -> ItemStack:
	var st := copy()
	st.count = clampi(n, 0, count)
	count -= st.count
	if count <= 0:
		clear()
	return st

func split_half() -> ItemStack:
	return take(int(ceil(float(count) / 2.0)))

## Reduce durability by 1; returns true if the tool broke.
func damage_tool(amount := 1) -> bool:
	if is_empty() or max_durability() <= 0:
		return false
	durability -= amount
	if durability <= 0:
		clear()
		return true
	return false

func to_dict() -> Variant:
	if is_empty():
		return null
	var d := {"item": item, "count": count}
	if durability > 0:
		d["durability"] = durability
	if not data.is_empty():
		d["data"] = data.duplicate(true)
	return d

static func from_dict(v: Variant) -> ItemStack:
	var st := ItemStack.new()
	if v is Dictionary:
		var d: Dictionary = v
		var id := String(d.get("item", ""))
		if id != "" and (Registry == null or Registry.has_item(id)):
			st.item = id
			st.count = clampi(int(d.get("count", 1)), 1, 999)
			st.durability = int(d.get("durability", 0))
			if st.durability <= 0:
				st.durability = int((Registry.item(id) if Registry != null else {}).get("tool", {}).get("durability", 0))
			var extra: Variant = d.get("data", {})
			if extra is Dictionary:
				st.data = extra.duplicate(true)
	return st

func _to_string() -> String:
	return "(empty)" if is_empty() else "%s x%d" % [item, count]
