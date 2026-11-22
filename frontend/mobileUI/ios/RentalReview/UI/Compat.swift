import SwiftUI

// iOS 15 fallbacks for the few SwiftUI features that arrived in iOS 16.

/// A navigation container: NavigationStack on iOS 16+, a stack-style NavigationView on 15.
struct CompatNavigation<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        if #available(iOS 16, *) {
            NavigationStack(root: content)
        } else {
            NavigationView(content: content).navigationViewStyle(.stack)
        }
    }
}

enum SheetSize { case medium, large }

extension View {
    /// Sheet heights on iOS 16+; iOS 15 always shows full-height sheets.
    @ViewBuilder
    func sheetSizes(_ sizes: Set<SheetSize>) -> some View {
        if #available(iOS 16, *) {
            presentationDetents(Set(sizes.map { $0 == .medium ? PresentationDetent.medium : .large }))
        } else {
            self
        }
    }
}

/// A text field that grows to several lines: TextField(axis:) on iOS 16+, a TextEditor
/// with a placeholder on 15.
struct MultilineField: View {
    let placeholder: String
    @Binding var text: String
    var minLines = 1
    var maxLines = 6

    var body: some View {
        if #available(iOS 16, *) {
            TextField(placeholder, text: $text, axis: .vertical).lineLimit(minLines...maxLines)
        } else {
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder).foregroundColor(Color(uiColor: .placeholderText))
                        .padding(.top, 8).padding(.leading, 4).allowsHitTesting(false)
                }
                TextEditor(text: $text).frame(minHeight: CGFloat(max(minLines, 2)) * 22)
            }
        }
    }
}

/// Waits `milliseconds` (Task.sleep(for:) needs iOS 16). Throws when cancelled.
func pause(milliseconds: UInt64) async throws {
    try await Task.sleep(nanoseconds: milliseconds * 1_000_000)
}
