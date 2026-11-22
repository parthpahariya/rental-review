import CoreGraphics
import Foundation

/// A place as drawn on screen: one building's pin, or a bubble of several.
enum MapMarker: Identifiable {
    case pin(Location, CGPoint)
    case bubble([Location], CGPoint)

    var id: String {
        switch self {
        case .pin(let l, _): return l.id
        case .bubble(let ls, _): return "bubble-" + (ls.first?.id ?? "")
        }
    }
}

/// Closest zoom used; every building gets its own pin at this level.
let maxZoom = 19.0

/// How far (points) pins reach to merge into one bubble, as on the web: wide
/// when zoomed out so the city reads as a few bubbles, tight close up.
func clusterRadius(zoom: Double) -> CGFloat {
    switch zoom {
    case ...13: return 80
    case ...15: return 65
    case ...16: return 50
    default: return 30
    }
}

/// Groups places whose screen positions are within `radius` of a group's first
/// place. `project` maps a place to the screen, or nil when it's off screen.
func cluster(_ locations: [Location], zoom: Double, radius: CGFloat, project: (Location) -> CGPoint?) -> [MapMarker] {
    var groups: [(CGPoint, [Location])] = []
    for location in locations {
        guard let p = project(location) else { continue }
        if zoom < maxZoom, let i = groups.firstIndex(where: { hypot($0.0.x - p.x, $0.0.y - p.y) <= radius }) {
            groups[i].1.append(location)
        } else {
            groups.append((p, [location]))
        }
    }
    return groups.map { p, members in members.count == 1 ? .pin(members[0], p) : .bubble(members, p) }
}

/// "1.2k" style counts for bubbles.
func shortCount(_ n: Int) -> String {
    if n < 1000 { return "\(n)" }
    if n < 10_000 { return String(format: "%.1fk", Double(n) / 1000).replacingOccurrences(of: ".0k", with: "k") }
    return "\(n / 1000)k"
}

/// The rating label on a building's pin.
func pinLabel(_ rating: Double?) -> String { rating.map { String(format: "★ %.1f", $0) } ?? "New" }
