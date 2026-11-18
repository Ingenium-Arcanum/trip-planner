// "Best order" for a day: reorder its stops to cut travel time without missing bookings or
// arriving when a place is closed. Each candidate order is scored by recalculating the whole day
// (computeDay), so bookings, waits, opening hours, hotel/arrival/departure all count.
// Pure — no DOM (tests/optimise.test.mjs).

import { computeDay, dayEnds } from './schedule.js';
import { hav } from './geo.js';

const LATE = 50;   // cost per minute late for a booking/departure
const CLOSED = 90; // cost per stop that would be closed (or close) while you're there
const END = 0.2;   // small preference for finishing the day earlier

/** Summary numbers for a day's rows. */
export function dayStats(rows) {
  return {
    travel: rows.reduce((s, r) => s + (r.tr ? r.tr.min : 0), 0),
    late: rows.reduce((s, r) => s + (r.late || 0), 0),
    warns: rows.filter(r => r.warn).length,
    end: rows.length ? rows[rows.length - 1].end : 0
  };
}
const score = s => s.travel + LATE * s.late + CLOSED * s.warns + END * s.end;

/**
 * Stops in a new order. A manual travel time ("min") belongs to the hop from the previous stop,
 * so it is dropped when that previous stop changes.
 */
export function reorderStops(stops, ids) {
  const byId = new Map(stops.map(s => [s.id, s]));
  const prevOf = new Map(stops.map((s, i) => [s.id, stops[i - 1]?.id ?? null]));
  return ids.map((id, i) => {
    const s = byId.get(id), prev = ids[i - 1] ?? null;
    if (s.min != null && prevOf.get(id) !== prev) { const { min, ...rest } = s; return { ...rest, min: null }; }
    return s;
  });
}

/**
 * Find a better order for day `di`.
 * Locked in place: visited stops (done), and a hotel/transport stop at the very start or end of
 * the day when there's no hotel/arrival/departure set (older plans start at the airport, end at the hotel).
 * Returns null for days with fewer than 3 stops, else
 *  { order: [stopIds], changed, before: stats, after: stats }
 */
export function optimiseDay(trip, di) {
  const day = trip.days[di];
  if (!day || day.stops.length < 3) return null;
  const stops = day.stops, n = stops.length, E = dayEnds(trip, di);
  const place = s => trip.places[s.place];
  const endish = s => ['hotel', 'transport'].includes(place(s)?.cat);
  const locked = new Set();
  stops.forEach((s, i) => { if (s.done || !place(s) || place(s).lat == null) locked.add(i); });
  if (!E.from && endish(stops[0])) locked.add(0);
  if (!E.to && endish(stops[n - 1])) locked.add(n - 1);
  const freePos = stops.map((_, i) => i).filter(i => !locked.has(i));
  const before = dayStats(computeDay(trip, di));
  if (freePos.length < 2) return { order: stops.map(s => s.id), changed: false, before, after: before };

  // Evaluate an order of the free stops (placed into the free positions). A tiny cost per moved
  // stop makes ties go to the order closest to yours (e.g. not the same route backwards).
  const cache = new Map();
  const original = freePos.map(p => stops[p].id);
  const evalFree = free => {
    const key = free.join('|');
    if (cache.has(key)) return cache.get(key);
    const ids = stops.map(s => s.id);
    freePos.forEach((p, k) => { ids[p] = free[k]; });
    const t = { ...trip, days: trip.days.map((d, i) => i === di ? { ...d, stops: reorderStops(stops, ids) } : d) };
    const st = dayStats(computeDay(t, di));
    const moved = free.reduce((n, id, k) => n + (id !== original[k] ? 1 : 0), 0) + (free[0] !== original[0] ? 2 : 0);
    const res = { ids, st, cost: score(st) + 0.05 * moved };
    cache.set(key, res);
    return res;
  };

  // Improve an order by moving one stop elsewhere or reversing a stretch, until nothing helps.
  const improve = start => {
    let cur = start, best = evalFree(cur);
    for (let round = 0; round < 50; round++) {
      let found = null;
      for (let i = 0; i < cur.length && !found; i++) {
        for (let j = 0; j < cur.length && !found; j++) {
          if (i === j) continue;
          const moved = cur.slice(); const [x] = moved.splice(i, 1); moved.splice(j, 0, x);
          const a = evalFree(moved);
          if (a.cost < best.cost - 0.01) { found = moved; best = a; continue; }
          if (j > i + 1) {
            const rev = cur.slice(0, i).concat(cur.slice(i, j + 1).reverse(), cur.slice(j + 1));
            const b = evalFree(rev);
            if (b.cost < best.cost - 0.01) { found = rev; best = b; }
          }
        }
      }
      if (!found) break;
      cur = found;
    }
    return best;
  };

  // Two starting points: the current order, and "always go to the nearest next stop".
  const current = freePos.map(p => stops[p].id);
  const startPlace = E.from ? trip.places[E.from] : place(stops[freePos[0] > 0 ? 0 : freePos[0]]);
  const left = new Set(current), nearest = [];
  let here = startPlace;
  while (left.size) {
    let pick = null, d = Infinity;
    for (const id of left) { const p = place(stops.find(s => s.id === id)); const dd = hav(here, p); if (dd < d) { d = dd; pick = id; } }
    nearest.push(pick); left.delete(pick); here = place(stops.find(s => s.id === pick));
  }
  const results = [improve(current), improve(nearest)].sort((a, b) => a.cost - b.cost);
  const best = results[0], base = evalFree(current);

  // Only suggest a change that is clearly better and never makes bookings or opening hours worse.
  const ok = best.cost < base.cost - 1 && best.st.late <= before.late && best.st.warns <= before.warns;
  return ok
    ? { order: best.ids, changed: true, before, after: best.st }
    : { order: stops.map(s => s.id), changed: false, before, after: before };
}

/** Apply an order from optimiseDay to the trip (mutates it). */
export function applyOrder(trip, di, ids) {
  const day = trip.days[di];
  day.stops = reorderStops(day.stops, ids);
  return trip;
}
