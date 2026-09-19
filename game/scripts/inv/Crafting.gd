class_name Crafting
## Recipe matching (shaped 2x2/3x3 + shapeless), touch-friendly recipe lists and smelting lookups.
## Recipe schema: docs/DATA_SCHEMA.md recipes.json. Keys may map to one id or to a list of alternatives.

const STATIONS := ["hand", "crafting_table", "furnace", "kikono_station", "gete_forge"]
const FUEL_SECONDS := {
	"coal": 80.0, "charcoal": 80.0, "coal_block": 800.0, "lava_bucket": 1000.0, "stick": 5.0,
	"blaze_rod": 120.0, "kikono_dust": 160.0, "dried_kelp_block": 200.0, "bamboo": 2.5,
}

## Does a recipe belong to a station? Hand recipes are also craftable at a crafting table.
static func recipe_for_station(recipe: Dictionary, station: String) -> bool:
	var rs := String(recipe.get("station", "hand"))
	if rs == station:
		return true
	if station == "crafting_table" and rs == "hand":
		return true
	return false

static func recipes_for(station: String) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	if Registry == null:
		return out
	for r in Registry.recipes:
		if recipe_for_station(r, station):
			out.append(r)
	return out

static func result_item(recipe: Dictionary) -> String:
	return String(recipe.get("result", {}).get("item", ""))

static func result_count(recipe: Dictionary) -> int:
	return maxi(1, int(recipe.get("result", {}).get("count", 1)))

static func _options(v: Variant) -> Array:
	if v is Array:
		return v
	if v is String and v != "":
		return [v]
	return []

## Ingredient list as [{options: [ids], count: n}] merged by identical option sets.
static func ingredients(recipe: Dictionary) -> Array[Dictionary]:
	var merged: Dictionary = {}
	var order: Array = []
	var push := func(opts: Array) -> void:
		if opts.is_empty():
			return
		var key := ",".join(PackedStringArray(opts))
		if not merged.has(key):
			merged[key] = {"options": opts, "count": 0}
			order.append(key)
		merged[key]["count"] += 1
	if recipe.has("shape"):
		var keys: Dictionary = recipe.get("keys", {})
		for row in recipe["shape"]:
			for ch in String(row):
				if ch == " " or ch == ".":
					continue
				push.call(_options(keys.get(ch, [])))
	elif recipe.has("ingredients"):
		for ing in recipe["ingredients"]:
			push.call(_options(ing))
	elif recipe.has("input"):
		push.call(_options(recipe["input"]))
	var out: Array[Dictionary] = []
	for k in order:
		out.append(merged[k])
	return out

## How many of an ingredient (any of its options) the inventory holds.
static func have_count(inv: Inventory, options: Array) -> int:
	var total := 0
	for o in options:
		total += inv.count(String(o))
	return total

static func can_craft(recipe: Dictionary, inv: Inventory) -> bool:
	for ing in ingredients(recipe):
		if have_count(inv, ing["options"]) < int(ing["count"]):
			return false
	return true

## Consume ingredients from the inventory and add the result; atomic (refunds on no space).
static func craft_from_inventory(recipe: Dictionary, inv: Inventory) -> bool:
	if not can_craft(recipe, inv):
		return false
	var removed: Array = []
	for ing in ingredients(recipe):
		var need := int(ing["count"])
		for o in ing["options"]:
			if need <= 0:
				break
			var took := inv.remove(String(o), need)
			if took > 0:
				removed.append([String(o), took])
			need -= took
	var leftover := inv.add(result_item(recipe), result_count(recipe))
	if leftover > 0:
		inv.remove(result_item(recipe), result_count(recipe) - leftover)
		for r in removed:
			inv.add(r[0], r[1])
		return false
	return true

## [{recipe, can, needs: [{options, have, need}]}] for the touch recipe list; craftable first.
static func craftable_list(inv: Inventory, station: String) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for r in recipes_for(station):
		if r.has("input") and not r.has("shape") and not r.has("ingredients"):
			continue  # smelting recipes are not hand-craftable
		var needs: Array = []
		var can := true
		for ing in ingredients(r):
			var have := have_count(inv, ing["options"])
			needs.append({"options": ing["options"], "have": have, "need": int(ing["count"])})
			if have < int(ing["count"]):
				can = false
		out.append({"recipe": r, "can": can, "needs": needs})
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if a["can"] != b["can"]:
			return a["can"]
		return String(a["recipe"].get("id", "")) < String(b["recipe"].get("id", "")))
	return out

# --- grid matching -------------------------------------------------------------

## grid: item ids ("" for empty) laid out row-major with the given width (2 or 3). Returns the recipe or {}.
static func match_grid(grid: Array, width: int, station := "hand") -> Dictionary:
	var trimmed := _trim(grid, width)
	if trimmed["w"] == 0:
		return {}
	for r in recipes_for(station):
		if r.has("shape"):
			if _match_shaped(r, trimmed):
				return r
		elif r.has("ingredients"):
			if _match_shapeless(r, grid):
				return r
	return {}

static func _trim(grid: Array, width: int) -> Dictionary:
	var height := int(ceil(float(grid.size()) / float(width)))
	var minx := width
	var maxx := -1
	var miny := height
	var maxy := -1
	for y in height:
		for x in width:
			var i := y * width + x
			if i < grid.size() and String(grid[i]) != "":
				minx = mini(minx, x)
				maxx = maxi(maxx, x)
				miny = mini(miny, y)
				maxy = maxi(maxy, y)
	if maxx < 0:
		return {"w": 0, "h": 0, "cells": []}
	var cells: Array = []
	for y in range(miny, maxy + 1):
		for x in range(minx, maxx + 1):
			var i := y * width + x
			cells.append(String(grid[i]) if i < grid.size() else "")
	return {"w": maxx - minx + 1, "h": maxy - miny + 1, "cells": cells}

static func _shape_cells(recipe: Dictionary, mirrored: bool) -> Dictionary:
	var shape: Array = recipe["shape"]
	var keys: Dictionary = recipe.get("keys", {})
	var h := shape.size()
	var w := 0
	for row in shape:
		w = maxi(w, String(row).length())
	var cells: Array = []
	for y in h:
		var row := String(shape[y])
		for x in w:
			var xx := (w - 1 - x) if mirrored else x
			var ch := row[xx] if xx < row.length() else " "
			if ch == " " or ch == ".":
				cells.append([])
			else:
				cells.append(_options(keys.get(ch, [])))
	return {"w": w, "h": h, "cells": cells}

static func _match_shaped(recipe: Dictionary, trimmed: Dictionary) -> bool:
	for mirrored in [false, true]:
		var sc := _shape_cells(recipe, mirrored)
		if sc["w"] != trimmed["w"] or sc["h"] != trimmed["h"]:
			continue
		var ok := true
		for i in sc["cells"].size():
			var opts: Array = sc["cells"][i]
			var have := String(trimmed["cells"][i])
			if opts.is_empty():
				if have != "":
					ok = false
					break
			elif not opts.has(have):
				ok = false
				break
		if ok:
			return true
	return false

static func _match_shapeless(recipe: Dictionary, grid: Array) -> bool:
	var pool: Array = []
	for g in grid:
		if String(g) != "":
			pool.append(String(g))
	var ings: Array = recipe["ingredients"]
	if pool.size() != ings.size():
		return false
	for ing in ings:
		var opts := _options(ing)
		var found := -1
		for i in pool.size():
			if opts.has(pool[i]):
				found = i
				break
		if found < 0:
			return false
		pool.remove_at(found)
	return pool.is_empty()

# --- smelting -------------------------------------------------------------------

static func smelt_recipe(input_id: String) -> Dictionary:
	if Registry == null or input_id == "":
		return {}
	for r in Registry.recipes:
		if String(r.get("station", "")) == "furnace":
			if _options(r.get("input", "")).has(input_id):
				return r
	return {}

static func fuel_seconds(item_id: String) -> float:
	if item_id == "":
		return 0.0
	if FUEL_SECONDS.has(item_id):
		return float(FUEL_SECONDS[item_id])
	var d := Registry.item(item_id) if Registry != null else {}
	if d.has("fuel"):
		return float(d["fuel"])
	if d.get("kind", "") == "block":
		var b := Registry.block_by_name(item_id) if Registry != null else {}
		if String(b.get("material", "")) == "wood":
			return 15.0
	if item_id.ends_with("_planks") or item_id.ends_with("_log") or item_id.ends_with("_sapling") or item_id.ends_with("_fence"):
		return 15.0
	return 0.0
