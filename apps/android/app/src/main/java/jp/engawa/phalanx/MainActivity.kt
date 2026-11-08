package jp.engawa.phalanx

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

// コントローラーの画面は WebView で ble-pad.html（pad.html のコピー）を出す。
// ボタン・突き出し・声の見分け方はページの部品をそのまま使い、合図の送り先だけを Bluetooth にする。
//   ページ → アプリ：Android.thrust()（合図）、Android.status() / statusText()（今の状態）
//   アプリ → ページ：phalanxPad.setStatus(状態, 説明)、phalanxPad.setPhase(場面)
class MainActivity : Activity() {
    private lateinit var pad: PadServer
    private lateinit var web: WebView
    private var status = "waiting"
    private var statusText = "準備中…"
    private var phase = "gate"
    private var pendingMic: PermissionRequest? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) // 遊んでいる間は画面を消さない

        pad = PadServer(
            this,
            onStatus = { s, text -> runOnUiThread { status = s; statusText = text; pushStatus() } },
            onPhase = { p -> runOnUiThread { phase = p; pushPhase() } },
        )

        web = WebView(this).apply {
            setBackgroundColor(Color.rgb(0x1a, 0x14, 0x0e))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            addJavascriptInterface(Bridge(), "Android")
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) { pushStatus(); pushPhase() }
            }
            webChromeClient = object : WebChromeClient() {
                // ページがマイクを求めたら、アプリのマイクの許可を確かめてから通す
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE !in request.resources) { request.deny(); return@runOnUiThread }
                        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                        } else {
                            pendingMic = request
                            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
                        }
                    }
                }
            }
        }
        setContentView(web)
        web.loadUrl(pageUrl())

        if (hasBlePermissions()) pad.start()
        else requestPermissions(BLE_PERMISSIONS + Manifest.permission.RECORD_AUDIO, REQ_BLE)
    }

    // 読み込むページ。ふだんは公開サイト。開発中は起動時に手元のサーバーへ切り替える：
    //   adb reverse tcp:8765 tcp:8765
    //   adb shell am start -n jp.engawa.phalanx/.MainActivity --es url http://localhost:8765/ble-pad.html
    private fun pageUrl(): String =
        intent.getStringExtra("url") ?: "https://okuyamashin.github.io/phalanx/ble-pad.html"

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_BLE) {
            if (hasBlePermissions()) pad.start() else { status = "error"; statusText = "Bluetooth の許可が必要です"; pushStatus() }
        }
        if (requestCode == REQ_MIC) {
            val r = pendingMic ?: return
            pendingMic = null
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                r.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            } else r.deny()
        }
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        // Bluetooth をオンにして戻ってきたときなど
        if (hasBlePermissions() && !pad.advertising) pad.start()
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (hasBlePermissions()) pad.stop()
        web.destroy()
        super.onDestroy()
    }

    private fun hasBlePermissions() = BLE_PERMISSIONS.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    private fun pushStatus() {
        web.evaluateJavascript(
            "window.phalanxPad && phalanxPad.setStatus(${JSONObject.quote(status)}, ${JSONObject.quote(statusText)})", null)
    }

    private fun pushPhase() {
        web.evaluateJavascript("window.phalanxPad && phalanxPad.setPhase(${JSONObject.quote(phase)})", null)
    }

    // ページから呼ばれる（ページの JavaScript のスレッドで動く）
    inner class Bridge {
        @JavascriptInterface
        fun thrust(): Boolean {
            val ok = pad.thrust()
            if (ok) getSystemService(Vibrator::class.java)
                ?.vibrate(VibrationEffect.createOneShot(15, VibrationEffect.DEFAULT_AMPLITUDE))
            return ok
        }

        @JavascriptInterface fun status(): String = status
        @JavascriptInterface fun statusText(): String = statusText
    }

    companion object {
        private const val REQ_BLE = 1
        private const val REQ_MIC = 2
        val BLE_PERMISSIONS = arrayOf(Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
    }
}
