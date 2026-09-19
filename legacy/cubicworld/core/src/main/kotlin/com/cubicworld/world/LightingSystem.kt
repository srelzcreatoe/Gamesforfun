package com.cubicworld.world

import com.cubicworld.world.WorldConst.CHUNK
import com.cubicworld.world.WorldConst.HEIGHT
import com.cubicworld.world.WorldConst.MAX_LIGHT

/**
 * Voxel lighting: per-cell skylight and coloured-agnostic block light,
 * computed per chunk with neighbour borders as boundary conditions.
 * Sky columns above the heightmap are full brightness; light floods from
 * there and from emissive blocks with -1 falloff per cell.
 */
class LightingSystem(private val blocks: BlockRegistry) {

    // reusable BFS queue: packed (idx shl 4) | light
    private val queue = IntArray(CHUNK * CHUNK * HEIGHT)

    /** Full skylight + blocklight recompute for one chunk. Not thread-shared. */
    fun compute(chunk: Chunk, neighbor: (Int, Int) -> Chunk?) {
        val data = chunk.data
        java.util.Arrays.fill(data.light, 0)
        var qTail = 0

        // ---- seed skylight: everything above the column height is full sky
        for (z in 0 until CHUNK) for (x in 0 until CHUNK) {
            val top = data.heightMap[(z shl 4) or x].toInt()
            for (y in HEIGHT - 1 downTo top) {
                val i = (y shl 8) or (z shl 4) or x
                data.light[i] = (MAX_LIGHT shl 4).toByte()
            }
            if (top > 0) {
                val i = (top shl 8) or (z shl 4) or x
                queue[qTail++] = (i shl 4) or MAX_LIGHT
            }
        }

        // ---- seed from neighbour borders (both light kinds)
        qTail = seedBorders(chunk, neighbor, qTail, sky = true)
        qTail = floodSky(data, qTail)

        // ---- block light: emissive cells + neighbour borders
        qTail = 0
        for (i in data.ids.indices) {
            val id = data.ids[i].toInt()
            if (id != 0) {
                val em = blocks.byId(id).lightEmission
                if (em > 0) {
                    data.light[i] = (data.light[i].toInt() or em).toByte()
                    queue[qTail++] = (i shl 4) or em
                }
            }
        }
        qTail = seedBorders(chunk, neighbor, qTail, sky = false)
        floodBlock(data, qTail)
        chunk.lightDirty = false
    }

    private fun seedBorders(chunk: Chunk, neighbor: (Int, Int) -> Chunk?, tail0: Int, sky: Boolean): Int {
        var qTail = tail0
        val data = chunk.data
        for (side in 0 until 4) {
            val dx = intArrayOf(-1, 1, 0, 0)[side]
            val dz = intArrayOf(0, 0, -1, 1)[side]
            val n = neighbor(dx, dz) ?: continue
            if (n.state < ChunkState.DECORATED) continue
            val nd = n.data
            for (y in 0 until HEIGHT) for (t in 0 until CHUNK) {
                // cell just over the border in the neighbour
                val nx = if (dx == -1) 15 else if (dx == 1) 0 else t
                val nz = if (dz == -1) 15 else if (dz == 1) 0 else t
                val nl = if (sky) nd.skyLight(nx, y, nz) else nd.blockLight(nx, y, nz)
                if (nl <= 1) continue
                // matching edge cell in this chunk
                val x = if (dx == -1) 0 else if (dx == 1) 15 else t
                val z = if (dz == -1) 0 else if (dz == 1) 15 else t
                val i = (y shl 8) or (z shl 4) or x
                val id = data.ids[i].toInt()
                if (id != 0 && blocks.byId(id).opaque) continue
                val v = nl - 1
                val cur = if (sky) (data.light[i].toInt() ushr 4) and 0xF else data.light[i].toInt() and 0xF
                if (v > cur) {
                    data.light[i] = if (sky) ((data.light[i].toInt() and 0x0F) or (v shl 4)).toByte()
                    else ((data.light[i].toInt() and 0xF0) or v).toByte()
                    queue[qTail++] = (i shl 4) or v
                }
            }
        }
        return qTail
    }

    private fun floodSky(data: ChunkData, tail0: Int): Int {
        var qHead = 0
        var qTail = tail0
        while (qHead < qTail) {
            val packed = queue[qHead++]
            val i = packed ushr 4
            val level = packed and 0xF
            if (((data.light[i].toInt() ushr 4) and 0xF) > level) continue
            if (level <= 1) continue
            val x = i and 15; val z = (i shr 4) and 15; val y = i shr 8
            qTail = spread(data, x - 1, y, z, level - 1, qTail, true)
            qTail = spread(data, x + 1, y, z, level - 1, qTail, true)
            qTail = spread(data, x, y - 1, z, level - 1, qTail, true)
            qTail = spread(data, x, y + 1, z, level - 1, qTail, true)
            qTail = spread(data, x, y, z - 1, level - 1, qTail, true)
            qTail = spread(data, x, y, z + 1, level - 1, qTail, true)
        }
        return qTail
    }

    private fun floodBlock(data: ChunkData, tail0: Int) {
        var qHead = 0
        var qTail = tail0
        while (qHead < qTail) {
            val packed = queue[qHead++]
            val i = packed ushr 4
            val level = packed and 0xF
            if ((data.light[i].toInt() and 0xF) > level) continue
            if (level <= 1) continue
            val x = i and 15; val z = (i shr 4) and 15; val y = i shr 8
            qTail = spread(data, x - 1, y, z, level - 1, qTail, false)
            qTail = spread(data, x + 1, y, z, level - 1, qTail, false)
            qTail = spread(data, x, y - 1, z, level - 1, qTail, false)
            qTail = spread(data, x, y + 1, z, level - 1, qTail, false)
            qTail = spread(data, x, y, z - 1, level - 1, qTail, false)
            qTail = spread(data, x, y, z + 1, level - 1, qTail, false)
        }
    }

    private fun spread(data: ChunkData, x: Int, y: Int, z: Int, level: Int, tail0: Int, sky: Boolean): Int {
        if (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y >= HEIGHT) return tail0
        val i = (y shl 8) or (z shl 4) or x
        val id = data.ids[i].toInt()
        if (id != 0) {
            val def = blocks.byId(id)
            if (def.opaque) return tail0
        }
        var qTail = tail0
        if (sky) {
            if (((data.light[i].toInt() ushr 4) and 0xF) < level) {
                data.light[i] = ((data.light[i].toInt() and 0x0F) or (level shl 4)).toByte()
                if (qTail < queue.size) queue[qTail++] = (i shl 4) or level
            }
        } else {
            if ((data.light[i].toInt() and 0xF) < level) {
                data.light[i] = ((data.light[i].toInt() and 0xF0) or level).toByte()
                if (qTail < queue.size) queue[qTail++] = (i shl 4) or level
            }
        }
        return qTail
    }
}
