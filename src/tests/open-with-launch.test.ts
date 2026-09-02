import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression cover for the open-with loop.
 *
 * Android's getLaunchUrl reports the intent the activity started with, and
 * that does not change when the WebView navigates. Acting on it once per page
 * load meant opening a PDF from Messages navigated, restarted, saw the same
 * URL, and navigated again - forever.
 */
const platform = { value: 'android' as 'android' | 'ios' | 'web' };
const launchUrl = { value: undefined as string | undefined };
const navigations: string[] = [];

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platform.value !== 'web',
    getPlatform: () => platform.value,
    isPluginAvailable: () => true,
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    getLaunchUrl: () => Promise.resolve({ url: launchUrl.value }),
    addListener: () => Promise.resolve({ remove: () => {} }),
  },
}));

vi.mock('@/js/native/toast.js', () => ({ showToast: () => {} }));

// receive() ends in a navigation; jsdom will not do one, so record it instead.
vi.mock('@/js/utils/document-handoff.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    putHandoff: () => Promise.resolve(),
    handoffUrl: (page: string) => {
      const url = `/${page}?open-doc=1`;
      navigations.push(url);
      return url;
    },
  };
});

const CONTENT_URI = 'content://com.android.providers.downloads/document/42';

const runInit = async (search = ''): Promise<void> => {
  window.history.replaceState({}, '', `/view-pdf.html${search}`);
  vi.resetModules();
  const { initOpenWith } = await import('@/js/native/open-with');
  await initOpenWith();
};

describe('open-with launch handling', () => {
  beforeEach(() => {
    navigations.length = 0;
    sessionStorage.clear();
    platform.value = 'android';
    launchUrl.value = CONTENT_URI;

    // A tiny PDF, so receive() gets past its empty-blob guard.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          blob: () =>
            Promise.resolve(new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
        })
      )
    );
    vi.stubGlobal('Capacitor', { convertFileSrc: (u: string) => u });
  });

  it('acts on the launch document once', async () => {
    await runInit();
    expect(navigations).toEqual(['/view-pdf.html?open-doc=1']);
  });

  it('does not act again when the same launch URL comes back', async () => {
    await runInit();
    expect(navigations).toHaveLength(1);

    // The activity's intent is unchanged, so this is what really happened on
    // the page the first navigation landed on.
    await runInit();
    await runInit();
    expect(navigations).toHaveLength(1);
  });

  it('ignores the launch URL on a page already carrying a handoff', async () => {
    // Covers the case where sessionStorage is unavailable and throws.
    const broken = vi.spyOn(Storage.prototype, 'getItem');
    broken.mockImplementation(() => {
      throw new Error('storage disabled');
    });

    await runInit('?open-doc=1');
    expect(navigations).toEqual([]);
    broken.mockRestore();
  });

  it('treats a different document as new', async () => {
    await runInit();
    launchUrl.value = 'content://com.android.providers.downloads/document/99';
    await runInit();
    expect(navigations).toHaveLength(2);
  });

  it('does nothing off-platform', async () => {
    platform.value = 'web';
    await runInit();
    expect(navigations).toEqual([]);
  });
});
