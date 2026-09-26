package com.cubicworld.world.gen

import com.cubicworld.world.BiomeDef
import com.cubicworld.world.BiomeRegistry
import com.cubicworld.world.BlockRegistry
import com.cubicworld.world.Chunk
import com.cubicworld.world.WorldConst.CHUNK
import com.cubicworld.world.WorldConst.HEIGHT
import com.cubicworld.world.WorldConst.SEA_LEVEL

/** World shape presets selectable at world creation. */
enum class WorldType { STANDARD, WIDE_ISLANDS, MOUNTAIN_REALM, FLAT_BUILDER }

/**
 * Deterministic terrain generation: identical (seed, worldType) input always
 * produces identical chunks, regardless of generation order or thread.
 */
class WorldGenerator(
    val seed: Long,
    private val worldType: WorldType,
    private val blocks: BlockRegistry,
    private val biomes: BiomeRegistry,
) {
    private val noise = SeededNoise(seed)

    private val airId: Short = 0
    private val waterId = blocks.water.id
    private val glowSapId = blocks.glowSap.id
    private val worldrootId = blocks.byName("worldroot_stone")?.id ?: firstStone()
    private val graystoneId = firstStone()
    private val deepstoneId = blocks.byName("deepstone")?.id ?: graystoneId

    private class Ore(val id: Short, val minY: Int, val maxY: Int, val attempts: Int, val size: Int, val salt: Int)

    private val ores: List<Ore> = listOf(
        oreOf("flint_nodule", 30, 72, 9, 5, 501),
        oreOf("copper_vein", 16, 60, 8, 6, 502),
        oreOf("ironroot_vein", 6, 42, 6, 5, 503),
        oreOf("emberite_vein", 4, 24, 3, 4, 504),
        oreOf("starsteel_vein", 2, 12, 1, 3, 505),
    ).filterNotNull()

    private fun oreOf(name: String, a: Int, b: Int, att: Int, sz: Int, salt: Int): Ore? =
        blocks.byName(name)?.let { Ore(it.id, a, b, att, sz, salt) }

    private fun firstStone(): Short =
        (blocks.byName("graystone") ?: blocks.blocks.first { it.material == com.cubicworld.world.BlockMaterial.STONE && !it.isAir })
            .id

    // ---- climate ----------------------------------------------------------

    fun temperature(wx: Int, wz: Int): Float =
        (noise.fbm2(wx / 640f, wz / 640f, 3, salt = 11) * 0.5f + 0.5f).coerceIn(0f, 1f)

    fun moisture(wx: Int, wz: Int): Float =
        (noise.fbm2(wx / 520f, wz / 520f, 3, salt = 12) * 0.5f + 0.5f).coerceIn(0f, 1f)

    fun biomeAt(wx: Int, wz: Int): BiomeDef = biomes.pick(temperature(wx, wz), moisture(wx, wz))

    // ---- height -----------------------------------------------------------

    private fun continental(wx: Int, wz: Int): Float = when (worldType) {
        WorldType.STANDARD -> noise.fbm2(wx / 1100f, wz / 1100f, 4, salt = 21)
        WorldType.WIDE_ISLANDS -> noise.fbm2(wx / 560f, wz / 560f, 4, salt = 21) - 0.28f
        WorldType.MOUNTAIN_REALM -> noise.fbm2(wx / 1100f, wz / 1100f, 4, salt = 21) * 0.6f + 0.3f
        WorldType.FLAT_BUILDER -> 0.3f
    }

    // heightAt is hot: terrain workers, decoration replays and spawn search all
    // hit it, often for the same columns. Values are pure functions of (wx,wz).
    private val heightCache = java.util.concurrent.ConcurrentHashMap<Long, Int>()

    /** Terrain height for a column, blending biome params over a small kernel. */
    fun heightAt(wx: Int, wz: Int): Int {
        if (worldType == WorldType.FLAT_BUILDER) return SEA_LEVEL + 4
        val key = (wx.toLong() shl 32) or (wz.toLong() and 0xFFFFFFFFL)
        heightCache[key]?.let { return it }
        val h = computeHeight(wx, wz)
        if (heightCache.size > 100_000) heightCache.clear()   // bound memory on long treks
        heightCache[key] = h
        return h
    }

    private fun computeHeight(wx: Int, wz: Int): Int {
        var base = 0f; var variance = 0f; var rough = 0f; var wsum = 0f
        var dz = -2
        while (dz <= 2) {
            var dx = -2
            while (dx <= 2) {
                val w = 1f / (1f + dx * dx + dz * dz)
                val b = biomeAt(wx + dx * 6, wz + dz * 6)
                base += b.heightBase * w
                variance += b.heightVar * w
                rough += b.roughness * w
                wsum += w
                dx++
            }
            dz++
        }
        base /= wsum; variance /= wsum; rough /= wsum

        val cont = continental(wx, wz)
        val detail = noise.fbm2(wx / 150f, wz / 150f, 5, salt = 22)
        val ridge = noise.ridged2(wx / 260f, wz / 260f, 4, salt = 23)
        val mountainBoost = if (worldType == WorldType.MOUNTAIN_REALM) 1.7f else 1f

        var h = SEA_LEVEL - 14f + base * 0.6f + cont * 26f +
            detail * variance * mountainBoost +
            ridge * rough * 22f * mountainBoost
        if (h > HEIGHT - 10) h = HEIGHT - 10f
        if (h < 8f) h = 8f
        return h.toInt()
    }

    // ---- caves ------------------------------------------------------------

    private fun isCave(wx: Int, y: Int, wz: Int, surface: Int): Boolean {
        if (worldType == WorldType.FLAT_BUILDER) return false
        if (y <= 3) return false
        if (y > surface) return false
        // winding tunnels: intersection of two noise iso-surfaces
        val t1 = noise.noise3(wx / 96f, y / 64f, wz / 96f, 31)
        val t2 = noise.noise3(wx / 96f, y / 64f, wz / 96f, 32)
        if (t1 * t1 + t2 * t2 < 0.014f) return true
        // large caverns lower down (gloomroot depths)
        if (y < 34) {
            val cavern = noise.fbm3(wx / 130f, y / 90f, wz / 130f, 3, salt = 33)
            if (cavern < -0.52f) return true
        }
        return false
    }

    // ---- terrain pass -----------------------------------------------------

    fun generateTerrain(chunk: Chunk) {
        val data = chunk.data
        val baseX = chunk.cx shl 4
        val baseZ = chunk.cz shl 4
        for (z in 0 until CHUNK) for (x in 0 until CHUNK) {
            val wx = baseX + x
            val wz = baseZ + z
            val biome = biomeAt(wx, wz)
            chunk.biomes[(z shl 4) or x] = biome.id.toByte()
            val surface = heightAt(wx, wz)
            val underwater = surface < SEA_LEVEL

            for (y in 0 until HEIGHT) {
                val id: Short = when {
                    y == 0 -> worldrootId
                    y <= 2 -> if (noise.cellRand3(wx, y, wz, 41) < 0.6f) worldrootId else deepstoneId
                    y > surface -> if (y <= SEA_LEVEL && underwater) waterId else airId
                    isCave(wx, y, wz, surface) ->
                        if (y <= 9 && noise.cellRand3(wx, y, wz, 42) < 0.35f) glowSapId else airId
                    y == surface -> if (underwater) biome.underwater else biome.surface
                    y >= surface - 3 -> if (underwater) biome.underwater else biome.subsurface
                    y < 24 -> deepstoneId
                    else -> graystoneId
                }
                if (id.toInt() != 0) data.set(x, y, z, id)
            }
        }
        placeOres(chunk)
    }

    private fun placeOres(chunk: Chunk) {
        val baseX = chunk.cx shl 4
        val baseZ = chunk.cz shl 4
        for (ore in ores) {
            for (n in 0 until ore.attempts) {
                val rx = (noise.cellRand(baseX + n * 17, baseZ, ore.salt) * CHUNK).toInt().coerceIn(0, 15)
                val rz = (noise.cellRand(baseX, baseZ + n * 29, ore.salt + 1) * CHUNK).toInt().coerceIn(0, 15)
                val ry = ore.minY + (noise.cellRand(baseX + rx, baseZ + rz + n, ore.salt + 2) *
                    (ore.maxY - ore.minY)).toInt()
                // small blob around the anchor
                for (i in 0 until ore.size) {
                    val ox = rx + (noise.cellRand3(rx, ry + i, rz, ore.salt + 3) * 3).toInt() - 1
                    val oy = ry + (noise.cellRand3(rx + i, ry, rz, ore.salt + 4) * 3).toInt() - 1
                    val oz = rz + (noise.cellRand3(rx, ry, rz + i, ore.salt + 5) * 3).toInt() - 1
                    if (ox in 0..15 && oz in 0..15 && oy in 4 until HEIGHT) {
                        val cur = chunk.data.get(ox, oy, oz)
                        if (cur == graystoneId || cur == deepstoneId) {
                            chunk.data.set(ox, oy, oz, ore.id)
                        }
                    }
                }
            }
        }
    }

    // ---- spawn ------------------------------------------------------------

    /**
     * Find a safe spawn column near the origin: solid dry land with headroom.
     * A cheap continental probe filters out open ocean before paying for the
     * full biome-blended height; all-ocean seeds fall back to the highest
     * column found, placed at water surface so the player swims, never drowns.
     */
    fun findSpawn(): Triple<Int, Int, Int> {
        var bestX = 0; var bestZ = 0; var bestH = Int.MIN_VALUE
        var radius = 0
        while (radius <= 128) {
            var dx = -radius
            while (dx <= radius) {
                var dz = -radius
                while (dz <= radius) {
                    if (kotlin.math.abs(dx) == radius || kotlin.math.abs(dz) == radius) {
                        val wx = dx * 12
                        val wz = dz * 12
                        // quick reject: deep-ocean continental values can't reach land height
                        val est = SEA_LEVEL - 14f + continental(wx, wz) * 26f + 12f
                        if (est > SEA_LEVEL - 12) {
                            val h = heightAt(wx, wz)
                            if (h in (SEA_LEVEL + 2)..(HEIGHT - 12)) {
                                return Triple(wx, h + 1, wz)
                            }
                            if (h > bestH) { bestH = h; bestX = wx; bestZ = wz }
                        }
                    }
                    dz++
                }
                dx++
            }
            radius++
        }
        if (bestH == Int.MIN_VALUE) bestH = heightAt(0, 0)
        return Triple(bestX, kotlin.math.max(bestH + 1, SEA_LEVEL + 1), bestZ)
    }
}
