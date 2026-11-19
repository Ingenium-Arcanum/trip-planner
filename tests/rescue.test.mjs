import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestFixes, applyOps, firstProblem } from '../js/rescue.js';
import { computeDay } from '../js/schedule.js';
import { normalize } from '../js/store.js';
import { clone } from '../js/util.js';

/**
 * A made-up day: start 10:00 at the museum (90 min), café (45), park (30), then a booked
 * tour at 13:05 — about 15 min too late. Day 2 is empty.
 */
const trip = () => normalize({
  title: 'Late test', tz: 'Europe/Brussels',
  places: [
    { id: 'museum', name: 'Museum', cat: 'museum', lat: 50.8460, lng: 4.3520 },
    { id: 'cafe', name: 'Café', cat: 'cafe', lat: 50.8470, lng: 4.3540 },
    { id: 'park', name: 'Park', cat: 'park', lat: 50.8440, lng: 4.3600 },
    { id: 'tour', name: 'Boat tour', cat: 'activity', lat: 50.8500, lng: 4.3800 },
    { id: 'far', name: 'Far away', cat: 'sight', lat: 50.9000, lng: 4.4500 }
  ],
  days: [
    { id: 'd1', date: '2030-06-01', start: '10:00', stops: [
      { id: 'a', place: 'museum', dur: 90 }, { id: 'b', place: 'cafe', dur: 45 }, { id: 'c', place: 'park', dur: 30 },
      { id: 't', place: 'tour', dur: 60, fixed: '13:05' }] },
    { id: 'd2', date: '2030-06-02', start: '10:00', stops: [] }
  ]
});
const lateOf = (t, id) => computeDay(t, 0).find(r => r.st.id === id).late;

test('detects the problem and offers fixes that actually work', () => {
  const t = trip();
  assert.ok(lateOf(t, 't') > 0, 'the sample is late');
  const res = suggestFixes(t, 0);
  assert.equal(res.target.name, 'Boat tour');
  assert.equal(res.target.kind, 'booking');
  assert.ok(res.options.length >= 2 && res.options.length <= 3);
  for (const o of res.options) {
    const after = applyOps(clone(t), o.ops);
    assert.equal(lateOf(after, 't'), o.after.late, o.label);
    if (o.full) assert.equal(lateOf(after, 't'), 0, o.label + ' fixes it');
  }
  assert.ok(res.options[0].full, 'best option fully fixes it');
  assert.equal(new Set(res.options.map(o => o.kind)).size, res.options.length, 'different kinds of fixes');
});

test('a small delay gets a small cut first, not skipping or moving', () => {
  const res = suggestFixes(trip(), 0);
  assert.ok(['shorten', 'spread', 'taxi'].includes(res.options[0].kind), res.options[0].label);
});

test('nothing late → null', () => {
  const t = trip();
  t.days[0].stops[3].fixed = '15:00';
  assert.equal(suggestFixes(t, 0), null);
  assert.equal(firstProblem(t, 0), null);
});

test('must-do stops are never shortened, skipped or moved', () => {
  const t = trip();
  t.days[0].stops.forEach(s => { if (s.id !== 't') s.must = true; });
  const res = suggestFixes(t, 0);
  for (const o of res?.options || []) assert.ok(o.ops.every(op => op.op === 'mode'), o.label);
});

test('live mode: stops before `from` stay as they are; time already spent is kept', () => {
  const t = trip();
  const res = suggestFixes(t, 0, { from: 1, keep: { b: 40 } });
  for (const o of res.options) {
    assert.ok(o.ops.every(op => op.stop !== 'a'), 'museum is in the past: ' + o.label);
    for (const op of o.ops) if (op.op === 'dur' && op.stop === 'b') assert.ok(op.dur >= 40, 'keeps time already spent');
  }
});

test('departure deadline counts as a problem too', () => {
  const t = trip();
  t.days[0].stops[3].fixed = null;
  t.depart = { place: 'far', time: '13:00' };
  t.days = [t.days[0]];
  const res = suggestFixes(t, 0);
  assert.equal(res.target.kind, 'depart');
  assert.ok(res.options.some(o => o.full));
  assert.ok(res.options.every(o => o.kind !== 'later'), 'nothing goes "after" your departure');
});

test('moving to another day is not offered if it makes that day late', () => {
  const t = trip();
  // Day 2 is on time but tight: a short stop, then a booking 15 min later at the same place.
  t.days[1].stops = [{ id: 'x', place: 'tour', dur: 10 }, { id: 'y', place: 'tour', dur: 30, fixed: '10:15' }];
  assert.ok(computeDay(t, 1).every(r => !r.late), 'day 2 starts out on time');
  const res = suggestFixes(t, 0, { max: 10 });
  for (const o of res.options.filter(o => o.kind === 'day')) {
    const after = applyOps(clone(t), o.ops);
    assert.ok(computeDay(after, 1).every(r => !r.late), o.label);
  }
});

test('applyOps: shorten, taxi, remove, move after, move to another day', () => {
  const t = trip();
  applyOps(t, [{ op: 'dur', stop: 'a', dur: 60 }, { op: 'mode', stop: 'c', mode: 'taxi' }]);
  assert.equal(t.days[0].stops[0].dur, 60);
  assert.equal(t.days[0].stops[2].mode, 'taxi');
  applyOps(t, [{ op: 'move', stop: 'b', toDi: 0, after: 't' }]);
  assert.deepEqual(t.days[0].stops.map(s => s.id), ['a', 'c', 't', 'b']);
  applyOps(t, [{ op: 'move', stop: 'c', toDi: 1 }, { op: 'remove', stop: 'b' }]);
  assert.deepEqual(t.days[0].stops.map(s => s.id), ['a', 't']);
  assert.deepEqual(t.days[1].stops.map(s => s.id), ['c']);
  assert.ok(t.places.cafe, 'skipped place stays in the trip');
});

test('estimated walks: cuts leave a little room; with known travel times they cut exactly', () => {
  const est = suggestFixes(trip(), 0).options.find(o => o.kind === 'spread' || o.kind === 'shorten');
  const after = computeDay(applyOps(clone(trip()), est.ops), 0).find(r => r.st.id === 't');
  assert.ok(after.wait >= 5, `room to spare when walks are estimates (wait ${after.wait})`);
  assert.equal(est.tight, false);

  const known = trip();
  computeDay(known, 0).forEach(r => { if (r.tr) { r.st.min = r.tr.min; r.st.mode = r.tr.mode; } }); // as if typed in
  const exact = suggestFixes(known, 0).options.find(o => o.kind === est.kind);
  assert.match(exact.label, /15 min/, exact.label);
});
