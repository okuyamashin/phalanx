package jp.engawa.phalanx

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView

// 段階1：ボタン1つの仮の画面。押すと、つないできた画面（Mac アプリ）に合図を通知する。
// 段階4で、中身を WebView（ble-pad.html）に置き換える。
class MainActivity : Activity() {
    private lateinit var pad: PadServer
    private lateinit var statusView: TextView
    private lateinit var button: TextView
    private var phase = "gate"

    private val gold = Color.rgb(0xe0, 0xb2, 0x5a)
    private val faces = mapOf("gate" to "⟡", "title" to "ΑΡΧΗ", "play" to "⟶", "win" to "ΝΙΚΗ ↻", "lose" to "ΗΤΤΑ ↻")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) // 遊んでいる間は画面を消さない
        buildViews()
        pad = PadServer(
            this,
            onStatus = { s -> runOnUiThread { statusView.text = s; refreshButton() } },
            onPhase = { p -> runOnUiThread { phase = p; refreshButton() } },
        )
        if (hasPermissions()) pad.start()
        else requestPermissions(PERMISSIONS, 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (hasPermissions()) pad.start()
        else statusView.text = "Bluetooth の許可が必要です"
    }

    override fun onResume() {
        super.onResume()
        // Bluetooth をオンにして戻ってきたときなど
        if (hasPermissions() && !pad.advertising) pad.start()
    }

    override fun onDestroy() {
        if (hasPermissions()) pad.stop()
        super.onDestroy()
    }

    private fun hasPermissions() = PERMISSIONS.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    private fun buildViews() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(0x1a, 0x14, 0x0e)) }
        statusView = TextView(this).apply {
            setTextColor(Color.argb(0xaa, 0xf2, 0xe8, 0xd2)); textSize = 14f; gravity = Gravity.CENTER
            text = "準備中…"
        }
        root.addView(statusView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP).apply { topMargin = 48 })

        val size = (resources.displayMetrics.widthPixels * 0.78).toInt()
        button = TextView(this).apply {
            gravity = Gravity.CENTER; setTextColor(gold); textSize = 44f
            typeface = Typeface.SERIF
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.rgb(0x3a, 0x28, 0x14)); setStroke(6, gold)
            }
            setOnTouchListener { v, e ->
                // 押した瞬間に送る（離したときではない）
                if (e.actionMasked == MotionEvent.ACTION_DOWN) fire()
                if (e.actionMasked == MotionEvent.ACTION_UP) v.performClick()
                true
            }
        }
        root.addView(button, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
        setContentView(root)
        refreshButton()
    }

    private fun refreshButton() {
        val linked = ::pad.isInitialized && pad.linkedCount > 0
        button.text = if (linked) faces[phase] ?: "⟡" else "⟡"
        button.alpha = if (linked) 1f else 0.35f
    }

    private fun fire() {
        if (!pad.thrust()) return
        button.animate().cancel()
        button.scaleX = 0.94f; button.scaleY = 0.94f
        button.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
        getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createOneShot(15, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    companion object {
        val PERMISSIONS = arrayOf(Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
    }
}
