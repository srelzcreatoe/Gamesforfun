package com.cubicworld.mobile

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import com.badlogic.gdx.backends.android.AndroidApplication
import com.badlogic.gdx.backends.android.AndroidApplicationConfiguration
import com.cubicworld.CubicWorldGame

class AndroidLauncher : AndroidApplication() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val config = AndroidApplicationConfiguration().apply {
            useImmersiveMode = true
            useAccelerometer = false
            useCompass = false
            useGyroscope = false
            numSamples = 0
            r = 8; g = 8; b = 8; a = 8
            depth = 24
        }
        // Render into the display cutout area so the world fills the whole screen;
        // the HUD applies its own safe-area insets.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        initialize(CubicWorldGame(), config)
    }
}
