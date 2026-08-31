package com.cubicworld.inv

import com.badlogic.gdx.utils.JsonReader
import com.badlogic.gdx.utils.JsonValue
import com.cubicworld.world.BlockRegistry
import com.cubicworld.world.ToolType

enum class ItemKind { BLOCK, TOOL, MATERIAL, FOOD }

class ItemDef(
    val id: Int,
    val name: String,
    val displayName: String,
    val kind: ItemKind,
    val blockName: String?,       // kind=BLOCK: block this item places
    val iconTile: String?,        // explicit icon tile; blocks may fall back to block art
    val stack: Int,
    val toolType: ToolType,
    val tier: Int,
    val durability: Int,
    val efficiency: Float,
    val damage: Int,
    val foodHunger: Int,
    val foodHeal: Int,
) {
    var blockId: Short = 0        // resolved
    var icon: Int = -1            // resolved atlas tile index (or block face fallback)
}

class ItemRegistry private constructor(val items: List<ItemDef>) {
    private val byName = HashMap<String, ItemDef>(items.size * 2)

    init {
        for (i in items) require(byName.put(i.name, i) == null) { "Duplicate item name: ${i.name}" }
    }

    fun byId(id: Int): ItemDef = items[id]
    fun byName(name: String): ItemDef? = byName[name]
    fun requireByName(name: String): ItemDef =
        byName[name] ?: throw IllegalStateException("Unknown item '$name'")

    val size: Int get() = items.size

    /** Link block items to block ids; call once after both registries load. */
    fun resolveBlocks(blocks: BlockRegistry) {
        for (i in items) {
            if (i.kind == ItemKind.BLOCK) {
                val bn = i.blockName ?: i.name
                i.blockId = blocks.requireByName(bn).id
            }
        }
    }

    fun resolveIcons(tileIndex: (String) -> Int, blocks: BlockRegistry) {
        for (i in items) {
            i.icon = when {
                i.iconTile != null -> tileIndex(i.iconTile)
                i.kind == ItemKind.BLOCK -> blocks.byId(i.blockId.toInt()).tiles[2] // side face
                else -> throw IllegalStateException("Item ${i.name} has no icon tile")
            }
        }
    }

    /** Item that places the given block, if any. */
    fun forBlock(blockId: Short): ItemDef? = blockItemCache.getOrPut(blockId) {
        items.firstOrNull { it.kind == ItemKind.BLOCK && it.blockId == blockId }
    }

    private val blockItemCache = HashMap<Short, ItemDef?>()

    companion object {
        fun parse(json: String): ItemRegistry {
            val root = JsonReader().parse(json)
            val list = ArrayList<ItemDef>()
            var v: JsonValue? = root.get("items").child
            while (v != null) {
                val kind = ItemKind.valueOf(v.getString("kind", "material").uppercase())
                val food = v.get("food")
                list.add(
                    ItemDef(
                        id = list.size,
                        name = v.getString("name"),
                        displayName = v.getString("displayName", v.getString("name")),
                        kind = kind,
                        blockName = v.getString("block", null),
                        iconTile = v.getString("icon", null),
                        stack = v.getInt("stack", if (kind == ItemKind.TOOL) 1 else 64),
                        toolType = ToolType.valueOf(v.getString("toolType", "none").uppercase()),
                        tier = v.getInt("tier", 0),
                        durability = v.getInt("durability", 0),
                        efficiency = v.getFloat("efficiency", 1f),
                        damage = v.getInt("damage", 1),
                        foodHunger = food?.getInt("hunger", 0) ?: 0,
                        foodHeal = food?.getInt("heal", 0) ?: 0,
                    )
                )
                v = v.next
            }
            return ItemRegistry(list)
        }
    }
}
