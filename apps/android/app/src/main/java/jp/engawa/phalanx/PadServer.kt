package jp.engawa.phalanx

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.Context
import android.os.ParcelUuid
import java.util.UUID
import java.util.concurrent.CopyOnWriteArraySet

// Phalanx の BLE の約束事。Mac アプリ（apps/mac）にも同じ値を書く。
object Phalanx {
    val SERVICE: UUID = UUID.fromString("24794ec4-150f-4f99-9269-7d41e81b2aaf")
    val THRUST: UUID = UUID.fromString("02d2c7fa-ef23-4fba-9538-2b3308c72c27") // パッド → 画面（通知）：通し番号 1 バイト
    val STATE: UUID = UUID.fromString("a75cb108-d63a-4b03-87a6-6a905e227f34")  // 画面 → パッド（書き込み）：場面 1 バイト
    val INFO: UUID = UUID.fromString("4770b842-2625-49e7-846d-82c9097d39e6")   // 画面が読む：約束事の版
    // 通知を受け取るかどうかを相手が書き込む場所（BLE の決まりの UUID）
    val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    const val PROTOCOL: Byte = 1
    // 場面（画面 → パッド）
    val PHASES = listOf("gate", "title", "play", "win", "lose")
    // 画面のリストに出す名前。スキャン応答は 31 バイトまでで、128 ビットの UUID に 18 バイト使うので、残り 12 バイト以内
    fun label(): ByteArray {
        val bytes = android.os.Build.MODEL.toByteArray(Charsets.UTF_8)
        return if (bytes.size <= 12) bytes else bytes.copyOf(12)
    }
}

// コントローラー側（つながれる側）。電波を出し、つないできた画面に合図を通知する。
// 許可（BLUETOOTH_ADVERTISE / BLUETOOTH_CONNECT）は呼ぶ前にもらっておくこと。
@SuppressLint("MissingPermission")
class PadServer(
    private val context: Context,
    private val onStatus: (String, String) -> Unit, // 状態（waiting / linked / error）と、画面に出す短い説明
    private val onPhase: (String) -> Unit,    // 画面から場面が届いた
) {
    private val manager = context.getSystemService(BluetoothManager::class.java)
    private var server: BluetoothGattServer? = null
    private lateinit var thrustChar: BluetoothGattCharacteristic
    // Bluetooth の知らせは別のスレッドから来るので、同時に触っても壊れない集合にする
    private val subscribers = CopyOnWriteArraySet<BluetoothDevice>() // 通知を受け取ると言ってきた画面
    private val connected = CopyOnWriteArraySet<BluetoothDevice>()
    private var seq: Int = 0
    var advertising = false
        private set

    fun start() {
        val adapter = manager?.adapter
        if (adapter == null || !adapter.isEnabled) { onStatus("error", "Bluetooth がオフです"); return }
        if (server == null) openServer()
        advertise()
    }

    fun stop() {
        adapter()?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        advertising = false
        server?.close(); server = null
        subscribers.clear(); connected.clear()
    }

    // 合図を送る。つながっている画面がなければ false
    fun thrust(): Boolean {
        val s = server ?: return false
        if (subscribers.isEmpty()) return false
        seq = (seq + 1) and 0xff
        val value = byteArrayOf(seq.toByte())
        for (d in subscribers) s.notifyCharacteristicChanged(d, thrustChar, false, value)
        return true
    }

    val linkedCount: Int get() = subscribers.size

    private fun adapter() = manager?.adapter

    private fun openServer() {
        val service = BluetoothGattService(Phalanx.SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        thrustChar = BluetoothGattCharacteristic(
            Phalanx.THRUST,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ,
        ).apply {
            addDescriptor(BluetoothGattDescriptor(Phalanx.CCCD,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
        }
        val stateChar = BluetoothGattCharacteristic(
            Phalanx.STATE,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE,
        )
        val infoChar = BluetoothGattCharacteristic(
            Phalanx.INFO,
            BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ,
        )
        service.addCharacteristic(thrustChar)
        service.addCharacteristic(stateChar)
        service.addCharacteristic(infoChar)
        server = manager?.openGattServer(context, callback)
        server?.addService(service)
    }

    private fun advertise() {
        val advertiser = adapter()?.bluetoothLeAdvertiser
        if (advertiser == null) { onStatus("error", "この端末は電波を出せません"); return }
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY) // 早く見つけてもらう
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(true)
            .setTimeout(0)
            .build()
        // 本体の電波には Phalanx のサービスだけを載せ（31 バイトに収めるため）、
        // 画面のリストに出す名前は、問い合わせへの返事（スキャン応答）にサービスのデータとして載せる。
        // Bluetooth の名前は長すぎることがあり、持ち主の名前も入りがちなので使わず、機種名にする
        val data = AdvertiseData.Builder().addServiceUuid(ParcelUuid(Phalanx.SERVICE)).build()
        val response = AdvertiseData.Builder()
            .addServiceData(ParcelUuid(Phalanx.SERVICE), Phalanx.label())
            .build()
        advertiser.stopAdvertising(advertiseCallback)
        advertiser.startAdvertising(settings, data, response, advertiseCallback)
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            advertising = true; report()
        }
        override fun onStartFailure(errorCode: Int) {
            advertising = false
            onStatus("error", "電波を出せませんでした（$errorCode）")
        }
    }

    private fun report() {
        when {
            subscribers.isNotEmpty() -> onStatus("linked", "つながっています")
            connected.isNotEmpty() -> onStatus("waiting", "つないでいます…")
            advertising -> onStatus("waiting", "画面を待っています")
            else -> onStatus("waiting", "準備中…")
        }
    }

    private val callback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) connected.add(device)
            else { connected.remove(device); subscribers.remove(device) }
            report()
        }

        override fun onCharacteristicReadRequest(device: BluetoothDevice, requestId: Int, offset: Int,
                                                 characteristic: BluetoothGattCharacteristic) {
            val value = if (characteristic.uuid == Phalanx.INFO) byteArrayOf(Phalanx.PROTOCOL) else byteArrayOf()
            server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
        }

        override fun onCharacteristicWriteRequest(device: BluetoothDevice, requestId: Int,
                                                  characteristic: BluetoothGattCharacteristic,
                                                  preparedWrite: Boolean, responseNeeded: Boolean,
                                                  offset: Int, value: ByteArray?) {
            if (characteristic.uuid == Phalanx.STATE && value != null && value.isNotEmpty()) {
                Phalanx.PHASES.getOrNull(value[0].toInt())?.let(onPhase)
            }
            if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
        }

        override fun onDescriptorReadRequest(device: BluetoothDevice, requestId: Int, offset: Int,
                                             descriptor: BluetoothGattDescriptor) {
            val on = device in subscribers
            val value = if (on) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
            server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
        }

        override fun onDescriptorWriteRequest(device: BluetoothDevice, requestId: Int,
                                              descriptor: BluetoothGattDescriptor, preparedWrite: Boolean,
                                              responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            if (descriptor.uuid == Phalanx.CCCD) {
                if (value != null && value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
                    subscribers.add(device)
                } else subscribers.remove(device)
                report()
            }
            if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
        }
    }
}
