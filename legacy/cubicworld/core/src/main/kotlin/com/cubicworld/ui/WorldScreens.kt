package com.cubicworld.ui

import com.badlogic.gdx.Gdx
import com.badlogic.gdx.Input
import com.badlogic.gdx.scenes.scene2d.ui.CheckBox
import com.badlogic.gdx.scenes.scene2d.ui.Dialog
import com.badlogic.gdx.scenes.scene2d.ui.Label
import com.badlogic.gdx.scenes.scene2d.ui.ScrollPane
import com.badlogic.gdx.scenes.scene2d.ui.Table
import com.badlogic.gdx.utils.Align
import com.cubicworld.CubicWorldGame
import com.cubicworld.world.Difficulty
import com.cubicworld.world.GameMode
import com.cubicworld.world.SaveManager
import com.cubicworld.world.WorldOptions
import com.cubicworld.world.WorldSummary
import com.cubicworld.world.gen.WorldType
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** World list with play/rename/duplicate/delete management. */
class WorldSelectScreen(game: CubicWorldGame) : MenuScreen(game) {

    private val save = SaveManager(game.worldsRoot)

    override fun buildUi() {
        val table = Table()
        table.setFillParent(true)
        table.pad(16f * s)
        table.add(Label("Your Worlds", UiSkin.skin, "title")).padBottom(10f * s).colspan(2).row()

        val list = Table()
        val worlds = save.listWorlds()
        if (worlds.isEmpty()) {
            list.add(Label("No worlds yet. Create your first one!", UiSkin.skin, "dim")).pad(30f * s)
        } else {
            val fmt = SimpleDateFormat("MMM d, HH:mm", Locale.US)
            for (w in worlds) {
                list.add(worldCard(w, fmt)).fillX().expandX().padBottom(8f * s).row()
            }
        }
        val pane = ScrollPane(list, UiSkin.skin)
        pane.setFadeScrollBars(false)
        table.add(pane).expand().fill().colspan(2).row()

        table.add(button("Create World") { game.setScreen(CreateWorldScreen(game)) })
            .padTop(12f * s).padRight(8f * s)
        table.add(button("Back") { game.setScreen(MainMenuScreen(game)) }).padTop(12f * s)
        stage.addActor(table)
    }

    private fun worldCard(w: WorldSummary, fmt: SimpleDateFormat): Table {
        val card = Table()
        card.background = UiSkin.skin.getDrawable("panel-light")
        card.pad(10f * s)
        val info = Table()
        info.add(Label(w.name, UiSkin.skin)).left().row()
        info.add(
            Label(
                "${w.mode.name.lowercase().replaceFirstChar { it.uppercase() }} · seed ${w.seed} · " +
                    "${if (w.lastPlayed > 0) fmt.format(Date(w.lastPlayed)) else "never played"} · v${w.gameVersion}",
                UiSkin.skin, "dim",
            ),
        ).left()
        card.add(info).expandX().left()
        card.add(button("Play") { game.setScreen(GameScreen(game, w.folder)) }).padRight(6f * s)
        card.add(button("Rename") { rename(w) }).padRight(6f * s)
        card.add(button("Copy") {
            save.duplicateWorld(w.folder)
            game.setScreen(WorldSelectScreen(game))
        }).padRight(6f * s)
        card.add(button("Delete", "danger") { confirmDelete(w) })
        return card
    }

    private fun rename(w: WorldSummary) {
        Gdx.input.getTextInput(object : Input.TextInputListener {
            override fun input(text: String) {
                if (text.isNotBlank()) {
                    save.renameWorld(w.folder, text.trim())
                    Gdx.app.postRunnable { game.setScreen(WorldSelectScreen(game)) }
                }
            }
            override fun canceled() {}
        }, "Rename world", w.name, "World name")
    }

    private fun confirmDelete(w: WorldSummary) {
        val dialog = object : Dialog("", UiSkin.skin) {
            override fun result(obj: Any?) {
                if (obj == true) {
                    save.deleteWorld(w.folder)
                    game.setScreen(WorldSelectScreen(game))
                }
            }
        }
        dialog.text(Label("Delete '${w.name}' forever?\nThis cannot be undone.", UiSkin.skin).apply {
            setAlignment(Align.center)
        })
        dialog.button(button("Cancel") {}, false)
        dialog.button(button("Delete", "danger") {}, true)
        dialog.pad(16f * s)
        dialog.show(stage)
    }

    override fun onBack() { game.setScreen(MainMenuScreen(game)) }
}

// ---------------------------------------------------------------------------

/** New-world options form. */
class CreateWorldScreen(game: CubicWorldGame) : MenuScreen(game) {

    private val options = WorldOptions(name = "New World", seed = System.currentTimeMillis())
    private var seedText = ""

    override fun buildUi() {
        val table = Table()
        table.setFillParent(true)
        table.pad(14f * s)
        table.add(Label("Create World", UiSkin.skin, "title")).padBottom(12f * s).colspan(2).row()

        val form = Table()

        val nameLabel = Label(options.name, UiSkin.skin)
        form.add(Label("Name", UiSkin.skin, "dim")).left().padRight(14f * s)
        form.add(nameLabel).left().expandX()
        form.add(button("Edit") {
            Gdx.input.getTextInput(object : Input.TextInputListener {
                override fun input(text: String) {
                    if (text.isNotBlank()) {
                        options.name = text.trim().take(28)
                        Gdx.app.postRunnable { nameLabel.setText(options.name) }
                    }
                }
                override fun canceled() {}
            }, "World name", options.name, "")
        }).row()

        val seedLabel = Label("random", UiSkin.skin)
        form.add(Label("Seed", UiSkin.skin, "dim")).left().padRight(14f * s).padTop(8f * s)
        form.add(seedLabel).left().padTop(8f * s)
        form.add(button("Edit") {
            Gdx.input.getTextInput(object : Input.TextInputListener {
                override fun input(text: String) {
                    seedText = text.trim()
                    Gdx.app.postRunnable { seedLabel.setText(if (seedText.isEmpty()) "random" else seedText) }
                }
                override fun canceled() {}
            }, "Seed (number or words, empty = random)", seedText, "")
        }).padTop(8f * s).row()

        form.add(Label("Mode", UiSkin.skin, "dim")).left().padTop(8f * s)
        form.add(cycler(GameMode.entries.map { it.name.lowercase().replaceFirstChar { c -> c.uppercase() } }) {
            options.mode = GameMode.entries[it]
        }).left().colspan(2).padTop(8f * s).row()

        form.add(Label("Difficulty", UiSkin.skin, "dim")).left().padTop(8f * s)
        form.add(cycler(Difficulty.entries.map { it.name.lowercase().replaceFirstChar { c -> c.uppercase() } }, 1) {
            options.difficulty = Difficulty.entries[it]
        }).left().colspan(2).padTop(8f * s).row()

        form.add(Label("World type", UiSkin.skin, "dim")).left().padTop(8f * s)
        form.add(cycler(listOf("Standard", "Wide Islands", "Mountain Realm", "Flat Builder")) {
            options.worldType = WorldType.entries[it]
        }).left().colspan(2).padTop(8f * s).row()

        val keepInv = CheckBox("  Keep inventory after defeat", UiSkin.skin)
        keepInv.addListener(object : com.badlogic.gdx.scenes.scene2d.utils.ClickListener() {
            override fun clicked(event: com.badlogic.gdx.scenes.scene2d.InputEvent?, x: Float, y: Float) {
                options.keepInventory = keepInv.isChecked
            }
        })
        form.add(keepInv).left().colspan(3).padTop(10f * s).row()

        table.add(form).expandX().row()
        val buttons = Table()
        buttons.add(button("Create & Play") {
            options.seed = parseSeed(seedText)
            val save = SaveManager(game.worldsRoot)
            val folder = save.createWorld(options)
            game.setScreen(GameScreen(game, folder))
        }).padRight(10f * s)
        buttons.add(button("Back") { game.setScreen(WorldSelectScreen(game)) })
        table.add(buttons).padTop(18f * s)
        stage.addActor(table)
    }

    private fun parseSeed(text: String): Long {
        if (text.isEmpty()) return System.currentTimeMillis()
        return text.toLongOrNull() ?: text.hashCode().toLong()
    }

    private fun cycler(labels: List<String>, start: Int = 0, onChange: (Int) -> Unit): Table {
        var idx = start
        val label = Label(labels[idx], UiSkin.skin)
        val t = Table()
        t.add(button("<") {
            idx = (idx - 1 + labels.size) % labels.size
            label.setText(labels[idx]); onChange(idx)
        }).padRight(10f * s)
        t.add(label).width(150f * s)
        t.add(button(">") {
            idx = (idx + 1) % labels.size
            label.setText(labels[idx]); onChange(idx)
        }).padLeft(10f * s)
        return t
    }

    override fun onBack() { game.setScreen(WorldSelectScreen(game)) }
}
