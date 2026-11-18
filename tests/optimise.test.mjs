import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimiseDay, applyOrder, reorderStops, dayStats } from '../js/optimise.js';
import { computeDay } from '../js/schedule.js';
import { normalize } from '../js/store.js';

/** Five made-up places on a line, 1 km apart, west → east. */
const P = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, name: id.toUpperCase(), cat: 'sight', lat: 50.85, lng: 4.30 + i * 0.0142 }));
const mk = (stops, extra = {}) => normalize({ title: 'T', places: [...P, ...(extra.places || [])], days: [{ id: 'd1', date: '2030-06-01', start: '09:00', stops }], ...extra.trip });
const ids = (t, di = 0) => t.days[di].stops.map(s => s.place).join('');

test('a zig-zag day gets put in order and travel goes down', () => {
  const t = mk(['a', 'd', 'b', 'e', 'c'].map(p => ({ id: 's' + p, place: p, dur: 30 })));
  const r = optimiseDay(t, 0);
  assert.ok(r.changed);
  assert.ok(r.after.travel < r.before.travel, `${r.after.travel} < ${r.before.travel}`);
  applyOrder(t, 0, r.order);
  assert.equal(ids(t), 'abcde', 'same start as before, not the route backwards');
});

test('an already good order is left alone', () => {
  const t = mk(['a', 'b', 'c', 'd', 'e'].map(p => ({ id: 's' + p, place: p, dur: 30 })));
  assert.equal(optimiseDay(t, 0).changed, false);
});

test('bookings are never made late', () => {
  // 'e' is booked at 09:20 — it has to stay first even though it's at the far end.
  const t = mk([{ id: 'sa', place: 'a', dur: 30 }, { id: 'sb', place: 'b', dur: 30 }, { id: 'se', place: 'e', dur: 30, fixed: '09:20' }, { id: 'sc', place: 'c', dur: 30 }]);
  const r = optimiseDay(t, 0);
  const after = applyOrder(normalize(t), 0, r.order);
  assert.ok(computeDay(after, 0).every(x => !x.late), 'nothing late');
  assert.ok(r.after.late <= r.before.late);
});

test('a stop that would be closed gets moved to when it is open', () => {
  // 'e' closes at 10:00 but is planned last; there's time to do it first.
  const places = [{ ...P[4], id: 'x', name: 'Early closer', hours: { 6: ['08:00-10:00'] } }];
  const t = mk([{ id: 'sa', place: 'a', dur: 30 }, { id: 'sb', place: 'b', dur: 30 }, { id: 'sc', place: 'c', dur: 30 }, { id: 'sx', place: 'x', dur: 20 }], { places });
  assert.ok(computeDay(t, 0).some(r => r.warn), 'starts with an opening-hours problem');
  const r = optimiseDay(t, 0);
  assert.ok(r.changed);
  assert.ok(r.after.warns < r.before.warns, 'fixes it');
});

test('visited stops and a leading airport / trailing hotel stay where they are', () => {
  const places = [{ id: 'air', name: 'Airport', cat: 'transport', lat: 50.90, lng: 4.48 }, { id: 'hot', name: 'Hotel', cat: 'hotel', lat: 50.84, lng: 4.29 }];
  const t = mk([{ id: 's0', place: 'air', dur: 20 }, { id: 'sd', place: 'd', dur: 30, done: true }, { id: 'sa', place: 'a', dur: 30 },
    { id: 'se', place: 'e', dur: 30 }, { id: 'sb', place: 'b', dur: 30 }, { id: 's9', place: 'hot', dur: 0 }], { places });
  const r = optimiseDay(t, 0);
  applyOrder(t, 0, r.order);
  const order = t.days[0].stops.map(s => s.id);
  assert.equal(order[0], 's0', 'airport stays first');
  assert.equal(order[1], 'sd', 'visited stop stays');
  assert.equal(order[order.length - 1], 's9', 'hotel stays last');
});

test('with a hotel set, the day is ordered as a loop from and back to the hotel', () => {
  const places = [{ id: 'hot', name: 'Hotel', cat: 'hotel', lat: 50.85, lng: 4.30 }];
  const t = mk(['c', 'a', 'e', 'b', 'd'].map(p => ({ id: 's' + p, place: p, dur: 30 })), {
    places, trip: { stays: [{ id: 'st', place: 'hot', from: '2030-05-31', to: '2030-06-02' }] } });
  const r = optimiseDay(t, 0);
  assert.ok(r.changed && r.after.travel < r.before.travel);
});

test('manual travel times are dropped when the previous stop changes', () => {
  const stops = [{ id: '1', place: 'a', dur: 10 }, { id: '2', place: 'b', dur: 10, min: 7 }, { id: '3', place: 'c', dur: 10, min: 4 }];
  const out = reorderStops(stops, ['1', '3', '2']);
  assert.equal(out.find(s => s.id === '3').min, null, 'came after 2, now after 1');
  assert.equal(out.find(s => s.id === '2').min, null);
  const same = reorderStops(stops, ['1', '2', '3']);
  assert.equal(same[1].min, 7, 'unchanged hop keeps its time');
});

test('days with fewer than 3 stops are skipped; stats are sane', () => {
  assert.equal(optimiseDay(mk([{ id: '1', place: 'a', dur: 10 }, { id: '2', place: 'b', dur: 10 }]), 0), null);
  const s = dayStats(computeDay(mk([{ id: '1', place: 'a', dur: 10 }, { id: '2', place: 'b', dur: 10 }]), 0));
  assert.ok(s.travel > 0 && s.end > 9 * 60 && s.late === 0 && s.warns === 0);
});
