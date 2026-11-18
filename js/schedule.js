// Scheduling engine — pure functions over a trip object (no DOM, testable in Node).
//
// A day is: start time + ordered stops. Each stop has a duration and optional
// fixed start ("booking"). Arrival = previous end + travel, but never before a
// fixed time (you wait) — arriving after it is flagged as "late".

import { toMin, fmt, dateParts, WD } from './util.js';
import { hav, routeKey } from './geo.js';
import { MODES, WALK_MAX_KM, WALK_MAX_MIN, CATS } from './config.js';
import { hoursFor } from './discover.js';

export function estimate(mode, km) {
  const m = MODES[mode] || MODES.transit;
  if (km < 0.05) return 0;
  return Math.max(2, Math.round(m.overhead + km * m.detour / m.kmh * 60));
}

/**
 * Auto mode choice: walk short hops, transit for longer ones.
 * With a real walking route (trip.routes, see js/routing.js) the walk uses its time and distance,
 * and a hop counts as walkable when that route takes at most WALK_MAX_MIN.
 */
export function autoTravel(a, b, routes) {
  const d = hav(a, b);
  const r = routes?.[routeKey(a, b)];
  if (d < 0.05 && !r) return { mode: 'walk', min: 0, d };
  if (r) {
    return r.m <= WALK_MAX_MIN
      ? { mode: 'walk', min: Math.max(1, Math.round(r.m)), d: r.km, routed: true }
      : { mode: 'transit', min: estimate('transit', d), d };
  }
  const mode = d <= WALK_MAX_KM ? 'walk' : 'transit';
  return { mode, min: estimate(mode, d), d };
}

/** Travel into `stop` from `prevPlace`, honouring manual mode/minutes overrides. */
export function travelFor(prevPlace, place, stop, routes) {
  const a = autoTravel(prevPlace, place, routes);
  if (stop.mode && stop.mode !== 'auto') {
    const r = stop.mode === 'walk' && stop.min == null ? routes?.[routeKey(prevPlace, place)] : null;
    if (r) return { mode: 'walk', min: Math.max(1, Math.round(r.m)), d: r.km, manual: true, routed: true };
    return { mode: stop.mode, min: stop.min != null ? stop.min : estimate(stop.mode, a.d), d: a.d, manual: true };
  }
  return { ...a, min: stop.min != null ? stop.min : a.min, manual: stop.min != null, routed: stop.min == null && !!a.routed };
}

/**
 * Opening-hours check. place.hours = { "0": ["12:00-17:30"], ... } keyed by JS weekday (0 = Sunday).
 * Missing `hours` = unknown (no warning). Missing weekday key = closed that day.
 */
export function hoursCheck(place, wd, arr, end) {
  if (!place.hours) return null;
  const slots = place.hours[String(wd)];
  if (!slots || !slots.length) return `Closed on ${WD[wd]}s (check)`;
  const ranges = slots.map(s => s.split('-').map(toMin));
  const open = ranges.find(([o, c]) => arr >= o && arr < c);
  if (open) return end > open[1] + 30 ? `Closes ${fmt(open[1])} — before you leave` : null;
  const later = ranges.find(([o]) => o > arr);
  if (later) return `Opens ${fmt(later[0])}`;
  return `Closed by ${fmt(arr)} (${slots.join(', ')})`;
}

/* ---------- hotels, arrival and departure ----------
 * trip.stays   = [{ id, place, from:'YYYY-MM-DD' (check-in), to:'YYYY-MM-DD' (check-out) }]
 * trip.arrive  = { place, time }   where/when day 1 begins (time is mirrored in days[0].start)
 * trip.depart  = { place, time }   where the last day ends; time = "be there by"
 * They add virtual first/last rows to each day's timeline ("endpoints").
 */

/** The stay you sleep in on the night of `date` ('night') or woke up in that morning ('morning'). */
export function stayFor(trip, date, when) {
  return (trip.stays || []).find(s => s.place && (when === 'night' ? s.from <= date && date < s.to : s.from < date && date <= s.to)) || null;
}

/** Where day `di` starts and ends: { from, to, fromKind, toKind, toBy } (place ids or null). */
export function dayEnds(trip, di) {
  const day = trip.days[di];
  if (!day) return { from: null, to: null };
  const out = { from: null, to: null, fromKind: null, toKind: null, toBy: null };
  const m = stayFor(trip, day.date, 'morning'), n = stayFor(trip, day.date, 'night');
  if (m) { out.from = m.place; out.fromKind = 'hotel'; }
  if (n) { out.to = n.place; out.toKind = 'hotel'; }
  if (di === 0 && trip.arrive?.place) { out.from = trip.arrive.place; out.fromKind = 'arrive'; }
  if (di === trip.days.length - 1 && trip.depart?.place) { out.to = trip.depart.place; out.toKind = 'depart'; out.toBy = trip.depart.time || null; }
  if (out.from && !trip.places[out.from]) out.from = null;
  if (out.to && !trip.places[out.to]) out.to = null;
  return out;
}

export const startId = day => '@s:' + day.id;
export const endId = day => '@e:' + day.id;
export const isEndpoint = id => typeof id === 'string' && id.startsWith('@');

/**
 * Compute the timeline for one day.
 * Returns rows: { st, place, i, n, tr, ready, arr, end, wait, late, warn }
 *  - n: 1-based number of a real stop (null for the hotel/arrival/departure endpoints)
 *  - endpoint rows have st.virtual = 'start' | 'end' and st.kind = 'hotel' | 'arrive' | 'depart'
 * Pass { ends:false } to leave the endpoints out.
 */
export function computeDay(trip, di, { ends = true } = {}) {
  const day = trip.days[di];
  if (!day) return [];
  const wd = dateParts(day.date).wd;
  const E = ends ? dayEnds(trip, di) : {};
  const real = day.stops.filter(s => trip.places[s.place]?.lat != null);
  const list = day.stops.map((st, i) => ({ st, i }));
  // An explicit first/last stop at the same place replaces the endpoint (older plans do this).
  if (E.from && real[0]?.place !== E.from) {
    list.unshift({ st: { id: startId(day), place: E.from, dur: 0, mode: 'auto', virtual: 'start', kind: E.fromKind }, i: -1 });
  }
  let toBy = null;
  if (E.to && real[real.length - 1]?.place !== E.to) {
    list.push({ st: { mode: 'auto', ...(day.back || {}), id: endId(day), place: E.to, dur: 0, virtual: 'end', kind: E.toKind, fixed: E.toBy }, i: day.stops.length });
  } else if (E.toBy && real.length) toBy = { id: real[real.length - 1].id, at: E.toBy };

  let t = toMin(day.start) ?? 540, n = 0;
  const rows = [];
  list.forEach(({ st, i }) => {
    const place = trip.places[st.place];
    if (!place || place.lat == null) return;
    const tr = rows.length ? travelFor(rows[rows.length - 1].place, place, st, trip.routes) : null;
    const ready = t + (tr ? tr.min : 0);
    const fixed = toMin(st.fixed) ?? (toBy && toBy.id === st.id ? toMin(toBy.at) : null);
    let arr = ready, wait = 0, late = 0;
    if (fixed != null) {
      if (fixed >= ready) { wait = fixed - ready; arr = fixed; } else { late = ready - fixed; }
    }
    // Being early for your flight isn't "waiting at the door": arrive when you arrive.
    if (st.virtual === 'end' && wait) { arr = ready; }
    const end = arr + (Number(st.dur) || 0);
    const warn = st.virtual ? null : hoursCheck({ hours: hoursFor(place, day.date) }, wd, arr, end);
    rows.push({ st, place, i, n: st.virtual ? null : ++n, tr, ready, arr, end, wait, late, warn });
    t = end;
  });
  return rows;
}

/**
 * Find a stop by id. Endpoint ids ('@s:…' / '@e:…') resolve to their day; for the end
 * endpoint `st` is day.back (created on demand) so travel overrides can be stored on it.
 */
export function findStop(trip, stopId) {
  if (isEndpoint(stopId)) {
    const di = trip.days.findIndex(d => stopId === startId(d) || stopId === endId(d));
    if (di < 0) return null;
    const day = trip.days[di], start = stopId === startId(day);
    return { di, i: start ? -1 : day.stops.length, st: start ? {} : (day.back ||= {}), virtual: start ? 'start' : 'end' };
  }
  for (let di = 0; di < trip.days.length; di++) {
    const i = trip.days[di].stops.findIndex(s => s.id === stopId);
    if (i >= 0) return { di, i, st: trip.days[di].stops[i] };
  }
  return null;
}
/** Place ids used anywhere in the plan, including hotels / arrival / departure. */
export const scheduledIds = trip => new Set([
  ...trip.days.flatMap(d => d.stops.map(s => s.place)),
  ...(trip.stays || []).map(s => s.place), trip.arrive?.place, trip.depart?.place
].filter(Boolean));
export function placeUses(trip, pid) {
  const out = [];
  trip.days.forEach((d, di) => d.stops.forEach((s, i) => { if (s.place === pid) out.push({ di, i, st: s }); }));
  return out;
}

/**
 * Where to insert `place` into day `di` with the smallest detour.
 * Keeps a trailing hotel/transport stop (end of day) last.
 */
export function bestIndex(trip, di, place) {
  const stops = trip.days[di].stops.map(s => trip.places[s.place]).filter(Boolean);
  const E = dayEnds(trip, di);
  const start = E.from && stops[0]?.id !== E.from ? trip.places[E.from] : null;
  const end = E.to && stops[stops.length - 1]?.id !== E.to ? trip.places[E.to] : null;
  if (!stops.length) return 0;
  const lastCat = stops[stops.length - 1].cat;
  const maxI = !end && ['hotel', 'transport'].includes(lastCat) && stops.length > 1 ? stops.length - 1 : stops.length;
  let best = maxI, bestCost = Infinity;
  // Without a known start point, never insert before the first stop (it's usually where you start).
  for (let i = start ? 0 : 1; i <= maxI; i++) {
    const a = i > 0 ? stops[i - 1] : start, b = i < stops.length ? stops[i] : end;
    const cost = hav(a, place) + (b ? hav(place, b) - hav(a, b) : 0);
    if (cost < bestCost) { bestCost = cost; best = i; }
  }
  return best;
}

export const defaultDur = place => (CATS[place?.cat] || CATS.other).dur;
