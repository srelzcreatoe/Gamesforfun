extends TestCase
## Inventory add / remove / merge / split / swap / armor / persistence.

var inv: Inventory

func setup() -> void:
	inv = Inventory.new(Inventory.PLAYER_SIZE, true)

func _id(i := 0) -> String:
	# Blocks are always registered as items, so these ids exist even before items.json lands.
	var candidates := ["stone", "dirt", "cobblestone", "sand", "oak_log"]
	for c in candidates:
		if Registry.has_item(c):
			if i == 0:
				return c
			i -= 1
	return "stone"

func test_add_fills_and_reports_leftover() -> void:
	var a := _id(0)
	assert_eq(inv.add(a, 10), 0, "fits")
	assert_eq(inv.count(a), 10, "counted")
	assert_true(inv.has(a, 10), "has")
	assert_true(not inv.has(a, 11), "not more")
	var limit := inv.stack_limit(a)
	var left := inv.add(a, limit * Inventory.PLAYER_SIZE)
	assert_true(left > 0, "overflow reported, got %d" % left)
	assert_true(inv.is_full(), "full")

func test_add_merges_into_partial_stacks_first() -> void:
	var a := _id(0)
	var limit := inv.stack_limit(a)
	inv.add(a, limit - 3)
	assert_eq(inv.first_empty(), 1, "one slot used")
	inv.add(a, 3)
	assert_eq(inv.first_empty(), 1, "merged, still one slot")
	assert_eq(inv.stack_at(0).count, limit, "topped up")

func test_add_unknown_item_is_rejected() -> void:
	assert_eq(inv.add("definitely_not_an_item", 4), 4, "all leftover")
	assert_eq(inv.first_empty(), 0, "nothing stored")

func test_remove_spans_stacks() -> void:
	var a := _id(0)
	var limit := inv.stack_limit(a)
	inv.add(a, limit + 5)
	assert_eq(inv.remove(a, limit + 1), limit + 1, "removed")
	assert_eq(inv.count(a), 4, "left")
	assert_eq(inv.remove(a, 99), 4, "removes what is there")
	assert_eq(inv.count(a), 0, "empty")

func test_move_to_empty_slot() -> void:
	inv.add(_id(0), 7)
	assert_true(inv.move(0, inv, 20), "moved")
	assert_true(inv.stack_at(0).is_empty(), "source empty")
	assert_eq(inv.stack_at(20).count, 7, "destination")

func test_move_merges_same_item_up_to_the_stack_size() -> void:
	var a := _id(0)
	var limit := inv.stack_limit(a)
	inv.set_stack(0, ItemStack.make(a, limit - 2))
	inv.set_stack(1, ItemStack.make(a, 5))
	assert_true(inv.move(1, inv, 0), "merged")
	assert_eq(inv.stack_at(0).count, limit, "filled")
	assert_eq(inv.stack_at(1).count, 3, "remainder stays")

func test_move_swaps_different_items() -> void:
	var a := _id(0)
	var b := _id(1)
	inv.set_stack(0, ItemStack.make(a, 4))
	inv.set_stack(1, ItemStack.make(b, 9))
	assert_true(inv.move(0, inv, 1), "swap")
	assert_eq(inv.stack_at(0).item, b, "b moved down")
	assert_eq(inv.stack_at(0).count, 9, "count kept")
	assert_eq(inv.stack_at(1).item, a, "a moved up")

func test_move_partial_onto_another_item_is_refused() -> void:
	inv.set_stack(0, ItemStack.make(_id(0), 4))
	inv.set_stack(1, ItemStack.make(_id(1), 9))
	assert_true(not inv.move(0, inv, 1, 2), "no partial swap")
	assert_eq(inv.stack_at(0).count, 4, "unchanged")

func test_split_half_goes_to_the_first_empty_slot() -> void:
	inv.set_stack(0, ItemStack.make(_id(0), 7))
	var dst := inv.split(0)
	assert_eq(dst, 1, "first empty")
	assert_eq(inv.stack_at(1).count, 4, "ceil(7/2)")
	assert_eq(inv.stack_at(0).count, 3, "remainder")
	assert_eq(inv.split(5), -1, "empty slot cannot split")

func test_split_of_single_item_refused() -> void:
	inv.set_stack(0, ItemStack.make(_id(0), 1))
	assert_eq(inv.split(0), -1, "single")

func test_move_between_two_inventories() -> void:
	var chest := Inventory.new(27, false)
	inv.add(_id(0), 12)
	assert_true(inv.move(0, chest, 3), "moved out")
	assert_eq(chest.stack_at(3).count, 12, "in chest")
	assert_eq(inv.count(_id(0)), 0, "gone")

func test_hotbar_selection_clamps() -> void:
	inv.select(20)
	assert_eq(inv.hotbar_index, Inventory.HOTBAR_SIZE - 1, "clamped high")
	inv.select(-5)
	assert_eq(inv.hotbar_index, 0, "clamped low")
	inv.add(_id(0), 3)
	assert_eq(inv.selected().item, _id(0), "selected stack")

func test_stack_take_and_split_half() -> void:
	var st := ItemStack.make(_id(0), 10)
	var t := st.take(4)
	assert_eq(t.count, 4, "taken")
	assert_eq(st.count, 6, "left")
	var h := st.split_half()
	assert_eq(h.count, 3, "half")
	assert_eq(st.count, 3, "other half")
	var all := st.take(99)
	assert_eq(all.count, 3, "clamped")
	assert_true(st.is_empty(), "cleared")

func test_to_dict_from_dict_roundtrip() -> void:
	var a := _id(0)
	inv.add(a, 17)
	inv.add(_id(1), 5)
	inv.select(4)
	var d := inv.to_dict()
	var other := Inventory.new(Inventory.PLAYER_SIZE, true)
	other.from_dict(d)
	assert_eq(other.count(a), 17, "counts survive")
	assert_eq(other.hotbar_index, 4, "hotbar survives")
	assert_eq(other.to_dict()["slots"].size(), Inventory.PLAYER_SIZE, "slot count")
	assert_eq(str(other.to_dict()["slots"][3]), str(d["slots"][3]), "empty slots stay null")

func test_clear_empties_everything() -> void:
	inv.add(_id(0), 5)
	inv.clear()
	assert_eq(inv.count(_id(0)), 0, "cleared")
	assert_eq(inv.first_empty(), 0, "all empty")

func test_container_store_keys_are_stable() -> void:
	assert_eq(ContainerStore.key_for("earth", Vector3i(4, -2, 7)), "earth:4:-2:7", "key")
	var cs := ContainerStore.new()
	cs.planet = "namek"
	var chest := cs.get_chest(Vector3i(1, 2, 3))
	assert_eq(chest.size, ContainerStore.CHEST_SIZE, "27 slots")
	chest.add(_id(0), 4)
	assert_eq(cs.get_chest(Vector3i(1, 2, 3)).count(_id(0)), 4, "same instance")
	var dropped := cs.remove_at(Vector3i(1, 2, 3))
	assert_eq(dropped.size(), 1, "one stack dropped")
