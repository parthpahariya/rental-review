import Foundation

/// Identifies the app to free services (OpenStreetMap's usage policy asks for it).
let userAgent = "RentalReview-iOS/1.0"

private func getData(_ url: URL) async throws -> Data {
    var request = URLRequest(url: url, timeoutInterval: 15)
    request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status) else {
        throw APIError(status: 0, code: "SEARCH_FAILED", message: "Place search failed.")
    }
    return data
}

// MARK: Ola Maps Places

private struct OlaResponse: Decodable { var predictions: [OlaPrediction]? }
private struct OlaPrediction: Decodable {
    let description: String
    let place_id: String
    var types: [String]?
    var structured_formatting: OlaFormatting?
    var geometry: OlaGeometry?
}
private struct OlaFormatting: Decodable { var main_text: String?; var secondary_text: String? }
private struct OlaGeometry: Decodable { var location: OlaLatLng? }
private struct OlaLatLng: Decodable { let lat: Double; let lng: Double }
private struct OlaDetails: Decodable { var result: OlaDetailsResult? }
private struct OlaDetailsResult: Decodable { var geometry: OlaGeometry? }

/// Ola Maps Places Autocomplete; Details only when a result lacks its location.
struct OlaSearch: PlaceSearch {
    let apiKey: String
    let attribution = "Search by Ola Maps"
    private let api = "https://api.olamaps.io/places/v1"

    func search(_ text: String, near: GeoPoint?) async throws -> [Suggestion] {
        var c = URLComponents(string: "\(api)/autocomplete")!
        c.queryItems = [URLQueryItem(name: "input", value: text), URLQueryItem(name: "language", value: "en"),
                        URLQueryItem(name: "api_key", value: apiKey)]
        if let near { c.queryItems?.append(URLQueryItem(name: "location", value: String(format: "%.4f,%.4f", near.latitude, near.longitude))) }
        let response = try JSONDecoder().decode(OlaResponse.self, from: try await getData(c.url!))
        return (response.predictions ?? []).prefix(8).map { p in
            let types = p.types ?? []
            let exact = !isAreaType(types)
            let name = p.structured_formatting?.main_text ?? p.description
            let detail = p.structured_formatting?.secondary_text
            return Suggestion(name: name, detail: detail, kind: exact ? .building : .area) {
                var location = p.geometry?.location
                if location == nil { location = try await details(p.place_id) }
                guard let at = location else {
                    throw APIError(status: 0, code: "NO_LOCATION", message: "The place has no location.")
                }
                return Area(name: name, detail: detail, center: GeoPoint(latitude: at.lat, longitude: at.lng),
                            zoom: exact ? 18 : isCityType(types) ? 12 : 15, exact: exact)
            }
        }
    }

    private func details(_ placeId: String) async throws -> OlaLatLng? {
        var c = URLComponents(string: "\(api)/details")!
        c.queryItems = [URLQueryItem(name: "place_id", value: placeId), URLQueryItem(name: "api_key", value: apiKey)]
        return try JSONDecoder().decode(OlaDetails.self, from: try await getData(c.url!)).result?.geometry?.location
    }
}

// MARK: Photon (OpenStreetMap)

private struct PhotonResponse: Decodable { var features: [PhotonFeature]? }
private struct PhotonFeature: Decodable { let geometry: PhotonGeometry; let properties: PhotonProperties }
private struct PhotonGeometry: Decodable { let coordinates: [Double] }
private struct PhotonProperties: Decodable {
    var name: String?, type: String?, city: String?, county: String?, state: String?
    var countrycode: String?, osm_key: String?, osm_value: String?
    var extent: [Double]?
}

/// Photon, an OpenStreetMap geocoder: localities and mapped housing complexes.
struct PhotonSearch: PlaceSearch {
    let attribution = "Search © OpenStreetMap contributors"

    func search(_ text: String, near: GeoPoint?) async throws -> [Suggestion] {
        let b = Region.bounds
        var c = URLComponents(string: "https://photon.komoot.io/api/")!
        c.queryItems = [URLQueryItem(name: "q", value: text), URLQueryItem(name: "limit", value: "15"),
                        URLQueryItem(name: "lang", value: "en"),
                        URLQueryItem(name: "bbox", value: "\(b.west),\(b.south),\(b.east),\(b.north)")]
        if let near {
            c.queryItems! += [URLQueryItem(name: "lat", value: String(format: "%.4f", near.latitude)),
                              URLQueryItem(name: "lon", value: String(format: "%.4f", near.longitude))]
        }
        c.queryItems! += ["locality", "district", "city"].map { URLQueryItem(name: "layer", value: $0) }
        let features = try JSONDecoder().decode(PhotonResponse.self, from: try await getData(c.url!)).features ?? []
        var areas: [Area] = []
        for f in features {
            let p = f.properties
            guard let name = p.name, f.geometry.coordinates.count >= 2 else { continue }
            if let code = p.countrycode, code != Region.countryCode { continue }
            let lng = f.geometry.coordinates[0], lat = f.geometry.coordinates[1]
            // OpenStreetMap often lists one locality twice, a short distance apart.
            if areas.contains(where: { $0.name.lowercased() == name.lowercased()
                && abs($0.center.latitude - lat) < 0.03 && abs($0.center.longitude - lng) < 0.03 }) { continue }
            let detail = [p.city ?? p.county, p.state].compactMap { $0 }.filter { $0 != name }.joined(separator: ", ")
            let e = p.extent.flatMap { $0.count == 4 ? $0 : nil }
            // Apartment societies are usually mapped as named residential land.
            let building = p.type == "house" || p.osm_key == "building"
                || (p.osm_key == "landuse" && p.osm_value == "residential")
            if building {
                let center = e.map { GeoPoint(latitude: ($0[1] + $0[3]) / 2, longitude: ($0[0] + $0[2]) / 2) }
                    ?? GeoPoint(latitude: lat, longitude: lng)
                areas.append(Area(name: name, detail: detail.isEmpty ? nil : detail, center: center, zoom: 17, exact: true))
            } else {
                areas.append(Area(name: name, detail: detail.isEmpty ? nil : detail,
                                  center: GeoPoint(latitude: lat, longitude: lng),
                                  bounds: e.map { GeoBounds(west: $0[0], south: $0[3], east: $0[2], north: $0[1]) },
                                  zoom: p.type == "city" ? 12 : 15))
            }
        }
        return areas.prefix(8).map { a in
            Suggestion(name: a.name, detail: a.detail, kind: a.exact ? .building : .area) { a }
        }
    }
}
