import Foundation

/// Values set per build in the Xcode project (see Config/Info.plist).
enum AppConfig {
    private static func value(_ key: String) -> String {
        (Bundle.main.object(forInfoDictionaryKey: key) as? String)?
            .trimmingCharacters(in: .whitespaces) ?? ""
    }

    /// Debug: the local stack's web container (it proxies /api). Release: the site.
    static var apiBaseURL: String { value("APIBaseURL").isEmpty ? "https://rentalreview.boringman.in" : value("APIBaseURL") }

    /// The public site: legal pages open here.
    static let siteURL = "https://rentalreview.boringman.in"

    /// The iOS OAuth client id; empty until set in Config/Google.xcconfig.
    static var googleClientID: String { value("GIDClientID") }
}
