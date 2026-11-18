import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoPlan, unplannedIdeas } from '../js/autoplan.js';
import { computeDay } from '../js/schedule.js';
import { normalize } from '../js/store.js';

/** Made-up city: a hotel in the middle, 3 sights in the west and 3 in the east (~4 km apart). */
const west = [0, 1, 2].map(i => ({ id: 'w' + i, name: 'West ' + i, cat: 'sight', lat: 50.850 + i * 0.002, lng: 4.300 + i * 0.002 }));
const east = [0, 1, 2].map(i => ({ id: 'e' + i, name: 'East ' + i, cat: 'sight', lat: 50.850 + i * 0.002, lng: 4.410 + i * 0.002 }));
const hotel = { id: 'h', name: 'Hotel', cat: 'hotel', lat: 50.850, lng: 4.355 };
const mk = (extra = {}) => normalize({
  title: 'T', center: [50.85, 4.355],
  places: [hotel, ...west, ...east, ...(extra.places || [])],
  days: extra.days || [
    { id: 'd1', date: '2030-06-01', start: '09:30', stops: [] },   // Saturday
    { id: 'd2', date: '2030-06-02', start: '09:30', stops: [] }    // Sunday
  ],
  stays: [{ id: 's', place: 'h', from: '2030-05-31', to: '2030-06-03' }],
  ...extra.trip
});
const placesOn = (t, di) => t.days[di].stops.map(s => s.place).sort().join(',');

test('ideas exclude hotels and planned places', () => {
  const t = mk();
  assert.deepEqual(unplannedIdeas(t).map(p => p.id).sort(), ['e0', 'e1', 'e2', 'w0', 'w1', 'w2']);
});

test('nearby places end up on the same day', () => {
  const r = autoPlan(mk());
  assert.equal(r.added.length, 6);
  assert.equal(r.skipped.length, 0);
  const days = [placesOn(r.trip, 0), placesOn(r.trip, 1)].sort();
  assert.deepEqual(days, ['e0,e1,e2', 'w0,w1,w2']);
});

test('the original trip is not changed; the copy has no late or closed stops', () => {
  const t = mk();
  const r = autoPlan(t);
  assert.equal(t.days[0].stops.length + t.days[1].stops.length, 0);
  for (const di of [0, 1]) assert.ok(computeDay(r.trip, di).every(x => !x.late && !x.warn));
});

test('a place that is only open on Sunday goes to Sunday', () => {
  const places = [{ id: 'sun', name: 'Sunday market', cat: 'shop', lat: 50.851, lng: 4.301, hours: { 0: ['08:00-14:00'] } }];
  const r = autoPlan(mk({ places }));
  assert.equal(r.added.find(a => a.place === 'sun').di, 1);
});

test('closed on every day → skipped as "closed"; too much for the pace → skipped as "full"', () => {
  const places = [{ id: 'mon', name: 'Monday only', cat: 'museum', lat: 50.851, lng: 4.301, hours: { 1: ['10:00-17:00'] } }];
  const r = autoPlan(mk({ places }));
  assert.deepEqual(r.skipped, [{ place: 'mon', reason: 'closed' }]);
  // 8 long visits can't all fit in two relaxed days
  const many = Array.from({ length: 8 }, (_, i) => ({ id: 'm' + i, name: 'M' + i, cat: 'museum', lat: 50.852, lng: 4.36 + i * 0.001 }));
  const relaxed = autoPlan(mk({ places: many }), { pace: 'relaxed' });
  const packed = autoPlan(mk({ places: many }), { pace: 'packed' });
  assert.ok(relaxed.skipped.some(s => s.reason === 'full'));
  assert.ok(packed.added.length > relaxed.added.length, `${packed.added.length} > ${relaxed.added.length}`);
  for (const di of [0, 1]) assert.ok(computeDay(relaxed.trip, di).at(-1).end <= 17 * 60, 'relaxed days end by 17:00');
});

test('existing stops keep their order and bookings stay on time', () => {
  const days = [
    { id: 'd1', date: '2030-06-01', start: '09:30', stops: [{ id: 'x1', place: 'e2', dur: 30 }, { id: 'x2', place: 'w0', dur: 60, fixed: '14:00' }] },
    { id: 'd2', date: '2030-06-02', start: '09:30', stops: [] }
  ];
  const r = autoPlan(mk({ days }));
  const d1 = r.trip.days[0].stops.map(s => s.id);
  assert.ok(d1.indexOf('x1') < d1.indexOf('x2'), 'your order is kept');
  assert.ok(computeDay(r.trip, 0).every(x => !x.late), 'booking still on time');
  assert.ok(!r.added.some(a => a.place === 'e2' || a.place === 'w0'), 'planned places aren’t added twice');
});

test('minDay: days before it are left alone', () => {
  const r = autoPlan(mk(), { minDay: 1 });
  assert.equal(r.trip.days[0].stops.length, 0);
  assert.ok(r.added.every(a => a.di === 1));
});

test('departure deadline on the last day is respected', () => {
  const places = [{ id: 'air', name: 'Airport', cat: 'transport', lat: 50.90, lng: 4.48 }];
  const r = autoPlan(mk({ places, trip: { depart: { place: 'air', time: '12:00' } } }));
  assert.ok(computeDay(r.trip, 1).every(x => !x.late), 'makes the flight');
});

test('two areas over two days: one area per day, the Sunday-only place pulls its area to Sunday', () => {
  const W = [0, 1, 2, 3].map(i => ({ id: 'W' + i, name: 'W' + i, cat: 'sight', lat: 50.850 + i * 0.002, lng: 4.300 + i * 0.003 }));
  const E = [0, 1, 2, 3].map(i => ({ id: 'E' + i, name: 'E' + i, cat: 'sight', lat: 50.851 + i * 0.002, lng: 4.405 + i * 0.003 }));
  W[3].hours = { 0: ['08:00-14:00'] }; // Sundays only
  const t = normalize({ title: 'T', center: [50.85, 4.355], places: [hotel, ...W, ...E],
    days: [{ id: 'd1', date: '2030-06-01', start: '09:30', stops: [] }, { id: 'd2', date: '2030-06-02', start: '09:30', stops: [] }],
    stays: [{ id: 's', place: 'h', from: '2030-05-31', to: '2030-06-03' }] });
  const r = autoPlan(t);
  assert.equal(r.added.length, 8);
  const on = di => r.trip.days[di].stops.map(s => s.place[0]).join('');
  assert.match(on(0), /^E{4}$/, 'Saturday: the east');
  assert.match(on(1), /^W{4}$/, 'Sunday: the west, with the market');
});
