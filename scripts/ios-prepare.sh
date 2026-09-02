#!/usr/bin/env bash
#
# Builds the web bundle and generates the iOS Xcode project, ready to archive.
#
# Split out from ios-release.sh because the two distribution routes diverge
# only after this point: the GitHub Actions route signs with an App Store
# Connect API key, while EAS installs its own managed credentials. Everything
# up to here is identical, and should stay that way.
#
# Runs anywhere - `cap add ios` only unpacks a template and wires up Swift
# Package Manager. Only the compile needs macOS.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "--- Building the web bundle (brotli recompression is the slow part) ---"
npm run native:build

echo "--- Generating the iOS project ---"
if [ -d "ios/App/App.xcodeproj" ]; then
  npx cap sync ios
else
  npx cap add ios
fi

# Document types, the shared scheme, export options and the share extension
# target - none of which Capacitor's template carries.
node scripts/native-patch-ios.mjs
