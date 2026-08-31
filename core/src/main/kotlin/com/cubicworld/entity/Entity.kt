package com.cubicworld.entity

import com.badlogic.gdx.math.MathUtils
import com.badlogic.gdx.math.Vector3
import com.cubicworld.world.BlockShape
import com.cubicworld.world.World

/** Base moving thing in the world with AABB voxel collision. */
abstract class Entity(val world: World) {
    val position = Vector3()          // feet center
    val velocity = Vector3()
    var yaw = 0f
    open val halfWidth = 0.3f
    open val height = 0.8f
    var onGround = false
    var inLiquid = false
    var dead = false
    var age = 0f

    open val gravityScale = 1f

    abstract fun update(delta: Float)

    protected fun physicsStep(delta: Float) {
        val dt = delta.coerceAtMost(0.05f)
        inLiquid = world.blockDefAt(
            MathUtils.floor(position.x), MathUtils.floor(position.y + 0.2f), MathUtils.floor(position.z),
        ).isLiquid
        if (gravityScale > 0f) {
            velocity.y -= 23f * gravityScale * dt * (if (inLiquid) 0.3f else 1f)
            if (inLiquid && velocity.y < -1.5f) velocity.y = -1.5f
            if (velocity.y < -40f) velocity.y = -40f
        }
        move(velocity.x * dt, velocity.y * dt, velocity.z * dt)
        // ground friction
        val friction = if (onGround) 12f else 2f
        velocity.x -= velocity.x * (friction * dt).coerceAtMost(1f)
        velocity.z -= velocity.z * (friction * dt).coerceAtMost(1f)
        age += delta
    }

    private fun solidAt(x: Float, y: Float, z: Float): Boolean {
        val def = world.blockDefAt(MathUtils.floor(x), MathUtils.floor(y), MathUtils.floor(z))
        if (!def.solid) return false
        if (def.shape == BlockShape.SLAB) {
            return y - MathUtils.floor(y) < 0.5f
        }
        return true
    }

    private fun boxCollides(x: Float, y: Float, z: Float): Boolean {
        for (oy in floatArrayOf(0.05f, height - 0.05f)) {
            for (ox in floatArrayOf(-halfWidth, halfWidth)) for (oz in floatArrayOf(-halfWidth, halfWidth)) {
                if (solidAt(x + ox, y + oy, z + oz)) return true
            }
        }
        return false
    }

    private fun move(dx: Float, dy: Float, dz: Float) {
        if (dy != 0f) {
            if (!boxCollides(position.x, position.y + dy, position.z)) {
                position.y += dy
                if (dy < 0f) onGround = false
            } else {
                if (dy < 0f) onGround = true
                velocity.y = 0f
            }
        }
        if (dx != 0f) {
            if (!boxCollides(position.x + dx, position.y, position.z)) position.x += dx
            else if (onGround && !boxCollides(position.x + dx, position.y + 0.55f, position.z)) {
                position.y += 0.55f; position.x += dx
            } else velocity.x = 0f
        }
        if (dz != 0f) {
            if (!boxCollides(position.x, position.y, position.z + dz)) position.z += dz
            else if (onGround && !boxCollides(position.x, position.y + 0.55f, position.z + dz)) {
                position.y += 0.55f; position.z += dz
            } else velocity.z = 0f
        }
        position.y = position.y.coerceIn(0f, com.cubicworld.world.WorldConst.HEIGHT - 2f)
    }

    fun distanceTo(x: Float, y: Float, z: Float): Float {
        val dx = position.x - x; val dy = position.y - y; val dz = position.z - z
        return kotlin.math.sqrt(dx * dx + dy * dy + dz * dz)
    }
}

/** A dropped item stack lying in the world, magnetised to a nearby player. */
class DropItem(world: World, var itemId: Int, var count: Int, var durability: Int = 0) : Entity(world) {
    override val halfWidth = 0.15f
    override val height = 0.3f
    var pickupDelay = 0.4f

    override fun update(delta: Float) {
        physicsStep(delta)
        if (pickupDelay > 0f) pickupDelay -= delta
        if (age > 300f) dead = true          // despawn after 5 minutes
    }
}
