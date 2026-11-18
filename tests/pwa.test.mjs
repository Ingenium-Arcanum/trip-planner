// Checks that the offline/install files stay in sync with the app's files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const sw = read('sw.js');
const precache = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
const filesIn = dir => readdirSync(new URL(dir, root), { recursive: true }).map(f => dir + String(f).replace(/\\/g, '/')).filter(f => /\.[a-z]+$/.test(f));

test('every precached file exists', () => {
  for (const f of precache) if (f !== './') assert.ok(existsSync(new URL(f, root)), f + ' is listed in sw.js but missing');
});

test('every app file is precached (so it works offline)', () => {
  const needed = [...filesIn('js/'), ...filesIn('css/'), ...filesIn('icons/'), 'index.html', 'manifest.json', 'trips/index.json'];
  for (const f of needed) assert.ok(precache.includes(f), f + ' is missing from PRECACHE in sw.js');
});

test('manifest is installable: name, start_url, standalone, 192 + 512 icons that exist', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.ok(m.name && m.short_name && m.start_url);
  assert.equal(m.display, 'standalone');
  const sizes = m.icons.map(i => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(existsSync(new URL(i.src, root)), i.src);
});

test('index.html links the manifest and icons', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest.json">/);
  assert.match(html, /apple-touch-icon/);
});
