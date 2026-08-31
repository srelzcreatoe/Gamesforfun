package com.cubicworld

import com.badlogic.gdx.Gdx
import com.cubicworld.entity.CreatureRegistry
import com.cubicworld.inv.ItemRegistry
import com.cubicworld.inv.RecipeRegistry
import com.cubicworld.render.TextureAtlasManager
import com.cubicworld.world.BiomeRegistry
import com.cubicworld.world.BlockRegistry
import com.cubicworld.world.Registries

/**
 * Loads and cross-validates every content registry at boot. Any bad
 * reference fails fast with a readable developer error instead of
 * corrupting saves later.
 */
object GameBootstrap {

    fun loadRegistries(): Registries {
        val blocks = BlockRegistry.parse(read("data/blocks.json"))
        val items = ItemRegistry.parse(read("data/items.json"))
        val recipes = RecipeRegistry.parse(read("data/recipes.json"))
        val biomes = BiomeRegistry.parse(read("data/biomes.json"))
        val creatures = CreatureRegistry.parse(read("data/creatures.json"))

        items.resolveBlocks(blocks)
        recipes.resolve(items)
        biomes.resolve(blocks)
        return Registries(blocks, items, recipes, biomes, creatures)
    }

    /** Second phase once the atlas is loaded: resolve every texture reference. */
    fun resolveTextures(registries: Registries, atlas: TextureAtlasManager) {
        registries.blocks.resolveTiles(atlas::tileIndex)
        registries.items.resolveIcons(atlas::tileIndex, registries.blocks)
        registries.creatures.resolve(registries.items, atlas::tileIndex)
    }

    private fun read(path: String): String {
        val handle = Gdx.files.internal(path)
        check(handle.exists()) { "Missing required asset: $path" }
        return handle.readString("UTF-8")
    }
}
