# Agent Instructions

## Simulators and emulators

- Never launch, boot, or run the iOS Simulator or Android Emulator automatically.
- Do not run commands that start them (e.g. `xcrun simctl boot`, `open -a Simulator`, `flutter run`, `npx react-native run-ios` / `run-android`, `emulator -avd ...`, `xcodebuild ... -destination 'platform=iOS Simulator,...' test`) unless the user explicitly asks in that message.
- To verify mobile changes, build or run tests that don't need a simulator, then tell the user what to run on a simulator themselves.
