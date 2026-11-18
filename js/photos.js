// User photos per place, stored as blobs in IndexedDB (this device only).
// Keyed by trip + place so different trips never mix.

import { uid } from './util.js';

let DB = null;
const CACHE = {}; // `${tripId}/${placeId}` -> [{id,url}]
const key = (tripId, pid) => tripId + '/' + pid;

export function initPhotos() {
  return new Promise(res => {
    try {
      const rq = indexedDB.open('trip-planner-photos', 2);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      rq.onsuccess = () => { DB = rq.result; res(true); };
      rq.onerror = () => res(false);
    } catch (e) { res(false); }
  });
}

/** Load all photos for a trip into the object-URL cache. */
export function loadTripPhotos(tripId) {
  Object.keys(CACHE).forEach(k => { if (k.startsWith(tripId + '/')) delete CACHE[k]; });
  if (!DB) return Promise.resolve();
  return new Promise(res => {
    try {
      const rq = DB.transaction('photos').objectStore('photos').getAll();
      rq.onsuccess = () => {
        (rq.result || []).sort((a, b) => a.t - b.t).forEach(r => {
          const trip = r.trip || 'legacy'; // records from the prototype had no trip id
          if (trip !== tripId) return;
          (CACHE[key(tripId, r.place)] ||= []).push({ id: r.id, url: URL.createObjectURL(r.blob) });
        });
        res();
      };
      rq.onerror = () => res();
    } catch (e) { res(); }
  });
}

export const photosOf = (tripId, pid) => CACHE[key(tripId, pid)] || [];

async function shrink(file, max = 1400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', 0.82));
  } catch (e) { return file; } finally { URL.revokeObjectURL(url); }
}

/** Returns true if all photos were persisted. */
export async function addPhotos(tripId, pid, files) {
  let allStored = true;
  for (const f of files) {
    const blob = await shrink(f);
    const rec = { id: uid(), trip: tripId, place: pid, blob, t: Date.now() };
    let stored = false;
    if (DB) stored = await new Promise(res => {
      try { const tx = DB.transaction('photos', 'readwrite'); tx.objectStore('photos').put(rec); tx.oncomplete = () => res(true); tx.onerror = () => res(false); }
      catch (e) { res(false); }
    });
    allStored &&= stored;
    (CACHE[key(tripId, pid)] ||= []).push({ id: rec.id, url: URL.createObjectURL(blob) });
  }
  return allStored;
}

export function deletePhoto(tripId, pid, id) {
  CACHE[key(tripId, pid)] = photosOf(tripId, pid).filter(p => p.id !== id);
  if (DB) try { DB.transaction('photos', 'readwrite').objectStore('photos').delete(id); } catch (e) { /* ignore */ }
}
