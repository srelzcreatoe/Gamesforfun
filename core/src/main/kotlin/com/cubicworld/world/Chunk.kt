package com.cubicworld.world

import com.cubicworld.world.WorldConst.CHUNK
import com.cubicworld.world.WorldConst.HEIGHT
import com.cubicworld.world.WorldConst.SECTIONS
import java.io.DataInputStream
import java.io.DataOutputStream

/**
 * Raw voxel storage for one 16 x 128 x 16 column of the world.
 * Index layout: (y shl 8) or (z shl 4) or x  — x fastest, then z, then y.
 */
class ChunkData {
    val ids = ShortArray(CHUNK * CHUNK * HEIGHT)
    val states = ByteArray(CHUNK * CHUNK * HEIGHT)
    /** packed light: high nibble = skylight, low nibble = block light */
    val light = ByteArray(CHUNK * CHUNK * HEIGHT)
    /** highest non-air y per column +1 (0 = empty column); index z*16+x */
    val heightMap = ShortArray(CHUNK * CHUNK)

    fun idx(x: Int, y: Int, z: Int): Int = (y shl 8) or (z shl 4) or x

    fun get(x: Int, y: Int, z: Int): Short = ids[(y shl 8) or (z shl 4) or x]
    fun getState(x: Int, y: Int, z: Int): Byte = states[(y shl 8) or (z shl 4) or x]

    fun set(x: Int, y: Int, z: Int, id: Short, state: Byte = 0) {
        val i = (y shl 8) or (z shl 4) or x
        ids[i] = id
        states[i] = state
        val hi = (z shl 4) or x
        if (id.toInt() != 0) {
            if (y + 1 > heightMap[hi]) heightMap[hi] = (y + 1).toShort()
        } else if (heightMap[hi].toInt() == y + 1) {
            var yy = y
            while (yy >= 0 && ids[(yy shl 8) or (z shl 4) or x].toInt() == 0) yy--
            heightMap[hi] = (yy + 1).toShort()
        }
    }

    fun skyLight(x: Int, y: Int, z: Int): Int = (light[(y shl 8) or (z shl 4) or x].toInt() ushr 4) and 0xF
    fun blockLight(x: Int, y: Int, z: Int): Int = light[(y shl 8) or (z shl 4) or x].toInt() and 0xF
    fun setLight(x: Int, y: Int, z: Int, sky: Int, block: Int) {
        light[(y shl 8) or (z shl 4) or x] = ((sky shl 4) or block).toByte()
    }

    fun write(out: DataOutputStream) {
        for (s in ids) out.writeShort(s.toInt())
        out.write(states)
    }

    fun read(inp: DataInputStream) {
        for (i in ids.indices) ids[i] = inp.readShort()
        inp.readFully(states)
        rebuildHeightMap()
    }

    fun rebuildHeightMap() {
        for (z in 0 until CHUNK) for (x in 0 until CHUNK) {
            var y = HEIGHT - 1
            while (y >= 0 && ids[(y shl 8) or (z shl 4) or x].toInt() == 0) y--
            heightMap[(z shl 4) or x] = (y + 1).toShort()
        }
    }
}

enum class ChunkState { GENERATING, TERRAIN, DECORATED, ACTIVE }

/**
 * A chunk in the live world: voxel data plus lifecycle/meshing bookkeeping.
 * Data is written by a worker thread during generation, then owned by the
 * main thread once state >= TERRAIN is published.
 */
class Chunk(val cx: Int, val cz: Int) {
    val data = ChunkData()
    /** biome id per column, filled during generation; index z*16+x */
    val biomes = ByteArray(CHUNK * CHUNK)

    @Volatile var state: ChunkState = ChunkState.GENERATING
    /** true when gameplay modified this chunk since last save */
    var modified = false
    /** per-section mesh-needs-rebuild flags, owned by the render side */
    val sectionDirty = BooleanArray(SECTIONS)
    /** monotonically increasing edit stamp used to drop stale mesh jobs */
    var meshStamp = IntArray(SECTIONS)
    var lightDirty = false

    val key: Long get() = WorldConst.chunkKey(cx, cz)

    fun markAllSectionsDirty() {
        for (i in 0 until SECTIONS) sectionDirty[i] = true
    }

    fun markDirtyAt(y: Int) {
        val s = y / WorldConst.SECTION
        if (s in 0 until SECTIONS) sectionDirty[s] = true
        // touching a section boundary also invalidates the neighbour section
        val rem = y and (WorldConst.SECTION - 1)
        if (rem == 0 && s > 0) sectionDirty[s - 1] = true
        if (rem == WorldConst.SECTION - 1 && s < SECTIONS - 1) sectionDirty[s + 1] = true
    }
}
