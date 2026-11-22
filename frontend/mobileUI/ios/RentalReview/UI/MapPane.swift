import MapLibre
import SwiftUI

/// The map: the provider's style drawn by MapLibre, with rating pins, bubbles
/// and the searched-place marker drawn on top as SwiftUI views (the same pills
/// as the web app, on any provider). In `addMode` a crosshair marks the spot a
/// new place will be added at.
struct MapPane: View {
    @Environment(AppModel.self) private var model
    let provider: MapProvider
    let addMode: Bool
    @Binding var center: GeoPoint
    @State private var camera = CameraState()

    var body: some View {
        ZStack {
            MapLibreView(provider: provider, focus: model.focus, camera: $camera) { bounds, c in
                center = c
                model.onViewport(bounds, center: c)
            } onFail: {
                model.mapUnavailable = true
            }
            .ignoresSafeArea(edges: .bottom)

            if let project = camera.project {
                let markers = cluster(model.locations, zoom: camera.zoom, radius: clusterRadius(zoom: camera.zoom), project: project)
                ForEach(markers) { marker in
                    switch marker {
                    case .pin(let l, let p):
                        RatingPin(location: l, active: l.id == model.selected?.id) { model.select(l) }
                            .position(x: p.x, y: p.y - 18)
                    case .bubble(let ls, let p):
                        Bubble(count: ls.count, partial: model.partial) { camera.zoomInto?(ls) }
                            .position(p)
                    }
                }
                if let s = model.searched, let p = project(Location(id: "searched", address: "", building_name: nil,
                                                                     latitude: s.center.latitude, longitude: s.center.longitude)) {
                    SearchedMarker(name: s.name).position(x: p.x, y: p.y - 34).allowsHitTesting(false)
                }
            }
            if addMode {
                Image(systemName: "plus").font(.system(size: 36, weight: .bold)).foregroundStyle(Brand.searched)
                    .accessibilityLabel("New place goes here").allowsHitTesting(false)
            }
            if model.mapUnavailable {
                Text("The map isn’t available right now. The list shows the same places.")
                    .foregroundStyle(Brand.muted).padding(14).background(.white, in: RoundedRectangle(cornerRadius: 12))
            }
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    Text(provider.attribution).font(.system(size: 10)).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.white.opacity(0.8))
                }
            }
            .allowsHitTesting(false)
        }
    }
}

/// What the overlay needs from the map: zoom, how to place a point on screen,
/// and how to zoom into a bubble. Refreshed on every camera move.
struct CameraState {
    var zoom = 12.0
    var revision = 0
    var project: ((Location) -> CGPoint?)?
    var zoomInto: (([Location]) -> Void)?
}

private struct RatingPin: View {
    let location: Location
    let active: Bool
    let action: () -> Void
    var body: some View {
        let label = pinLabel(location.summary?.average_rating)
        Button(action: action) {
            Text(label).font(.subheadline.bold()).foregroundStyle(active ? Brand.ink : .white)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(active ? Brand.gold : Brand.ink, in: Capsule())
                .overlay(Capsule().stroke(Brand.ink, lineWidth: 2))
        }
        .accessibilityLabel("\(location.title), \(label)")
    }
}

private struct Bubble: View {
    let count: Int
    let partial: Bool
    let action: () -> Void
    var body: some View {
        let size: CGFloat = count < 10 ? 44 : count < 100 ? 52 : count < 1000 ? 60 : 68
        Button(action: action) {
            Text(shortCount(count) + (partial ? "+" : "")).font(.headline.weight(.heavy)).foregroundStyle(Brand.ink)
                .frame(width: size, height: size).background(Brand.gold, in: Circle())
                .overlay(Circle().stroke(Brand.ink, lineWidth: 3))
        }
        .accessibilityLabel("\(partial ? "At least " : "")\(count) places")
    }
}

/// The searched building: its name above a large red pin.
private struct SearchedMarker: View {
    let name: String
    var body: some View {
        VStack(spacing: 0) {
            Text(name).font(.subheadline.bold()).foregroundStyle(.white).lineLimit(1)
                .padding(.horizontal, 12).padding(.vertical, 5).background(Brand.searched, in: Capsule())
            Image(systemName: "mappin").font(.system(size: 34, weight: .bold)).foregroundStyle(Brand.searched)
        }
        .accessibilityLabel("Searched place: \(name)")
    }
}

/// MapLibre's map view in SwiftUI.
private struct MapLibreView: UIViewRepresentable {
    let provider: MapProvider
    let focus: Focus?
    @Binding var camera: CameraState
    let onViewport: (GeoBounds, GeoPoint) -> Void
    let onFail: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MLNMapView {
        let map = MLNMapView(frame: .zero, styleURL: provider.styleURL)
        map.delegate = context.coordinator
        map.maximumZoomLevel = maxZoom
        map.isRotateEnabled = false
        map.isPitchEnabled = false
        map.compassView.isHidden = true
        map.logoView.isHidden = false
        map.setCenter(CLLocationCoordinate2D(latitude: Region.defaultCenter.latitude, longitude: Region.defaultCenter.longitude),
                      zoomLevel: 12, animated: false)
        context.coordinator.map = map
        return map
    }

    func updateUIView(_ map: MLNMapView, context: Context) {
        context.coordinator.parent = self
        guard let focus, focus.key != context.coordinator.focusKey else { return }
        context.coordinator.focusKey = focus.key
        let area = focus.area
        if let b = area.bounds, b.north - b.south > 0.004 {
            let bounds = MLNCoordinateBounds(sw: CLLocationCoordinate2D(latitude: b.south, longitude: b.west),
                                             ne: CLLocationCoordinate2D(latitude: b.north, longitude: b.east))
            map.setVisibleCoordinateBounds(bounds, edgePadding: UIEdgeInsets(top: 60, left: 40, bottom: 60, right: 40), animated: true, completionHandler: nil)
        } else {
            map.setCenter(CLLocationCoordinate2D(latitude: area.center.latitude, longitude: area.center.longitude),
                          zoomLevel: area.zoom, animated: true)
        }
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        var parent: MapLibreView
        weak var map: MLNMapView?
        var focusKey = -1

        init(_ parent: MapLibreView) { self.parent = parent }

        private func publishCamera() {
            guard let map else { return }
            var state = parent.camera
            state.zoom = map.zoomLevel
            state.revision += 1
            state.project = { [weak map] l in
                guard let map else { return nil }
                let p = map.convert(CLLocationCoordinate2D(latitude: l.latitude, longitude: l.longitude), toPointTo: map)
                return map.bounds.insetBy(dx: -50, dy: -50).contains(p) ? p : nil
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
                map.setVisibleCoordinateBounds(bounds, edgePadding: UIEdgeInsets(top: 60, left: 60, bottom: 60, right: 60),
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
                GeoPoint(latitude: c.latitude, longitude: c.longitude))
        }

        func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) { parent.onFail() }
    }
}
