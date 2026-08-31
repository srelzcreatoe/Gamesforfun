package com.cubicworld.ui

import com.badlogic.gdx.Gdx
import com.badlogic.gdx.graphics.g2d.SpriteBatch
import com.badlogic.gdx.graphics.g2d.TextureRegion
import com.badlogic.gdx.graphics.glutils.ShapeRenderer
import com.badlogic.gdx.math.MathUtils
import com.cubicworld.render.TextureAtlasManager

/**
 * Shared animated menu backdrop: a dusk gradient over Sunleaf Meadows hues
 * with slowly drifting cube motifs and a distant glowing waystone crystal.
 */
class MenuBackground(private val atlas: TextureAtlasManager) {

    private val shapes = ShapeRenderer()
    private val batch = SpriteBatch()
    private var time = 0f
    private val cubeTiles = ArrayList<TextureRegion>()
    private lateinit var crystal: TextureRegion

    fun create() {
        for (name in listOf("grass_top", "sunbark_planks", "graystone", "copper_vein", "sunbark_leaves")) {
            if (atlas.hasTile(name)) cubeTiles.add(regionFor(name))
        }
        if (cubeTiles.isEmpty()) cubeTiles.add(regionFor("white"))
        crystal = regionFor(if (atlas.hasTile("waystone_core_glow")) "waystone_core_glow" else "sun_disc")
    }

    private fun regionFor(name: String): TextureRegion {
        val uv = FloatArray(4)
        atlas.uv(atlas.tileIndex(name), uv)
        return TextureRegion(atlas.texture, uv[0], uv[1], uv[2], uv[3])
    }

    fun render(delta: Float) {
        time += delta
        val w = Gdx.graphics.width.toFloat()
        val h = Gdx.graphics.height.toFloat()

        shapes.begin(ShapeRenderer.ShapeType.Filled)
        // vertical dusk gradient
        val steps = 24
        for (i in 0 until steps) {
            val t = i.toFloat() / steps
            val r = 0.10f + 0.25f * t
            val g = 0.14f + 0.28f * t
            val b = 0.30f + 0.30f * t
            shapes.setColor(r, g, b, 1f)
            shapes.rect(0f, h - (i + 1) * h / steps, w, h / steps + 1f)
        }
        // rolling meadow silhouettes
        shapes.setColor(0.13f, 0.24f, 0.16f, 1f)
        for (x in 0..32) {
            val fx = x / 32f * w
            val hillH = h * 0.16f + MathUtils.sin(x * 0.6f + 1f) * h * 0.05f
            shapes.rect(fx, 0f, w / 32f + 1f, hillH)
        }
        shapes.setColor(0.10f, 0.18f, 0.13f, 1f)
        for (x in 0..32) {
            val fx = x / 32f * w
            val hillH = h * 0.10f + MathUtils.cos(x * 0.9f) * h * 0.03f
            shapes.rect(fx, 0f, w / 32f + 1f, hillH)
        }
        shapes.end()

        batch.begin()
        // distant waystone glow
        val pulse = 0.75f + MathUtils.sin(time * 1.2f) * 0.25f
        batch.setColor(0.6f, 0.95f, 1f, 0.5f * pulse)
        batch.draw(crystal, w * 0.78f, h * 0.16f, 26f * UiSkin.s, 40f * UiSkin.s)
        // drifting cubes
        for ((i, tile) in cubeTiles.withIndex()) {
            val fx = ((time * (6f + i * 3f) + i * w / cubeTiles.size) % (w + 120f)) - 60f
            val fy = h * (0.35f + 0.4f * ((i * 37) % 10) / 10f) + MathUtils.sin(time * 0.7f + i) * 14f
            val size = (18f + (i % 3) * 10f) * UiSkin.s
            batch.setColor(1f, 1f, 1f, 0.35f)
            batch.draw(tile, fx, fy, size, size)
        }
        batch.setColor(1f, 1f, 1f, 1f)
        batch.end()
    }

    fun resize(width: Int, height: Int) {
        batch.projectionMatrix.setToOrtho2D(0f, 0f, width.toFloat(), height.toFloat())
        shapes.projectionMatrix.setToOrtho2D(0f, 0f, width.toFloat(), height.toFloat())
    }

    fun dispose() {
        shapes.dispose()
        batch.dispose()
    }
}
