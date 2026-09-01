#!/usr/bin/env node
/**
 * One-time setup for the native (Capacitor) apps.
 *
 * Generates the `android/` and `ios/` project folders, which are build output
 * rather than source - they are gitignored and can be deleted and regenerated
 * from `capacitor.config.ts` at any time.
 *
 * Usage:  npm run native:init            # both platforms it can build
 *         npm run native:init -- android # just one
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const run = (command) =>
  execSync(command, { cwd: root, stdio: 'inherit', env: process.env });

const platforms = requested.length ? requested : ['android', 'ios'];

// Both projects generate anywhere - `cap add ios` only unpacks a template and
// wires up Swift Package Manager, no Xcode involved. *Building* the iOS one
// still needs macOS, which is what the CI workflow in .github/workflows is for.
const available = platforms.filter(
  (platform) => platform === 'android' || platform === 'ios'
);

if (!available.length) {
  console.log('[native] Nothing to set up.');
  process.exit(0);
}

// `cap add` needs a webDir that exists, so make sure there is a build first.
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.log('[native] No dist/ yet - running the native web build first.\n');
  run('npm run native:build');
}

for (const platform of available) {
  if (fs.existsSync(path.join(root, platform))) {
    console.log(`[native] ${platform}/ already exists - syncing instead.`);
    run(`npx cap sync ${platform}`);
    continue;
  }
  console.log(`\n[native] Creating the ${platform} project...`);
  run(`npx cap add ${platform}`);
}

console.log(`
[native] Done.

Next steps:
  npm run native:assets      generate app icons and splash screens
  npm run native:android     build + open the project in Android Studio
  npm run native:ios         build + open the project in Xcode (macOS only)

See NATIVE_APPS.md for installing the apps on your own devices.
`);
