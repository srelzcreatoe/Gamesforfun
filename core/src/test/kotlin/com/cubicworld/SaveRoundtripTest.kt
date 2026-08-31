package com.cubicworld

import com.cubicworld.world.Chunk
import com.cubicworld.world.Difficulty
import com.cubicworld.world.GameMode
import com.cubicworld.world.PlayerSave
import com.cubicworld.world.SaveManager
import com.cubicworld.world.Weather
import com.cubicworld.world.WorldOptions
import com.cubicworld.world.gen.WorldType
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class SaveRoundtripTest {

    @TempDir
    lateinit var tmp: File

    private fun newSave(): Pair<SaveManager, String> {
        val save = SaveManager(tmp)
        val folder = save.createWorld(
            WorldOptions("Test World", 777L, GameMode.SURVIVAL, Difficulty.CALM, WorldType.STANDARD, true),
        )
        return save to folder
    }

    @Test
    fun `world metadata roundtrips`() {
        val (save, folder) = newSave()
        val opts = save.openWorld(folder)
        assertNotNull(opts)
        assertEquals("Test World", opts!!.name)
        assertEquals(777L, opts.seed)
        assertEquals(GameMode.SURVIVAL, opts.mode)
        assertEquals(Difficulty.CALM, opts.difficulty)
        assertTrue(opts.keepInventory)
    }

    @Test
    fun `chunk data roundtrips exactly`() {
        val (save, _) = newSave()
        val chunk = Chunk(3, -4)
        for (i in chunk.data.ids.indices step 7) {
            chunk.data.ids[i] = (i % 60 + 1).toShort()
            chunk.data.states[i] = (i % 4).toByte()
        }
        chunk.data.rebuildHeightMap()
        chunk.biomes.fill(3)
        save.saveChunk(chunk)

        val loaded = Chunk(3, -4)
        assertTrue(save.loadChunk(loaded))
        assertArrayEquals(chunk.data.ids, loaded.data.ids)
        assertArrayEquals(chunk.data.states, loaded.data.states)
        assertArrayEquals(chunk.biomes, loaded.biomes)
        assertArrayEquals(chunk.data.heightMap, loaded.data.heightMap)
    }

    @Test
    fun `missing chunk returns false, corrupt chunk fails loudly`() {
        val (save, folder) = newSave()
        assertFalse(save.loadChunk(Chunk(9, 9)))
        // corrupt file
        val f = File(tmp, "$folder/chunks/c.5.5.ccw")
        f.parentFile.mkdirs()
        f.writeBytes(byteArrayOf(1, 2, 3, 4, 5))
        var threw = false
        try { save.loadChunk(Chunk(5, 5)) } catch (e: Exception) { threw = true }
        assertTrue(threw, "corrupt chunk should throw so the caller can regenerate")
    }

    @Test
    fun `player state roundtrips including inventory slots`() {
        val (save, _) = newSave()
        val p = PlayerSave(
            x = 10.5f, y = 66f, z = -3.25f, yaw = 123f, pitch = -15f,
            health = 13, hunger = 7, spawnX = 4, spawnY = 70, spawnZ = 2,
            selectedSlot = 3,
        )
        p.slots[0] = "sunbark_log:12:0"
        p.slots[8] = "flint_pick:1:57"
        save.savePlayer(p)
        val loaded = save.loadPlayer()!!
        assertEquals(10.5f, loaded.x)
        assertEquals(123f, loaded.yaw)
        assertEquals(13, loaded.health)
        assertEquals("sunbark_log:12:0", loaded.slots[0])
        assertEquals("flint_pick:1:57", loaded.slots[8])
        assertEquals(3, loaded.selectedSlot)
    }

    @Test
    fun `backups recover a corrupted world json`() {
        val (save, folder) = newSave()
        val opts = save.openWorld(folder)!!
        // write twice more so .bak1 exists
        save.writeWorldMeta(opts, 100, 5L, Weather.RAIN)
        save.writeWorldMeta(opts, 200, 9L, Weather.CLEAR)
        // corrupt the primary file
        File(tmp, "$folder/world.json").writeText("{ not json !!!")
        val recovered = save.openWorld(folder)
        assertNotNull(recovered, "backup should recover the world metadata")
        assertEquals(777L, recovered!!.seed)
    }

    @Test
    fun `delete only removes the named world`() {
        val (save, folder) = newSave()
        val save2 = SaveManager(tmp)
        val folder2 = save2.createWorld(WorldOptions("Other", 1L))
        assertTrue(save.deleteWorld(folder))
        assertFalse(File(tmp, folder).exists())
        assertTrue(File(tmp, folder2).exists(), "other world must survive")
        assertFalse(save.deleteWorld("../escape"), "path escape must be rejected")
    }

    @Test
    fun `rename and duplicate work`() {
        val (save, folder) = newSave()
        assertTrue(save.renameWorld(folder, "Fancy Name"))
        assertEquals("Fancy Name", save.openWorld(folder)!!.name)
        assertTrue(save.duplicateWorld(folder))
        assertEquals(2, save.listWorlds().size)
    }
}
