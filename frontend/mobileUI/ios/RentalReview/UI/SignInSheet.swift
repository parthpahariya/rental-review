import SwiftUI

/// What every full screen carries: the toast, the sign-in sheet and the
/// reactivation question. `active` is false for a screen hidden under the
/// place details, so only the top screen shows them.
struct AppChrome: ViewModifier {
    @EnvironmentObject private var model: AppModel
    let active: Bool
    var toastBottom: CGFloat = 24

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if active, let message = model.message {
                    Text(message).font(.system(size: 15, weight: .medium)).foregroundColor(.white)
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Brand.ink, in: RoundedRectangle(cornerRadius: 14))
                        .padding(.horizontal, 16).padding(.bottom, toastBottom)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .onAppear { UIAccessibility.post(notification: .announcement, argument: message) }
                        .task(id: message) {
                            try? await pause(milliseconds: 3000)
                            if model.message == message { model.message = nil }
                        }
                }
            }
            .overlay {
                if active, let prompt = model.signInPrompt {
                    SignInSheet(prompt: prompt).transition(.opacity)
                }
            }
            .animation(.default, value: model.message)
            .animation(.easeOut(duration: 0.2), value: model.signInPrompt?.id)
            .alert("Welcome back", isPresented: Binding(get: { active && model.reactivationPending },
                                                        set: { if !$0 && model.reactivationPending { model.confirmReactivation(false) } })) {
                Button("Reactivate my account") { model.confirmReactivation(true) }
                Button("Cancel", role: .cancel) { model.confirmReactivation(false) }
            } message: {
                Text("This account was deactivated. Reactivate it to sign in; your reviews are unchanged.")
            }
    }
}

/// A4: "Sign in to share", a bottom sheet over the dimmed screen.
private struct SignInSheet: View {
    @EnvironmentObject private var model: AppModel
    let prompt: SignInPrompt

    var body: some View {
        ZStack(alignment: .bottom) {
            Brand.ink.opacity(0.45).ignoresSafeArea()
                .onTapGesture { model.dismissSignIn() }
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 18) {
                Grabber().frame(maxWidth: .infinity)
                HStack(alignment: .top) {
                    Image(systemName: "house.fill").font(.system(size: 26)).foregroundColor(Brand.ink)
                        .frame(width: 56, height: 56).background(Brand.gold, in: RoundedRectangle(cornerRadius: 16))
                        .accessibilityHidden(true)
                    Spacer()
                    Button { model.dismissSignIn() } label: {
                        Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundColor(Brand.ink)
                            .frame(width: 44, height: 44).background(Brand.track, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close")
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(prompt.title).font(.system(size: 26, weight: .heavy)).foregroundColor(Brand.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(prompt.detail).font(.system(size: 15)).foregroundColor(Brand.muted).lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button(action: model.signIn) {
                    HStack(spacing: 12) {
                        if model.signingIn {
                            ProgressView()
                        } else {
                            GoogleMark()
                        }
                        Text(model.signingIn ? "Signing in…" : "Continue with Google").font(.system(size: 16, weight: .bold))
                    }
                    .foregroundColor(Brand.ink)
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .background(.white, in: RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Brand.ink, lineWidth: 1.5))
                }
                .buttonStyle(.plain)
                .disabled(model.signingIn)
                VStack(alignment: .leading, spacing: 10) {
                    reassurance("eye.slash", "Your name and email are never shown on reviews.")
                    reassurance("clock.arrow.circlepath", "Edit your review for 30 days, or ask us to delete it.")
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .card(radius: 16)
                HStack(spacing: 16) {
                    Button("Privacy Policy") { openWeb("/privacy") }
                    Button("Delete your data") { openWeb("/delete-data") }
                }
                .font(.system(size: 13, weight: .semibold)).foregroundColor(Brand.fair)
                .frame(minHeight: 44)
            }
            .padding(.horizontal, 24).padding(.top, 10).padding(.bottom, 16)
            .background(TopRounded(radius: 28).fill(Brand.goldWash).ignoresSafeArea(edges: .bottom))
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
        }
    }

    private func reassurance(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).foregroundColor(Brand.good).frame(width: 20).accessibilityHidden(true)
            Text(text).font(.system(size: 14)).foregroundColor(Brand.ink).fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Google's "G", drawn in its four colours.
private struct GoogleMark: View {
    var body: some View {
        ZStack {
            Circle().trim(from: 0.0, to: 0.25).stroke(Color(red: 0.26, green: 0.52, blue: 0.96), lineWidth: 3.6)
            Circle().trim(from: 0.25, to: 0.45).stroke(Color(red: 0.20, green: 0.66, blue: 0.33), lineWidth: 3.6)
            Circle().trim(from: 0.45, to: 0.62).stroke(Color(red: 0.98, green: 0.74, blue: 0.02), lineWidth: 3.6)
            Circle().trim(from: 0.62, to: 0.92).stroke(Color(red: 0.92, green: 0.26, blue: 0.21), lineWidth: 3.6)
            Rectangle().fill(Color(red: 0.26, green: 0.52, blue: 0.96)).frame(width: 9, height: 3.6).offset(x: 4.5)
        }
        .frame(width: 18, height: 18)
        .accessibilityHidden(true)
    }
}

/// A rectangle with only its top corners rounded (sheets and panels).
struct TopRounded: Shape {
    let radius: CGFloat
    func path(in rect: CGRect) -> Path {
        Path(UIBezierPath(roundedRect: rect, byRoundingCorners: [.topLeft, .topRight],
                          cornerRadii: CGSize(width: radius, height: radius)).cgPath)
    }
}

func openWeb(_ path: String) {
    if let url = URL(string: AppConfig.siteURL + path) { UIApplication.shared.open(url) }
}
