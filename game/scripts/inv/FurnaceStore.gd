class_name FurnaceStore
extends RefCounted
## Smelting state of one furnace block: input / fuel / output slots, burn and cook timers.

signal changed()

var input: ItemStack = ItemStack.new()
var fuel: ItemStack = ItemStack.new()
var output: ItemStack = ItemStack.new()
var burn_left: float = 0.0
var burn_total: float = 0.0
var cook_time: float = 0.0
var cook_total: float = 0.0

func is_lit() -> bool:
	return burn_left > 0.0

func burn_progress() -> float:
	return clampf(burn_left / burn_total, 0.0, 1.0) if burn_total > 0.0 else 0.0

func cook_progress() -> float:
	return clampf(cook_time / cook_total, 0.0, 1.0) if cook_total > 0.0 else 0.0

func slot(i: int) -> ItemStack:
	match i:
		0: return input
		1: return fuel
	return output

func set_slot(i: int, st: ItemStack) -> void:
	match i:
		0: input = st
		1: fuel = st
		_: output = st
	changed.emit()

func _can_smelt() -> Dictionary:
	if input.is_empty():
		return {}
	var r := Crafting.smelt_recipe(input.item)
	if r.is_empty():
		return {}
	var res := Crafting.result_item(r)
	if not output.is_empty():
		if output.item != res or output.count + Crafting.result_count(r) > output.max_stack():
			return {}
	return r

## Advance the furnace; call every frame (or in bulk after a reload with the elapsed time).
func tick(delta: float) -> void:
	var recipe := _can_smelt()
	var dirty := false
	if burn_left > 0.0:
		burn_left = maxf(0.0, burn_left - delta)
		dirty = true
	if not recipe.is_empty():
		if burn_left <= 0.0:
			var secs := Crafting.fuel_seconds(fuel.item) if not fuel.is_empty() else 0.0
			if secs > 0.0:
				burn_total = secs
				burn_left = secs
				fuel.count -= 1
				if fuel.count <= 0:
					fuel.clear()
				dirty = true
		if burn_left > 0.0:
			cook_total = maxf(0.5, float(recipe.get("time", 8.0)))
			cook_time += delta
			dirty = true
			if cook_time >= cook_total:
				cook_time = 0.0
				var res := Crafting.result_item(recipe)
				var n := Crafting.result_count(recipe)
				if output.is_empty():
					output = ItemStack.make(res, n)
				else:
					output.count += n
				input.count -= 1
				if input.count <= 0:
					input.clear()
	else:
		if cook_time > 0.0:
			cook_time = maxf(0.0, cook_time - delta * 2.0)
			dirty = true
	if dirty:
		changed.emit()

func is_empty() -> bool:
	return input.is_empty() and fuel.is_empty() and output.is_empty()

func all_stacks() -> Array[ItemStack]:
	var out: Array[ItemStack] = []
	for st in [input, fuel, output]:
		if not st.is_empty():
			out.append(st)
	return out

func to_dict() -> Dictionary:
	return {
		"type": "furnace", "input": input.to_dict(), "fuel": fuel.to_dict(), "output": output.to_dict(),
		"burn_left": burn_left, "burn_total": burn_total, "cook_time": cook_time, "cook_total": cook_total,
	}

func from_dict(d: Dictionary) -> void:
	input = ItemStack.from_dict(d.get("input"))
	fuel = ItemStack.from_dict(d.get("fuel"))
	output = ItemStack.from_dict(d.get("output"))
	burn_left = float(d.get("burn_left", 0.0))
	burn_total = float(d.get("burn_total", 0.0))
	cook_time = float(d.get("cook_time", 0.0))
	cook_total = float(d.get("cook_total", 0.0))
	changed.emit()
