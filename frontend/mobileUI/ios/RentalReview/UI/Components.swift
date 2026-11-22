import SwiftUI

/// The web app's palette (fronend/webUI/src/styles.css).
enum Brand {
    static let ink = Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255)
    static let gold = Color(red: 245 / 255, green: 158 / 255, blue: 11 / 255)
    static let goldWash = Color(red: 1, green: 251 / 255, blue: 235 / 255)
    static let muted = Color(red: 100 / 255, green: 116 / 255, blue: 139 / 255)
    static let line = Color(red: 231 / 255, green: 224 / 255, blue: 207 / 255)
    static let good = Color(red: 21 / 255, green: 128 / 255, blue: 61 / 255)
    static let fair = Color(red: 180 / 255, green: 83 / 255, blue: 9 / 255)
    static let poor = Color(red: 185 / 255, green: 28 / 255, blue: 28 / 255)
    static let searched = Color(red: 225 / 255, green: 29 / 255, blue: 72 / 255)
}

/// Rating colour, as the web's score badges: green 4+, amber 3+, red below.
func ratingColor(_ rating: Double?) -> Color {
    guard let rating else { return Brand.muted }
    return rating >= 4 ? Brand.good : rating >= 3 ? Brand.fair : Brand.poor
}

/// "2024-01-01" or a timestamp → "1 Jan 2024".
func shortDate(_ value: String) -> String {
    let out = DateFormatter()
    out.dateFormat = "d MMM yyyy"
    out.locale = Locale(identifier: "en_IN")
    if value.count == 10 {
        let day = DateFormatter()
        day.dateFormat = "yyyy-MM-dd"
        day.timeZone = TimeZone(identifier: "UTC")
        out.timeZone = TimeZone(identifier: "UTC")
        return day.date(from: value).map(out.string(from:)) ?? value
    }
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = iso.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    return date.map(out.string(from:)) ?? value
}

/// The amber house mark and "rentalreview" wordmark.
struct BrandMark: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "house.fill").foregroundStyle(Brand.ink)
                    .frame(width: 36, height: 36).background(Brand.gold, in: RoundedRectangle(cornerRadius: 10))
                Text("rental\(Text("review").bold())").font(.title3).foregroundStyle(Brand.ink)
            }
        }
        .accessibilityLabel("Rental Review home")
    }
}

/// Sign in, or the account's initial, which opens the notebook.
struct AccountButton: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        if let account = model.account {
            Button(action: model.openNotebook) {
                Text(String((account.name ?? account.email ?? "?").prefix(1)).uppercased())
                    .bold().foregroundStyle(Brand.ink)
                    .frame(width: 38, height: 38).background(Brand.gold, in: Circle())
            }
            .accessibilityLabel("Your account")
        } else {
            Button(model.signingIn ? "Signing in…" : "Sign in", systemImage: "person", action: model.signIn)
                .disabled(model.signingIn).bold().tint(Brand.ink)
        }
    }
}

struct TopBar: View {
    @Environment(AppModel.self) private var model
    var back = false
    var body: some View {
        HStack {
            if back {
                Button { model.goHome() } label: { Image(systemName: "chevron.left") }
                    .accessibilityLabel("Back").tint(Brand.ink)
            }
            BrandMark(action: model.goHome)
            Spacer()
            AccountButton()
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(.white)
    }
}

/// The coloured rating square used in lists.
struct ScoreBadge: View {
    let rating: Double?
    var body: some View {
        Text(rating.map { String(format: "%.1f", $0) } ?? "New")
            .font(rating == nil ? .footnote.bold() : .title3.bold()).foregroundStyle(.white)
            .frame(width: 48, height: 48).background(ratingColor(rating), in: RoundedRectangle(cornerRadius: 12))
    }
}

struct Stars: View {
    let rating: Int
    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \.self) { n in
                Image(systemName: "star.fill").foregroundStyle(n <= rating ? Brand.gold : Brand.line)
            }
        }
        .font(.footnote)
        .accessibilityElement().accessibilityLabel("\(rating) out of 5 stars")
    }
}

/// A place in a list: rating, name, address and review counts.
struct PlaceRow: View {
    let location: Location
    var body: some View {
        HStack(spacing: 12) {
            ScoreBadge(rating: location.summary?.average_rating)
            VStack(alignment: .leading, spacing: 2) {
                Text(location.title).bold().foregroundStyle(Brand.ink)
                Text(location.address).font(.footnote).foregroundStyle(Brand.muted).lineLimit(1)
                if let s = location.summary {
                    Text("\(s.tenant_review_count) tenant \(s.tenant_review_count == 1 ? "review" : "reviews") · \(s.interaction_review_count) \(s.interaction_review_count == 1 ? "interaction" : "interactions")")
                        .font(.caption).foregroundStyle(Brand.muted)
                }
            }
            Spacer()
        }
        .contentShape(Rectangle())
    }
}

/// One tenant review or interaction. Reviews name no one: the card says its kind.
struct FeedbackCard: View {
    var review: Review?
    var interaction: Interaction?
    var own: Review?
    var onEdit: (Review) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: review != nil ? "house" : "bubble.left")
                    .frame(width: 30, height: 30).background(Brand.goldWash, in: Circle())
                Text(review != nil ? "Tenant review" : "Interaction").bold()
                Spacer()
                if let own, own.can_edit == true { Button("Edit") { onEdit(own) } }
            }
            if let review {
                Stars(rating: review.rating)
                Text("Tenancy \(shortDate(review.tenancy_start_date)) – \(shortDate(review.tenancy_end_date))")
                    .font(.caption).foregroundStyle(Brand.muted)
                Text(review.feedback)
            }
            if let interaction {
                Text("On \(shortDate(interaction.interaction_date))").font(.caption).foregroundStyle(Brand.muted)
                Text(interaction.description)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Brand.line))
    }
}
