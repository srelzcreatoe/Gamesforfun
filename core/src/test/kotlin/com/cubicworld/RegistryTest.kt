package com.cubicworld

import com.cubicworld.entity.CreatureRegistry
import com.cubicworld.inv.ItemKind
import com.cubicworld.inv.ItemRegistry
import com.cubicworld.inv.RecipeRegistry
import com.cubicworld.render.TextureAtlasManager
import com.cubicworld.world.BiomeRegistry
import com.cubicworld.world.BlockRegistry
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/** Validates the real shipped content data end to end (no GL required). */
class RegistryTest {

    private val assets = File(System.getProperty("user.dir"), "../assets").canonicalFile

    private fun read(name: String) = File(assets, name).readText()

    private fun loadAll(): Triple<BlockRegistry, ItemRegistry, RecipeRegistry> {
        val blocks = BlockRegistry.parse(read("data/blocks.json"))
        val items = ItemRegistry.parse(read("data/items.json"))
        val recipes = RecipeRegistry.parse(read("data/recipes.json"))
        items.resolveBlocks(blocks)
        recipes.resolve(items)
        return Triple(blocks, items, recipes)
    }

    @Test
    fun `content meets version 0_1_0 scope requirements`() {
        val (blocks, items, recipes) = loadAll()
        assertTrue(blocks.size - 1 >= 60, "need >=60 blocks, got ${blocks.size - 1}")
        assertTrue(items.size >= 60, "need >=60 items, got ${items.size}")
        assertTrue(recipes.size >= 45, "need >=45 recipes, got ${recipes.size}")
        val biomes = BiomeRegistry.parse(read("data/biomes.json"))
        assertEquals(8, biomes.size)
        val creatures = CreatureRegistry.parse(read("data/creatures.json"))
        assertTrue(creatures.size >= 6)
    }

    @Test
    fun `every cross reference resolves`() {
        val (blocks, items, _) = loadAll()
        val biomes = BiomeRegistry.parse(read("data/biomes.json"))
        biomes.resolve(blocks)
        val creatures = CreatureRegistry.parse(read("data/creatures.json"))

        val atlas = TextureAtlasManager()
        atlas.parseIndex(read("textures/atlas.json"))
        blocks.resolveTiles(atlas::tileIndex)
        items.resolveIcons(atlas::tileIndex, blocks)
        creatures.resolve(items, atlas::tileIndex)

        // block drops must be items
        for (b in blocks.blocks) {
            if (b.isAir) continue
            val d = b.dropsName
            if (d != null && d != "none") {
                assertNotNull(items.byName(d), "block ${b.name} drops unknown item $d")
            }
        }
        // liquids exist
        assertTrue(!blocks.water.isAir, "water block missing")
        assertTrue(!blocks.glowSap.isAir, "glow_sap block missing")
    }

    @Test
    fun `biome climate space has no gaps`() {
        val biomes = BiomeRegistry.parse(read("data/biomes.json"))
        for (t in 0..20) for (m in 0..20) {
            val biome = biomes.pick(t / 20f, m / 20f)
            assertNotNull(biome)
        }
    }

    @Test
    fun `no minecraft naming leaks into content`() {
        val banned = listOf(
            "creeper", "enderman", "redstone", "netherite", "villager",
            "steve", "alex", "obsidian", "cobblestone", "diamond",
        )
        for (file in listOf("data/blocks.json", "data/items.json", "data/recipes.json",
                            "data/biomes.json", "data/creatures.json")) {
            val text = read(file).lowercase()
            for (word in banned) {
                assertTrue(!text.contains(word), "$file contains banned term '$word'")
            }
        }
    }

    @Test
    fun `station blocks and tools exist for the survival loop`() {
        val (blocks, items, recipes) = loadAll()
        for (station in listOf("handwork_mat", "forge_table", "kiln", "cookpot")) {
            assertNotNull(blocks.byName(station), "missing station block $station")
        }
        for (tool in listOf("sunbark_pick", "flint_pick", "copper_pick", "ironroot_pick")) {
            val item = items.byName(tool)
            assertNotNull(item, "missing tool $tool")
            assertTrue(item!!.kind == ItemKind.TOOL && item.durability > 0)
        }
        // at least one recipe per station category
        for (station in listOf("hand", "handwork_mat", "forge_table", "kiln", "cookpot")) {
            assertTrue(recipes.forStation(station).isNotEmpty(), "no recipes for $station")
        }
    }
}
