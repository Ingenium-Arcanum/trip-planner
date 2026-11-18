// "Plan it for me": spread the places you saved (your ideas) over your days.
// Places that are only open on some days go first, then the ones farthest from the centre, so
// different areas tend to land on different days. Each place goes to the day + position that
// adds the least travel, checked by recalculating the day: no missed bookings, no visiting while
// closed, and the day must end by the chosen pace. What doesn't fit stays in Ideas.
// Existing stops keep their order; days that were empty get the best order afterwards.
// Pure — no DOM (tests/autoplan.test.mjs).

import { clone, toMin, uid, dateParts } from './util.js';
import { computeDay, dayEnds, scheduledIds, defaultDur } from './schedule.js';
import { hoursFor } from './discover.js';
import { hav, centroid } from './geo.js';
import { dayStats, optimiseDay, applyOrder } from './optimise.js';

export const PACES = {
  relaxed: { end: '17:00', label: 'Relaxed', hint: 'done by 17:00' },
  normal: { end: '19:00', label: 'Normal', hint: 'done by 19:00' },
  packed: { end: '21:00', label: 'Packed', hint: 'done by 21:00' }
};
const SKIP_CATS = new Set(['hotel', 'transport']);
const BALANCE = 0.15; // per minute already planned that day: spreads places over the days

/** Your saved places that aren't in the plan yet (and could be). */
export function unplannedIdeas(trip) {
  const used = scheduledIds(trip);
  return Object.values(trip.places).filter(p => !used.has(p.id) && p.lat != null && !SKIP_CATS.has(p.cat));
}

/**
 * Make a plan on a copy of the trip.
 *  opts.pace     'relaxed' | 'normal' | 'packed'
 *  opts.minDay   don't touch days before this index (during the trip: today)
 *  opts.placeIds which places to plan (default: all unplanned ideas)
 * Returns { trip (the planned copy), added:[{place, di}], skipped:[{place, reason:'closed'|'full'}],
 *           days:[{ di, added:[placeId], before, after }] }
 */
export function autoPlan(trip, { pace = 'normal', minDay = 0, placeIds } = {}) {
  const t = clone(trip);
  const endBy = toMin((PACES[pace] || PACES.normal).end);
  const ids = placeIds || unplannedIdeas(t).map(p => p.id);
  const dayIdx = t.days.map((_, i) => i).filter(i => i >= minDay);
  const added = [], skipped = [];
  if (!ids.length || !dayIdx.length) return { trip: t, added, skipped: ids.map(place => ({ place, reason: 'full' })), days: [] };

  const wasEmpty = new Set(dayIdx.filter(i => !t.days[i].stops.length));
  const before = Object.fromEntries(dayIdx.map(i => [i, dayStats(computeDay(t, i))]));

  // Hard ones first: places open on few of your days, then the farthest from the centre.
  const c = t.center ? { lat: t.center[0], lng: t.center[1] } : centroid(ids.map(id => t.places[id]));
  const openOn = p => dayIdx.filter(i => {
    const h = hoursFor(p, t.days[i].date);
    return !h || (h[String(dateParts(t.days[i].date).wd)] || []).length > 0;
  }).length;
  const order = ids.map(id => t.places[id]).filter(Boolean)
    .map(p => ({ p, open: openOn(p), far: c ? hav(c, p) : 0 }))
    .sort((a, b) => a.open - b.open || b.far - a.far);

  // Group places by area (one group per day), then give each group the day that suits it best.
  const target = assignGroups(t, order.map(o => o.p), dayIdx);

  for (const { p } of order) {
    let best = null, closedEverywhere = true;
    // Try the group's own day first; only if it doesn't fit there, look at every day.
    const tryDays = target.has(p.id) ? [target.get(p.id)] : dayIdx;
    for (const di of [...tryDays, ...dayIdx.filter(d => !tryDays.includes(d))]) {
      if (best && !tryDays.includes(di) && best.home) break;
      const day = t.days[di], stops = day.stops, E = dayEnds(t, di);
      const cur = dayStats(computeDay(t, di));
      const endish = s => SKIP_CATS.has(t.places[s?.place]?.cat);
      const lo = !E.from && endish(stops[0]) ? 1 : 0;
      const hi = !E.to && stops.length > 1 && endish(stops[stops.length - 1]) ? stops.length - 1 : stops.length;
      const load = stops.reduce((s, x) => s + (Number(x.dur) || 0), 0);
      const st = { id: 'p' + uid(), place: p.id, dur: defaultDur(p), mode: 'auto' };
      for (let idx = lo; idx <= hi; idx++) {
        stops.splice(idx, 0, st);
        const s = dayStats(computeDay(t, di));
        stops.splice(idx, 1);
        if (s.warns > cur.warns) continue;           // closed (or closing) while you'd be there
        closedEverywhere = false;
        if (s.late > cur.late || s.end > endBy) continue; // misses a booking, or day runs too long
        const cost = (s.travel - cur.travel) + BALANCE * load;
        if (!best || cost < best.cost) best = { di, idx, st, cost, home: tryDays.includes(di) };
      }
    }
    if (best) {
      t.days[best.di].stops.splice(best.idx, 0, best.st);
      added.push({ place: p.id, di: best.di });
    } else skipped.push({ place: p.id, reason: closedEverywhere ? 'closed' : 'full' });
  }

  // Days that were empty: put the new stops in the best order.
  for (const di of wasEmpty) {
    if (!added.some(a => a.di === di)) continue;
    const r = optimiseDay(t, di);
    if (r?.changed) applyOrder(t, di, r.order);
  }

  const days = dayIdx.filter(di => added.some(a => a.di === di)).sort((a, b) => a - b).map(di => ({
    di, before: before[di], after: dayStats(computeDay(t, di)),
    // in visiting order
    added: t.days[di].stops.map(s => s.place).filter(pid => added.some(a => a.di === di && a.place === pid))
  }));
  return { trip: t, added, skipped, days };
}

/* ---------- grouping by area ---------- */
const xy = p => [p.lng * Math.cos(p.lat * Math.PI / 180), p.lat];
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Split places into (at most) k groups of nearby places. Deterministic (farthest-point start). */
export function groupByArea(places, k) {
  if (!places.length || k <= 0) return [];
  const P = places.map(xy);
  const mean = [P.reduce((s, q) => s + q[0], 0) / P.length, P.reduce((s, q) => s + q[1], 0) / P.length];
  const far = (score) => P.reduce((bi, q, i) => (score(q) > score(P[bi]) ? i : bi), 0);
  const C = [P[far(q => d2(q, mean))]];
  while (C.length < Math.min(k, P.length)) C.push(P[far(q => Math.min(...C.map(c => d2(q, c))))]);
  let assign = [];
  for (let it = 0; it < 25; it++) {
    const next = P.map(q => C.reduce((bj, c, j) => (d2(q, c) < d2(q, C[bj]) ? j : bj), 0));
    if (next.join() === assign.join()) break;
    assign = next;
    C.forEach((c, j) => {
      const m = P.filter((_, i) => assign[i] === j);
      if (m.length) C[j] = [m.reduce((s, q) => s + q[0], 0) / m.length, m.reduce((s, q) => s + q[1], 0) / m.length];
    });
  }
  return C.map((_, j) => places.filter((_, i) => assign[i] === j)).filter(g => g.length);
}

/**
 * Map placeId -> day index: group the places by area (one group per day) and give each group the
 * day that suits it — a day it's open (a Sunday-only market pulls its group to Sunday), and for
 * days that already have stops, the group closest to them.
 */
function assignGroups(t, places, dayIdx) {
  const out = new Map();
  if (!places.length) return out;
  const groups = groupByArea(places, dayIdx.length);
  const isOpen = (p, di) => {
    const h = hoursFor(p, t.days[di].date);
    return !h || (h[String(dateParts(t.days[di].date).wd)] || []).length > 0;
  };
  const anchor = di => {
    const pts = t.days[di].stops.map(s => t.places[s.place]).filter(p => p?.lat != null && !SKIP_CATS.has(p.cat));
    return pts.length ? centroid(pts) : null;
  };
  const anchors = new Map(dayIdx.map(di => [di, anchor(di)]));
  const cost = (g, di) => {
    const c = centroid(g), a = anchors.get(di);
    return 1000 * g.filter(p => !isOpen(p, di)).length + (a ? hav(c, a) : 0) + g.length * 0.01 * dayIdx.indexOf(di);
  };
  // Best one-to-one match of groups to days: exact for small trips, greedy for long ones.
  let best = null;
  if (dayIdx.length <= 7) {
    const walk = (gi, used, total, pick) => {
      if (best && total >= best.total) return;
      if (gi === groups.length) { best = { total, pick: pick.slice() }; return; }
      for (const di of dayIdx) {
        if (used.has(di)) continue;
        used.add(di); pick.push(di);
        walk(gi + 1, used, total + cost(groups[gi], di), pick);
        used.delete(di); pick.pop();
      }
    };
    walk(0, new Set(), 0, []);
  } else {
    const pairs = [];
    groups.forEach((g, gi) => dayIdx.forEach(di => pairs.push({ gi, di, c: cost(g, di) })));
    pairs.sort((a, b) => a.c - b.c);
    const pick = [], usedG = new Set(), usedD = new Set();
    for (const x of pairs) if (!usedG.has(x.gi) && !usedD.has(x.di)) { pick[x.gi] = x.di; usedG.add(x.gi); usedD.add(x.di); }
    best = { pick };
  }
  groups.forEach((g, gi) => g.forEach(p => out.set(p.id, best.pick[gi])));
  return out;
}
