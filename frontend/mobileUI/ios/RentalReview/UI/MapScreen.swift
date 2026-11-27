import Combine
import SwiftUI

/// The keyboard's height, so the add-a-place sheet can scroll its fields above it.
final class KeyboardHeight: ObservableObject {
    @Published var value: CGFloat = 0
    private var cancellable: AnyCancellable?

    init() {
        let show = NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)
            .compactMap { ($0.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect)?.height }
        let hide = NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification).map { _ in CGFloat(0) }
        cancellable = show.merge(with: hide).receive(on: RunLoop.main).sink { [weak self] in self?.value = $0 }
    }
}

private enum AddField: Hashable { case name, address, flat }

/// A2 and A6: the map at the top and a sheet below it. Browsing shows the
/// results; adding a place or moving a pin swaps the sheet, on the same map.
/// "List only" hides the map entirely (the map is then never created).
struct MapScreen: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var keyboard = KeyboardHeight()
    @State private var expanded = false
    @State private var dragY: CGFloat = 0
    @State private var searching = false
    @FocusState private var field: AddField?

    // Add a place
    @State private var building = ""
    @State private var address = ""
    @State private var flatLabel = ""
    @State private var addError: String?
    @State private var busy = false

    private var browsing: Bool { model.mapMode == .browse }
    private var showMap: Bool { !model.listOnly || !browsing }

    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            let lowTop = h * (browsing ? 0.43 : 0.40)
            let highTop: CGFloat = 64
            let top = !showMap ? highTop
                : max(highTop, min(h - 120, ((browsing ? expanded : field != nil) ? highTop : lowTop) + dragY))
            ZStack(alignment: .top) {
                (showMap ? Brand.track : Brand.goldWash).ignoresSafeArea()
                if showMap {
                    Group {
                        if let provider = model.provider {
                            MapPane(provider: provider, bottomInset: 28)
                        } else {
                            Brand.track
                        }
                    }
                    .frame(height: lowTop + 28 + geo.safeAreaInsets.top)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .ignoresSafeArea(edges: .top)

                    if browsing {
                        Button { model.setListOnly(true) } label: {
                            Label("List only", systemImage: "list.bullet").font(.system(size: 13, weight: .bold))
                                .foregroundColor(Brand.ink).padding(.horizontal, 14).frame(height: 38)
                                .background(.white, in: Capsule()).shadow(color: Brand.ink.opacity(0.14), radius: 6, y: 4)
                                .frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Hides the map and shows only the list")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 16).offset(y: lowTop - 54)
                    }
                }

                topBar.padding(.horizontal, 16).padding(.top, 8)

                sheet(height: h - top)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .animation(.spring(response: 0.3, dampingFraction: 0.9), value: top)

                if searching { searchOverlay }
            }
        }
        .ignoresSafeArea(.keyboard)
        .onChange(of: model.mapMode) { _ in
            addError = nil
            field = nil
            if model.mapMode == .add { building = ""; address = ""; flatLabel = "" }
        }
    }

    // MARK: Top bar

    @ViewBuilder private var topBar: some View {
        switch model.mapMode {
        case .browse:
            HStack(spacing: 10) {
                CircleButton(systemImage: "chevron.left", label: "Back") { model.goHome() }
                Button { searching = true } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "mappin.and.ellipse").font(.system(size: 16, weight: .semibold))
                        Text(model.area?.name ?? "Search an area").font(.system(size: 16, weight: .semibold)).lineLimit(1)
                        Spacer(minLength: 0)
                        Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .semibold)).foregroundColor(Brand.muted)
                    }
                    .foregroundColor(Brand.ink).padding(.horizontal, 16).frame(height: 48)
                    .background(.white, in: Capsule()).shadow(color: Brand.ink.opacity(0.12), radius: 10, y: 6)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Area: \(model.area?.name ?? "none"). Search for another area")
                CircleButton(systemImage: "plus", label: "Add a place", dark: true) { model.addFromMap() }
            }
        case .add, .move:
            HStack(spacing: 10) {
                CircleButton(systemImage: "xmark", label: model.mapMode == .add ? "Cancel adding a place" : "Cancel moving the pin") {
                    if model.mapMode == .add { model.cancelAdd() } else { model.cancelMove() }
                }
                Text(model.mapMode == .add ? "Drag the pin onto the building" : "Drag the pin, or tap the map, then save")
                    .font(.system(size: 14, weight: .semibold)).foregroundColor(.white).lineLimit(1).minimumScaleFactor(0.8)
                    .padding(.horizontal, 14).frame(maxWidth: .infinity, minHeight: 48)
                    .background(Brand.ink, in: Capsule())
            }
        }
    }

    private var searchOverlay: some View {
        ZStack(alignment: .top) {
            Brand.ink.opacity(0.35).ignoresSafeArea().onTapGesture { searching = false }.accessibilityHidden(true)
            HStack(alignment: .top, spacing: 10) {
                CircleButton(systemImage: "xmark", label: "Close search") { searching = false }
                SearchBox(near: model.mapCenter, autofocus: true) { searching = false }
            }
            .padding(.horizontal, 16).padding(.top, 8)
        }
    }

    // MARK: The sheet

    private func sheet(height: CGFloat) -> some View {
        VStack(spacing: 0) {
            if showMap {
                Button { expanded.toggle() } label: {
                    Grabber().frame(maxWidth: .infinity, minHeight: 24).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(expanded ? "Collapse the sheet" : "Expand the sheet")
                .disabled(!browsing)
            }
            switch model.mapMode {
            case .browse: results
            case .add: addSheet
            case .move(let place): moveSheet(place)
            }
        }
        .frame(height: max(0, height), alignment: .top)
        .frame(maxWidth: .infinity)
        .background(
            TopRounded(radius: 28).fill(Brand.goldWash)
                .shadow(color: Brand.ink.opacity(showMap ? 0.12 : 0), radius: 15, y: -8)
                .ignoresSafeArea(edges: .bottom))
        .gesture(DragGesture(minimumDistance: 12)
            .onChanged { dragY = $0.translation.height }
            .onEnded { value in
                if value.translation.height < -60 { expanded = true } else if value.translation.height > 60 { expanded = false }
                dragY = 0
            }, including: showMap && browsing ? .all : .subviews)
    }

    // MARK: Results (A2)

    private var countHeading: String {
        if model.loadingPlaces && model.locations.isEmpty { return "Loading…" }
        let n = model.results.count
        return "\(n)\(model.partial && model.filters.isEmpty ? "+" : "") \(n == 1 ? "place" : "places")"
    }

    private var results: some View {
        let rows = model.results
        return VStack(spacing: 0) {
            HStack(alignment: .center) {
                Text(countHeading).font(.system(size: 20, weight: .heavy)).foregroundColor(Brand.ink)
                    .accessibilityAddTraits(.isHeader)
                if model.loadingPlaces && !model.locations.isEmpty { ProgressView().padding(.leading, 4) }
                Spacer()
                if !showMap {
                    Button { model.setListOnly(false) } label: {
                        Label("Show map", systemImage: "map").font(.system(size: 13, weight: .bold)).foregroundColor(Brand.ink)
                            .padding(.horizontal, 12).frame(height: 34).background(.white, in: Capsule())
                            .overlay(Capsule().stroke(Brand.line)).frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                }
                Menu {
                    Picker("Sort", selection: $model.sort) {
                        ForEach(SortOrder.allCases) { Text($0.rawValue).tag($0) }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(model.sort.rawValue).font(.system(size: 14, weight: .semibold))
                        Image(systemName: "chevron.down").font(.system(size: 12, weight: .bold))
                    }
                    .foregroundColor(Brand.fair).frame(minHeight: 44).contentShape(Rectangle())
                }
                .accessibilityLabel("Sort: \(model.sort.rawValue)")
            }
            .padding(.horizontal, 20).padding(.top, showMap ? 4 : 12)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(ResultFilter.allCases) { f in
                        Chip(title: f.rawValue, on: model.filters.contains(f)) {
                            if model.filters.contains(f) { model.filters.remove(f) } else { model.filters.insert(f) }
                        }
                    }
                }
                .padding(.horizontal, 20)
            }

            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(rows, id: \.location.id) { row in
                        Button { model.select(row.location) } label: {
                            PlaceRow(location: row.location, distance: row.distance, highlighted: row.location.id == model.highlighted)
                        }
                        .buttonStyle(.plain)
                    }
                    if rows.isEmpty && !model.loadingPlaces { empty }
                    if model.partial && !rows.isEmpty {
                        Text("Showing the first \(model.locations.count) places here. Zoom in for the rest.")
                            .font(.system(size: 13)).foregroundColor(Brand.muted).padding(.top, 4)
                    }
                }
                .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 24)
            }
        }
    }

    @ViewBuilder private var empty: some View {
        VStack(spacing: 10) {
            if !model.filters.isEmpty && !model.locations.isEmpty {
                Text("No places here match these filters.").font(.system(size: 15, weight: .semibold))
                Button("Clear filters") { model.filters = [] }.buttonStyle(OutlineButtonStyle())
            } else {
                Text("No places in this area.").font(.system(size: 15, weight: .semibold))
                Text(showMap ? "Move the map to another area, or add a place here." : "Search another area, or add a place.")
                    .font(.system(size: 14)).foregroundColor(Brand.muted).multilineTextAlignment(.center)
                Button("Add a place") { model.addFromMap() }.buttonStyle(InkButtonStyle())
            }
        }
        .foregroundColor(Brand.ink)
        .frame(maxWidth: .infinity).padding(.vertical, 24)
    }

    // MARK: Add a place (A6)

    private var addSheet: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if !model.nearby.isEmpty { nearbyBox }
                    Text(model.nearby.isEmpty ? "Add the building" : "Not listed? Add it")
                        .font(.system(size: 15, weight: .bold)).foregroundColor(Brand.ink)
                        .accessibilityAddTraits(.isHeader)
                    LabeledField(title: model.nearby.isEmpty ? "Building name (optional)" : "Building name",
                                 placeholder: "e.g. Mango Lane Homes", text: $building)
                        .focused($field, equals: .name).id(AddField.name)
                    HStack(alignment: .top, spacing: 10) {
                        LabeledField(title: "Address", placeholder: "Street, locality", text: $address)
                            .focused($field, equals: .address).id(AddField.address)
                            .frame(maxWidth: .infinity)
                        LabeledField(title: "Your flat", placeholder: "302", text: $flatLabel)
                            .focused($field, equals: .flat).id(AddField.flat)
                            .frame(width: 110)
                    }
                    Text("Type the address as you’d give it to a visitor; the pin marks the spot.")
                        .font(.system(size: 13)).foregroundColor(Brand.muted)
                    if let addError { InlineError(text: addError) }
                    Button(busy ? "Adding…" : "Add place and write a review", action: submitPlace)
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(busy)
                        .padding(.top, 4)
                }
                .padding(.horizontal, 20).padding(.top, 8)
                .padding(.bottom, 24 + keyboard.value)
            }
            .onChange(of: field) { f in
                if let f { withAnimation { proxy.scrollTo(f, anchor: .center) } }
            }
        }
    }

    private var nearbyBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ALREADY ON THE MAP NEARBY").font(.system(size: 13, weight: .bold)).foregroundColor(Brand.fair)
            ForEach(model.nearby.prefix(3)) { l in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.title).font(.system(size: 15, weight: .bold)).foregroundColor(Brand.ink).lineLimit(1)
                        Text(nearbyDetail(l)).font(.system(size: 13)).foregroundColor(Brand.muted).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Button("Review this") { model.reviewNearby(l) }
                        .buttonStyle(InkButtonStyle(height: 38))
                        .frame(minHeight: 44)
                        .accessibilityLabel("Review \(l.title)")
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .card(radius: 16, border: Brand.gold)
    }

    private func nearbyDetail(_ l: Location) -> String {
        var parts: [String] = []
        if let d = model.draft { parts.append("\(distanceLabel(metres(from: d, to: l.point))) away") }
        if let r = l.summary?.average_rating { parts.append(String(format: "%.1f", r)) }
        parts.append(plural(l.summary?.tenant_review_count ?? 0, "review"))
        return parts.joined(separator: " · ")
    }

    private func submitPlace() {
        let name = building.trimmingCharacters(in: .whitespacesAndNewlines)
        let addr = address.trimmingCharacters(in: .whitespacesAndNewlines)
        let label = flatLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        if !model.nearby.isEmpty && name.isEmpty { addError = "Places are already listed here, so give the building its name."; return }
        if addr.isEmpty { addError = "Enter the building’s address."; return }
        if label.isEmpty { addError = "Enter your flat, e.g. 302."; return }
        addError = nil
        field = nil
        busy = true
        Task {
            addError = await model.addPlace(address: String(addr.prefix(500)), buildingName: name.isEmpty ? nil : String(name.prefix(200)),
                                            flatLabel: String(label.prefix(100)))
            busy = false
        }
    }

    // MARK: Move the pin

    private func moveSheet(_ place: Location) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Move the pin for \(place.title)").font(.system(size: 18, weight: .heavy)).foregroundColor(Brand.ink)
                .accessibilityAddTraits(.isHeader)
            Text(place.address).font(.system(size: 14)).foregroundColor(Brand.muted)
            if let addError { InlineError(text: addError) }
            Button(busy ? "Saving…" : "Save pin") {
                busy = true
                Task { addError = await model.savePin(); busy = false }
            }
            .buttonStyle(PrimaryButtonStyle()).disabled(busy)
            Button("Cancel") { model.cancelMove() }.buttonStyle(OutlineButtonStyle(height: 48)).frame(maxWidth: .infinity)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20).padding(.top, 8)
    }
}
