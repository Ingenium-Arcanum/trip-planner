import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openState, nextIndex, nearbyCandidates, roughly, distLabel } from '../js/nearby.js';
import { normalize } from '../js/store.js';

const here = { lat: 50.8460, lng: 4.3520 };
const trip = () => normalize({
  title: 'T',
  places: [
    { id: 'near', name: 'Near idea', cat: 'museum', lat: 50.8466, lng: 4.3530, hours: { 6: ['10:00-17:00'] } },
    { id: 'shut', name: 'Shut idea', cat: 'sight', lat: 50.8462, lng: 4.3522, hours: { 6: ['18:00-22:00'] } },
    { id: 'far', name: 'Far idea', cat: 'sight', lat: 50.8800, lng: 4.4000 },
    { id: 'hot', name: 'Hotel', cat: 'hotel', lat: 50.8461, lng: 4.3521 },
    { id: 'a', name: 'Stop A', cat: 'sight', lat: 50.8450, lng: 4.3500 },
    { id: 'b', name: 'Stop B', cat: 'sight', lat: 50.8480, lng: 4.3560 }
  ],
  days: [{ id: 'd1', date: '2030-06-01', start: '10:00', stops: [{ id: 'sa', place: 'a', dur: 60 }, { id: 'sb', place: 'b', dur: 60 }] }]
});

test('openState: open with closing time, closed with next opening, unknown', () => {
  const p = { hours: { 6: ['10:00-12:00', '14:00-18:00'] } };
  assert.deepEqual(openState(p, '2030-06-01', 11 * 60), { state: 'open', until: 12 * 60 });
  assert.deepEqual(openState(p, '2030-06-01', 13 * 60), { state: 'closed', opens: 14 * 60 });
  assert.deepEqual(openState(p, '2030-06-01', 19 * 60), { state: 'closed' });
  assert.deepEqual(openState(p, '2030-06-02', 11 * 60), { state: 'closed' }, 'Sunday: no hours = closed');
  assert.deepEqual(openState({}, '2030-06-01', 11 * 60), { state: 'unknown' });
});

test('nextIndex: after the stop you are at, before the one you are heading to, end when done', () => {
  const t = trip();
  assert.equal(nextIndex(t, 0, 10 * 60 + 30), 1, 'at Stop A (10:00–11:00) → after it');
  assert.equal(nextIndex(t, 0, 11 * 60 + 1), 1, 'walking to Stop B → before it');
  assert.equal(nextIndex(t, 0, 20 * 60), 2, 'day done → at the end');
});

test('candidates: within the radius, open-now first, skips hotels and today’s stops', () => {
  const t = trip();
  const sights = [
    { wd: 'Q1', name: 'Famous fountain', cat: 'sight', lat: 50.8458, lng: 4.3516 },
    { wd: 'Q2', name: 'Near idea', cat: 'museum', lat: 50.8466, lng: 4.3530 } // same as your saved place
  ];
  const c = nearbyCandidates(t, here, { km: 1, date: '2030-06-01', min: 11 * 60, sights });
  const names = c.map(x => x.name);
  assert.ok(!names.includes('Far idea'), 'outside 1 km');
  assert.ok(!names.includes('Hotel'));
  assert.ok(!names.includes('Stop A') && !names.includes('Stop B'), 'already in today’s plan');
  assert.equal(names.filter(n => n === 'Near idea').length, 1, 'no duplicate of a saved place');
  assert.equal(names[names.length - 1], 'Shut idea', 'closed places go last');
  assert.equal(c[0].name, 'Near idea', 'saved + open first');
  const near = c.find(x => x.name === 'Near idea');
  assert.equal(near.open.state, 'open');
  assert.ok(near.walk >= 2 && near.walk < 5, 'a few minutes on foot');
  assert.ok(c.find(x => x.name === 'Famous fountain'));
});

test('roughly rounds to ~100 m; distLabel', () => {
  assert.deepEqual(roughly({ lat: 50.846234, lng: 4.352987 }), { lat: 50.846, lng: 4.353 });
  assert.equal(distLabel(0.654), '650 m');
  assert.equal(distLabel(1.43), '1.4 km');
});
