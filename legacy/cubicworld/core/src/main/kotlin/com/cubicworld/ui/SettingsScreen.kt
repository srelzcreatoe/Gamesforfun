package com.cubicworld.ui

import com.badlogic.gdx.Screen
import com.badlogic.gdx.scenes.scene2d.InputEvent
import com.badlogic.gdx.scenes.scene2d.ui.CheckBox
import com.badlogic.gdx.scenes.scene2d.ui.Label
import com.badlogic.gdx.scenes.scene2d.ui.ScrollPane
import com.badlogic.gdx.scenes.scene2d.ui.Slider
import com.badlogic.gdx.scenes.scene2d.ui.Table
import com.badlogic.gdx.scenes.scene2d.utils.ChangeListener
import com.badlogic.gdx.scenes.scene2d.utils.ClickListener
import com.cubicworld.CubicWorldGame
import com.cubicworld.settings.PerfPreset

/**
 * All accessibility/performance/audio/control options.
 * [returnTo] builds the screen to go back to (menu or the running game).
 */
class SettingsScreen(
    game: CubicWorldGame,
    private val returnTo: () -> Screen,
) : MenuScreen(game) {

    private val settings get() = game.settings

    override fun buildUi() {
        val form = Table()
        form.defaults().padBottom(6f * s)

        header(form, "Audio")
        slider(form, "Music", 0f, 1f, settings.musicVolume) {
            settings.musicVolume = it; game.audio.musicVolume = it
        }
        slider(form, "Sounds", 0f, 1f, settings.soundVolume) {
            settings.soundVolume = it; game.audio.soundVolume = it
        }
        slider(form, "Ambience", 0f, 1f, settings.ambienceVolume) {
            settings.ambienceVolume = it; game.audio.ambienceVolume = it
        }

        header(form, "Camera & Controls")
        slider(form, "1st person sensitivity", 0.3f, 2f, settings.firstPersonSensitivity) {
            settings.firstPersonSensitivity = it
        }
        slider(form, "3rd person sensitivity", 0.3f, 2f, settings.thirdPersonSensitivity) {
            settings.thirdPersonSensitivity = it
        }
        slider(form, "Field of view", 60f, 100f, settings.fov) { settings.fov = it }
        toggle(form, "View bobbing", settings.viewBobbing) { settings.viewBobbing = it }
        toggle(form, "Vibration", settings.vibration) { settings.vibration = it }
        toggle(form, "Left-handed layout", settings.leftHanded) { settings.leftHanded = it }

        header(form, "Display & Performance")
        form.add(Label("Preset", UiSkin.skin, "dim")).left()
        form.add(presetCycler()).left().row()
        slider(form, "Render distance", 3f, 8f, settings.renderDistance.toFloat(), step = 1f) {
            settings.renderDistance = it.toInt(); settings.perfPreset = PerfPreset.CUSTOM
        }
        slider(form, "Simulation distance", 2f, 6f, settings.simulationDistance.toFloat(), step = 1f) {
            settings.simulationDistance = it.toInt(); settings.perfPreset = PerfPreset.CUSTOM
        }
        slider(form, "UI scale", 0.7f, 1.5f, settings.uiScale) { settings.uiScale = it }
        slider(form, "Button opacity", 0.2f, 1f, settings.buttonOpacity) { settings.buttonOpacity = it }
        toggle(form, "High-contrast block outline", settings.highContrastOutline) {
            settings.highContrastOutline = it
        }
        toggle(form, "Show FPS", settings.showFps) { settings.showFps = it }

        header(form, "Saving")
        slider(form, "Autosave minutes", 1f, 10f, settings.autosaveMinutes.toFloat(), step = 1f) {
            settings.autosaveMinutes = it.toInt()
        }

        val pane = ScrollPane(form, UiSkin.skin)
        pane.setFadeScrollBars(false)

        val table = Table()
        table.setFillParent(true)
        table.pad(14f * s)
        table.add(Label("Settings", UiSkin.skin, "title")).padBottom(10f * s).row()
        table.add(pane).expand().fill().row()
        table.add(button("Done") { closeAndReturn() }).padTop(10f * s)
        stage.addActor(table)
    }

    private fun closeAndReturn() {
        settings.save()
        game.setScreen(returnTo())
    }

    private fun header(form: Table, text: String) {
        form.add(Label(text, UiSkin.skin)).left().padTop(14f * s).colspan(2).row()
    }

    private fun slider(
        form: Table, label: String, min: Float, max: Float, value: Float,
        step: Float = 0.05f, onChange: (Float) -> Unit,
    ) {
        val valueLabel = Label(fmt(value, step), UiSkin.skin, "dim")
        val slider = Slider(min, max, step, false, UiSkin.skin)
        slider.value = value
        slider.addListener(object : ChangeListener() {
            override fun changed(event: ChangeEvent?, actor: com.badlogic.gdx.scenes.scene2d.Actor?) {
                onChange(slider.value)
                valueLabel.setText(fmt(slider.value, step))
            }
        })
        val row = Table()
        row.add(slider).width(260f * s).padRight(10f * s)
        row.add(valueLabel).width(50f * s)
        form.add(Label(label, UiSkin.skin, "dim")).left().padRight(12f * s)
        form.add(row).left().row()
    }

    private fun fmt(v: Float, step: Float): String =
        if (step >= 1f) v.toInt().toString() else String.format("%.2f", v)

    private fun toggle(form: Table, label: String, value: Boolean, onChange: (Boolean) -> Unit) {
        val box = CheckBox("", UiSkin.skin)
        box.isChecked = value
        box.addListener(object : ClickListener() {
            override fun clicked(event: InputEvent?, x: Float, y: Float) {
                game.audio.play("click", 0.6f)
                onChange(box.isChecked)
            }
        })
        form.add(Label(label, UiSkin.skin, "dim")).left().padRight(12f * s)
        form.add(box).left().row()
    }

    private fun presetCycler(): Table {
        val labels = listOf("Low", "Balanced", "High", "Custom")
        var idx = PerfPreset.entries.indexOf(settings.perfPreset)
        val label = Label(labels[idx], UiSkin.skin)
        val t = Table()
        t.add(button("<") {
            idx = (idx - 1 + labels.size) % labels.size
            settings.applyPreset(PerfPreset.entries[idx])
            label.setText(labels[idx])
        }).padRight(10f * s)
        t.add(label).width(120f * s)
        t.add(button(">") {
            idx = (idx + 1) % labels.size
            settings.applyPreset(PerfPreset.entries[idx])
            label.setText(labels[idx])
        }).padLeft(10f * s)
        return t
    }

    override fun onBack() { closeAndReturn() }
}
