import SwiftUI
import WebKit

// ゲームの画面（ble.html）を出す WebView と、その上に重ねるパネル。
//
// Mac の SwiftUI では、WebView のような AppKit の部品がクリックを先に受け取ってしまい、
// SwiftUI で上に重ねたボタンが押せない。そこで、パネルは別の部品（NSHostingView）にして
// WebView の上に置き、パネルの大きさだけを占めるようにする（それ以外のクリックはゲームに届く）。
struct GameView<Panel: View, Mark: View>: NSViewRepresentable {
    let url: URL
    let game: GameBridge
    let panel: Panel        // 右下：コントローラーのリスト
    let mark: Mark          // 右上：つながりの印
    let showPanel: Bool

    func makeNSView(context: Context) -> NSView {
        let root = NSView()

        let config = WKWebViewConfiguration()
        // 操作がなくても音を鳴らしてよい（Web 版の「♪ CLICK」が要らなくなる）
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(context.coordinator, name: "phalanx")
        let web = WKWebView(frame: .zero, configuration: config)
        web.setValue(false, forKey: "drawsBackground") // 読み込み中に白く光らないように
        web.navigationDelegate = context.coordinator
        web.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(web)
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            web.topAnchor.constraint(equalTo: root.topAnchor),
            web.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])

        let panelHost = NSHostingView(rootView: panel)
        let markHost = NSHostingView(rootView: mark)
        for h in [panelHost, markHost] {
            h.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(h) // WebView より後に足すので上に来る
        }
        NSLayoutConstraint.activate([
            panelHost.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -20),
            panelHost.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -20),
            markHost.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -16),
            markHost.topAnchor.constraint(equalTo: root.topAnchor, constant: 44),
        ])
        context.coordinator.panelHost = panelHost
        context.coordinator.markHost = markHost

        game.webView = web
        web.load(URLRequest(url: url))
        return root
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.panelHost?.rootView = panel
        context.coordinator.markHost?.rootView = mark
        context.coordinator.panelHost?.isHidden = !showPanel
        context.coordinator.markHost?.isHidden = showPanel
    }

    func makeCoordinator() -> Coordinator { Coordinator(game: game) }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let game: GameBridge
        var panelHost: NSHostingView<Panel>?
        var markHost: NSHostingView<Mark>?
        init(game: GameBridge) { self.game = game }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let phase = body["phase"] as? String else { return }
            game.phase = phase
        }

        // ページが読めなかったときは、パネルに理由を出す
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            game.loadError = error.localizedDescription
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            game.loadError = error.localizedDescription
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            game.loadError = nil
            game.focus()
        }
    }
}

// ページとアプリの間の取り次ぎ
final class GameBridge: ObservableObject {
    weak var webView: WKWebView?
    // ページの場面（gate / title / play / win / lose）
    @Published var phase = "gate"
    // ページが読めなかった理由（読めたら nil）
    @Published var loadError: String?

    // リストをクリックしたあとも、スペースキーがゲームに届くようにする
    func focus() {
        DispatchQueue.main.async { [weak self] in
            guard let w = self?.webView else { return }
            w.window?.makeFirstResponder(w)
        }
    }

    func thrust() {
        webView?.evaluateJavaScript("window.phalanxInput && window.phalanxInput.thrust()")
    }

    // 読み込むページ。ふだんは公開サイト。開発中は起動時の引数で手元のサーバーに切り替える：
    //   open Phalanx.app --args -url http://localhost:8765/ble.html
    static var pageURL: URL {
        if let s = UserDefaults.standard.string(forKey: "url"), let u = URL(string: s) { return u }
        return URL(string: "https://okuyamashin.github.io/phalanx/ble.html")!
    }
}
