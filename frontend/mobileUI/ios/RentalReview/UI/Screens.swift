import SwiftUI

enum MainTab { case explore, add, notebook }

/// The bottom tab bar on Home and the Notebook: Explore · Add place · Notebook.
struct TabBar: View {
    @EnvironmentObject private var model: AppModel
    let current: MainTab

    var body: some View {
        HStack(spacing: 0) {
            item(.explore, "Explore", "safari", "safari.fill") { model.goHome() }
            item(.add, "Add place", "plus.square", "plus.square.fill") { model.addFromTab() }
            item(.notebook, "Notebook", "book", "book.fill") { model.openNotebook() }
        }
        .padding(.top, 6)
        .background(Color.white.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Brand.line).frame(height: 1) }
    }

    private func item(_ tab: MainTab, _ title: String, _ icon: String, _ selectedIcon: String,
                      action: @escaping () -> Void) -> some View {
        let on = tab == current
        return Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: on ? selectedIcon : icon).font(.system(size: 21, weight: on ? .semibold : .regular))
                Text(title).font(.system(size: 11, weight: on ? .bold : .medium))
            }
            .foregroundColor(on ? Brand.ink : Brand.muted)
            .frame(maxWidth: .infinity, minHeight: 50)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// A1: search, the hero, areas with reviews from our own data, and what the
/// two kinds of feedback are. No map here: it opens only when asked for.
struct HomeView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top, spacing: 10) {
                        SearchBox(near: Region.defaultCenter)
                        AccountAvatar()
                    }
                    .padding(.top, 10)
                    .zIndex(1)

                    hero.padding(.top, 16)
                    areas.padding(.top, 20)
                    explainers.padding(.top, 20)

                    HStack(spacing: 20) {
                        Button("Privacy Policy") { openWeb("/privacy") }
                        Button("Delete your data") { openWeb("/delete-data") }
                    }
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(Brand.muted)
                    .frame(minHeight: 44).padding(.top, 16).padding(.bottom, 12)
                }
                .padding(.horizontal, 16)
            }
            TabBar(current: .explore)
        }
        .background(Brand.goldWash.ignoresSafeArea())
    }

    private var hero: some View {
        ZStack(alignment: .topLeading) {
            Brand.ink
            BuildingLines()
            GeometryReader { geo in
                Circle().fill(Brand.gold).frame(width: 32, height: 32)
                    .position(x: geo.size.width * 0.73, y: 64)
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                Text("BUILDING BY BUILDING").font(.system(size: 12, weight: .bold)).kerning(0.5).foregroundColor(Brand.gold)
                Text("Rent with your eyes open.").font(.system(size: 27, weight: .heavy)).foregroundColor(.white)
                    .lineSpacing(-2).fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }
            .padding(.leading, 20).padding(.top, 20).padding(.trailing, 150)
            VStack {
                Spacer()
                Button(action: model.openMap) {
                    HStack(spacing: 8) {
                        Image(systemName: "map").font(.system(size: 16, weight: .bold))
                        Text("Open the map").font(.system(size: 15, weight: .heavy))
                    }
                    .foregroundColor(Brand.ink).padding(.horizontal, 16).frame(height: 44)
                    .background(Brand.gold, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            .padding(20)
        }
        .frame(height: 220)
        .clipShape(RoundedRectangle(cornerRadius: 24))
    }

    private var areas: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Areas with reviews").font(.system(size: 16, weight: .heavy)).foregroundColor(Brand.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button(action: model.openNearMe) {
                    HStack(spacing: 4) {
                        Image(systemName: "location.circle").font(.system(size: 16, weight: .semibold))
                        Text("Near me").font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundColor(Brand.fair).frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the map around your location")
            }
            if !model.areasLoaded {
                ProgressView().frame(maxWidth: .infinity, alignment: .leading).frame(height: 38)
            } else if model.areas.isEmpty {
                Text("As people share reviews, their areas show up here. Search or open the map to start.")
                    .font(.system(size: 14)).foregroundColor(Brand.muted)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(model.areas) { chip in
                            Button { model.openArea(chip.area) } label: {
                                HStack(spacing: 6) {
                                    Text(chip.name).font(.system(size: 14, weight: .semibold)).foregroundColor(Brand.ink)
                                    Text("\(chip.count)").font(.system(size: 14, weight: .medium)).foregroundColor(Brand.muted)
                                }
                                .padding(.horizontal, 14).frame(height: 38)
                                .background(.white, in: Capsule()).overlay(Capsule().stroke(Brand.line))
                                .frame(minHeight: 44).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(chip.name), \(plural(chip.count, "reviewed place"))")
                        }
                    }
                    .padding(.horizontal, 1)
                }
            }
        }
    }

    private var explainers: some View {
        HStack(alignment: .top, spacing: 10) {
            explainer("key", "Tenant reviews", "From people who lived there: rating, dates, what it was like.")
            explainer("eye", "Interactions", "From people who viewed or enquired: red flags early.")
        }
    }

    private func explainer(_ icon: String, _ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon).font(.system(size: 18, weight: .semibold)).foregroundColor(Brand.fair)
                .frame(height: 24).accessibilityHidden(true)
            Text(title).font(.system(size: 14, weight: .bold)).foregroundColor(Brand.ink)
            Text(body).font(.system(size: 12.5)).foregroundColor(Brand.muted).lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .card(radius: 16)
        .accessibilityElement(children: .combine)
    }
}

/// The round gold avatar ("Your account"), or Sign in when signed out.
struct AccountAvatar: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        if let account = model.account {
            Button(action: model.openNotebook) {
                Text(initial(account)).font(.system(size: 18, weight: .bold)).foregroundColor(Brand.ink)
                    .frame(width: 52, height: 52).background(Brand.gold, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Your account")
        } else {
            Button(action: model.promptSignIn) {
                Text("Sign in").font(.system(size: 15, weight: .bold)).foregroundColor(Brand.ink)
                    .padding(.horizontal, 16).frame(height: 52).background(Brand.gold, in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }
}
