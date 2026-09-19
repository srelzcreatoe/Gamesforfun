package com.cubicworld.player

import com.badlogic.gdx.math.MathUtils
import com.badlogic.gdx.math.Vector3
import com.cubicworld.world.BlockShape
import com.cubicworld.world.World

/** Result of a voxel raycast: the hit cell and the face-adjacent cell. */
class RayHit {
    var hit = false
    var x = 0; var y = 0; var z = 0
    var faceX = 0; var faceY = 0; var faceZ = 0
    var distance = 0f
}

/**
 * Amanatides & Woo voxel traversal for block targeting.
 * Liquids and air are skipped; cross plants and ladders are targetable.
 */
class Raycaster(private val world: World) {

    fun cast(origin: Vector3, dir: Vector3, maxDist: Float, out: RayHit): RayHit {
        out.hit = false
        var x = MathUtils.floor(origin.x)
        var y = MathUtils.floor(origin.y)
        var z = MathUtils.floor(origin.z)

        val stepX = if (dir.x > 0) 1 else -1
        val stepY = if (dir.y > 0) 1 else -1
        val stepZ = if (dir.z > 0) 1 else -1

        val tDeltaX = if (dir.x != 0f) kotlin.math.abs(1f / dir.x) else Float.MAX_VALUE
        val tDeltaY = if (dir.y != 0f) kotlin.math.abs(1f / dir.y) else Float.MAX_VALUE
        val tDeltaZ = if (dir.z != 0f) kotlin.math.abs(1f / dir.z) else Float.MAX_VALUE

        var tMaxX = if (dir.x != 0f) {
            val bound = if (stepX > 0) x + 1f else x.toFloat()
            kotlin.math.abs((bound - origin.x) / dir.x)
        } else Float.MAX_VALUE
        var tMaxY = if (dir.y != 0f) {
            val bound = if (stepY > 0) y + 1f else y.toFloat()
            kotlin.math.abs((bound - origin.y) / dir.y)
        } else Float.MAX_VALUE
        var tMaxZ = if (dir.z != 0f) {
            val bound = if (stepZ > 0) z + 1f else z.toFloat()
            kotlin.math.abs((bound - origin.z) / dir.z)
        } else Float.MAX_VALUE

        var prevX = x; var prevY = y; var prevZ = z
        var t = 0f
        var steps = 0
        while (t <= maxDist && steps < 256) {
            val def = world.blockDefAt(x, y, z)
            if (!def.isAir && def.shape != BlockShape.LIQUID) {
                out.hit = true
                out.x = x; out.y = y; out.z = z
                out.faceX = prevX; out.faceY = prevY; out.faceZ = prevZ
                out.distance = t
                return out
            }
            prevX = x; prevY = y; prevZ = z
            when {
                tMaxX < tMaxY && tMaxX < tMaxZ -> { x += stepX; t = tMaxX; tMaxX += tDeltaX }
                tMaxY < tMaxZ -> { y += stepY; t = tMaxY; tMaxY += tDeltaY }
                else -> { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ }
            }
            steps++
        }
        return out
    }
}
