package com.cubicworld.world.gen

import com.cubicworld.world.BiomeRegistry
import com.cubicworld.world.BlockRegistry
import com.cubicworld.world.Chunk
import com.cubicworld.world.WorldConst.CHUNK
import com.cubicworld.world.WorldConst.HEIGHT
import com.cubicworld.world.WorldConst.SEA_LEVEL

/**
 * Write access used during decoration; may touch the 3x3 chunk neighbourhood
 * around the chunk being decorated. All target chunks are guaranteed to have
 * terrain generated already.
 */
interface GenWorld {
    fun get(wx: Int, wy: Int, wz: Int): Short
    fun set(wx: Int, wy: Int, wz: Int, id: Short, state: Byte = 0)
    fun surfaceHeight(wx: Int, wz: Int): Int
}

/**
 * Deterministic decoration pass: trees, plants, snow and structures.
 * Placement depends only on (seed, chunk coords), never on generation order.
 */
class Decorator(
    seed: Long,
    private val blocks: BlockRegistry,
    private val biomes: BiomeRegistry,
    private val generator: WorldGenerator,
) {
    private val noise = SeededNoise(seed * 31 + 7)

    private fun id(name: String): Short = blocks.byName(name)?.id ?: 0

    private val snowSlab = id("snow_slab")
    private val waystoneStone = id("waystone_stone")
    private val waystoneCore = id("waystone_core")
    private val crateId = id("storage_crate")

    private class TreeKind(val log: Short, val leaves: Short)

    private fun tree(name: String): TreeKind? {
        val log = blocks.byName("${name}_log") ?: return null
        val leaves = blocks.byName("${name}_leaves") ?: return null
        return TreeKind(log.id, leaves.id)
    }

    private val treeKinds: Map<String, TreeKind> by lazy {
        listOf("sunbark", "palebark", "mirewood").mapNotNull { n -> tree(n)?.let { n to it } }.toMap()
    }

    fun decorate(chunk: Chunk, gw: GenWorld) {
        val baseX = chunk.cx shl 4
        val baseZ = chunk.cz shl 4

        for (z in 0 until CHUNK) for (x in 0 until CHUNK) {
            val wx = baseX + x
            val wz = baseZ + z
            val biome = biomes.byId(chunk.biomes[(z shl 4) or x].toInt())
            // deterministic pre-decoration surface height: this pass may be
            // replayed for a neighbour later, after live heightmaps changed
            val h = generator.heightAt(wx, wz)
            if (h <= 0 || h >= HEIGHT - 8) continue
            val surfaceId = chunk.data.get(x, h, z)
            if (surfaceId != biome.surface || h < SEA_LEVEL) {
                // frost biomes still get snow on any exposed solid surface
                if (snowSlab.toInt() != 0 && biome.name == "frostglass_expanse" && h > SEA_LEVEL &&
                    blocks[surfaceId].opaque && gw.get(wx, h + 1, wz).toInt() == 0
                ) {
                    gw.set(wx, h + 1, wz, snowSlab)
                }
                continue
            }

            // trees
            val kind = treeKinds[biome.treeType]
            if (kind != null && noise.cellRand(wx, wz, 61) < biome.treeDensity) {
                growTree(gw, wx, h + 1, wz, biome.treeType, kind)
                continue
            }
            // plants
            var placed = false
            for ((pi, plant) in biome.plants.withIndex()) {
                if (noise.cellRand(wx, wz, 62 + pi) < plant.density) {
                    if (gw.get(wx, h + 1, wz).toInt() == 0) gw.set(wx, h + 1, wz, plant.blockId)
                    placed = true
                    break
                }
            }
            if (!placed && snowSlab.toInt() != 0 && biome.name == "frostglass_expanse" &&
                noise.cellRand(wx, wz, 68) < 0.45f && gw.get(wx, h + 1, wz).toInt() == 0
            ) {
                gw.set(wx, h + 1, wz, snowSlab)
            }
        }

        maybePlaceWaystone(chunk, gw)
    }

    private fun growTree(gw: GenWorld, wx: Int, wy: Int, wz: Int, type: String, kind: TreeKind) {
        // keep the trunk base clear; its own log means this is a clipped
        // replay of an already-placed tree, which must still emit its canopy
        val base = gw.get(wx, wy, wz)
        if (base.toInt() != 0 && base != kind.log) return
        val r = noise.cellRand(wx, wz, 63)
        when (type) {
            "palebark" -> {
                val height = 7 + (r * 3).toInt()
                for (y in 0 until height) gw.set(wx, wy + y, wz, kind.log)
                // narrow columnar canopy with hanging tips
                for (dy in -1..2) for (dx in -1..1) for (dz in -1..1) {
                    if (dx == 0 && dz == 0 && dy < 2) continue
                    if (kotlin.math.abs(dx) + kotlin.math.abs(dz) + kotlin.math.abs(dy - 1) > 3) continue
                    place(gw, wx + dx, wy + height - 1 + dy, wz + dz, kind.leaves)
                }
                for (side in 0 until 4) {
                    val dx = intArrayOf(1, -1, 0, 0)[side]
                    val dz = intArrayOf(0, 0, 1, -1)[side]
                    val len = 1 + (noise.cellRand(wx + dx, wz + dz, 64) * 2).toInt()
                    for (d in 0 until len) place(gw, wx + dx, wy + height - 3 - d, wz + dz, kind.leaves)
                }
            }
            "mirewood" -> {
                val height = 3 + (r * 2).toInt()
                for (y in 0 until height) gw.set(wx, wy + y, wz, kind.log)
                for (dx in -2..2) for (dz in -2..2) for (dy in 0..1) {
                    val d2 = dx * dx + dz * dz + dy * 2
                    if (d2 <= 5 && !(dx == 0 && dz == 0 && dy == 0)) {
                        place(gw, wx + dx, wy + height - 1 + dy, wz + dz, kind.leaves)
                    }
                }
            }
            else -> { // sunbark: broad shade canopy
                val height = 4 + (r * 3).toInt()
                for (y in 0 until height) gw.set(wx, wy + y, wz, kind.log)
                for (dy in -2..1) for (dx in -3..3) for (dz in -3..3) {
                    val rr = dx * dx + dz * dz + dy * dy * 3
                    if (rr <= 10 && !(dx == 0 && dz == 0 && dy <= 0)) {
                        place(gw, wx + dx, wy + height + dy, wz + dz, kind.leaves)
                    }
                }
            }
        }
    }

    private fun place(gw: GenWorld, wx: Int, wy: Int, wz: Int, id: Short) {
        if (wy in 1 until HEIGHT && gw.get(wx, wy, wz).toInt() == 0) gw.set(wx, wy, wz, id)
    }

    /** Rare ruined waystone circle: broken pillars around a glowing core. */
    private fun maybePlaceWaystone(chunk: Chunk, gw: GenWorld) {
        if (waystoneStone.toInt() == 0 || waystoneCore.toInt() == 0) return
        if (noise.cellRand(chunk.cx, chunk.cz, 71) > 0.004f) return
        val baseX = (chunk.cx shl 4) + 8
        val baseZ = (chunk.cz shl 4) + 8
        val h = generator.heightAt(baseX, baseZ)     // deterministic for replays
        if (h <= SEA_LEVEL || h >= HEIGHT - 10) return
        // 7x7 cracked floor
        for (dx in -3..3) for (dz in -3..3) {
            if (noise.cellRand(baseX + dx, baseZ + dz, 72) < 0.8f) {
                gw.set(baseX + dx, h, baseZ + dz, waystoneStone)
            }
        }
        // broken pillar ring
        for (side in 0 until 4) {
            val dx = intArrayOf(3, -3, 3, -3)[side]
            val dz = intArrayOf(3, 3, -3, -3)[side]
            val pillarH = 1 + (noise.cellRand(baseX + dx, baseZ + dz, 73) * 3).toInt()
            for (y in 1..pillarH) gw.set(baseX + dx, h + y, baseZ + dz, waystoneStone)
        }
        gw.set(baseX, h + 1, baseZ, waystoneCore)
        if (crateId.toInt() != 0) gw.set(baseX + 1, h + 1, baseZ + 1, crateId)
    }
}
