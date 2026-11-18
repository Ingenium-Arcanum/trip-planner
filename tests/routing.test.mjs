import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeRequests, storeLegs, pruneRoutes } from '../js/routing.js';
import { travelFor, autoTravel, computeDay } from '../js/schedule.js';
import { routeKey } from '../js/geo.js';
import { normalize } from '../js/store.js';

const A = { id: 'a', name: 'A', cat: 'sight', lat: 50.8460, lng: 4.3520 };
const B = { id: 'b', name: 'B', cat: 'sight', lat: 50.8480, lng: 4.3600 };   // ~600 m
const C = { id: 'c', name: 'C', cat: 'sight', lat: 50.8600, lng: 4.3700 };   // ~1.6 km from B
const FAR = { id: 'f', name: 'Far', cat: 'sight', lat: 50.9000, lng: 4.4800 }; // > 3 km
const trip = () => normalize({ title: 'T', places: [A, B, C, FAR],
  days: [
    { id: 'd1', date: '2030-06-01', start: '10:00', stops: [{ id: '1', place: 'a', dur: 30 }, { id: '2', place: 'b', dur: 30 }, { id: '3', place: 'c', dur: 30 }] },
    { id: 'd2', date: '2030-06-02', start: '10:00', stops: [{ id: '4', place: 'a', dur: 30 }, { id: '5', place: 'f', dur: 30 }] }
  ] });

test('a stored walking route replaces the straight-line estimate', () => {
  const routes = { [routeKey(A, B)]: { m: 11.4, km: 0.82 } };
  const tr = travelFor(A, B, { mode: 'auto' }, routes);
  assert.deepEqual([tr.mode, tr.min, tr.d, tr.routed, tr.manual], ['walk', 11, 0.82, true, false]);
  const est = travelFor(A, B, { mode: 'auto' });
  assert.ok(!est.routed && est.mode === 'walk');
});

test('auto picks transit when the real walk is too long, even if it looks close', () => {
  const routes = { [routeKey(A, B)]: { m: 48, km: 3.6 } }; // e.g. a river with no bridge nearby
  assert.equal(autoTravel(A, B, routes).mode, 'transit');
});

test('chosen walking uses the route; typed minutes still win', () => {
  const routes = { [routeKey(A, B)]: { m: 9, km: 0.7 } };
  assert.equal(travelFor(A, B, { mode: 'walk' }, routes).min, 9);
  assert.equal(travelFor(A, B, { mode: 'walk', min: 15 }, routes).min, 15);
  assert.equal(travelFor(A, B, { mode: 'auto', min: 4 }, routes).min, 4);
  assert.equal(travelFor(A, B, { mode: 'taxi' }, routes).mode, 'taxi', 'taxi stays an estimate');
});

test('routeRequests: one request per day that has walkable hops without a route', () => {
  const t = trip();
  const reqs = routeRequests(t);
  assert.deepEqual(reqs.map(r => r.di), [0], 'day 2 only has a hop that is too far to walk');
  assert.equal(reqs[0].points.length, 3);
  storeLegs(t, reqs[0].points, [{ min: 8.04, km: 0.61 }, { min: 21.5, km: 1.71 }]);
  assert.deepEqual(routeRequests(t), [], 'nothing left to ask');
  const rows = computeDay(t, 0);
  assert.equal(rows[1].tr.min, 8);
  assert.equal(rows[2].tr.min, 22);
  assert.ok(rows[1].tr.routed && rows[2].tr.routed);
});

test('pruneRoutes drops routes for hops that are gone', () => {
  const t = trip();
  storeLegs(t, routeRequests(t)[0].points, [{ min: 8, km: 0.6 }, { min: 21, km: 1.7 }]);
  t.days[0].stops.splice(1, 1); // remove B: A→B and B→C are gone, A→C is new
  pruneRoutes(t);
  assert.deepEqual(Object.keys(t.routes), []);
  assert.deepEqual(routeRequests(t).map(r => r.di), [0], 'A→C needs a route now');
});
