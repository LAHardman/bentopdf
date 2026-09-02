/**
 * The "Open in..." menu.
 *
 * A document you are already looking at should not have to be saved and
 * re-picked to run another tool over it. This puts the open document one tap
 * away from the editor, the converters, or anything else, by handing it over
 * through the shared document handoff.
 *
 * The shortlist per file type is curated rather than generated: 133 tools in
 * one sheet is not a menu, it is a haystack. "All tools" covers the rest.
 */
import { openInTool } from '../utils/document-handoff.js';

interface Target {
  page: string;
  label: string;
  icon: string;
  hint?: string;
}

/** Which family of documents we are looking at. */
export type Kind = 'pdf' | 'word' | 'sheet' | 'slides' | 'other';

export const kindOf = (name: string): Kind => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)) return 'word';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'slides';
  return 'other';
};

export const TARGETS: Record<Kind, Target[]> = {
  pdf: [
    {
      page: 'view-pdf.html',
      label: 'PDF Viewer',
      icon: 'book-open',
      hint: 'Read it',
    },
    {
      page: 'edit-pdf.html',
      label: 'PDF Editor',
      icon: 'pencil',
      hint: 'Annotate, highlight, redact',
    },
    {
      page: 'edit-pdf-text.html',
      label: 'Edit PDF Text',
      icon: 'type',
      hint: 'Change the words in place',
    },
    {
      page: 'pdf-multi-tool.html',
      label: 'PDF Multi Tool',
      icon: 'layout-grid',
      hint: 'Reorder, rotate, delete pages',
    },
    { page: 'split-pdf.html', label: 'Split', icon: 'scissors' },
    { page: 'merge-pdf.html', label: 'Merge', icon: 'copy' },
    { page: 'compress-pdf.html', label: 'Compress', icon: 'zap' },
    { page: 'pdf-to-docx.html', label: 'Convert to Word', icon: 'file-text' },
    { page: 'ocr-pdf.html', label: 'OCR', icon: 'scan-text' },
    { page: 'sign-pdf.html', label: 'Sign', icon: 'pen-tool' },
    { page: 'encrypt-pdf.html', label: 'Protect', icon: 'lock' },
  ],
  word: [
    {
      page: 'office-editor.html',
      label: 'Word Editor',
      icon: 'pencil',
      hint: 'Edit the text',
    },
    {
      page: 'office-viewer.html',
      label: 'Office Viewer',
      icon: 'book-open',
      hint: 'Read it',
    },
    { page: 'word-to-pdf.html', label: 'Convert to PDF', icon: 'file-output' },
  ],
  sheet: [
    { page: 'office-viewer.html', label: 'Office Viewer', icon: 'book-open' },
    { page: 'excel-to-pdf.html', label: 'Convert to PDF', icon: 'file-output' },
  ],
  slides: [
    { page: 'office-viewer.html', label: 'Office Viewer', icon: 'book-open' },
    {
      page: 'powerpoint-to-pdf.html',
      label: 'Convert to PDF',
      icon: 'file-output',
    },
  ],
  other: [],
};

/** Tools that only exist in some builds get dropped rather than 404. */
const available = (targets: Target[], disabled: Set<string>): Target[] =>
  targets.filter((target) => !disabled.has(target.page.replace('.html', '')));

const disabledTools = (): Set<string> => {
  const raw = (
    window as unknown as { __DISABLED_TOOLS__?: string[] | string }
  ).__DISABLED_TOOLS__;
  const list = Array.isArray(raw) ? raw : (raw ?? '').split(',');
  return new Set(list.map((id) => id.trim()).filter(Boolean));
};

export interface OpenInOptions {
  /** Where the trigger button is inserted. */
  container: HTMLElement;
  /** The document as it currently stands, or null if nothing is open. */
  getFile: () => File | null;
  /** The page doing the asking, so it is not offered as a destination. */
  currentPage: string;
}

/**
 * Adds an "Open in..." button to `container` and wires up its sheet.
 */
export const mountOpenIn = ({
  container,
  getFile,
  currentPage,
}: OpenInOptions): void => {
  const button = document.createElement('button');
  button.id = 'open-in-button';
  button.type = 'button';
  // The label is not optional on a phone. As an icon alone this was simply
  // not found - nothing about a share glyph says "run another tool on this".
  button.className =
    'btn bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-3 py-2 rounded-lg flex items-center gap-2 whitespace-nowrap shrink-0';
  button.innerHTML =
    '<i data-lucide="wand-2" class="w-4 h-4"></i><span>Open in…</span>';
  container.appendChild(button);
  // lucide-init already ran on DOMContentLoaded, so this icon needs its own pass.
  void import('lucide').then(({ createIcons, icons }) => createIcons({ icons }));

  let sheet: HTMLElement | null = null;

  const close = (): void => {
    sheet?.remove();
    sheet = null;
    document.removeEventListener('keydown', onKeydown);
  };

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
  }

  const open = (): void => {
    if (sheet) {
      close();
      return;
    }

    const file = getFile();
    if (!file) return;

    const disabled = disabledTools();
    const targets = available(
      TARGETS[kindOf(file.name)].filter(
        (target) => target.page !== currentPage
      ),
      disabled
    );

    sheet = document.createElement('div');
    sheet.className =
      'fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Open in another tool');

    const rows = targets
      .map(
        (target) => `
        <button
          type="button"
          data-page="${target.page}"
          class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-700/60 rounded-lg"
        >
          <i data-lucide="${target.icon}" class="w-5 h-5 text-indigo-400 shrink-0"></i>
          <span class="min-w-0">
            <span class="block text-sm text-gray-100">${target.label}</span>
            ${target.hint ? `<span class="block text-xs text-gray-400">${target.hint}</span>` : ''}
          </span>
        </button>`
      )
      .join('');

    sheet.innerHTML = `
      <div class="bg-gray-800 border border-gray-700 w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[80vh] flex flex-col">
        <div class="px-4 pt-4 pb-2 flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <h2 class="text-base font-semibold text-white">Open in…</h2>
            <p class="text-xs text-gray-400 truncate">${file.name}</p>
          </div>
          <button type="button" data-close class="text-gray-400 hover:text-white p-1" aria-label="Close">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>
        <div class="overflow-y-auto px-2 pb-2">
          ${rows || '<p class="px-4 py-6 text-sm text-gray-400">No specific tools for this file type.</p>'}
          <button
            type="button"
            data-browse
            class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-700/60 rounded-lg border-t border-gray-700 mt-2 pt-4"
          >
            <i data-lucide="grid-3x3" class="w-5 h-5 text-gray-400 shrink-0"></i>
            <span class="block text-sm text-gray-100">All tools…</span>
          </button>
        </div>
      </div>`;

    document.body.appendChild(sheet);
    void import('lucide').then(({ createIcons, icons }) =>
      createIcons({ icons })
    );
    document.addEventListener('keydown', onKeydown);

    sheet.addEventListener('click', (event) => {
      const element = event.target as HTMLElement;
      // A click on the backdrop itself, not on the panel.
      if (element === sheet || element.closest('[data-close]')) {
        close();
        return;
      }

      const browse = element.closest('[data-browse]');
      if (browse) {
        void openInTool('', file, 'browse');
        return;
      }

      const row = element.closest<HTMLElement>('[data-page]');
      if (row?.dataset.page) void openInTool(row.dataset.page, file);
    });
  };

  button.addEventListener('click', open);
};
