import SwiftUI

// 後ろにゲーム（WebView の ble.html）を敷き、その上にコントローラーのリストを重ねる。
// リストは入口とタイトルの画面でだけ出し、戦闘中はつながりの小さな印だけにする。
struct ContentView: View {
    @EnvironmentObject var central: Central
    @StateObject private var game = GameBridge()

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            GameView(
                url: GameBridge.pageURL,
                game: game,
                panel: PadPanel(central: central, game: game),
                mark: LinkMark(central: central),
                showPanel: game.phase == "gate" || game.phase == "title"
            )
            .ignoresSafeArea()
        }
        .onAppear { central.onThrust = { [weak game] in game?.thrust() } }
        .onChange(of: game.phase) { p in central.send(phase: p) }
    }
}

enum Theme {
    static let bg = Color(red: 0x1a / 255, green: 0x14 / 255, blue: 0x0e / 255)
    static let gold = Color(red: 0xe0 / 255, green: 0xb2 / 255, blue: 0x5a / 255)
    static let fg = Color(red: 0xf2 / 255, green: 0xe8 / 255, blue: 0xd2 / 255)

    static func dot(_ link: Central.Link) -> Color {
        switch link {
        case .linked: return .green
        case .off: return .red
        default: return gold
        }
    }
}

// 入口とタイトルの画面（右下）：つながっていなければリスト、つながっていれば相手の名前
struct PadPanel: View {
    @ObservedObject var central: Central
    @ObservedObject var game: GameBridge

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if let err = game.loadError {
                Text("ページを読めません：\(err)").font(.system(size: 11)).foregroundColor(.red).frame(maxWidth: 280, alignment: .trailing)
            }
            status
            if central.linkedName == nil {
                ForEach(central.pads) { pad in row(pad) }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.black.opacity(0.45)))
        .fixedSize()
    }

    private var status: some View {
        HStack(spacing: 8) {
            Circle().fill(Theme.dot(central.link)).frame(width: 8, height: 8)
            Text(statusText).font(.system(size: 12, design: .monospaced)).foregroundColor(Theme.fg.opacity(0.75))
            if central.linkedName != nil {
                Button("切る") { central.disconnect(); game.focus() }
                    .buttonStyle(.plain).font(.system(size: 11)).foregroundColor(Theme.gold.opacity(0.8))
                    .padding(.leading, 6)
            }
        }
    }

    private var statusText: String {
        switch central.link {
        case .off(let why): return why
        case .scanning: return central.pads.isEmpty ? "コントローラーを探しています…" : "つなぐコントローラーを選ぶ"
        case .connecting(let n): return "\(n) につないでいます…"
        case .linked(let n): return n
        case .reconnecting(let n): return "\(n) につなぎ直しています…"
        }
    }

    private func row(_ pad: FoundPad) -> some View {
        Button { central.connect(pad.id); game.focus() } label: {
            HStack(spacing: 10) {
                Image(systemName: "iphone.radiowaves.left.and.right")
                Text(pad.name).font(.system(size: 15, weight: .medium))
                Spacer(minLength: 16)
                if pad.isNear { Text("近い").font(.system(size: 11)).foregroundColor(Theme.gold) }
                Text("\(Int(pad.rssi))").font(.system(size: 10, design: .monospaced)).opacity(0.45)
            }
            .padding(.horizontal, 14).padding(.vertical, 9)
            .frame(width: 280)
            .background(RoundedRectangle(cornerRadius: 9).stroke(Theme.gold.opacity(pad.isNear ? 0.9 : 0.3), lineWidth: 1.2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundColor(Theme.fg)
        .opacity(pad.isNear ? 1 : 0.55)
    }
}

// 戦闘中・勝ち負けの画面（右上）：つながりの小さな印だけ
struct LinkMark: View {
    @ObservedObject var central: Central

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(Theme.dot(central.link)).frame(width: 7, height: 7)
            if let n = central.linkedName {
                Text(n).font(.system(size: 11, design: .monospaced)).foregroundColor(Theme.fg.opacity(0.6))
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .opacity(shown ? 1 : 0)
        .fixedSize()
    }

    private var shown: Bool {
        switch central.link {
        case .linked, .connecting, .reconnecting: return true
        default: return false
        }
    }
}
