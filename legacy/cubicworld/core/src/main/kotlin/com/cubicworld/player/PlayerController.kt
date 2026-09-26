package com.cubicworld.player

import com.badlogic.gdx.math.MathUtils
import com.badlogic.gdx.math.Vector3
import com.cubicworld.world.BlockShape
import com.cubicworld.world.GameMode
import com.cubicworld.world.World

/**
 * Kinematic player body: AABB vs voxel collision with per-axis sweeps,
 * walking/sprinting/crouching, jumping, swimming, ladder climbing, creative
 * flight, step-up over small ledges and fall damage accounting.
 */
class PlayerController(private val world: World) {

    val position = Vector3()          // feet center
    val velocity = Vector3()
    var yaw = 0f                      // degrees, 0 = -z
    var pitch = 0f                    // degrees, positive looks up

    var onGround = false
    var inLiquid = false
    var headInLiquid = false
    var onLadder = false
    var flying = false
    var sprinting = false
    var crouching = false

    private var fallStart = Float.MIN_VALUE
    /** set by the physics step when a landing causes damage */
    var pendingFallDamage = 0

    val halfWidth = 0.3f
    val height: Float get() = if (crouching) 1.5f else 1.8f
    val eyeHeight: Float get() = if (crouching) 1.35f else 1.62f

    // input for the current frame, set by the input layer
    var moveX = 0f                    // strafe -1..1
    var moveZ = 0f                    // forward -1..1
    var wantJump = false
    var wantDescend = false

    private val tmp = Vector3()

    fun update(delta: Float, mode: GameMode) {
        val dt = delta.coerceAtMost(0.05f)
        updateEnvironmentFlags()

        if (flying && mode != GameMode.CREATIVE) flying = false

        // desired horizontal velocity from joystick, rotated by yaw
        val yawRad = yaw * MathUtils.degreesToRadians
        val sin = MathUtils.sin(yawRad)
        val cos = MathUtils.cos(yawRad)
        val dirX = moveX * cos - moveZ * sin
        val dirZ = moveX * sin + moveZ * cos
        var speed = when {
            flying -> 11f
            sprinting && !crouching -> 5.6f
            crouching -> 1.6f
            else -> 4.2f
        }
        if (inLiquid && !flying) speed *= 0.55f

        val accel = when {
            flying -> 30f
            onGround -> 42f
            inLiquid -> 16f
            else -> 10f
        }
        velocity.x = approach(velocity.x, dirX * speed, accel * dt)
        velocity.z = approach(velocity.z, dirZ * speed, accel * dt)

        // vertical motion
        when {
            flying -> {
                val target = when {
                    wantJump -> 9f
                    wantDescend -> -9f
                    else -> 0f
                }
                velocity.y = approach(velocity.y, target, 40f * dt)
            }
            onLadder -> {
                velocity.y = when {
                    wantJump -> 2.8f
                    moveZ > 0.2f -> 2.4f
                    wantDescend || crouching -> -2.6f
                    else -> velocity.y.coerceIn(-1.2f, 1.2f) * 0.8f
                }
            }
            inLiquid -> {
                velocity.y += -6f * dt
                if (wantJump) velocity.y = approach(velocity.y, 3.4f, 30f * dt)
                velocity.y = velocity.y.coerceIn(-3.4f, 4f)
            }
            else -> {
                velocity.y -= 23f * dt
                if (velocity.y < -50f) velocity.y = -50f
                if (wantJump && onGround) {
                    velocity.y = 7.4f
                    onGround = false
                }
            }
        }

        // fall tracking (for damage on landing)
        if (!onGround && !inLiquid && !flying && !onLadder) {
            if (velocity.y < 0 && fallStart == Float.MIN_VALUE) fallStart = position.y
        }

        moveAndCollide(velocity.x * dt, velocity.y * dt, velocity.z * dt, mode)

        if (onGround || inLiquid || flying || onLadder) {
            if (fallStart != Float.MIN_VALUE && onGround) {
                val fall = fallStart - position.y
                if (fall > 3.4f && mode != GameMode.CREATIVE) {
                    pendingFallDamage = ((fall - 3.4f) * 0.9f).toInt().coerceAtLeast(0)
                }
            }
            fallStart = Float.MIN_VALUE
        }
    }

    private fun approach(current: Float, target: Float, maxDelta: Float): Float =
        when {
            current < target -> (current + maxDelta).coerceAtMost(target)
            current > target -> (current - maxDelta).coerceAtLeast(target)
            else -> current
        }

    private fun updateEnvironmentFlags() {
        inLiquid = isLiquidAt(position.x, position.y + 0.4f, position.z) ||
            isLiquidAt(position.x, position.y + 0.1f, position.z)
        headInLiquid = isLiquidAt(position.x, position.y + eyeHeight, position.z)
        val def = world.blockDefAt(
            MathUtils.floor(position.x), MathUtils.floor(position.y + 0.5f), MathUtils.floor(position.z),
        )
        onLadder = def.shape == BlockShape.LADDER
    }

    private fun isLiquidAt(x: Float, y: Float, z: Float): Boolean =
        world.blockDefAt(MathUtils.floor(x), MathUtils.floor(y), MathUtils.floor(z)).isLiquid

    // ---- collision --------------------------------------------------------

    /** collision height of the block cell, 0 = passable */
    private fun solidHeight(bx: Int, by: Int, bz: Int): Float {
        val def = world.blockDefAt(bx, by, bz)
        if (!def.solid) return 0f
        return if (def.shape == BlockShape.SLAB) 0.5f else 1f
    }

    private fun collides(x: Float, y: Float, z: Float): Boolean {
        val minX = MathUtils.floor(x - halfWidth)
        val maxX = MathUtils.floor(x + halfWidth)
        val minY = MathUtils.floor(y)
        val maxY = MathUtils.floor(y + height - 0.001f)
        val minZ = MathUtils.floor(z - halfWidth)
        val maxZ = MathUtils.floor(z + halfWidth)
        for (by in minY..maxY) for (bz in minZ..maxZ) for (bx in minX..maxX) {
            val h = solidHeight(bx, by, bz)
            if (h > 0f && y < by + h && y + height > by) return true
        }
        return false
    }

    private fun moveAndCollide(dx: Float, dy: Float, dz: Float, mode: GameMode) {
        // Y axis
        if (dy != 0f) {
            if (!collides(position.x, position.y + dy, position.z)) {
                position.y += dy
                if (dy < 0) onGround = false
            } else {
                if (dy < 0) {
                    // snap down to the surface below
                    var step = dy
                    while (step < -0.001f && collides(position.x, position.y + step, position.z)) step += 0.01f
                    position.y += step
                    onGround = true
                } else {
                    velocity.y = 0f
                }
                if (dy < 0) velocity.y = 0f
            }
        } else if (velocity.y == 0f) {
            onGround = collides(position.x, position.y - 0.02f, position.z)
        }

        // X axis with step-up
        if (dx != 0f) {
            if (!collides(position.x + dx, position.y, position.z)) {
                position.x += dx
            } else if (canStepUp(dx, 0f)) {
                position.y += stepHeight(dx, 0f)
                position.x += dx
            } else {
                velocity.x = 0f
            }
        }
        // Z axis with step-up
        if (dz != 0f) {
            if (!collides(position.x, position.y, position.z + dz)) {
                position.z += dz
            } else if (canStepUp(0f, dz)) {
                position.y += stepHeight(0f, dz)
                position.z += dz
            } else {
                velocity.z = 0f
            }
        }

        // crouch edge-guard: don't walk off edges while crouching on ground
        if (crouching && onGround && !flying) {
            if (!collides(position.x, position.y - 0.1f, position.z)) {
                // stepped past an edge: undo horizontal move
                if (dx != 0f && !hasGroundAt(position.x, position.z)) position.x -= dx
                if (dz != 0f && !hasGroundAt(position.x, position.z)) position.z -= dz
            }
        }

        position.y = position.y.coerceIn(0f, com.cubicworld.world.WorldConst.HEIGHT - 2f)
    }

    private fun hasGroundAt(x: Float, z: Float): Boolean = collides(x, position.y - 0.1f, z)

    private fun canStepUp(dx: Float, dz: Float): Boolean {
        if (!onGround && !inLiquid) return false
        val step = stepHeight(dx, dz)
        return step > 0f && !collides(position.x + dx, position.y + step, position.z + dz)
    }

    private fun stepHeight(dx: Float, dz: Float): Float {
        for (h in floatArrayOf(0.51f, 0.55f, 1.01f)) {
            if (h > 0.6f && !onGround) break
            if (h > 0.6f) continue        // only step a full block via auto-jump (not enabled here)
            if (!collides(position.x + dx, position.y + h, position.z + dz)) return h
        }
        return 0f
    }

    /** Teleport safely to a location (spawn / respawn). */
    fun teleport(x: Float, y: Float, z: Float) {
        position.set(x, y, z)
        velocity.setZero()
        fallStart = Float.MIN_VALUE
        var tries = 0
        while (collides(position.x, position.y, position.z) && tries < 64) {
            position.y += 1f
            tries++
        }
    }

    /** Direction the player looks along. */
    fun lookDir(out: Vector3): Vector3 {
        val yawRad = yaw * MathUtils.degreesToRadians
        val pitchRad = pitch * MathUtils.degreesToRadians
        out.set(
            -MathUtils.sin(yawRad) * MathUtils.cos(pitchRad),
            MathUtils.sin(pitchRad),
            -MathUtils.cos(yawRad) * MathUtils.cos(pitchRad),
        )
        return out.nor()
    }

    fun eyePosition(out: Vector3): Vector3 = out.set(position.x, position.y + eyeHeight, position.z)
}
