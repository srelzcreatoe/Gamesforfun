package com.cubicworld.world

import com.badlogic.gdx.utils.JsonReader
import com.badlogic.gdx.utils.JsonValue

/**
 * Loads and indexes every block type from blocks.json.
 * Block id 0 is always air. Ids are assigned by declaration order, so the
 * order in blocks.json is part of the save format and existing entries must
 * never be reordered or removed (append only).
 */
class BlockRegistry private constructor(val blocks: List<BlockDef>) {

    private val byName = HashMap<String, BlockDef>(blocks.size * 2)

    val air: BlockDef = blocks[0]
    var water: BlockDef = air; private set
    var glowSap: BlockDef = air; private set

    init {
        for (b in blocks) {
            require(byName.put(b.name, b) == null) { "Duplicate block name: ${b.name}" }
        }
        water = byName["water"] ?: air
        glowSap = byName["glow_sap"] ?: air
    }

    operator fun get(id: Short): BlockDef = blocks[id.toInt()]
    fun byId(id: Int): BlockDef = blocks[id]
    fun byName(name: String): BlockDef? = byName[name]
    fun requireByName(name: String): BlockDef =
        byName[name] ?: throw IllegalStateException("Unknown block '$name'")

    val size: Int get() = blocks.size

    /** Resolve face tile names to atlas indices. Fails loudly on missing art. */
    fun resolveTiles(tileIndex: (String) -> Int) {
        for (b in blocks) {
            if (b.isAir) continue
            for (f in 0 until 6) {
                b.tiles[f] = tileIndex(b.tileNames[f])
            }
        }
    }

    companion object {
        fun parse(json: String): BlockRegistry {
            val root = JsonReader().parse(json)
            val list = ArrayList<BlockDef>()
            list.add(
                BlockDef(
                    0, "air", "Air", BlockShape.CUBE, Array(6) { "" }, BlockMaterial.EARTH,
                    0f, opaque = false, translucent = false, solid = false, lightEmission = 0,
                    dropsName = "none", dropCount = 0, tool = ToolType.NONE, minTier = 0,
                    gravity = false, flammable = false
                )
            )
            var v: JsonValue? = root.get("blocks").child
            while (v != null) {
                val id = list.size
                require(id <= Short.MAX_VALUE) { "Too many blocks" }
                list.add(parseBlock(id.toShort(), v))
                v = v.next
            }
            return BlockRegistry(list)
        }

        private fun parseBlock(id: Short, v: JsonValue): BlockDef {
            val name = v.getString("name")
            val tex = v.get("textures")
            val tileNames: Array<String> = if (tex != null) {
                val all = tex.getString("all", null)
                if (all != null) Array(6) { all } else {
                    val top = tex.getString("top", null)
                    val bottom = tex.getString("bottom", null)
                    val side = tex.getString("side", null)
                    requireNotNull(side ?: top) { "Block $name has no usable textures" }
                    val s = side ?: top!!
                    arrayOf(top ?: s, bottom ?: top ?: s, s, s, s, s)
                }
            } else Array(6) { name }
            val dropsRaw = v.getString("drops", null)
            return BlockDef(
                id = id,
                name = name,
                displayName = v.getString("displayName", name),
                shape = BlockShape.valueOf(v.getString("shape", "cube").uppercase()),
                tileNames = tileNames,
                material = BlockMaterial.valueOf(v.getString("material", "stone").uppercase()),
                hardness = v.getFloat("hardness", 1f),
                opaque = v.getBoolean("opaque", v.getString("shape", "cube") == "cube"),
                translucent = v.getBoolean("translucent", false),
                solid = v.getBoolean("solid", v.getString("shape", "cube") != "cross" && v.getString("shape", "cube") != "liquid"),
                lightEmission = v.getInt("lightEmission", 0).coerceIn(0, WorldConst.MAX_LIGHT),
                dropsName = dropsRaw,
                dropCount = v.getInt("dropCount", 1),
                tool = ToolType.valueOf(v.getString("tool", "none").uppercase()),
                minTier = v.getInt("minTier", 0),
                gravity = v.getBoolean("gravity", false),
                flammable = v.getBoolean("flammable", false),
            )
        }
    }
}
