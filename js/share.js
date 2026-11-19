// Share a trip as a link. The whole trip is compressed into the part after '#t=' in the URL.
// Browsers never send the part after '#' to the server, so the trip isn't uploaded or stored
// anywhere — it lives only in the link itself. No DOM here (tested in tests/share.test.mjs).

import { clone } from './util.js';
import { normalize, isTrip } from './store.js';

/** Fields that only matter on this device (or are big and rebuildable). */
const LOCAL_ONLY = ['basemap', 'templatePath', 'hideSetup', 'discKm'];

/** The trip as it goes into a link, stamped with when the link was made. */
export function slimTrip(trip, now = Date.now()) {
  const t = clone(trip);
  for (const k of LOCAL_ONLY) delete t[k];
  t.sharedAt = now;
  return t;
}

const b64u = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = str => {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
const supports = Ctor => { try { new Ctor('deflate-raw'); return true; } catch (e) { return false; } };
export const canCompress = () => typeof CompressionStream === 'function' && supports(CompressionStream);
const canDecompress = () => typeof DecompressionStream === 'function' && supports(DecompressionStream);

/** Trip -> link code: '1' + base64url(deflate(JSON)), or '0' + base64url(JSON) without compression. */
export async function encodeTrip(trip, { compress = canCompress(), now } = {}) {
  const json = new TextEncoder().encode(JSON.stringify(slimTrip(trip, now)));
  return compress ? '1' + b64u(await pipe(json, new CompressionStream('deflate-raw'))) : '0' + b64u(json);
}

/** Link code -> normalized trip (keeps the sender's trip id). Throws if the link is broken or cut off. */
export async function decodeTrip(code) {
  if (!code || code.length < 2) throw new Error('Empty link');
  const v = code[0], bytes = unb64u(code.slice(1));
  let raw;
  if (v === '1') {
    if (!canDecompress()) throw new Error('This browser can’t open compressed links');
    raw = await pipe(bytes, new DecompressionStream('deflate-raw'));
  } else if (v === '0') raw = bytes;
  else throw new Error('Unknown link version');
  const t = JSON.parse(new TextDecoder().decode(raw));
  if (!isTrip(t)) throw new Error('Not a trip');
  return normalize(t, { id: t.id });
}

/** Full link for a code, based on the current page address (any old '#…' is dropped). */
export const shareUrl = (href, code) => String(href).split('#')[0] + '#t=' + code;

/** The code in a location.hash like '#t=1abc…', or null. */
export function codeFromHash(hash) {
  const m = String(hash || '').match(/^#t=([A-Za-z0-9_-]+)$/);
  return m ? m[1] : null;
}

/**
 * The code in pasted text: a whole message with the link in it ("Our trip plan: … https://…#t=1abc"),
 * the link alone, or just the code. Null when there is none (e.g. a pasted backup, which is JSON).
 */
export function codeFromText(text) {
  const s = String(text || '').trim();
  const m = s.match(/#t=([A-Za-z0-9_-]{8,})/);
  if (m) return m[1];
  return /^[01][A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}

/** Links longer than this can get cut off by some chat apps. */
export const LONG_LINK = 60000;
