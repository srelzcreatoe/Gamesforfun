package com.cubicworld.ui

import com.badlogic.gdx.Gdx
import com.badlogic.gdx.graphics.Color
import com.badlogic.gdx.graphics.Pixmap
import com.badlogic.gdx.graphics.Texture
import com.badlogic.gdx.graphics.g2d.BitmapFont
import com.badlogic.gdx.graphics.g2d.NinePatch
import com.badlogic.gdx.scenes.scene2d.ui.CheckBox
import com.badlogic.gdx.scenes.scene2d.ui.Label
import com.badlogic.gdx.scenes.scene2d.ui.ScrollPane
import com.badlogic.gdx.scenes.scene2d.ui.Skin
import com.badlogic.gdx.scenes.scene2d.ui.Slider
import com.badlogic.gdx.scenes.scene2d.ui.TextButton
import com.badlogic.gdx.scenes.scene2d.ui.Window
import com.badlogic.gdx.scenes.scene2d.utils.NinePatchDrawable
import com.badlogic.gdx.scenes.scene2d.utils.TextureRegionDrawable

/**
 * Programmatically built UI skin: original rounded panels and buttons drawn
 * into pixmaps at startup — no external art dependencies.
 */
object UiSkin {

    lateinit var skin: Skin
        private set
    private val textures = ArrayList<Texture>()

    /** density scale: 1.0 at 480px-tall screens */
    val s: Float get() = (Gdx.graphics.height / 480f).coerceIn(0.8f, 3f)

    fun build(): Skin {
        skin = Skin()

        val font = BitmapFont()
        font.data.setScale((s * 1.05f).coerceAtLeast(1f))
        font.region.texture.setFilter(Texture.TextureFilter.Linear, Texture.TextureFilter.Linear)
        val titleFont = BitmapFont()
        titleFont.data.setScale((s * 2.1f).coerceAtLeast(1.6f))
        titleFont.region.texture.setFilter(Texture.TextureFilter.Linear, Texture.TextureFilter.Linear)
        skin.add("default", font)
        skin.add("title", titleFont)

        val panel = ninePatch(24, 12, Color(0.09f, 0.11f, 0.16f, 0.92f), Color(0.30f, 0.38f, 0.52f, 1f))
        val panelLight = ninePatch(24, 12, Color(0.16f, 0.20f, 0.28f, 0.95f), Color(0.38f, 0.48f, 0.64f, 1f))
        val buttonUp = ninePatch(20, 9, Color(0.20f, 0.30f, 0.44f, 0.95f), Color(0.45f, 0.62f, 0.85f, 1f))
        val buttonDown = ninePatch(20, 9, Color(0.32f, 0.48f, 0.66f, 1f), Color(0.60f, 0.80f, 1f, 1f))
        val buttonDanger = ninePatch(20, 9, Color(0.45f, 0.16f, 0.14f, 0.95f), Color(0.85f, 0.40f, 0.36f, 1f))
        skin.add("panel", panel, com.badlogic.gdx.scenes.scene2d.utils.Drawable::class.java)
        skin.add("panel-light", panelLight, com.badlogic.gdx.scenes.scene2d.utils.Drawable::class.java)

        skin.add("default", Label.LabelStyle(font, Color.WHITE))
        skin.add("title", Label.LabelStyle(titleFont, Color(0.85f, 0.95f, 1f, 1f)))
        skin.add("dim", Label.LabelStyle(font, Color(0.7f, 0.75f, 0.82f, 1f)))

        skin.add("default", TextButton.TextButtonStyle().apply {
            up = buttonUp; down = buttonDown; this.font = font
            fontColor = Color.WHITE
        })
        skin.add("danger", TextButton.TextButtonStyle().apply {
            up = buttonDanger; down = buttonDown; this.font = font
            fontColor = Color.WHITE
        })

        val track = solid(8, 8, Color(0.25f, 0.28f, 0.36f, 1f))
        val knob = solid(18, 26, Color(0.55f, 0.72f, 0.95f, 1f))
        skin.add("default-horizontal", Slider.SliderStyle().apply {
            background = track
            this.knob = knob
        })

        val boxOff = solid(24, 24, Color(0.2f, 0.24f, 0.32f, 1f))
        val boxOn = solid(24, 24, Color(0.45f, 0.75f, 0.5f, 1f))
        skin.add("default", CheckBox.CheckBoxStyle().apply {
            checkboxOff = boxOff; checkboxOn = boxOn; this.font = font
            fontColor = Color.WHITE
        })

        skin.add("default", ScrollPane.ScrollPaneStyle().apply {
            vScrollKnob = solid(6, 24, Color(0.5f, 0.6f, 0.75f, 0.7f))
        })

        skin.add("default", Window.WindowStyle(font, Color.WHITE, panel))
        return skin
    }

    private fun ninePatch(size: Int, radius: Int, fill: Color, border: Color): NinePatchDrawable {
        val pm = Pixmap(size * 2, size * 2, Pixmap.Format.RGBA8888)
        pm.setColor(0f, 0f, 0f, 0f)
        pm.fill()
        // rounded rectangle: center rect + edge rects + corner circles
        pm.setColor(border)
        fillRounded(pm, 0, 0, size * 2, size * 2, radius)
        pm.setColor(fill)
        fillRounded(pm, 2, 2, size * 2 - 4, size * 2 - 4, radius - 1)
        val tex = Texture(pm)
        tex.setFilter(Texture.TextureFilter.Linear, Texture.TextureFilter.Linear)
        textures.add(tex)
        pm.dispose()
        val np = NinePatch(tex, size - 2, size - 2, size - 2, size - 2)
        return NinePatchDrawable(np)
    }

    private fun fillRounded(pm: Pixmap, x: Int, y: Int, w: Int, h: Int, r: Int) {
        pm.fillRectangle(x + r, y, w - 2 * r, h)
        pm.fillRectangle(x, y + r, w, h - 2 * r)
        pm.fillCircle(x + r, y + r, r)
        pm.fillCircle(x + w - r - 1, y + r, r)
        pm.fillCircle(x + r, y + h - r - 1, r)
        pm.fillCircle(x + w - r - 1, y + h - r - 1, r)
    }

    fun solid(w: Int, h: Int, color: Color): TextureRegionDrawable {
        val pm = Pixmap(w, h, Pixmap.Format.RGBA8888)
        pm.setColor(color)
        pm.fill()
        val tex = Texture(pm)
        textures.add(tex)
        pm.dispose()
        return TextureRegionDrawable(com.badlogic.gdx.graphics.g2d.TextureRegion(tex))
    }

    fun dispose() {
        if (this::skin.isInitialized) skin.dispose()
        for (t in textures) t.dispose()
        textures.clear()
    }
}
