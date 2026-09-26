package com.cubicworld.world

import com.cubicworld.entity.CreatureRegistry
import com.cubicworld.inv.ItemRegistry
import com.cubicworld.inv.RecipeRegistry
import com.cubicworld.world.WorldConst.CHUNK
import com.cubicworld.world.WorldConst.DAY_LENGTH_TICKS
import com.cubicworld.world.WorldConst.HEIGHT
import com.cubicworld.world.gen.Decorator
import com.cubicworld.world.gen.SeededNoise
import com.cubicworld.world.gen.WorldGenerator
import com.cubicworld.world.gen.WorldType

/** All loaded content registries, wired together at boot. */
class Registries(
    val blocks: BlockRegistry,
    val items: ItemRegistry,
    val recipes: RecipeRegistry,
    val biomes: BiomeRegistry,
    val creatures: CreatureRegistry,
)

enum class Weather { CLEAR, RAIN, STORM, FOG, SNOW }

enum class GameMode { SURVIVAL, CREATIVE, EXPLORER }
enum class Difficulty { CALM, ADVENTUROUS, FIERCE }

/** Per-world creation options, persisted in world.json. */
class WorldOptions(
    var name: String = "New World",
    var seed: Long = 0L,
    var mode: GameMode = GameMode.SURVIVAL,
    var difficulty: Difficulty = Difficulty.ADVENTUROUS,
    var worldType: WorldType = WorldType.STANDARD,
    var keepInventory: Boolean = false,
)

/**
 * The live voxel world: chunk map, block access, time/weather and the fixed
 * 20 tps simulation. All public methods are main-thread only unless noted.
 */
class World(
    val registries: Registries,
    val options: WorldOptions,
) {
    val generator = WorldGenerator(options.seed, options.worldType, registries.blocks, registries.biomes)
    val decorator = Decorator(options.seed, registries.blocks, registries.biomes, generator)
    val lighting = LightingSystem(registries.blocks)
    private val tickNoise = SeededNoise(options.seed xor 0x5DEECE66DL)

    val chunks = HashMap<Long, Chunk>()

    var timeOfDay: Int = DAY_LENGTH_TICKS / 4      // start mid-morning
    var totalTicks: Long = 0
    var weather: Weather = Weather.CLEAR
    private var weatherTimer: Int = DAY_LENGTH_TICKS / 2

    /** blocks whose fluid needs an update at the given tick */
    private class FluidJob(val wx: Int, val wy: Int, val wz: Int, val due: Long)
    private val fluidQueue = ArrayDeque<FluidJob>()

    /** chunks whose light must be recomputed, drained with a frame budget */
    val lightQueue = ArrayDeque<Chunk>()

    /** listener the render/entity layers attach to react to edits */
    var onBlockChanged: ((wx: Int, wy: Int, wz: Int) -> Unit)? = null

    // ---- chunk / block access --------------------------------------------

    fun chunkAt(cx: Int, cz: Int): Chunk? = chunks[WorldConst.chunkKey(cx, cz)]

    fun chunkForBlock(wx: Int, wz: Int): Chunk? = chunkAt(wx shr 4, wz shr 4)

    fun blockAt(wx: Int, wy: Int, wz: Int): Short {
        if (wy < 0 || wy >= HEIGHT) return 0
        val c = chunkForBlock(wx, wz) ?: return 0
        if (c.state < ChunkState.TERRAIN) return 0
        return c.data.get(wx and 15, wy, wz and 15)
    }

    fun blockDefAt(wx: Int, wy: Int, wz: Int): BlockDef = registries.blocks.byId(blockAt(wx, wy, wz).toInt())

    fun stateAt(wx: Int, wy: Int, wz: Int): Byte {
        if (wy < 0 || wy >= HEIGHT) return 0
        val c = chunkForBlock(wx, wz) ?: return 0
        return c.data.getState(wx and 15, wy, wz and 15)
    }

    fun lightAt(wx: Int, wy: Int, wz: Int): Int {
        if (wy >= HEIGHT) return WorldConst.MAX_LIGHT shl 4
        if (wy < 0) return 0
        val c = chunkForBlock(wx, wz) ?: return WorldConst.MAX_LIGHT shl 4
        if (c.state < ChunkState.DECORATED) return WorldConst.MAX_LIGHT shl 4
        return c.data.light[c.data.idx(wx and 15, wy, wz and 15)].toInt() and 0xFF
    }

    fun surfaceHeight(wx: Int, wz: Int): Int {
        val c = chunkForBlock(wx, wz) ?: return generator.heightAt(wx, wz)
        if (c.state < ChunkState.TERRAIN) return generator.heightAt(wx, wz)
        return c.data.heightMap[((wz and 15) shl 4) or (wx and 15)].toInt() - 1
    }

    /**
     * Gameplay block edit: updates storage, marks meshes/lighting dirty on
     * this and border-adjacent chunks, schedules fluid and gravity follow-ups.
     */
    fun setBlock(wx: Int, wy: Int, wz: Int, id: Short, state: Byte = 0, silentGen: Boolean = false) {
        if (wy < 0 || wy >= HEIGHT) return
        val c = chunkForBlock(wx, wz) ?: return
        val lx = wx and 15
        val lz = wz and 15
        c.data.set(lx, wy, lz, id, state)
        if (silentGen) return

        c.modified = true
        c.markDirtyAt(wy)
        // border edits invalidate the neighbour chunk's adjacent section too
        if (lx == 0) chunkAt(c.cx - 1, c.cz)?.markDirtyAt(wy)
        if (lx == 15) chunkAt(c.cx + 1, c.cz)?.markDirtyAt(wy)
        if (lz == 0) chunkAt(c.cx, c.cz - 1)?.markDirtyAt(wy)
        if (lz == 15) chunkAt(c.cx, c.cz + 1)?.markDirtyAt(wy)

        queueLight(c)
        if (lx <= 1) chunkAt(c.cx - 1, c.cz)?.let { queueLight(it) }
        if (lx >= 14) chunkAt(c.cx + 1, c.cz)?.let { queueLight(it) }
        if (lz <= 1) chunkAt(c.cx, c.cz - 1)?.let { queueLight(it) }
        if (lz >= 14) chunkAt(c.cx, c.cz + 1)?.let { queueLight(it) }

        scheduleFluidAround(wx, wy, wz)
        applyGravityAround(wx, wy, wz)
        onBlockChanged?.invoke(wx, wy, wz)
    }

    fun queueLight(c: Chunk) {
        if (!c.lightDirty) {
            c.lightDirty = true
            lightQueue.addLast(c)
        }
    }

    // ---- simulation -------------------------------------------------------

    private var tickAccum = 0f

    fun update(delta: Float, simCenterX: Int, simCenterZ: Int, simDistance: Int) {
        tickAccum += delta
        val step = 1f / WorldConst.TICKS_PER_SECOND
        var steps = 0
        while (tickAccum >= step && steps < 4) {
            tick(simCenterX, simCenterZ, simDistance)
            tickAccum -= step
            steps++
        }
        if (steps == 4) tickAccum = 0f    // don't spiral after a long pause
    }

    private fun tick(simCenterX: Int, simCenterZ: Int, simDistance: Int) {
        totalTicks++
        timeOfDay = ((timeOfDay + 1) % DAY_LENGTH_TICKS)
        tickWeather()
        tickFluids()
        tickRandomGrowth(simCenterX, simCenterZ, simDistance)
    }

    private fun tickWeather() {
        if (--weatherTimer > 0) return
        val roll = tickNoise.cellRand(totalTicks.toInt(), 0, 91)
        weather = when {
            roll < 0.55f -> Weather.CLEAR
            roll < 0.75f -> Weather.RAIN
            roll < 0.85f -> Weather.FOG
            roll < 0.95f -> Weather.SNOW
            else -> Weather.STORM
        }
        weatherTimer = DAY_LENGTH_TICKS / 4 +
            (tickNoise.cellRand(totalTicks.toInt(), 1, 92) * DAY_LENGTH_TICKS / 2).toInt()
    }

    // ---- fluids -----------------------------------------------------------

    private fun scheduleFluidAround(wx: Int, wy: Int, wz: Int) {
        for (d in 0 until 7) {
            val nx = wx + intArrayOf(0, -1, 1, 0, 0, 0, 0)[d]
            val ny = wy + intArrayOf(0, 0, 0, -1, 1, 0, 0)[d]
            val nz = wz + intArrayOf(0, 0, 0, 0, 0, -1, 1)[d]
            val def = blockDefAt(nx, ny, nz)
            if (def.isLiquid) {
                val delay = if (def.id == registries.blocks.glowSap.id) 24L else 6L
                fluidQueue.addLast(FluidJob(nx, ny, nz, totalTicks + delay))
            }
        }
    }

    private fun tickFluids() {
        var budget = 64
        while (budget > 0 && fluidQueue.isNotEmpty() && fluidQueue.first().due <= totalTicks) {
            val job = fluidQueue.removeFirst()
            budget--
            spreadFluid(job.wx, job.wy, job.wz)
        }
    }

    private fun spreadFluid(wx: Int, wy: Int, wz: Int) {
        val id = blockAt(wx, wy, wz)
        val def = registries.blocks.byId(id.toInt())
        if (!def.isLiquid) return
        val level = stateAt(wx, wy, wz).toInt() and 0x7
        val isGlow = def.id == registries.blocks.glowSap.id
        val maxSpread = if (isGlow) 2 else 6

        // falling has priority and resets the spread distance
        val below = blockDefAt(wx, wy - 1, wz)
        if (wy > 0 && (below.isAir || (below.isLiquid && below.id != def.id))) {
            setBlock(wx, wy - 1, wz, def.id, 1)
            return
        }
        if (level >= maxSpread) return
        for (d in 0 until 4) {
            val nx = wx + intArrayOf(-1, 1, 0, 0)[d]
            val nz = wz + intArrayOf(0, 0, -1, 1)[d]
            val n = blockDefAt(nx, wy, nz)
            if (n.isAir || (n.shape == BlockShape.CROSS && !n.solid)) {
                setBlock(nx, wy, nz, def.id, (level + 1).toByte())
            }
        }
    }

    // ---- growth + gravity -------------------------------------------------

    private fun tickRandomGrowth(centerX: Int, centerZ: Int, simDistance: Int) {
        // a handful of random columns per tick within the simulated area
        for (n in 0 until 6) {
            val salt = (totalTicks * 7 + n).toInt()
            val dx = ((tickNoise.cellRand(salt, 1, 95) - 0.5f) * simDistance * 2 * CHUNK).toInt()
            val dz = ((tickNoise.cellRand(salt, 2, 96) - 0.5f) * simDistance * 2 * CHUNK).toInt()
            val wx = centerX + dx
            val wz = centerZ + dz
            val h = surfaceHeight(wx, wz)
            val y = h + 1
            val def = blockDefAt(wx, y, wz)
            if (def.shape == BlockShape.CROSS && def.name.endsWith("_crop")) {
                val stage = stateAt(wx, y, wz).toInt()
                if (stage < 3 && (lightAt(wx, y, wz) ushr 4) >= 8) {
                    setBlock(wx, y, wz, def.id, (stage + 1).toByte())
                }
            }
        }
    }

    private fun applyGravityAround(wx: Int, wy: Int, wz: Int) {
        // loose blocks above a removed block fall straight down
        var y = wy + 1
        while (y < HEIGHT) {
            val def = blockDefAt(wx, y, wz)
            if (!def.gravity) break
            if (!blockDefAt(wx, y - 1, wz).isAir) break
            var target = y - 1
            while (target > 0 && blockDefAt(wx, target - 1, wz).isAir) target--
            setBlock(wx, y, wz, 0)
            setBlock(wx, target, wz, def.id)
            y++
        }
        // and the edited block itself, if loose over air
        val self = blockDefAt(wx, wy, wz)
        if (self.gravity && blockDefAt(wx, wy - 1, wz).isAir) {
            var target = wy - 1
            while (target > 0 && blockDefAt(wx, target - 1, wz).isAir) target--
            setBlock(wx, wy, wz, 0)
            setBlock(wx, target, wz, self.id)
        }
    }

    // ---- day/night helpers ------------------------------------------------

    /** 0..1 sun strength for shading and sky colour. */
    fun sunFactor(): Float {
        val t = timeOfDay.toFloat() / DAY_LENGTH_TICKS      // 0 dawn .. 1
        val angle = (t * 2f - 0.5f) * Math.PI.toFloat()
        val s = kotlin.math.sin(angle.toDouble()).toFloat()
        return ((s + 0.25f) * 1.4f).coerceIn(0.06f, 1f)
    }

    fun isNight(): Boolean = sunFactor() < 0.22f
}
