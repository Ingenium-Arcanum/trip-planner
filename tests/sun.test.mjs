import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunTimesUtc, toLocalMin, sunsetFor, darkNote } from '../js/sun.js';

const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const near = (got, want, tol = 5, msg) => assert.ok(Math.abs(toMin(got) - toMin(want)) <= tol, `${msg}: got ${got}, expected about ${want}`);
const at = (lat, lng, tz, date) => sunsetFor({ center: [lat, lng], tz }, { date })?.time;

test('sunset matches published times (summer/winter, both hemispheres, west of Greenwich)', () => {
  near(at(50.85, 4.35, 'Europe/Brussels', '2030-06-21'), '22:00', 5, 'Brussels midsummer (CEST)');
  near(at(50.85, 4.35, 'Europe/Brussels', '2030-12-21'), '16:40', 5, 'Brussels midwinter (CET)');
  near(at(40.71, -74.01, 'America/New_York', '2030-06-21'), '20:31', 5, 'New York midsummer');
  near(at(-33.87, 151.21, 'Australia/Sydney', '2030-01-01'), '20:10', 5, 'Sydney new year (AEDT)');
});

test('no sunset during polar night or midnight sun', () => {
  assert.equal(sunTimesUtc(69.65, 18.96, '2030-12-21').polar, 'night');
  assert.equal(sunTimesUtc(69.65, 18.96, '2030-06-21').polar, 'day');
  assert.equal(at(69.65, 18.96, 'Europe/Oslo', '2030-12-21'), undefined);
});

test('a typed sunset wins; no position or a bad time zone gives nothing', () => {
  assert.deepEqual(sunsetFor({ center: [50.85, 4.35], tz: 'Europe/Brussels' }, { date: '2030-06-21', sunset: '21:15' }), { time: '21:15', auto: false });
  assert.equal(sunsetFor({ tz: 'Europe/Brussels' }, { date: '2030-06-21' }), null);
  assert.equal(sunsetFor({ center: [50.85, 4.35], tz: 'Not/AZone' }, { date: '2030-06-21' }), null);
  assert.equal(sunsetFor({ center: [50.85, 4.35], tz: 'Europe/Brussels' }, { date: '2030-06-21' }).auto, true);
});

test('toLocalMin applies the zone offset, including summer time', () => {
  assert.equal(toLocalMin(600, '2030-01-15', 'Europe/Brussels'), 660);
  assert.equal(toLocalMin(600, '2030-07-15', 'Europe/Brussels'), 720);
  assert.equal(toLocalMin(600, '2030-07-15', 'UTC'), 600);
});

test('darkNote only flags outdoor stops that run into the dark', () => {
  const sun = 16 * 60 + 20;
  assert.match(darkNote('park', sun + 10, sun + 40, sun), /After dark/);
  assert.match(darkNote('nature', sun - 30, sun + 60, sun), /Gets dark at 16:20/);
  assert.equal(darkNote('park', sun - 30, sun + 5, sun), null, 'a few minutes into dusk is fine');
  assert.equal(darkNote('museum', sun + 10, sun + 60, sun), null);
  assert.equal(darkNote('park', sun + 10, sun + 60, null), null);
});
