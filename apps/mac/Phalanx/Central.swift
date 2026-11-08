import CoreBluetooth
import Foundation

// Phalanx の BLE の約束事。Pixel アプリ（apps/android の PadServer.kt）と同じ値。
enum PhalanxBLE {
    static let service = CBUUID(string: "24794ec4-150f-4f99-9269-7d41e81b2aaf")
    static let thrust = CBUUID(string: "02d2c7fa-ef23-4fba-9538-2b3308c72c27") // パッド → 画面（通知）：通し番号 1 バイト
    static let state = CBUUID(string: "a75cb108-d63a-4b03-87a6-6a905e227f34")  // 画面 → パッド（書き込み）：場面 1 バイト
    static let info = CBUUID(string: "4770b842-2625-49e7-846d-82c9097d39e6")   // 画面が読む：約束事の版
    static let protocolVersion: UInt8 = 1
    static let phases = ["gate", "title", "play", "win", "lose"]
}

// 近くで見つけたコントローラー
struct FoundPad: Identifiable, Equatable {
    let id: UUID
    var name: String
    var rssi: Double      // 電波の強さ（ならした値、dBm）。大きいほど近い
    var lastSeen: Date
    var isNear: Bool { rssi > -60 } // 目安で 1m 前後。実機で合わせる
}

// 画面側（つなぎに行く側）。近くのコントローラーを探し、選んだものにつないで合図を受け取る。
final class Central: NSObject, ObservableObject {
    enum Link: Equatable {
        case off(String)          // Bluetooth が使えない（理由）
        case scanning             // 探している
        case connecting(String)   // つないでいる（名前）
        case linked(String)       // つながった（名前）
        case reconnecting(String) // 切れたのでつなぎ直している（名前）
    }

    @Published private(set) var pads: [FoundPad] = []
    @Published private(set) var link: Link = .off("準備中")
    @Published private(set) var thrustCount = 0

    // 合図が届いたとき（ゲームに渡す）
    var onThrust: () -> Void = {}

    private var manager: CBCentralManager!
    private var peripherals: [UUID: CBPeripheral] = [:]
    private var target: CBPeripheral?          // つなぐと決めた相手
    private var targetName: String?            // その名前（相手の住所が変わったときに探し直すため）
    private var attemptStart: Date?            // つなぎに行き始めた時刻
    private var stateChar: CBCharacteristic?
    private var lastSeq: UInt8?
    private var pruneTimer: Timer?
    private var currentPhase: UInt8 = 0

    override init() {
        super.init()
        manager = CBCentralManager(delegate: self, queue: .main)
        // しばらく電波が届かないものはリストから消す
        pruneTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.prune() }
    }

    var linkedName: String? { if case .linked(let n) = link { return n }; return nil }

    func connect(_ id: UUID) {
        guard let p = peripherals[id] else { return }
        if let t = target, t.identifier != id { manager.cancelPeripheralConnection(t) }
        target = p
        targetName = name(of: p)
        attemptStart = Date()
        lastSeq = nil
        link = .connecting(name(of: p))
        log("つなぐ: \(name(of: p)) \(p.identifier) state=\(p.state.rawValue)")
        manager.connect(p)
    }

    func disconnect() {
        guard let t = target else { return }
        target = nil; targetName = nil; attemptStart = nil
        manager.cancelPeripheralConnection(t)
        link = .scanning
        startScan()
    }

    // 場面をコントローラーに伝える（ボタンの絵が変わる）
    func send(phase: String) {
        guard let i = PhalanxBLE.phases.firstIndex(of: phase) else { return }
        currentPhase = UInt8(i)
        writePhase()
    }

    private func writePhase() {
        guard let p = target, p.state == .connected, let c = stateChar else { return }
        p.writeValue(Data([currentPhase]), for: c, type: .withoutResponse)
    }

    private func startScan() {
        guard manager.state == .poweredOn, !manager.isScanning else { return }
        // 同じ相手の電波も毎回受け取る（電波の強さを更新するため）
        manager.scanForPeripherals(withServices: [PhalanxBLE.service],
                                   options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    }

    private func prune() {
        let now = Date()
        let linkedId = target?.state == .connected ? target?.identifier : nil
        let kept = pads.filter { now.timeIntervalSince($0.lastSeen) < 4 || $0.id == linkedId }
        if kept.count != pads.count { pads = kept }
        // 最初のつなぎ込みが 8 秒たっても終わらなければ、あきらめてリストに戻る
        if case .connecting = link, let t = target, t.state != .connected,
           let s = attemptStart, now.timeIntervalSince(s) > 8 {
            log("つながらないので、あきらめる")
            disconnect()
        }
    }

    // つなぎに行っている相手が、住所を変えて出直していたら（Android はアプリを起動し直すと
    // 電波の住所が変わる）、同じ名前の新しい相手につなぎ直す
    private func followRenamed(_ p: CBPeripheral, label: String) {
        guard let t = target, t.state != .connected, t.identifier != p.identifier,
              label == targetName else { return }
        let oldSeen = pads.first(where: { $0.id == t.identifier })?.lastSeen ?? .distantPast
        guard Date().timeIntervalSince(oldSeen) > 2 else { return } // 古いほうがまだ聞こえるなら待つ
        log("住所が変わった相手につなぎ直す: \(label)")
        manager.cancelPeripheralConnection(t)
        target = p
        attemptStart = Date()
        manager.connect(p)
    }

    private func name(of p: CBPeripheral) -> String {
        pads.first(where: { $0.id == p.identifier })?.name ?? (p == target ? targetName : nil) ?? p.name ?? "Phalanx"
    }

    // 動きの記録。原因を調べるため、アプリの保管場所の phalanx.log にも書く
    // （~/Library/Containers/jp.engawa.phalanx/Data/Library/Application Support/phalanx.log）
    func log(_ s: String) {
        let line = "\(Self.stamp.string(from: Date())) \(s)\n"
        #if DEBUG
        print("[Phalanx]", s)
        #endif
        guard let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("phalanx.log")
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close()
        } else {
            try? line.data(using: .utf8)!.write(to: url)
        }
    }
    private static let stamp: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm:ss.SSS"; return f }()
}

extension Central: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        log("Bluetooth の状態: \(central.state.rawValue)")
        switch central.state {
        case .poweredOn:
            link = target.map { .reconnecting(name(of: $0)) } ?? .scanning
            startScan()
            if let t = target { central.connect(t) }
        case .poweredOff: link = .off("Bluetooth がオフです")
        case .unauthorized: link = .off("Bluetooth の使用が許可されていません")
        case .unsupported: link = .off("この Mac は Bluetooth LE を使えません")
        default: link = .off("準備中")
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let r = RSSI.doubleValue
        guard r < 0 else { return } // 127 は「測れなかった」
        peripherals[peripheral.identifier] = peripheral
        // 名前：コントローラーがスキャン応答のサービスデータに載せた機種名
        var label = peripheral.name ?? "Phalanx"
        if let sd = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data],
           let d = sd[PhalanxBLE.service], let s = String(data: d, encoding: .utf8), !s.isEmpty {
            label = s
        }
        if let i = pads.firstIndex(where: { $0.id == peripheral.identifier }) {
            pads[i].rssi += (r - pads[i].rssi) * 0.3 // 揺れが大きいので、ならす
            pads[i].lastSeen = Date()
            if label != "Phalanx" { pads[i].name = label }
        } else {
            pads.append(FoundPad(id: peripheral.identifier, name: label, rssi: r, lastSeen: Date()))
            log("見つけた: \(label) \(peripheral.identifier) \(Int(r))dBm")
        }
        pads.sort { $0.rssi > $1.rssi }
        followRenamed(peripheral, label: label)
        // 確かめる用：起動の引数 -autoconnect "Pixel 4 XL" で、その名前の相手に自動でつなぐ
        if target == nil, let want = UserDefaults.standard.string(forKey: "autoconnect"), want == label {
            connect(peripheral.identifier)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard peripheral == target else { central.cancelPeripheralConnection(peripheral); return }
        log("つながった。サービスを探す")
        peripheral.delegate = self
        peripheral.discoverServices([PhalanxBLE.service])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard peripheral == target else { return }
        log("つなげなかった: \(error?.localizedDescription ?? "-")")
        link = .reconnecting(name(of: peripheral))
        central.connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        stateChar = nil
        guard peripheral == target else { return }
        // 切れたら、同じ相手につなぎ直す（Mac の接続の依頼は、相手が戻るまで待ち続ける）
        log("切れた: \(error?.localizedDescription ?? "-")")
        link = .reconnecting(name(of: peripheral))
        central.connect(peripheral)
    }
}

extension Central: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        log("サービス: \(peripheral.services?.map { $0.uuid.uuidString } ?? []) error=\(error?.localizedDescription ?? "-")")
        guard let s = peripheral.services?.first(where: { $0.uuid == PhalanxBLE.service }) else {
            log("Phalanx のサービスがない"); manager.cancelPeripheralConnection(peripheral); return
        }
        peripheral.discoverCharacteristics([PhalanxBLE.thrust, PhalanxBLE.state, PhalanxBLE.info], for: s)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        log("特性: \(service.characteristics?.map { $0.uuid.uuidString } ?? []) error=\(error?.localizedDescription ?? "-")")
        for c in service.characteristics ?? [] {
            switch c.uuid {
            case PhalanxBLE.info: peripheral.readValue(for: c)   // 版を確かめる
            case PhalanxBLE.state: stateChar = c
            default: break
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        if let error { log("読めない: \(characteristic.uuid.uuidString) \(error.localizedDescription)") }
        guard let data = characteristic.value, let b = data.first else { return }
        switch characteristic.uuid {
        case PhalanxBLE.info:
            guard b == PhalanxBLE.protocolVersion else {
                log("約束事の版が違う: \(b)"); disconnect(); link = .off("コントローラーの版が違います"); return
            }
            // 版が合えば、合図の通知を受け取る
            if let t = peripheral.services?.first?.characteristics?.first(where: { $0.uuid == PhalanxBLE.thrust }) {
                peripheral.setNotifyValue(true, for: t)
            }
        case PhalanxBLE.thrust:
            if b == lastSeq { return } // 同じ合図は1回だけ
            lastSeq = b
            thrustCount += 1
            onThrust()
        default: break
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        log("通知の設定: \(characteristic.uuid.uuidString) on=\(characteristic.isNotifying) error=\(error?.localizedDescription ?? "-")")
        guard characteristic.uuid == PhalanxBLE.thrust, characteristic.isNotifying else { return }
        log("合図を受け取れる")
        link = .linked(name(of: peripheral))
        writePhase() // つながった直後に今の場面を伝える
    }
}
