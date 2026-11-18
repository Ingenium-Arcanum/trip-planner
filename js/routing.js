// Real walking times. The app asks a routing server (net.walkRoute) for the walks in a day and
// stores each leg in trip.routes = { 'lat,lng>lat,lng': { m: minutes, km } } — so they work offline
// and travel along in share links. The timeline uses them via autoTravel/travelFor.
// Pure — no DOM, no fetch (tests/routing.test.mjs).

import { hav, routeKey } from './geo.js';
import { computeDay } from './schedule.js';

/** Hops longer than this (straight line) won't be walked anyway — don't ask for a route. */
export const ROUTE_MAX_KM = 3;

/** Every hop (from → to place) in the plan, in day order. */
function hops(trip) {
  const out = [];
  trip.days.forEach((_, di) => {
    const rows = computeDay(trip, di);
    for (let k = 1; k < rows.length; k++) out.push({ di, a: rows[k - 1].place, b: rows[k].place });
  });
  return out;
}
const wanted = h => { const d = hav(h.a, h.b); return d >= 0.05 && d <= ROUTE_MAX_KM; };

/**
 * Which days still need walking routes: [{ di, points:[{lat,lng}] }] — one request per day,
 * with all its stops in order (one route call returns every leg).
 */
export function routeRequests(trip) {
  const routes = trip.routes || {};
  const need = new Set(hops(trip).filter(h => wanted(h) && !routes[routeKey(h.a, h.b)]).map(h => h.di));
  return [...need].map(di => ({ di, points: computeDay(trip, di).map(r => ({ lat: r.place.lat, lng: r.place.lng })) }));
}

/** Store the legs of a route request ({min, km} per consecutive pair of points). */
export function storeLegs(trip, points, legs) {
  trip.routes ||= {};
  legs.forEach((l, i) => {
    if (!l || points[i + 1] == null) return;
    trip.routes[routeKey(points[i], points[i + 1])] = { m: Math.round(l.min * 10) / 10, km: Math.round(l.km * 1000) / 1000 };
  });
  return trip;
}

/** Drop stored routes no longer used by any hop in the plan (keeps share links small). */
export function pruneRoutes(trip) {
  if (!trip.routes) return trip;
  const used = new Set(hops(trip).map(h => routeKey(h.a, h.b)));
  for (const k of Object.keys(trip.routes)) if (!used.has(k)) delete trip.routes[k];
  return trip;
}
