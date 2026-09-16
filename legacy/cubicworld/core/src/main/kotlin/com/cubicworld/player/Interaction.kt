package com.cubicworld.player

import com.badlogic.gdx.math.Vector3
import com.cubicworld.entity.Creature
import com.cubicworld.entity.EntityManager
import com.cubicworld.inv.CraftingManager
import com.cubicworld.inv.ContainerStore
import com.cubicworld.inv.Inventory
import com.cubicworld.inv.ItemKind
import com.cubicworld.world.BlockShape
import com.cubicworld.world.GameMode
import com.cubicworld.world.World
import com.cubicworld.world.WorldConst

/**
 * Block breaking with hold-to-break progress, placement with player-collision
 * protection, station/container interaction, eating and melee combat.
 */
class Interaction(
    private val world: World,
    private val player: PlayerController,
    private val stats: PlayerStats,
    private val inventory: Inventory,
    private val crafting: CraftingManager,
    private val containers: ContainerStore,
    private val entities: EntityManager,
    private val mode: GameMode,
) {
    private val raycaster = Raycaster(world)
    val target = RayHit()

    var breakProgress = 0f              // 0..1 for the HUD indicator
        private set
    private var breakX = 0; private var breakY = 0; private var breakZ = 0
    private var eatTimer = 0f

    /** callbacks into the UI layer */
    var onOpenStation: ((String) -> Unit)? = null
    var onOpenContainer: ((Int, Int, Int) -> Unit)? = null
    var onSound: ((String) -> Unit)? = null
    var onAte: (() -> Unit)? = null

    private val tmpEye = Vector3()
    private val tmpDir = Vector3()

    private val stationBlocks = setOf("handwork_mat", "forge_table", "kiln", "cookpot")

    fun updateTarget() {
        player.eyePosition(tmpEye)
        player.lookDir(tmpDir)
        raycaster.cast(tmpEye, tmpDir, WorldConst.REACH_DISTANCE, target)
    }

    // ---- breaking ---------------------------------------------------------

    /** Call every frame while the break control is held. */
    fun continueBreaking(delta: Float) {
        if (!target.hit) { breakProgress = 0f; return }
        if (target.x != breakX || target.y != breakY || target.z != breakZ) {
            breakX = target.x; breakY = target.y; breakZ = target.z
            breakProgress = 0f
        }
        val def = world.blockDefAt(target.x, target.y, target.z)
        if (def.isAir) { breakProgress = 0f; return }
        if (def.hardness < 0f) return                       // unbreakable

        if (mode == GameMode.CREATIVE) {
            finishBreak(dropItems = false)
            return
        }
        val held = inventory.selectedItem()
        var speed = 1f
        if (held != null && held.kind == ItemKind.TOOL && held.toolType == def.tool) {
            speed = held.efficiency
        }
        val time = (def.hardness / speed).coerceAtLeast(0.05f)
        breakProgress += delta / time
        if (breakProgress >= 1f) finishBreak(dropItems = true)
    }

    fun stopBreaking() {
        breakProgress = 0f
    }

    private fun finishBreak(dropItems: Boolean) {
        val def = world.blockDefAt(target.x, target.y, target.z)
        if (def.isAir) return
        breakProgress = 0f

        // container contents spill out
        if (containers.existsAt(target.x, target.y, target.z)) {
            for (stack in containers.removeAt(target.x, target.y, target.z)) {
                entities.spawnDrop(
                    target.x + 0.5f, target.y + 0.5f, target.z + 0.5f,
                    stack.itemId, stack.count, stack.durability,
                )
            }
        }

        world.setBlock(target.x, target.y, target.z, 0)
        onSound?.invoke("break_${def.material.name.lowercase()}")

        if (dropItems) {
            val held = inventory.selectedItem()
            val heldTier = if (held != null && held.kind == ItemKind.TOOL) held.tier else 0
            val tierOk = def.minTier <= 0 ||
                (held != null && held.toolType == def.tool && heldTier >= def.minTier)
            if (tierOk) {
                val dropName = def.dropsName
                val dropDef = when {
                    dropName == "none" -> null
                    dropName == null -> world.registries.items.byName(def.name)
                    else -> world.registries.items.byName(dropName)
                }
                if (dropDef != null) {
                    entities.spawnDrop(
                        target.x + 0.5f, target.y + 0.4f, target.z + 0.5f,
                        dropDef.id, def.dropCount,
                    )
                }
            }
            useToolDurability(def.tool)
            stats.insight += 1
        }
    }

    private fun useToolDurability(neededTool: com.cubicworld.world.ToolType) {
        if (mode == GameMode.CREATIVE) return
        val slot = inventory.selected
        val held = inventory.selectedItem() ?: return
        if (held.kind != ItemKind.TOOL) return
        slot.durability -= 1
        if (slot.durability <= 0) {
            slot.clear()
            onSound?.invoke("tool_break")
        }
    }

    // ---- placing / interacting -------------------------------------------

    /** Tap action: interact with the target, or place the held block. */
    fun tapAction(): Boolean {
        if (!target.hit) return false
        val targetDef = world.blockDefAt(target.x, target.y, target.z)

        // interactions come first
        if (targetDef.name in stationBlocks) {
            onOpenStation?.invoke(targetDef.name)
            return true
        }
        if (targetDef.name == "storage_crate") {
            onOpenContainer?.invoke(target.x, target.y, target.z)
            return true
        }

        val held = inventory.selectedItem()

        // cultivator tills soil
        if (held != null && held.toolType == com.cubicworld.world.ToolType.CULTIVATOR &&
            (targetDef.name == "grass_sod" || targetDef.name == "soil")
        ) {
            val tilled = world.registries.blocks.byName("tilled_soil")
            if (tilled != null && world.blockDefAt(target.x, target.y + 1, target.z).isAir) {
                world.setBlock(target.x, target.y, target.z, tilled.id)
                onSound?.invoke("dig_earth")
                return true
            }
        }

        return placeHeldBlock()
    }

    private fun placeHeldBlock(): Boolean {
        val held = inventory.selectedItem() ?: return false
        if (held.kind != ItemKind.BLOCK) return false
        val block = world.registries.blocks.byId(held.blockId.toInt())

        val px = target.faceX; val py = target.faceY; val pz = target.faceZ
        if (py < 0 || py >= WorldConst.HEIGHT) return false
        val current = world.blockDefAt(px, py, pz)
        if (!current.isAir && !current.isLiquid && current.shape != BlockShape.CROSS) return false

        // crops need tilled soil
        if (block.name.endsWith("_crop")) {
            if (world.blockDefAt(px, py - 1, pz).name != "tilled_soil") return false
        }
        // cross plants need solid ground
        if (block.shape == BlockShape.CROSS && !world.blockDefAt(px, py - 1, pz).solid) return false
        // ladders need a solid horizontal neighbour
        if (block.shape == BlockShape.LADDER) {
            var ok = false
            for (d in 0 until 4) {
                val nx = px + intArrayOf(-1, 1, 0, 0)[d]
                val nz = pz + intArrayOf(0, 0, -1, 1)[d]
                if (world.blockDefAt(nx, py, nz).opaque) { ok = true; break }
            }
            if (!ok) return false
        }

        // never place a solid block inside the player's body
        if (block.solid && intersectsPlayer(px, py, pz)) return false

        world.setBlock(px, py, pz, block.id)
        onSound?.invoke("place_${block.material.name.lowercase()}")
        if (mode != GameMode.CREATIVE) {
            inventory.selected.count -= 1
            if (inventory.selected.count <= 0) inventory.selected.clear()
        }
        return true
    }

    private fun intersectsPlayer(bx: Int, by: Int, bz: Int): Boolean {
        val p = player.position
        val hw = player.halfWidth
        return bx + 1 > p.x - hw && bx < p.x + hw &&
            by + 1 > p.y && by < p.y + player.height &&
            bz + 1 > p.z - hw && bz < p.z + hw
    }

    // ---- combat -----------------------------------------------------------

    /** Melee swing: hits the nearest creature along the look ray. */
    fun attack(): Boolean {
        player.eyePosition(tmpEye)
        player.lookDir(tmpDir)
        var best: Creature? = null
        var bestT = WorldConst.REACH_DISTANCE
        for (e in entities.entities) {
            if (e !is Creature) continue
            val t = rayVsAabb(tmpEye, tmpDir, e)
            if (t in 0f..bestT) { bestT = t; best = e }
        }
        val creature = best ?: return false
        val held = inventory.selectedItem()
        val damage = held?.damage ?: 1
        val died = creature.hurt(damage, player.position.x, player.position.z)
        onSound?.invoke(if (died) "creature_die" else "hit")
        useToolDurability(com.cubicworld.world.ToolType.BLADE)
        if (died) stats.insight += 3
        return true
    }

    private fun rayVsAabb(origin: Vector3, dir: Vector3, e: Creature): Float {
        val minX = e.position.x - e.halfWidth; val maxX = e.position.x + e.halfWidth
        val minY = e.position.y; val maxY = e.position.y + e.height
        val minZ = e.position.z - e.halfWidth; val maxZ = e.position.z + e.halfWidth
        var tMin = 0f
        var tMax = Float.MAX_VALUE
        for (axis in 0 until 3) {
            val o = when (axis) { 0 -> origin.x; 1 -> origin.y; else -> origin.z }
            val d = when (axis) { 0 -> dir.x; 1 -> dir.y; else -> dir.z }
            val mn = when (axis) { 0 -> minX; 1 -> minY; else -> minZ }
            val mx = when (axis) { 0 -> maxX; 1 -> maxY; else -> maxZ }
            if (kotlin.math.abs(d) < 1e-6f) {
                if (o < mn || o > mx) return -1f
            } else {
                var t1 = (mn - o) / d
                var t2 = (mx - o) / d
                if (t1 > t2) { val t = t1; t1 = t2; t2 = t }
                tMin = maxOf(tMin, t1)
                tMax = minOf(tMax, t2)
                if (tMin > tMax) return -1f
            }
        }
        return tMin
    }

    // ---- eating -----------------------------------------------------------

    /** Call each frame while the use control is held with food selected. */
    fun continueEating(delta: Float): Boolean {
        val held = inventory.selectedItem() ?: run { eatTimer = 0f; return false }
        if (held.kind != ItemKind.FOOD || stats.hunger >= 20) { eatTimer = 0f; return false }
        eatTimer += delta
        if (eatTimer >= 1.2f) {
            eatTimer = 0f
            stats.eat(held.foodHunger, held.foodHeal)
            inventory.selected.count -= 1
            if (inventory.selected.count <= 0) inventory.selected.clear()
            onSound?.invoke("eat")
            onAte?.invoke()
        }
        return true
    }

    fun stopEating() { eatTimer = 0f }
}
