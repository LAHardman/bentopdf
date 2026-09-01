/**
 * "Open with" and "Share to" support on the native apps.
 *
 * Android hands us the document as a `content://` URI. Two things make that
 * awkward: the Filesystem plugin refuses content URIs outright, and each tool
 * lives on its own page, so the bytes have to survive a navigation.
 *
 * The route that works is Capacitor's own bridge - `convertFileSrc` turns a
 * content URI into a `/_capacitor_content_` URL the WebView can fetch - and
 * IndexedDB to carry the blob across the page change, since a 50 MB PDF has
 * no business in sessionStorage.
 */
import { hasPlugin, isNativeApp } from './platform.js';
import { showToast } from './toast.js';

const DB_NAME = 'bentopdf-native';
const STORE = 'incoming';
const HANDOFF_KEY = 'file';
/** Marks a navigation as carrying a handed-off document. */
const HANDOFF_PARAM = 'native-open';

interface IncomingFile {
  name: string;
  type: string;
  blob: Blob;
}

/** Which tool should open a given document. */
const targetPage = (name: string, mimeType: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'pdf' || mimeType === 'application/pdf') return 'edit-pdf.html';

  // Writer documents can be edited; everything else opens read-only.
  if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)) {
    return 'office-editor.html';
  }
  return 'office-viewer.html';
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

// --------------------------------------------------------------- handoff db -

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'));
  });

const putHandoff = async (file: IncomingFile): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(file, HANDOFF_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('handoff write failed'));
  });
  db.close();
};

/** Reads and clears the handoff - a document should only open once. */
const takeHandoff = async (): Promise<IncomingFile | null> => {
  const db = await openDb();
  const file = await new Promise<IncomingFile | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(HANDOFF_KEY);
    get.onsuccess = () => {
      store.delete(HANDOFF_KEY);
      resolve((get.result as IncomingFile | undefined) ?? null);
    };
    get.onerror = () => reject(get.error ?? new Error('handoff read failed'));
  });
  db.close();
  return file;
};

// ------------------------------------------------------------------ receive -

/**
 * Fetches the document behind an incoming URI and routes it to a tool.
 */
const receive = async (url: string): Promise<void> => {
  // Our own pages arrive here too when the app is resumed; ignore them.
  if (!/^content:|^file:/i.test(url)) return;

  try {
    showToast('Opening document…');

    const capacitor = (
      window as unknown as {
        Capacitor?: { convertFileSrc?: (u: string) => string };
      }
    ).Capacitor;
    const fetchable = capacitor?.convertFileSrc?.(url) ?? url;

    const response = await fetch(fetchable);
    if (!response.ok) {
      throw new Error(`could not read the file (HTTP ${response.status})`);
    }

    const blob = await response.blob();
    if (!blob.size) throw new Error('the file came back empty');

    const name = filenameFor(url, blob.type);
    await putHandoff({ name, type: blob.type, blob });

    const page = targetPage(name, blob.type);
    window.location.href = `${import.meta.env.BASE_URL}${page}?${HANDOFF_PARAM}=1`;
  } catch (error) {
    console.error('[native] Could not open the incoming document', error);
    showToast(
      `Could not open that document: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/**
 * Hands a received document to the tool page by filling its file input, which
 * is the same path a user-picked file takes - no per-tool wiring needed.
 */
const deliverToPage = async (): Promise<void> => {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(HANDOFF_PARAM)) return;

  const input = document.getElementById('file-input');
  if (!(input instanceof HTMLInputElement)) return;

  try {
    const incoming = await takeHandoff();
    if (!incoming) return;

    const file = new File([incoming.blob], incoming.name, {
      type: incoming.type || 'application/octet-stream',
    });

    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (error) {
    console.error('[native] Could not hand the document to the page', error);
    showToast('Could not open the shared document');
  }
};

export const initOpenWith = async (): Promise<void> => {
  if (!isNativeApp()) return;

  // A document waiting from a previous navigation takes priority.
  await deliverToPage();

  if (!hasPlugin('App')) return;
  const { App } = await import('@capacitor/app');

  // Launched by a document.
  const launch = await App.getLaunchUrl().catch((): undefined => undefined);
  if (launch?.url) await receive(launch.url);

  // Handed a document while already running.
  App.addListener('appUrlOpen', (event): void => void receive(event.url)).catch(
    () => {}
  );
};
