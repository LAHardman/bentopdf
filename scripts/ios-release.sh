#!/usr/bin/env bash
#
# Builds the iOS app from a machine nobody has opened Xcode on, and either
# ships it to TestFlight or produces an ad-hoc build the registered devices can
# install over the air.
#
# Signing is done entirely with an App Store Connect API key: -allowProvisioningUpdates
# lets xcodebuild create the certificate and provisioning profile on demand,
# which is what removes the "export a .p12 from a Mac" step. For ad-hoc that
# profile covers every device registered on the team, so registering a UDID in
# the developer portal is all it takes to add a tester.
#
# Required environment:
#   APPLE_TEAM_ID          10-character team ID from developer.apple.com
#   ASC_KEY_ID             App Store Connect API key ID
#   ASC_ISSUER_ID          App Store Connect API issuer ID
#   ASC_KEY_P8             the .p8 private key, contents (not a path)
# Optional:
#   DISTRIBUTION           "testflight" (default) or "adhoc"
#   IPA_BASE_URL           adhoc only: the HTTPS directory the .ipa will be
#                          served from, used to write the install manifest
#   BUILD_NUMBER           defaults to a UTC timestamp, which is always
#                          higher than the last one TestFlight saw. Two digits
#                          of year, not four: CFBundleVersion components must
#                          fit in 32 bits, and 202609012145 does not.
set -euo pipefail

cd "$(dirname "$0")/.."

for var in APPLE_TEAM_ID ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_P8; do
  if [ -z "${!var:-}" ]; then
    echo "::error::$var is not set. See the iOS section of NATIVE_APPS.md." >&2
    exit 1
  fi
done

DISTRIBUTION="${DISTRIBUTION:-testflight}"
case "$DISTRIBUTION" in
  testflight) EXPORT_OPTIONS="ExportOptions.plist" ;;
  adhoc) EXPORT_OPTIONS="ExportOptions-adhoc.plist" ;;
  *)
    echo "::error::DISTRIBUTION must be 'testflight' or 'adhoc', got '$DISTRIBUTION'." >&2
    exit 1
    ;;
esac

BUILD_NUMBER="${BUILD_NUMBER:-$(date -u +%y%m%d%H%M)}"
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

echo "--- Archiving for $DISTRIBUTION (build $BUILD_NUMBER) ---"
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
  -exportOptionsPlist "$WORKSPACE_DIR/$EXPORT_OPTIONS" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

IPA="$(find "$EXPORT_DIR" -name '*.ipa' -maxdepth 1 | head -1)"
if [ -z "$IPA" ]; then
  echo "::error::No .ipa was produced." >&2
  exit 1
fi

# xcodebuild names the export after the scheme ("App.ipa"). Rename it so the
# download URL is predictable enough to write into the manifest before the
# file has been uploaded anywhere.
if [ "$(basename "$IPA")" != "BentoPDF.ipa" ]; then
  mv "$IPA" "$EXPORT_DIR/BentoPDF.ipa"
  IPA="$EXPORT_DIR/BentoPDF.ipa"
fi
echo "Built $IPA ($(du -h "$IPA" | cut -f1))"

if [ "$DISTRIBUTION" = "adhoc" ]; then
  # iOS will not install an .ipa you simply tap. It installs from an
  # itms-services:// link pointing at a manifest that names the package, so
  # the build has to emit one alongside the .ipa.
  BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleIdentifier' "$ARCHIVE/Info.plist")"
  IPA_NAME="$(basename "$IPA")"

  if [ -z "${IPA_BASE_URL:-}" ]; then
    echo "::warning::IPA_BASE_URL is not set; the manifest will need its URL filled in by hand."
  fi

  cat > "$EXPORT_DIR/manifest.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>items</key>
	<array>
		<dict>
			<key>assets</key>
			<array>
				<dict>
					<key>kind</key>
					<string>software-package</string>
					<key>url</key>
					<string>${IPA_BASE_URL:-REPLACE_ME}/${IPA_NAME}</string>
				</dict>
			</array>
			<key>metadata</key>
			<dict>
				<key>bundle-identifier</key>
				<string>${BUNDLE_ID}</string>
				<key>bundle-version</key>
				<string>${BUILD_NUMBER}</string>
				<key>kind</key>
				<string>software</string>
				<key>title</key>
				<string>BentoPDF</string>
			</dict>
		</dict>
	</array>
</dict>
</plist>
PLIST

  echo "Wrote $EXPORT_DIR/manifest.plist for $BUNDLE_ID build $BUILD_NUMBER."
  echo "Install link: itms-services://?action=download-manifest&url=${IPA_BASE_URL:-REPLACE_ME}/manifest.plist"
  exit 0
fi

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
