#!/usr/bin/env bash
#
# Builds the iOS app and ships it to TestFlight from a machine nobody has
# opened Xcode on. Used by both CI routes (.github/workflows/ios-testflight.yml
# and .eas/build/ios-testflight.yml) so there is one build definition, not two
# that drift apart.
#
# Signing is done entirely with an App Store Connect API key: -allowProvisioningUpdates
# lets xcodebuild create the distribution certificate and provisioning profile
# on demand, which is what removes the "export a .p12 from a Mac" step.
#
# Required environment:
#   APPLE_TEAM_ID          10-character team ID from developer.apple.com
#   ASC_KEY_ID             App Store Connect API key ID
#   ASC_ISSUER_ID          App Store Connect API issuer ID
#   ASC_KEY_P8             the .p8 private key, contents (not a path)
# Optional:
#   BUILD_NUMBER           defaults to a UTC timestamp, which is always
#                          higher than the last one TestFlight saw
set -euo pipefail

cd "$(dirname "$0")/.."

for var in APPLE_TEAM_ID ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_P8; do
  if [ -z "${!var:-}" ]; then
    echo "::error::$var is not set. See the iOS section of NATIVE_APPS.md." >&2
    exit 1
  fi
done

BUILD_NUMBER="${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
WORKSPACE_DIR="ios/App"
ARCHIVE="$PWD/build/ios/App.xcarchive"
EXPORT_DIR="$PWD/build/ios/export"

# altool looks for the key in a fixed set of directories; this is one of them.
KEY_DIR="$HOME/.appstoreconnect/private_keys"
KEY_PATH="$KEY_DIR/AuthKey_${ASC_KEY_ID}.p8"
mkdir -p "$KEY_DIR"
printf '%s\n' "$ASC_KEY_P8" > "$KEY_PATH"
chmod 600 "$KEY_PATH"
# The key is a credential; do not leave it behind on a shared runner.
trap 'rm -f "$KEY_PATH"' EXIT

echo "--- Building the web bundle (brotli recompression is the slow part) ---"
npm run native:build

echo "--- Generating the iOS project ---"
if [ -d "$WORKSPACE_DIR/App.xcodeproj" ]; then
  npx cap sync ios
else
  npx cap add ios
fi
node scripts/native-patch-ios.mjs

echo "--- Archiving (build $BUILD_NUMBER) ---"
rm -rf "$ARCHIVE" "$EXPORT_DIR"
xcodebuild archive \
  -project "$WORKSPACE_DIR/App.xcodeproj" \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER"

echo "--- Exporting the .ipa ---"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$WORKSPACE_DIR/ExportOptions.plist" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

IPA="$(find "$EXPORT_DIR" -name '*.ipa' -maxdepth 1 | head -1)"
if [ -z "$IPA" ]; then
  echo "::error::No .ipa was produced." >&2
  exit 1
fi
echo "Built $IPA ($(du -h "$IPA" | cut -f1))"

if [ "${SKIP_UPLOAD:-}" = "1" ]; then
  echo "--- SKIP_UPLOAD set, stopping before TestFlight ---"
  exit 0
fi

echo "--- Validating before upload (catches most rejections early) ---"
xcrun altool --validate-app \
  -f "$IPA" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo "--- Uploading to TestFlight ---"
xcrun altool --upload-app \
  -f "$IPA" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo "Uploaded build $BUILD_NUMBER. TestFlight processing takes 5-15 minutes."
