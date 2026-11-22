import Foundation

/// A point in WGS84 degrees.
struct GeoPoint: Hashable {
    let latitude: Double
    let longitude: Double
}

struct GeoBounds: Hashable {
    let west: Double, south: Double, east: Double, north: Double
}

/// Where the map should go: an area to fit, or a single building to mark.
struct Area: Hashable {
    let name: String
    var detail: String?
    let center: GeoPoint
    var bounds: GeoBounds?
    var zoom: Double = 15
    /// A single building rather than an area: the map marks its spot.
    var exact = false
}

/// One line in the suggestion list; its place is looked up only when chosen.
struct Suggestion: Identifiable {
    enum Kind { case area, building, listed }
    let id = UUID()
    let name: String
    let detail: String?
    let kind: Kind
    let resolve: () async throws -> Area
}

/// A map provider's place search (Ola Maps or Photon).
protocol PlaceSearch {
    /// Text shown under the results, as the provider's terms require.
    var attribution: String { get }
    func search(_ text: String, near: GeoPoint?) async throws -> [Suggestion]
}

/// Search covers India; the map opens on Bengaluru.
enum Region {
    static let name = "India"
    static let countryCode = "IN"
    static let bounds = GeoBounds(west: 68.1, south: 6.5, east: 97.5, north: 35.7)
    static let defaultCenter = GeoPoint(latitude: 12.955, longitude: 77.63)
    static let defaultName = "Bengaluru"
}

/// Typed coordinates, e.g. "12.9716, 77.5946" copied from a phone's map app.
/// They're the visitor's own input, so going there needs no provider.
enum Coordinates {
    private static let pattern = try! NSRegularExpression(
        pattern: #"^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$"#)

    private static func numbers(_ text: String) -> (Double, Double)? {
        let range = NSRange(text.startIndex..., in: text)
        guard let m = pattern.firstMatch(in: text, range: range),
              let a = Range(m.range(at: 1), in: text), let b = Range(m.range(at: 2), in: text),
              let lat = Double(text[a]), let lng = Double(text[b]) else { return nil }
        return (lat, lng)
    }

    /// True for text that is just two numbers, whether or not they're valid.
    static func looksLike(_ text: String) -> Bool { numbers(text) != nil }

    /// "latitude, longitude" inside the search region, or nil.
    static func parse(_ text: String) -> GeoPoint? {
        guard let (lat, lng) = numbers(text) else { return nil }
        let b = Region.bounds
        guard lat >= b.south, lat <= b.north, lng >= b.west, lng <= b.east else { return nil }
        return GeoPoint(latitude: lat, longitude: lng)
    }

    static func area(_ p: GeoPoint) -> Area {
        Area(name: String(format: "%.5f, %.5f", p.latitude, p.longitude), detail: "Coordinates",
             center: p, zoom: 17, exact: true)
    }
}

/// Place types (as Ola Maps returns them) that describe an area, not a building.
func isAreaType(_ types: [String]) -> Bool {
    types.contains {
        ["locality", "neighborhood", "colloquial_area", "postal_code", "country", "political"].contains($0)
            || $0.hasPrefix("sublocality") || $0.hasPrefix("administrative_area")
    }
}

func isCityType(_ types: [String]) -> Bool {
    types.contains { $0 == "locality" || $0.hasPrefix("administrative_area") }
}
