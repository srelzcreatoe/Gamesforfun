package com.cubicworld.entity

import com.badlogic.gdx.math.MathUtils
import com.badlogic.gdx.math.Vector3
import com.cubicworld.world.Difficulty
import com.cubicworld.world.GameMode
import com.cubicworld.world.World
import java.io.File

/**
 * Owns all live entities: updates, biome/light/time-based spawning with
 * population caps, pickup magnetism, despawn and persistence.
 */
class EntityManager(
    private val world: World,
    private val creatureDefs: CreatureRegistry,
) {
    val entities = ArrayList<Entity>()
    private var spawnTimer = 0f

    var onPickup: ((itemId: Int, count: Int, durability: Int) -> Int)? = null
    var onPlayerDamaged: ((Int) -> Unit)? = null

    companion object {
        const val GLOBAL_CAP = 36
        const val SPECIES_CAP = 7
        const val DESPAWN_DIST = 72f
        const val SIM_DIST = 56f
    }

    fun update(delta: Float, playerPos: Vector3, mode: GameMode, difficulty: Difficulty) {
        val it = entities.iterator()
        while (it.hasNext()) {
            val e = it.next()
            if (e.distanceTo(playerPos.x, playerPos.y, playerPos.z) > SIM_DIST) continue
            when (e) {
                is Creature -> {
                    e.playerPos = playerPos
                    e.difficulty = difficulty
                    e.onAttackPlayer = { dmg -> if (mode != GameMode.CREATIVE) onPlayerDamaged?.invoke(dmg) }
                    e.update(delta)
                    if (e.dead) {
                        dropLoot(e)
                        it.remove()
                    } else if (e.distanceTo(playerPos.x, playerPos.y, playerPos.z) > DESPAWN_DIST) {
                        it.remove()
                    }
                }
                is DropItem -> {
                    e.update(delta)
                    val d = e.distanceTo(playerPos.x, playerPos.y + 0.8f, playerPos.z)
                    if (e.pickupDelay <= 0f) {
                        if (d < 2.6f) {
                            // magnet toward the player
                            val pull = 8f * delta
                            e.velocity.x += (playerPos.x - e.position.x) / d * pull * 4f
                            e.velocity.y += (playerPos.y + 0.8f - e.position.y) / d * pull * 4f
                            e.velocity.z += (playerPos.z - e.position.z) / d * pull * 4f
                        }
                        if (d < 1.1f) {
                            val leftover = onPickup?.invoke(e.itemId, e.count, e.durability) ?: e.count
                            if (leftover <= 0) it.remove() else e.count = leftover
                        }
                    }
                    if (e.dead) it.remove()
                }
                else -> e.update(delta)
            }
        }

        spawnTimer -= delta
        if (spawnTimer <= 0f) {
            spawnTimer = 2.5f
            trySpawn(playerPos, difficulty)
        }
    }

    private fun dropLoot(c: Creature) {
        for (drop in c.def.drops) {
            val count = MathUtils.random(drop.min, drop.max)
            if (count <= 0) continue
            spawnDrop(c.position.x, c.position.y + 0.3f, c.position.z, drop.itemId, count)
        }
    }

    fun spawnDrop(x: Float, y: Float, z: Float, itemId: Int, count: Int, durability: Int = 0) {
        val d = DropItem(world, itemId, count, durability)
        d.position.set(x, y, z)
        d.velocity.set(MathUtils.random(-1.5f, 1.5f), 3f, MathUtils.random(-1.5f, 1.5f))
        entities.add(d)
    }

    // ---- spawning ---------------------------------------------------------

    private fun trySpawn(playerPos: Vector3, difficulty: Difficulty) {
        val creatureCount = entities.count { it is Creature }
        if (creatureCount >= GLOBAL_CAP) return

        // candidate column at 20-40 blocks from the player, outside the view cone
        val angle = MathUtils.random(360f)
        val dist = MathUtils.random(20f, 40f)
        val wx = (playerPos.x + MathUtils.cosDeg(angle) * dist).toInt()
        val wz = (playerPos.z + MathUtils.sinDeg(angle) * dist).toInt()
        val chunk = world.chunkForBlock(wx, wz) ?: return
        if (chunk.state < com.cubicworld.world.ChunkState.ACTIVE) return

        val biome = world.registries.biomes.byId(chunk.biomes[((wz and 15) shl 4) or (wx and 15)].toInt())
        if (biome.creatures.isEmpty()) return

        val h = world.surfaceHeight(wx, wz)
        if (h <= 1 || h >= com.cubicworld.world.WorldConst.HEIGHT - 4) return
        val ground = world.blockDefAt(wx, h, wz)
        if (!ground.solid || ground.isLiquid) return
        if (!world.blockDefAt(wx, h + 1, wz).isAir || !world.blockDefAt(wx, h + 2, wz).isAir) return

        // weighted pick from the biome creature table
        val total = biome.creatures.sumOf { it.weight }
        var roll = MathUtils.random(total - 1)
        var picked: CreatureDef? = null
        for (entry in biome.creatures) {
            roll -= entry.weight
            if (roll < 0) { picked = creatureDefs.byName(entry.creatureName); break }
        }
        val def = picked ?: return

        // light/time rules
        val light = world.lightAt(wx, h + 1, wz)
        val sky = (light ushr 4) and 0xF
        val effLight = maxOf((sky * world.sunFactor()).toInt(), light and 0xF)
        if (effLight < def.spawnMinLight || effLight > def.spawnMaxLight) return
        if (def.spawnNight && !world.isNight()) return
        if (def.hostile && difficulty == Difficulty.CALM && MathUtils.random() < 0.7f) return

        if (entities.count { it is Creature && it.def.name == def.name } >= SPECIES_CAP) return

        val group = MathUtils.random(1, def.groupMax)
        var spawned = 0
        for (i in 0 until group) {
            val ox = wx + MathUtils.random(-2, 2)
            val oz = wz + MathUtils.random(-2, 2)
            val oh = world.surfaceHeight(ox, oz)
            if (!world.blockDefAt(ox, oh + 1, oz).isAir) continue
            val c = Creature(world, def)
            c.position.set(ox + 0.5f, oh + 1f, oz + 0.5f)
            c.yaw = MathUtils.random(360f)
            entities.add(c)
            spawned++
            if (entities.count { it is Creature } >= GLOBAL_CAP) break
        }
    }

    // ---- persistence ------------------------------------------------------

    fun save(file: File) {
        val items = world.registries.items
        val sb = StringBuilder()
        for (e in entities) {
            when (e) {
                is Creature -> sb.append("c|").append(e.def.name).append('|')
                    .append(e.position.x).append(',').append(e.position.y).append(',').append(e.position.z)
                    .append('|').append(e.health).append('\n')
                // drops are saved by stable item NAME so they survive content updates
                is DropItem -> sb.append("d|").append(items.byId(e.itemId).name).append('|')
                    .append(e.position.x).append(',').append(e.position.y).append(',').append(e.position.z)
                    .append('|').append(e.count).append('|').append(e.durability).append('\n')
            }
        }
        com.cubicworld.world.AtomicFiles.writeBytes(file, sb.toString().toByteArray())
    }

    fun load(file: File, items: com.cubicworld.inv.ItemRegistry) {
        entities.clear()
        if (!file.exists()) return
        for (line in file.readLines()) {
            val parts = line.split('|')
            try {
                when (parts.getOrNull(0)) {
                    "c" -> {
                        val def = creatureDefs.byName(parts[1]) ?: continue
                        val pos = parts[2].split(',')
                        val c = Creature(world, def)
                        c.position.set(pos[0].toFloat(), pos[1].toFloat(), pos[2].toFloat())
                        c.health = parts[3].toInt().coerceIn(1, def.health)
                        entities.add(c)
                    }
                    "d" -> {
                        val def = items.byName(parts[1]) ?: continue
                        val pos = parts[2].split(',')
                        val d = DropItem(world, def.id, parts[3].toInt().coerceIn(1, 999), parts.getOrNull(4)?.toIntOrNull() ?: 0)
                        d.position.set(pos[0].toFloat(), pos[1].toFloat(), pos[2].toFloat())
                        entities.add(d)
                    }
                }
            } catch (e: Exception) {
                // skip malformed entity lines rather than failing the whole load
            }
        }
    }
}
