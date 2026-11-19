// Persistence: many trips, each saved under its own localStorage key.
// Trip files (trips/*/trip.json) are *templates*: loading one copies it into storage,
// after which the stored copy is the source of truth and the file is never touched.

import { ls, uid, clone, isoAddDays, daysBetween } from './util.js';
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
    title: title || (destination ? destination.split(',')[0].trim() + ' trip' : 'New trip'),
    destination, tz,
    days: Array.from({ length: Math.max(1, days) }, (_, i) => ({ date: isoAddDays(start, i), start: '09:30', stops: [] })),
    places: {}
  });
  saveTrip(t);
  return t;
}

/**
 * Move the whole trip so it starts on `start`, and make it end on `end` (both 'YYYY-MM-DD').
 * Every day keeps its stops and its place in the order; hotel nights move along.
 * A longer trip gets empty days at the end; a shorter one drops days from the end, but only
 * empty ones. Returns { ok, shift, added, removed } or { ok:false, error } (trip untouched).
 */
export function setTripDates(t, start, end) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(start || '') || !t.days.length) return { ok: false, error: 'Pick a first day' };
  const shift = daysBetween(t.days[0].date, start);
  const moved = t.days.map(d => isoAddDays(d.date, shift));
  end = iso.test(end || '') ? end : moved[moved.length - 1];
  if (end < start) return { ok: false, error: 'The last day is before the first day' };
  if (daysBetween(start, end) > 365) return { ok: false, error: 'That’s more than a year' };
  const keep = moved.filter(d => d <= end).length;
  const drop = t.days.slice(Math.max(1, keep));
  if (drop.some(d => d.stops.length)) {
    const n = drop.filter(d => d.stops.length).length;
    return { ok: false, error: `${n === 1 ? 'A day' : n + ' days'} after the new last day still ${n === 1 ? 'has' : 'have'} plans — move or delete ${n === 1 ? 'it' : 'them'} first` };
  }
  t.days.forEach((d, i) => { d.date = moved[i]; });
  t.days.splice(Math.max(1, keep));
  let added = 0;
  for (let last = t.days[t.days.length - 1].date; last < end; added++) {
    last = isoAddDays(last, 1);
    t.days.push({ id: uid(), date: last, start: '09:30', stops: [] });
  }
  const checkout = isoAddDays(end, 1);
  t.stays = (t.stays || []).map(s => ({ ...s, from: s.from && isoAddDays(s.from, shift), to: s.to && isoAddDays(s.to, shift) }))
    .map(s => s.to > checkout ? { ...s, to: checkout } : s)
    .filter(s => !s.from || !s.to || s.from < s.to);
  return { ok: true, shift, added, removed: drop.length };
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
