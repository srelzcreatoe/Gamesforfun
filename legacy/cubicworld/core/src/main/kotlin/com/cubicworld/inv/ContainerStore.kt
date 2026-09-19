package com.cubicworld.inv

import java.io.File

/**
 * Persistent inventories for container blocks (storage crates, stations with
 * buffers). Keyed by block position; saved as a simple line format:
 * x,y,z|slot0|slot1|...
 */
class ContainerStore(private val items: ItemRegistry) {

    private val containers = HashMap<Long, Inventory>()

    private fun key(x: Int, y: Int, z: Int): Long =
        (x.toLong() and 0x3FFFFFF) or ((z.toLong() and 0x3FFFFFF) shl 26) or ((y.toLong() and 0xFF) shl 52)

    fun containerAt(x: Int, y: Int, z: Int, createSize: Int = 15): Inventory =
        containers.getOrPut(key(x, y, z)) { Inventory(items, createSize) }

    fun existsAt(x: Int, y: Int, z: Int): Boolean = key(x, y, z) in containers

    /** Remove a broken container and return its contents for dropping. */
    fun removeAt(x: Int, y: Int, z: Int): List<ItemStack> {
        val inv = containers.remove(key(x, y, z)) ?: return emptyList()
        return inv.slots.filter { !it.isEmpty }
    }

    fun save(file: File) {
        val sb = StringBuilder()
        for ((k, inv) in containers) {
            val x = ((k shl 38) shr 38).toInt()
            val z = ((k shl 12) shr 38).toInt()
            val y = ((k ushr 52) and 0xFF).toInt()
            if (inv.slots.all { it.isEmpty }) continue
            sb.append(x).append(',').append(y).append(',').append(z)
            for (entry in inv.serialize()) sb.append('|').append(entry)
            sb.append('\n')
        }
        com.cubicworld.world.AtomicFiles.writeBytes(file, sb.toString().toByteArray())
    }

    fun load(file: File) {
        containers.clear()
        if (!file.exists()) return
        for (line in file.readLines()) {
            if (line.isEmpty()) continue
            val parts = line.split('|')
            val pos = parts[0].split(',')
            if (pos.size != 3) continue
            val x = pos[0].toIntOrNull() ?: continue
            val y = pos[1].toIntOrNull() ?: continue
            val z = pos[2].toIntOrNull() ?: continue
            val inv = Inventory(items, (parts.size - 1).coerceAtLeast(15))
            inv.deserialize(parts.drop(1))
            containers[key(x, y, z)] = inv
        }
    }
}
