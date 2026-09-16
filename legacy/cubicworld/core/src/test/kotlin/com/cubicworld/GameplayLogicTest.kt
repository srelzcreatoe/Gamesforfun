package com.cubicworld

import com.cubicworld.inv.CraftingManager
import com.cubicworld.inv.Inventory
import com.cubicworld.inv.ItemRegistry
import com.cubicworld.inv.RecipeRegistry
import com.cubicworld.render.ChunkMesher
import com.cubicworld.render.MeshInput
import com.cubicworld.render.TextureAtlasManager
import com.cubicworld.world.BiomeRegistry
import com.cubicworld.world.BlockRegistry
import com.cubicworld.world.Chunk
import com.cubicworld.world.ChunkState
import com.cubicworld.world.LightingSystem
import com.cubicworld.world.WorldConst
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

class GameplayLogicTest {

    private val assets = File(System.getProperty("user.dir"), "../assets").canonicalFile
    private val blocks = BlockRegistry.parse(File(assets, "data/blocks.json").readText())
    private val items = ItemRegistry.parse(File(assets, "data/items.json").readText()).also {
        it.resolveBlocks(blocks)
    }
    private val recipes = RecipeRegistry.parse(File(assets, "data/recipes.json").readText()).also {
        it.resolve(items)
    }
    private val atlas = TextureAtlasManager().also {
        it.parseIndex(File(assets, "textures/atlas.json").readText())
        blocks.resolveTiles(it::tileIndex)
    }

    // ---- inventory --------------------------------------------------------

    @Test
    fun `inventory stacks respect limits and overflow`() {
        val inv = Inventory(items, 3)      // tiny inventory to force overflow
        val log = items.byName("sunbark_log")!!
        assertEquals(0, inv.add(log.id, 64))
        assertEquals(0, inv.add(log.id, 64))
        assertEquals(0, inv.add(log.id, 64))
        assertEquals(10, inv.add(log.id, 10), "full inventory must reject the surplus")
        assertEquals(192, inv.countOf(log.id))
        assertEquals(100, inv.remove(log.id, 100))
        assertEquals(92, inv.countOf(log.id))
    }

    @Test
    fun `inventory serialization roundtrips`() {
        val inv = Inventory(items)
        val log = items.byName("sunbark_log")!!
        val pick = items.byName("flint_pick")!!
        inv.add(log.id, 5)
        inv.add(pick.id, 1)
        val data = inv.serialize()
        val inv2 = Inventory(items)
        inv2.deserialize(data)
        assertEquals(5, inv2.countOf(log.id))
        assertEquals(1, inv2.countOf(pick.id))
        assertEquals(pick.durability, inv2.slots.first { it.itemId == pick.id }.durability)
    }

    @Test
    fun `crafting consumes inputs and produces output`() {
        val crafting = CraftingManager(recipes, items)
        val inv = Inventory(items)
        // find a hand recipe and supply exactly its inputs
        val recipe = recipes.forStation("hand").first()
        for (input in recipe.inputs) inv.add(input.itemId, input.count)
        assertTrue(crafting.canCraft(recipe, inv))
        assertTrue(crafting.craft(recipe, inv))
        for (input in recipe.inputs) assertEquals(0, inv.countOf(input.itemId))
        assertEquals(recipe.outputCount, inv.countOf(recipe.outputId))
        assertTrue(!crafting.canCraft(recipe, inv))
    }

    @Test
    fun `recipe discovery gates visibility in survival`() {
        val crafting = CraftingManager(recipes, items)
        assertTrue(crafting.visibleRecipes("hand", creative = false).isEmpty())
        assertTrue(crafting.visibleRecipes("hand", creative = true).isNotEmpty())
        val recipe = recipes.forStation("hand").first()
        crafting.markDiscovered(recipe.inputs[0].itemId)
        assertTrue(crafting.visibleRecipes("hand", creative = false).contains(recipe))
    }

    // ---- meshing ----------------------------------------------------------

    private fun soloBlockInput(id: Short): MeshInput {
        val input = MeshInput(0, 0, 0, 1)
        input.ids[input.idx(8, 8, 8)] = id
        // fully lit everywhere
        java.util.Arrays.fill(input.light, (15 shl 4).toByte())
        return input
    }

    @Test
    fun `lone cube produces exactly six faces`() {
        val mesher = ChunkMesher(blocks, atlas)
        val stone = blocks.byName("graystone")!!
        val out = mesher.build(soloBlockInput(stone.id))
        assertEquals(6 * 4 * ChunkMesher.VERTEX_SIZE, out.solidVerts.size)
        assertEquals(6 * 6, out.solidIdx.size)
    }

    @Test
    fun `hidden faces between adjacent cubes are culled`() {
        val mesher = ChunkMesher(blocks, atlas)
        val stone = blocks.byName("graystone")!!
        val input = soloBlockInput(stone.id)
        input.ids[input.idx(9, 8, 8)] = stone.id
        val out = mesher.build(input)
        // 2 cubes: 12 faces total minus the 2 touching = 10
        assertEquals(10 * 6, out.solidIdx.size)
    }

    @Test
    fun `buried cube produces no geometry`() {
        val mesher = ChunkMesher(blocks, atlas)
        val stone = blocks.byName("graystone")!!
        val input = MeshInput(0, 0, 0, 1)
        for (y in 7..9) for (z in 7..9) for (x in 7..9) {
            input.ids[input.idx(x, y, z)] = stone.id
        }
        val out = mesher.build(input)
        // 3x3x3 solid block: only the outer shell faces (6 sides x 9 cells)
        assertEquals(6 * 9 * 6, out.solidIdx.size)
    }

    // ---- lighting ---------------------------------------------------------

    @Test
    fun `sky light is full above terrain and blocked below`() {
        val chunk = Chunk(0, 0)
        val stone = blocks.byName("graystone")!!
        for (z in 0 until 16) for (x in 0 until 16) {
            for (y in 0..40) chunk.data.set(x, y, z, stone.id)
        }
        chunk.state = ChunkState.DECORATED
        val lighting = LightingSystem(blocks)
        lighting.compute(chunk) { _, _ -> null }
        assertEquals(WorldConst.MAX_LIGHT, chunk.data.skyLight(8, 60, 8))
        assertEquals(0, chunk.data.skyLight(8, 20, 8))
    }

    @Test
    fun `emissive blocks light their surroundings with falloff`() {
        val chunk = Chunk(0, 0)
        val lantern = blocks.blocks.firstOrNull { it.lightEmission >= 10 }
        assertTrue(lantern != null, "content must include a strong light source")
        chunk.data.set(8, 30, 8, lantern!!.id)
        chunk.state = ChunkState.DECORATED
        val lighting = LightingSystem(blocks)
        lighting.compute(chunk) { _, _ -> null }
        val at = chunk.data.blockLight(8, 30, 8)
        val near = chunk.data.blockLight(10, 30, 8)
        val far = chunk.data.blockLight(14, 30, 8)
        assertEquals(lantern.lightEmission, at)
        assertEquals(at - 2, near)
        assertTrue(far < near, "light must decay with distance")
    }
}
