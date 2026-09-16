package com.cubicworld.world

import com.badlogic.gdx.utils.JsonReader
import com.badlogic.gdx.utils.JsonValue

class BiomePlant(val blockName: String, val density: Float) {
    var blockId: Short = 0
}

class BiomeCreatureEntry(val creatureName: String, val weight: Int)

class BiomeDef(
    val id: Int,
    val name: String,
    val displayName: String,
    val tempMin: Float, val tempMax: Float,
    val moistMin: Float, val moistMax: Float,
    val surfaceName: String,
    val subsurfaceName: String,
    val underwaterName: String,
    val heightBase: Float,
    val heightVar: Float,
    val roughness: Float,
    val treeType: String,
    val treeDensity: Float,
    val plants: List<BiomePlant>,
    val grassTint: FloatArray,
    val leafTint: FloatArray,
    val skyTint: FloatArray,
    val creatures: List<BiomeCreatureEntry>,
) {
    var surface: Short = 0
    var subsurface: Short = 0
    var underwater: Short = 0

    fun contains(temp: Float, moist: Float): Boolean =
        temp >= tempMin && temp <= tempMax && moist >= moistMin && moist <= moistMax

    fun centerDist2(temp: Float, moist: Float): Float {
        val dt = temp - (tempMin + tempMax) * 0.5f
        val dm = moist - (moistMin + moistMax) * 0.5f
        return dt * dt + dm * dm
    }
}

class BiomeRegistry private constructor(val biomes: List<BiomeDef>) {

    private val byName = HashMap<String, BiomeDef>()

    init {
        for (b in biomes) require(byName.put(b.name, b) == null) { "Duplicate biome: ${b.name}" }
    }

    fun byId(id: Int): BiomeDef = biomes[id]
    fun byName(name: String): BiomeDef? = byName[name]
    val size: Int get() = biomes.size

    fun resolve(blocks: BlockRegistry) {
        for (b in biomes) {
            b.surface = blocks.requireByName(b.surfaceName).id
            b.subsurface = blocks.requireByName(b.subsurfaceName).id
            b.underwater = blocks.requireByName(b.underwaterName).id
            for (p in b.plants) p.blockId = blocks.requireByName(p.blockName).id
        }
    }

    /** Pick the biome for a climate point; nearest-center fallback keeps this total. */
    fun pick(temp: Float, moist: Float): BiomeDef {
        var best: BiomeDef? = null
        for (b in biomes) if (b.contains(temp, moist)) {
            if (best == null || b.centerDist2(temp, moist) < best.centerDist2(temp, moist)) best = b
        }
        if (best != null) return best
        var nearest = biomes[0]
        var nd = Float.MAX_VALUE
        for (b in biomes) {
            val d = b.centerDist2(temp, moist)
            if (d < nd) { nd = d; nearest = b }
        }
        return nearest
    }

    companion object {
        fun parse(json: String): BiomeRegistry {
            val root = JsonReader().parse(json)
            val list = ArrayList<BiomeDef>()
            var v: JsonValue? = root.get("biomes").child
            while (v != null) {
                val temp = v.get("temp"); val moist = v.get("moist")
                val plants = ArrayList<BiomePlant>()
                var p: JsonValue? = v.get("plants")?.child
                while (p != null) {
                    plants.add(BiomePlant(p.getString("block"), p.getFloat("density", 0.01f)))
                    p = p.next
                }
                val creatures = ArrayList<BiomeCreatureEntry>()
                var c: JsonValue? = v.get("creatures")?.child
                while (c != null) {
                    creatures.add(BiomeCreatureEntry(c.getString("creature"), c.getInt("weight", 1)))
                    c = c.next
                }
                list.add(
                    BiomeDef(
                        id = list.size,
                        name = v.getString("name"),
                        displayName = v.getString("displayName", v.getString("name")),
                        tempMin = temp.getFloat(0), tempMax = temp.getFloat(1),
                        moistMin = moist.getFloat(0), moistMax = moist.getFloat(1),
                        surfaceName = v.getString("surface"),
                        subsurfaceName = v.getString("subsurface"),
                        underwaterName = v.getString("underwater"),
                        heightBase = v.getFloat("heightBase", 20f),
                        heightVar = v.getFloat("heightVar", 12f),
                        roughness = v.getFloat("roughness", 0.5f),
                        treeType = v.getString("treeType", "none"),
                        treeDensity = v.getFloat("treeDensity", 0f),
                        plants = plants,
                        grassTint = readTint(v.get("grassTint")),
                        leafTint = readTint(v.get("leafTint")),
                        skyTint = readTint(v.get("skyTint")),
                        creatures = creatures,
                    )
                )
                v = v.next
            }
            return BiomeRegistry(list)
        }

        private fun readTint(v: JsonValue?): FloatArray =
            if (v == null) floatArrayOf(1f, 1f, 1f)
            else floatArrayOf(v.getInt(0) / 255f, v.getInt(1) / 255f, v.getInt(2) / 255f)
    }
}
