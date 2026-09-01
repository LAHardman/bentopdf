import { describe, expect, it } from 'vitest';
import { parseIncoming } from '../js/native/open-with.js';

describe('parseIncoming', () => {
  it('unpacks a handover from the iOS share extension', () => {
    const result = parseIncoming(
      'bentopdf://open?path=%2Fprivate%2Fgroup%2FShareInbox%2FQ3.pdf&name=Q3%20Report.pdf'
    );
    expect(result).toEqual({
      source: 'file:///private/group/ShareInbox/Q3.pdf',
      // The sender knew the real name, so it beats guessing from the path.
      name: 'Q3 Report.pdf',
    });
  });

  it('keeps the path when the extension sent no name', () => {
    expect(parseIncoming('bentopdf://open?path=%2Ftmp%2Fa.docx')).toEqual({
      source: 'file:///tmp/a.docx',
      name: null,
    });
  });

  it('passes Android content URIs through untouched', () => {
    expect(parseIncoming('content://com.android.providers/document/42')).toEqual(
      { source: 'content://com.android.providers/document/42', name: null }
    );
  });

  it('passes iOS file URLs through untouched', () => {
    expect(parseIncoming('file:///var/mobile/Inbox/report.pdf')).toEqual({
      source: 'file:///var/mobile/Inbox/report.pdf',
      name: null,
    });
  });

  // The app's own pages come through the same listener on resume.
  it.each([
    'capacitor://localhost/index.html',
    'https://bentopdf.com/merge-pdf',
    'bentopdf://open',
    'bentopdf://open?name=only-a-name.pdf',
    'bentopdf://',
    '',
  ])('ignores %s', (url) => {
    expect(parseIncoming(url)).toBeNull();
  });
});
