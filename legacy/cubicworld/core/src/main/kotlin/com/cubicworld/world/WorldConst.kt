package com.cubicworld.world

/** Global world dimensions and tuning constants. */
object WorldConst {
    const val CHUNK = 16              // chunk edge in blocks (x, z)
    const val HEIGHT = 128            // world height in blocks (y)
    const val SEA_LEVEL = 48
    const val SECTION = 16            // vertical mesh-section size
    const val SECTIONS = HEIGHT / SECTION

    const val TICKS_PER_SECOND = 20
    const val DAY_LENGTH_TICKS = 19200      // 16 real minutes per full day
    const val REACH_DISTANCE = 4.6f

    const val MAX_LIGHT = 15

    /** Pack chunk coords into a single Long key. */
    fun chunkKey(cx: Int, cz: Int): Long = (cx.toLong() shl 32) or (cz.toLong() and 0xFFFFFFFFL)
    fun keyX(key: Long): Int = (key shr 32).toInt()
    fun keyZ(key: Long): Int = key.toInt()

    fun floorDiv16(v: Int): Int = v shr 4
    fun mod16(v: Int): Int = v and 15
}
