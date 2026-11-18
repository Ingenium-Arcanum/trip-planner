import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, setTripDates } from '../js/store.js';

const P = { id: 'p', name: 'Museum', cat: 'museum', lat: 50.84, lng: 4.35 };
const H = { id: 'h', name: 'Hotel', cat: 'hotel', lat: 50.85, lng: 4.36 };
const trip = () => normalize({ title: 'T', places: [P, H],
  stays: [{ id: 's', place: 'h', from: '2030-06-01', to: '2030-06-04' }],
  days: [
    { id: 'd1', date: '2030-06-01', start: '10:00', stops: [{ id: '1', place: 'p', dur: 60 }] },
    { id: 'd2', date: '2030-06-02', start: '09:00', stops: [] },
    { id: 'd3', date: '2030-06-03', start: '09:30', stops: [{ id: '2', place: 'p', dur: 30 }] }
  ] });

test('moving the trip keeps every day and its stops, and moves the hotel nights along', () => {
  const t = trip();
  const r = setTripDates(t, '2030-07-10');
  assert.equal(r.ok, true);
  assert.equal(r.shift, 39);
  assert.deepEqual(t.days.map(d => d.date), ['2030-07-10', '2030-07-11', '2030-07-12']);
  assert.deepEqual(t.days.map(d => [d.id, d.start, d.stops.length]), [['d1', '10:00', 1], ['d2', '09:00', 0], ['d3', '09:30', 1]]);
  assert.deepEqual([t.stays[0].from, t.stays[0].to], ['2030-07-10', '2030-07-13']);
});

test('moving backwards across a month and year boundary', () => {
  const t = trip();
  setTripDates(t, '2029-12-31');
  assert.deepEqual(t.days.map(d => d.date), ['2029-12-31', '2030-01-01', '2030-01-02']);
});

test('a later last day adds empty days', () => {
  const t = trip();
  const r = setTripDates(t, '2030-06-01', '2030-06-05');
  assert.deepEqual([r.ok, r.added], [true, 2]);
  assert.deepEqual(t.days.map(d => d.date), ['2030-06-01', '2030-06-02', '2030-06-03', '2030-06-04', '2030-06-05']);
  assert.equal(new Set(t.days.map(d => d.id)).size, 5);
});

test('a shorter trip only drops empty days, and never touches the trip when it refuses', () => {
  const t = trip();
  const before = JSON.stringify(t);
  const r = setTripDates(t, '2030-08-01', '2030-08-02');   // day 3 has a stop
  assert.equal(r.ok, false);
  assert.match(r.error, /plans/);
  assert.equal(JSON.stringify(t), before);

  const two = setTripDates(t, '2030-08-01', '2030-08-03');  // same length: nothing dropped
  assert.equal(two.ok, true);
  assert.equal(t.days.length, 3);
});

test('shortening drops trailing empty days and trims the hotel stay', () => {
  const t = trip();
  t.days[2].stops = [];
  const r = setTripDates(t, '2030-06-01', '2030-06-01');
  assert.deepEqual([r.ok, r.removed], [true, 2]);
  assert.deepEqual(t.days.map(d => d.id), ['d1']);
  assert.deepEqual([t.stays[0].from, t.stays[0].to], ['2030-06-01', '2030-06-02']);
});

test('bad input is refused', () => {
  const t = trip();
  assert.equal(setTripDates(t, '').ok, false);
  assert.equal(setTripDates(t, '2030-06-05', '2030-06-01').ok, false);
  assert.equal(setTripDates(t, '2030-06-01', '2032-06-01').ok, false);
});
