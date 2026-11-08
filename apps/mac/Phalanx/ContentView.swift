import SwiftUI

// 段階2：ゲームはまだ入れない。近くのコントローラーのリストと、届いた合図の数だけを出す。
// 段階3で、後ろに WebView（ble.html）を敷き、このリストを入口とタイトルの画面に重ねる。
struct ContentView: View {
    @EnvironmentObject var central: Central
    @State private var flash = false

    private let bg = Color(red: 0x1a / 255, green: 0x14 / 255, blue: 0x0e / 255)
    private let gold = Color(red: 0xe0 / 255, green: 0xb2 / 255, blue: 0x5a / 255)
    private let fg = Color(red: 0xf2 / 255, green: 0xe8 / 255, blue: 0xd2 / 255)

    var body: some View {
        ZStack {
            bg.ignoresSafeArea()
            VStack(spacing: 28) {
                Text("PHALANX")
                    .font(.system(size: 54, weight: .semibold, design: .serif))
                    .tracking(6)
                    .foregroundColor(gold)
                status
                if central.linkedName != nil { counter } else { padList }
            }
            .padding(40)
        }
        .onAppear { central.onThrust = { pulse() } }
    }

    // 今のつながりの状態
    private var status: some View {
        HStack(spacing: 8) {
            Circle().fill(dotColor).frame(width: 9, height: 9)
            Text(statusText).font(.system(size: 13, design: .monospaced)).foregroundColor(fg.opacity(0.7))
            if central.linkedName != nil {
                Button("切る") { central.disconnect() }
                    .buttonStyle(.plain).font(.system(size: 12)).foregroundColor(gold.opacity(0.8))
                    .padding(.leading, 8)
            }
        }
    }

    private var statusText: String {
        switch central.link {
        case .off(let why): return why
        case .scanning: return central.pads.isEmpty ? "近くのコントローラーを探しています…" : "つなぐコントローラーを選んでください"
        case .connecting(let n): return "\(n) につないでいます…"
        case .linked(let n): return "\(n) とつながっています"
        case .reconnecting(let n): return "\(n) につなぎ直しています…"
        }
    }

    private var dotColor: Color {
        switch central.link {
        case .linked: return .green
        case .off: return .red
        default: return gold
        }
    }

    // 近くのコントローラー。近いもの（電波が強いもの）ほど上に、はっきり出す
    private var padList: some View {
        VStack(spacing: 10) {
            ForEach(central.pads) { pad in
                Button { central.connect(pad.id) } label: {
                    HStack {
                        Image(systemName: "iphone.radiowaves.left.and.right")
                        Text(pad.name).font(.system(size: 17, weight: .medium))
                        Spacer()
                        Text(pad.isNear ? "近い" : "").font(.system(size: 12)).foregroundColor(gold)
                        Text("\(Int(pad.rssi)) dBm").font(.system(size: 11, design: .monospaced)).opacity(0.5)
                    }
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .frame(width: 380)
                    .background(RoundedRectangle(cornerRadius: 10).stroke(gold.opacity(pad.isNear ? 0.9 : 0.3), lineWidth: 1.5))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundColor(fg)
                .opacity(pad.isNear ? 1 : 0.5)
            }
        }
        .animation(.easeOut(duration: 0.25), value: central.pads)
    }

    // 届いた合図の数。届くたびに光る
    private var counter: some View {
        VStack(spacing: 8) {
            Text("\(central.thrustCount)")
                .font(.system(size: 96, weight: .light, design: .serif))
                .foregroundColor(flash ? .white : gold)
                .scaleEffect(flash ? 1.12 : 1)
            Text("合図").font(.system(size: 12)).foregroundColor(fg.opacity(0.5))
        }
    }

    private func pulse() {
        withAnimation(.easeOut(duration: 0.05)) { flash = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            withAnimation(.easeOut(duration: 0.25)) { flash = false }
        }
    }
}
