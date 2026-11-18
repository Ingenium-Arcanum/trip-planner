// Persistence: many trips, each saved under its own localStorage key.
// Trip files (trips/*/trip.json) are *templates*: loading one copies it into storage,
// after which the stored copy is the source of truth and the file is never touched.

import { ls, uid, clone, isoAddDays } from './util.js';
import { STORAGE } from './config.js';
import { centroid } from './geo.js';

export const SCHEMA = 2;

/** Normalise a trip from file/import into the in-memory shape. Idempotent. */
export function normalize(raw, { id } = {}) {
  const t = clone(raw);
  t.schema = SCHEMA;
  t.id = id || t.id || 'trip-' + uid();
  t.title = t.title || t.trip?.title || 'My trip';
  t.tz = t.tz || t.trip?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  t.mapsSuffix = t.mapsSuffix ?? t.trip?.mapsSuffix ?? (t.destination ? ', ' + t.destination : '');
  delete t.trip; // v1 kept settings under .trip
  if (Array.isArray(t.places)) t.places = Object.fromEntries(t.places.map(p => [p.id, p]));
  t.places = t.places || {};
  t.days = (t.days || []).map(d => ({ id: d.id || uid(), start: '09:30', ...d, stops: (d.stops || []).map(s => ({ mode: 'auto', ...s, id: s.id || uid() })) }));
  if (!t.center) { const c = centroid(Object.values(t.places)); if (c) t.center = [c.lat, c.lng]; }
  if (typeof t.basemap === 'string') t.basemap = null; // unresolved path: resolve via loadTemplate()
  return t;
}
export const isTrip = t => t && Array.isArray(t.days) && t.places && typeof t.places === 'object';

/* ---------- index ---------- */
export const listTrips = () => ls.get(STORAGE.index) || [];
function writeIndexEntry(t) {
  const idx = listTrips().filter(e => e.id !== t.id);
  idx.push({ id: t.id, title: t.title, destination: t.destination || '', start: t.days[0]?.date || '', end: t.days[t.days.length - 1]?.date || '', updated: Date.now() });
  idx.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  ls.set(STORAGE.index, idx);
}

/* ---------- trips ---------- */
export const loadTrip = id => { const t = ls.get(STORAGE.trip(id)); return isTrip(t) ? normalize(t) : null; };
/** Returns false if the browser refused to store it. */
export function saveTrip(t) {
  const ok = ls.set(STORAGE.trip(t.id), t);
  if (ok) { writeIndexEntry(t); ls.set(STORAGE.last, t.id); }
  return ok;
}
export function deleteTrip(id) {
  ls.del(STORAGE.trip(id));
  ls.set(STORAGE.index, listTrips().filter(e => e.id !== id));
}
export const lastTripId = () => ls.get(STORAGE.last);

export function newTrip({ title, destination, start, days = 2, tz }) {
  const t = normalize({
    title: title || (destination ? destination + ' trip' : 'New trip'),
    destination, tz,
    days: Array.from({ length: Math.max(1, days) }, (_, i) => ({ date: isoAddDays(start, i), start: '09:30', stops: [] })),
    places: {}
  });
  saveTrip(t);
  return t;
}

/* ---------- templates bundled with the app ---------- */
export async function listTemplates() {
  try { const r = await fetch('trips/index.json'); return r.ok ? await r.json() : []; } catch (e) { return []; }
}
/** Fetch a template trip.json and resolve its basemap file (relative path). */
export async function loadTemplate(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error('Could not load ' + path);
  const raw = await r.json();
  let basemap = null;
  if (typeof raw.basemap === 'string') {
    const url = path.replace(/[^/]*$/, '') + raw.basemap;
    try { const b = await fetch(url); if (b.ok) basemap = await b.json(); } catch (e) { /* optional */ }
  }
  const t = normalize(raw);
  t.basemap = basemap;
  t.templatePath = path;
  return t;
}

/* ---------- import / export ---------- */
export const exportTrip = t => JSON.stringify(t);
/** Accepts an exported trip, a template-format trip, or the v1 prototype state. */
export function importTrip(text, { keepId = false } = {}) {
  const raw = JSON.parse(text);
  if (!raw || !Array.isArray(raw.days) || !raw.places) throw new Error('Not a trip');
  const t = normalize(raw, { id: keepId ? raw.id : undefined });
  if (!keepId && listTrips().some(e => e.id === raw.id)) t.id = 'trip-' + uid();
  else if (raw.id) t.id = raw.id;
  saveTrip(t);
  return t;
}

/** One-time migration of the first prototype's single saved plan. */
export function migrateLegacy(templateBasemap) {
  const old = ls.get(STORAGE.legacy);
  if (!old || !isTrip(old) || ls.get('tp.migrated')) return null;
  const t = normalize(old, { id: 'legacy' });
  t.title = old.trip?.title || 'My trip';
  t.destination = old.trip?.destination || '';
  t.basemap = templateBasemap || null;
  saveTrip(t);
  ls.set('tp.migrated', true);
  return t;
}
