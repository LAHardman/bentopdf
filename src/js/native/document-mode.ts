/**
 * Native-app adjustments to the tool pages themselves.
 *
 * The web build talks in uploads and downloads because a browser has no other
 * vocabulary. Inside the app none of that applies: the file comes from the
 * device, the result goes back to it through the share sheet, and nothing was
 * ever going anywhere else - so the reassurances and the drag-and-drop
 * instructions are just furniture.
 *
 * The second job here is space. Once a document is open, a phone should give
 * it the whole screen rather than a strip between two bars.
 */

const root = document.documentElement;

/** Set while a document is open, so the CSS can reclaim the screen. */
const DOCUMENT_MODE = 'native-doc-open';

/**
 * Rewrites a translated element and drops its `data-i18n`, so the i18n pass
 * that runs after us does not put the web wording back.
 */
const retitle = (selector: string, text: string): void => {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    element.textContent = text;
    element.removeAttribute('data-i18n');
  }
};

const hideAll = (selector: string): void => {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    element.classList.add('native-hidden');
  }
};

/** Replaces the web's upload/download vocabulary with the device's. */
export const applyNativeCopy = (): void => {
  // Nothing leaves the device, so the promise that it will not is redundant -
  // and the engine notice describes a download the app has already bundled.
  hideAll('[data-i18n="upload.filesNeverLeave"]');
  hideAll('[data-i18n="tools.firstLoadNotice"]');

  // There is no dragging on a phone.
  hideAll('[data-i18n="upload.orDragAndDrop"]');
  retitle('[data-i18n="upload.clickToSelect"]', 'Choose a file');
  retitle('[data-i18n="upload.addMore"]', 'Add files');

  // Results go to the share sheet, which is a save, not a download.
  for (const control of document.querySelectorAll<HTMLElement>(
    'button, a, span'
  )) {
    if (control.children.length) continue;
    const label = control.textContent?.trim() ?? '';
    if (/^download\b/i.test(label)) {
      control.textContent = label.replace(/^download\b/i, 'Save');
      control.removeAttribute('data-i18n');
    }
  }
};

// ---------------------------------------------------------- document mode -

/**
 * Works out whether a document is currently open.
 *
 * The tools do not share a state flag, but they do share a shape: an uploader
 * that gets hidden, or a workspace that gets shown. Either is a reliable
 * signal, and a file input holding a file is the backstop for tools that do
 * neither.
 */
const documentIsOpen = (): boolean => {
  const uploader = document.getElementById('uploader');
  if (uploader?.classList.contains('hidden')) return true;

  const workspace = document.getElementById('workspace');
  if (workspace && !workspace.classList.contains('hidden')) return true;

  for (const input of document.querySelectorAll<HTMLInputElement>(
    'input[type="file"]'
  )) {
    if (input.files?.length) return true;
  }
  return false;
};

const sync = (): void => {
  root.classList.toggle(DOCUMENT_MODE, documentIsOpen());
};

export const initDocumentMode = (): void => {
  sync();

  // Tools flip these classes when a document loads or is closed.
  const observer = new MutationObserver(sync);
  for (const id of ['uploader', 'workspace', 'tool-interface']) {
    const element = document.getElementById(id);
    if (element) observer.observe(element, { attributeFilter: ['class'] });
  }

  // Backstop for tools that leave their uploader in place.
  document.addEventListener(
    'change',
    (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === 'file') sync();
    },
    true
  );
};
