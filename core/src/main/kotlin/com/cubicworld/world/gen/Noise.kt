package com.cubicworld.world.gen

/**
 * Original deterministic value-noise implementation, seeded per world.
 * All math is integer-hash based so results are identical on every device.
 */
class SeededNoise(seed: Long) {

    private val s1 = (seed xor 0x9E3779B97F4A7C15UL.toLong()) or 1L
    private val s2 = (seed * -0x61c8864680b583ebL + 0x2545F4914F6CDD1DL) or 1L

    /** Integer lattice hash -> [-1, 1). */
    private fun hash2(x: Int, y: Int, salt: Int): Float {
        var h = x.toLong() * -0x7ee3623a03d3d63bL + y.toLong() * -0x61c8864680b583ebL + salt * 0x27d4eb2f165667c5L
        h = h xor s1
        h = (h xor (h ushr 27)) * -0x7ee3623a03d3d63bL
        h = h xor (h ushr 31) xor s2
        return ((h and 0xFFFFFF).toInt() / 8388608.0f) - 1.0f
    }

    private fun hash3(x: Int, y: Int, z: Int, salt: Int): Float {
        var h = x.toLong() * -0x7ee3623a03d3d63bL + y.toLong() * -0x61c8864680b583ebL +
            z.toLong() * 0x165667B19E3779F9L + salt * 0x27d4eb2f165667c5L
        h = h xor s2
        h = (h xor (h ushr 29)) * -0x61c8864680b583ebL
        h = h xor (h ushr 32) xor s1
        return ((h and 0xFFFFFF).toInt() / 8388608.0f) - 1.0f
    }

    private fun smooth(t: Float): Float = t * t * t * (t * (t * 6f - 15f) + 10f)

    /** 2D value noise in [-1, 1]. */
    fun noise2(x: Float, y: Float, salt: Int = 0): Float {
        val x0 = fastFloor(x); val y0 = fastFloor(y)
        val tx = smooth(x - x0); val ty = smooth(y - y0)
        val a = hash2(x0, y0, salt); val b = hash2(x0 + 1, y0, salt)
        val c = hash2(x0, y0 + 1, salt); val d = hash2(x0 + 1, y0 + 1, salt)
        val ab = a + (b - a) * tx
        val cd = c + (d - c) * tx
        return ab + (cd - ab) * ty
    }

    /** 3D value noise in [-1, 1]. */
    fun noise3(x: Float, y: Float, z: Float, salt: Int = 0): Float {
        val x0 = fastFloor(x); val y0 = fastFloor(y); val z0 = fastFloor(z)
        val tx = smooth(x - x0); val ty = smooth(y - y0); val tz = smooth(z - z0)
        var result = 0f
        // trilinear blend of the 8 lattice corners
        val w000 = (1 - tx) * (1 - ty) * (1 - tz)
        val w100 = tx * (1 - ty) * (1 - tz)
        val w010 = (1 - tx) * ty * (1 - tz)
        val w110 = tx * ty * (1 - tz)
        val w001 = (1 - tx) * (1 - ty) * tz
        val w101 = tx * (1 - ty) * tz
        val w011 = (1 - tx) * ty * tz
        val w111 = tx * ty * tz
        result += hash3(x0, y0, z0, salt) * w000
        result += hash3(x0 + 1, y0, z0, salt) * w100
        result += hash3(x0, y0 + 1, z0, salt) * w010
        result += hash3(x0 + 1, y0 + 1, z0, salt) * w110
        result += hash3(x0, y0, z0 + 1, salt) * w001
        result += hash3(x0 + 1, y0, z0 + 1, salt) * w101
        result += hash3(x0, y0 + 1, z0 + 1, salt) * w011
        result += hash3(x0 + 1, y0 + 1, z0 + 1, salt) * w111
        return result
    }

    /** Fractal Brownian motion over 2D noise, output roughly [-1, 1]. */
    fun fbm2(x: Float, y: Float, octaves: Int, lacunarity: Float = 2f, gain: Float = 0.5f, salt: Int = 0): Float {
        var amp = 1f; var freq = 1f; var sum = 0f; var norm = 0f
        for (o in 0 until octaves) {
            sum += noise2(x * freq, y * freq, salt + o * 101) * amp
            norm += amp
            amp *= gain
            freq *= lacunarity
        }
        return sum / norm
    }

    fun fbm3(x: Float, y: Float, z: Float, octaves: Int, lacunarity: Float = 2f, gain: Float = 0.5f, salt: Int = 0): Float {
        var amp = 1f; var freq = 1f; var sum = 0f; var norm = 0f
        for (o in 0 until octaves) {
            sum += noise3(x * freq, y * freq, z * freq, salt + o * 101) * amp
            norm += amp
            amp *= gain
            freq *= lacunarity
        }
        return sum / norm
    }

    /** Ridged noise for cliffs and cave tunnels, output [0, 1]. */
    fun ridged2(x: Float, y: Float, octaves: Int, salt: Int = 0): Float {
        var amp = 0.5f; var freq = 1f; var sum = 0f
        for (o in 0 until octaves) {
            sum += (1f - kotlin.math.abs(noise2(x * freq, y * freq, salt + o * 77))) * amp
            amp *= 0.5f
            freq *= 2f
        }
        return sum
    }

    /** Deterministic per-cell random in [0,1) for decoration placement. */
    fun cellRand(x: Int, z: Int, salt: Int): Float = (hash2(x, z, salt) + 1f) * 0.5f

    fun cellRand3(x: Int, y: Int, z: Int, salt: Int): Float = (hash3(x, y, z, salt) + 1f) * 0.5f

    companion object {
        fun fastFloor(v: Float): Int = if (v >= 0) v.toInt() else v.toInt() - 1
    }
}
