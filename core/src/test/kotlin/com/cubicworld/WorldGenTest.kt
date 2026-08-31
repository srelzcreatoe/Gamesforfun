package com.cubicworld

import com.cubicworld.world.BiomeRegistry
import com.cubicworld.world.BlockRegistry
import com.cubicworld.world.Chunk
import com.cubicworld.world.WorldConst
import com.cubicworld.world.gen.SeededNoise
import com.cubicworld.world.gen.WorldGenerator
import com.cubicworld.world.gen.WorldType
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

class WorldGenTest {

    private val assets = File(System.getProperty("user.dir"), "../assets").canonicalFile
    private val blocks = BlockRegistry.parse(File(assets, "data/blocks.json").readText())
    private val biomes = BiomeRegistry.parse(File(assets, "data/biomes.json").readText()).also {
        it.resolve(blocks)
    }

    private fun generate(seed: Long, cx: Int, cz: Int, type: WorldType = WorldType.STANDARD): Chunk {
        val gen = WorldGenerator(seed, type, blocks, biomes)
        val chunk = Chunk(cx, cz)
        gen.generateTerrain(chunk)
        return chunk
    }

    @Test
    fun `identical seeds produce identical terrain`() {
        for ((cx, cz) in listOf(0 to 0, 3 to -2, -7 to 11)) {
            val a = generate(123456789L, cx, cz)
            val b = generate(123456789L, cx, cz)
            assertArrayEquals(a.data.ids, b.data.ids, "chunk ($cx,$cz) differs for same seed")
            assertArrayEquals(a.biomes, b.biomes)
        }
    }

    @Test
    fun `different seeds produce different terrain`() {
        val a = generate(1L, 0, 0)
        val b = generate(2L, 0, 0)
        var differences = 0
        for (i in a.data.ids.indices) if (a.data.ids[i] != b.data.ids[i]) differences++
        assertTrue(differences > 500, "seeds 1 and 2 look identical ($differences diffs)")
    }

    @Test
    fun `noise is deterministic`() {
        val n1 = SeededNoise(42L)
        val n2 = SeededNoise(42L)
        for (i in 0 until 200) {
            assertEquals(n1.noise2(i * 0.37f, i * 0.91f), n2.noise2(i * 0.37f, i * 0.91f))
            assertEquals(n1.fbm3(i * 0.1f, i * 0.2f, i * 0.3f, 3), n2.fbm3(i * 0.1f, i * 0.2f, i * 0.3f, 3))
        }
    }

    @Test
    fun `terrain has sane structure`() {
        val chunk = generate(555L, 0, 0)
        for (z in 0 until 16) for (x in 0 until 16) {
            // bottom layer unbreakable / solid
            assertTrue(chunk.data.get(x, 0, z).toInt() != 0, "hole in world floor")
            // deep cave shafts can carve down to the worldroot floor (height 4)
            val h = chunk.data.heightMap[(z shl 4) or x].toInt()
            assertTrue(h in 4..WorldConst.HEIGHT, "degenerate column height $h")
        }
    }

    @Test
    fun `flat builder worlds are flat`() {
        val chunk = generate(9L, 2, 2, WorldType.FLAT_BUILDER)
        val h0 = chunk.data.heightMap[0].toInt()
        for (i in 1 until 256) assertEquals(h0, chunk.data.heightMap[i].toInt())
    }

    @Test
    fun `spawn search returns dry land`() {
        for (seed in listOf(1L, 42L, 987654321L, -5L)) {
            val gen = WorldGenerator(seed, WorldType.STANDARD, blocks, biomes)
            val (x, y, z) = gen.findSpawn()
            assertTrue(y > WorldConst.SEA_LEVEL, "seed $seed spawned at/below sea level: $x,$y,$z")
        }
    }
}
