package com.cubicworld.world

import com.badlogic.gdx.utils.JsonReader
import com.cubicworld.Version
import com.cubicworld.world.gen.WorldType
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.zip.DeflaterOutputStream
import java.util.zip.InflaterInputStream

/** Summary card data for the world-selection screen. */
class WorldSummary(
    val folder: String,
    val name: String,
    val seed: Long,
    val mode: GameMode,
    val lastPlayed: Long,
    val gameVersion: String,
)

/** Player state persisted per world. */
class PlayerSave(
    var x: Float = 0f, var y: Float = 80f, var z: Float = 0f,
    var yaw: Float = 0f, var pitch: Float = 0f,
    var health: Int = 20, var hunger: Int = 20,
    var spawnX: Int = 0, var spawnY: Int = 80, var spawnZ: Int = 0,
    var selectedSlot: Int = 0,
    /** slots as "itemName:count:durability", empty string = empty slot */
    var slots: MutableList<String> = MutableList(36) { "" },
    var spawnFound: Boolean = false,
)

/**
 * Versioned, compressed, atomically-written world persistence.
 * Layout: worlds/<folder>/world.json, player.json, chunks/c.<cx>.<cz>.ccw
 * Every write goes to a .tmp file first and is renamed into place; world.json
 * keeps two rotating backups so an interrupted save never loses the world.
 */
class SaveManager(private val root: File) {

    lateinit var worldDir: File
        private set
    private val chunksDir: File get() = File(worldDir, "chunks")

    companion object {
        const val CHUNK_MAGIC = 0x43435731            // "CCW1"
        fun sanitize(name: String): String =
            name.lowercase().replace(Regex("[^a-z0-9-_ ]"), "").trim().replace(' ', '_')
                .ifEmpty { "world" }
    }

    // ---- world listing / creation ----------------------------------------

    fun listWorlds(): List<WorldSummary> {
        val dirs = root.listFiles { f -> f.isDirectory } ?: return emptyList()
        return dirs.mapNotNull { dir ->
            val meta = readJsonWithBackup(File(dir, "world.json")) ?: return@mapNotNull null
            try {
                WorldSummary(
                    folder = dir.name,
                    name = meta.getString("name", dir.name),
                    seed = meta.getLong("seed", 0),
                    mode = GameMode.valueOf(meta.getString("mode", "SURVIVAL")),
                    lastPlayed = meta.getLong("lastPlayed", 0),
                    gameVersion = meta.getString("gameVersion", "?"),
                )
            } catch (e: Exception) { null }
        }.sortedByDescending { it.lastPlayed }
    }

    fun createWorld(options: WorldOptions): String {
        var folder = sanitize(options.name)
        var i = 1
        while (File(root, folder).exists()) folder = sanitize(options.name) + "_" + (i++)
        worldDir = File(root, folder)
        chunksDir.mkdirs()
        writeWorldMeta(options, timeOfDay = WorldConst.DAY_LENGTH_TICKS / 4, totalTicks = 0, weather = Weather.CLEAR)
        return folder
    }

    fun openWorld(folder: String): WorldOptions? {
        worldDir = File(root, folder)
        val meta = readJsonWithBackup(File(worldDir, "world.json")) ?: return null
        return try {
            WorldOptions(
                name = meta.getString("name", folder),
                seed = meta.getLong("seed", 0),
                mode = GameMode.valueOf(meta.getString("mode", "SURVIVAL")),
                difficulty = Difficulty.valueOf(meta.getString("difficulty", "ADVENTUROUS")),
                worldType = WorldType.valueOf(meta.getString("worldType", "STANDARD")),
                keepInventory = meta.getBoolean("keepInventory", false),
            )
        } catch (e: Exception) { null }
    }

    fun readWorldClock(): Triple<Int, Long, Weather> {
        val meta = readJsonWithBackup(File(worldDir, "world.json"))
            ?: return Triple(WorldConst.DAY_LENGTH_TICKS / 4, 0L, Weather.CLEAR)
        return Triple(
            meta.getInt("timeOfDay", WorldConst.DAY_LENGTH_TICKS / 4),
            meta.getLong("totalTicks", 0),
            try { Weather.valueOf(meta.getString("weather", "CLEAR")) } catch (e: Exception) { Weather.CLEAR },
        )
    }

    fun writeWorldMeta(options: WorldOptions, timeOfDay: Int, totalTicks: Long, weather: Weather) {
        val json = buildString {
            append("{\n")
            append("  \"formatVersion\": ").append(Version.SAVE_FORMAT).append(",\n")
            append("  \"name\": ").append(quote(options.name)).append(",\n")
            append("  \"seed\": ").append(options.seed).append(",\n")
            append("  \"mode\": \"").append(options.mode.name).append("\",\n")
            append("  \"difficulty\": \"").append(options.difficulty.name).append("\",\n")
            append("  \"worldType\": \"").append(options.worldType.name).append("\",\n")
            append("  \"keepInventory\": ").append(options.keepInventory).append(",\n")
            append("  \"timeOfDay\": ").append(timeOfDay).append(",\n")
            append("  \"totalTicks\": ").append(totalTicks).append(",\n")
            append("  \"weather\": \"").append(weather.name).append("\",\n")
            append("  \"lastPlayed\": ").append(System.currentTimeMillis()).append(",\n")
            append("  \"gameVersion\": ").append(quote(Version.NAME)).append("\n")
            append("}\n")
        }
        atomicWriteWithBackup(File(worldDir, "world.json"), json.toByteArray())
    }

    // ---- player -----------------------------------------------------------

    fun savePlayer(p: PlayerSave) {
        val json = buildString {
            append("{\n")
            append("  \"x\": ").append(p.x).append(", \"y\": ").append(p.y).append(", \"z\": ").append(p.z).append(",\n")
            append("  \"yaw\": ").append(p.yaw).append(", \"pitch\": ").append(p.pitch).append(",\n")
            append("  \"health\": ").append(p.health).append(", \"hunger\": ").append(p.hunger).append(",\n")
            append("  \"spawnX\": ").append(p.spawnX).append(", \"spawnY\": ").append(p.spawnY)
            append(", \"spawnZ\": ").append(p.spawnZ).append(",\n")
            append("  \"spawnFound\": ").append(p.spawnFound).append(",\n")
            append("  \"selectedSlot\": ").append(p.selectedSlot).append(",\n")
            append("  \"slots\": [").append(p.slots.joinToString(",") { quote(it) }).append("]\n")
            append("}\n")
        }
        atomicWriteWithBackup(File(worldDir, "player.json"), json.toByteArray())
    }

    fun loadPlayer(): PlayerSave? {
        val v = readJsonWithBackup(File(worldDir, "player.json")) ?: return null
        return try {
            val p = PlayerSave(
                x = v.getFloat("x", 0f), y = v.getFloat("y", 80f), z = v.getFloat("z", 0f),
                yaw = v.getFloat("yaw", 0f), pitch = v.getFloat("pitch", 0f),
                health = v.getInt("health", 20), hunger = v.getInt("hunger", 20),
                spawnX = v.getInt("spawnX", 0), spawnY = v.getInt("spawnY", 80), spawnZ = v.getInt("spawnZ", 0),
                selectedSlot = v.getInt("selectedSlot", 0),
                spawnFound = v.getBoolean("spawnFound", false),
            )
            val slots = v.get("slots")
            if (slots != null) {
                var i = 0
                var s = slots.child
                while (s != null && i < p.slots.size) {
                    p.slots[i] = s.asString() ?: ""
                    i++; s = s.next
                }
            }
            p
        } catch (e: Exception) { null }
    }

    // ---- chunks -----------------------------------------------------------

    private fun chunkFile(cx: Int, cz: Int) = File(chunksDir, "c.$cx.$cz.ccw")

    fun saveChunk(chunk: Chunk) {
        chunksDir.mkdirs()
        val file = chunkFile(chunk.cx, chunk.cz)
        val tmp = File(file.parentFile, file.name + ".tmp")
        DataOutputStream(BufferedOutputStream(DeflaterOutputStream(FileOutputStream(tmp)))).use { out ->
            out.writeInt(CHUNK_MAGIC)
            out.writeInt(Version.SAVE_FORMAT)
            out.writeInt(chunk.cx)
            out.writeInt(chunk.cz)
            out.writeBoolean(chunk.state >= ChunkState.DECORATED)
            chunk.data.write(out)
            out.write(chunk.biomes)
        }
        AtomicFiles.commit(tmp, file)
    }

    /** Returns true when the chunk existed on disk and was loaded. */
    fun loadChunk(chunk: Chunk): Boolean {
        val file = chunkFile(chunk.cx, chunk.cz)
        if (!file.exists()) return false
        DataInputStream(BufferedInputStream(InflaterInputStream(FileInputStream(file)))).use { inp ->
            val magic = inp.readInt()
            require(magic == CHUNK_MAGIC) { "Bad chunk magic in ${file.name}" }
            val version = inp.readInt()
            require(version in 1..Version.SAVE_FORMAT) { "Chunk from newer save format $version" }
            inp.readInt(); inp.readInt()      // cx, cz sanity fields
            chunk.loadedDecorated = inp.readBoolean()
            chunk.data.read(inp)
            inp.readFully(chunk.biomes)
        }
        return true
    }

    // ---- world management -------------------------------------------------

    fun deleteWorld(folder: String): Boolean {
        val dir = File(root, folder)
        if (!dir.exists() || dir.parentFile?.absolutePath != root.absolutePath) return false
        return dir.deleteRecursively()
    }

    fun renameWorld(folder: String, newName: String): Boolean {
        val dir = File(root, folder)
        val meta = readJsonWithBackup(File(dir, "world.json")) ?: return false
        val opts = openWorld(folder) ?: return false
        opts.name = newName
        worldDir = dir
        writeWorldMeta(
            opts,
            meta.getInt("timeOfDay", 0),
            meta.getLong("totalTicks", 0),
            try { Weather.valueOf(meta.getString("weather", "CLEAR")) } catch (e: Exception) { Weather.CLEAR },
        )
        return true
    }

    fun duplicateWorld(folder: String): Boolean {
        val src = File(root, folder)
        if (!src.exists()) return false
        var target = folder + "_copy"
        var i = 1
        while (File(root, target).exists()) target = folder + "_copy" + (i++)
        return try {
            src.copyRecursively(File(root, target))
            true
        } catch (e: Exception) { false }
    }

    // ---- io helpers -------------------------------------------------------

    private fun quote(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ") + "\""

    /** Atomic fsynced write plus two rotating backups (.bak1 freshest). */
    private fun atomicWriteWithBackup(file: File, bytes: ByteArray) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        FileOutputStream(tmp).use { out ->
            out.write(bytes)
            out.flush()
            out.fd.sync()
        }
        if (file.exists()) {
            // best-effort rotation: copy (not move) so the current file stays
            // in place until the final commit replaces it
            val bak1 = File(file.parentFile, file.name + ".bak1")
            val bak2 = File(file.parentFile, file.name + ".bak2")
            try {
                if (bak1.exists()) bak1.copyTo(bak2, overwrite = true)
                file.copyTo(bak1, overwrite = true)
            } catch (e: Exception) {
                // a failed rotation must never block the actual save
            }
        }
        AtomicFiles.commit(tmp, file)
    }

    private fun readJsonWithBackup(file: File): com.badlogic.gdx.utils.JsonValue? {
        for (candidate in listOf(file, File(file.parentFile, file.name + ".bak1"), File(file.parentFile, file.name + ".bak2"))) {
            if (!candidate.exists()) continue
            try {
                // JsonReader returns null (no throw) for empty/whitespace files:
                // treat that as corruption and fall through to the next backup
                val parsed = JsonReader().parse(candidate.readText())
                if (parsed != null) return parsed
            } catch (e: Exception) {
                // fall through to older backup
            }
        }
        return null
    }
}
