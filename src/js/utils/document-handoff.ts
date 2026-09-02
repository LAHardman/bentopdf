/**
 * Carries an open document from one tool to another.
 *
 * Every tool in BentoPDF is its own page, so "open this in the editor" means a
 * full navigation - and a File object does not survive one. IndexedDB does,
 * and unlike sessionStorage it will hold a 200 MB PDF without complaint.
 *
 * The receiving side is deliberately dumb: `deliverHandoff` just fills the
 * page's `#file-input` and fires a change event, which is the same path a
 * user-picked file takes. That means a tool needs no special support to be an
 * "Open in..." target - 112 of the 122 pages have that input already.
 *
 * Both the in-app "Open in..." menu and Android/iOS "open with" use this.
 */

const DB_NAME = 'bentopdf-native';
const STORE = 'incoming';
const HANDOFF_KEY = 'file';

/** Marks a navigation as carrying a handed-off document. */
export const HANDOFF_PARAM = 'open-doc';

export interface HandoffDocument {
  name: string;
  type: string;
  blob: Blob;
}

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (): void => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB'));
  });

export const putHandoff = async (file: HandoffDocument): Promise<void> => {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(file, HANDOFF_KEY);
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void =>
        reject(tx.error ?? new Error('handoff write failed'));
    });
  } finally {
    db.close();
  }
};

/**
 * Reads the waiting document. `consume` clears it in the same transaction, so
 * a document opens exactly once; the browse-all-tools screen peeks instead,
 * because the user has not chosen a destination yet.
 */
const readHandoff = async (consume: boolean): Promise<HandoffDocument | null> => {
  const db = await openDb();
  try {
    return await new Promise<HandoffDocument | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const get = store.get(HANDOFF_KEY);
      get.onsuccess = (): void => {
        if (consume) store.delete(HANDOFF_KEY);
        resolve((get.result as HandoffDocument | undefined) ?? null);
      };
      get.onerror = (): void =>
        reject(get.error ?? new Error('handoff read failed'));
    });
  } finally {
    db.close();
  }
};

export const takeHandoff = (): Promise<HandoffDocument | null> =>
  readHandoff(true);

export const peekHandoff = (): Promise<HandoffDocument | null> =>
  readHandoff(false);

export const clearHandoff = async (): Promise<void> => {
  const db = await openDb();
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(HANDOFF_KEY);
      // A failure to clear is not worth surfacing; the next write overwrites it.
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void => resolve();
    });
  } finally {
    db.close();
  }
};

/**
 * `1` means "the destination is this page, open it"; `browse` means "the user
 * has not picked a tool yet, keep the document waiting while they look".
 */
export type HandoffMode = '1' | 'browse';

/** URL of a tool page carrying a handed-off document. */
export const handoffUrl = (page: string, mode: HandoffMode = '1'): string =>
  `${import.meta.env.BASE_URL}${page}?${HANDOFF_PARAM}=${mode}`;

/** Stores `file` and navigates to `page`, which will open it on arrival. */
export const openInTool = async (
  page: string,
  file: File,
  mode: HandoffMode = '1'
): Promise<void> => {
  await putHandoff({ name: file.name, type: file.type, blob: file });
  window.location.href = handoffUrl(page, mode);
};

/**
 * Finds the input to drop the document into.
 *
 * Most pages call it `#file-input`, but not all - and a page like the Multi
 * Tool has several file inputs for different jobs. Matching the `accept`
 * attribute against the document picks the right one instead of the first one.
 */
const findFileInput = (file: File): HTMLInputElement | null => {
  const byId = document.getElementById('file-input');
  if (byId instanceof HTMLInputElement) return byId;

  const inputs = [
    ...document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
  ];
  if (!inputs.length) return null;

  const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
  const accepts = (input: HTMLInputElement): boolean => {
    const accept = input.accept.toLowerCase();
    if (!accept) return true;
    return accept
      .split(',')
      .map((entry) => entry.trim())
      .some(
        (entry) =>
          entry === ext ||
          entry === file.type ||
          (entry.endsWith('/*') &&
            file.type.startsWith(entry.slice(0, -1)))
      );
  };

  return inputs.find(accepts) ?? inputs[0];
};

/**
 * On a page reached with `?open-doc=1`, hands the waiting document to the
 * tool by filling its file input - the same path a user-picked file takes.
 */
const deliverHandoff = async (): Promise<boolean> => {
  try {
    const incoming = await takeHandoff();
    if (!incoming) return false;

    const file = new File([incoming.blob], incoming.name, {
      type: incoming.type || 'application/octet-stream',
    });

    const input = findFileInput(file);
    if (!input) return false;

    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch (error) {
    console.error('[handoff] Could not open the document', error);
    return false;
  }
};

/**
 * Browse mode: the user chose "All tools" and is picking a destination. The
 * document stays in the handoff store, and every tool link on the page is
 * rewritten to carry it, so whichever they click opens with it loaded.
 */
const initBrowse = async (): Promise<void> => {
  const waiting = await peekHandoff();
  if (!waiting) return;

  // Pinned to the bottom, not the top: every page here has a fixed header, and
  // anything prepended to <body> ends up hidden underneath it.
  const banner = document.createElement('div');
  banner.id = 'handoff-banner';
  banner.className =
    'fixed bottom-0 inset-x-0 z-50 bg-indigo-600 text-white px-4 py-3 flex items-center gap-3 text-sm shadow-lg';
  banner.style.paddingBottom = 'calc(0.75rem + env(safe-area-inset-bottom))';
  banner.innerHTML = `
    <span class="flex-1 min-w-0 truncate">
      Choose a tool for <strong>${waiting.name}</strong>
    </span>
    <button type="button" data-cancel class="underline shrink-0">Cancel</button>`;
  document.body.appendChild(banner);

  // Keep the bar off the end of the page's own content.
  const restorePadding = document.body.style.paddingBottom;
  document.body.style.paddingBottom = `${banner.offsetHeight}px`;

  banner.querySelector('[data-cancel]')?.addEventListener('click', () => {
    void clearHandoff().then(() => {
      banner.remove();
      document.body.style.paddingBottom = restorePadding;
      document.body.classList.remove('handoff-browsing');
    });
  });

  document.body.classList.add('handoff-browsing');

  // Capture phase, so this wins over any of the page's own link handling.
  document.addEventListener(
    'click',
    (event) => {
      const link = (event.target as HTMLElement)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;

      const href = link.getAttribute('href') ?? '';
      if (!href.endsWith('.html') || href.includes(HANDOFF_PARAM)) return;

      event.preventDefault();
      window.location.href = `${href}?${HANDOFF_PARAM}=1`;
    },
    true
  );
};

/**
 * Called from main.ts on every page. Nothing happens unless the URL says a
 * document is in flight, so no tool needs to opt in.
 */
export const initHandoff = async (): Promise<void> => {
  const mode = new URLSearchParams(window.location.search).get(HANDOFF_PARAM);
  if (mode === 'browse') await initBrowse();
  else if (mode) await deliverHandoff();
};
