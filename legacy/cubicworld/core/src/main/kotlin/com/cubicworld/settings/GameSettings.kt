package com.cubicworld.settings

import com.badlogic.gdx.Gdx
import com.badlogic.gdx.Preferences

enum class PerfPreset { LOW, BALANCED, HIGH, CUSTOM }

/**
 * Player-tunable options persisted via libGDX Preferences.
 * Everything has a sensible mobile default.
 */
class GameSettings {

    private lateinit var prefs: Preferences

    var musicVolume = 0.7f
    var soundVolume = 1.0f
    var ambienceVolume = 0.8f

    var firstPersonSensitivity = 1.0f
    var thirdPersonSensitivity = 0.9f
    var fov = 75f
    var viewBobbing = true
    var vibration = true

    var renderDistance = 5
    var simulationDistance = 3
    var perfPreset = PerfPreset.BALANCED

    var uiScale = 1.0f
    var buttonOpacity = 0.65f
    var leftHanded = false
    var highContrastOutline = false
    var showFps = false

    var autosaveMinutes = 2
    var tutorialDone = false

    fun load() {
        prefs = Gdx.app.getPreferences("cubicworld_settings")
        musicVolume = prefs.getFloat("musicVolume", musicVolume)
        soundVolume = prefs.getFloat("soundVolume", soundVolume)
        ambienceVolume = prefs.getFloat("ambienceVolume", ambienceVolume)
        firstPersonSensitivity = prefs.getFloat("fpSens", firstPersonSensitivity)
        thirdPersonSensitivity = prefs.getFloat("tpSens", thirdPersonSensitivity)
        fov = prefs.getFloat("fov", fov)
        viewBobbing = prefs.getBoolean("viewBobbing", viewBobbing)
        vibration = prefs.getBoolean("vibration", vibration)
        renderDistance = prefs.getInteger("renderDistance", renderDistance).coerceIn(3, 8)
        simulationDistance = prefs.getInteger("simDistance", simulationDistance).coerceIn(2, 6)
        perfPreset = runCatching { PerfPreset.valueOf(prefs.getString("perfPreset", perfPreset.name)) }
            .getOrDefault(PerfPreset.BALANCED)
        uiScale = prefs.getFloat("uiScale", uiScale).coerceIn(0.7f, 1.5f)
        buttonOpacity = prefs.getFloat("buttonOpacity", buttonOpacity).coerceIn(0.2f, 1f)
        leftHanded = prefs.getBoolean("leftHanded", leftHanded)
        highContrastOutline = prefs.getBoolean("highContrast", highContrastOutline)
        showFps = prefs.getBoolean("showFps", showFps)
        autosaveMinutes = prefs.getInteger("autosaveMinutes", autosaveMinutes).coerceIn(1, 10)
        tutorialDone = prefs.getBoolean("tutorialDone", tutorialDone)
    }

    fun save() {
        prefs.putFloat("musicVolume", musicVolume)
        prefs.putFloat("soundVolume", soundVolume)
        prefs.putFloat("ambienceVolume", ambienceVolume)
        prefs.putFloat("fpSens", firstPersonSensitivity)
        prefs.putFloat("tpSens", thirdPersonSensitivity)
        prefs.putFloat("fov", fov)
        prefs.putBoolean("viewBobbing", viewBobbing)
        prefs.putBoolean("vibration", vibration)
        prefs.putInteger("renderDistance", renderDistance)
        prefs.putInteger("simDistance", simulationDistance)
        prefs.putString("perfPreset", perfPreset.name)
        prefs.putFloat("uiScale", uiScale)
        prefs.putFloat("buttonOpacity", buttonOpacity)
        prefs.putBoolean("leftHanded", leftHanded)
        prefs.putBoolean("highContrast", highContrastOutline)
        prefs.putBoolean("showFps", showFps)
        prefs.putInteger("autosaveMinutes", autosaveMinutes)
        prefs.putBoolean("tutorialDone", tutorialDone)
        prefs.flush()
    }

    fun applyPreset(preset: PerfPreset) {
        perfPreset = preset
        when (preset) {
            PerfPreset.LOW -> { renderDistance = 3; simulationDistance = 2 }
            PerfPreset.BALANCED -> { renderDistance = 5; simulationDistance = 3 }
            PerfPreset.HIGH -> { renderDistance = 7; simulationDistance = 4 }
            PerfPreset.CUSTOM -> {}
        }
    }
}
