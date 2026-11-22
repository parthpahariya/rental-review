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

struct ContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack(alignment: .bottom) {
            switch model.screen {
            case .home: HomeView()
            case .explore: ExploreView()
            case .notebook: NotebookView()
            }
            if let message = model.message {
                Text(message).foregroundStyle(.white).padding(.horizontal, 16).padding(.vertical, 12)
                    .background(Brand.ink, in: RoundedRectangle(cornerRadius: 12)).padding(.bottom, 24).padding(.horizontal, 16)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: message) {
                        try? await pause(milliseconds: 3000)
                        if model.message == message { model.message = nil }
                    }
            }
        }
        .animation(.default, value: model.message)
        .alert("Reactivate your account?", isPresented: $model.reactivationPending) {
            Button("Reactivate") { model.confirmReactivation(true) }
            Button("Cancel", role: .cancel) { model.confirmReactivation(false) }
        } message: {
            Text("This account was deactivated. Reactivate it to sign in; your reviews are unchanged.")
        }
        .tint(Brand.ink)
    }
}
