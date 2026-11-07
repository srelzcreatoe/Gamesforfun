package com.gamesforfun.mobsmith

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/**
 * Serves exported add-on files (cache/exports) to other apps such as Minecraft
 * or a share target. The file name is the last path segment, so receivers see
 * the real ".mcaddon" name. Read-only; access is granted per Intent.
 */
class ExportProvider : ContentProvider() {

    override fun onCreate(): Boolean = true

    private fun fileFor(uri: Uri): File {
        val ctx = context ?: throw FileNotFoundException("No context")
        val dir = File(ctx.cacheDir, DIR).canonicalFile
        val name = uri.lastPathSegment ?: throw FileNotFoundException("No name")
        val f = File(dir, name).canonicalFile
        if (f.parentFile != dir || !f.exists()) throw FileNotFoundException(name)
        return f
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
        ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.MODE_READ_ONLY)

    override fun getType(uri: Uri): String {
        val n = uri.lastPathSegment ?: ""
        return when {
            n.endsWith(".png") -> "image/png"
            n.endsWith(".json") -> "application/json"
            else -> "application/octet-stream"
        }
    }

    override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
        val f = fileFor(uri)
        val cols = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val row = cols.map { c ->
            when (c) {
                OpenableColumns.DISPLAY_NAME -> f.name
                OpenableColumns.SIZE -> f.length()
                else -> null
            }
        }
        return MatrixCursor(cols, 1).apply { addRow(row.toTypedArray()) }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = 0

    companion object {
        private const val DIR = "exports"
        const val AUTHORITY = "com.gamesforfun.mobsmith.exports"

        /** Writes bytes to cache/exports/<name> and returns its content:// Uri. */
        fun write(ctx: Context, name: String, bytes: ByteArray): Uri {
            val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "addon.mcaddon" }
            val dir = File(ctx.cacheDir, DIR).apply { mkdirs() }
            dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 86_400_000L }?.forEach { it.delete() }
            File(dir, safe).writeBytes(bytes)
            return Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(safe).build()
        }
    }
}
