import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeTrip, decodeTrip, slimTrip, shareUrl, codeFromHash } from '../js/share.js';
import { normalize } from '../js/store.js';

/** A made-up trip with enough text to make compression matter. */
const sample = () => normalize({
  id: 'trip-abc', title: 'Sample weekend', destination: 'Sample City', tz: 'Europe/Brussels',
  basemap: { roads: [[1, 2]] }, templatePath: 'x.json', hideSetup: true, discKm: 8,
  places: Array.from({ length: 30 }, (_, i) => ({
    id: 'p' + i, name: 'Place ' + i, cat: 'sight', lat: 50 + i / 1000, lng: 4 + i / 1000,
    desc: 'A long description of a lovely place worth visiting, with café and a view — ' + i
  })),
  days: [{ id: 'd1', date: '2030-06-01', start: '10:00', stops: [{ id: 's1', place: 'p1', dur: 60, note: 'Book ahead ✓' }] }],
  stays: [{ id: 'st', place: 'p2', from: '2030-06-01', to: '2030-06-02' }],
  arrive: { place: 'p3', time: '10:00' }
});

test('round trip: compressed link gives back the same trip (minus device-only fields)', async () => {
  const t = sample();
  const code = await encodeTrip(t, { now: 1234 });
  assert.equal(code[0], '1');
  assert.match(code, /^[A-Za-z0-9_-]+$/, 'URL-safe characters only');
  const back = await decodeTrip(code);
  assert.equal(back.id, 'trip-abc', 'keeps the id so re-sharing updates the same trip');
  assert.equal(back.sharedAt, 1234);
  assert.deepEqual(back.places, t.places);
  assert.deepEqual(back.days, t.days);
  assert.deepEqual(back.stays, t.stays);
  assert.deepEqual(back.arrive, t.arrive);
  for (const k of ['basemap', 'templatePath', 'hideSetup', 'discKm']) assert.equal(back[k] ?? null, null, k + ' stripped');
  assert.equal(back.days[0].stops[0].note, 'Book ahead ✓', 'non-ASCII survives');
});

test('compression makes the link much shorter; uncompressed fallback still works', async () => {
  const t = sample();
  const small = await encodeTrip(t), big = await encodeTrip(t, { compress: false });
  assert.equal(big[0], '0');
  assert.ok(small.length < big.length / 3, `${small.length} vs ${big.length}`);
  assert.deepEqual((await decodeTrip(big)).places, t.places);
});

test('broken, cut-off or foreign links are rejected', async () => {
  const code = await encodeTrip(sample());
  await assert.rejects(decodeTrip(code.slice(0, code.length / 2)));
  await assert.rejects(decodeTrip('9abc'));
  await assert.rejects(decodeTrip(''));
  await assert.rejects(decodeTrip('0' + Buffer.from('{"hello":1}').toString('base64url')), /Not a trip/);
});

test('slimTrip does not touch the original', () => {
  const t = sample();
  slimTrip(t);
  assert.ok(t.basemap && t.templatePath);
});

test('shareUrl / codeFromHash', () => {
  assert.equal(shareUrl('https://x.github.io/app/#old', '1abc'), 'https://x.github.io/app/#t=1abc');
  assert.equal(shareUrl('https://x.github.io/app/', '1abc'), 'https://x.github.io/app/#t=1abc');
  assert.equal(codeFromHash('#t=1a-b_C'), '1a-b_C');
  assert.equal(codeFromHash('#other'), null);
  assert.equal(codeFromHash(''), null);
});
