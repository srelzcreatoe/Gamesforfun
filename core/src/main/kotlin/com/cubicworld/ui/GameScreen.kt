package com.cubicworld.ui

import com.badlogic.gdx.Gdx
import com.badlogic.gdx.Input
import com.badlogic.gdx.ScreenAdapter
import com.badlogic.gdx.graphics.GL20
import com.badlogic.gdx.graphics.PerspectiveCamera
import com.badlogic.gdx.graphics.glutils.ShapeRenderer
import com.badlogic.gdx.math.MathUtils
import com.badlogic.gdx.math.Vector3
import com.badlogic.gdx.scenes.scene2d.ui.Dialog
import com.badlogic.gdx.scenes.scene2d.ui.Label
import com.cubicworld.CubicWorldGame
import com.cubicworld.entity.Creature
import com.cubicworld.entity.EntityManager
import com.cubicworld.inv.ContainerStore
import com.cubicworld.inv.CraftingManager
import com.cubicworld.inv.Inventory
import com.cubicworld.inv.ItemKind
import com.cubicworld.player.Interaction
import com.cubicworld.player.PlayerController
import com.cubicworld.player.PlayerStats
import com.cubicworld.render.BlockOutlineRenderer
import com.cubicworld.render.ChunkRenderer
import com.cubicworld.render.EntityRenderer
import com.cubicworld.render.SkyRenderer
import com.cubicworld.world.ChunkManager
import com.cubicworld.world.ChunkState
import com.cubicworld.world.GameMode
import com.cubicworld.world.PlayerSave
import com.cubicworld.world.SaveManager
import com.cubicworld.world.Weather
import com.cubicworld.world.World
import java.io.File

private enum class CameraMode { FIRST, THIRD_BACK, THIRD_FRONT }
private enum class PlayState { LOADING, PLAYING, DEAD }

/**
 * The in-world screen: wires world simulation, rendering, touch input,
 * survival stats, UI overlays and persistence together.
 */
class GameScreen(
    private val game: CubicWorldGame,
    private val folder: String,
) : ScreenAdapter(), HudListener {

    private val save = SaveManager(game.worldsRoot)
    private val options = save.openWorld(folder)
        ?: throw IllegalStateException("World '$folder' could not be opened")

    private val world = World(game.registries, options)
    private val chunkManager = ChunkManager(world, save)
    private val chunkRenderer = ChunkRenderer(world, game.atlas)
    private val skyRenderer = SkyRenderer(game.atlas)
    private val outlineRenderer = BlockOutlineRenderer()
    private val entityRenderer = EntityRenderer(world, game.atlas)
    private val entities = EntityManager(world, game.registries.creatures)

    private val player = PlayerController(world)
    private val stats = PlayerStats()
    private val inventory = Inventory(game.registries.items)
    private val crafting = CraftingManager(game.registries.recipes, game.registries.items)
    private val containers = ContainerStore(game.registries.items)
    private val interaction = Interaction(
        world, player, stats, inventory, crafting, containers, entities, options.mode,
    )

    private lateinit var hud: Hud
    private lateinit var invUi: InventoryUi
    private val camera = PerspectiveCamera(game.settings.fov, Gdx.graphics.width.toFloat(), Gdx.graphics.height.toFloat())
    private var cameraMode = CameraMode.FIRST
    private var state = PlayState.LOADING
    private val shapes = ShapeRenderer()

    private var playerSave = PlayerSave()
    private var autosaveTimer = 0f
    private var airSeconds = 10f
    private var airDamageTimer = 0f
    private var walkCycle = 0f
    private var stepTimer = 0f
    private var loadingTipIndex = 0
    private var loadingTipTimer = 0f
    private var tutorialStep = 0
    private var tutorialTimer = 0f
    private var paused = false

    private val tmpV = Vector3()
    private val loadingTips = listOf(
        "Resonance flows strongest near Waystones...",
        "Dusklings fear bright light. Lanterns keep camps safe.",
        "Hold on a block to mine it. Tap to place or use.",
        "Crops need tilled soil and sunlight to grow.",
        "The Frostglass Expanse hides frozen caverns.",
        "Mossram wool regrows - harvest kindly.",
    )

    // ---- lifecycle --------------------------------------------------------

    override fun show() {
        world.timeOfDay = save.readWorldClock().first
        world.totalTicks = save.readWorldClock().second
        world.weather = save.readWorldClock().third
        System.getProperty("cubic.time")?.toIntOrNull()?.let { world.timeOfDay = it }

        chunkManager.renderDistance = game.settings.renderDistance
        chunkManager.simulationDistance = game.settings.simulationDistance
        chunkManager.onChunkUnloaded = { chunkRenderer.onChunkUnloaded(it) }

        chunkRenderer.create()
        skyRenderer.create()
        skyRenderer.resize(Gdx.graphics.width, Gdx.graphics.height)

        hud = Hud(game.atlas, game.settings, inventory, this)
        invUi = InventoryUi(game.atlas, game.registries, inventory, crafting, game.audio, options.mode)
        invUi.onClosed = { Gdx.input.inputProcessor = hud.stage }

        interaction.onOpenStation = { station ->
            hud.cancelTouches()
            invUi.openStation(station)
            Gdx.input.inputProcessor = invUi.stage
        }
        interaction.onOpenContainer = { x, y, z ->
            hud.cancelTouches()
            invUi.openContainer(containers.containerAt(x, y, z))
            Gdx.input.inputProcessor = invUi.stage
        }
        interaction.onSound = { name -> game.audio.play(name) }

        entities.onPickup = { itemId, count, durability ->
            val leftover = inventory.add(itemId, count, durability)
            if (leftover < count) {
                crafting.markDiscovered(itemId)
                game.audio.play("pop", 0.8f)
            }
            leftover
        }
        entities.onPlayerDamaged = { dmg ->
            if (stats.damage(dmg, options.mode, options.difficulty)) {
                game.audio.play("hurt")
                if (game.settings.vibration) Gdx.input.vibrate(40)
            }
        }

        // restore or create the player
        val loaded = save.loadPlayer()
        if (loaded != null) {
            playerSave = loaded
            player.position.set(loaded.x, loaded.y, loaded.z)
            player.yaw = loaded.yaw
            player.pitch = loaded.pitch
            stats.health = loaded.health
            stats.hunger = loaded.hunger
            inventory.deserialize(loaded.slots)
            inventory.selectedSlot = loaded.selectedSlot.coerceIn(0, 8)
        } else {
            val (sx, sy, sz) = world.generator.findSpawn()
            playerSave.spawnX = sx; playerSave.spawnY = sy; playerSave.spawnZ = sz
            playerSave.spawnFound = true
            player.position.set(sx + 0.5f, sy + 0.2f, sz + 0.5f)
        }
        val discovered = File(save.worldDir, "discovered.txt")
        if (discovered.exists()) crafting.deserializeDiscovered(discovered.readText())
        containers.load(File(save.worldDir, "containers.dat"))
        entities.load(File(save.worldDir, "entities.dat"), game.registries.items)

        hud.build()
        Gdx.input.inputProcessor = hud.stage
        Gdx.input.setCatchKey(Input.Keys.BACK, true)
        state = PlayState.LOADING
    }

    // ---- per-frame --------------------------------------------------------

    override fun render(delta: Float) {
        val dt = delta.coerceAtMost(0.1f)
        game.audio.update(dt)

        when (state) {
            PlayState.LOADING -> renderLoading(dt)
            else -> renderGame(dt)
        }
    }

    private fun renderLoading(delta: Float) {
        val pcx = player.position.x.toInt() shr 4
        val pcz = player.position.z.toInt() shr 4
        chunkManager.update(pcx, pcz)
        chunkRenderer.update(pcx, pcz, chunkManager.renderDistance)
        world.update(0f, player.position.x.toInt(), player.position.z.toInt(), 0)

        Gdx.gl.glClearColor(0.09f, 0.12f, 0.24f, 1f)
        Gdx.gl.glClear(GL20.GL_COLOR_BUFFER_BIT or GL20.GL_DEPTH_BUFFER_BIT)

        // ready when the player's immediate ring is meshable
        var ready = true
        for (dz in -1..1) for (dx in -1..1) {
            val c = world.chunkAt(pcx + dx, pcz + dz)
            if (c == null || c.state != ChunkState.ACTIVE) ready = false
        }
        if (ready && chunkRenderer.uploadedOnce) {
            player.teleport(player.position.x, player.position.y, player.position.z)
            state = PlayState.PLAYING
            if (!game.settings.tutorialDone) {
                hud.showHint("Drag the left joystick to walk. Swipe the right side to look around.", 7f)
                tutorialStep = 1
            }
            return
        }

        loadingTipTimer -= delta
        if (loadingTipTimer <= 0f) {
            loadingTipTimer = 4f
            loadingTipIndex = (loadingTipIndex + 1) % loadingTips.size
        }
        shapes.begin(ShapeRenderer.ShapeType.Filled)
        val w = Gdx.graphics.width.toFloat()
        val h = Gdx.graphics.height.toFloat()
        shapes.setColor(0.2f, 0.24f, 0.34f, 1f)
        shapes.rect(w * 0.25f, h * 0.4f, w * 0.5f, 10f)
        val total = (chunkManager.renderDistance * 2 + 1).let { it * it }.toFloat()
        val progress = 1f - (chunkManager.pendingCount / total).coerceIn(0f, 1f)
        shapes.setColor(0.45f, 0.75f, 0.95f, 1f)
        shapes.rect(w * 0.25f, h * 0.4f, w * 0.5f * progress, 10f)
        shapes.end()

        hud.showHint("Shaping the world...\n${loadingTips[loadingTipIndex]}", 5f)
        hud.update(delta, stats.health, stats.hunger, 10, Gdx.graphics.framesPerSecond)
        hud.draw()
    }

    private fun renderGame(delta: Float) {
        if (Gdx.input.isKeyJustPressed(Input.Keys.BACK) || Gdx.input.isKeyJustPressed(Input.Keys.ESCAPE)) {
            if (invUi.open) invUi.close() else showPauseDialog()
        }

        val simDelta = if (paused || invUi.open || state == PlayState.DEAD) 0f else delta

        if (simDelta > 0f) {
            updateInput(simDelta)
            player.update(simDelta, options.mode)
            handleSurvivalTick(simDelta)
        }

        val pcx = player.position.x.toInt() shr 4
        val pcz = player.position.z.toInt() shr 4
        world.update(simDelta, player.position.x.toInt(), player.position.z.toInt(), chunkManager.simulationDistance)
        chunkManager.update(pcx, pcz)
        chunkRenderer.update(pcx, pcz, chunkManager.renderDistance)
        if (simDelta > 0f) {
            entities.update(simDelta, player.position, options.mode, options.difficulty)
            interaction.updateTarget()
            if (hud.pollBreakHeld()) {
                val held = inventory.selectedItem()
                if (held != null && held.kind == ItemKind.FOOD && stats.hunger < 20) {
                    interaction.continueEating(simDelta)
                } else {
                    interaction.continueBreaking(simDelta)
                }
            } else {
                interaction.stopBreaking()
                interaction.stopEating()
            }
        }

        updateCamera(delta)
        updateAudioScape()

        // ---- draw ----
        val biome = biomeAtPlayer()
        skyRenderer.clearFrame(world, biome.skyTint)
        skyRenderer.renderCelestial(world, camera)
        val sun = world.sunFactor()
        if (System.getProperty("cubic.no3d") == null) {
            chunkRenderer.render(camera, sun, skyRenderer.fogColor, chunkManager.renderDistance)
            if (interaction.breakProgress > 0f && interaction.target.hit) {
                entityRenderer.renderBreakOverlay(
                    chunkRenderer.shader,
                    interaction.target.x, interaction.target.y, interaction.target.z,
                    interaction.breakProgress,
                )
            }
            entityRenderer.render(chunkRenderer.shader, camera, entities, sun)
        }
        if (cameraMode != CameraMode.FIRST) {
            entityRenderer.renderPlayer(chunkRenderer.shader, player, sun, walkCycle)
        }
        outlineRenderer.highContrast = game.settings.highContrastOutline
        outlineRenderer.render(camera, interaction.target)

        // 3D passes leave depth testing and face culling on; SpriteBatch/Stage
        // quads are wound clockwise and would be back-face culled otherwise.
        Gdx.gl.glDisable(GL20.GL_DEPTH_TEST)
        Gdx.gl.glDisable(GL20.GL_CULL_FACE)
        drawScreenEffects(delta)
        skyRenderer.renderWeather(world, delta, playerUnderRoof())

        hud.update(delta, stats.health, stats.hunger, airSeconds.toInt(), Gdx.graphics.framesPerSecond)
        hud.draw()
        drawBreakProgress()
        invUi.render(delta)

        if (simDelta > 0f) {
            autosaveTimer += delta
            if (autosaveTimer >= game.settings.autosaveMinutes * 60f) {
                autosaveTimer = 0f
                saveAll()
                hud.showSaving()
            }
            advanceTutorial(delta)
        }

        if (stats.dead && state != PlayState.DEAD) onDeath()
    }

    // ---- input ------------------------------------------------------------

    private var autopilotTime = 0f
    private var buttonSprint = false
    private var gestureSprint = false
    private var prevKnobY = 0f
    private var lastForwardPush = 0L

    private fun updateInput(delta: Float) {
        player.moveX = hud.joystick.knobPercentX
        player.moveZ = hud.joystick.knobPercentY

        // double-push the joystick forward to sprint; released stick ends it
        val knobY = hud.joystick.knobPercentY
        if (prevKnobY < 0.45f && knobY > 0.85f) {
            val now = System.currentTimeMillis()
            if (now - lastForwardPush < 350L) gestureSprint = true
            lastForwardPush = now
        }
        if (knobY < 0.2f) gestureSprint = false
        prevKnobY = knobY
        player.sprinting = buttonSprint || gestureSprint

        // dev soak-test autopilot: walk forward, slowly turning, hopping ledges
        if (System.getProperty("cubic.autopilot") != null) {
            autopilotTime += delta
            player.moveZ = 1f
            player.yaw += delta * 9f
            val horiz = kotlin.math.sqrt(
                player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z,
            )
            player.wantJump = player.onGround && horiz < 1.2f
            if (autopilotTime > 20f && cameraMode == CameraMode.FIRST) cameraMode = CameraMode.THIRD_BACK
        }

        val sens = if (cameraMode == CameraMode.FIRST) game.settings.firstPersonSensitivity
        else game.settings.thirdPersonSensitivity
        player.yaw -= hud.lookDeltaX * 0.22f * sens
        player.pitch += hud.lookDeltaY * 0.22f * sens
        player.pitch = player.pitch.coerceIn(-89f, 89f)
        hud.lookDeltaX = 0f
        hud.lookDeltaY = 0f

        // walk-cycle for bobbing and steps
        val speed = kotlin.math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z)
        if (player.onGround && speed > 0.5f) {
            walkCycle += delta * speed * 1.6f
            stepTimer -= delta
            if (stepTimer <= 0f) {
                stepTimer = (2.2f / speed).coerceIn(0.25f, 0.6f)
                val below = world.blockDefAt(
                    MathUtils.floor(player.position.x),
                    MathUtils.floor(player.position.y - 0.4f),
                    MathUtils.floor(player.position.z),
                )
                val step = when (below.material) {
                    com.cubicworld.world.BlockMaterial.STONE, com.cubicworld.world.BlockMaterial.METAL -> "step_stone"
                    com.cubicworld.world.BlockMaterial.WOOD -> "step_wood"
                    com.cubicworld.world.BlockMaterial.EARTH ->
                        if (below.name.contains("sand") || below.name.contains("gravel")) "step_sand" else "step_grass"
                    else -> "step_grass"
                }
                game.audio.play(step, 0.35f)
            }
        }
    }

    // ---- survival ---------------------------------------------------------

    private fun handleSurvivalTick(delta: Float) {
        val moving = kotlin.math.abs(player.moveX) + kotlin.math.abs(player.moveZ) > 0.1f
        stats.update(delta, options.mode, moving, player.sprinting)

        if (player.pendingFallDamage > 0) {
            val dmg = player.pendingFallDamage
            player.pendingFallDamage = 0
            val scaled = if (options.mode == GameMode.EXPLORER) (dmg + 1) / 2 else dmg
            if (stats.damage(scaled, options.mode, options.difficulty)) {
                game.audio.play("hurt")
                if (game.settings.vibration) Gdx.input.vibrate(50)
            }
        }

        // oxygen underwater
        if (player.headInLiquid && options.mode != GameMode.CREATIVE) {
            airSeconds -= delta
            if (airSeconds <= 0f) {
                airSeconds = 0f
                airDamageTimer += delta
                if (airDamageTimer >= 1.5f) {
                    airDamageTimer = 0f
                    stats.damage(2, options.mode, options.difficulty)
                    game.audio.play("hurt")
                }
            }
        } else {
            airSeconds = (airSeconds + delta * 3f).coerceAtMost(10f)
            airDamageTimer = 0f
        }
    }

    private fun onDeath() {
        state = PlayState.DEAD
        if (!options.keepInventory && options.mode == GameMode.SURVIVAL) {
            // spill the satchel where the player fell
            for (slot in inventory.slots) {
                if (!slot.isEmpty) {
                    entities.spawnDrop(
                        player.position.x, player.position.y + 0.6f, player.position.z,
                        slot.itemId, slot.count, slot.durability,
                    )
                    slot.clear()
                }
            }
        }
        saveAll()

        val dialog = object : Dialog("", UiSkin.skin) {
            override fun result(obj: Any?) {
                respawn()
            }
        }
        dialog.text(
            Label(
                "You were defeated.\nYour satchel waits where you fell.",
                UiSkin.skin,
            ).apply { setAlignment(com.badlogic.gdx.utils.Align.center) },
        )
        dialog.button("Respawn", true)
        dialog.pad(20f * UiSkin.s)
        dialog.show(hud.stage)
    }

    private fun respawn() {
        stats.respawn()
        airSeconds = 10f
        player.teleport(playerSave.spawnX + 0.5f, playerSave.spawnY + 0.5f, playerSave.spawnZ + 0.5f)
        state = PlayState.PLAYING
    }

    // ---- camera -----------------------------------------------------------

    private fun updateCamera(delta: Float) {
        camera.fieldOfView = game.settings.fov
        camera.viewportWidth = Gdx.graphics.width.toFloat()
        camera.viewportHeight = Gdx.graphics.height.toFloat()
        camera.near = 0.08f
        camera.far = (chunkManager.renderDistance * 16f) + 32f

        player.eyePosition(tmpV)
        val look = player.lookDir(Vector3())

        when (cameraMode) {
            CameraMode.FIRST -> {
                var bobY = 0f
                var bobX = 0f
                if (game.settings.viewBobbing && player.onGround) {
                    val speed = kotlin.math.sqrt(
                        player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z,
                    )
                    if (speed > 0.5f) {
                        bobY = MathUtils.sin(walkCycle * 6f) * 0.045f
                        bobX = MathUtils.cos(walkCycle * 3f) * 0.025f
                    }
                }
                camera.position.set(tmpV.x + bobX, tmpV.y + bobY, tmpV.z)
                camera.direction.set(look)
            }
            CameraMode.THIRD_BACK -> {
                val dist = thirdPersonDistance(tmpV, look, -1f)
                camera.position.set(
                    tmpV.x - look.x * dist,
                    tmpV.y - look.y * dist + 0.25f,
                    tmpV.z - look.z * dist,
                )
                camera.direction.set(look)
            }
            CameraMode.THIRD_FRONT -> {
                val dist = thirdPersonDistance(tmpV, look, 1f)
                camera.position.set(
                    tmpV.x + look.x * dist,
                    tmpV.y + look.y * dist + 0.25f,
                    tmpV.z + look.z * dist,
                )
                camera.direction.set(-look.x, -look.y, -look.z)
            }
        }
        camera.up.set(0f, 1f, 0f)
        camera.update()
    }

    /** Pull the camera in when a wall is between it and the player. */
    private fun thirdPersonDistance(eye: Vector3, look: Vector3, sign: Float): Float {
        val want = 4.2f
        var d = 0.4f
        while (d < want) {
            val x = eye.x + look.x * d * sign
            val y = eye.y + look.y * d * sign + 0.25f
            val z = eye.z + look.z * d * sign
            if (world.blockDefAt(MathUtils.floor(x), MathUtils.floor(y), MathUtils.floor(z)).solid) {
                return (d - 0.3f).coerceAtLeast(0.4f)
            }
            d += 0.25f
        }
        return want
    }

    // ---- ambience ---------------------------------------------------------

    private fun biomeAtPlayer(): com.cubicworld.world.BiomeDef {
        val c = world.chunkForBlock(player.position.x.toInt(), player.position.z.toInt())
        return if (c != null && c.state >= ChunkState.TERRAIN) {
            world.registries.biomes.byId(
                c.biomes[((player.position.z.toInt() and 15) shl 4) or (player.position.x.toInt() and 15)].toInt(),
            )
        } else world.registries.biomes.byId(0)
    }

    private fun updateAudioScape() {
        val underground = run {
            val l = world.lightAt(
                player.position.x.toInt(), (player.position.y + 1).toInt(), player.position.z.toInt(),
            )
            ((l ushr 4) and 0xF) <= 3 && player.position.y < 44f
        }
        var danger = false
        for (e in entities.entities) {
            if (e is Creature && e.def.hostile &&
                e.distanceTo(player.position.x, player.position.y, player.position.z) < 14f &&
                (e.state == com.cubicworld.entity.AiState.CHASE || e.state == com.cubicworld.entity.AiState.ATTACK)
            ) { danger = true; break }
        }
        game.audio.updateMusic(Gdx.graphics.deltaTime, world.isNight(), underground, danger)
        game.audio.setAmbience(
            when {
                underground -> "cave"
                world.weather == Weather.RAIN || world.weather == Weather.STORM -> "rain"
                else -> "wind"
            },
        )
    }

    private fun playerUnderRoof(): Boolean {
        val x = player.position.x.toInt()
        val z = player.position.z.toInt()
        val top = world.surfaceHeight(x, z)
        return top > player.position.y + player.height
    }

    // ---- overlays ---------------------------------------------------------

    private fun drawScreenEffects(delta: Float) {
        if (player.headInLiquid) {
            Gdx.gl.glEnable(GL20.GL_BLEND)
            shapes.begin(ShapeRenderer.ShapeType.Filled)
            shapes.setColor(0.1f, 0.3f, 0.6f, 0.35f)
            shapes.rect(0f, 0f, Gdx.graphics.width.toFloat(), Gdx.graphics.height.toFloat())
            shapes.end()
            Gdx.gl.glDisable(GL20.GL_BLEND)
        }
    }

    private fun drawBreakProgress() {
        val progress = interaction.breakProgress
        if (progress <= 0f) {
            if (cameraMode == CameraMode.FIRST && !invUi.open) drawCrosshair()
            return
        }
        val cx = Gdx.graphics.width / 2f
        val cy = Gdx.graphics.height / 2f
        Gdx.gl.glEnable(GL20.GL_BLEND)
        shapes.begin(ShapeRenderer.ShapeType.Filled)
        shapes.setColor(0f, 0f, 0f, 0.35f)
        shapes.circle(cx, cy, 26f * UiSkin.s)
        shapes.setColor(0.95f, 0.9f, 0.5f, 0.9f)
        shapes.arc(cx, cy, 24f * UiSkin.s, 90f, -progress * 360f)
        shapes.end()
        Gdx.gl.glDisable(GL20.GL_BLEND)
    }

    private fun drawCrosshair() {
        val cx = Gdx.graphics.width / 2f
        val cy = Gdx.graphics.height / 2f
        Gdx.gl.glEnable(GL20.GL_BLEND)
        shapes.begin(ShapeRenderer.ShapeType.Filled)
        shapes.setColor(1f, 1f, 1f, 0.55f)
        shapes.circle(cx, cy, 3f * UiSkin.s)
        shapes.end()
        Gdx.gl.glDisable(GL20.GL_BLEND)
    }

    private fun advanceTutorial(delta: Float) {
        if (game.settings.tutorialDone || tutorialStep == 0) return
        tutorialTimer += delta
        val hints = listOf(
            "" ,
            "Hold your finger on a block to mine it.",
            "Tap the world to place your selected block.",
            "Tap the bag to open your pack and craft.",
            "Eat when hungry: select food and hold. Stay safe at night!",
        )
        if (tutorialTimer > 9f) {
            tutorialTimer = 0f
            tutorialStep++
            if (tutorialStep >= hints.size) {
                game.settings.tutorialDone = true
                game.settings.save()
                tutorialStep = 0
            } else {
                hud.showHint(hints[tutorialStep], 7f)
            }
        }
    }

    // ---- pause / persistence ---------------------------------------------

    private fun showPauseDialog() {
        if (paused || state == PlayState.DEAD) return   // never stack pause dialogs
        paused = true
        hud.cancelTouches()
        saveAll()
        hud.showSaving()
        val dialog = object : Dialog("", UiSkin.skin) {
            override fun result(obj: Any?) {
                when (obj) {
                    "resume" -> paused = false
                    "settings" -> {
                        paused = false
                        game.setScreen(SettingsScreen(game) { GameScreen(game, folder) })
                    }
                    "quit" -> game.setScreen(MainMenuScreen(game))
                }
            }
        }
        dialog.text(Label("Paused", UiSkin.skin, "title"))
        dialog.buttonTable.pad(6f * UiSkin.s)
        dialog.button("Resume", "resume")
        dialog.buttonTable.row()
        dialog.button("Settings", "settings")
        dialog.buttonTable.row()
        dialog.button("Save & Quit", "quit")
        dialog.pad(20f * UiSkin.s)
        dialog.show(hud.stage)
    }

    private fun saveAll() {
        save.writeWorldMeta(options, world.timeOfDay, world.totalTicks, world.weather)
        playerSave.x = player.position.x
        playerSave.y = player.position.y
        playerSave.z = player.position.z
        playerSave.yaw = player.yaw
        playerSave.pitch = player.pitch
        playerSave.health = stats.health
        playerSave.hunger = stats.hunger
        playerSave.selectedSlot = inventory.selectedSlot
        playerSave.slots = inventory.serialize()
        save.savePlayer(playerSave)
        chunkManager.saveAllModified()
        containers.save(File(save.worldDir, "containers.dat"))
        entities.save(File(save.worldDir, "entities.dat"))
        com.cubicworld.world.AtomicFiles.writeBytes(
            File(save.worldDir, "discovered.txt"),
            crafting.serializeDiscovered().toByteArray(),
        )
    }

    override fun pause() {
        // app going to background: persist everything and silence audio
        if (state != PlayState.LOADING) saveAll()
        game.audio.pauseAll()
    }

    override fun resume() {
        game.audio.resumeAll()
    }

    override fun resize(width: Int, height: Int) {
        skyRenderer.resize(width, height)
        hud.resize(width, height)
        invUi.resize(width, height)
        shapes.projectionMatrix.setToOrtho2D(0f, 0f, width.toFloat(), height.toFloat())
    }

    override fun hide() {
        if (state != PlayState.LOADING) saveAll()
        dispose()
    }

    override fun dispose() {
        chunkManager.dispose()
        chunkRenderer.dispose()
        skyRenderer.dispose()
        outlineRenderer.dispose()
        entityRenderer.dispose()
        hud.dispose()
        invUi.dispose()
        shapes.dispose()
        game.audio.setAmbience(null)
    }

    // ---- HudListener ------------------------------------------------------

    override fun onTapWorld() {
        if (state != PlayState.PLAYING || paused) return
        interaction.updateTarget()
        if (interaction.attack()) return
        if (interaction.tapAction() && game.settings.vibration) Gdx.input.vibrate(12)
    }

    override fun onJumpChanged(pressed: Boolean) {
        player.wantJump = pressed
        if (options.mode == GameMode.CREATIVE && pressed) {
            val now = System.currentTimeMillis()
            if (now - lastJumpTap < 300) player.flying = !player.flying
            lastJumpTap = now
        }
    }

    private var lastJumpTap = 0L

    override fun onSneakToggled(on: Boolean) {
        player.crouching = on
        player.wantDescend = on
    }

    override fun onSprintToggled(on: Boolean) {
        buttonSprint = on
    }

    override fun onCameraToggle() {
        cameraMode = when (cameraMode) {
            CameraMode.FIRST -> CameraMode.THIRD_BACK
            CameraMode.THIRD_BACK -> CameraMode.THIRD_FRONT
            CameraMode.THIRD_FRONT -> CameraMode.FIRST
        }
    }

    override fun onOpenInventory() {
        if (invUi.open) invUi.close()
        else {
            hud.cancelTouches()
            invUi.openPack()
            Gdx.input.inputProcessor = invUi.stage
        }
    }

    override fun onPause() = showPauseDialog()

    override fun onHotbarSelected(slot: Int) {
        inventory.selectedSlot = slot
        game.audio.play("click", 0.5f)
    }
}
