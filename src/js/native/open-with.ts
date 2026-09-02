/**
 * "Open with" and "Share to" support on the native apps.
 *
 * Documents arrive three ways: Android hands us a `content://` URI, iOS a
 * `file://` one, and the iOS share extension a `bentopdf://open?path=...` URL
 * pointing into the App Group container the two processes share.
 *
 * Two things make that awkward: the Filesystem plugin refuses content URIs
 * outright, and each tool lives on its own page, so the bytes have to survive
 * a navigation.
 *
 * The route that works is Capacitor's own bridge - `convertFileSrc` turns any
 * of them into a URL the WebView is allowed to fetch - and the shared document
 * handoff to carry the blob across the page change.
 */
import {
  HANDOFF_PARAM,
  handoffUrl,
  putHandoff,
} from '../utils/document-handoff.js';
import { hasPlugin, isNativeApp } from './platform.js';
import { showToast } from './toast.js';

/** Which tool should open a given document. */
const targetPage = (name: string, mimeType: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';

  // Opening a PDF from elsewhere almost always means "read this", so it goes
  // to the plain viewer; the editor is a deliberate choice from the tool list.
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'view-pdf.html';

  // Writer documents can be edited; everything else opens read-only.
  if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)) {
    return 'office-editor.html';
  }
  return 'office-viewer.html';
};

/** Scheme the share extension uses to hand a document over. */
const SHARE_SCHEME = 'bentopdf:';

interface Incoming {
  /** Something `convertFileSrc` can turn into a fetchable URL. */
  source: string;
  /** The real filename, when the sender knew it. */
  name: string | null;
}

/**
 * Works out what to fetch, or null when the URL is not a document at all -
 * our own pages come through here too when the app resumes.
 */
export const parseIncoming = (url: string): Incoming | null => {
  if (url.toLowerCase().startsWith(`${SHARE_SCHEME}//`)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }

    const filePath = parsed.searchParams.get('path');
    if (!filePath) return null;

    return {
      source: filePath.startsWith('/') ? `file://${filePath}` : filePath,
      name: parsed.searchParams.get('name'),
    };
  }

  if (/^content:|^file:/i.test(url)) return { source: url, name: null };
  return null;
};

/** Best-effort filename. A content URI rarely carries a usable one. */
const filenameFor = (url: string, mimeType: string): string => {
  const tail = decodeURIComponent(url.split('?')[0].split('/').pop() ?? '');
  if (/\.[a-z0-9]{2,5}$/i.test(tail)) return tail;

  const ext =
    {
      'application/pdf': 'pdf',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        'docx',
      'application/vnd.oasis.opendocument.text': 'odt',
      'application/rtf': 'rtf',
      'text/rtf': 'rtf',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        'xlsx',
      'application/vnd.oasis.opendocument.spreadsheet': 'ods',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        'pptx',
      'application/vnd.oasis.opendocument.presentation': 'odp',
    }[mimeType] ?? 'pdf';

  return `document.${ext}`;
};

/**
 * Fetches the document behind an incoming URI and routes it to a tool.
 */
const receive = async (url: string): Promise<void> => {
  const incoming = parseIncoming(url);
  if (!incoming) return;

  try {
    showToast('Opening document…');

    const capacitor = (
      window as unknown as {
        Capacitor?: { convertFileSrc?: (u: string) => string };
      }
    ).Capacitor;
    const fetchable =
      capacitor?.convertFileSrc?.(incoming.source) ?? incoming.source;

    const response = await fetch(fetchable);
    if (!response.ok) {
      throw new Error(`could not read the file (HTTP ${response.status})`);
    }

    const blob = await response.blob();
    if (!blob.size) throw new Error('the file came back empty');

    const name = incoming.name ?? filenameFor(incoming.source, blob.type);
    await putHandoff({ name, type: blob.type, blob });

    window.location.href = handoffUrl(targetPage(name, blob.type));
  } catch (error) {
    console.error('[native] Could not open the incoming document', error);
    showToast(
      `Could not open that document: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/** Remembers the launch URL we have already acted on, for this app run. */
const LAUNCH_HANDLED_KEY = 'bentopdf:launch-handled';

/**
 * True the first time it is asked about a given launch URL, false after.
 *
 * `getLaunchUrl` reports the intent the *activity* was started with, and that
 * intent does not change when the WebView navigates. So opening a document
 * navigates to the tool page, the tool page starts up, asks again, gets the
 * same URL, and navigates again - forever, with the "Opening document" toast
 * flashing on each pass and the native shell never surviving long enough to
 * render.
 *
 * sessionStorage is exactly the right lifetime: it dies with the WebView, so
 * launching the app again on the same file is correctly treated as new.
 */
const claimLaunchUrl = (url: string): boolean => {
  // A page reached through the handoff is downstream of a launch that was
  // already acted on. Cheap second line of defence for when storage throws.
  if (new URLSearchParams(window.location.search).has(HANDOFF_PARAM)) {
    return false;
  }

  try {
    if (sessionStorage.getItem(LAUNCH_HANDLED_KEY) === url) return false;
    sessionStorage.setItem(LAUNCH_HANDLED_KEY, url);
  } catch {
    // Storage unavailable. The check above still covers the loop.
  }
  return true;
};

export const initOpenWith = async (): Promise<void> => {
  if (!isNativeApp()) return;

  // Delivering a document that is already waiting is main.ts's job now - it
  // happens on every platform, not just here.

  if (!hasPlugin('App')) return;
  const { App } = await import('@capacitor/app');

  // Launched by a document.
  const launch = await App.getLaunchUrl().catch((): undefined => undefined);
  if (launch?.url && claimLaunchUrl(launch.url)) await receive(launch.url);

  // Handed a document while already running. Not guarded: each of these is a
  // fresh, deliberate share, even if it is the same file twice.
  App.addListener('appUrlOpen', (event): void => void receive(event.url)).catch(
    () => {}
  );
};
