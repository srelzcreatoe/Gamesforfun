package com.cubicworld.ui

import com.badlogic.gdx.graphics.Color
import com.badlogic.gdx.graphics.g2d.TextureRegion
import com.badlogic.gdx.scenes.scene2d.InputEvent
import com.badlogic.gdx.scenes.scene2d.Stage
import com.badlogic.gdx.scenes.scene2d.ui.Dialog
import com.badlogic.gdx.scenes.scene2d.ui.Image
import com.badlogic.gdx.scenes.scene2d.ui.Label
import com.badlogic.gdx.scenes.scene2d.ui.ScrollPane
import com.badlogic.gdx.scenes.scene2d.ui.Stack
import com.badlogic.gdx.scenes.scene2d.ui.Table
import com.badlogic.gdx.scenes.scene2d.ui.TextButton
import com.badlogic.gdx.scenes.scene2d.utils.ClickListener
import com.badlogic.gdx.scenes.scene2d.utils.TextureRegionDrawable
import com.badlogic.gdx.utils.Align
import com.badlogic.gdx.utils.Scaling
import com.badlogic.gdx.utils.viewport.ScreenViewport
import com.cubicworld.audio.AudioManager
import com.cubicworld.inv.CraftingManager
import com.cubicworld.inv.Inventory
import com.cubicworld.inv.RecipeDef
import com.cubicworld.render.TextureAtlasManager
import com.cubicworld.world.GameMode
import com.cubicworld.world.Registries

/**
 * The pack / crafting / container overlay. Item moves use tap-source then
 * tap-destination, which works reliably on small touch screens.
 */
class InventoryUi(
    private val atlas: TextureAtlasManager,
    private val registries: Registries,
    private val inventory: Inventory,
    private val crafting: CraftingManager,
    private val audio: AudioManager,
    private val mode: GameMode,
) {
    val stage = Stage(ScreenViewport())
    var open = false
        private set
    var onClosed: (() -> Unit)? = null

    private var container: Inventory? = null
    private var station: String = "hand"
    private var sourceIndex = -1
    private var sourceInv: Inventory? = null
    private val s: Float get() = UiSkin.s

    private val slotWidgets = ArrayList<Triple<Inventory, Int, Stack>>()
    private val selectionImages = HashMap<Stack, Image>()

    fun openPack() = openInternal(null, "hand")
    fun openStation(stationName: String) = openInternal(null, stationName)
    fun openContainer(containerInv: Inventory) = openInternal(containerInv, "hand")

    private fun openInternal(containerInv: Inventory?, stationName: String) {
        container = containerInv
        station = stationName
        open = true
        sourceIndex = -1
        sourceInv = null
        rebuild()
    }

    fun close() {
        open = false
        stage.clear()
        onClosed?.invoke()
    }

    fun render(delta: Float) {
        if (!open) return
        stage.act(delta)
        stage.draw()
    }

    fun resize(width: Int, height: Int) {
        stage.viewport.update(width, height, true)
        if (open) rebuild()
    }

    fun dispose() = stage.dispose()

    // ---- layout -----------------------------------------------------------

    private fun rebuild() {
        stage.clear()
        slotWidgets.clear()
        selectionImages.clear()
        // a pending tap-to-move selection must never survive a rebuild
        // invisibly (its highlight is gone after clear)
        sourceIndex = -1
        sourceInv = null

        val root = Table()
        root.setFillParent(true)

        val panel = Table()
        panel.background = UiSkin.skin.getDrawable("panel")
        panel.pad(10f * s)

        val title = when {
            container != null -> "Storage Crate"
            station != "hand" -> stationTitle(station)
            else -> "Pack"
        }
        panel.add(Label(title, UiSkin.skin)).padBottom(6f * s).row()

        val content = Table()

        // left: inventory grids
        val invCol = Table()
        container?.let { c ->
            invCol.add(Label("Crate", UiSkin.skin, "dim")).left().row()
            invCol.add(grid(c, 0, c.size, 5)).padBottom(8f * s).row()
        }
        invCol.add(Label("Backpack", UiSkin.skin, "dim")).left().row()
        invCol.add(grid(inventory, 9, 36, 9)).padBottom(6f * s).row()
        invCol.add(Label("Hotbar", UiSkin.skin, "dim")).left().row()
        invCol.add(grid(inventory, 0, 9, 9)).row()

        val trash = TextButton("Discard", UiSkin.skin, "danger")
        trash.addListener(object : ClickListener() {
            override fun clicked(event: InputEvent?, x: Float, y: Float) {
                val inv = sourceInv ?: return
                if (sourceIndex < 0) return
                confirmDiscard(inv, sourceIndex)
            }
        })
        invCol.add(trash).left().padTop(8f * s)
        content.add(invCol).top()

        // right: crafting list (not shown for containers)
        if (container == null) {
            content.add(craftingPanel()).top().padLeft(14f * s)
        }
        panel.add(content).row()

        val closeBtn = TextButton("Close", UiSkin.skin)
        closeBtn.addListener(object : ClickListener() {
            override fun clicked(event: InputEvent?, x: Float, y: Float) {
                audio.play("click", 0.7f)
                close()
            }
        })
        panel.add(closeBtn).padTop(8f * s)

        val scroll = ScrollPane(panel, UiSkin.skin)
        scroll.setFadeScrollBars(false)
        root.add(scroll).maxHeight(stage.height * 0.96f)
        stage.addActor(root)
    }

    private fun stationTitle(name: String) = when (name) {
        "handwork_mat" -> "Handwork Mat"
        "forge_table" -> "Forge Table"
        "kiln" -> "Kiln"
        "cookpot" -> "Cookpot"
        else -> "Crafting"
    }

    private fun grid(inv: Inventory, from: Int, to: Int, cols: Int): Table {
        val t = Table()
        val size = 46f * s
        for (i in from until to) {
            val bg = Image(UiSkin.solid(1, 1, Color(0f, 0f, 0f, 0.35f)))
            val sel = Image(UiSkin.solid(1, 1, Color(0.6f, 0.9f, 1f, 0.35f)))
            sel.isVisible = false
            val icon = Image()
            icon.setScaling(Scaling.fit)
            val count = Label("", UiSkin.skin)
            count.setFontScale(0.75f)
            count.setAlignment(Align.bottomRight)
            val cell = Stack(bg, sel, icon, count)
            selectionImages[cell] = sel
            updateCell(inv, i, icon, count)
            val index = i
            cell.addListener(object : ClickListener() {
                override fun clicked(event: InputEvent?, x: Float, y: Float) {
                    onSlotTapped(inv, index)
                }
            })
            slotWidgets.add(Triple(inv, index, cell))
            t.add(cell).size(size, size).pad(2f * s)
            if ((i - from + 1) % cols == 0) t.row()
        }
        return t
    }

    private fun updateCell(inv: Inventory, index: Int, icon: Image, count: Label) {
        val slot = inv.slots[index]
        if (slot.isEmpty) {
            icon.drawable = null
            count.setText("")
        } else {
            val def = registries.items.byId(slot.itemId)
            icon.drawable = iconDrawable(def.icon)
            count.setText(if (slot.count > 1) slot.count.toString() else "")
        }
    }

    private fun onSlotTapped(inv: Inventory, index: Int) {
        audio.play("click", 0.4f)
        if (sourceIndex < 0) {
            if (!inv.slots[index].isEmpty) {
                sourceInv = inv
                sourceIndex = index
                highlight(inv, index, true)
            }
            return
        }
        val srcInv = sourceInv!!
        val src = srcInv.slots[sourceIndex]
        val dst = inv.slots[index]
        if (srcInv === inv && sourceIndex == index) {
            // second tap on the same slot: split half into an empty slot later; just deselect
            highlight(srcInv, sourceIndex, false)
            sourceIndex = -1; sourceInv = null
            return
        }
        when {
            dst.isEmpty -> { dst.copyFrom(src); src.clear() }
            dst.itemId == src.itemId -> {
                val max = registries.items.byId(dst.itemId).stack
                val move = minOf(src.count, max - dst.count)
                dst.count += move
                src.count -= move
                if (src.count <= 0) src.clear()
            }
            else -> { // swap
                val tmpId = dst.itemId; val tmpC = dst.count; val tmpD = dst.durability
                dst.copyFrom(src)
                src.itemId = tmpId; src.count = tmpC; src.durability = tmpD
            }
        }
        highlight(srcInv, sourceIndex, false)
        sourceIndex = -1; sourceInv = null
        rebuild()
    }

    private fun highlight(inv: Inventory, index: Int, on: Boolean) {
        for ((i, idx, cell) in slotWidgets) {
            if (i === inv && idx == index) selectionImages[cell]?.isVisible = on
        }
    }

    private fun confirmDiscard(inv: Inventory, index: Int) {
        val dialog = object : Dialog("", UiSkin.skin) {
            override fun result(obj: Any?) {
                if (obj == true) {
                    inv.slots[index].clear()
                    sourceIndex = -1; sourceInv = null
                    rebuild()
                }
            }
        }
        dialog.text("Discard this stack forever?")
        dialog.button("Cancel", false)
        dialog.button("Discard", true)
        dialog.show(stage)
    }

    // ---- crafting ---------------------------------------------------------

    private fun craftingPanel(): Table {
        val t = Table()
        t.add(Label(if (station == "hand") "Hand crafting" else "Recipes", UiSkin.skin, "dim"))
            .left().padBottom(4f * s).row()
        val list = Table()
        val visible = crafting.visibleRecipes(station, mode == GameMode.CREATIVE)
        if (visible.isEmpty()) {
            list.add(Label("Nothing discovered yet.\nGather materials to reveal recipes.", UiSkin.skin, "dim"))
                .pad(10f * s)
        }
        for (r in visible) {
            list.add(recipeRow(r)).fillX().padBottom(4f * s).row()
        }
        val pane = ScrollPane(list, UiSkin.skin)
        pane.setFadeScrollBars(false)
        t.add(pane).width(300f * s).maxHeight(340f * s)
        return t
    }

    private fun recipeRow(r: RecipeDef): Table {
        val row = Table()
        row.background = UiSkin.skin.getDrawable("panel-light")
        row.pad(5f * s)
        val out = registries.items.byId(r.outputId)
        val icon = Image(iconDrawable(out.icon))
        icon.setScaling(Scaling.fit)
        row.add(icon).size(30f * s).padRight(8f * s)

        val info = Table()
        info.add(Label("${out.displayName} x${r.outputCount}", UiSkin.skin)).left().row()
        val needs = r.inputs.joinToString(", ") { inp ->
            val have = inventory.countOf(inp.itemId)
            "${registries.items.byId(inp.itemId).displayName} $have/${inp.count}"
        }
        info.add(Label(needs, UiSkin.skin, "dim")).left()
        row.add(info).expandX().left()

        val can = crafting.canCraft(r, inventory)
        val craftBtn = TextButton("Craft", UiSkin.skin)
        craftBtn.isDisabled = !can
        craftBtn.color.a = if (can) 1f else 0.4f
        craftBtn.addListener(object : ClickListener() {
            override fun clicked(event: InputEvent?, x: Float, y: Float) {
                if (crafting.craft(r, inventory)) {
                    audio.play("craft", 0.9f)
                    rebuild()
                }
            }
        })
        row.add(craftBtn)
        return row
    }

    private val iconCache = HashMap<Int, TextureRegionDrawable>()

    private fun iconDrawable(tileIdx: Int): TextureRegionDrawable = iconCache.getOrPut(tileIdx) {
        val uv = FloatArray(4)
        atlas.uv(tileIdx, uv)
        TextureRegionDrawable(TextureRegion(atlas.texture, uv[0], uv[1], uv[2], uv[3]))
    }
}
