import Foundation
import MapLibre

/// One map provider (chosen by the server's MAP_PROVIDER, see GET /map/config):
/// the style MapLibre draws, the credit it requires, and its place search.
/// The same two providers as the web app: Ola Maps and OpenStreetMap.
enum MapProvider {
    case ola(apiKey: String)
    case osm

    init(config: MapConfig) {
        if config.provider == "ola", let key = config.api_key, !key.isEmpty { self = .ola(apiKey: key) } else { self = .osm }
    }

    var attribution: String {
        switch self {
        case .ola: return "© Ola Maps © OpenStreetMap"
        case .osm: return "© OpenStreetMap contributors"
        }
    }

    var search: PlaceSearch {
        switch self {
        case .ola(let key): return OlaSearch(apiKey: key)
        case .osm: return PhotonSearch()
        }
    }

    /// The style for MapLibre: Ola's style URL, or a small raster style for OSM.
    var styleURL: URL {
        switch self {
        case .ola:
            return URL(string: "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json")!
        case .osm:
            let style = """
            {"version":8,
             "sources":{"osm":{"type":"raster","tiles":["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                               "tileSize":256,"maxzoom":19,"attribution":"© OpenStreetMap contributors"}},
             "layers":[{"id":"osm","type":"raster","source":"osm"}]}
            """
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("osm-style.json")
            try? style.data(using: .utf8)?.write(to: file)
            return file
        }
    }

    /// Prepares MapLibre's networking: identify the app to tile servers (as
    /// OpenStreetMap's tile policy asks) and add the Ola key to Ola's requests.
    func configureNetworking() {
        let session = URLSessionConfiguration.default
        session.httpAdditionalHeaders = ["User-Agent": userAgent]
        MLNNetworkConfiguration.sharedManager.sessionConfiguration = session
        if case .ola(let key) = self {
            OlaKeyAdder.shared.apiKey = key
            MLNOfflineStorage.shared.delegate = OlaKeyAdder.shared
        }
    }
}

/// Adds the Ola key to every Ola request MapLibre makes: style, tiles, fonts, sprites.
final class OlaKeyAdder: NSObject, MLNOfflineStorageDelegate {
    static let shared = OlaKeyAdder()
    var apiKey = ""

    func offlineStorage(_ storage: MLNOfflineStorage, urlForResourceOf kind: MLNResourceKind, with url: URL) -> URL {
        guard url.host == "api.olamaps.io", var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        var items = (c.queryItems ?? []).filter { $0.name != "api_key" }
        items.append(URLQueryItem(name: "api_key", value: apiKey))
        c.queryItems = items
        return c.url ?? url
    }
}
