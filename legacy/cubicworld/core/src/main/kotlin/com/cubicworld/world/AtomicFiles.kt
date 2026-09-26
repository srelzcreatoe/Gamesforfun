package com.cubicworld.world

import java.io.File
import java.io.FileOutputStream

/**
 * Crash-safe file replacement used by every save path.
 * Rules: data is flushed (and optionally fsynced) before commit, and the last
 * good copy of the target is never deleted before its replacement is in place.
 */
object AtomicFiles {

    /** Write [bytes] to [target] via a temp file + atomic commit. */
    fun writeBytes(target: File, bytes: ByteArray, sync: Boolean = true): Boolean {
        target.parentFile?.mkdirs()
        val tmp = File(target.parentFile, target.name + ".tmp")
        try {
            FileOutputStream(tmp).use { out ->
                out.write(bytes)
                out.flush()
                if (sync) out.fd.sync()
            }
        } catch (e: Exception) {
            tmp.delete()
            return false
        }
        return commit(tmp, target)
    }

    /**
     * Move a fully-written [tmp] into place as [target]. Plain rename first;
     * on filesystems where rename-over-existing fails, the old file is parked
     * as .old (not deleted) until the new content is committed.
     */
    fun commit(tmp: File, target: File): Boolean {
        if (tmp.renameTo(target)) return true
        val old = File(target.parentFile, target.name + ".old")
        old.delete()
        val parked = target.exists() && target.renameTo(old)
        if (tmp.renameTo(target)) {
            if (parked) old.delete()
            return true
        }
        // rename refused entirely (e.g. cross-device oddities): copy as last resort
        return try {
            tmp.copyTo(target, overwrite = true)
            tmp.delete()
            if (parked) old.delete()
            true
        } catch (e: Exception) {
            if (parked) old.renameTo(target)   // restore the previous good copy
            false
        }
    }
}
