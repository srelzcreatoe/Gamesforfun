package com.cubicworld.entity

import com.badlogic.gdx.math.MathUtils
import com.badlogic.gdx.math.Vector3
import com.cubicworld.world.Difficulty
import com.cubicworld.world.World

enum class AiState { IDLE, WANDER, FLEE, WARN, CHASE, ATTACK }

/**
 * A living creature driven by a small state machine: idle/wander for passive
 * life, warn/chase/attack for hostiles, flee on damage or bright light for
 * shade-dwellers. Movement probes ahead to avoid cliffs and unsuitable liquid.
 */
class Creature(world: World, val def: CreatureDef) : Entity(world) {
    override val halfWidth = def.width / 2f
    override val height = def.height
    override val gravityScale = if (def.name == "glowmoth") 0f else 1f

    var health = def.health
    var state = AiState.IDLE
    private var stateTimer = 0f
    private var attackCooldown = 0f
    private var hurtFlash = 0f
    private var wanderDir = 0f
    private var provoked = false
    var animTime = 0f

    /** set every frame by the manager */
    var playerPos: Vector3 = Vector3()
    var difficulty: Difficulty = Difficulty.ADVENTUROUS

    /** callback into gameplay when this creature lands a hit */
    var onAttackPlayer: ((Int) -> Unit)? = null

    val hurtVisual: Float get() = hurtFlash

    override fun update(delta: Float) {
        stateTimer -= delta
        if (attackCooldown > 0f) attackCooldown -= delta
        if (hurtFlash > 0f) hurtFlash -= delta
        animTime += delta * (1f + velocity.len() * 0.6f)

        when (state) {
            AiState.IDLE -> {
                if (stateTimer <= 0f) enter(AiState.WANDER, 2f + rnd() * 4f)
                checkAggro()
            }
            AiState.WANDER -> {
                walkForward(def.speed * 0.6f, delta)
                if (stateTimer <= 0f) enter(AiState.IDLE, 1f + rnd() * 3f)
                checkAggro()
            }
            AiState.FLEE -> {
                // run away from the player
                faceAwayFrom(playerPos)
                walkForward(def.speed * 1.3f, delta)
                if (stateTimer <= 0f) enter(AiState.IDLE, 1f)
            }
            AiState.WARN -> {
                faceToward(playerPos)
                if (stateTimer <= 0f) {
                    if (distanceTo(playerPos.x, playerPos.y, playerPos.z) < 6f) enter(AiState.CHASE, 12f)
                    else enter(AiState.IDLE, 2f)
                }
            }
            AiState.CHASE -> {
                faceToward(playerPos)
                walkForward(def.speed, delta)
                val d = distanceTo(playerPos.x, playerPos.y, playerPos.z)
                if (d < 1.6f) enter(AiState.ATTACK, 0.4f)
                if (d > 18f || stateTimer <= 0f) enter(AiState.IDLE, 2f)
                fleeFromLightIfShy()
            }
            AiState.ATTACK -> {
                faceToward(playerPos)
                if (attackCooldown <= 0f) {
                    val d = distanceTo(playerPos.x, playerPos.y, playerPos.z)
                    if (d < 2f) {
                        onAttackPlayer?.invoke(def.damage)
                        attackCooldown = 1.1f
                    }
                }
                if (stateTimer <= 0f) enter(AiState.CHASE, 10f)
            }
        }

        // glowmoth drifts vertically instead of walking
        if (gravityScale == 0f) {
            velocity.y = MathUtils.sin(age * 1.3f) * 0.8f
            if (position.y < world.surfaceHeight(position.x.toInt(), position.z.toInt()) + 2f) velocity.y += 0.5f
        }

        physicsStep(delta)
    }

    private fun enter(s: AiState, time: Float) {
        state = s
        stateTimer = time
        if (s == AiState.WANDER) wanderDir = rnd() * 360f
    }

    private fun rnd(): Float = MathUtils.random()

    private fun checkAggro() {
        if (!def.hostile) return
        val d = distanceTo(playerPos.x, playerPos.y, playerPos.z)
        val calm = difficulty == Difficulty.CALM && !provoked
        if (calm) return
        when (def.name) {
            "shardspine" -> if (d < 5f) enter(AiState.WARN, 1.4f)
            else -> if (d < 12f && lightOk()) enter(AiState.CHASE, 12f)
        }
    }

    private fun lightOk(): Boolean {
        val l = world.lightAt(position.x.toInt(), (position.y + 0.5f).toInt(), position.z.toInt())
        val sky = (l ushr 4) and 0xF
        val effective = maxOf((sky * world.sunFactor()).toInt(), l and 0xF)
        return effective <= def.spawnMaxLight + 2
    }

    private fun fleeFromLightIfShy() {
        if (def.name != "duskling") return
        val l = world.lightAt(position.x.toInt(), (position.y + 0.5f).toInt(), position.z.toInt())
        val block = l and 0xF
        if (block >= 10) enter(AiState.FLEE, 3f)
    }

    private fun faceToward(target: Vector3) {
        yaw = MathUtils.atan2(-(target.x - position.x), -(target.z - position.z)) * MathUtils.radiansToDegrees
    }

    private fun faceAwayFrom(target: Vector3) {
        yaw = MathUtils.atan2(target.x - position.x, target.z - position.z) * MathUtils.radiansToDegrees
    }

    private fun walkForward(speed: Float, delta: Float) {
        val dir = if (state == AiState.WANDER) wanderDir else yaw
        val rad = dir * MathUtils.degreesToRadians
        val dx = -MathUtils.sin(rad)
        val dz = -MathUtils.cos(rad)
        // probe ahead: avoid cliffs and liquid for grounded walkers
        if (gravityScale > 0f) {
            val px = position.x + dx * 1.2f
            val pz = position.z + dz * 1.2f
            val groundY = groundBelow(px, pz)
            if (position.y - groundY > 3.5f || liquidAt(px, groundY + 0.5f, pz)) {
                wanderDir += 140f + rnd() * 80f
                if (state != AiState.WANDER) yaw += 160f
                return
            }
            // hop up single-block ledges ahead
            if (onGround && groundY > position.y + 0.6f && groundY < position.y + 1.4f) {
                velocity.y = 6.4f
            }
        }
        velocity.x += dx * speed * delta * 8f
        velocity.z += dz * speed * delta * 8f
        val maxV = speed
        val h = kotlin.math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z)
        if (h > maxV) {
            velocity.x = velocity.x / h * maxV
            velocity.z = velocity.z / h * maxV
        }
        if (state == AiState.WANDER) yaw = dir
    }

    private fun groundBelow(x: Float, z: Float): Float {
        var y = (position.y + 2f).toInt().coerceAtMost(com.cubicworld.world.WorldConst.HEIGHT - 1)
        while (y > 0 && !world.blockDefAt(x.toInt(), y, z.toInt()).solid) y--
        return y + 1f
    }

    private fun liquidAt(x: Float, y: Float, z: Float): Boolean =
        world.blockDefAt(MathUtils.floor(x), MathUtils.floor(y), MathUtils.floor(z)).isLiquid

    /** Apply damage with knockback from a source position; true if it died. */
    fun hurt(amount: Int, fromX: Float, fromZ: Float): Boolean {
        health -= amount
        hurtFlash = 0.35f
        provoked = true
        val dx = position.x - fromX
        val dz = position.z - fromZ
        val len = kotlin.math.sqrt(dx * dx + dz * dz).coerceAtLeast(0.01f)
        velocity.x += dx / len * 6f
        velocity.z += dz / len * 6f
        velocity.y = 4.5f
        if (def.hostile) enter(AiState.CHASE, 14f) else enter(AiState.FLEE, 6f)
        if (health <= 0) { dead = true; return true }
        return false
    }
}
