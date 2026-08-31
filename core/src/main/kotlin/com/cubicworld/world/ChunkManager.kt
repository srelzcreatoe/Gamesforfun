package com.cubicworld.world

import com.cubicworld.world.WorldConst.HEIGHT
import com.cubicworld.world.gen.GenWorld
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Drives the chunk lifecycle around the player:
 * request -> generate/load (worker) -> decorate -> light -> ACTIVE (meshable).
 * All map mutation happens on the main thread; workers only fill freshly
 * created ChunkData that is not yet published.
 */
class ChunkManager(
    private val world: World,
    private val save: SaveManager,
) {
    var renderDistance = 5
    var simulationDistance = 3

    private val genPool: ExecutorService = Executors.newFixedThreadPool(2) { r ->
        Thread(r, "chunk-gen").apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 }
    }
    private val finished = ConcurrentLinkedQueue<Pair<Chunk, Boolean>>() // chunk, loadedFromDisk
    private val pending = HashSet<Long>()

    var onChunkUnloaded: ((Chunk) -> Unit)? = null

    /** total chunks currently queued or generating (for the loading screen) */
    val pendingCount: Int get() = pending.size

    private val genWorld = object : GenWorld {
        val touched = HashSet<Chunk>()
        override fun get(wx: Int, wy: Int, wz: Int): Short {
            if (wy < 0 || wy >= HEIGHT) return 0
            val c = world.chunkForBlock(wx, wz) ?: return 0
            return c.data.get(wx and 15, wy, wz and 15)
        }
        override fun set(wx: Int, wy: Int, wz: Int, id: Short, state: Byte) {
            if (wy < 0 || wy >= HEIGHT) return
            val c = world.chunkForBlock(wx, wz) ?: return
            c.data.set(wx and 15, wy, wz and 15, id, state)
            c.markDirtyAt(wy)
            touched.add(c)
        }
        override fun surfaceHeight(wx: Int, wz: Int): Int = world.surfaceHeight(wx, wz)
    }

    fun update(playerCx: Int, playerCz: Int) {
        requestRing(playerCx, playerCz)
        drainFinished()
        decorateReady(playerCx, playerCz)
        lightBudget()
        promoteActive()
        unloadFar(playerCx, playerCz)
    }

    // ---- request ----------------------------------------------------------

    private fun requestRing(pcx: Int, pcz: Int) {
        for (r in 0..renderDistance) {
            var dx = -r
            while (dx <= r) {
                var dz = -r
                while (dz <= r) {
                    if (kotlin.math.max(kotlin.math.abs(dx), kotlin.math.abs(dz)) == r) {
                        ensureChunk(pcx + dx, pcz + dz)
                    }
                    dz++
                }
                dx++
            }
        }
    }

    private fun ensureChunk(cx: Int, cz: Int) {
        val key = WorldConst.chunkKey(cx, cz)
        if (world.chunks.containsKey(key) || key in pending) return
        pending.add(key)
        val chunk = Chunk(cx, cz)
        genPool.execute {
            var loaded = false
            try {
                loaded = save.loadChunk(chunk)
                if (!loaded) world.generator.generateTerrain(chunk)
            } catch (e: Exception) {
                // corrupted chunk file: regenerate deterministically instead of crashing
                world.generator.generateTerrain(chunk)
            }
            finished.add(chunk to loaded)
        }
    }

    private fun drainFinished() {
        while (true) {
            val (chunk, loaded) = finished.poll() ?: break
            pending.remove(chunk.key)
            chunk.state = if (loaded) ChunkState.DECORATED else ChunkState.TERRAIN
            world.chunks[chunk.key] = chunk
            world.queueLight(chunk)
            chunk.markAllSectionsDirty()
        }
    }

    // ---- decorate ---------------------------------------------------------

    private fun decorateReady(pcx: Int, pcz: Int) {
        var budget = 2
        for (chunk in world.chunks.values) {
            if (budget == 0) break
            if (chunk.state != ChunkState.TERRAIN) continue
            if (kotlin.math.abs(chunk.cx - pcx) > renderDistance + 1 ||
                kotlin.math.abs(chunk.cz - pcz) > renderDistance + 1
            ) continue
            if (!neighborhoodHasTerrain(chunk)) continue
            genWorld.touched.clear()
            world.decorator.decorate(chunk, genWorld)
            chunk.state = ChunkState.DECORATED
            chunk.markAllSectionsDirty()
            world.queueLight(chunk)
            for (t in genWorld.touched) {
                if (t !== chunk) {
                    world.queueLight(t)
                    if (t.state == ChunkState.ACTIVE) t.modified = true
                }
            }
            budget--
        }
    }

    private fun neighborhoodHasTerrain(chunk: Chunk): Boolean {
        for (dz in -1..1) for (dx in -1..1) {
            if (dx == 0 && dz == 0) continue
            val n = world.chunkAt(chunk.cx + dx, chunk.cz + dz) ?: run { ensureChunk(chunk.cx + dx, chunk.cz + dz); null }
            if (n == null || n.state < ChunkState.TERRAIN) return false
        }
        return true
    }

    // ---- light ------------------------------------------------------------

    private fun lightBudget() {
        var budget = 2
        while (budget > 0 && world.lightQueue.isNotEmpty()) {
            val chunk = world.lightQueue.removeFirst()
            if (chunk.state < ChunkState.DECORATED) {
                // terrain-only chunks get lit after decoration; requeue once decorated
                chunk.lightDirty = false
                continue
            }
            world.lighting.compute(chunk) { dx, dz -> world.chunkAt(chunk.cx + dx, chunk.cz + dz) }
            chunk.markAllSectionsDirty()
            budget--
        }
    }

    private fun promoteActive() {
        for (chunk in world.chunks.values) {
            if (chunk.state != ChunkState.DECORATED || chunk.lightDirty) continue
            var ready = true
            for (dz in -1..1) for (dx in -1..1) {
                val n = world.chunkAt(chunk.cx + dx, chunk.cz + dz)
                if (n == null || n.state < ChunkState.DECORATED) { ready = false }
            }
            if (ready) chunk.state = ChunkState.ACTIVE
        }
    }

    // ---- unload -----------------------------------------------------------

    private fun unloadFar(pcx: Int, pcz: Int) {
        val limit = renderDistance + 2
        val it = world.chunks.values.iterator()
        val removed = ArrayList<Chunk>(0)
        while (it.hasNext()) {
            val c = it.next()
            if (c.state == ChunkState.GENERATING) continue
            if (kotlin.math.abs(c.cx - pcx) > limit || kotlin.math.abs(c.cz - pcz) > limit) {
                if (c.modified) save.saveChunk(c)
                it.remove()
                removed.add(c)
            }
        }
        for (c in removed) onChunkUnloaded?.invoke(c)
    }

    /** Save every modified chunk (autosave / pause / exit). */
    fun saveAllModified() {
        for (c in world.chunks.values) {
            if (c.modified) {
                save.saveChunk(c)
                c.modified = false
            }
        }
    }

    fun dispose() {
        genPool.shutdownNow()
    }
}
