// Network lookups. Every call can fail (offline, the claude.ai artifact sandbox blocks
// fetches to other sites, a service is down) — callers get null/[] and show a hint.
//
// Services (all free, no key; keep usage light and cached):
//   Photon      photon.komoot.io         search places by name (search-as-you-type is allowed)
//   Wikidata    query.wikidata.org       famous places around a point (ranked by #Wikipedias)
//   Wikipedia   *.wikipedia.org REST     short summary + picture for a place
//   OSM API     api.openstreetmap.org    opening_hours / website of one OSM object (Overpass as backup)

import { photonToPlace, sightsQuery, parseSights, dedupeFound } from './discover.js';
import { ls } from './util.js';

const memo = new Map();
/** Bump when the filtering/categories in discover.js change, so cached lists refresh. */
const SIGHTS_V = 5;

async function getJSON(url, { timeout = 12000, init } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

/** Search places by name, biased towards `near` ({lat,lng}). Returns place drafts. */
export async function searchPlaces(q, near) {
  q = (q || '').trim();
  if (q.length < 2) return [];
  const key = 's|' + q.toLowerCase() + '|' + (near ? near.lat.toFixed(2) + ',' + near.lng.toFixed(2) : '');
  if (memo.has(key)) return memo.get(key);
  let url = 'https://photon.komoot.io/api/?limit=10&lang=en&q=' + encodeURIComponent(q);
  if (near) url += `&lat=${near.lat}&lon=${near.lng}&location_bias_scale=0.3&zoom=12`;
  const j = await getJSON(url, { timeout: 8000 });
  const out = dedupeFound((j.features || []).map(photonToPlace).filter(p => p.lat != null));
  memo.set(key, out);
  return out;
}

/** Look up a city/region: { name, lat, lng, km (rough radius), country, label } or null. */
export async function findCity(q) {
  if (!q?.trim()) return null;
  const j = await getJSON('https://photon.komoot.io/api/?limit=1&lang=en&osm_tag=place&q=' + encodeURIComponent(q.trim()), { timeout: 8000 });
  const f = j.features?.[0];
  if (!f) return null;
  const p = f.properties, [lng, lat] = f.geometry.coordinates;
  let km = 6;
  if (p.extent) {
    const [w, n, e, s] = p.extent;
    const dx = (e - w) * 111 * Math.cos(lat * Math.PI / 180), dy = (n - s) * 111;
    km = Math.max(2, Math.min(15, Math.round(Math.max(dx, dy) / 2)));
  }
  return { name: p.name, lat, lng, km, country: p.country, countrycode: p.countrycode, label: [p.name, p.country].filter(Boolean).join(', ') };
}

/**
 * Famous places within `km` of a point, best first. Cached for a week per area.
 * `minLinks` (how many Wikipedias must write about it) can be lowered for small "near me" searches.
 */
export async function topSights(center, km = 8, { minLinks } = {}) {
  const lat = +center.lat, lng = +center.lng;
  const key = `tp.cache.sights${SIGHTS_V}.${lat.toFixed(3)},${lng.toFixed(3)},${km}${minLinks ? ',' + minLinks : ''}`;
  if (memo.has(key)) return memo.get(key);
  const cached = ls.get(key);
  if (cached && Date.now() - cached.t < 7 * 864e5 && cached.v?.length) { memo.set(key, cached.v); return cached.v; }
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sightsQuery(lat, lng, km, 'en', 300, minLinks));
  const j = await getJSON(url, { timeout: 25000, init: { headers: { Accept: 'application/sparql-results+json' } } });
  const v = parseSights(j);
  memo.set(key, v);
  ls.set(key, { t: Date.now(), v });
  return v;
}

/** Wikipedia summary for an article URL: { extract, thumb } or null. */
export async function wikiSummary(articleUrl) {
  const m = (articleUrl || '').match(/^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/(.+)$/);
  if (!m) return null;
  const key = 'w|' + articleUrl;
  if (memo.has(key)) return memo.get(key);
  try {
    const j = await getJSON(`https://${m[1]}.wikipedia.org/api/rest_v1/page/summary/${m[2]}`, { timeout: 8000 });
    const v = { extract: j.extract || '', thumb: j.thumbnail?.source };
    memo.set(key, v);
    return v;
  } catch (e) { return null; }
}

/**
 * Walking route through `points` (in order) from the OpenStreetMap routing server (FOSSGIS,
 * routing.openstreetmap.de, foot profile). Returns one { min, km } per leg. Usage policy: max one
 * request per second, no heavy use — the app asks once per day of the plan and keeps the result.
 */
export async function walkRoute(points) {
  const coords = points.map(p => `${(+p.lng).toFixed(5)},${(+p.lat).toFixed(5)}`).join(';');
  const j = await getJSON(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coords}?overview=false&steps=false`, { timeout: 12000 });
  if (j.code !== 'Ok' || !j.routes?.[0]) throw new Error('No route');
  return j.routes[0].legs.map(l => ({ min: l.duration / 60, km: l.distance / 1000 }));
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
/**
 * Tags of one OSM object ('N123' / 'W5' / 'R9'), e.g. { opening_hours, website, wikipedia }.
 * Returns {} when the object has no tags. Throws when every source failed (try again later).
 * Asks the main OSM API first (fast, one object, fine for light interactive use), then Overpass.
 */
export async function osmTags(osm) {
  const m = (osm || '').match(/^([NWR])(\d+)$/);
  if (!m) return {};
  const kind = { N: 'node', W: 'way', R: 'relation' }[m[1]];
  try {
    const j = await getJSON(`https://api.openstreetmap.org/api/0.6/${kind}/${m[2]}.json`, { timeout: 8000 });
    return j.elements?.find(e => e.type === kind && String(e.id) === m[2])?.tags || {};
  } catch (e) { /* fall through to Overpass */ }
  const q = `[out:json][timeout:8];${kind}(${m[2]});out tags;`;
  for (const ep of OVERPASS) {
    try {
      const j = await getJSON(ep + '?data=' + encodeURIComponent(q), { timeout: 9000 });
      return j.elements?.[0]?.tags || {};
    } catch (e) { /* try the next mirror */ }
  }
  throw new Error('Opening hours lookup failed');
}
