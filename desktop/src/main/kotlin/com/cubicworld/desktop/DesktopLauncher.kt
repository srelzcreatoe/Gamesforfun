package com.cubicworld.desktop

import com.badlogic.gdx.ApplicationListener
import com.badlogic.gdx.Gdx
import com.badlogic.gdx.backends.lwjgl3.Lwjgl3Application
import com.badlogic.gdx.backends.lwjgl3.Lwjgl3ApplicationConfiguration
import com.badlogic.gdx.graphics.Pixmap
import com.badlogic.gdx.graphics.PixmapIO
import com.badlogic.gdx.utils.ScreenUtils
import com.cubicworld.CubicWorldGame

fun main() {
    val config = Lwjgl3ApplicationConfiguration().apply {
        setTitle("Cubic World")
        setWindowedMode(1280, 720)
        useVsync(true)
        setForegroundFPS(60)
        if (System.getProperty("cubic.noaudio") != null) disableAudio(true)
    }
    val game = CubicWorldGame()
    val shotsDir = System.getProperty("cubic.shots")
    val listener: ApplicationListener = if (shotsDir != null) AutoShotHarness(game, shotsDir) else game
    Lwjgl3Application(listener, config)
}

/**
 * Development harness: runs the real game and captures a screenshot every few
 * seconds, exiting after a fixed duration. Used for automated visual checks.
 */
private class AutoShotHarness(
    private val game: CubicWorldGame,
    private val dir: String,
) : ApplicationListener {

    private var time = 0f
    private var nextShot = 2f
    private var shotIndex = 0
    private val maxTime = (System.getProperty("cubic.duration") ?: "40").toFloat()

    override fun create() = game.create()
    override fun resize(width: Int, height: Int) = game.resize(width, height)

    override fun render() {
        game.render()
        time += Gdx.graphics.deltaTime
        if (time >= nextShot) {
            nextShot += 4f
            capture()
        }
        if (time > maxTime) Gdx.app.exit()
    }

    private fun capture() {
        try {
            val pixmap = Pixmap.createFromFrameBuffer(0, 0, Gdx.graphics.backBufferWidth, Gdx.graphics.backBufferHeight)
            // flip vertically (framebuffer origin is bottom-left)
            val flipped = Pixmap(pixmap.width, pixmap.height, pixmap.format)
            for (y in 0 until pixmap.height) {
                flipped.drawPixmap(pixmap, 0, y, 0, pixmap.height - y - 1, pixmap.width, 1)
            }
            PixmapIO.writePNG(Gdx.files.absolute("$dir/shot_${shotIndex++}.png"), flipped)
            pixmap.dispose()
            flipped.dispose()
            Gdx.app.log("AutoShot", "captured shot_${shotIndex - 1}")
        } catch (e: Exception) {
            Gdx.app.error("AutoShot", "capture failed", e)
        }
    }

    override fun pause() = game.pause()
    override fun resume() = game.resume()
    override fun dispose() = game.dispose()
}
