import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TARGETS, kindOf } from '../js/components/open-in.js';

const pagesDir = path.resolve(__dirname, '../pages');

describe('Open in… targets', () => {
  const targets = Object.values(TARGETS).flat();

  it('offers something for every document family we claim to handle', () => {
    expect(TARGETS.pdf.length).toBeGreaterThan(0);
    expect(TARGETS.word.length).toBeGreaterThan(0);
    expect(TARGETS.sheet.length).toBeGreaterThan(0);
    expect(TARGETS.slides.length).toBeGreaterThan(0);
  });

  // A target naming a page that does not exist is a dead end the user only
  // discovers by tapping it, so check them against the filesystem.
  it.each(targets.map((target) => target.page))('%s exists', (page) => {
    expect(fs.existsSync(path.join(pagesDir, page))).toBe(true);
  });

  // Delivery works by filling a file input, so a target without one silently
  // does nothing on arrival.
  it.each(targets.map((target) => target.page))(
    '%s has a file input to receive the document',
    (page) => {
      const html = fs.readFileSync(path.join(pagesDir, page), 'utf8');
      expect(html).toMatch(/type="file"/);
    }
  );
});

describe('kindOf', () => {
  it.each([
    ['report.pdf', 'pdf'],
    ['Letter.DOCX', 'word'],
    ['notes.odt', 'word'],
    ['budget.xlsx', 'sheet'],
    ['deck.pptx', 'slides'],
    ['photo.png', 'other'],
    ['no-extension', 'other'],
  ])('%s -> %s', (name, expected) => {
    expect(kindOf(name)).toBe(expected);
  });
});
