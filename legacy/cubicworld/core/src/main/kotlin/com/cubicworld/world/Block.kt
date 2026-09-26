package com.cubicworld.world

/** How a block occupies its cell; drives meshing, collision and interaction. */
enum class BlockShape { CUBE, CROSS, SLAB, LIQUID, LADDER }

/** Sound/particle family. */
enum class BlockMaterial { EARTH, STONE, WOOD, PLANT, METAL, GLASS, CLOTH, LIQUID }

/** Which tool class mines this block efficiently. */
enum class ToolType { PICK, HATCHET, SHOVEL, BLADE, CULTIVATOR, NONE }

/**
 * Immutable definition of one block type, loaded from blocks.json.
 * Face texture tile indices are resolved against the atlas after load.
 */
class BlockDef(
    val id: Short,
    val name: String,
    val displayName: String,
    val shape: BlockShape,
    /** tile names per face: [top, bottom, north, south, east, west] */
    val tileNames: Array<String>,
    val material: BlockMaterial,
    val hardness: Float,
    val opaque: Boolean,
    val translucent: Boolean,
    val solid: Boolean,
    val lightEmission: Int,
    val dropsName: String?,        // null = self, "none" = nothing
    val dropCount: Int,
    val tool: ToolType,
    val minTier: Int,
    val gravity: Boolean,
    val flammable: Boolean,
) {
    /** atlas tile index per face, resolved in [BlockRegistry.resolveTiles] */
    val tiles = IntArray(6)

    val isAir: Boolean get() = id.toInt() == 0
    val isLiquid: Boolean get() = shape == BlockShape.LIQUID
    /** True when neighbouring faces against this block must still be drawn. */
    val seeThrough: Boolean get() = !opaque

    companion object {
        const val FACE_TOP = 0
        const val FACE_BOTTOM = 1
        const val FACE_NORTH = 2   // -z
        const val FACE_SOUTH = 3   // +z
        const val FACE_EAST = 4    // +x
        const val FACE_WEST = 5    // -x
    }
}
