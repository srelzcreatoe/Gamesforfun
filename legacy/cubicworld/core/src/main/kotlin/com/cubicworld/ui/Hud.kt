package com.cubicworld.ui

import com.badlogic.gdx.Gdx
import com.badlogic.gdx.graphics.Color
import com.badlogic.gdx.graphics.Pixmap
import com.badlogic.gdx.graphics.Texture
import com.badlogic.gdx.graphics.g2d.TextureRegion
import com.badlogic.gdx.scenes.scene2d.Actor
import com.badlogic.gdx.scenes.scene2d.InputEvent
import com.badlogic.gdx.scenes.scene2d.Stage
import com.badlogic.gdx.scenes.scene2d.Touchable
import com.badlogic.gdx.scenes.scene2d.ui.Image
import com.badlogic.gdx.scenes.scene2d.ui.Label
import com.badlogic.gdx.scenes.scene2d.ui.Stack
import com.badlogic.gdx.scenes.scene2d.ui.Table
import com.badlogic.gdx.scenes.scene2d.ui.Touchpad
import com.badlogic.gdx.scenes.scene2d.InputListener
import com.badlogic.gdx.scenes.scene2d.utils.ClickListener
import com.badlogic.gdx.scenes.scene2d.utils.TextureRegionDrawable
import com.badlogic.gdx.utils.viewport.ScreenViewport
import com.cubicworld.inv.Inventory
import com.cubicworld.render.TextureAtlasManager
import com.cubicworld.settings.GameSettings

/** Events the HUD raises toward the game layer. */
interface HudListener {
    fun onTapWorld()
    fun onJumpChanged(pressed: Boolean)
    fun onSneakToggled(on: Boolean)
    fun onSprintToggled(on: Boolean)
    fun onCameraToggle()
    fun onOpenInventory()
    fun onPause()
    fun onHotbarSelected(slot: Int)
}

/**
 * Touch controls: left joystick, right look/tap/hold region, action buttons,
 * hotbar with health/hunger bars. Respects handedness and button opacity.
 */
class Hud(
    private val atlas: TextureAtlasManager,
    private val settings: GameSettings,
    private val inventory: Inventory,
    private val listener: HudListener,
) {
    val stage = Stage(ScreenViewport())
    private val textures = ArrayList<Texture>()

    lateinit var joystick: Touchpad
        private set

    // look state consumed by the game each frame
    var lookDeltaX = 0f
    var lookDeltaY = 0f
    var breakHeld = false
        private set

    private var lookPointer = -1
    private var lookStartX = 0f
    private var lookStartY = 0f
    private var lookMoved = false
    private var lookDownTime = 0L

    private val hotbarCells = ArrayList<HotbarCell>()
    private val heartIcons = ArrayList<Image>()
    private val foodIcons = ArrayList<Image>()
    private var heartFull: TextureRegionDrawable? = null
    private var heartHalf: TextureRegionDrawable? = null
    private var heartEmpty: TextureRegionDrawable? = null
    private var foodFull: TextureRegionDrawable? = null
    private var foodHalf: TextureRegionDrawable? = null
    private var foodEmpty: TextureRegionDrawable? = null
    private lateinit var airBar: Image
    private lateinit var savingLabel: Label
    private lateinit var fpsLabel: Label
    private lateinit var hintLabel: Label
    private var savingTimer = 0f
    private var hintTimer = 0f
    private var sneakOn = false
    private var sprintOn = false

    private val s: Float get() = UiSkin.s

    private class HotbarCell(val cell: Stack, val icon: Image, val count: Label, val selection: Image)

    fun build() {
        // dialogs (death/pause/confirm) must survive rebuilds — Android fires
        // resize when returning from background, which lands here
        val dialogs = stage.actors.items.filterIsInstance<com.badlogic.gdx.scenes.scene2d.ui.Dialog>()
        stage.clear()
        hotbarCells.clear()
        // drop GPU textures from the previous build; rebuilt actors get fresh ones
        for (t in textures) t.dispose()
        textures.clear()

        // ---- look region: whole screen behind everything else
        val lookRegion = object : Actor() {}
        lookRegion.setSize(stage.width, stage.height)
        lookRegion.touchable = Touchable.enabled
        lookRegion.addListener(object : InputListener() {
            override fun touchDown(event: InputEvent, x: Float, y: Float, pointer: Int, button: Int): Boolean {
                // ignore the joystick side of the screen
                val joyLeft = !settings.leftHanded
                val onJoySide = if (joyLeft) x < stage.width * 0.35f else x > stage.width * 0.65f
                if (onJoySide || lookPointer != -1) return false
                lookPointer = pointer
                lookStartX = x; lookStartY = y
                lookMoved = false
                lookDownTime = System.currentTimeMillis()
                return true
            }

            override fun touchDragged(event: InputEvent, x: Float, y: Float, pointer: Int) {
                if (pointer != lookPointer) return
                val dx = x - lookStartX
                val dy = y - lookStartY
                lookDeltaX += dx
                lookDeltaY += dy
                lookStartX = x; lookStartY = y
                if (kotlin.math.abs(dx) + kotlin.math.abs(dy) > 6f * s) lookMoved = true
            }

            override fun touchUp(event: InputEvent, x: Float, y: Float, pointer: Int, button: Int) {
                if (pointer != lookPointer) return
                lookPointer = -1
                val held = System.currentTimeMillis() - lookDownTime
                breakHeld = false
                if (!lookMoved && held < 260) listener.onTapWorld()
            }
        })
        stage.addActor(lookRegion)

        // ---- joystick
        val joyBg = circleDrawable(64, Color(1f, 1f, 1f, 0.14f), Color(1f, 1f, 1f, 0.35f))
        val joyKnob = circleDrawable(26, Color(1f, 1f, 1f, 0.5f), Color(1f, 1f, 1f, 0.7f))
        joystick = Touchpad(6f, Touchpad.TouchpadStyle(joyBg, joyKnob))
        val joySize = 150f * s
        joystick.setSize(joySize, joySize)
        positionJoystick()
        stage.addActor(joystick)

        // ---- action buttons
        val op = settings.buttonOpacity
        val jump = iconButton("icon_jump", op)
        jump.addListener(object : InputListener() {
            override fun touchDown(event: InputEvent, x: Float, y: Float, pointer: Int, button: Int): Boolean {
                listener.onJumpChanged(true); return true
            }
            override fun touchUp(event: InputEvent, x: Float, y: Float, pointer: Int, button: Int) {
                listener.onJumpChanged(false)
            }
        })
        val sneak = iconButton("icon_sneak", op)
        sneak.addListener(object : ClickListener() {
            override fun clicked(event: InputEvent?, x: Float, y: Float) {
                sneakOn = !sneakOn
                sneak.color.a = if (sneakOn) 1f else op
                listener.onSneakToggled(sneakOn)
            }
        })
        val sprint = iconButton("icon_sprint", op)
        sprint.addListener(object : ClickListener() {
            override fun clicked(event: InputEvent?, x: Float, y: Float) {
                sprintOn = !sprintOn
                sprint.color.a = if (sprintOn) 1f else op
                listener.onSprintToggled(sprintOn)
            }
        })
        // stacked column above jump so nothing collides with the hotbar on
        // narrow screens
        val bSize = 64f * s
        val bx = if (settings.leftHanded) 24f * s else stage.width - bSize - 24f * s
        jump.setBounds(bx, 34f * s, bSize, bSize)
        sneak.setBounds(bx + bSize * 0.075f, 34f * s + bSize + 10f * s, bSize * 0.85f, bSize * 0.85f)
        sprint.setBounds(bx + bSize * 0.075f, 34f * s + bSize + 10f * s + bSize * 0.95f, bSize * 0.85f, bSize * 0.85f)
        stage.addActor(jump); stage.addActor(sneak); stage.addActor(sprint)

        // ---- top bar: pause, camera
        val pause = iconButton("icon_pause", op)
        pause.addListener(object : ClickListener() {
            override fun clicked(event: InputEvent?, x: Float, y: Float) { listener.onPause() }
        })
        val cam = iconButton("icon_camera", op)
        cam.addListener(object : ClickListener() {
            override fun clicked(event: InputEvent?, x: Float, y: Float) { listener.onCameraToggle() }
        })
        val tSize = 52f * s
        pause.setBounds(stage.width - tSize - 14f * s, stage.height - tSize - 14f * s, tSize, tSize)
        cam.setBounds(stage.width - 2 * tSize - 26f * s, stage.height - tSize - 14f * s, tSize, tSize)
        stage.addActor(pause); stage.addActor(cam)

        // ---- hotbar + bag button + bars
        buildHotbar(op)

        savingLabel = Label("Saving...", UiSkin.skin, "dim")
        savingLabel.setPosition(14f * s, stage.height - 30f * s)
        savingLabel.color.a = 0f
        stage.addActor(savingLabel)

        fpsLabel = Label("", UiSkin.skin, "dim")
        fpsLabel.setPosition(14f * s, stage.height - 54f * s)
        stage.addActor(fpsLabel)

        hintLabel = Label("", UiSkin.skin)
        hintLabel.setPosition(0f, stage.height * 0.68f)
        hintLabel.width = stage.width
        hintLabel.setAlignment(com.badlogic.gdx.utils.Align.center)
        stage.addActor(hintLabel)

        for (d in dialogs) {
            stage.addActor(d)
            d.setPosition((stage.width - d.width) / 2f, (stage.height - d.height) / 2f)
        }
    }

    /**
     * Forget all active touches. Must be called whenever the input processor
     * is switched away (inventory overlay, dialogs), or the joystick and the
     * hold-to-break state would stay stuck on their last values.
     */
    fun cancelTouches() {
        stage.cancelTouchFocus()
        lookPointer = -1
        breakHeld = false
        lookDeltaX = 0f
        lookDeltaY = 0f
    }

    private fun positionJoystick() {
        val joySize = joystick.width
        val jx = if (settings.leftHanded) stage.width - joySize - 30f * s else 30f * s
        joystick.setPosition(jx, 26f * s)
    }

    private fun buildHotbar(op: Float) {
        val slotSize = 52f * s
        val bar = Table()
        bar.background = UiSkin.skin.getDrawable("panel")
        bar.pad(4f * s)
        for (i in 0 until 9) {
            val bg = Image(UiSkin.solid(1, 1, Color(0f, 0f, 0f, 0.35f)))
            val sel = Image(UiSkin.solid(1, 1, Color(1f, 1f, 1f, 0.28f)))
            sel.isVisible = i == inventory.selectedSlot
            val icon = Image()
            icon.setScaling(com.badlogic.gdx.utils.Scaling.fit)
            val count = Label("", UiSkin.skin)
            count.setFontScale(0.8f)
            count.setAlignment(com.badlogic.gdx.utils.Align.bottomRight)
            val cell = Stack(bg, sel, icon, count)
            val slot = i
            cell.addListener(object : ClickListener() {
                override fun clicked(event: InputEvent?, x: Float, y: Float) {
                    listener.onHotbarSelected(slot)
                }
            })
            hotbarCells.add(HotbarCell(cell, icon, count, sel))
            bar.add(cell).size(slotSize, slotSize).pad(2f * s)
        }
        val bag = iconButton("icon_bag", op)
        bag.addListener(object : ClickListener() {
            override fun clicked(event: InputEvent?, x: Float, y: Float) { listener.onOpenInventory() }
        })

        val barW = 9 * (slotSize + 4f * s) + 8f * s
        bar.pack()
        bar.setPosition((stage.width - bar.width) / 2f, 8f * s)
        stage.addActor(bar)
        bag.setBounds(bar.x + bar.width + 10f * s, 8f * s, slotSize, slotSize)
        stage.addActor(bag)

        // hearts (left) and food (right) icon rows above the hotbar
        heartFull = statusIcon(true, 2)
        heartHalf = statusIcon(true, 1)
        heartEmpty = statusIcon(true, 0)
        foodFull = statusIcon(false, 2)
        foodHalf = statusIcon(false, 1)
        foodEmpty = statusIcon(false, 0)
        heartIcons.clear()
        foodIcons.clear()
        val iconSize = 17f * s
        val byPos = 8f * s + bar.height + 5f * s
        for (i in 0 until 10) {
            val heart = Image(heartFull)
            heart.setBounds(bar.x + 4f * s + i * (iconSize + 1f * s), byPos, iconSize, iconSize)
            heartIcons.add(heart)
            stage.addActor(heart)
            val food = Image(foodFull)
            // food fills right-to-left so the row visually empties toward the centre
            food.setBounds(bar.x + bar.width - 4f * s - (i + 1) * (iconSize + 1f * s), byPos, iconSize, iconSize)
            foodIcons.add(food)
            stage.addActor(food)
        }
        airBar = Image(UiSkin.solid(1, 1, Color(0.3f, 0.65f, 0.95f, 0.95f)))
        airBar.setBounds(bar.x + (bar.width - 150f * s) / 2f, byPos + iconSize + 3f * s, 150f * s, 6f * s)
        airBar.isVisible = false
        stage.addActor(airBar)
    }

    /**
     * Original status glyphs drawn in code: a two-lobe heart and a round
     * sunfruit with a leaf. fill: 2 = full, 1 = left half, 0 = empty outline.
     */
    private fun statusIcon(heart: Boolean, fill: Int): TextureRegionDrawable {
        val n = 14
        val pm = Pixmap(n, n, Pixmap.Format.RGBA8888)
        if (heart) {
            pm.setColor(0.20f, 0.05f, 0.08f, 0.95f)              // dark outline
            pm.fillCircle(4, 4, 3)
            pm.fillCircle(9, 4, 3)
            pm.fillTriangle(0, 5, 13, 5, 6, 13)
            val c = if (fill > 0) Color(0.86f, 0.22f, 0.28f, 1f) else Color(0.25f, 0.22f, 0.24f, 0.9f)
            pm.setColor(c)
            pm.fillCircle(4, 4, 2)
            pm.fillCircle(9, 4, 2)
            pm.fillTriangle(2, 5, 11, 5, 6, 11)
        } else {
            pm.setColor(0.22f, 0.12f, 0.04f, 0.95f)
            pm.fillCircle(7, 8, 5)
            val c = if (fill > 0) Color(0.92f, 0.60f, 0.18f, 1f) else Color(0.26f, 0.23f, 0.20f, 0.9f)
            pm.setColor(c)
            pm.fillCircle(7, 8, 4)
            pm.setColor(0.30f, 0.55f, 0.25f, 1f)
            pm.fillRectangle(7, 0, 2, 3)                          // leaf stem
        }
        if (fill == 1) {
            // half state: right side reads as empty
            pm.setColor(0.25f, 0.22f, 0.22f, 0.9f)
            pm.blending = Pixmap.Blending.None
            for (x in 7 until n) for (y in 0 until n) {
                val a = (pm.getPixel(x, y) and 0xFF)
                if (a > 0) pm.drawPixel(x, y, (0x403A3AE0.toInt()))
            }
            pm.blending = Pixmap.Blending.SourceOver
        }
        val tex = Texture(pm)
        tex.setFilter(Texture.TextureFilter.Linear, Texture.TextureFilter.Linear)
        textures.add(tex)
        pm.dispose()
        return TextureRegionDrawable(TextureRegion(tex))
    }

    /** Poll long-press state; the game calls this every frame. */
    fun pollBreakHeld(): Boolean {
        if (com.badlogic.gdx.Gdx.input.inputProcessor !== stage) {
            // another overlay owns input: any remembered touch is stale
            if (lookPointer != -1 || breakHeld) cancelTouches()
            return false
        }
        if (lookPointer != -1 && !breakHeld) {
            val held = System.currentTimeMillis() - lookDownTime
            if (held >= 280 && !lookMoved) breakHeld = true
        }
        if (lookPointer == -1) breakHeld = false
        return breakHeld
    }

    fun update(delta: Float, health: Int, hunger: Int, air: Int, fps: Int) {
        for ((i, cell) in hotbarCells.withIndex()) {
            val slot = inventory.slots[i]
            cell.selection.isVisible = i == inventory.selectedSlot
            if (slot.isEmpty) {
                cell.icon.drawable = null
                cell.count.setText("")
            } else {
                val def = inventory.items.byId(slot.itemId)
                cell.icon.drawable = iconDrawable(def.icon)
                cell.count.setText(if (slot.count > 1) slot.count.toString() else "")
            }
        }
        for (i in 0 until 10) {
            val hv = health - i * 2
            heartIcons[i].drawable = if (hv >= 2) heartFull else if (hv == 1) heartHalf else heartEmpty
            val fv = hunger - i * 2
            foodIcons[i].drawable = if (fv >= 2) foodFull else if (fv == 1) foodHalf else foodEmpty
        }
        airBar.isVisible = air < 10
        airBar.width = 150f * s * (air / 10f)

        if (savingTimer > 0f) {
            savingTimer -= delta
            savingLabel.color.a = savingTimer.coerceIn(0f, 1f)
        }
        if (hintTimer > 0f) {
            hintTimer -= delta
            if (hintTimer <= 0f) hintLabel.setText("")
        }
        fpsLabel.setText(if (settings.showFps) "$fps fps" else "")

        stage.act(delta)
    }

    fun showSaving() { savingTimer = 2f }

    fun showHint(text: String, seconds: Float = 5f) {
        hintLabel.setText(text)
        hintTimer = seconds
    }

    fun draw() = stage.draw()

    fun resize(width: Int, height: Int) {
        stage.viewport.update(width, height, true)
        build()
    }

    // ---- drawable helpers -------------------------------------------------

    private val iconCache = HashMap<Int, TextureRegionDrawable>()

    private fun iconDrawable(tileIdx: Int): TextureRegionDrawable = iconCache.getOrPut(tileIdx) {
        val uv = FloatArray(4)
        atlas.uv(tileIdx, uv)
        TextureRegionDrawable(TextureRegion(atlas.texture, uv[0], uv[1], uv[2], uv[3]))
    }

    private fun circleDrawable(radius: Int, fill: Color, border: Color): TextureRegionDrawable {
        val d = radius * 2
        val pm = Pixmap(d, d, Pixmap.Format.RGBA8888)
        pm.setColor(border)
        pm.fillCircle(radius, radius, radius - 1)
        pm.setColor(fill)
        pm.fillCircle(radius, radius, radius - 3)
        val tex = Texture(pm)
        tex.setFilter(Texture.TextureFilter.Linear, Texture.TextureFilter.Linear)
        textures.add(tex)
        pm.dispose()
        return TextureRegionDrawable(TextureRegion(tex))
    }

    /** Simple glyph-drawn icon buttons (original icons drawn in code). */
    private fun iconButton(kind: String, opacity: Float): Image {
        val size = 64
        val pm = Pixmap(size, size, Pixmap.Format.RGBA8888)
        pm.setColor(0.1f, 0.12f, 0.18f, 0.85f)
        pm.fillCircle(size / 2, size / 2, size / 2 - 1)
        pm.setColor(0.75f, 0.85f, 1f, 1f)
        when (kind) {
            "icon_jump" -> {  // up arrow
                for (i in 0 until 12) pm.drawLine(20 + i, 34 - i, 44 - i, 34 - i)
                pm.fillRectangle(28, 32, 8, 14)
            }
            "icon_sneak" -> { // down arrow
                for (i in 0 until 12) pm.drawLine(20 + i, 30 + i, 44 - i, 30 + i)
                pm.fillRectangle(28, 18, 8, 14)
            }
            "icon_sprint" -> { // double chevron
                for (i in 0 until 3) {
                    pm.drawLine(20, 20 + i, 34, 32 + i); pm.drawLine(34, 32 + i, 20, 44 + i)
                    pm.drawLine(32, 20 + i, 46, 32 + i); pm.drawLine(46, 32 + i, 32, 44 + i)
                }
            }
            "icon_pause" -> {
                pm.fillRectangle(22, 20, 7, 24)
                pm.fillRectangle(35, 20, 7, 24)
            }
            "icon_camera" -> { // eye
                pm.fillCircle(size / 2, size / 2, 7)
                pm.setColor(0.1f, 0.12f, 0.18f, 1f)
                pm.fillCircle(size / 2, size / 2, 3)
            }
            "icon_bag" -> {
                pm.fillRectangle(20, 18, 24, 20)
                pm.fillRectangle(26, 38, 12, 6)
            }
        }
        val tex = Texture(pm)
        tex.setFilter(Texture.TextureFilter.Linear, Texture.TextureFilter.Linear)
        textures.add(tex)
        pm.dispose()
        val img = Image(TextureRegionDrawable(TextureRegion(tex)))
        img.color.a = opacity
        return img
    }

    fun dispose() {
        stage.dispose()
        for (t in textures) t.dispose()
        textures.clear()
    }
}
