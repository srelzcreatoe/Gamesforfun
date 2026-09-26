package com.cubicworld.inv

/**
 * Shapeless crafting against station-filtered recipe lists, plus the
 * discovery journal: a recipe is shown once the player has ever held any of
 * its inputs (Creative sees everything).
 */
class CraftingManager(
    private val recipes: RecipeRegistry,
    private val items: ItemRegistry,
) {
    /** item ids the player has ever picked up (drives recipe discovery) */
    val discoveredItems = HashSet<Int>()

    fun markDiscovered(itemId: Int) { discoveredItems.add(itemId) }

    fun visibleRecipes(station: String, creative: Boolean): List<RecipeDef> {
        val list = recipes.forStation(station)
        if (creative) return list
        return list.filter { r -> r.inputs.any { it.itemId in discoveredItems } }
    }

    fun canCraft(recipe: RecipeDef, inv: Inventory): Boolean =
        recipe.inputs.all { inv.countOf(it.itemId) >= it.count }

    /** Consume inputs and add the output; returns false if it could not craft. */
    fun craft(recipe: RecipeDef, inv: Inventory): Boolean {
        if (!canCraft(recipe, inv)) return false
        for (input in recipe.inputs) inv.remove(input.itemId, input.count)
        val leftover = inv.add(recipe.outputId, recipe.outputCount)
        if (leftover > 0) {
            // no space: refund inputs to keep the transaction atomic
            for (input in recipe.inputs) inv.add(input.itemId, input.count)
            inv.remove(recipe.outputId, recipe.outputCount - leftover)
            return false
        }
        markDiscovered(recipe.outputId)
        return true
    }

    fun serializeDiscovered(): String =
        discoveredItems.joinToString(",") { items.byId(it).name }

    fun deserializeDiscovered(data: String) {
        discoveredItems.clear()
        for (name in data.split(",")) {
            if (name.isEmpty()) continue
            items.byName(name)?.let { discoveredItems.add(it.id) }
        }
    }
}
