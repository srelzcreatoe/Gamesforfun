package com.cubicworld.player

import com.cubicworld.world.Difficulty
import com.cubicworld.world.GameMode

/**
 * Health, hunger and related survival timers. All values use half-heart units
 * (20 = full). Creative mode ignores damage and hunger.
 */
class PlayerStats {
    var health = 20
    var hunger = 20
    var insight = 0                    // experience currency (spent at the Rune Loom later)

    private var exhaustion = 0f        // accumulates from actions, drains hunger
    private var regenTimer = 0f
    private var starveTimer = 0f
    private var hurtCooldown = 0f      // brief invulnerability after damage

    val dead: Boolean get() = health <= 0

    fun update(delta: Float, mode: GameMode, moving: Boolean, sprinting: Boolean) {
        if (mode == GameMode.CREATIVE) return
        if (hurtCooldown > 0f) hurtCooldown -= delta

        exhaustion += delta * when {
            sprinting -> 0.045f
            moving -> 0.012f
            else -> 0.003f
        }
        if (exhaustion >= 4f) {
            exhaustion = 0f
            if (hunger > 0) hunger--
        }

        if (hunger >= 16 && health < 20) {
            regenTimer += delta
            if (regenTimer >= 3.5f) {
                regenTimer = 0f
                health++
                exhaustion += 1.2f
            }
        } else regenTimer = 0f

        if (hunger <= 0) {
            starveTimer += delta
            if (starveTimer >= 4f) {
                starveTimer = 0f
                if (health > 4) health--       // starvation weakens but never kills outright
            }
        } else starveTimer = 0f
    }

    /** Apply damage honoring i-frames; returns true if damage was taken. */
    fun damage(amount: Int, mode: GameMode, difficulty: Difficulty): Boolean {
        if (mode == GameMode.CREATIVE || amount <= 0) return false
        if (hurtCooldown > 0f) return false
        val scaled = when (difficulty) {
            Difficulty.CALM -> (amount * 0.6f).toInt().coerceAtLeast(1)
            Difficulty.ADVENTUROUS -> amount
            Difficulty.FIERCE -> (amount * 1.4f).toInt()
        }
        health = (health - scaled).coerceAtLeast(0)
        hurtCooldown = 0.6f
        return true
    }

    fun eat(hungerValue: Int, heal: Int) {
        hunger = (hunger + hungerValue).coerceAtMost(20)
        if (heal > 0) health = (health + heal).coerceAtMost(20)
    }

    fun respawn() {
        health = 20
        hunger = 20
        exhaustion = 0f
        hurtCooldown = 2f
    }
}
