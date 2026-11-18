// Deep links into Google Maps / image search. Places are referenced by search text
// (place.q, or name + trip.mapsSuffix) so small coordinate errors don't matter.

import { MODES } from './config.js';

export const mapsQuery = (trip, p) => p.q || (p.name + (trip.mapsSuffix || ''));
export const mapsUrl = (trip, p) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapsQuery(trip, p));
export function dirUrl(trip, from, to, mode) {
  const tm = (MODES[mode] || MODES.transit).gmaps;
  return 'https://www.google.com/maps/dir/?api=1'
    + (from ? '&origin=' + encodeURIComponent(mapsQuery(trip, from)) : '')
    + '&destination=' + encodeURIComponent(mapsQuery(trip, to)) + '&travelmode=' + tm;
}
export const photosUrl = (trip, p) => 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(p.name + ' ' + (trip.mapsSuffix || '').replace(/^,\s*/, ''));
/** Whole-day route; Google Maps accepts ~10 stops in a dir URL. */
export function routeUrl(trip, rows) {
  const pts = rows.map(r => r.place).filter((p, i, a) => i === 0 || p.id !== a[i - 1].id).slice(0, 10);
  return 'https://www.google.com/maps/dir/' + pts.map(p => encodeURIComponent(mapsQuery(trip, p))).join('/');
}
