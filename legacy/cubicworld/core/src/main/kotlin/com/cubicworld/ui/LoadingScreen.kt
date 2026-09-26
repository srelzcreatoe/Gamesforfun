package com.cubicworld.ui

import com.badlogic.gdx.Gdx
import com.badlogic.gdx.ScreenAdapter
import com.badlogic.gdx.graphics.GL20
import com.badlogic.gdx.graphics.glutils.ShapeRenderer
import com.badlogic.gdx.scenes.scene2d.Stage
import com.badlogic.gdx.scenes.scene2d.ui.Label
import com.badlogic.gdx.scenes.scene2d.ui.Table
import com.badlogic.gdx.utils.viewport.ScreenViewport
import com.cubicworld.CubicWorldGame
import com.cubicworld.GameBootstrap

/**
 * Boot loader: performs one load step per frame so the screen stays alive,
 * shows progress, and renders registry errors readably instead of crashing.
 */
class LoadingScreen(private val game: CubicWorldGame) : ScreenAdapter() {

    private val stage = Stage(ScreenViewport())
    private val shapes = ShapeRenderer()
    private var step = 0
    private var error: String? = null
    private lateinit var statusLabel: Label

    private val steps = listOf(
        "Reading world registries..." to { game.registries = GameBootstrap.loadRegistries() },
        "Loading textures..." to {
            game.atlas.load()
            GameBootstrap.resolveTextures(game.registries, game.atlas)
        },
        "Loading audio..." to { game.audio.load() },
        "Ready" to {
            game.audio.musicVolume = game.settings.musicVolume
            game.audio.soundVolume = game.settings.soundVolume
            game.audio.ambienceVolume = game.settings.ambienceVolume
        },
    )

    override fun show() {
        val table = Table()
        table.setFillParent(true)
        val title = Label("CUBIC WORLD", UiSkin.skin, "title")
        statusLabel = Label("Waking the Worldheart...", UiSkin.skin, "dim")
        statusLabel.wrap = true
        table.add(title).padBottom(30f * UiSkin.s).row()
        table.add(statusLabel).width(Gdx.graphics.width * 0.7f)
        stage.addActor(table)
    }

    override fun render(delta: Float) {
        Gdx.gl.glClearColor(0.09f, 0.12f, 0.24f, 1f)
        Gdx.gl.glClear(GL20.GL_COLOR_BUFFER_BIT)

        if (error == null && step < steps.size) {
            val (label, action) = steps[step]
            statusLabel.setText(label)
            try {
                action()
                step++
            } catch (e: Exception) {
                Gdx.app.error("CubicWorld", "Boot failure", e)
                error = "Startup error in '$label'\n\n${e.message}\n\n" +
                    "This is a development-time validation failure; the game data " +
                    "needs fixing before play."
                statusLabel.setText(error)
            }
        } else if (error == null) {
            val autoplay = System.getProperty("cubic.autoplay")
            if (autoplay != null) {
                // dev harness: skip menus; reopen the named world or create a fresh one
                val save = com.cubicworld.world.SaveManager(game.worldsRoot)
                val existing = System.getProperty("cubic.world")
                val folder = if (existing != null && java.io.File(game.worldsRoot, existing).exists()) {
                    existing
                } else {
                    save.createWorld(
                        com.cubicworld.world.WorldOptions(
                            name = System.getProperty("cubic.world") ?: "Autotest",
                            seed = autoplay.toLongOrNull() ?: 1234L,
                        ),
                    )
                }
                game.setScreen(GameScreen(game, folder))
            } else {
                game.setScreen(MainMenuScreen(game))
            }
            return
        }

        // progress bar
        val w = Gdx.graphics.width.toFloat()
        val h = Gdx.graphics.height.toFloat()
        shapes.begin(ShapeRenderer.ShapeType.Filled)
        shapes.setColor(0.2f, 0.24f, 0.34f, 1f)
        shapes.rect(w * 0.2f, h * 0.24f, w * 0.6f, 8f * UiSkin.s)
        shapes.setColor(0.45f, 0.75f, 0.95f, 1f)
        shapes.rect(w * 0.2f, h * 0.24f, w * 0.6f * (step.toFloat() / steps.size), 8f * UiSkin.s)
        shapes.end()

        stage.act(delta)
        stage.draw()
    }

    override fun resize(width: Int, height: Int) {
        stage.viewport.update(width, height, true)
    }

    override fun hide() {
        dispose()
    }

    override fun dispose() {
        stage.dispose()
        shapes.dispose()
    }
}
