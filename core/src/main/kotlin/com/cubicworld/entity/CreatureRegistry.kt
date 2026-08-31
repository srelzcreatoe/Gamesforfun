package com.cubicworld.entity

import com.badlogic.gdx.utils.JsonReader
import com.badlogic.gdx.utils.JsonValue
import com.cubicworld.inv.ItemRegistry

class CreatureDrop(val itemName: String, val min: Int, val max: Int) {
    var itemId: Int = -1
}

class CreatureDef(
    val id: Int,
    val name: String,
    val displayName: String,
    val hostile: Boolean,
    val health: Int,
    val speed: Float,
    val damage: Int,
    val width: Float,
    val height: Float,
    val drops: List<CreatureDrop>,
    val bodyTile: String,
    val headTile: String,
    val spawnNight: Boolean,
    val spawnMinLight: Int,
    val spawnMaxLight: Int,
    val spawnWeight: Int,
    val groupMax: Int,
    val soundFamily: String,
) {
    var bodyTileIdx: Int = -1
    var headTileIdx: Int = -1
}

class CreatureRegistry private constructor(val creatures: List<CreatureDef>) {

    private val byName = HashMap<String, CreatureDef>()

    init {
        for (c in creatures) require(byName.put(c.name, c) == null) { "Duplicate creature: ${c.name}" }
    }

    fun byName(name: String): CreatureDef? = byName[name]
    fun byId(id: Int): CreatureDef = creatures[id]
    val size: Int get() = creatures.size

    fun resolve(items: ItemRegistry, tileIndex: (String) -> Int) {
        for (c in creatures) {
            for (d in c.drops) d.itemId = items.requireByName(d.itemName).id
            c.bodyTileIdx = tileIndex(c.bodyTile)
            c.headTileIdx = tileIndex(c.headTile)
        }
    }

    companion object {
        fun parse(json: String): CreatureRegistry {
            val root = JsonReader().parse(json)
            val list = ArrayList<CreatureDef>()
            var v: JsonValue? = root.get("creatures").child
            while (v != null) {
                val size = v.get("size")
                val tiles = v.get("tiles")
                val spawn = v.get("spawn")
                val drops = ArrayList<CreatureDrop>()
                var d: JsonValue? = v.get("drops")?.child
                while (d != null) {
                    val count = d.get("count")
                    val (mn, mx) = if (count != null && count.isArray) count.getInt(0) to count.getInt(1)
                    else (d.getInt("count", 1)).let { it to it }
                    drops.add(CreatureDrop(d.getString("item"), mn, mx))
                    d = d.next
                }
                list.add(
                    CreatureDef(
                        id = list.size,
                        name = v.getString("name"),
                        displayName = v.getString("displayName", v.getString("name")),
                        hostile = v.getBoolean("hostile", false),
                        health = v.getInt("health", 10),
                        speed = v.getFloat("speed", 1.5f),
                        damage = v.getInt("damage", 0),
                        width = size?.getFloat(0) ?: 0.7f,
                        height = size?.getFloat(1) ?: 0.9f,
                        drops = drops,
                        bodyTile = tiles?.getString("body", null) ?: "${v.getString("name")}_body",
                        headTile = tiles?.getString("head", null) ?: "${v.getString("name")}_head",
                        spawnNight = spawn?.getBoolean("night", false) ?: false,
                        spawnMinLight = spawn?.getInt("minLight", 0) ?: 0,
                        spawnMaxLight = spawn?.getInt("maxLight", 15) ?: 15,
                        spawnWeight = spawn?.getInt("weight", 5) ?: 5,
                        groupMax = spawn?.getInt("groupMax", 2) ?: 2,
                        soundFamily = v.getString("sounds", "generic"),
                    )
                )
                v = v.next
            }
            return CreatureRegistry(list)
        }
    }
}
