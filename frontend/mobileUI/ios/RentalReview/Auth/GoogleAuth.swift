import GoogleSignIn
import UIKit

/// Gets a Google ID token for the backend (POST /auth/google), as the web's
/// "Continue with Google" button does. The token's audience is the iOS OAuth
/// client id (Config/Google.xcconfig), which must also be listed in the
/// backend's GOOGLE_CLIENT_IDS.
enum GoogleAuth {
    enum Failure: LocalizedError {
        case notConfigured
        var errorDescription: String? { "Google sign-in isn’t set up in this build yet." }
    }

    /// The ID token, or nil if the person closed Google's sheet.
    @MainActor
    static func idToken() async throws -> String? {
        guard !AppConfig.googleClientID.isEmpty else { throw Failure.notConfigured }
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: AppConfig.googleClientID)
        guard let presenter = UIApplication.shared.connectedScenes
            .compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController }).first else { return nil }
        do {
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: topmost(presenter))
            return result.user.idToken?.tokenString
        } catch let error as NSError where error.code == GIDSignInError.canceled.rawValue {
            return nil
        }
    }

    /// Forget the chosen Google account, so the next sign-in asks again.
    static func signOut() { GIDSignIn.sharedInstance.signOut() }

    private static func topmost(_ controller: UIViewController) -> UIViewController {
        var top = controller
        while let presented = top.presentedViewController { top = presented }
        return top
    }
}
