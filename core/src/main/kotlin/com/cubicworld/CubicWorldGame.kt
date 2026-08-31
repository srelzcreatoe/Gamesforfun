package com.cubicworld

import com.badlogic.gdx.Game
import com.badlogic.gdx.Gdx
import com.cubicworld.audio.AudioManager
import com.cubicworld.render.TextureAtlasManager
import com.cubicworld.settings.GameSettings
import com.cubicworld.ui.LoadingScreen
import com.cubicworld.ui.UiSkin
import com.cubicworld.world.Registries
import java.io.File

object Version {
    const val NAME = "0.1.0"
    const val SAVE_FORMAT = 1
}

/**
 * Application entry point shared by the Android and desktop launchers.
 * Owns the global services; screens are created per navigation step.
 */
class CubicWorldGame : Game() {

    lateinit var registries: Registries
    val atlas = TextureAtlasManager()
    val audio = AudioManager()
    val settings = GameSettings()
    lateinit var worldsRoot: File

    override fun create() {
        Gdx.app.log("CubicWorld", "Booting Cubic World ${Version.NAME}")
        settings.load()
        UiSkin.build()
        worldsRoot = Gdx.files.local("worlds").file()
        worldsRoot.mkdirs()
        setScreen(LoadingScreen(this))
    }

    override fun dispose() {
        // screens dispose themselves in hide(); do not also call dispose here
        screen?.hide()
        audio.dispose()
        atlas.dispose()
        UiSkin.dispose()
    }
}
