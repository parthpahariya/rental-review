import Foundation

/// The search box's rules, the same as the web app's: wait for 4 letters, go
/// straight to typed coordinates, list buildings already on Rental Review first
/// (free), and ask the map provider only when fewer than 3 of those match.
struct SearchService {
    static let minSearch = 4
    static let enoughListed = 3

    struct Result {
        let suggestions: [Suggestion]
        let attribution: String?
    }

    let listed: (String) async throws -> [Location]
    let provider: () -> PlaceSearch

    func search(_ text: String, near: GeoPoint?) async throws -> Result {
        let term = text.trimmingCharacters(in: .whitespaces)
        guard term.count >= Self.minSearch else { return Result(suggestions: [], attribution: nil) }
        if Coordinates.looksLike(term) {
            guard let point = Coordinates.parse(term) else { return Result(suggestions: [], attribution: nil) }
            let area = Coordinates.area(point)
            return Result(suggestions: [Suggestion(name: area.name, detail: "Go to these coordinates", kind: .building) { area }],
                          attribution: nil)
        }
        let own: [Suggestion] = ((try? await listed(term)) ?? []).map { l in
            let name = l.building_name ?? l.address
            let area = Area(name: name, center: GeoPoint(latitude: l.latitude, longitude: l.longitude), zoom: 18)
            return Suggestion(name: name,
                              detail: l.building_name != nil ? "On Rental Review · \(l.address)" : "On Rental Review",
                              kind: .listed) { area }
        }
        if own.count >= Self.enoughListed { return Result(suggestions: own, attribution: nil) }
        let search = provider()
        let found: [Suggestion]
        do {
            found = try await search.search(term, near: near)
        } catch {
            if own.isEmpty { throw error }
            found = []
        }
        let names = Set(own.map { $0.name.lowercased() })
        return Result(suggestions: own + found.filter { !names.contains($0.name.lowercased()) },
                      attribution: search.attribution)
    }
}
