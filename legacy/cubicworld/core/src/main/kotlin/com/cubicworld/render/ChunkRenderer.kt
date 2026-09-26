package com.cubicworld.render

import com.badlogic.gdx.Gdx
import com.badlogic.gdx.graphics.Camera
import com.badlogic.gdx.graphics.GL20
import com.badlogic.gdx.graphics.Mesh
import com.badlogic.gdx.graphics.VertexAttribute
import com.badlogic.gdx.graphics.VertexAttributes.Usage
import com.badlogic.gdx.graphics.glutils.ShaderProgram
import com.badlogic.gdx.math.Vector3
import com.badlogic.gdx.math.collision.BoundingBox
import com.cubicworld.world.Chunk
import com.cubicworld.world.ChunkState
import com.cubicworld.world.World
import com.cubicworld.world.WorldConst
import com.cubicworld.world.WorldConst.SECTION
import com.cubicworld.world.WorldConst.SECTIONS
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

private class SectionMesh {
    var solid: Mesh? = null
    var cutout: Mesh? = null
    var water: Mesh? = null
    val bounds = BoundingBox()
    fun dispose() {
        solid?.dispose(); cutout?.dispose(); water?.dispose()
        solid = null; cutout = null; water = null
    }
}

private class ChunkMeshes {
    val sections = arrayOfNulls<SectionMesh>(SECTIONS)
    fun dispose() { for (s in sections) s?.dispose() }
}

/**
 * Owns all chunk geometry on the GPU. Dirty sections are snapshotted on the
 * main thread, meshed on workers, and uploaded here with a per-frame budget.
 */
class ChunkRenderer(
    private val world: World,
    private val atlas: TextureAtlasManager,
) {
    private val mesher = ChunkMesher(world.registries.blocks, atlas)
    private val meshes = HashMap<Long, ChunkMeshes>()
    private val pool: ExecutorService = Executors.newFixedThreadPool(2) { r ->
        Thread(r, "mesher").apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 }
    }
    private val completed = ConcurrentLinkedQueue<MeshOutput>()
    private val inFlight = HashSet<Long>()

    lateinit var shader: ShaderProgram
        private set

    private val attributes = arrayOf(
        VertexAttribute(Usage.Position, 3, "a_position"),
        VertexAttribute(Usage.TextureCoordinates, 2, "a_uv"),
        VertexAttribute(Usage.ColorPacked, 4, "a_color"),
        VertexAttribute(Usage.Generic, 1, "a_light"),
    )

    /** true once the spawn area around the player has visible geometry */
    var uploadedOnce = false
        private set

    fun create() {
        ShaderProgram.pedantic = false
        shader = ShaderProgram(
            Gdx.files.internal("shaders/chunk.vert"),
            Gdx.files.internal("shaders/chunk.frag"),
        )
        check(shader.isCompiled) { "Chunk shader failed to compile:\n${shader.log}" }
    }

    private fun sectionKey(cx: Int, cz: Int, s: Int): Long =
        (WorldConst.chunkKey(cx, cz) * 31) xor s.toLong()

    // ---- pipeline ---------------------------------------------------------

    fun update(playerCx: Int, playerCz: Int, renderDistance: Int) {
        scheduleDirty(playerCx, playerCz, renderDistance)
        drainCompleted()
    }

    private fun scheduleDirty(pcx: Int, pcz: Int, renderDistance: Int) {
        if (inFlight.size >= 8) return
        // nearest-first scheduling: walk rings outward
        for (r in 0..renderDistance) {
            for (dz in -r..r) for (dx in -r..r) {
                if (maxOf(kotlin.math.abs(dx), kotlin.math.abs(dz)) != r) continue
                val chunk = world.chunkAt(pcx + dx, pcz + dz) ?: continue
                if (chunk.state != ChunkState.ACTIVE) continue
                for (s in 0 until SECTIONS) {
                    if (!chunk.sectionDirty[s]) continue
                    val key = sectionKey(chunk.cx, chunk.cz, s)
                    if (key in inFlight) continue
                    chunk.sectionDirty[s] = false
                    chunk.meshStamp[s]++
                    val input = snapshot(chunk, s)
                    inFlight.add(key)
                    pool.execute {
                        val out = mesher.build(input)
                        completed.add(out)
                    }
                    if (inFlight.size >= 8) return
                }
            }
        }
    }

    private fun snapshot(chunk: Chunk, s: Int): MeshInput {
        val oy = s * SECTION
        val input = MeshInput(chunk.cx shl 4, oy, chunk.cz shl 4, chunk.meshStamp[s])
        val blocks = world.registries.blocks
        val biomes = world.registries.biomes
        for (z in -1..16) for (x in -1..16) {
            val wx = (chunk.cx shl 4) + x
            val wz = (chunk.cz shl 4) + z
            val c = world.chunkForBlock(wx, wz)
            val lx = wx and 15
            val lz = wz and 15
            val ti = ((z + 1) * MeshInput.N + (x + 1)) * 3
            if (c != null && c.state >= ChunkState.TERRAIN) {
                val biome = biomes.byId(c.biomes[(lz shl 4) or lx].toInt())
                for (i in 0 until 3) {
                    input.grassTint[ti + i] = biome.grassTint[i]
                    input.leafTint[ti + i] = biome.leafTint[i]
                }
                for (y in -1..16) {
                    val wy = oy + y
                    val ii = input.idx(x, y, z)
                    if (wy < 0) {
                        input.ids[ii] = 1        // below the world: treat as solid
                        continue
                    }
                    if (wy >= WorldConst.HEIGHT) {
                        input.light[ii] = (WorldConst.MAX_LIGHT shl 4).toByte()
                        continue
                    }
                    val di = c.data.idx(lx, wy, lz)
                    input.ids[ii] = c.data.ids[di]
                    input.states[ii] = c.data.states[di]
                    input.light[ii] = c.data.light[di]
                }
            } else {
                // missing neighbour: pretend transparent + fully lit so border
                // faces render; the section re-meshes when the neighbour arrives
                for (i in 0 until 3) { input.grassTint[ti + i] = 1f; input.leafTint[ti + i] = 1f }
                for (y in -1..16) {
                    input.light[input.idx(x, y, z)] = (WorldConst.MAX_LIGHT shl 4).toByte()
                }
            }
        }
        return input
    }

    private fun drainCompleted() {
        var uploads = 6
        while (uploads > 0) {
            val out = completed.poll() ?: break
            val cx = out.originX shr 4
            val cz = out.originZ shr 4
            val s = out.originY / SECTION
            val key = sectionKey(cx, cz, s)
            inFlight.remove(key)
            val chunk = world.chunkAt(cx, cz)
            if (chunk == null) continue                       // unloaded meanwhile
            if (chunk.meshStamp[s] != out.stamp) continue     // stale: newer rebuild queued
            val cm = meshes.getOrPut(chunk.key) { ChunkMeshes() }
            var sm = cm.sections[s]
            sm?.dispose()
            if (out.isEmpty) {
                cm.sections[s] = null
                continue
            }
            sm = SectionMesh()
            sm.solid = upload(out.solidVerts.items, out.solidVerts.size, out.solidIdx.items, out.solidIdx.size)
            sm.cutout = upload(out.cutoutVerts.items, out.cutoutVerts.size, out.cutoutIdx.items, out.cutoutIdx.size)
            sm.water = upload(out.waterVerts.items, out.waterVerts.size, out.waterIdx.items, out.waterIdx.size)
            sm.bounds.set(
                Vector3(out.originX.toFloat(), out.originY.toFloat(), out.originZ.toFloat()),
                Vector3((out.originX + 16).toFloat(), (out.originY + 16).toFloat(), (out.originZ + 16).toFloat()),
            )
            cm.sections[s] = sm
            uploadedOnce = true
            uploads--
        }
    }

    private fun upload(verts: FloatArray, vCount: Int, idx: ShortArray, iCount: Int): Mesh? {
        if (iCount == 0) return null
        val mesh = Mesh(true, vCount / ChunkMesher.VERTEX_SIZE, iCount, *attributes)
        mesh.setVertices(verts, 0, vCount)
        mesh.setIndices(idx, 0, iCount)
        return mesh
    }

    // ---- draw -------------------------------------------------------------

    private val visibleWater = ArrayList<Pair<Float, Mesh>>(64)
    private val identityMatrix = com.badlogic.gdx.math.Matrix4()

    fun render(camera: Camera, sunLevel: Float, fogColor: FloatArray, renderDistance: Int) {
        val gl = Gdx.gl
        shader.bind()
        shader.setUniformMatrix("u_projView", camera.combined)
        shader.setUniformMatrix("u_model", identityMatrix)
        shader.setUniformf("u_cameraPos", camera.position)
        shader.setUniformf("u_sunLevel", sunLevel)
        shader.setUniformf("u_fogColor", fogColor[0], fogColor[1], fogColor[2])
        val fogEnd = renderDistance * 16f - 4f
        shader.setUniformf("u_fogStart", fogEnd * 0.55f)
        shader.setUniformf("u_fogEnd", fogEnd)
        shader.setUniformf("u_globalAlpha", 1f)
        shader.setUniformf("u_lightOverride", -1f)
        shader.setUniformf("u_hurtFlash", 0f)
        atlas.texture.bind(0)
        shader.setUniformi("u_texture", 0)

        gl.glEnable(GL20.GL_DEPTH_TEST)
        gl.glEnable(GL20.GL_CULL_FACE)
        gl.glCullFace(GL20.GL_BACK)
        gl.glDisable(GL20.GL_BLEND)

        visibleWater.clear()

        // pass 1: solid
        shader.setUniformf("u_alphaTest", 0f)
        forEachVisible(camera) { sm, dist ->
            sm.solid?.render(shader, GL20.GL_TRIANGLES)
            sm.water?.let { visibleWater.add(dist to it) }
        }
        // pass 2: cutout (leaves, plants)
        shader.setUniformf("u_alphaTest", 0.5f)
        forEachVisible(camera) { sm, _ ->
            sm.cutout?.render(shader, GL20.GL_TRIANGLES)
        }
        // pass 3: translucent, back to front, no depth writes
        gl.glEnable(GL20.GL_BLEND)
        gl.glBlendFunc(GL20.GL_SRC_ALPHA, GL20.GL_ONE_MINUS_SRC_ALPHA)
        gl.glDepthMask(false)
        gl.glDisable(GL20.GL_CULL_FACE)
        shader.setUniformf("u_alphaTest", 0f)
        shader.setUniformf("u_globalAlpha", 0.8f)
        visibleWater.sortByDescending { it.first }
        for ((_, mesh) in visibleWater) mesh.render(shader, GL20.GL_TRIANGLES)
        gl.glDepthMask(true)
        gl.glDisable(GL20.GL_BLEND)
        gl.glEnable(GL20.GL_CULL_FACE)
    }

    private inline fun forEachVisible(camera: Camera, draw: (SectionMesh, Float) -> Unit) {
        for ((key, cm) in meshes) {
            for (s in 0 until SECTIONS) {
                val sm = cm.sections[s] ?: continue
                if (!camera.frustum.boundsInFrustum(sm.bounds)) continue
                val dx = sm.bounds.centerX - camera.position.x
                val dy = sm.bounds.centerY - camera.position.y
                val dz = sm.bounds.centerZ - camera.position.z
                draw(sm, dx * dx + dy * dy + dz * dz)
            }
        }
    }

    fun onChunkUnloaded(chunk: Chunk) {
        meshes.remove(chunk.key)?.dispose()
        for (s in 0 until SECTIONS) inFlight.remove(sectionKey(chunk.cx, chunk.cz, s))
    }

    fun dispose() {
        pool.shutdownNow()
        for (cm in meshes.values) cm.dispose()
        meshes.clear()
        if (this::shader.isInitialized) shader.dispose()
    }
}
