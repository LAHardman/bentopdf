/**
 * A plain PDF viewer: open a file, scroll it, zoom it. No editing, no tools.
 *
 * Pages are laid out as correctly sized placeholders up front so the scrollbar
 * is honest about the document's length, and only the ones near the viewport
 * are actually rendered. A 400-page PDF would otherwise try to hold 400
 * canvases in memory, which a phone will not tolerate.
 */
import '../utils/setup-pdf-worker.js';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { formatBytes } from '../utils/helpers.js';

/** Zoom steps, as a multiple of fit-to-width. */
/** What the +/- buttons snap between. Pinch is continuous within the range. */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
const DEFAULT_ZOOM = 1;

/** Render pages this far outside the viewport, in screen-heights. */
const OVERSCAN = 1.5;

/** Cap the backing store so a big zoom on a big page cannot exhaust memory. */
const MAX_CANVAS_PIXELS = 16_000_000;

interface PageSlot {
  index: number;
  element: HTMLElement;
  canvas: HTMLCanvasElement | null;
  task: RenderTask | null;
  rendered: boolean;
  /** Unscaled page size in CSS pixels at scale 1. */
  width: number;
  height: number;
}

interface ViewerState {
  doc: PDFDocumentProxy | null;
  slots: PageSlot[];
  /** Continuous zoom multiplier, not a step index - pinch lands anywhere. */
  zoom: number;
  /** Scale that makes the widest page fit the container. */
  fitScale: number;
  current: number;
  /** Kept so "Open in..." can hand the same document to another tool. */
  file: File | null;
}

const state: ViewerState = {
  doc: null,
  slots: [],
  zoom: DEFAULT_ZOOM,
  fitScale: 1,
  current: 1,
  file: null,
};

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const showStatus = (message: string): void => {
  $('status-text').textContent = message;
  $('status-overlay').classList.remove('hidden');
};
const hideStatus = (): void => $('status-overlay').classList.add('hidden');

let errorTimer: number | undefined;
const showError = (message: string): void => {
  console.error('[view-pdf]', message);
  const banner = $('error-banner');
  banner.textContent = message;
  banner.classList.remove('hidden');
  window.clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => banner.classList.add('hidden'), 6000);
};

const scale = (): number => state.fitScale * state.zoom;

/**
 * Scale that fits the widest page to the viewport, with a little margin.
 * Measured on the scroller: the page column itself is min-w-max, so its own
 * width is whatever the content needs rather than what is on screen.
 */
const fitScaleFor = (widest: number): number =>
  Math.max(($('pages-scroll').clientWidth - 16) / Math.max(widest, 1), 0.1);

// ---------------------------------------------------------------- layout --

/** Sizes every placeholder for the current zoom without rendering anything. */
const layoutPages = (): void => {
  const s = scale();
  for (const slot of state.slots) {
    slot.element.style.width = `${Math.round(slot.width * s)}px`;
    slot.element.style.height = `${Math.round(slot.height * s)}px`;
  }
  $('zoom-level').textContent = `${Math.round(state.zoom * 100)}%`;
};

/** Drops a rendered page back to a placeholder, freeing its canvas. */
const release = (slot: PageSlot): void => {
  slot.task?.cancel();
  slot.task = null;
  if (slot.canvas) {
    // Zero the backing store first; some browsers keep the memory otherwise.
    slot.canvas.width = 0;
    slot.canvas.height = 0;
    slot.canvas.remove();
    slot.canvas = null;
  }
  slot.rendered = false;
};

const renderPage = async (slot: PageSlot): Promise<void> => {
  if (!state.doc || slot.rendered) return;
  slot.rendered = true;

  try {
    const page = await state.doc.getPage(slot.index + 1);

    // Render at device resolution, but never beyond the pixel budget.
    const s = scale();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: s * dpr });
    const budget = Math.sqrt(
      MAX_CANVAS_PIXELS / Math.max(viewport.width * viewport.height, 1)
    );
    const finalViewport =
      budget < 1 ? page.getViewport({ scale: s * dpr * budget }) : viewport;

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(finalViewport.width);
    canvas.height = Math.floor(finalViewport.height);
    canvas.className = 'block w-full h-full';
    const context = canvas.getContext('2d');
    if (!context) return;

    slot.element.appendChild(canvas);
    slot.canvas = canvas;

    slot.task = page.render({
      canvas,
      canvasContext: context,
      viewport: finalViewport,
    });
    await slot.task.promise;
    slot.task = null;
  } catch (error) {
    // A cancelled render is the normal result of scrolling past a page.
    if ((error as { name?: string })?.name !== 'RenderingCancelledException') {
      showError(`Could not draw page ${slot.index + 1}: ${describe(error)}`);
    }
    slot.rendered = false;
  }
};

/** Renders what is on screen, releases what is far away, updates the counter. */
const updateVisible = (): void => {
  if (!state.slots.length) return;

  const margin = window.innerHeight * OVERSCAN;
  let firstVisible = state.current;

  for (const slot of state.slots) {
    const box = slot.element.getBoundingClientRect();
    const near = box.bottom > -margin && box.top < window.innerHeight + margin;

    if (near && !slot.rendered) void renderPage(slot);
    else if (!near && slot.rendered) release(slot);

    if (box.top <= window.innerHeight / 2 && box.bottom > 0) {
      firstVisible = slot.index + 1;
    }
  }

  if (firstVisible !== state.current) {
    state.current = firstVisible;
    $('page-indicator').textContent =
      `${state.current} / ${state.slots.length}`;
  }
};

let scrollTimer: number | undefined;
const onScroll = (): void => {
  window.clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(updateVisible, 80);
};

/**
 * Applies a new zoom, keeping whatever was under `focus` under it afterwards.
 *
 * Without the focal correction, pinching to read something in the corner of a
 * page walks it off the screen - the content grows around the scroll origin
 * rather than around your fingers.
 */
const setZoom = (zoom: number, focus?: { x: number; y: number }): void => {
  const clamped = Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
  if (Math.abs(clamped - state.zoom) < 0.001) return;

  const scroller = $('pages-scroll');
  const pages = $('pages');

  // Where the focal point sits in unscaled page coordinates, before the change.
  const before = pages.getBoundingClientRect();
  const anchor = focus ?? {
    x: before.left + scroller.clientWidth / 2,
    y: window.innerHeight / 2,
  };
  const previous = scale();
  const contentX = (anchor.x - before.left) / previous;
  const contentY = (anchor.y - before.top) / previous;

  state.zoom = clamped;

  // Everything on screen is now the wrong size; re-render from scratch.
  for (const slot of state.slots) release(slot);
  layoutPages();

  // Measure again rather than predict: the scroller clamps, and the column is
  // centred, so the new origin is not simply the old one times the ratio.
  const after = pages.getBoundingClientRect();
  scroller.scrollLeft += after.left + contentX * scale() - anchor.x;
  window.scrollBy(0, after.top + contentY * scale() - anchor.y);

  updateVisible();
};

/** The +/- buttons move to the next rung of the ladder from wherever we are. */
const stepZoom = (direction: 1 | -1): void => {
  const next =
    direction > 0
      ? ZOOM_STEPS.find((step) => step > state.zoom + 0.001)
      : [...ZOOM_STEPS].reverse().find((step) => step < state.zoom - 0.001);
  if (next !== undefined) setZoom(next);
};

// ------------------------------------------------------------------ open --

const openFile = async (file: File): Promise<void> => {
  showStatus('Opening the PDF…');
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data }).promise;
    state.doc = doc;
    state.file = file;
    state.zoom = DEFAULT_ZOOM;
    state.current = 1;

    // Measure every page so the placeholders are the right shape.
    const container = $('pages');
    container.textContent = '';
    state.slots = [];

    let widest = 0;
    for (let i = 0; i < doc.numPages; i += 1) {
      const viewport = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
      widest = Math.max(widest, viewport.width);

      const element = document.createElement('div');
      element.className = 'bg-white shadow-2xl flex-shrink-0';
      element.dataset.page = String(i + 1);
      container.appendChild(element);

      state.slots.push({
        index: i,
        element,
        canvas: null,
        task: null,
        rendered: false,
        width: viewport.width,
        height: viewport.height,
      });
    }

    // Reveal the viewer before measuring: a hidden element reports a width of
    // zero, which would collapse the fit scale to its floor and render the
    // document at postage-stamp size.
    $('uploader').classList.add('hidden');
    $('viewer').classList.remove('hidden');
    $('doc-name').textContent = `${file.name} · ${formatBytes(file.size)}`;
    $('page-indicator').textContent = `1 / ${doc.numPages}`;

    state.fitScale = fitScaleFor(widest);

    layoutPages();
    updateVisible();
  } catch (error) {
    showError(`Could not open ${file.name}: ${describe(error)}`);
  }
  hideStatus();
};

const closeDocument = (): void => {
  for (const slot of state.slots) release(slot);
  void state.doc?.destroy();
  state.doc = null;
  state.slots = [];
  state.file = null;
  $('pages').textContent = '';
  $('viewer').classList.add('hidden');
  $('uploader').classList.remove('hidden');
  $<HTMLInputElement>('file-input').value = '';
};

// ----------------------------------------------------------------- pinch --

/**
 * Two-finger zoom.
 *
 * Re-rendering pdf.js pages on every gesture frame is far too slow to track
 * fingers, so the gesture scales the page column with a CSS transform - cheap,
 * and the GPU does it - and the real render happens once, on release. The
 * transform is thrown away at that point, so the pages end up crisp rather
 * than a stretched bitmap.
 *
 * One finger is left entirely alone: the scroller already pans horizontally
 * and the window scrolls vertically, which is what dragging a zoomed page
 * should do.
 */
const initPinchZoom = (): void => {
  const scroller = $('pages-scroll');
  const pages = $('pages');

  let startSpread = 0;
  let startZoom = 1;
  let focus = { x: 0, y: 0 };
  let ratio = 1;

  const spread = (touches: TouchList): number =>
    Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY
    );
  const midpoint = (touches: TouchList): { x: number; y: number } => ({
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  });

  const commit = (): void => {
    if (!startSpread) return;
    startSpread = 0;
    pages.style.transform = '';
    pages.style.transformOrigin = '';
    scroller.style.touchAction = '';
    setZoom(startZoom * ratio, focus);
    ratio = 1;
  };

  // Touch events rather than pointer events, deliberately. With pointers, the
  // browser has already claimed the first finger for scrolling by the time the
  // second arrives, and it answers by cancelling the pointer - which ended the
  // gesture a frame after it began, so a pinch of any size only ever moved the
  // zoom by the little it had managed to measure. A touch event carries every
  // finger at once and preventDefault on it actually stops the scroll.
  scroller.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 2) return;
      startSpread = spread(event.touches);
      startZoom = state.zoom;
      focus = midpoint(event.touches);
      ratio = 1;
      scroller.style.touchAction = 'none';
      event.preventDefault();
    },
    { passive: false }
  );

  scroller.addEventListener(
    'touchmove',
    (event) => {
      if (!startSpread) return;
      if (event.touches.length !== 2) return;
      event.preventDefault();

      // Clamp here too, so the preview cannot promise a zoom the commit
      // then refuses and snaps back from.
      const target = Math.min(
        Math.max((startZoom * spread(event.touches)) / startSpread, MIN_ZOOM),
        MAX_ZOOM
      );
      ratio = target / startZoom;
      focus = midpoint(event.touches);

      const box = pages.getBoundingClientRect();
      pages.style.transformOrigin = `${focus.x - box.left}px ${focus.y - box.top}px`;
      pages.style.transform = `scale(${ratio})`;
    },
    { passive: false }
  );

  for (const type of ['touchend', 'touchcancel'] as const) {
    scroller.addEventListener(type, (event) => {
      if (event.touches.length < 2) commit();
    });
  }

  // Trackpad pinch and ctrl+wheel arrive as wheel events, not touches.
  scroller.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom(state.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), {
        x: event.clientX,
        y: event.clientY,
      });
    },
    { passive: false }
  );
};

// ---------------------------------------------------------------- wiring --

const init = (): void => {
  const input = $<HTMLInputElement>('file-input');
  const dropZone = $('drop-zone');

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void openFile(file);
  });

  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('border-indigo-500');
  });
  dropZone.addEventListener('dragleave', () =>
    dropZone.classList.remove('border-indigo-500')
  );
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('border-indigo-500');
    const file = event.dataTransfer?.files?.[0];
    if (file) void openFile(file);
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    if (!state.slots.length) return;
    const widest = state.slots.reduce((max, s) => Math.max(max, s.width), 1);
    state.fitScale = fitScaleFor(widest);
    for (const slot of state.slots) release(slot);
    layoutPages();
    updateVisible();
  });

  $('zoom-in').addEventListener('click', () => stepZoom(1));
  $('zoom-out').addEventListener('click', () => stepZoom(-1));
  initPinchZoom();
  $('close-document').addEventListener('click', closeDocument);

  // Sends the open PDF straight to another tool - no save-and-re-pick round
  // trip. Loaded lazily so the viewer's first paint does not wait on it.
  void import('../components/open-in.js').then(({ mountOpenIn }) =>
    mountOpenIn({
      container: $('viewer-toolbar'),
      getFile: () => state.file,
      currentPage: 'view-pdf.html',
    })
  );

  document.getElementById('back-to-tools')?.addEventListener('click', () => {
    window.location.href = import.meta.env.BASE_URL;
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
