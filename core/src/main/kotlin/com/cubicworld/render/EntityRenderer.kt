package com.cubicworld.render

import com.badlogic.gdx.graphics.Camera
import com.badlogic.gdx.graphics.Color
import com.badlogic.gdx.graphics.GL20
import com.badlogic.gdx.graphics.Mesh
import com.badlogic.gdx.graphics.VertexAttribute
import com.badlogic.gdx.graphics.VertexAttributes.Usage
import com.badlogic.gdx.graphics.glutils.ShaderProgram
import com.badlogic.gdx.math.MathUtils
import com.badlogic.gdx.math.Matrix4
import com.badlogic.gdx.utils.FloatArray as GdxFloatArray
import com.badlogic.gdx.utils.ShortArray as GdxShortArray
import com.cubicworld.entity.Creature
import com.cubicworld.entity.DropItem
import com.cubicworld.entity.EntityManager
import com.cubicworld.world.World

/**
 * Draws creatures as expressive two-box models (body + head with eye band)
 * and dropped items as small spinning cubes, sharing the chunk shader.
 */
class EntityRenderer(
    private val world: World,
    private val atlas: TextureAtlasManager,
) {
    private val creatureMeshes = HashMap<String, Mesh>()
    private val dropMeshes = HashMap<Int, Mesh>()
    private val model = Matrix4()
    private val uvTmp = FloatArray(4)

    private val attributes = arrayOf(
        VertexAttribute(Usage.Position, 3, "a_position"),
        VertexAttribute(Usage.TextureCoordinates, 2, "a_uv"),
        VertexAttribute(Usage.ColorPacked, 4, "a_color"),
        VertexAttribute(Usage.Generic, 1, "a_light"),
    )

    private fun addBox(
        verts: GdxFloatArray, idx: GdxShortArray,
        cx: Float, cy: Float, cz: Float,
        sx: Float, sy: Float, sz: Float, tile: Int, shadeSides: Boolean = true,
    ) {
        atlas.uv(tile, uvTmp)
        val x0 = cx - sx / 2; val x1 = cx + sx / 2
        val y0 = cy; val y1 = cy + sy
        val z0 = cz - sz / 2; val z1 = cz + sz / 2
        // 6 faces, outward winding; per-face shade factor baked in the tint
        val faces = arrayOf(
            // top
            arrayOf(floatArrayOf(x0, y1, z0), floatArrayOf(x0, y1, z1), floatArrayOf(x1, y1, z1), floatArrayOf(x1, y1, z0)) to 1f,
            // bottom
            arrayOf(floatArrayOf(x0, y0, z0), floatArrayOf(x1, y0, z0), floatArrayOf(x1, y0, z1), floatArrayOf(x0, y0, z1)) to 0.6f,
            // north
            arrayOf(floatArrayOf(x0, y0, z0), floatArrayOf(x0, y1, z0), floatArrayOf(x1, y1, z0), floatArrayOf(x1, y0, z0)) to 0.8f,
            // south
            arrayOf(floatArrayOf(x1, y0, z1), floatArrayOf(x1, y1, z1), floatArrayOf(x0, y1, z1), floatArrayOf(x0, y0, z1)) to 0.8f,
            // east
            arrayOf(floatArrayOf(x1, y0, z0), floatArrayOf(x1, y1, z0), floatArrayOf(x1, y1, z1), floatArrayOf(x1, y0, z1)) to 0.7f,
            // west
            arrayOf(floatArrayOf(x0, y0, z1), floatArrayOf(x0, y1, z1), floatArrayOf(x0, y1, z0), floatArrayOf(x0, y0, z0)) to 0.7f,
        )
        for ((corners, shade) in faces) {
            val s = if (shadeSides) shade else 1f
            val base = verts.size / ChunkMesher.VERTEX_SIZE
            if (base + 4 > 32000) return
            val us = floatArrayOf(uvTmp[0], uvTmp[0], uvTmp[2], uvTmp[2])
            val vs = floatArrayOf(uvTmp[3], uvTmp[1], uvTmp[1], uvTmp[3])
            for (i in 0 until 4) {
                verts.add(corners[i][0]); verts.add(corners[i][1]); verts.add(corners[i][2])
                verts.add(us[i]); verts.add(vs[i])
                verts.add(Color.toFloatBits(s, s, s, 1f))
                verts.add(1f)
            }
            idx.add(base.toShort()); idx.add((base + 1).toShort()); idx.add((base + 2).toShort())
            idx.add((base + 2).toShort()); idx.add((base + 3).toShort()); idx.add(base.toShort())
        }
    }

    private fun creatureMesh(c: Creature): Mesh = creatureMeshes.getOrPut(c.def.name) {
        val verts = GdxFloatArray(512)
        val idx = GdxShortArray(256)
        val w = c.def.width
        val h = c.def.height
        // body fills most of the volume, head sits forward and up
        addBox(verts, idx, 0f, 0f, 0f, w, h * 0.62f, w * 1.15f, c.def.bodyTileIdx)
        addBox(verts, idx, 0f, h * 0.5f, -w * 0.42f, w * 0.68f, h * 0.5f, w * 0.6f, c.def.headTileIdx)
        // stubby legs
        addBox(verts, idx, -w * 0.28f, -h * 0.12f, w * 0.3f, w * 0.22f, h * 0.16f, w * 0.22f, c.def.bodyTileIdx)
        addBox(verts, idx, w * 0.28f, -h * 0.12f, w * 0.3f, w * 0.22f, h * 0.16f, w * 0.22f, c.def.bodyTileIdx)
        addBox(verts, idx, -w * 0.28f, -h * 0.12f, -w * 0.3f, w * 0.22f, h * 0.16f, w * 0.22f, c.def.bodyTileIdx)
        addBox(verts, idx, w * 0.28f, -h * 0.12f, -w * 0.3f, w * 0.22f, h * 0.16f, w * 0.22f, c.def.bodyTileIdx)
        buildMesh(verts, idx)
    }

    private fun dropMesh(icon: Int): Mesh = dropMeshes.getOrPut(icon) {
        val verts = GdxFloatArray(200)
        val idx = GdxShortArray(40)
        addBox(verts, idx, 0f, 0f, 0f, 0.28f, 0.28f, 0.28f, icon)
        buildMesh(verts, idx)
    }

    private fun buildMesh(verts: GdxFloatArray, idx: GdxShortArray): Mesh {
        val mesh = Mesh(true, verts.size / ChunkMesher.VERTEX_SIZE, idx.size, *attributes)
        mesh.setVertices(verts.items, 0, verts.size)
        mesh.setIndices(idx.items, 0, idx.size)
        return mesh
    }

    fun render(shader: ShaderProgram, camera: Camera, entities: EntityManager, sunLevel: Float) {
        // shader is already bound and configured by ChunkRenderer.render
        shader.setUniformf("u_globalAlpha", 1f)
        shader.setUniformf("u_alphaTest", 0.5f)
        for (e in entities.entities) {
            val dx = e.position.x - camera.position.x
            val dz = e.position.z - camera.position.z
            if (dx * dx + dz * dz > 56f * 56f) continue

            val light = world.lightAt(
                MathUtils.floor(e.position.x),
                MathUtils.floor(e.position.y + 0.5f),
                MathUtils.floor(e.position.z),
            )
            val sky = ((light ushr 4) and 0xF) / 15f
            val block = (light and 0xF) / 15f
            val lv = maxOf(sky * sunLevel, block)
            shader.setUniformf("u_lightOverride", lv)

            when (e) {
                is Creature -> {
                    val bob = MathUtils.sin(e.animTime * 6f) * 0.03f * e.velocity.len().coerceAtMost(1f)
                    model.setToTranslation(e.position.x, e.position.y + e.height * 0.2f + bob, e.position.z)
                    model.rotate(0f, 1f, 0f, e.yaw)
                    shader.setUniformMatrix("u_model", model)
                    shader.setUniformf("u_hurtFlash", (e.hurtVisual * 2f).coerceIn(0f, 0.6f))
                    creatureMesh(e).render(shader, GL20.GL_TRIANGLES)
                }
                is DropItem -> {
                    val spin = e.age * 60f
                    val bob = MathUtils.sin(e.age * 2.4f) * 0.06f
                    model.setToTranslation(e.position.x, e.position.y + 0.15f + bob, e.position.z)
                    model.rotate(0f, 1f, 0f, spin)
                    shader.setUniformMatrix("u_model", model)
                    shader.setUniformf("u_hurtFlash", 0f)
                    val def = world.registries.items.byId(e.itemId)
                    dropMesh(def.icon).render(shader, GL20.GL_TRIANGLES)
                }
            }
        }
        shader.setUniformf("u_lightOverride", -1f)
        shader.setUniformf("u_hurtFlash", 0f)
    }

    // ---- block break-progress crack overlay --------------------------------

    private val crackMeshes = arrayOfNulls<Mesh>(4)

    private fun crackMesh(stage: Int): Mesh? {
        val idx = stage.coerceIn(0, 3)
        crackMeshes[idx]?.let { return it }
        val tileName = "crack_$idx"
        if (!atlas.hasTile(tileName)) return null
        val verts = GdxFloatArray(200)
        val indices = GdxShortArray(40)
        addBox(verts, indices, 0f, -0.501f, 0f, 1.002f, 1.002f, 1.002f, atlas.tileIndex(tileName), shadeSides = false)
        val m = buildMesh(verts, indices)
        crackMeshes[idx] = m
        return m
    }

    /** Draw crack stages over the block being mined. Blend must be enabled. */
    fun renderBreakOverlay(shader: ShaderProgram, x: Int, y: Int, z: Int, progress: Float) {
        if (progress <= 0f) return
        val mesh = crackMesh((progress * 4f).toInt()) ?: return
        shader.setUniformf("u_lightOverride", 1f)
        shader.setUniformf("u_hurtFlash", 0f)
        model.setToTranslation(x + 0.5f, y + 0.5f, z + 0.5f)
        shader.setUniformMatrix("u_model", model)
        val gl = com.badlogic.gdx.Gdx.gl
        gl.glEnable(GL20.GL_BLEND)
        gl.glBlendFunc(GL20.GL_SRC_ALPHA, GL20.GL_ONE_MINUS_SRC_ALPHA)
        mesh.render(shader, GL20.GL_TRIANGLES)
        gl.glDisable(GL20.GL_BLEND)
        shader.setUniformf("u_lightOverride", -1f)
    }

    // ---- player (visible in third person) ---------------------------------

    private var playerMesh: Mesh? = null

    private fun playerMeshLazy(): Mesh = playerMesh ?: run {
        val verts = GdxFloatArray(1024)
        val idx = GdxShortArray(256)
        val body = if (atlas.hasTile("player_body")) atlas.tileIndex("player_body") else atlas.tileIndex("white")
        val head = if (atlas.hasTile("player_head")) atlas.tileIndex("player_head") else atlas.tileIndex("white")
        val legs = if (atlas.hasTile("player_legs")) atlas.tileIndex("player_legs") else body
        addBox(verts, idx, 0f, 0.68f, 0f, 0.52f, 0.72f, 0.3f, body)          // torso
        addBox(verts, idx, 0f, 1.42f, 0f, 0.42f, 0.42f, 0.42f, head)          // head
        addBox(verts, idx, -0.14f, 0f, 0f, 0.2f, 0.68f, 0.24f, legs)          // legs
        addBox(verts, idx, 0.14f, 0f, 0f, 0.2f, 0.68f, 0.24f, legs)
        addBox(verts, idx, -0.36f, 0.62f, 0f, 0.18f, 0.66f, 0.22f, body)      // arms
        addBox(verts, idx, 0.36f, 0.62f, 0f, 0.18f, 0.66f, 0.22f, body)
        val m = buildMesh(verts, idx)
        playerMesh = m
        m
    }

    fun renderPlayer(
        shader: ShaderProgram,
        player: com.cubicworld.player.PlayerController,
        sunLevel: Float,
        walkCycle: Float,
    ) {
        val light = world.lightAt(
            MathUtils.floor(player.position.x),
            MathUtils.floor(player.position.y + 1f),
            MathUtils.floor(player.position.z),
        )
        val sky = ((light ushr 4) and 0xF) / 15f
        val block = (light and 0xF) / 15f
        shader.setUniformf("u_lightOverride", maxOf(sky * sunLevel, block))
        shader.setUniformf("u_hurtFlash", 0f)
        val bob = MathUtils.sin(walkCycle * 6f) * 0.04f
        model.setToTranslation(player.position.x, player.position.y + bob, player.position.z)
        model.rotate(0f, 1f, 0f, player.yaw)
        shader.setUniformMatrix("u_model", model)
        playerMeshLazy().render(shader, GL20.GL_TRIANGLES)
        shader.setUniformf("u_lightOverride", -1f)
    }

    fun dispose() {
        for (m in creatureMeshes.values) m.dispose()
        for (m in dropMeshes.values) m.dispose()
        creatureMeshes.clear()
        dropMeshes.clear()
        playerMesh?.dispose()
        playerMesh = null
        for (i in crackMeshes.indices) {
            crackMeshes[i]?.dispose()
            crackMeshes[i] = null
        }
    }
}
