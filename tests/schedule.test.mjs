import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDay, hoursCheck, bestIndex, autoTravel, travelFor, findStop, scheduledIds } from '../js/schedule.js';
import { normalize } from '../js/store.js';
import { parseCoords } from '../js/geo.js';

/**
 * A made-up two-day city trip in the "old style": airport and hotel are explicit stops
 * (no stays/arrive/depart). Day 1: airport → booked museum 11:45 → … → hotel. Day 2: hotel → … → airport.
 */
const trip = () => normalize({
  title: 'Sample weekend', destination: 'Sample City', tz: 'Europe/Brussels',
  places: [
    { id: 'airport', name: 'Airport', cat: 'transport', lat: 50.4264, lng: 4.7501 },
    { id: 'hotel', name: 'Hotel', cat: 'hotel', lat: 50.3290, lng: 4.6410 },
    { id: 'museum', name: 'Museum', cat: 'museum', lat: 50.3439, lng: 4.7435, hours: { 6: ['09:30-18:00'], 0: ['09:30-17:00'] } },
    { id: 'market', name: 'Market', cat: 'food', lat: 50.3425, lng: 4.7358 },
    { id: 'castle', name: 'Castle', cat: 'sight', lat: 50.3429, lng: 4.7326 },
    { id: 'pub', name: 'Pub', cat: 'pub', lat: 50.3434, lng: 4.7368 },
    { id: 'park', name: 'Park', cat: 'park', lat: 50.3382, lng: 4.7409 },
    { id: 'brewery', name: 'Brewery', cat: 'sight', lat: 50.3419, lng: 4.7133 },
    { id: 'coach', name: 'Coach stop', cat: 'transport', lat: 50.3470, lng: 4.7409 }
  ],
  days: [
    { date: '2030-06-01', start: '10:00', stops: [
      { place: 'airport', dur: 30 }, { place: 'museum', dur: 75, fixed: '11:30' }, { place: 'market', dur: 50 },
      { place: 'castle', dur: 75 }, { place: 'pub', dur: 60 }, { place: 'hotel', dur: 0 }] },
    { date: '2030-06-02', start: '09:00', stops: [
      { place: 'hotel', dur: 15 }, { place: 'brewery', dur: 120, fixed: '10:00' }, { place: 'coach', dur: 5 }, { place: 'airport', dur: 0 }] }
  ]
});

test('day 1 starts at the airport and respects the 11:30 booking', () => {
  const rows = computeDay(trip(), 0);
  assert.equal(rows[0].place.id, 'airport');
  assert.equal(rows[0].arr, 10 * 60);
  const museum = rows.find(r => r.place.id === 'museum');
  assert.equal(museum.arr, 11 * 60 + 30);
  assert.equal(museum.late, 0);
  assert.equal(museum.warn, null, 'open on Saturday');
});

test('day 2 reaches the airport in time', () => {
  const rows = computeDay(trip(), 1);
  const last = rows[rows.length - 1];
  assert.equal(last.place.id, 'airport');
  assert.ok(last.arr <= 16 * 60, `arrives ${last.arr}`);
  assert.ok(rows.every(r => !r.late), 'no booking is missed');
});

test('fixed time: early arrival waits, late arrival is flagged', () => {
  const t = trip();
  t.days[0].stops[1].fixed = '10:30'; // impossible: airport + coach
  const r = computeDay(t, 0)[1];
  assert.ok(r.late > 0);
});

test('hoursCheck', () => {
  const p = { hours: { '0': ['12:00-17:30'] } };
  assert.equal(hoursCheck(p, 0, 13 * 60, 14 * 60), null);
  assert.match(hoursCheck(p, 0, 10 * 60, 11 * 60), /Opens 12:00/);
  assert.match(hoursCheck(p, 1, 13 * 60, 14 * 60), /Closed on Mondays/);
  assert.equal(hoursCheck({}, 1, 0, 0), null);
});

test('travel estimates', () => {
  const a = { lat: 50.3439, lng: 4.7435 }, b = { lat: 50.3425, lng: 4.7358 };
  assert.equal(autoTravel(a, b).mode, 'walk');
  const far = autoTravel({ lat: 50.4264, lng: 4.7501 }, a);
  assert.equal(far.mode, 'transit');
  assert.equal(travelFor(a, b, { mode: 'taxi', min: 7 }).min, 7);
});

test('bestIndex keeps the hotel last', () => {
  const t = trip();
  const i = bestIndex(t, 0, t.places.park);
  assert.ok(i > 0 && i < t.days[0].stops.length);
});

/** A small trip with hotel/arrival/departure and no explicit hotel stops. */
function hotelTrip() {
  return normalize({
    title: 'T', tz: 'Europe/Brussels',
    places: [
      { id: 'air', name: 'Airport', cat: 'transport', lat: 50.4264, lng: 4.7501 },
      { id: 'hot', name: 'Hotel', cat: 'hotel', lat: 50.3438, lng: 4.7454 },
      { id: 'a', name: 'A', cat: 'sight', lat: 50.3429, lng: 4.7326 },
      { id: 'b', name: 'B', cat: 'sight', lat: 50.3398, lng: 4.7409 }
    ],
    days: [
      { id: 'd1', date: '2030-06-01', start: '10:00', stops: [{ id: 's1', place: 'a', dur: 60 }] },
      { id: 'd2', date: '2030-06-02', start: '09:00', stops: [{ id: 's2', place: 'b', dur: 60 }] }
    ],
    arrive: { place: 'air', time: '10:00' },
    depart: { place: 'air', time: '16:00' },
    stays: [{ id: 'st', place: 'hot', from: '2030-06-01', to: '2030-06-02' }]
  });
}

test('day endpoints: arrive → stops → hotel, then hotel → stops → airport', () => {
  const t = hotelTrip();
  const d1 = computeDay(t, 0), d2 = computeDay(t, 1);
  assert.deepEqual(d1.map(r => r.place.id), ['air', 'a', 'hot']);
  assert.deepEqual(d2.map(r => r.place.id), ['hot', 'b', 'air']);
  assert.equal(d1[0].arr, 10 * 60);
  assert.equal(d1[0].st.virtual, 'start');
  assert.equal(d1[0].st.kind, 'arrive');
  assert.equal(d1[2].st.kind, 'hotel');
  assert.deepEqual(d1.map(r => r.n), [null, 1, null], 'only real stops are numbered');
  assert.equal(d2[2].st.kind, 'depart');
  assert.equal(d2[2].late, 0);
  assert.ok(d2[2].wait > 0, 'spare time before the airport deadline');
  assert.equal(computeDay(t, 0, { ends: false }).length, 1);
});

test('departure deadline flags lateness', () => {
  const t = hotelTrip();
  t.days[1].stops[0].dur = 400;
  const last = computeDay(t, 1).at(-1);
  assert.ok(last.late > 0);
});

test('explicit hotel/airport stops replace endpoints (older plans)', () => {
  const t = trip();
  t.arrive = { place: 'airport', time: '10:00' };
  t.depart = { place: 'airport', time: '16:00' };
  t.stays = [{ id: 's', place: 'hotel', from: '2030-06-01', to: '2030-06-02' }];
  const d1 = computeDay(t, 0), d2 = computeDay(t, 1);
  assert.ok(d1.every(r => !r.st.virtual), 'no duplicate airport/hotel rows on Saturday');
  assert.ok(d2.every(r => !r.st.virtual), 'no duplicate rows on Sunday');
  assert.equal(d2.at(-1).place.id, 'airport');
});

test('endpoint travel override is stored on day.back via findStop', () => {
  const t = hotelTrip();
  const end = computeDay(t, 0).at(-1);
  const f = findStop(t, end.st.id);
  assert.equal(f.virtual, 'end');
  f.st.mode = 'taxi'; f.st.min = 9;
  assert.equal(t.days[0].back.min, 9);
  const again = computeDay(t, 0).at(-1);
  assert.equal(again.tr.min, 9);
  assert.equal(again.tr.mode, 'taxi');
});

test('bestIndex uses the hotel as start and end of the day', () => {
  const t = hotelTrip();
  // A place right next to the hotel goes first on day 2 (morning, from the hotel)
  const nearHotel = { id: 'n', lat: 50.3439, lng: 4.7450 };
  assert.equal(bestIndex(t, 1, nearHotel), 0);
  assert.ok(scheduledIds(t).has('hot'));
});

test('parseCoords', () => {
  assert.deepEqual(parseCoords('https://www.google.com/maps/place/X/@50.3412,4.7403,17z'), { lat: 50.3412, lng: 4.7403 });
  assert.deepEqual(parseCoords('50.34, 4.74'), { lat: 50.34, lng: 4.74 });
  assert.equal(parseCoords('nothing'), null);
});

test('normalize is idempotent and converts places to a map', () => {
  const t = trip();
  assert.equal(typeof t.places, 'object');
  assert.ok(!Array.isArray(t.places));
  assert.deepEqual(normalize(t), t);
});
