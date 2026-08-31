package com.cubicworld

import com.badlogic.gdx.Game
import com.badlogic.gdx.Gdx
import com.badlogic.gdx.graphics.GL20

/**
 * Application entry point shared by the Android and desktop launchers.
 * Boots the registries and asset pipeline, then hands control to screens.
 */
class CubicWorldGame : Game() {

    override fun create() {
        Gdx.app.log("CubicWorld", "Booting Cubic World ${Version.NAME}")
        setScreen(BootScreen(this))
    }

    override fun dispose() {
        screen?.dispose()
    }
}

object Version {
    const val NAME = "0.1.0"
    const val SAVE_FORMAT = 1
}

/** Temporary boot screen; replaced by the real screen flow as systems come online. */
class BootScreen(private val game: CubicWorldGame) : com.badlogic.gdx.ScreenAdapter() {
    override fun render(delta: Float) {
        Gdx.gl.glClearColor(0.42f, 0.65f, 0.87f, 1f)
        Gdx.gl.glClear(GL20.GL_COLOR_BUFFER_BIT)
    }
}
