import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every data-i18n key on a page has to exist, or the page renders the key.
 *
 * This is not theoretical: three pages shipped referencing tools:viewPdf.name
 * and friends without those keys ever being added, so the heading read
 * "viewPdf.name" on the website and in the app's header.
 */
const root = path.resolve(__dirname, '../..');
const pagesDir = path.join(root, 'src/pages');
const localesDir = path.join(root, 'public/locales/en');

const bundles = new Map<string, Record<string, unknown>>();
for (const file of fs.readdirSync(localesDir)) {
  if (file.endsWith('.json')) {
    bundles.set(
      file.replace('.json', ''),
      JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf8'))
    );
  }
}

/** i18next's own lookup: `namespace:a.b.c`, defaulting to the common bundle. */
const resolves = (key: string): boolean => {
  const [namespace, rest] = key.includes(':')
    ? key.split(/:(.+)/)
    : ['common', key];
  let node: unknown = bundles.get(namespace);
  if (node === undefined) return false;
  for (const part of rest.split('.')) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[part];
    if (node === undefined) return false;
  }
  return typeof node === 'string';
};

const keysByPage = new Map<string, string[]>();
for (const file of fs.readdirSync(pagesDir)) {
  if (!file.endsWith('.html')) continue;
  const html = fs.readFileSync(path.join(pagesDir, file), 'utf8');
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)]
    .map((match) => match[1])
    // Attribute-targeting forms like `[title]tools:x.y` address an attribute
    // rather than the element's text; the key is what follows.
    .map((key) => key.replace(/^\[[^\]]+\]/, ''))
    .filter((key) => !key.includes(';'));
  if (keys.length) keysByPage.set(file, [...new Set(keys)]);
}

describe('page translation keys', () => {
  it('found pages to check', () => {
    expect(keysByPage.size).toBeGreaterThan(50);
  });

  it('every key on every page resolves in the English bundle', () => {
    const missing: string[] = [];
    for (const [page, keys] of keysByPage) {
      for (const key of keys) {
        if (!resolves(key)) missing.push(`${page}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
