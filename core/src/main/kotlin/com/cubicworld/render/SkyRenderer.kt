package com.cubicworld.render

import com.badlogic.gdx.Gdx
import com.badlogic.gdx.graphics.Camera
import com.badlogic.gdx.graphics.GL20
import com.badlogic.gdx.graphics.g2d.SpriteBatch
import com.badlogic.gdx.graphics.g2d.TextureRegion
import com.badlogic.gdx.graphics.glutils.ShapeRenderer
import com.badlogic.gdx.math.MathUtils
import com.cubicworld.world.Weather
import com.cubicworld.world.World
import com.cubicworld.world.WorldConst

/**
 * Sky colour gradient over the day cycle, sun/moon discs, night stars and a
 * simple rain/snow particle overlay. The clear colour doubles as fog colour.
 */
class SkyRenderer(private val atlas: TextureAtlasManager) {

    private val batch = SpriteBatch()
    private val shapes = ShapeRenderer()
    private lateinit var sunRegion: TextureRegion
    private lateinit var moonRegion: TextureRegion
    private lateinit var dropRegion: TextureRegion
    private lateinit var flakeRegion: TextureRegion

    val fogColor = FloatArray(3)

    // deterministic star field
    private val starX = FloatArray(80)
    private val starY = FloatArray(80)

    fun create() {
        sunRegion = region("sun_disc")
        moonRegion = region("moon_disc")
        dropRegion = region("rain_drop")
        flakeRegion = region("snow_flake")
        var seed = 1234567
        for (i in starX.indices) {
            seed = seed * 1103515245 + 12345
            starX[i] = ((seed ushr 8) and 0xFFFF) / 65536f
            seed = seed * 1103515245 + 12345
            starY[i] = ((seed ushr 8) and 0xFFFF) / 65536f
        }
    }

    private fun region(name: String): TextureRegion {
        val idx = atlas.tileIndex(name)
        val uv = FloatArray(4)
        atlas.uv(idx, uv)
        val t = atlas.texture
        return TextureRegion(t, uv[0], uv[1], uv[2], uv[3])
    }

    private val dayTop = floatArrayOf(0.36f, 0.62f, 0.92f)
    private val duskTop = floatArrayOf(0.85f, 0.48f, 0.34f)
    private val nightTop = floatArrayOf(0.03f, 0.04f, 0.10f)

    /** Clears the frame to the sky colour and remembers it as fog colour. */
    fun clearFrame(world: World, skyTint: FloatArray) {
        val sun = world.sunFactor()
        val duskiness = (1f - kotlin.math.abs(sun - 0.35f) / 0.3f).coerceIn(0f, 1f) *
            (if (sun < 0.6f) 1f else 0f)
        for (i in 0 until 3) {
            var c = nightTop[i] + (dayTop[i] * skyTint[i] * 1.1f - nightTop[i]) * sun
            c = c + (duskTop[i] - c) * duskiness * 0.6f
            if (world.weather != Weather.CLEAR) c *= 0.75f
            fogColor[i] = c.coerceIn(0f, 1f)
        }
        Gdx.gl.glClearColor(fogColor[0], fogColor[1], fogColor[2], 1f)
        Gdx.gl.glClear(GL20.GL_COLOR_BUFFER_BIT or GL20.GL_DEPTH_BUFFER_BIT)
    }

    /** Draw sun/moon/stars as a 2D backdrop before the world renders. */
    fun renderCelestial(world: World, camera: Camera) {
        val w = Gdx.graphics.width.toFloat()
        val h = Gdx.graphics.height.toFloat()
        val t = world.timeOfDay.toFloat() / WorldConst.DAY_LENGTH_TICKS
        val sun = world.sunFactor()

        // stars at night
        if (sun < 0.3f) {
            val alpha = (0.3f - sun) / 0.3f
            shapes.projectionMatrix = batch.projectionMatrix
            shapes.begin(ShapeRenderer.ShapeType.Filled)
            shapes.setColor(0.9f, 0.92f, 1f, alpha)
            for (i in starX.indices) {
                val size = if (i % 5 == 0) 3f else 2f
                shapes.rect(starX[i] * w, starY[i] * h, size, size)
            }
            shapes.end()
        }

        // sun and moon travel across the top of the screen by day fraction
        batch.begin()
        val sunAngle = (t * 2f - 0.5f) * MathUtils.PI
        val sunX = w * t
        val sunYPos = h * 0.55f + MathUtils.sin(sunAngle) * h * 0.4f
        batch.setColor(1f, 1f, 1f, (sun * 1.4f).coerceIn(0f, 1f))
        batch.draw(sunRegion, sunX - 48f, sunYPos, 96f, 96f)
        val moonT = (t + 0.5f) % 1f
        val moonAngle = (moonT * 2f - 0.5f) * MathUtils.PI
        val moonX = w * moonT
        val moonY = h * 0.55f + MathUtils.sin(moonAngle) * h * 0.4f
        batch.setColor(1f, 1f, 1f, ((0.4f - sun) * 2.6f).coerceIn(0f, 1f))
        batch.draw(moonRegion, moonX - 36f, moonY, 72f, 72f)
        batch.setColor(1f, 1f, 1f, 1f)
        batch.end()
    }

    private var precip = 0f

    /** Simple screen-space rain/snow overlay after the world renders. */
    fun renderWeather(world: World, delta: Float, playerUnderRoof: Boolean) {
        val target = when (world.weather) {
            Weather.RAIN, Weather.STORM -> 1f
            Weather.SNOW -> 0.7f
            else -> 0f
        }
        precip += (target - precip) * (delta * 0.8f).coerceAtMost(1f)
        if (precip < 0.03f || playerUnderRoof) return
        val w = Gdx.graphics.width.toFloat()
        val h = Gdx.graphics.height.toFloat()
        val snow = world.weather == Weather.SNOW
        val region = if (snow) flakeRegion else dropRegion
        val time = (world.totalTicks % 100000L).toFloat() / 20f + Gdx.graphics.frameId % 2 * 0.01f
        batch.begin()
        batch.setColor(1f, 1f, 1f, 0.35f * precip)
        val n = (40 * precip).toInt()
        for (i in 0 until n) {
            val speed = if (snow) 90f else 620f
            val x = ((i * 97f + time * (if (snow) 30f else 10f)) * 13f) % w
            val y = h - ((time * speed + i * 271f) % (h + 40f))
            val sw = if (snow) 8f else 3f
            val sh = if (snow) 8f else 18f
            batch.draw(region, x, y, sw, sh)
        }
        batch.setColor(1f, 1f, 1f, 1f)
        batch.end()
    }

    fun resize(width: Int, height: Int) {
        batch.projectionMatrix.setToOrtho2D(0f, 0f, width.toFloat(), height.toFloat())
    }

    fun dispose() {
        batch.dispose()
        shapes.dispose()
    }
}
