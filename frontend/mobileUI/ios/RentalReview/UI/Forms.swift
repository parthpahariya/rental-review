import SwiftUI

private let dayFormat: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.calendar = Calendar(identifier: .gregorian)
    f.timeZone = .current
    return f
}()

/// A visible label above a 48 pt text field.
struct LabeledField: View {
    let title: String
    var placeholder = ""
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 14, weight: .semibold)).foregroundColor(Brand.ink)
            TextField(placeholder, text: $text)
                .font(.system(size: 15)).foregroundColor(Brand.ink)
                .padding(.horizontal, 12).frame(height: 48)
                .card(radius: 12)
                .accessibilityLabel(title)
        }
    }
}

/// A form error, shown in place and announced.
struct InlineError: View {
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill").accessibilityHidden(true)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 14, weight: .medium)).foregroundColor(Brand.poor)
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.poor.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        .onAppear { UIAccessibility.post(notification: .announcement, argument: text) }
    }
}

/// The header of a full-screen form: Cancel, the title, and balance space.
private struct FormHeader: View {
    let title: String
    let cancel: () -> Void
    var body: some View {
        ZStack {
            Text(title).font(.system(size: 16, weight: .bold)).foregroundColor(Brand.ink).accessibilityAddTraits(.isHeader)
            HStack {
                Button("Cancel", action: cancel).font(.system(size: 16, weight: .semibold)).foregroundColor(Brand.fair)
                    .frame(minWidth: 44, minHeight: 44, alignment: .leading)
                Spacer()
            }
        }
        .padding(.horizontal, 20).padding(.top, 8)
    }
}

/// The sticky bottom bar of a form with its gold action.
private struct FormFooter: View {
    let title: String
    let busy: Bool
    let action: () -> Void
    var body: some View {
        Button(title, action: action).buttonStyle(PrimaryButtonStyle()).disabled(busy)
            .padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 8)
            .background(Color.white.ignoresSafeArea(edges: .bottom))
            .overlay(alignment: .top) { Rectangle().fill(Brand.line).frame(height: 1) }
    }
}

/// A5: share or edit a tenant review, or share an interaction. Reviews name no
/// one: the prompt asks for facts about the flat, not names or contact details.
struct FeedbackForm: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let tab: FeedbackTab
    var editing: Review?
    @State private var rating: Int?
    @State private var text = ""
    @State private var start = Calendar.current.date(byAdding: .year, value: -1, to: .now)!
    @State private var end = Date.now
    @State private var date = Date.now
    @State private var busy = false
    @State private var error: String?

    private var isReview: Bool { tab == .tenant }

    private var topics: [(String, String)] {
        isReview
            ? [("Deposit", "Deposit: "), ("Repairs", "Repairs: "), ("Rent hikes", "Rent hikes: "), ("Water & power", "Water and power: ")]
            : [("Viewing", "The viewing: "), ("Deposit asked", "Deposit asked: "), ("Brokerage", "Brokerage: "), ("Conditions", "Conditions: ")]
    }

    var body: some View {
        VStack(spacing: 0) {
            FormHeader(title: editing != nil ? "Edit your review" : isReview ? "Tenant review" : "Interaction") { dismiss() }
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    summary
                    if isReview { ratingPicker }
                    if isReview && editing == nil {
                        HStack(spacing: 10) {
                            dateField("Moved in", $start, in: ...Date.now)
                            dateField("Moved out", $end, in: start...)
                        }
                    }
                    if !isReview { dateField("When was it?", $date, in: ...Date.now) }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(isReview ? "What was it like?" : "What happened?").font(.system(size: 14, weight: .semibold))
                        MultilineField(placeholder: isReview ? "Describe living in this flat." : "Describe the viewing or conversation.",
                                       text: $text, minLines: 5, maxLines: 12)
                            .font(.system(size: 15))
                            .padding(12).frame(minHeight: 132, alignment: .topLeading)
                            .card(radius: 12)
                            .accessibilityLabel(isReview ? "What was it like?" : "What happened?")
                        Text(isReview
                             ? "Facts about the flat: deposit, repairs, rent changes, neighbourhood. No names or phone numbers."
                             : "Facts about the viewing or the conversation. No names or phone numbers.")
                            .font(.system(size: 13)).foregroundColor(Brand.muted)
                    }
                    .foregroundColor(Brand.ink)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(topics, id: \.0) { title, prompt in
                                Chip(title: "+ " + title) { insert(prompt) }
                                    .accessibilityLabel("Add a line about \(title)")
                            }
                        }
                        .padding(.horizontal, 1)
                    }
                    if let error { InlineError(text: error) }
                    Text(isReview
                         ? "Reviews are published immediately. Ratings and feedback can be edited for 30 days; tenancy dates stay fixed."
                         : "One interaction per person, per flat. It is published for everyone to read.")
                        .font(.system(size: 13)).foregroundColor(Brand.muted)
                }
                .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 24)
            }
            FormFooter(title: busy ? "Publishing…" : editing != nil ? "Save changes" : isReview ? "Publish review" : "Publish interaction",
                       busy: busy, action: submit)
        }
        .background(Brand.goldWash.ignoresSafeArea())
        .onAppear {
            if let editing { rating = editing.rating; text = editing.feedback }
        }
    }

    private var summary: some View {
        HStack(spacing: 12) {
            Image(systemName: "building.2").font(.system(size: 20, weight: .semibold)).foregroundColor(Brand.fair)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(model.selected.map { "\($0.title)" + (model.flat.map { " · Flat \($0.label)" } ?? "") }
                     ?? editing?.place.map { "\($0.building_name ?? "Rental property") · Flat \($0.flat_label)" } ?? "Your review")
                    .font(.system(size: 15, weight: .bold))
                Text(model.selected?.address ?? editing?.place?.address ?? "").font(.system(size: 13)).foregroundColor(Brand.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .foregroundColor(Brand.ink)
        .padding(.horizontal, 14).padding(.vertical, 12)
        .card(radius: 16)
        .accessibilityElement(children: .combine)
    }

    private var ratingPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("How was living there?").font(.system(size: 15, weight: .bold)).foregroundColor(Brand.ink)
            HStack(spacing: 8) {
                ForEach(1...5, id: \.self) { n in
                    let on = n == rating
                    Button { rating = n } label: {
                        Text("\(n)").font(.system(size: 18, weight: on ? .heavy : .bold))
                            .foregroundColor(on ? .white : Brand.ink)
                            .frame(maxWidth: .infinity, minHeight: 56)
                            .background(on ? ratingColor(Double(n)) : .white, in: RoundedRectangle(cornerRadius: 14))
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(on ? ratingColor(Double(n)) : Brand.line, lineWidth: on ? 2 : 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(n) of 5")
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            HStack {
                Text("Avoid")
                Spacer()
                Text("Good — would rent again")
            }
            .font(.system(size: 12.5)).foregroundColor(Brand.muted)
            .accessibilityHidden(true)
        }
    }

    private func dateField(_ title: String, _ value: Binding<Date>, in range: PartialRangeThrough<Date>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 14, weight: .semibold)).foregroundColor(Brand.ink)
            DatePicker(title, selection: value, in: range, displayedComponents: .date).labelsHidden()
                .padding(.horizontal, 8).frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                .card(radius: 12)
        }
        .frame(maxWidth: .infinity)
    }

    private func dateField(_ title: String, _ value: Binding<Date>, in range: PartialRangeFrom<Date>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 14, weight: .semibold)).foregroundColor(Brand.ink)
            DatePicker(title, selection: value, in: range, displayedComponents: .date).labelsHidden()
                .padding(.horizontal, 8).frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                .card(radius: 12)
        }
        .frame(maxWidth: .infinity)
    }

    private func insert(_ prompt: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        text = trimmed.isEmpty ? prompt : trimmed + "\n" + prompt
    }

    private func submit() {
        let body = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(10_000))
        if isReview && rating == nil { error = "Choose a rating from 1 to 5."; return }
        if body.isEmpty { error = isReview ? "Describe what living there was like." : "Describe what happened."; return }
        if isReview && editing == nil && dayFormat.string(from: end) <= dayFormat.string(from: start) {
            error = "Moved out must be after moved in."
            return
        }
        error = nil
        busy = true
        Task {
            let failure: String?
            if let editing {
                failure = await model.editReview(editing, rating: rating ?? editing.rating, feedback: body)
            } else if isReview {
                failure = await model.postReview(rating: rating ?? 5, feedback: body,
                                                 start: dayFormat.string(from: start), end: dayFormat.string(from: end))
            } else {
                failure = await model.postInteraction(description: body, date: dayFormat.string(from: date))
            }
            busy = false
            if let failure { error = failure } else { dismiss() }
        }
    }
}

/// "Edit what you added": the building's name and address, and your flat's
/// number; moving the pin happens on the map.
struct EditPlaceForm: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var building = ""
    @State private var address = ""
    @State private var flatLabel = ""
    @State private var busy = false
    @State private var error: String?

    private var canEditPlace: Bool { model.permissions?.can_edit_location == true }
    private var canEditFlat: Bool {
        model.flat.map { model.permissions?.editable_flat_ids.contains($0.id) == true } == true
    }

    var body: some View {
        VStack(spacing: 0) {
            FormHeader(title: "Edit your place") { dismiss() }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("You can correct what you added until someone else reviews it, posts an interaction, or adds a flat there.")
                        .font(.system(size: 14)).foregroundColor(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    if canEditPlace {
                        LabeledField(title: "Building name", placeholder: "e.g. Mango Lane Homes", text: $building)
                        LabeledField(title: "Address", placeholder: "Street, locality", text: $address)
                    }
                    if canEditFlat { LabeledField(title: "Your flat", placeholder: "302", text: $flatLabel) }
                    if canEditPlace {
                        Button {
                            dismiss()
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { model.startMovePin() }
                        } label: {
                            Label("Move the pin on the map", systemImage: "mappin.and.ellipse").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(OutlineButtonStyle(height: 48, strong: true))
                    }
                    if let error { InlineError(text: error) }
                }
                .padding(20)
            }
            FormFooter(title: busy ? "Saving…" : "Save changes", busy: busy, action: save)
        }
        .background(Brand.goldWash.ignoresSafeArea())
        .onAppear {
            building = model.selected?.building_name ?? ""
            address = model.selected?.address ?? ""
            flatLabel = model.flat?.label ?? ""
        }
    }

    private func save() {
        let name = building.trimmingCharacters(in: .whitespacesAndNewlines)
        let addr = address.trimmingCharacters(in: .whitespacesAndNewlines)
        let label = flatLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        if canEditPlace && addr.isEmpty { error = "Enter the building’s address."; return }
        if canEditFlat && label.isEmpty { error = "Enter your flat, e.g. 302."; return }
        error = nil
        busy = true
        Task {
            let failure = await model.editPlace(buildingName: canEditPlace ? (name.isEmpty ? nil : String(name.prefix(200))) : model.selected?.building_name,
                                                address: canEditPlace ? String(addr.prefix(500)) : model.selected?.address ?? "",
                                                flatLabel: canEditFlat ? String(label.prefix(100)) : nil)
            busy = false
            if let failure { error = failure } else { dismiss() }
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
