import SwiftUI

/// The web app's palette (fronend/webUI/src/styles.css), plus the map-beige
/// track used behind segmented controls.
enum Brand {
    static let ink = Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255)
    static let gold = Color(red: 245 / 255, green: 158 / 255, blue: 11 / 255)
    static let goldWash = Color(red: 1, green: 251 / 255, blue: 235 / 255)
    static let muted = Color(red: 100 / 255, green: 116 / 255, blue: 139 / 255)
    static let line = Color(red: 231 / 255, green: 224 / 255, blue: 207 / 255)
    static let good = Color(red: 21 / 255, green: 128 / 255, blue: 61 / 255)
    /// Amber: fair ratings, and gold-on-cream text (eyebrows, links).
    static let fair = Color(red: 180 / 255, green: 83 / 255, blue: 9 / 255)
    static let poor = Color(red: 185 / 255, green: 28 / 255, blue: 28 / 255)
    static let searched = Color(red: 225 / 255, green: 29 / 255, blue: 72 / 255)
    /// Segmented-control tracks and soft fills.
    static let track = Color(red: 244 / 255, green: 239 / 255, blue: 223 / 255)
    /// "Deletion pending" pill.
    static let pendingFill = Color(red: 254 / 255, green: 243 / 255, blue: 199 / 255)
    static let pendingText = Color(red: 146 / 255, green: 64 / 255, blue: 14 / 255)
}

/// Rating colour, as the web's score badges: green 4+, amber 3+, red below.
func ratingColor(_ rating: Double?) -> Color {
    guard let rating else { return Brand.muted }
    return rating >= 4 ? Brand.good : rating >= 3 ? Brand.fair : Brand.poor
}

private func parseDate(_ value: String) -> (Date, TimeZone)? {
    if value.count == 10 {
        let day = DateFormatter()
        day.dateFormat = "yyyy-MM-dd"
        day.timeZone = TimeZone(identifier: "UTC")
        return day.date(from: value).map { ($0, TimeZone(identifier: "UTC")!) }
    }
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return (iso.date(from: value) ?? ISO8601DateFormatter().date(from: value)).map { ($0, .current) }
}

private func format(_ value: String, _ pattern: String) -> String {
    guard let (date, zone) = parseDate(value) else { return value }
    let out = DateFormatter()
    out.dateFormat = pattern
    out.locale = Locale(identifier: "en_IN")
    out.timeZone = zone
    return out.string(from: date)
}

/// "2024-01-01" or a timestamp → "1 Jan 2024".
func shortDate(_ value: String) -> String { format(value, "d MMM yyyy") }

/// "2024-01-01" → "Jan 2024".
func monthYear(_ value: String) -> String { format(value, "MMM yyyy") }

/// "350 m" or "1.2 km".
func distanceLabel(_ metres: Double) -> String {
    metres < 1000 ? "\(Int((metres / 10).rounded() * 10)) m" : String(format: "%.1f km", metres / 1000)
}

/// Great-circle distance in metres.
func metres(from a: GeoPoint, to b: GeoPoint) -> Double {
    let r = 6_371_000.0
    let dLat = (b.latitude - a.latitude) * .pi / 180, dLng = (b.longitude - a.longitude) * .pi / 180
    let h = pow(sin(dLat / 2), 2) + cos(a.latitude * .pi / 180) * cos(b.latitude * .pi / 180) * pow(sin(dLng / 2), 2)
    return 2 * r * asin(min(1, sqrt(h)))
}

extension Location {
    var point: GeoPoint { GeoPoint(latitude: latitude, longitude: longitude) }
}

func plural(_ n: Int, _ one: String, _ many: String? = nil) -> String {
    "\(n) \(n == 1 ? one : (many ?? one + "s"))"
}

/// The first letter of the account's name or email, for the round avatar.
func initial(_ account: Account) -> String {
    String((account.name ?? account.email ?? "?").prefix(1)).uppercased()
}

// MARK: Buttons

/// The gold call to action with ink text.
struct PrimaryButtonStyle: ButtonStyle {
    var height: CGFloat = 54
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .heavy)).foregroundColor(Brand.ink)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(Brand.gold.opacity(configuration.isPressed ? 0.8 : 1), in: RoundedRectangle(cornerRadius: 16))
    }
}

/// The ink secondary button with white text.
struct InkButtonStyle: ButtonStyle {
    var height: CGFloat = 44
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
            .padding(.horizontal, 12).frame(minHeight: height)
            .background(Brand.ink.opacity(configuration.isPressed ? 0.8 : 1), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// A white button with a hairline (or ink) border.
struct OutlineButtonStyle: ButtonStyle {
    var height: CGFloat = 44
    var strong = false
    var radius: CGFloat = 12
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: strong ? .bold : .semibold)).foregroundColor(Brand.ink)
            .padding(.horizontal, 12).frame(minHeight: height)
            .background(Color.white.opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(strong ? Brand.ink : Brand.line, lineWidth: strong ? 1.5 : 1))
    }
}

/// A round floating button (back, share, add) over the map or a header.
struct CircleButton: View {
    let systemImage: String
    let label: String
    var size: CGFloat = 48
    var dark = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage).font(.system(size: 17, weight: .semibold))
                .foregroundColor(dark ? .white : Brand.ink)
                .frame(width: size, height: size)
                .background(dark ? Brand.ink : .white, in: Circle())
                .shadow(color: Brand.ink.opacity(0.12), radius: 10, y: 4)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// A filter or topic chip: ink when on, white with a hairline when off.
struct Chip: View {
    let title: String
    var on = false
    var height: CGFloat = 34
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 13, weight: on ? .semibold : .medium))
                .foregroundColor(on ? .white : Brand.ink)
                .padding(.horizontal, 12).frame(height: height)
                .background(on ? Brand.ink : .white, in: Capsule())
                .overlay(Capsule().stroke(on ? Brand.ink : Brand.line))
                .frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Two or three tabs on a beige track, the selected one a raised white pill.
struct SegmentedTabs<Tag: Hashable>: View {
    let items: [(Tag, String)]
    @Binding var selection: Tag
    var body: some View {
        HStack(spacing: 0) {
            ForEach(items, id: \.0) { tag, title in
                let on = tag == selection
                Button { selection = tag } label: {
                    Text(title).font(.system(size: 14, weight: on ? .bold : .semibold))
                        .foregroundColor(on ? Brand.ink : Brand.muted).lineLimit(1).minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background(on ? Color.white : .clear, in: RoundedRectangle(cornerRadius: 10))
                        .shadow(color: on ? Brand.ink.opacity(0.1) : .clear, radius: 2, y: 1)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Brand.track, in: RoundedRectangle(cornerRadius: 14))
    }
}

/// White card with a hairline, as the design's articles.
struct CardBackground: ViewModifier {
    var radius: CGFloat = 18
    var border = Brand.line
    var width: CGFloat = 1
    func body(content: Content) -> some View {
        content
            .background(Color.white, in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(border, lineWidth: width))
    }
}

extension View {
    func card(radius: CGFloat = 18, border: Color = Brand.line, width: CGFloat = 1) -> some View {
        modifier(CardBackground(radius: radius, border: border, width: width))
    }
}

/// The sheet grabber.
struct Grabber: View {
    var body: some View {
        Capsule().fill(Brand.line).frame(width: 40, height: 5)
    }
}

/// Gold building outlines, drawn on the ink hero and place header.
struct BuildingLines: View {
    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            var p = Path()
            let blocks: [(CGFloat, CGFloat, CGFloat)] = [(0.55, 0.55, 0.106), (0.67, 0.42, 0.123), (0.81, 0.62, 0.128)]
            for (x, top, width) in blocks {
                p.move(to: CGPoint(x: x * w, y: h))
                p.addLine(to: CGPoint(x: x * w, y: top * h))
                p.addLine(to: CGPoint(x: (x + width) * w, y: top * h))
                p.addLine(to: CGPoint(x: (x + width) * w, y: h))
                var y = top * h + 16
                while y < h - 8 {
                    p.move(to: CGPoint(x: x * w + 10, y: y))
                    p.addLine(to: CGPoint(x: (x + width) * w - 10, y: y))
                    y += 20
                }
            }
            ctx.stroke(p, with: .color(Brand.gold.opacity(0.35)), lineWidth: 1.5)
        }
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}

// MARK: Ratings and places

/// The coloured rating square used in lists; the number always shows with the colour.
struct ScoreBadge: View {
    let rating: Double?
    var size: CGFloat = 48
    var body: some View {
        Text(rating.map { String(format: "%.1f", $0) } ?? "New")
            .font(.system(size: rating == nil ? 13 : 17, weight: .heavy)).foregroundColor(.white)
            .frame(width: size, height: size).background(ratingColor(rating), in: RoundedRectangle(cornerRadius: 14))
            .accessibilityLabel(rating.map { String(format: "Rated %.1f", $0) } ?? "No rating yet")
    }
}

/// A small rating chip ("4.0") as on review cards.
struct RatingChip: View {
    let rating: Int
    var body: some View {
        Text("\(rating).0").font(.system(size: 13, weight: .heavy)).foregroundColor(.white)
            .padding(.horizontal, 8).frame(height: 26)
            .background(ratingColor(Double(rating)), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel("Rated \(rating) of 5")
    }
}

/// A place in the results: rating tile, name, address · distance, counts.
struct PlaceRow: View {
    let location: Location
    var distance: Double?
    var highlighted = false
    var body: some View {
        HStack(spacing: 12) {
            ScoreBadge(rating: location.summary?.average_rating)
            VStack(alignment: .leading, spacing: 3) {
                Text(location.title).font(.system(size: 16, weight: .bold)).foregroundColor(Brand.ink).lineLimit(2)
                Text(location.address + (distance.map { " · " + distanceLabel($0) } ?? ""))
                    .font(.system(size: 13)).foregroundColor(Brand.muted).lineLimit(1)
                let s = location.summary ?? Summary()
                Text("\(plural(s.tenant_review_count, "review")) · \(plural(s.interaction_review_count, "interaction"))")
                    .font(.system(size: 13, weight: .medium)).foregroundColor(Brand.ink)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundColor(Brand.muted)
        }
        .padding(14)
        .card(border: highlighted ? Brand.gold : Brand.line, width: highlighted ? 2 : 1)
        .contentShape(Rectangle())
    }
}

/// One tenant review or interaction. Reviews name no one: the card says its kind.
struct FeedbackCard: View {
    var review: Review?
    var interaction: Interaction?
    var own: Review?
    var onEdit: (Review) -> Void = { _ in }
    /// Called when the post itself is tapped, e.g. to open its discussion.
    var onOpen: (() -> Void)?
    /// Shown under the card, e.g. its discussion.
    var footer: AnyView?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            post
                // The whole post is tappable, not just its text. The footer sits
                // outside, so taps inside the discussion don't close it.
                .contentShape(Rectangle())
                .onTapGesture { onOpen?() }
                .accessibilityAction(named: "Open the discussion") { onOpen?() }
            if let own, own.can_edit == true {
                HStack(spacing: 8) {
                    Text("Your review · editable until \(shortDate(own.editing_deadline))")
                        .font(.system(size: 12, weight: .semibold)).foregroundColor(Brand.fair)
                    Spacer(minLength: 0)
                    Button("Edit") { onEdit(own) }
                        .font(.system(size: 13, weight: .bold)).foregroundColor(Brand.ink)
                        .padding(.horizontal, 14).frame(height: 32)
                        .background(Brand.goldWash, in: Capsule()).overlay(Capsule().stroke(Brand.gold))
                        .frame(minHeight: 44)
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Edit your review")
                }
            }
            if let footer { footer }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var post: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if let review {
                    RatingChip(rating: review.rating)
                    Text("Lived here").font(.system(size: 13, weight: .semibold))
                    Text("\(monthYear(review.tenancy_start_date)) – \(monthYear(review.tenancy_end_date))")
                        .font(.system(size: 13)).foregroundColor(Brand.muted)
                }
                if let interaction {
                    Text("Interaction").font(.system(size: 12, weight: .bold)).foregroundColor(Brand.fair)
                        .padding(.horizontal, 8).frame(height: 26)
                        .background(Brand.goldWash, in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Brand.line))
                    Text("Viewed or enquired").font(.system(size: 13, weight: .semibold))
                    Text(shortDate(interaction.interaction_date)).font(.system(size: 13)).foregroundColor(Brand.muted)
                }
            }
            .foregroundColor(Brand.ink)
            Text(review?.feedback ?? interaction?.description ?? "")
                .font(.system(size: 14.5)).lineSpacing(3).foregroundColor(Brand.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
