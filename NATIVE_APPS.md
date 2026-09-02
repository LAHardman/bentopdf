# BentoPDF native apps (Android & iOS)

This turns BentoPDF into real Android and iOS apps you install on your own
devices. It is set up for **personal use and sideloading** - there is no store
listing, no signing identity for distribution, no analytics, and no update
channel. You build it, you install it, it runs offline on your phone.

Everything still runs on-device, exactly like the web version: no file ever
leaves the phone.

---

## What you get

- A real app icon, splash screen and app switcher entry.
- Native chrome instead of a website: a platform-correct header (large titles
  and a frosted bar on iOS, a Material top app bar on Android) and a bottom tab
  bar - **Home**, **Tools**, **Editor**, **More**.
- Results delivered through the **system share sheet**, so "Save to Files",
  AirDrop, Drive, Mail and friends all work. No mystery browser downloads.
- Working Android hardware back button, haptic feedback, keyboard-aware layout
  and safe-area handling on notched devices.
- The app registers as a handler for PDFs and Office documents, so it shows up
  in **Open with** / the share sheet from any file manager.
- **Open in...** - the document on screen can be handed straight to another
  tool (editor, converter, signer) without saving and re-picking it.
- The marketing furniture (hero, feature grid, testimonials, FAQ, donation
  ribbon, GitHub links, footer) is stripped out of the app build.

None of this affects the website - the whole native layer is compiled out of
the normal `npm run build`.

---

## Prerequisites

| Target  | You need                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------- |
| Android | [Android Studio](https://developer.android.com/studio) (includes the SDK and a JDK). Works on macOS, Windows and Linux.   |
| iOS     | A **Mac** with [Xcode](https://developer.apple.com/xcode/) and an Apple ID. iOS apps cannot be built on Windows or Linux. |

Plus Node.js 20+ and the repo's dependencies (`npm install`).

---

## First-time setup

```bash
npm install
npm run native:init      # creates android/ and ios/
npm run native:assets    # generates app icons and splash screens
```

`native:init` generates the `android/` and `ios/` project folders. They are
gitignored on purpose - they are build output, and you can delete and
regenerate them at any time without losing anything.

On Linux or Windows the iOS step is skipped automatically.

---

## Build and install

### Android

```bash
npm run native:android
```

This rebuilds the web app, syncs it into the Android project and opens Android
Studio. From there: **Run ▶** with your phone connected over USB (with
[USB debugging](https://developer.android.com/studio/debug/dev-options) turned
on), and the app installs and launches.

Prefer an APK you can copy to the phone and tap to install?

```bash
npm run native:apk
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is signed with Android's auto-generated debug key. That is fine
for your own devices - it just cannot be published to Play, which is the point
here. You will need to allow "install unknown apps" for whichever app you use
to open the APK.

### iOS

```bash
npm run native:ios
```

This rebuilds, syncs, and opens the project in Xcode. Then, once:

1. Select the **App** target → **Signing & Capabilities**.
2. Tick **Automatically manage signing** and pick your personal Apple ID team
   (add your Apple ID under Xcode → Settings → Accounts if it is not listed).
3. Change the **Bundle Identifier** to something unique to you, e.g.
   `com.yourname.bentopdf` - Apple rejects identifiers already in use.
4. Plug in your iPhone, select it as the run destination, and press **Run ▶**.
5. On the phone: **Settings → General → VPN & Device Management** → trust your
   developer certificate.

**The free Apple Developer tier signs apps for 7 days.** After that the app
stops opening and you re-run step 4 to re-sign it. A paid Apple Developer
account ($99/year) extends this to a year. This is Apple's restriction on
sideloading, not something the project can work around.

---

## iOS without a Mac

Everything above needs a Mac. If you have a paid Apple Developer account you
can skip owning one: the build runs on a hosted macOS machine, and the result
installs on an iPhone with no cable, no Xcode and no 7-day expiry.

There are two ways to get it there, and the workflow takes either:

| | **Ad-hoc** (internal distribution) | **TestFlight** |
| --- | --- | --- |
| Who can install | only devices whose UDID you registered | up to 100 testers on your team |
| Apple review | none | none for internal testing |
| Wait after building | none | 5-15 minutes of processing |
| App Store Connect record | not needed | needed |
| How it installs | an `itms-services://` link opened in Safari | the TestFlight app |
| Build expires | when the profile does (a year) | 90 days |

Ad-hoc is the shorter loop, so it is the workflow's default.

The iOS project itself generates fine on Linux - `cap add ios` only unpacks a
template and wires up Swift Package Manager. Only the *compile* needs macOS.

### What you need once

1. **An App Store Connect API key.** App Store Connect → Users and Access →
   Integrations → App Store Connect API → **+**. Give it the **App Manager**
   role and download the `.p8`. Apple lets you download it exactly once.
   Note the **Key ID** and the **Issuer ID** on that page.
2. **Your Team ID** - developer.apple.com → Membership.
3. **Two bundle IDs and an App Group.** Under Certificates, Identifiers &
   Profiles → Identifiers, register:
   - `com.bentopdf.personal` — the app
   - `com.bentopdf.personal.ShareExtension` — the share extension
   - an **App Group** called `group.com.bentopdf.personal`

   Then enable **App Groups** on both identifiers and tick that group. This is
   the one part the build cannot do for you: an App Group is account-level
   configuration, not something a build setting can create. Skipping it gives a
   signing failure naming the missing entitlement.
4. **For ad-hoc: register the devices.** Either in the portal (Certificates,
   Identifiers & Profiles → Devices → **+**, with each iPhone's UDID) if you
   are using Route A, or with `eas device:create` if you are using Route B,
   which walks the phone through it. The provisioning profile picks up every
   registered device, so adding a tester later means registering their UDID
   and re-running the build - nothing in the repository changes.

   Route B does not need the App Store Connect API key from step 1 at all;
   EAS manages the ad-hoc credentials itself.
5. **For TestFlight only: an app record.** App Store Connect → Apps → **+** →
   New App, with bundle ID `com.bentopdf.personal`. Ad-hoc does not need one.

Changing the bundle ID in `capacitor.config.ts` is fine — the extension's ID
and the App Group are both derived from it, so use `<your id>.ShareExtension`
and `group.<your id>` above.

You do **not** need to create certificates or provisioning profiles by hand.
The build passes `-allowProvisioningUpdates` with the API key, so Xcode creates
and renews them for both targets itself. That is the step that normally forces
you onto a Mac.

### Route A - GitHub Actions (free here)

This repository is public, so GitHub's macOS runners cost nothing.

**The workflow has to be on your default branch before you can run it.** GitHub
resolves manually-triggered workflows from the default branch, so a workflow
that only exists on a feature branch does not appear in the Actions tab at all
and cannot be dispatched by API either. Merge first, then run.

Add four repository secrets (Settings → Secrets and variables → Actions):

| Secret          | Value                                    |
| --------------- | ---------------------------------------- |
| `APPLE_TEAM_ID` | your 10-character Team ID                |
| `ASC_KEY_ID`    | the API Key ID                           |
| `ASC_ISSUER_ID` | the API Issuer ID                        |
| `ASC_KEY_P8`    | the **whole contents** of the `.p8` file |

Then run the **iOS build** workflow from the Actions tab and pick a
`distribution`:

- **adhoc** (default) - builds, signs for your registered devices, and
  publishes the `.ipa` and its install manifest to a GitHub release tagged
  `ios-adhoc`. The install link appears on the run's summary page. The tag is
  reused on every build, so that link never changes.
- **testflight** - builds, signs and uploads. Tick *skip upload* on the first
  run if you only want to prove it compiles.

The `.ipa` goes to a release rather than a branch because it is comfortably
over GitHub's 100 MB limit for committed files - which is also why the Android
APK's pattern of committing the binary does not carry over here.

### Route B - EAS Build (if you already pay for Expo)

EAS builds any native project, not just React Native ones, but BentoPDF does
not fit its defaults: `ios/` is generated rather than committed, and Capacitor
puts the Xcode project at `ios/App` instead of `ios/`. Both configs under
`.eas/build/` are therefore custom build configs that spell out every step.

The two profiles sign differently, because ad-hoc forces the issue:

- **`ios-adhoc`** uses **EAS-managed credentials**, which internal distribution
  requires. EAS creates the ad-hoc provisioning profile covering the devices
  you registered, and then hosts the finished build behind an install URL - so
  there is no manifest to host and no `itms-services://` link to paste.
- **`ios-testflight`** reuses Route A's script and its App Store Connect API
  key, since TestFlight needs no device list.

```bash
npm i -g eas-cli
eas login
eas init                     # writes the project ID into app.json

# Ad-hoc: register each device once. EAS prints a URL to open on the phone,
# or takes a UDID directly.
eas device:create
eas build --platform ios --profile ios-adhoc

# TestFlight instead: the same four values Route A uses, as EAS secrets.
eas secret:create --name APPLE_TEAM_ID --value <team id>
eas secret:create --name ASC_KEY_ID    --value <key id>
eas secret:create --name ASC_ISSUER_ID --value <issuer id>
eas secret:create --name ASC_KEY_P8    --type file --value ./AuthKey_XXXXXX.p8
eas build --platform ios --profile ios-testflight
```

Two adaptations in `.eas/build/ios-adhoc.yml` are worth knowing about, because
both would otherwise fail well into a build:

- **The Gymfile template is supplied by hand.** EAS's default emits the export
  method as `ad-hoc`, which Apple deprecated in Xcode 15.4 and Xcode 26 rejects
  outright ([eas-cli#4040](https://github.com/expo/eas-cli/issues/4040)). The
  template here is EAS's default with that one value hardcoded to the current
  spelling, `release-testing`. Older Xcode images still accept `ad-hoc`, which
  is why plenty of EAS ad-hoc builds work without this.
- **The template names the Xcode project.** EAS writes the Gymfile into `ios/`
  and leaves fastlane to find the project beside it; Capacitor's is a directory
  further down, at `ios/App`.

The share extension needs its own provisioning profile, and EAS has to know it
exists before the Xcode project has been generated. That is what the
`extra.eas.build.experimental.ios.appExtensions` block in `app.json` is for -
it declares the extension's target name, bundle ID and App Group entitlement.
Without it the build fails to sign the extension.

Route A needs no Expo account and publishes its own install link; Route B gives
you EAS's hosted install page and device management. Both produce the same app.

### Getting an ad-hoc build onto a phone

If you built through **EAS** (Route B), this is already done for you: the build
page has an install URL and a QR code, and opening it on a registered device
installs the app. The rest of this section is for Route A, which hosts nothing
and so has to hand you the link itself.

iOS will not install a `.ipa` you simply tap. It installs from an
`itms-services://` link naming a manifest that describes the package, which is
why the build emits a `manifest.plist` next to the `.ipa`.

On the iPhone, open **Safari** and paste the link from the workflow run summary
into the address bar:

```
itms-services://?action=download-manifest&url=https://github.com/<owner>/<repo>/releases/download/ios-adhoc/manifest.plist
```

It has to be Safari - an in-app browser will not hand the link to iOS. Then
confirm the install prompt, and on first launch go to **Settings → General →
VPN & Device Management** and trust the developer.

If pasting a custom-scheme URL proves awkward, put a one-line HTML page with
that link on any HTTPS host and tap it there instead; enabling GitHub Pages on
this repository is enough.

Two things make an install fail quietly: the device's UDID not being on the
provisioning profile (register it, then re-run the build), and the build number
not being higher than the installed one - the build stamps a UTC timestamp, so
that only bites if you install two builds out of order.

### Getting a TestFlight build onto a phone

Processing takes 5-15 minutes after upload. Then in App Store Connect →
TestFlight, add testers to **Internal Testing** (up to 100 people on your team,
no Apple review) and they install through the TestFlight app. Internal builds
expire after 90 days; re-run the workflow to refresh.

Two things to know before you upload:

- **Export compliance.** The build declares `ITSAppUsesNonExemptEncryption` as
  false, on the basis that BentoPDF's PDF encryption is the standard algorithm
  published in the PDF specification, which is exempt. That declaration is
  yours to make, so change it in `scripts/native-patch-ios.mjs` if you disagree.
- **Licensing.** BentoPDF is AGPL-3.0. Distributing an AGPL app through the App
  Store has known friction with Apple's terms. Internal TestFlight testing
  among people on your own team is a much narrower case than public release,
  but it is worth understanding before you go further than that.

---

## After you change the code

```bash
npm run native:sync      # rebuild the web app + copy it into both projects
```

Then hit Run in Android Studio / Xcode again. `native:android` and
`native:ios` already do the sync for you.

---

## How it is wired together

| Piece                                                                          | Where                                          |
| ------------------------------------------------------------------------------ | ---------------------------------------------- |
| App id, name, splash, status bar, WebView settings                             | `capacitor.config.ts`                          |
| Native build target (no service worker, no gzip/brotli copies, resolved links) | `vite.config.ts`, behind `BUILD_TARGET=native` |
| Size trimming for the app bundle                                               | `nativeSlimPlugin` in `vite.config.ts`         |
| Brotli recompression of the LibreOffice payloads                               | `scripts/prepare-native-wasm.mjs`              |
| Native runtime shell                                                           | `src/js/native/`                               |
| Native design layer                                                            | `src/css/native.css`                           |
| Icon and splash sources                                                        | `assets/`                                      |

The shell is loaded from `src/js/main.ts` behind `if (__NATIVE_APP__)`, which
is `false` for every non-native build, so the whole directory - Capacitor
included - is tree-shaken out of the website bundle.

`src/js/native/` breaks down as:

- `platform.ts` - platform detection, plugin availability guards
- `shell.ts` - strips web chrome, injects the header, tab bar and More sheet
- `save.ts` - intercepts `<a download>` and routes results to the share sheet
- `navigation.ts` - Android back button, extensionless link resolution
- `system-ui.ts` - status bar, splash, keyboard, safe areas
- `feedback.ts` / `toast.ts` - haptics and confirmations

Want different tabs? They are a plain list in `src/js/native/routes.ts`.

---

## What the app build strips

The web bundle carries ~155 MB of files; the app installs at ~68 MB. The
native build removes only things no feature depends on:

| Removed                                                            | Saved (installed) |
| ------------------------------------------------------------------ | ----------------- |
| LibreOffice recompressed from gzip to brotli                       | 26.9 MB           |
| Open Graph preview images (link previews only)                     | 3.4 MB            |
| `.ttf` / `.woff` / `.svg` font variants, keeping `woff2`           | 2.6 MB            |
| Source maps                                                        | 2.4 MB            |
| PDF.js viewer locales for languages the app has no translation for | 0.9 MB            |
| The second, byte-identical copy of the PDF.js character maps       | 0.9 MB            |

Every tool, every supported language and every PDF.js runtime font is intact.

The brotli step is the only one with a cost: LibreOffice ships pre-gzipped, and
an APK cannot compress it further, so `scripts/prepare-native-wasm.mjs`
recompresses it (74 MB -> 47 MB). Quality 11 takes about ten minutes, so the
result is cached under `.native-cache/` and only regenerated when the upstream
payload changes. At runtime the app decodes it with a 210 KB WASM brotli
decoder instead of the browser's built-in gzip, which makes the _first_ Office
conversion of a session slightly slower.

## Android and iOS parity

Both apps are the same web build inside the same Capacitor shell, so every
tool, and the whole UI, is identical. What differs is only the OS integration,
and only where the two platforms genuinely work differently:

| Capability                    | Android                              | iOS                                        |
| ----------------------------- | ------------------------------------ | ------------------------------------------ |
| All 130+ tools, viewer, editor | yes                                  | yes                                        |
| Opening a document from a file manager | intent filters, 12 MIME types | `CFBundleDocumentTypes`, the same 12 types |
| Appearing in the share sheet   | `SEND` / `SEND_MULTIPLE` intent filters | a real Share Extension target        |
| Saving a result               | system share sheet, then Documents   | share sheet, then Files → On My iPhone     |
| Back navigation               | hardware back button                 | Back button in the app header              |
| Status bar                    | WebView below it, tinted             | edge-to-edge with real safe-area insets    |
| Keyboard                      | resizes the layout                   | resizes, accessory bar hidden              |
| Haptics, splash, app icon     | yes                                  | yes                                        |

Two differences are worth knowing about rather than treating as bugs:

- **Back.** Android's hardware button also closes an open modal and needs a
  double-press to quit; iOS has no hardware button, so the header's Back
  button is the equivalent. Both reach the same places.
- **Receiving a share.** Both platforms appear directly in the share sheet,
  but by different machinery. Android declares `SEND` intent filters on the
  main activity. iOS needs a separate Share Extension process, which is a
  second Xcode target - see below. Android accepts multiple files at once
  (`SEND_MULTIPLE`); the iOS extension takes one at a time.

### How the iOS share extension works

`ios/` is regenerated on every build, so the extension cannot be a thing you
click together once in Xcode. `scripts/native-patch-ios.mjs` builds the target
from the sources in `native/ios/`, and then checks its own work - the target
type, the compiled sources, the embed phase, the target dependency and every
file path a build setting points at - so a Capacitor template change fails here
with a sentence rather than inside Xcode ten minutes into a CI run.

The extension and the app are separate processes with separate storage, so a
shared document travels like this:

1. iOS hands the extension the file.
2. It copies it into the App Group container both targets are entitled to.
3. It opens `bentopdf://open?path=...` to wake the app.
4. `src/js/native/open-with.ts` fetches that path through Capacitor's file
   bridge and routes the document to the right tool.

If step 3 fails, the extension says so rather than failing silently - the file
is already in the shared container, so opening BentoPDF is a real recovery.

One thing to know: opening the containing app from a share extension is done
by walking the responder chain to reach `openURL:`, because an extension has
no `UIApplication` of its own. It is the long-standing way to do this and is
fine for TestFlight, but it is worth knowing it exists if you ever take the app
further than internal testing.

The iOS app is around 100 MB installed, the same payload the Android build
carries; the 67 MB APK figure is its compressed download size.

---

## Things worth knowing

- **App size.** BentoPDF bundles a lot of WebAssembly (LibreOffice, Ghostscript,
  Tesseract, PDFium, vips), so the app is large: roughly **68 MB** to install.
  The native build already strips everything it can without losing a feature
  (see below). If you want it smaller than that, something has to go -
  `DISABLE_TOOLS` in `.env` trims the UI, and you can then drop the matching
  WASM payloads from `public/`. LibreOffice alone is ~47 MB of the total, so
  dropping the Office converters is by far the biggest single saving.
- **Very large files.** Handing a file to the OS goes through an in-memory
  base64 copy, so a multi-hundred-MB PDF can be tight on an older phone.
- **Threaded WASM.** A few tools use `SharedArrayBuffer` for multi-threading,
  which needs cross-origin isolation headers the WebView does not send. Those
  tools fall back to their single-threaded path - slower, still correct.
- **Not store-ready.** No privacy manifest, age rating, store metadata or
  release signing config is set up here, and the AGPL-3.0 licence has its own
  implications for App Store distribution. This is a personal build.
