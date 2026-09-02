/**
 * Entry point for the native (Capacitor) app shell.
 *
 * This module - and everything it imports - is only pulled in by builds made
 * with `npm run native:build`, where `__NATIVE_APP__` is true. The web build
 * tree-shakes the whole thing away, so none of it ships to bentopdf.com.
 *
 * See NATIVE_APPS.md for how to build and install the apps.
 */
import '../../css/native.css';
import { isNativeApp } from './platform.js';
import { initSystemUi, hideSplash } from './system-ui.js';
import { initNativeShell } from './shell.js';
import { initNativeDownloads } from './save.js';
import { initNativeNavigation } from './navigation.js';
import { initTouchFeedback } from './feedback.js';
import { initOpenWith } from './open-with.js';

let started = false;

/**
 * Drops the first-paint guard the native HTML build injects into every page.
 *
 * The guard hides the body so the website's own framing does not flash up
 * while the shell is still replacing it. Whatever happens above, this has to
 * run, or the app is left showing nothing at all.
 */
const revealApp = (): void =>
  document.documentElement.classList.remove('native-booting');

/**
 * Last line of defence: if anything upstream of us throws before the shell
 * boots, the user would be left staring at a frozen splash screen. This runs
 * as soon as the module is evaluated, independent of `initNativeApp`.
 */
if (isNativeApp()) {
  window.setTimeout((): void => {
    revealApp();
    void hideSplash();
  }, 5000);
}

export const initNativeApp = async (): Promise<void> => {
  if (!isNativeApp()) {
    revealApp();
    return;
  }
  if (started) return;
  started = true;

  try {
    // Downloads are patched first: a tool can finish before the chrome is up.
    initNativeDownloads();
    initNativeShell();
    initTouchFeedback();

    await Promise.all([initSystemUi(), initNativeNavigation()]);

    // Last, so a document handed in by Android lands on a fully built screen.
    await initOpenWith();
  } catch (error) {
    console.error('[native] Shell failed to initialise', error);
  } finally {
    // Whatever happened above, never leave the user staring at the splash -
    // or, now, at a deliberately blank page.
    revealApp();
    await hideSplash();
  }
};
