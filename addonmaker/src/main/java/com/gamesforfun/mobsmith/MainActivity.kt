package com.gamesforfun.mobsmith

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import org.json.JSONObject

/**
 * Hosts the Mobsmith editor (a bundled web app in assets/www) in a WebView and
 * exposes a small bridge for things the web page can't do on its own:
 * saving files through the system picker, handing an .mcaddon to Minecraft,
 * sharing, opening links and copying text.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingSaveId: String? = null
    private var pendingSaveBytes: ByteArray? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION")
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            textZoom = 100
            loadWithOverviewMode = true
            useWideViewPort = true
        }
        web.setBackgroundColor(0xFF0F1720.toInt())
        web.addJavascriptInterface(Bridge(), "MobsmithAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.scheme == "http" || url.scheme == "https") {
                    openExternal(url)
                    return true
                }
                return false
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val wantsImage = params.acceptTypes.any { it.startsWith("image/") }
                val intent = Intent(Intent.ACTION_GET_CONTENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(if (wantsImage) "image/*" else "*/*")
                return try {
                    startActivityForResult(Intent.createChooser(intent, null), REQ_PICK)
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }

            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.d("Mobsmith", "${msg.messageLevel()} ${msg.message()} @${msg.sourceId()}:${msg.lineNumber()}")
                return true
            }
        }
        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("file:///android_asset/www/index.html")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        web.evaluateJavascript("window.mobsmithPause && window.mobsmithPause()", null)
        web.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    @Deprecated("Still delivered when the predictive back callback is not enabled")
    override fun onBackPressed() {
        web.evaluateJavascript("window.mobsmithBack ? window.mobsmithBack() : 'exit'") { result ->
            if (result == null || result.contains("exit")) {
                @Suppress("DEPRECATION")
                super.onBackPressed()
            }
        }
    }

    @Deprecated("Uses the platform result API (no AndroidX dependency)")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_PICK -> {
                val cb = fileCallback
                fileCallback = null
                val uri = data?.data
                cb?.onReceiveValue(if (resultCode == RESULT_OK && uri != null) arrayOf(uri) else null)
            }
            REQ_SAVE -> {
                val id = pendingSaveId ?: return
                val bytes = pendingSaveBytes
                pendingSaveId = null
                pendingSaveBytes = null
                val uri = data?.data
                if (resultCode != RESULT_OK || uri == null || bytes == null) {
                    notifyJs(id, false, "Save cancelled")
                    return
                }
                try {
                    contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes) }
                        ?: throw IllegalStateException("Could not open the file")
                    notifyJs(id, true, "Saved")
                } catch (e: Exception) {
                    notifyJs(id, false, "Save failed: ${e.message}")
                }
            }
        }
    }

    private fun notifyJs(id: String, ok: Boolean, msg: String) {
        val js = "window.__mobsmithNative && window.__mobsmithNative(${JSONObject.quote(id)}, $ok, ${JSONObject.quote(msg)})"
        runOnUiThread { web.evaluateJavascript(js, null) }
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "No browser found", Toast.LENGTH_SHORT).show()
        }
    }

    private fun writeExport(name: String, base64: String): Uri {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        return ExportProvider.write(this, name, bytes)
    }

    private inner class Bridge {
        @JavascriptInterface
        fun saveFile(id: String, name: String, base64: String, mime: String) {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            runOnUiThread {
                pendingSaveId = id
                pendingSaveBytes = bytes
                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime.ifBlank { "application/octet-stream" })
                    .putExtra(Intent.EXTRA_TITLE, name)
                try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(intent, REQ_SAVE)
                } catch (e: ActivityNotFoundException) {
                    pendingSaveId = null
                    pendingSaveBytes = null
                    notifyJs(id, false, "No file picker available on this device")
                }
            }
        }

        /** Hands the add-on to Minecraft, which imports .mcaddon/.mcpack files it is given. */
        @JavascriptInterface
        fun openInGame(name: String, base64: String): String {
            val uri = try {
                writeExport(name, base64)
            } catch (e: Exception) {
                return "Could not prepare the file: ${e.message}"
            }
            val hasGame = packageManager.getLaunchIntentForPackage(MINECRAFT) != null
            val view = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/octet-stream")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            if (hasGame) view.setPackage(MINECRAFT)
            return try {
                runOnUiThread {
                    try {
                        startActivity(if (hasGame) view else Intent.createChooser(view, "Open add-on with"))
                    } catch (e: ActivityNotFoundException) {
                        Toast.makeText(this@MainActivity, "Minecraft didn't accept the file. Use Save instead.", Toast.LENGTH_LONG).show()
                    }
                }
                if (hasGame) "ok" else "Minecraft isn't installed. Choose an app to open the file, or use Save."
            } catch (e: Exception) {
                "Could not open Minecraft: ${e.message}"
            }
        }

        @JavascriptInterface
        fun shareFile(name: String, base64: String, mime: String) {
            val uri = writeExport(name, base64)
            val send = Intent(Intent.ACTION_SEND)
                .setType(mime.ifBlank { "application/octet-stream" })
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            send.clipData = ClipData.newRawUri(name, uri)
            runOnUiThread { startActivity(Intent.createChooser(send, "Share $name")) }
        }

        @JavascriptInterface
        fun openUrl(url: String) {
            runOnUiThread { openExternal(Uri.parse(url)) }
        }

        @JavascriptInterface
        fun copyText(text: String) {
            runOnUiThread {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("Mobsmith", text))
            }
        }

        @JavascriptInterface
        fun version(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
        } catch (e: Exception) {
            "?"
        }
    }

    companion object {
        private const val REQ_PICK = 41
        private const val REQ_SAVE = 42
        private const val MINECRAFT = "com.mojang.minecraftpe"
    }
}
