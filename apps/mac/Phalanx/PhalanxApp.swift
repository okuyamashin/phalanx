import SwiftUI

@main
struct PhalanxApp: App {
    @StateObject private var central = Central()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(central)
                .frame(minWidth: 640, minHeight: 400)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1280, height: 800)
    }
}
