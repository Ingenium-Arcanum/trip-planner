// "Near me": what's worth doing within walking distance of where you are, right now.
// Pure — no DOM, no location API (tests/nearby.test.mjs). The app gets the position and the
// famous-sights list (net.topSights) and passes them in.

import { toMin, dateParts } from './util.js';
import { hav } from './geo.js';
import { estimate, computeDay, scheduledIds } from './schedule.js';
import { hoursFor, findExisting } from './discover.js';

/** Round a position to ~100 m before it's sent anywhere (search queries, cache keys). */
export const roughly = p => ({ lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 });

/**
 * Is a place open at `min` (minutes since midnight) on `date`?
 * { state: 'open', until } | { state: 'closed', opens? } | { state: 'unknown' }
 */
export function openState(place, date, min) {
  const h = hoursFor(place, date);
  if (!h) return { state: 'unknown' };
  const slots = (h[String(dateParts(date).wd)] || []).map(s => s.split('-').map(toMin));
  const cur = slots.find(([o, c]) => min >= o && min < c);
  if (cur) return { state: 'open', until: cur[1] };
  const later = slots.find(([o]) => o > min);
  return later ? { state: 'closed', opens: later[0] } : { state: 'closed' };
}

/**
 * Where "Add next" should put a stop in day `di` at time `min`: right after the stop you're at,
 * or before the one you're heading to; at the end when the day is done.
 */
export function nextIndex(trip, di, min) {
  const rows = computeDay(trip, di).filter(r => !r.st.virtual);
  const cur = rows.find(r => min < r.end);
  if (!cur) return trip.days[di].stops.length;
  return min >= cur.arr ? cur.i + 1 : cur.i;
}

/**
 * Things near `here` ({lat,lng}) within `km`, as cards:
 *  { kind:'idea'|'sight', id?, wd?, name, cat, lat, lng, img?, km, walk, open, saved, item }
 *  - ideas: your places not planned for `date` yet (skips hotels/transport)
 *  - sights: famous places (from net.topSights) you don't have yet
 * Open-now places first, then nearest.
 */
export function nearbyCandidates(trip, here, { km = 1, date, min, sights = [] } = {}) {
  const day = trip.days.find(d => d.date === date);
  const today = new Set(day ? day.stops.map(s => s.place) : []);
  const planned = scheduledIds(trip);
  const out = [];
  const add = (kind, item, extra) => {
    const d = hav(here, item);
    if (d > km) return;
    out.push({ kind, name: item.name, cat: item.cat, lat: item.lat, lng: item.lng, img: item.img,
      km: d, walk: Math.max(1, estimate('walk', d)), open: date != null && min != null ? openState(item, date, min) : { state: 'unknown' }, item, ...extra });
  };
  for (const p of Object.values(trip.places)) {
    if (p.lat == null || ['hotel', 'transport'].includes(p.cat) || today.has(p.id)) continue;
    add('idea', p, { id: p.id, saved: true, planned: planned.has(p.id) });
  }
  for (const s of sights) {
    if (findExisting(trip, s)) continue; // already one of your places (shown above, or planned)
    add('sight', s, { wd: s.wd, saved: false });
  }
  const rank = c => (c.open.state === 'closed' ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || (b.saved - a.saved) || a.km - b.km);
}

/** "650 m" / "1.4 km" */
export const distLabel = km => km < 1 ? Math.max(10, Math.round(km * 100) * 10) + ' m' : km.toFixed(1) + ' km';
