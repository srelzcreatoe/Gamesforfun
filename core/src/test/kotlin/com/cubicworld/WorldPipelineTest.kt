package com.cubicworld

import com.cubicworld.entity.CreatureRegistry
import com.cubicworld.inv.ItemRegistry
import com.cubicworld.inv.RecipeRegistry
import com.cubicworld.world.BiomeRegistry
import com.cubicworld.world.BlockRegistry
import com.cubicworld.world.ChunkManager
import com.cubicworld.world.ChunkState
import com.cubicworld.world.Difficulty
import com.cubicworld.world.GameMode
import com.cubicworld.world.Registries
import com.cubicworld.world.SaveManager
import com.cubicworld.world.World
import com.cubicworld.world.WorldOptions
import com.cubicworld.world.gen.WorldType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

/**
 * Headless integration test: drives the real chunk lifecycle
 * (async generate -> decorate -> light -> ACTIVE -> unload/save -> reload)
 * exactly like the game loop does, without any rendering.
 */
class WorldPipelineTest {

    @TempDir
    lateinit var tmp: File

    private val assets = File(System.getProperty("user.dir"), "../assets").canonicalFile

    private fun registries(): Registries {
        val blocks = BlockRegistry.parse(File(assets, "data/blocks.json").readText())
        val items = ItemRegistry.parse(File(assets, "data/items.json").readText())
        val recipes = RecipeRegistry.parse(File(assets, "data/recipes.json").readText())
        val biomes = BiomeRegistry.parse(File(assets, "data/biomes.json").readText())
        val creatures = CreatureRegistry.parse(File(assets, "data/creatures.json").readText())
        items.resolveBlocks(blocks)
        recipes.resolve(items)
        biomes.resolve(blocks)
        return Registries(blocks, items, recipes, biomes, creatures)
    }

    private fun pump(world: World, manager: ChunkManager, cx: Int, cz: Int, frames: Int = 600) {
        var f = 0
        while (f < frames) {
            manager.update(cx, cz)
            val ready = (-1..1).all { dz -> (-1..1).all { dx ->
                world.chunkAt(cx + dx, cz + dz)?.state == ChunkState.ACTIVE
            } }
            if (ready) return
            Thread.sleep(5)
            f++
        }
        throw AssertionError("spawn ring never became ACTIVE after $frames pumps")
    }

    @Test
    fun `spawn ring generates, decorates, lights and activates`() {
        val reg = registries()
        val save = SaveManager(tmp)
        save.createWorld(WorldOptions("Pipeline", 4242L, GameMode.SURVIVAL, Difficulty.CALM, WorldType.STANDARD))
        val world = World(reg, WorldOptions("Pipeline", 4242L))
        val manager = ChunkManager(world, save)
        manager.renderDistance = 2
        try {
            // decorate around the real spawn point (dry land), like the game does
            val (sx, _, sz) = world.generator.findSpawn()
            val scx = sx shr 4
            val scz = sz shr 4
            pump(world, manager, scx, scz)
            val chunk = world.chunkAt(scx, scz)!!
            assertEquals(ChunkState.ACTIVE, chunk.state)
            // decorated chunks near the surface should have some vegetation or snow somewhere in the ring
            var decorations = 0
            for (dz in -1..1) for (dx in -1..1) {
                val c = world.chunkAt(scx + dx, scz + dz)!!
                for (i in c.data.ids.indices) {
                    val def = reg.blocks.byId(c.data.ids[i].toInt())
                    if (def.shape == com.cubicworld.world.BlockShape.CROSS ||
                        def.name.endsWith("_leaves") || def.name == "snow_slab"
                    ) { decorations++; break }
                }
            }
            assertTrue(decorations > 0, "no decorations in a 3x3 spawn ring")
        } finally {
            manager.dispose()
        }
    }

    @Test
    fun `edits survive unload plus reload`() {
        val reg = registries()
        val save = SaveManager(tmp)
        save.createWorld(WorldOptions("Persist", 99L))
        val world = World(reg, WorldOptions("Persist", 99L))
        val manager = ChunkManager(world, save)
        manager.renderDistance = 2
        try {
            pump(world, manager, 0, 0)
            val stone = reg.blocks.byName("graystone")!!
            val h = world.surfaceHeight(4, 4)
            world.setBlock(4, h + 1, 4, stone.id)          // player-style edit
            world.setBlock(4, h + 2, 4, stone.id)
            manager.saveAllModified()

            // walk far away so chunk (0,0) unloads, then come back
            var tick = 0
            while (world.chunkAt(0, 0) != null && tick < 400) {
                manager.update(30, 30)
                Thread.sleep(2)
                tick++
            }
            assertTrue(world.chunkAt(0, 0) == null, "chunk (0,0) should unload at distance")

            pump(world, manager, 0, 0)
            assertEquals(stone.id, world.blockAt(4, h + 1, 4), "edit lost after reload")
            assertEquals(stone.id, world.blockAt(4, h + 2, 4))
        } finally {
            manager.dispose()
        }
    }

    @Test
    fun `creatures spawn near the player under valid conditions`() {
        val reg = registries()
        val save = SaveManager(tmp)
        save.createWorld(WorldOptions("Spawn", 20260831L))
        val world = World(reg, WorldOptions("Spawn", 20260831L))
        val manager = ChunkManager(world, save)
        manager.renderDistance = 3
        try {
            val (sx, sy, sz) = world.generator.findSpawn()
            pump(world, manager, sx shr 4, sz shr 4)
            // make sure the local biome actually lists creatures
            val chunk = world.chunkAt(sx shr 4, sz shr 4)!!
            val biome = reg.biomes.byId(chunk.biomes[((sz and 15) shl 4) or (sx and 15)].toInt())
            org.junit.jupiter.api.Assumptions.assumeTrue(biome.creatures.isNotEmpty())

            val entities = com.cubicworld.entity.EntityManager(world, reg.creatures)
            val playerPos = com.badlogic.gdx.math.Vector3(sx + 0.5f, sy.toFloat(), sz + 0.5f)
            var spawned = 0
            for (attempt in 0 until 120) {
                manager.update(sx shr 4, sz shr 4)
                entities.update(3f, playerPos, GameMode.SURVIVAL, Difficulty.ADVENTUROUS)
                spawned = entities.entities.count { it is com.cubicworld.entity.Creature }
                if (spawned > 0) break
            }
            assertTrue(spawned > 0, "no creature spawned in 120 spawn cycles at daytime spawn")
            // population caps respected
            for (attempt in 0 until 300) {
                entities.update(3f, playerPos, GameMode.SURVIVAL, Difficulty.ADVENTUROUS)
            }
            val count = entities.entities.count { it is com.cubicworld.entity.Creature }
            assertTrue(count <= com.cubicworld.entity.EntityManager.GLOBAL_CAP, "global cap exceeded: $count")
        } finally {
            manager.dispose()
        }
    }

    @Test
    fun `fluid spreads from a placed source`() {
        val reg = registries()
        val save = SaveManager(tmp)
        save.createWorld(WorldOptions("Fluid", 7L, worldType = WorldType.FLAT_BUILDER))
        val world = World(reg, WorldOptions("Fluid", 7L, worldType = WorldType.FLAT_BUILDER))
        val manager = ChunkManager(world, save)
        manager.renderDistance = 2
        try {
            pump(world, manager, 0, 0)
            val h = world.surfaceHeight(2, 2)
            world.setBlock(2, h + 1, 2, reg.blocks.water.id)
            // run the fixed-step simulation for ~4 seconds of game time
            var t = 0f
            while (t < 4f) {
                world.update(0.05f, 2, 2, 2)
                manager.update(0, 0)
                t += 0.05f
            }
            var waterCells = 0
            for (dx in -6..6) for (dz in -6..6) {
                if (world.blockAt(2 + dx, h + 1, 2 + dz) == reg.blocks.water.id) waterCells++
            }
            assertTrue(waterCells > 3, "water never spread (cells=$waterCells)")
        } finally {
            manager.dispose()
        }
    }
}
