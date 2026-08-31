package com.cubicworld.desktop

import com.badlogic.gdx.backends.lwjgl3.Lwjgl3Application
import com.badlogic.gdx.backends.lwjgl3.Lwjgl3ApplicationConfiguration
import com.cubicworld.CubicWorldGame

fun main() {
    val config = Lwjgl3ApplicationConfiguration().apply {
        setTitle("Cubic World")
        setWindowedMode(1280, 720)
        useVsync(true)
        setForegroundFPS(60)
    }
    Lwjgl3Application(CubicWorldGame(), config)
}
