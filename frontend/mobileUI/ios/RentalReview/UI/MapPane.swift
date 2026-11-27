import MapLibre
import SwiftUI

/// The session's one MapLibre map view. It is created lazily, the first time a
/// screen asks for the map (Open the map, an area chip, a search pick, Add
/// place, Move the pin), and is then kept: results, adding a place and moving a
/// pin all show this same view, re-parented into whichever container is on
/// screen, so the style and tiles load once per session. Home, place details,
/// sign-in, forms and the notebook never ask for it.
@MainActor
final class MapHolder: NSObject {
    private(set) var map: MLNMapView?
    /// The last focus the map moved to.
    var focusKey = -1
    /// Taps on the map itself (not on a pin), as map coordinates.
    var onTap: ((GeoPoint) -> Void)?

    func mapView(provider: MapProvider, focus: Focus?, size: CGSize) -> MLNMapView {
        if let map { return map }
        let map = MLNMapView(frame: CGRect(origin: .zero, size: size), styleURL: provider.styleURL)
        map.maximumZoomLevel = maxZoom
        map.isRotateEnabled = false
        map.isPitchEnabled = false
        map.compassView.isHidden = true
        map.logoView.isHidden = false
        map.logoViewPosition = .bottomRight
        map.attributionButtonPosition = .bottomRight
        // Open straight on the first place asked for, so no tiles load for a
        // default view that is immediately left.
        let area = focus?.area ?? Area(name: Region.defaultName, center: Region.defaultCenter, zoom: 12)
        let (center, zoom) = cameraFit(for: area, size: size)
        map.setCenter(CLLocationCoordinate2D(latitude: center.latitude, longitude: center.longitude), zoomLevel: zoom, animated: false)
        focusKey = focus?.key ?? -1
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        for recognizer in map.gestureRecognizers ?? [] where (recognizer as? UITapGestureRecognizer)?.numberOfTapsRequired == 2 {
            tap.require(toFail: recognizer)
        }
        map.addGestureRecognizer(tap)
        self.map = map
        return map
    }

    @objc private func tapped(_ recognizer: UITapGestureRecognizer) {
        guard let map, recognizer.state == .ended else { return }
        let c = map.convert(recognizer.location(in: map), toCoordinateFrom: map)
        onTap?(GeoPoint(latitude: c.latitude, longitude: c.longitude))
    }
}

/// The centre and zoom that show `area` in a map of `size` (used before the map has laid out).
func cameraFit(for area: Area, size: CGSize) -> (GeoPoint, Double) {
    guard let b = area.bounds, b.north - b.south > 0.004, size.width > 0, size.height > 0 else { return (area.center, area.zoom) }
    let lngZoom = log2(360 * Double(size.width) / (512 * max(1e-6, b.east - b.west)))
    let latSpan = (b.north - b.south) / max(0.2, cos(area.center.latitude * .pi / 180))
    let latZoom = log2(360 * Double(size.height) / (512 * max(1e-6, latSpan)))
    return (GeoPoint(latitude: (b.south + b.north) / 2, longitude: (b.west + b.east) / 2), max(3, min(maxZoom, min(lngZoom, latZoom) - 0.3)))
}

/// The map with rating pins, bubbles, the searched-place marker and, when
/// adding or moving a place, the draggable pin, all drawn as SwiftUI views on
/// top. `bottomInset` is how much of the map's bottom a sheet covers.
struct MapPane: View {
    @EnvironmentObject private var model: AppModel
    let provider: MapProvider
    var bottomInset: CGFloat = 0
    @State private var camera = CameraState()
    @State private var drag = CGSize.zero

    var body: some View {
        ZStack {
            MapLibreView(holder: model.mapHolder, provider: provider, focus: model.focus, bottomInset: bottomInset,
                         camera: $camera) { bounds, c, zoom in
                model.onViewport(bounds, center: c, zoom: zoom)
            } onTap: { point in
                if model.mapMode != .browse { model.moveDraft(to: point) }
            } onFail: {
                model.mapUnavailable = true
            }

            if let project = camera.project {
                let markers = cluster(model.locations, zoom: camera.zoom, radius: clusterRadius(zoom: camera.zoom)) { project($0.point) }
                ForEach(markers) { marker in
                    switch marker {
                    case .pin(let l, let p):
                        RatingPin(location: l, active: l.id == model.highlighted && model.mapMode == .browse) {
                            switch model.mapMode {
                            case .browse: model.select(l)
                            case .add: model.reviewNearby(l)
                            case .move: break
                            }
                        }
                        .position(x: p.x, y: p.y - 15)
                    case .bubble(let ls, let p):
                        Bubble(count: ls.count, partial: model.partial) { camera.zoomInto?(ls) }
                            .position(p)
                    }
                }
                if model.mapMode == .browse, let s = model.searched, let p = project(s.center) {
                    SearchedMarker(name: s.name).position(x: p.x, y: p.y - 34).allowsHitTesting(false)
                }
                if model.mapMode != .browse, let draft = model.draft, let p = project(draft) {
                    DraftPin(label: model.mapMode == .add ? "+ New" : "Here")
                        .gesture(DragGesture(minimumDistance: 2)
                            .onChanged { drag = $0.translation }
                            .onEnded { value in
                                let end = CGPoint(x: p.x + value.translation.width, y: p.y + value.translation.height)
                                if let point = camera.unproject?(end) { model.moveDraft(to: point) }
                                drag = .zero
                            })
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Pin for the place. Drag it onto the building, or tap the map.")
                        .position(x: p.x + drag.width, y: p.y + drag.height - 27)
                }
            }
            if model.mapUnavailable {
                Text("The map isn’t available right now. The list shows the same places.")
                    .foregroundColor(Brand.muted).padding(14).background(.white, in: RoundedRectangle(cornerRadius: 12))
            }
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    Text(provider.attribution).font(.system(size: 10)).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.white.opacity(0.8))
                        .padding(.trailing, 40).padding(.bottom, bottomInset + 6)
                }
            }
            .allowsHitTesting(false)
        }
    }
}

/// What the overlay needs from the map: zoom, how to place a point on screen
/// (and back), and how to zoom into a bubble. Refreshed on every camera move.
struct CameraState {
    var zoom = 12.0
    var revision = 0
    var project: ((GeoPoint) -> CGPoint?)?
    var unproject: ((CGPoint) -> GeoPoint?)?
    var zoomInto: (([Location]) -> Void)?
}

private struct RatingPin: View {
    let location: Location
    let active: Bool
    let action: () -> Void
    var body: some View {
        let rating = location.summary?.average_rating
        Button(action: action) {
            HStack(spacing: 3) {
                if active { Image(systemName: "star.fill").font(.system(size: 10, weight: .bold)).foregroundColor(Brand.gold) }
                Text(rating.map { String(format: "%.1f", $0) } ?? "New")
            }
            .font(.system(size: 13, weight: .bold)).foregroundColor(active ? .white : Brand.ink)
            .padding(.horizontal, 10).frame(height: 30)
            .background(active ? Brand.ink : .white, in: Capsule())
            .overlay(Capsule().stroke(active ? Brand.gold : ratingColor(rating).opacity(0.6), lineWidth: 2))
            .shadow(color: Brand.ink.opacity(0.15), radius: 4, y: 2)
            .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(location.title), \(rating.map { String(format: "rated %.1f", $0) } ?? "no rating yet")")
    }
}

private struct Bubble: View {
    let count: Int
    let partial: Bool
    let action: () -> Void
    var body: some View {
        let size: CGFloat = count < 10 ? 44 : count < 100 ? 50 : count < 1000 ? 58 : 66
        Button(action: action) {
            Text(shortCount(count) + (partial ? "+" : "")).font(.system(size: 14, weight: .heavy)).foregroundColor(Brand.ink)
                .frame(width: size, height: size).background(Brand.gold, in: Circle())
                .overlay(Circle().stroke(.white, lineWidth: 3))
                .shadow(color: Brand.ink.opacity(0.18), radius: 6, y: 4)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(partial ? "At least " : "")\(count) places. Zoom in.")
    }
}

/// The searched building: its name above a large red pin.
private struct SearchedMarker: View {
    let name: String
    var body: some View {
        VStack(spacing: 0) {
            Text(name).font(.subheadline.bold()).foregroundColor(.white).lineLimit(1)
                .padding(.horizontal, 12).padding(.vertical, 5).background(Brand.searched, in: Capsule())
            Image(systemName: "mappin").font(.system(size: 34, weight: .bold)).foregroundColor(Brand.searched)
        }
        .accessibilityLabel("Searched place: \(name)")
    }
}

/// The pin for a new place (or one being moved): a labelled flag on a stem.
private struct DraftPin: View {
    let label: String
    var body: some View {
        VStack(spacing: 0) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                .padding(.horizontal, 12).frame(height: 32)
                .background(Brand.ink, in: Capsule()).overlay(Capsule().stroke(Brand.gold, lineWidth: 2))
            Rectangle().fill(Brand.ink).frame(width: 3, height: 22)
            Circle().fill(Brand.ink).frame(width: 10, height: 10)
        }
        .padding(6).contentShape(Rectangle())
    }
}

/// Sizes the map to itself once laid out (never to zero), then refreshes the overlay.
private final class MapContainer: UIView {
    weak var map: MLNMapView?
    var onLayout: (() -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let map, map.superview === self, bounds.width > 0, bounds.height > 0, map.frame != bounds else { return }
        map.frame = bounds
        onLayout?()
    }
}

/// Hosts the held MLNMapView in SwiftUI. The map is moved into this container
/// rather than created here, so leaving and returning never makes a new map.
private struct MapLibreView: UIViewRepresentable {
    let holder: MapHolder
    let provider: MapProvider
    let focus: Focus?
    let bottomInset: CGFloat
    @Binding var camera: CameraState
    let onViewport: (GeoBounds, GeoPoint, Double) -> Void
    let onTap: (GeoPoint) -> Void
    let onFail: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UIView {
        let size = CGSize(width: UIScreen.main.bounds.width, height: UIScreen.main.bounds.height * 0.5)
        let map = holder.mapView(provider: provider, focus: focus, size: size)
        map.removeFromSuperview()
        // Start the container at the map's size, so the map is never squeezed to zero.
        let container = MapContainer(frame: CGRect(origin: .zero, size: map.bounds.size))
        container.map = map
        container.onLayout = { [weak coordinator = context.coordinator] in coordinator?.publishCamera() }
        container.addSubview(map)
        map.delegate = context.coordinator
        context.coordinator.map = map
        holder.onTap = onTap
        // A map that was already loaded: refresh the overlay for this screen.
        DispatchQueue.main.async { context.coordinator.publishCamera() }
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        context.coordinator.parent = self
        holder.onTap = onTap
        guard let map = context.coordinator.map else { return }
        map.logoViewMargins = CGPoint(x: 10, y: bottomInset + 34)
        map.attributionButtonMargins = CGPoint(x: 10, y: bottomInset + 4)
        guard let focus, focus.key != holder.focusKey else { return }
        holder.focusKey = focus.key
        let area = focus.area
        let current = GeoPoint(latitude: map.centerCoordinate.latitude, longitude: map.centerCoordinate.longitude)
        // Fly short hops; jump long ones so tiles along the way aren't fetched.
        let animated = metres(from: current, to: area.center) < 15_000
        if let b = area.bounds, b.north - b.south > 0.004, map.bounds.width > 0 {
            let bounds = MLNCoordinateBounds(sw: CLLocationCoordinate2D(latitude: b.south, longitude: b.west),
                                             ne: CLLocationCoordinate2D(latitude: b.north, longitude: b.east))
            map.setVisibleCoordinateBounds(bounds, edgePadding: UIEdgeInsets(top: 80, left: 40, bottom: 40 + bottomInset, right: 40),
                                           animated: animated, completionHandler: nil)
        } else {
            let size = map.bounds.width > 0 ? map.bounds.size : CGSize(width: UIScreen.main.bounds.width, height: UIScreen.main.bounds.height * 0.5)
            let (center, zoom) = cameraFit(for: area, size: size)
            map.setCenter(CLLocationCoordinate2D(latitude: center.latitude, longitude: center.longitude), zoomLevel: zoom, animated: animated)
        }
    }

    static func dismantleUIView(_ container: UIView, coordinator: Coordinator) {
        guard let map = coordinator.map else { return }
        if map.superview === container { map.removeFromSuperview() }
        if map.delegate === coordinator { map.delegate = nil }
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        var parent: MapLibreView
        weak var map: MLNMapView?

        init(_ parent: MapLibreView) { self.parent = parent }

        func publishCamera() {
            guard let map else { return }
            var state = parent.camera
            state.zoom = map.zoomLevel
            state.revision += 1
            state.project = { [weak map] g in
                guard let map else { return nil }
                let p = map.convert(CLLocationCoordinate2D(latitude: g.latitude, longitude: g.longitude), toPointTo: map)
                return map.bounds.insetBy(dx: -50, dy: -50).contains(p) ? p : nil
            }
            state.unproject = { [weak map] p in
                guard let map else { return nil }
                let c = map.convert(p, toCoordinateFrom: map)
                return GeoPoint(latitude: c.latitude, longitude: c.longitude)
            }
            state.zoomInto = { [weak map] locations in
                guard let map, !locations.isEmpty else { return }
                let lats = locations.map(\.latitude), lngs = locations.map(\.longitude)
                if lats.max()! - lats.min()! < 1e-5, lngs.max()! - lngs.min()! < 1e-5 {
                    map.setZoomLevel(map.zoomLevel + 2, animated: true)
                    return
                }
                let bounds = MLNCoordinateBounds(sw: CLLocationCoordinate2D(latitude: lats.min()!, longitude: lngs.min()!),
                                                 ne: CLLocationCoordinate2D(latitude: lats.max()!, longitude: lngs.max()!))
                map.setVisibleCoordinateBounds(bounds, edgePadding: UIEdgeInsets(top: 80, left: 60, bottom: 60, right: 60),
                                               animated: true, completionHandler: nil)
            }
            parent.camera = state
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) { publishCamera() }

        func mapViewRegionIsChanging(_ mapView: MLNMapView) { publishCamera() }

        func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
            publishCamera()
            let b = mapView.visibleCoordinateBounds
            let c = mapView.centerCoordinate
            parent.onViewport(
                GeoBounds(west: max(-180, min(180, b.sw.longitude)), south: max(-90, min(90, b.sw.latitude)),
                          east: max(-180, min(180, b.ne.longitude)), north: max(-90, min(90, b.ne.latitude))),
                GeoPoint(latitude: c.latitude, longitude: c.longitude), mapView.zoomLevel)
        }

        func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) { parent.onFail() }
    }
}
