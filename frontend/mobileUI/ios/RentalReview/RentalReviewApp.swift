import GoogleSignIn
import SwiftUI

@main
struct RentalReviewApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                // Google's sign-in sheet returns to the app through this URL.
                .onOpenURL { GIDSignIn.sharedInstance.handle($0) }
        }
    }
}

/// Home, the map screen or the notebook, with a place's details over them.
/// Details cover the screen rather than replace it, so the map underneath
/// (when there is one) stays alive and is not recreated on the way back.
struct ContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            switch model.screen {
            case .home: HomeView()
            case .map: MapScreen()
            case .notebook: NotebookView()
            }
        }
        .modifier(AppChrome(active: model.selected == nil, toastBottom: model.screen == .map ? 24 : 92))
        .fullScreenCover(isPresented: Binding(get: { model.selected != nil }, set: { if !$0 { model.closePlace() } })) {
            PlaceDetails().environmentObject(model)
        }
        .tint(Brand.ink)
        .preferredColorScheme(.light)
    }
}
