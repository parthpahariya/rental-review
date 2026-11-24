import SwiftUI

private let dayFormat: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.calendar = Calendar(identifier: .gregorian)
    f.timeZone = .current
    return f
}()

/// Share or edit a tenant review, or share an interaction. Reviews name no
/// one: the prompt asks for facts about the flat, not names or contact details.
struct FeedbackForm: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let tab: FeedbackTab
    var editing: Review?
    @State private var rating = 5
    @State private var text = ""
    @State private var start = Calendar.current.date(byAdding: .year, value: -1, to: .now)!
    @State private var end = Date.now
    @State private var date = Date.now
    @State private var busy = false

    private var isReview: Bool { tab == .tenant }

    var body: some View {
        CompatNavigation {
            Form {
                if let flat = model.flat { Text("\(flat.location.title) · Flat \(flat.label)").foregroundStyle(Brand.muted) }
                if isReview {
                    Section("Your rating") {
                        HStack {
                            ForEach(1...5, id: \.self) { n in
                                Button { rating = n } label: {
                                    Image(systemName: "star.fill").font(.title2).foregroundStyle(n <= rating ? Brand.gold : Brand.line)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("\(n) \(n == 1 ? "star" : "stars")")
                            }
                        }
                    }
                    if editing == nil {
                        Section("Tenancy") {
                            DatePicker("Start", selection: $start, displayedComponents: .date)
                            DatePicker("End", selection: $end, in: start..., displayedComponents: .date)
                        }
                    }
                } else {
                    DatePicker("Interaction date", selection: $date, displayedComponents: .date)
                }
                Section(isReview ? "Your experience" : "What happened?") {
                    MultilineField(placeholder: "Describe your own experience of the flat: repairs, deposit, communication. Stick to facts, and don’t name people or share contact details.",
                                   text: $text, minLines: 5, maxLines: 12)
                }
                Text(isReview
                     ? "Reviews are published immediately. Ratings and feedback can be edited for 30 days; tenancy dates stay fixed."
                     : "One interaction review per person, per flat. It is published for everyone to read.")
                    .font(.footnote).foregroundStyle(Brand.muted)
            }
            .navigationTitle(editing != nil ? "Edit your review" : isReview ? "Share your experience" : "Share an interaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Saving…" : editing != nil ? "Save" : "Publish") { submit() }
                        .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear {
                if let editing { rating = editing.rating; text = editing.feedback }
            }
        }
    }

    private func submit() {
        busy = true
        let body = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(10_000))
        Task {
            let ok: Bool
            if let editing {
                ok = await model.editReview(editing, rating: rating, feedback: body)
            } else if isReview {
                ok = await model.postReview(rating: rating, feedback: body,
                                            start: dayFormat.string(from: start), end: dayFormat.string(from: end))
            } else {
                ok = await model.postInteraction(description: body, date: dayFormat.string(from: date))
            }
            busy = false
            if ok { dismiss() }
        }
    }
}

/// Add a building at the map's crosshair, with its first flat.
struct AddPlaceForm: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let at: GeoPoint
    let onAdded: () -> Void
    @State private var building = ""
    @State private var address = ""
    @State private var flatLabel = ""
    @State private var busy = false

    var body: some View {
        CompatNavigation {
            Form {
                Text(String(format: "At %.5f, %.5f", at.latitude, at.longitude)).font(.footnote).foregroundStyle(Brand.muted)
                TextField("Building name (optional)", text: $building)
                MultilineField(placeholder: "Address", text: $address, maxLines: 4)
                TextField("Flat (e.g. A-204)", text: $flatLabel)
            }
            .navigationTitle("Add a place").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Adding…" : "Add") {
                        busy = true
                        Task {
                            let name = building.trimmingCharacters(in: .whitespaces)
                            let ok = await model.addPlace(address: String(address.trimmingCharacters(in: .whitespacesAndNewlines).prefix(500)),
                                                          buildingName: name.isEmpty ? nil : String(name.prefix(200)),
                                                          at: at, flatLabel: String(flatLabel.trimmingCharacters(in: .whitespaces).prefix(100)))
                            busy = false
                            if ok { onAdded(); dismiss() }
                        }
                    }
                    .disabled(busy || address.trimmingCharacters(in: .whitespaces).isEmpty || flatLabel.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

/// A single short text answer, e.g. a new flat's label or a deletion reason.
struct TextPrompt: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let label: String
    let action: String
    let maxLength: Int
    /// Text to start with, e.g. the comment being edited.
    var initial = ""
    let submit: (String) async -> Bool
    @State private var value = ""
    @State private var busy = false

    var body: some View {
        CompatNavigation {
            Form { MultilineField(placeholder: label, text: $value, maxLines: 6) }
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(action) {
                            busy = true
                            Task {
                                let ok = await submit(String(value.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxLength)))
                                busy = false
                                if ok { dismiss() }
                            }
                        }
                        .disabled(busy || value.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
        }
        .sheetSizes([.medium])
        .onAppear { if value.isEmpty { value = initial } }
    }
}
