extends TestCase
## Recipe matching (shaped, mirrored, shapeless), the touch recipe list and furnace smelting.
## recipes.json is written by the data engineers in parallel, so these tests install their own
## recipes into Registry.recipes and remove them again in teardown.

var inv: Inventory
var _added: Array = []

func setup() -> void:
	inv = Inventory.new(Inventory.PLAYER_SIZE, true)
	_added.clear()

func teardown() -> void:
	for r in _added:
		var i := Registry.recipes.find(r)
		if i >= 0:
			Registry.recipes.remove_at(i)

func _item(i := 0) -> String:
	var cands := ["stone", "dirt", "cobblestone", "sand", "oak_log", "oak_planks"]
	var n := 0
	for c in cands:
		if Registry.has_item(c):
			if n == i:
				return c
			n += 1
	return "stone"

func _recipe(r: Dictionary) -> Dictionary:
	Registry.recipes.append(r)
	_added.append(r)
	return r

func test_shaped_recipe_matches_exact_shape() -> void:
	var a := _item(0)
	var out := _item(1)
	_recipe({"id": "t_pillar", "station": "hand", "shape": ["S", "S"], "keys": {"S": a},
		"result": {"item": out, "count": 2}})
	var grid := ["", "", a, a]
	assert_eq(Crafting.match_grid(grid, 2, "hand").get("id", ""), "", "wrong layout (horizontal) fails")
	var col := [a, "", a, ""]
	assert_eq(Crafting.match_grid(col, 2, "hand").get("id", ""), "t_pillar", "vertical pair matches")

func test_shaped_recipe_is_position_independent() -> void:
	var a := _item(0)
	_recipe({"id": "t_single", "station": "hand", "shape": ["S"], "keys": {"S": a}, "result": {"item": _item(1)}})
	for i in 4:
		var grid := ["", "", "", ""]
		grid[i] = a
		assert_eq(Crafting.match_grid(grid, 2, "hand").get("id", ""), "t_single", "slot %d" % i)

func test_shaped_recipe_mirrors() -> void:
	var a := _item(0)
	var b := _item(1)
	_recipe({"id": "t_mirror", "station": "hand", "shape": ["AB"], "keys": {"A": a, "B": b},
		"result": {"item": _item(2)}})
	assert_eq(Crafting.match_grid([a, b, "", ""], 2, "hand").get("id", ""), "t_mirror", "as written")
	assert_eq(Crafting.match_grid([b, a, "", ""], 2, "hand").get("id", ""), "t_mirror", "mirrored")

func test_shapeless_recipe_ignores_order() -> void:
	var a := _item(0)
	var b := _item(1)
	_recipe({"id": "t_shapeless", "station": "hand", "ingredients": [a, b], "result": {"item": _item(2)}})
	assert_eq(Crafting.match_grid([b, "", "", a], 2, "hand").get("id", ""), "t_shapeless", "any order")
	assert_eq(Crafting.match_grid([b, a, a, ""], 2, "hand").get("id", ""), "", "extra ingredient fails")

func test_shaped_alternatives_in_keys() -> void:
	var a := _item(0)
	var b := _item(1)
	_recipe({"id": "t_alt", "station": "hand", "shape": ["X"], "keys": {"X": [a, b]}, "result": {"item": _item(2)}})
	assert_eq(Crafting.match_grid([a, "", "", ""], 2, "hand").get("id", ""), "t_alt", "first option")
	assert_eq(Crafting.match_grid([b, "", "", ""], 2, "hand").get("id", ""), "t_alt", "second option")

func test_3x3_recipes_are_not_hand_craftable() -> void:
	var a := _item(0)
	_recipe({"id": "t_big", "station": "crafting_table", "shape": ["AAA", "AAA", "AAA"],
		"keys": {"A": a}, "result": {"item": _item(1)}})
	var grid9: Array = []
	for i in 9:
		grid9.append(a)
	assert_eq(Crafting.match_grid(grid9, 3, "crafting_table").get("id", ""), "t_big", "table matches")
	assert_eq(Crafting.match_grid([a, a, a, a], 2, "hand").get("id", ""), "", "hand does not")

func test_hand_recipes_also_work_at_the_table() -> void:
	var a := _item(0)
	var r := _recipe({"id": "t_hand", "station": "hand", "shape": ["A"], "keys": {"A": a}, "result": {"item": _item(1)}})
	assert_true(Crafting.recipe_for_station(r, "crafting_table"), "hand at table")
	assert_true(not Crafting.recipe_for_station(r, "furnace"), "not in the furnace")

func test_ingredients_are_merged_and_counted() -> void:
	var a := _item(0)
	var b := _item(1)
	var r := _recipe({"id": "t_count", "station": "hand", "shape": ["AA", "AB"], "keys": {"A": a, "B": b},
		"result": {"item": _item(2)}})
	var ing := Crafting.ingredients(r)
	assert_eq(ing.size(), 2, "two distinct ingredients")
	assert_eq(int(ing[0]["count"]), 3, "three of A")
	assert_eq(int(ing[1]["count"]), 1, "one of B")

func test_can_craft_and_craft_from_inventory() -> void:
	var a := _item(0)
	var out := _item(1)
	var r := _recipe({"id": "t_make", "station": "hand", "shape": ["AA"], "keys": {"A": a},
		"result": {"item": out, "count": 3}})
	assert_true(not Crafting.can_craft(r, inv), "no materials")
	inv.add(a, 2)
	assert_true(Crafting.can_craft(r, inv), "enough now")
	assert_true(Crafting.craft_from_inventory(r, inv), "crafted")
	assert_eq(inv.count(a), 0, "consumed")
	assert_eq(inv.count(out), 3, "produced")

func test_craftable_list_sorts_affordable_first() -> void:
	var a := _item(0)
	var b := _item(1)
	_recipe({"id": "z_affordable", "station": "hand", "shape": ["A"], "keys": {"A": a}, "result": {"item": _item(2)}})
	_recipe({"id": "a_unaffordable", "station": "hand", "shape": ["B"], "keys": {"B": b}, "result": {"item": _item(2)}})
	inv.add(a, 1)
	var list := Crafting.craftable_list(inv, "hand")
	var ids := PackedStringArray()
	for e in list:
		ids.append(String(e["recipe"].get("id", "")))
	var i_aff := ids.find("z_affordable")
	var i_un := ids.find("a_unaffordable")
	assert_true(i_aff >= 0 and i_un >= 0, "both listed")
	assert_true(i_aff < i_un, "craftable first")
	assert_true(bool(list[i_aff]["can"]), "flagged craftable")
	assert_eq(int(list[i_un]["needs"][0]["have"]), 0, "needs reported")

func test_smelting_recipes_are_excluded_from_the_craft_list() -> void:
	var a := _item(0)
	_recipe({"id": "t_smelt", "station": "furnace", "input": a, "result": {"item": _item(1)}, "time": 4})
	var list := Crafting.craftable_list(inv, "furnace")
	for e in list:
		assert_ne(String(e["recipe"].get("id", "")), "t_smelt", "smelting is not hand craftable")

func test_furnace_smelts_with_fuel() -> void:
	var raw := _item(0)
	var cooked := _item(1)
	_recipe({"id": "t_cook", "station": "furnace", "input": raw, "result": {"item": cooked, "count": 1}, "time": 2.0})
	var f := FurnaceStore.new()
	f.input = ItemStack.make(raw, 2)
	f.fuel = ItemStack.make("coal", 1) if Registry.has_item("coal") else ItemStack.make(_item(4), 1)
	assert_true(Crafting.fuel_seconds(f.fuel.item) > 0.0, "fuel burns: " + f.fuel.item)
	for i in 30:
		f.tick(0.1)
	assert_eq(f.output.item, cooked, "cooked something")
	assert_eq(f.output.count, 1, "one result")
	assert_eq(f.input.count, 1, "one input consumed")
	assert_true(f.is_lit(), "still burning")
	assert_true(f.burn_progress() > 0.0, "burn progress")

func test_furnace_without_fuel_does_nothing() -> void:
	var raw := _item(0)
	_recipe({"id": "t_cook2", "station": "furnace", "input": raw, "result": {"item": _item(1)}, "time": 1.0})
	var f := FurnaceStore.new()
	f.input = ItemStack.make(raw, 1)
	for i in 30:
		f.tick(0.1)
	assert_true(f.output.is_empty(), "no output")
	assert_true(not f.is_lit(), "not lit")

func test_furnace_roundtrip() -> void:
	var f := FurnaceStore.new()
	f.input = ItemStack.make(_item(0), 3)
	f.burn_left = 12.5
	f.burn_total = 80.0
	var d := f.to_dict()
	var g := FurnaceStore.new()
	g.from_dict(d)
	assert_eq(g.input.count, 3, "input")
	assert_near(g.burn_left, 12.5)
	assert_eq(g.to_dict()["type"], "furnace", "type tag")

func test_fuel_table() -> void:
	assert_near(Crafting.fuel_seconds("coal"), 80.0)
	assert_near(Crafting.fuel_seconds("stick"), 5.0)
	assert_eq(Crafting.fuel_seconds(""), 0.0, "nothing")
	assert_near(Crafting.fuel_seconds("oak_planks"), 15.0)
