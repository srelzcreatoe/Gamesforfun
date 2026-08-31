package com.cubicworld.ui

import com.badlogic.gdx.Gdx
import com.badlogic.gdx.Input
import com.badlogic.gdx.ScreenAdapter
import com.badlogic.gdx.graphics.GL20
import com.badlogic.gdx.scenes.scene2d.InputEvent
import com.badlogic.gdx.scenes.scene2d.Stage
import com.badlogic.gdx.scenes.scene2d.ui.Label
import com.badlogic.gdx.scenes.scene2d.ui.ScrollPane
import com.badlogic.gdx.scenes.scene2d.ui.Table
import com.badlogic.gdx.scenes.scene2d.ui.TextButton
import com.badlogic.gdx.scenes.scene2d.utils.ClickListener
import com.badlogic.gdx.utils.Align
import com.badlogic.gdx.utils.viewport.ScreenViewport
import com.cubicworld.CubicWorldGame
import com.cubicworld.Version

/** Common scaffolding for all menu screens: stage, animated backdrop, nav. */
abstract class MenuScreen(protected val game: CubicWorldGame) : ScreenAdapter() {

    protected val stage = Stage(ScreenViewport())
    protected val background = MenuBackground(game.atlas)
    protected val s: Float get() = UiSkin.s

    override fun show() {
        background.create()
        background.resize(Gdx.graphics.width, Gdx.graphics.height)
        Gdx.input.inputProcessor = stage
        Gdx.input.setCatchKey(Input.Keys.BACK, true)
        buildUi()
    }

    abstract fun buildUi()

    /** Android back button target; null = leave the app default. */
    open fun onBack() {}

    protected fun button(text: String, style: String = "default", onClick: () -> Unit): TextButton {
        val b = TextButton(text, UiSkin.skin, style)
        b.pad(8f * s, 20f * s, 8f * s, 20f * s)
        b.addListener(object : ClickListener() {
            override fun clicked(event: InputEvent?, x: Float, y: Float) {
                game.audio.play("click", 0.7f)
                onClick()
            }
        })
        return b
    }

    override fun render(delta: Float) {
        Gdx.gl.glClear(GL20.GL_COLOR_BUFFER_BIT)
        background.render(delta)
        game.audio.update(delta)
        if (Gdx.input.isKeyJustPressed(Input.Keys.BACK) || Gdx.input.isKeyJustPressed(Input.Keys.ESCAPE)) {
            onBack()
        }
        stage.act(delta)
        stage.draw()
    }

    override fun resize(width: Int, height: Int) {
        stage.viewport.update(width, height, true)
        background.resize(width, height)
    }

    override fun hide() {
        dispose()
    }

    override fun dispose() {
        stage.dispose()
        background.dispose()
    }
}

// ---------------------------------------------------------------------------

class MainMenuScreen(game: CubicWorldGame) : MenuScreen(game) {

    override fun buildUi() {
        val table = Table()
        table.setFillParent(true)
        table.add(Label("CUBIC WORLD", UiSkin.skin, "title")).padBottom(4f * s).row()
        table.add(Label("Shape the wild. Awaken the world.", UiSkin.skin, "dim")).padBottom(26f * s).row()
        table.add(button("Play") { game.setScreen(WorldSelectScreen(game)) })
            .width(240f * s).padBottom(10f * s).row()
        table.add(button("Settings") { game.setScreen(SettingsScreen(game) { MainMenuScreen(game) }) })
            .width(240f * s).padBottom(10f * s).row()
        table.add(button("How to Play") { game.setScreen(HowToPlayScreen(game)) })
            .width(240f * s).padBottom(10f * s).row()
        table.add(button("Credits") { game.setScreen(CreditsScreen(game)) })
            .width(240f * s).padBottom(10f * s).row()
        table.add(button("Quit") { Gdx.app.exit() }).width(240f * s).row()
        table.add(Label("v${Version.NAME}", UiSkin.skin, "dim")).padTop(18f * s)
        stage.addActor(table)
    }

    override fun onBack() { Gdx.app.exit() }
}

// ---------------------------------------------------------------------------

class HowToPlayScreen(game: CubicWorldGame) : MenuScreen(game) {

    override fun buildUi() {
        val text = """
            MOVE - drag the left joystick. Look around by swiping the right side of the screen.

            MINE - press and hold on a block until the ring fills. Blocks drop as items you walk over to collect.

            PLACE & USE - tap on the world to place your selected block, open crates and crafting stations, or talk to things. Tap a creature to strike it.

            HOTBAR - tap a slot to select it. Open your pack with the bag button to move items, then tap a source slot and a destination slot.

            CRAFT - open your pack for hand recipes. Build a Handwork Mat, Forge Table, Kiln and Cookpot to unlock deeper recipes. Recipes appear as you discover new materials.

            SURVIVE - keep your hunger up by cooking and eating. Nights are dangerous in the wild: light glow lanterns, build shelter, and watch for Dusklings in the dark.

            EAT - select food and hold the use area to eat it.

            CAMERA - the eye button switches between first-person and third-person views.

            SAVING - your world saves automatically and when you pause or leave. Resonance and Waystones hide deeper mysteries for explorers...
        """.trimIndent()

        val label = Label(text, UiSkin.skin)
        label.wrap = true
        label.setAlignment(Align.topLeft)
        val pane = ScrollPane(label, UiSkin.skin)
        pane.setFadeScrollBars(false)

        val table = Table()
        table.setFillParent(true)
        table.pad(20f * s)
        table.add(Label("How to Play", UiSkin.skin, "title")).padBottom(12f * s).row()
        table.add(pane).expand().fill().width(Gdx.graphics.width * 0.82f).row()
        table.add(button("Back") { game.setScreen(MainMenuScreen(game)) }).padTop(12f * s)
        stage.addActor(table)
    }

    override fun onBack() { game.setScreen(MainMenuScreen(game)) }
}

// ---------------------------------------------------------------------------

class CreditsScreen(game: CubicWorldGame) : MenuScreen(game) {

    override fun buildUi() {
        val text = """
            CUBIC WORLD ${Version.NAME}

            An original voxel sandbox adventure.

            Design, code, art & audio
            Created with Claude Code

            All textures, sounds, music, creature designs, block sets, recipes and world lore are original to Cubic World and generated procedurally for this project.

            Built with libGDX (Apache License 2.0)
            libgdx.com

            Default UI font: libGDX bundled font (Apache License 2.0)

            Thank you for playing. May the Worldheart hum beneath your feet.
        """.trimIndent()

        val label = Label(text, UiSkin.skin)
        label.wrap = true
        label.setAlignment(Align.center)
        val pane = ScrollPane(label, UiSkin.skin)

        val table = Table()
        table.setFillParent(true)
        table.pad(20f * s)
        table.add(Label("Credits", UiSkin.skin, "title")).padBottom(12f * s).row()
        table.add(pane).expand().fill().width(Gdx.graphics.width * 0.8f).row()
        table.add(button("Back") { game.setScreen(MainMenuScreen(game)) }).padTop(12f * s)
        stage.addActor(table)
    }

    override fun onBack() { game.setScreen(MainMenuScreen(game)) }
}
