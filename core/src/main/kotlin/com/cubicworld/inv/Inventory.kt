package com.cubicworld.inv

/** One inventory slot; itemId < 0 means empty. */
class ItemStack(var itemId: Int = -1, var count: Int = 0, var durability: Int = 0) {
    val isEmpty: Boolean get() = itemId < 0 || count <= 0
    fun clear() { itemId = -1; count = 0; durability = 0 }
    fun copyFrom(other: ItemStack) { itemId = other.itemId; count = other.count; durability = other.durability }
}

/**
 * Player inventory: slots 0-8 are the hotbar, 9-35 the backpack.
 * Also used (with a different size) for container blocks.
 */
class Inventory(val items: ItemRegistry, val size: Int = 36) {

    val slots = Array(size) { ItemStack() }
    var selectedSlot = 0

    val selected: ItemStack get() = slots[selectedSlot]

    fun selectedItem(): ItemDef? = if (selected.isEmpty) null else items.byId(selected.itemId)

    /** Add items, filling existing stacks first. Returns the count that did not fit. */
    fun add(itemId: Int, count: Int, durability: Int = 0): Int {
        if (count <= 0) return 0
        val def = items.byId(itemId)
        var remaining = count
        if (def.stack > 1) {
            for (s in slots) {
                if (!s.isEmpty && s.itemId == itemId && s.count < def.stack) {
                    val take = minOf(def.stack - s.count, remaining)
                    s.count += take
                    remaining -= take
                    if (remaining == 0) return 0
                }
            }
        }
        for (s in slots) {
            if (s.isEmpty) {
                val take = minOf(def.stack, remaining)
                s.itemId = itemId
                s.count = take
                s.durability = if (def.durability > 0) def.durability else durability
                remaining -= take
                if (remaining == 0) return 0
            }
        }
        return remaining
    }

    fun countOf(itemId: Int): Int = slots.sumOf { if (!it.isEmpty && it.itemId == itemId) it.count else 0 }

    /** Remove up to [count] items; returns how many were actually removed. */
    fun remove(itemId: Int, count: Int): Int {
        var toRemove = count
        for (s in slots) {
            if (toRemove == 0) break
            if (!s.isEmpty && s.itemId == itemId) {
                val take = minOf(s.count, toRemove)
                s.count -= take
                toRemove -= take
                if (s.count <= 0) s.clear()
            }
        }
        return count - toRemove
    }

    fun clearAll() { for (s in slots) s.clear() }

    // ---- persistence ------------------------------------------------------

    fun serialize(): MutableList<String> = slots.map { s ->
        if (s.isEmpty) "" else "${items.byId(s.itemId).name}:${s.count}:${s.durability}"
    }.toMutableList()

    fun deserialize(data: List<String>) {
        clearAll()
        for ((i, entry) in data.withIndex()) {
            if (i >= size || entry.isEmpty()) continue
            val parts = entry.split(":")
            val def = items.byName(parts[0]) ?: continue      // item removed in an update: skip safely
            slots[i].itemId = def.id
            slots[i].count = parts.getOrNull(1)?.toIntOrNull()?.coerceIn(1, 999) ?: 1
            slots[i].durability = parts.getOrNull(2)?.toIntOrNull() ?: 0
        }
    }
}
