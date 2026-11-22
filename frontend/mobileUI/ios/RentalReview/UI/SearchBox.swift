import SwiftUI

/// The search box, as on the web: suggestions after 4 letters and a short
/// pause, statuses and errors inside the list, and the provider's credit.
struct SearchBox: View {
    @EnvironmentObject private var model: AppModel
    let near: GeoPoint?
    @State private var text = ""
    @State private var results: SearchService.Result?
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var term: String { text.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        VStack(spacing: 6) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(Brand.muted)
                TextField("Search a locality or building", text: $text)
                    .focused($focused).submitLabel(.search).autocorrectionDisabled()
                    .onSubmit { if let first = results?.suggestions.first { choose(first) } }
                if !text.isEmpty {
                    Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Brand.muted) }
                        .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(.white, in: Capsule())
            .overlay(Capsule().stroke(focused ? Brand.gold : Brand.line, lineWidth: focused ? 2 : 1))

            if term.count >= SearchService.minSearch {
                VStack(alignment: .leading, spacing: 0) {
                    let list = results?.suggestions ?? []
                    ForEach(list) { s in
                        Button { choose(s) } label: {
                            HStack(spacing: 10) {
                                Image(systemName: s.kind == .listed ? "star.fill" : s.kind == .building ? "house" : "mappin")
                                    .foregroundStyle(Brand.muted).frame(width: 20)
                                VStack(alignment: .leading) {
                                    Text(s.name).bold().foregroundStyle(Brand.ink)
                                    if let d = s.detail { Text(d).font(.caption).foregroundStyle(Brand.muted).lineLimit(1) }
                                }
                                Spacer()
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10).contentShape(Rectangle())
                        }
                    }
                    if let status = statusLine(list) {
                        Text(status).foregroundStyle(error != nil ? Brand.poor : Brand.muted)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                    }
                    if let a = results?.attribution, list.contains(where: { $0.kind != .listed }) {
                        Text(a).font(.caption2).foregroundStyle(Brand.muted)
                            .frame(maxWidth: .infinity, alignment: .trailing).padding(.horizontal, 14).padding(.bottom, 6)
                    }
                }
                .padding(.vertical, 6)
                .background(.white, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Brand.line))
            }
        }
        // A newer term cancels the older search; wait for a pause in typing.
        .task(id: term) {
            results = nil
            error = nil
            guard term.count >= SearchService.minSearch else { busy = false; return }
            busy = true
            try? await pause(milliseconds: 400)
            guard !Task.isCancelled else { return }
            do {
                results = try await model.search.search(term, near: near)
            } catch {
                if !Task.isCancelled { self.error = "Place suggestions are unavailable right now." }
            }
            busy = false
        }
    }

    private func statusLine(_ list: [Suggestion]) -> String? {
        if busy { return "Finding places…" }
        if let error, list.isEmpty { return error }
        if list.isEmpty { return "No places in \(Region.name) match “\(term)”." }
        return nil
    }

    private func choose(_ s: Suggestion) {
        focused = false
        Task {
            do {
                model.openArea(try await s.resolve())
                text = ""
            } catch {
                self.error = "We couldn’t open that place. Try another."
            }
        }
    }
}
