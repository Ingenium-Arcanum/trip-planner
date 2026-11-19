// App shell, rendering and every user action.

import { $, esc, uid, fmt, toMin, toast, dayLong, dayShort, isoAddDays, ls } from './util.js';
import { dayColor, cat } from './config.js';
import { parseCoords } from './geo.js';
import { computeDay, findStop, bestIndex, defaultDur, isEndpoint, scheduledIds } from './schedule.js';
import { findExisting, sightToPlace, parseOpeningHours, prettyHours, parseTypedHours, tzForCountry } from './discover.js';
import * as net from './net.js';
import * as store from './store.js';
import { encodeTrip, decodeTrip, shareUrl, codeFromHash, codeFromText } from './share.js';
import { initPwa, pwa, promptInstall } from './pwa.js';
import { suggestFixes, applyOps } from './rescue.js';
import { optimiseDay, applyOrder } from './optimise.js';
import { autoPlan } from './autoplan.js';
import { nextIndex, roughly } from './nearby.js';
import { routeRequests, storeLegs, pruneRoutes } from './routing.js';
import { loadTripPhotos, addPhotos, deletePhoto } from './photos.js';
import { createMap, setMapPref } from './map/index.js';
import { ctx, hooks, commit, save } from './state.js';
import { openSheet, closeSheet, refreshSheet, hideSheetTemporarily, rescueOpts, routingOn } from './sheets.js';
import { renderPlan } from './views/plan.js';
import { renderNow, tripNow } from './views/now.js';
import { renderIdeas, foundHtml } from './views/ideas.js';
import { renderHome } from './views/home.js';
import { thumb } from './views/components.js';

const UI = ctx.ui;
hooks.render = renderAll;
hooks.refreshSheet = () => refreshSheet();

/* ================= shell & render ================= */
function shell() {
  $('#app').innerHTML = `
  <header class="top">
    <button class="iconbtn backbtn" data-act="home" aria-label="All trips" id="backBtn">‹</button>
    <h1 id="title"></h1>
    <div class="deskviews" id="deskViews">
      <button class="pill" data-view="plan">📋 Plan</button>
      <button class="pill" data-view="now">⏱️ Now</button>
      <button class="pill" data-view="ideas">💡 Ideas</button>
    </div>
    <button class="iconbtn" data-act="share" aria-label="Share trip" id="shareBtn" title="Share with a travel companion">🔗</button>
    <button class="iconbtn" data-act="menu" aria-label="Trip settings" id="menuBtn">⋯</button>
  </header>
  <div class="main" id="main">
    <section class="panel" id="panel"></section>
    <section class="mapwrap" id="mapwrap">
      <div id="mapHost" style="position:absolute;inset:0"></div>
      <div class="mapday" id="mapday"></div>
      <div class="mapctl">
        <button data-act="zin" aria-label="Zoom in">＋</button>
        <button data-act="zout" aria-label="Zoom out">－</button>
        <button data-act="fit" aria-label="Fit day">⤢</button>
        <button data-act="toggle-ideas" aria-label="Show ideas" id="ideaToggle">💡</button>
        <button data-act="near" aria-label="Near me">◎</button>
      </div>
      <div id="mapextra"></div>
      <div class="maplegend" id="maplegend"></div>
    </section>
  </div>
  <nav class="bottom" id="bottomNav">
    <button data-view="plan"><span>📋</span>Plan</button>
    <button data-view="map"><span>🗺️</span>Map</button>
    <button data-view="now"><span>⏱️</span>Now</button>
    <button data-view="ideas"><span>💡</span>Ideas</button>
  </nav>`;
}

export function renderAll() {
  UI.mobile = !matchMedia('(min-width:900px)').matches;
  const t = ctx.trip, home = !t;
  $('#main').classList.toggle('is-home', home);
  $('#bottomNav').style.display = home ? 'none' : '';
  $('#deskViews').style.visibility = home ? 'hidden' : '';
  $('#menuBtn').style.visibility = home ? 'hidden' : '';
  $('#shareBtn').style.display = home ? 'none' : '';
  $('#backBtn').style.display = home ? 'none' : '';
  const panel = $('#panel'), mw = $('#mapwrap');
  if (home) {
    $('#title').innerHTML = `Trip planner<span class="sub">Plan it, then follow it live</span>`;
    mw.classList.add('hidden'); panel.classList.remove('hidden');
    panel.innerHTML = renderHome();
    return;
  }
  if (!UI.mobile && UI.view === 'map') UI.view = 'plan';
  if (UI.day >= t.days.length) UI.day = Math.max(0, t.days.length - 1);
  const first = t.days[0], last = t.days[t.days.length - 1];
  $('#title').innerHTML = `${esc(t.title)}<span class="sub">${first ? esc(dayLong(first)) + (last !== first ? ' – ' + esc(dayLong(last)) : '') : ''}${t.destination ? ' · ' + esc(t.destination) : ''}</span>`;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === UI.view));
  panel.classList.toggle('hidden', UI.view === 'map');
  mw.classList.toggle('hidden', UI.mobile && UI.view !== 'map');
  const st = panel.scrollTop;
  panel.innerHTML = (UI.canSave ? '' : `<div class="banner">This browser isn’t letting the app save. Use ⋯ → Backup to keep your changes.</div>`)
    + (pwa.online ? '' : `<div class="banner offline">📴 Offline — your plan works; search, Discover and new map areas need a connection.</div>`)
    + (UI.view === 'now' ? renderNow() : UI.view === 'ideas' ? renderIdeas() : renderPlan());
  panel.scrollTop = st;
  renderMapChrome();
  updateMap();
  queueRoutes();
}

/* ================= map ================= */
async function ensureMap() {
  if (ctx.map) return ctx.map;
  ctx.map = await createMap($('#mapHost'), {
    onStop(id) {
      if (isEndpoint(id)) { const r = rowOf(id); if (r) openSheet('place', r.place.id); return; }
      UI.sel = id; renderAll(); if (!UI.mobile) openSheet('stop', id);
    },
    onPlace(id) { openSheet('place', id); },
    onExtra(wd) { openSight(wd); },
    onBackground() { if (UI.sel) { UI.sel = null; renderAll(); } }
  });
  return ctx.map;
}
function updateMap() {
  if (!ctx.map || !ctx.trip) return;
  ctx.map.update({ trip: ctx.trip, rows: computeDay(ctx.trip, UI.day), color: dayColor(UI.day), sel: UI.sel, showIdeas: UI.showIdeas, extra: discoverPins(), me: UI.near?.here?.source === 'gps' ? UI.near.here : null });
}
/** Top sights not yet in the trip, shown on the map while Discover is open. */
function discoverPins() {
  const D = UI.disc, t = ctx.trip;
  if (UI.ideasTab !== 'discover' || !['ideas', 'map'].includes(UI.view) || !D.list) return [];
  const list = D.cat === 'all' ? D.list : D.list.filter(s => s.cat === D.cat);
  return list.slice(0, D.limit).filter(s => !findExisting(t, s)).map(s => ({ key: s.wd, lat: s.lat, lng: s.lng, name: s.name, e: cat(s).e }));
}
function fitDay() {
  if (!ctx.map || !ctx.trip) return;
  const day = ctx.trip.days[UI.day];
  const pts = day ? day.stops.map(s => ctx.trip.places[s.place]).filter(Boolean) : [];
  const core = pts.filter(p => !['transport', 'hotel'].includes(p.cat));
  const use = core.length >= 2 ? core : pts.length ? pts : Object.values(ctx.trip.places);
  if (use.length) ctx.map.fit(use, { bottomPad: UI.mobile ? 100 : 50 });
  else if (ctx.trip.center) ctx.map.centerOn({ lat: ctx.trip.center[0], lng: ctx.trip.center[1] });
}
function renderMapChrome() {
  const t = ctx.trip;
  $('#mapday').innerHTML = t.days.map((d, i) => `<button class="pill ${i === UI.day ? 'on' : ''}" style="${i === UI.day ? `background:${dayColor(i)};border-color:${dayColor(i)};color:#fff` : ''}" data-act="day" data-i="${i}">${esc(dayShort(d))}</button>`).join('');
  let extra = '';
  if (UI.picking) extra = `<div class="pickbanner">📍 Tap the map to place it <button data-act="cancel-pick">Cancel</button></div>`;
  else if (UI.mobile && UI.sel) {
    const r = computeDay(t, UI.day).find(x => x.st.id === UI.sel);
    if (r) extra = `<div class="mapcard" data-act="open-stop" data-id="${r.st.id}">${thumb(r.place)}<div style="flex:1;min-width:0"><div class="nm">${esc(r.place.name)}</div><div class="meta">${fmt(r.arr)}–${fmt(r.end)} · stop ${r.i + 1}</div></div><span class="muted">›</span></div>`;
  }
  $('#mapextra').innerHTML = extra;
  $('#ideaToggle').style.opacity = UI.showIdeas ? 1 : .45;
  $('#maplegend').textContent = ctx.map?.kind === 'schematic' ? 'Schematic map · use 🧭 Directions to navigate' : '';
  $('#maplegend').style.display = ctx.map?.kind === 'schematic' ? '' : 'none';
}
function startPick(cb) {
  UI.picking = true;
  if (UI.mobile) { UI.prevView = UI.view; UI.view = 'map'; }
  renderAll(); ctx.map?.resize();
  ctx.map?.startPick(ll => { endPick(); cb(ll); });
  toast('Tap the map');
}
function endPick() {
  UI.picking = false; ctx.map?.cancelPick();
  if (UI.mobile && UI.prevView) { UI.view = UI.prevView; UI.prevView = null; }
  renderAll();
}

/* ================= trips ================= */
export async function openTrip(t) {
  ctx.trip = t;
  UI.day = 0; UI.sel = null; UI.preview = null; UI.view = 'plan'; UI.q = ''; UI.pq = '';
  UI.ideasTab = 'mine'; UI.found = null; UI.disc = { km: null, cat: 'all', limit: 30, list: null, loading: false, err: null, key: null };
  const now = tripNow(); const td = t.days.findIndex(d => d.date === now.date);
  if (td >= 0) { UI.day = td; UI.view = 'now'; }
  store.saveTrip(t);
  await loadTripPhotos(t.id);
  renderAll();
  await ensureMap(); updateMap(); renderMapChrome(); fitDay();
  refreshHours();
  checkTripTz(t);
}
export function goHome() { closeSheet(); ctx.trip = null; renderAll(); }

/* ================= helpers for actions ================= */
function addStop(di, pid, at) {
  const t = ctx.trip, day = t.days[di], place = t.places[pid];
  const idx = at === 'end' || at == null ? bestIndex(t, di, place) : Math.min(Number(at), day.stops.length);
  const st = { id: uid(), place: pid, dur: defaultDur(place), mode: 'auto' };
  day.stops.splice(idx, 0, st);
  UI.day = di; UI.sel = st.id;
  return st;
}
function readDraftInto(p) {
  document.querySelectorAll('[data-draft]').forEach(el => {
    const k = el.dataset.draft, v = el.value;
    if (k === 'coords') { const c = parseCoords(v); if (c) { p.lat = c.lat; p.lng = c.lng; } return; }
    if (v === '') delete p[k]; else p[k] = v;
  });
  return p;
}
/* ---------- finding places online ---------- */
const OFFLINE_HINT_SANDBOX = 'needs an internet connection (it doesn’t work inside the claude.ai preview — open the hosted app).';
const offlineHint = () => pwa.online ? OFFLINE_HINT_SANDBOX : 'needs an internet connection — you’re offline right now. Your plan still works.';
const tripCenter = () => ctx.trip?.center ? { lat: ctx.trip.center[0], lng: ctx.trip.center[1] } : null;
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''));

let searchTimer = null;
/** Debounced map search for the box that's open (Ideas / add-to-day picker / hotel chooser). */
function queueSearch(q) {
  clearTimeout(searchTimer);
  q = (q || '').trim();
  if (q.length < 2) { UI.found = null; return; }
  UI.found = { q, list: UI.found?.list || [], loading: true };
  searchTimer = setTimeout(async () => {
    let next;
    try { next = { q, list: await net.searchPlaces(q, tripCenter()), loading: false }; }
    catch (e) { next = { q, list: [], loading: false, err: 'Search ' + offlineHint() }; }
    if (UI.found?.q !== q) return; // typed on meanwhile
    UI.found = next;
    // Only swap the results box, so the search input (and the phone keyboard) stays put.
    const box = $('#foundBox');
    if (box) box.outerHTML = foundHtml(UI.foundCtx || {});
  }, 350);
}

/* ---------- opening hours: look up on OpenStreetMap, retry later if that fails ---------- */
const NO_HOURS_CATS = new Set(['hotel', 'transport']);
const RETRY_AFTER_MIN = [0, 10, 60, 360, 1440]; // wait after the 1st, 2nd, … failed lookup
const MAX_TRIES = 6;
UI.hoursBusy = new Set();

/** Should we (still) try to find opening hours for this place? */
function wantsHours(p, force) {
  if (!p || p.lat == null || p.hoursText || NO_HOURS_CATS.has(p.cat)) return false;
  const f = p.hoursFetch;
  if (!f || force) return true;
  if (f.done) return false; // OSM has no hours for it, or no matching place: don't keep asking
  return f.n < MAX_TRIES && Date.now() - f.t > RETRY_AFTER_MIN[Math.min(f.n, RETRY_AFTER_MIN.length - 1)] * 60000;
}

/**
 * Look up opening hours (+ website and Wikipedia text) on OpenStreetMap. Finds the place on OSM
 * first if needed. Returns 'found' | 'none' | 'nomatch' | 'failed' | 'skip'.
 */
async function lookupHours(p, { force = false } = {}) {
  if (!wantsHours(p, force) || UI.hoursBusy.has(p.id)) return 'skip';
  UI.hoursBusy.add(p.id);
  const miss = done => { p.hoursFetch = { n: (p.hoursFetch?.n || 0) + 1, t: Date.now(), ...(done ? { done } : {}) }; return done || 'failed'; };
  try {
    if (!p.osm) {
      const hits = await net.searchPlaces(p.name, p);
      const m = hits.find(h => h.osm && Math.abs(h.lat - p.lat) < 0.004 && Math.abs(h.lng - p.lng) < 0.006);
      if (!m) return miss('nomatch');
      p.osm = m.osm;
      if (m.addr && !p.addr) p.addr = m.addr;
    }
    const tags = await net.osmTags(p.osm);
    if (!p.url && (tags.website || tags['contact:website'])) p.url = tags.website || tags['contact:website'];
    const wp = (tags.wikipedia || '').match(/^([a-z-]+):(.+)$/);
    if (wp && !p.desc) {
      p.wiki = `https://${wp[1]}.wikipedia.org/wiki/${encodeURIComponent(wp[2].replace(/ /g, '_'))}`;
      const sum = await net.wikiSummary(p.wiki);
      if (sum?.extract) p.desc = sum.extract;
    }
    if (!tags.opening_hours) return miss('none');
    p.oh = tags.opening_hours;                 // raw, so seasonal rules can follow the trip's dates
    p.hoursText = prettyHours(tags.opening_hours);
    const h = parseOpeningHours(tags.opening_hours);
    if (h) p.hours = h; else delete p.hours;
    p.hoursSrc = 'osm';
    delete p.hoursFetch;
    return 'found';
  } catch (e) {
    return miss();
  } finally {
    UI.hoursBusy.delete(p.id);
    commit();
  }
}

let sweeping = false;
/** Background: find missing opening hours, planned stops first, a few places per round. */
async function refreshHours() {
  const t = ctx.trip;
  if (!t || sweeping || !pwa.online) return;
  sweeping = true;
  try {
    const planned = scheduledIds(t);
    const todo = Object.values(t.places).filter(p => wantsHours(p)).sort((a, b) => planned.has(b.id) - planned.has(a.id)).slice(0, 8);
    for (const p of todo) { if (ctx.trip !== t) break; await lookupHours(p); }
  } finally { sweeping = false; }
}

/** Hours typed in the place form: understood ones give warnings too; they replace OSM hours. */
function applyTypedHours(p, before) {
  if ((p.hoursText || '') === (before || '')) return;
  delete p.oh; delete p.hoursFetch;
  if (p.hoursText) {
    const h = parseTypedHours(p.hoursText);
    if (h) p.hours = h; else delete p.hours;
    p.hoursSrc = 'you';
  } else { delete p.hours; delete p.hoursSrc; }
}
/** Turn a search result into a trip place (or reuse the one you already have). */
function placeFromFound(d) {
  const t = ctx.trip, have = findExisting(t, d);
  if (have) return have;
  const { kind, ...rest } = d;
  const p = clean({ ...rest, id: 'p' + uid() });
  t.places[p.id] = p;
  if (!t.center) t.center = [p.lat, p.lng];
  lookupHours(p);
  return p;
}
/** Turn a Discover sight into a trip place; fetch its Wikipedia text and opening hours in the background. */
function placeFromSight(s) {
  const t = ctx.trip, have = findExisting(t, s);
  if (have) return have;
  const p = clean({ ...sightToPlace(s, t.destination), id: 'p' + uid() });
  t.places[p.id] = p;
  (async () => {
    const sum = UI.sum[s.wd] || (s.wiki ? await net.wikiSummary(s.wiki) : null);
    if (sum?.extract) p.desc = sum.extract;
    if (sum?.thumb) p.img = sum.thumb; // direct link: faster, and can be kept offline
    commit();
    lookupHours(p); // finds it on OpenStreetMap for opening hours
  })();
  return p;
}

async function locateTrip(t) {
  if (!t.destination) return false;
  const c = await net.findCity(t.destination).catch(() => null);
  if (!c) return false;
  t.center = [c.lat, c.lng];
  t.discKm = c.km <= 3 ? 3 : c.km <= 10 ? 8 : 20;
  if (!t.mapsSuffix) t.mapsSuffix = ', ' + c.label;
  applyCityTz(t, c);
  save();
  return true;
}
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return null; } };
/**
 * New trips get this phone's time zone. Once we know the destination's country, switch to its zone —
 * unless the trip's zone was chosen by hand (it differs from the phone's, or was typed in settings).
 */
function applyCityTz(t, c) {
  if (t.tzChecked || !c) return;
  t.tzChecked = true;
  const tz = tzForCountry(c.countrycode, c.lng);
  if (!tz || tz === t.tz || t.tz !== deviceTz()) return;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch (e) { return; }
  t.tz = tz;
  toast(`Times now follow ${tz.split('/').pop().replace(/_/g, ' ')} time (${tz})`);
}
/** Trips made before the time-zone check: look the destination up once (in the background). */
async function checkTripTz(t) {
  if (t.tzChecked || !t.destination || !pwa.online) return;
  const c = await net.findCity(t.destination).catch(() => null);
  if (!c || ctx.trip !== t || t.tzChecked) return;
  const before = t.tz;
  applyCityTz(t, c);
  save();
  if (t.tz !== before) renderAll();
}
async function loadDiscover(force) {
  const t = ctx.trip, D = UI.disc;
  if (!t.center && t.destination) { D.loading = true; renderAll(); await locateTrip(t); D.loading = false; }
  if (!t.center) { renderAll(); return; }
  if (D.km == null) D.km = [3, 8, 20].includes(t.discKm) ? t.discKm : 8;
  const key = t.id + '|' + t.center.join(',') + '|' + D.km;
  if (!force && D.key === key && (D.list || D.loading)) return renderAll();
  Object.assign(D, { key, loading: true, err: null, list: null, limit: 30 });
  renderAll();
  try {
    const list = await net.topSights({ lat: t.center[0], lng: t.center[1] }, D.km);
    if (D.key !== key) return;
    D.list = list;
    if (!list.length) D.err = 'No famous places found here — try a wider area.';
  } catch (e) {
    if (D.key !== key) return;
    D.err = 'Discover ' + offlineHint();
  }
  D.loading = false;
  renderAll();
}
function openSight(wd) {
  openSheet('sight', wd);
  const s = UI.disc.list?.find(x => x.wd === wd);
  if (s?.wiki && UI.sum[wd] === undefined) net.wikiSummary(s.wiki).then(sum => { UI.sum[wd] = sum; if (UI.sheet?.type === 'sight') refreshSheet(); });
}
function goDiscover() { closeSheet(); UI.view = 'ideas'; UI.ideasTab = 'discover'; loadDiscover(); if (UI.mobile) $('#panel').scrollTop = 0; }

/* ---------- hotels, arrival, departure ---------- */
function assignSlot(pid) {
  const t = ctx.trip, { slot, i } = UI.sheet?.args || {};
  if (slot === 'arrive') t.arrive = { time: t.days[0]?.start, ...t.arrive, place: pid };
  else if (slot === 'depart') t.depart = { time: '', ...t.depart, place: pid };
  else if (slot === 'stay') {
    t.stays ||= [];
    if (i != null && t.stays[i]) t.stays[i].place = pid;
    else {
      const first = t.days[0].date, last = t.days[t.days.length - 1].date;
      t.stays.push({ id: uid(), place: pid, from: first, to: last > first ? last : isoAddDays(first, 1) });
    }
  }
  UI.pq = ''; UI.found = null;
  commit(); openSheet('stays');
  toast('Saved — your days now start and end there');
}

/* ---------- share links ---------- */
async function openShare() {
  UI.shareLink = null;
  openSheet('share');
  try {
    const code = await encodeTrip(ctx.trip); // the in-memory trip, so unsaved edits are included
    UI.shareLink = { url: shareUrl(location.href, code) };
  } catch (e) {
    console.error(e);
    UI.shareLink = { err: 'Couldn’t make a link in this browser. Use ⋯ → Backup instead.' };
  }
  if (UI.sheet?.type === 'share') refreshSheet();
}
async function copyText(text, input) {
  try { await navigator.clipboard.writeText(text); toast('Link copied'); return true; }
  catch (e) { if (input) { input.focus(); input.select(); } toast('Select the link and copy it'); return false; }
}
/** A '#t=…' link was opened: decode it and ask what to do. Clears the hash so a reload doesn't ask again. */
async function checkShareHash() {
  const code = codeFromHash(location.hash);
  if (!code) return;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* sandbox */ }
  try {
    UI.incoming = await decodeTrip(code);
    openSheet('incoming');
  } catch (e) {
    console.error(e);
    toast('This trip link is broken or incomplete — ask for a new one');
  }
}

/* ---------- running late ---------- */
/** Open the helper for day di. live: only change what's still ahead (from the Now screen). */
function openRescue(di, live) {
  const args = { di };
  if (live) {
    const now = tripNow(), rows = computeDay(ctx.trip, di);
    const cur = rows.findIndex(r => now.min < r.end && r.st.virtual !== 'start');
    args.from = Math.max(0, cur);
    args.minDay = di;
    const r = rows[cur];
    if (r && now.min >= r.arr) args.keep = { [r.st.id]: now.min - r.arr + 10 }; // time already spent + a bit
  }
  UI.rescueDone = null;
  openSheet('rescue', args);
}

/* ---------- near me ---------- */
/** Where you are according to the plan: the stop you're at / heading to today, else the city centre. */
function planSpot() {
  const t = ctx.trip, now = tripNow(), di = t.days.findIndex(d => d.date === now.date);
  if (di >= 0) {
    const rows = computeDay(t, di), r = rows.find(x => now.min < x.end) || rows[rows.length - 1];
    if (r) return { lat: r.place.lat, lng: r.place.lng, label: r.place.name, source: 'plan' };
  }
  return t.center ? { lat: t.center[0], lng: t.center[1], label: 'the city centre', source: 'plan' } : null;
}
function openNear() {
  const now = tripNow();
  UI.near = { status: 'locating', km: UI.near?.km || 1, date: now.date, min: now.min, planSpot: planSpot(), sights: null };
  openSheet('nearby');
  locate();
}
function locate() {
  const N = UI.near; if (!N) return;
  const fallback = msg => {
    N.err = msg; N.status = 'ready'; N.here = N.planSpot;
    refreshSheet(); if (N.here) loadNearSights();
  };
  N.status = 'locating'; N.err = null; refreshSheet();
  if (!navigator.geolocation) return fallback('Location isn’t available here — showing what’s near ' + (N.planSpot?.label || 'your plan') + '.');
  try {
    navigator.geolocation.getCurrentPosition(pos => {
      if (UI.near !== N) return;
      N.here = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, source: 'gps' };
      N.status = 'ready'; refreshSheet(); updateMap(); loadNearSights();
    }, err => {
      if (UI.near !== N) return;
      fallback(err.code === 1
        ? 'Location is off for this site. Allow it in Chrome (tap 🔒 next to the address → Permissions), or use your plan: showing what’s near ' + (N.planSpot?.label || 'it') + '.'
        : 'Couldn’t find your location — showing what’s near ' + (N.planSpot?.label || 'your plan') + '.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  } catch (e) { fallback('Location isn’t available here — showing what’s near ' + (N.planSpot?.label || 'your plan') + '.'); }
}
async function loadNearSights() {
  const N = UI.near; if (!N?.here) return;
  N.loadingSights = true; N.sightsErr = null; refreshSheet();
  try { N.sights = await net.topSights(roughly(N.here), Math.max(1, N.km), { minLinks: 3 }); }
  catch (e) { N.sights = []; N.sightsErr = 'Sights nearby ' + offlineHint(); }
  if (UI.near !== N) return;
  N.loadingSights = false; refreshSheet();
}

/* ---------- real walking times (background) ---------- */
let routeTimer = null, routeBusy = false, routePauseUntil = 0;
/** After changes settle, fetch walking routes for days that have new walks. Cheap when nothing is missing. */
function queueRoutes() {
  clearTimeout(routeTimer);
  routeTimer = setTimeout(fetchRoutes, 1500);
}
async function fetchRoutes() {
  const t = ctx.trip;
  if (!t || routeBusy || !pwa.online || !routingOn() || Date.now() < routePauseUntil) return;
  const reqs = routeRequests(t);
  if (!reqs.length) return;
  routeBusy = true;
  try {
    reqs.sort((a, b) => (b.di === UI.day) - (a.di === UI.day)); // the day you're looking at first
    for (const r of reqs.slice(0, 6)) {
      if (ctx.trip !== t) break;
      storeLegs(t, r.points, await net.walkRoute(r.points));
      await new Promise(res => setTimeout(res, 1100)); // routing server: max one request per second
    }
    pruneRoutes(t);
    // Background data, not an edit: save without touching editedAt.
    store.saveTrip(t);
    if (ctx.trip === t) { renderAll(); refreshSheet(); }
  } catch (e) {
    routePauseUntil = Date.now() + 10 * 60000; // service down / offline: try again in 10 min
  } finally { routeBusy = false; }
}

const stopOf = id => findStop(ctx.trip, id);
const rowOf = id => { const f = stopOf(id); return f && computeDay(ctx.trip, f.di).find(x => x.st.id === id); };
function confirmTap(el, label) { if (el.dataset.sure === '1') return true; el.dataset.sure = '1'; el.textContent = label; return false; }
async function loadTemplateTrip(path) {
  try { const t = await store.loadTemplate(path); await openTrip(t); }
  catch (e) { toast('Couldn’t load that plan'); }
}
/** Pasted text: a share link (or a message containing one) opens the "shared trip" sheet; anything else is read as a backup. */
async function importText(text) {
  const code = codeFromText(text);
  if (code) {
    try { UI.incoming = await decodeTrip(code); openSheet('incoming'); }
    catch (e) { toast('This trip link is broken or incomplete — copy the whole link, or ask for a new one'); }
    return;
  }
  try { const t = store.importTrip(text); closeSheet(); openTrip(t); toast('Trip loaded'); }
  catch (e) { toast('That doesn’t look like a trip or a trip link'); }
}

/* ================= actions ================= */
const A = {
  'close-sheet': () => closeSheet(),
  menu: () => openSheet('menu'),
  home: () => goHome(),
  'open-trip': el => { const t = store.loadTrip(el.dataset.id); if (t) openTrip(t); else toast('Trip not found'); },
  'load-template': el => loadTemplateTrip(el.dataset.path),
  'create-trip': () => {
    const v = k => document.querySelector(`[data-new=${k}]`)?.value.trim();
    if (!v('start')) return toast('Pick a first day');
    const t = store.newTrip({ title: v('title'), destination: v('destination'), start: v('start'), days: +v('days') || 1, tz: v('tz') || undefined });
    openTrip(t).then(async () => {
      UI.view = 'ideas'; UI.ideasTab = 'discover';
      toast('Trip created — here’s what there is to see');
      await loadDiscover();
      if (t.center) { ctx.map?.centerOn({ lat: t.center[0], lng: t.center[1] }); }
    });
  },
  'import-file': () => $('#importFile').click(),
  'import-paste': () => openSheet('paste'),
  'import-text': () => importText($('#importText').value),
  day: el => { UI.day = +el.dataset.i; UI.sel = null; renderAll(); fitDay(); },
  'add-day': () => { const t = ctx.trip, last = t.days[t.days.length - 1]; t.days.push({ id: uid(), date: last ? isoAddDays(last.date, 1) : new Date().toISOString().slice(0, 10), start: '09:30', stops: [] }); UI.day = t.days.length - 1; closeSheet(); commit(); },
  'remove-day': el => { const t = ctx.trip, di = +el.dataset.di; if (t.days.length <= 1) return toast('Keep at least one day'); if (t.days[di].stops.length && !confirmTap(el, 'Tap again to delete')) return; t.days.splice(di, 1); UI.day = 0; closeSheet(); commit(); },
  'edit-day': () => openSheet('day', UI.day),
  'open-stop': el => {
    if (isEndpoint(el.dataset.id)) { const r = rowOf(el.dataset.id); if (r) openSheet('place', r.place.id); return; }
    UI.sel = el.dataset.id; const f = stopOf(el.dataset.id); if (f) UI.day = f.di; renderAll(); openSheet('stop', el.dataset.id);
  },
  'open-place': el => openSheet('place', el.dataset.id),
  'edit-travel': el => openSheet('travel', el.dataset.id),
  dur: el => { const s = stopOf(el.dataset.id).st; s.dur = Math.max(0, (s.dur || 0) + +el.dataset.n); commit(); },
  move: el => { const f = stopOf(el.dataset.id), arr = ctx.trip.days[f.di].stops, j = f.i + +el.dataset.n; if (j < 0 || j >= arr.length) return; arr.splice(j, 0, arr.splice(f.i, 1)[0]); commit(); },
  'move-day': el => { const t = ctx.trip, f = stopOf(el.dataset.id), [s] = t.days[f.di].stops.splice(f.i, 1), di = +el.dataset.di; t.days[di].stops.splice(bestIndex(t, di, t.places[s.place]), 0, s); UI.day = di; commit(); toast('Moved to ' + dayShort(t.days[di])); },
  'remove-stop': el => { const f = stopOf(el.dataset.id); ctx.trip.days[f.di].stops.splice(f.i, 1); closeSheet(); commit(); toast('Removed — it’s in Ideas'); },
  tmode: el => { const s = stopOf(el.dataset.id).st; s.mode = el.dataset.m; s.min = null; commit(); },
  tmin: el => { const s = stopOf(el.dataset.id).st, r = rowOf(el.dataset.id); s.min = Math.max(0, r.tr.min + +el.dataset.n); if (!s.mode || s.mode === 'auto') s.mode = r.tr.mode; commit(); },
  'tmin-reset': el => { stopOf(el.dataset.id).st.min = null; commit(); },
  'quick-add': el => { const di = +el.dataset.di, st = addStop(di, el.dataset.id, 'end'); commit(); toast(`Added to ${dayShort(ctx.trip.days[di])} as stop ${ctx.trip.days[di].stops.indexOf(st) + 1}`); },
  'add-to-day': el => { UI.pq = ''; UI.found = null; openSheet('picker', { di: UI.day, at: el.dataset.at }); },
  'pick-add': el => { const { di, at } = UI.sheet.args; addStop(di, el.dataset.id, at); closeSheet(); commit(); toast('Added'); },
  'new-place': el => { UI.draft = null; UI.afterCreate = el.dataset.di != null ? { di: +el.dataset.di, at: el.dataset.at } : null; openSheet('editPlace', {}); },
  'edit-place': el => { UI.draft = null; openSheet('editPlace', { id: el.dataset.id }); },
  'pick-loc': () => {
    const args = UI.sheet.args, tgt = args.id ? ctx.trip.places[args.id] : (UI.draft ||= {});
    readDraftInto(tgt); hideSheetTemporarily(true);
    startPick(ll => { tgt.lat = ll.lat; tgt.lng = ll.lng; if (args.id) save(); hideSheetTemporarily(false); refreshSheet(); });
  },
  'cancel-pick': () => { endPick(); hideSheetTemporarily(!UI.sheet); },
  'save-place': el => {
    const t = ctx.trip, args = UI.sheet.args;
    if (args.id) { const p = t.places[args.id], before = p.hoursText; readDraftInto(p); applyTypedHours(p, before); UI.draft = null; closeSheet(); commit(); lookupHours(p); return toast('Saved'); }
    const d = readDraftInto(UI.draft || {});
    applyTypedHours(d, undefined);
    if (!d.name?.trim()) return toast('Give it a name');
    if (d.lat == null) return toast('Set a location (tap map or paste coordinates)');
    const p = { cat: 'sight', ...d, id: 'p' + uid(), name: d.name.trim() };
    t.places[p.id] = p; UI.draft = null;
    if (!t.center) t.center = [p.lat, p.lng];
    const target = el.dataset.di != null ? { di: +el.dataset.di, at: 'end' } : UI.afterCreate;
    if (target) addStop(target.di, p.id, target.at);
    const firstPlaces = Object.keys(t.places).length <= 2;
    closeSheet(); commit(); if (firstPlaces) fitDay();
    toast(target ? 'Created and added' : 'Created — find it in Ideas');
  },
  'delete-place': el => { if (!confirmTap(el, 'Tap again to delete')) return; const t = ctx.trip, id = el.dataset.id; t.days.forEach(d => d.stops = d.stops.filter(s => s.place !== id)); delete t.places[id]; closeSheet(); commit(); toast('Place deleted'); },
  'show-on-map': el => { const p = ctx.trip.places[el.dataset.id]; closeSheet(); if (UI.mobile) { UI.view = 'map'; renderAll(); ctx.map?.resize(); } ctx.map?.centerOn(p, true); },
  'del-photo': el => { deletePhoto(ctx.trip.id, el.dataset.pid, el.dataset.id); renderAll(); refreshSheet(); },
  'here-now': el => { stopOf(el.dataset.id).st.fixed = fmt(tripNow().min); commit(); toast('Rest of the day shifted'); },
  extend: el => { const s = stopOf(el.dataset.id).st; s.dur = (s.dur || 0) + +el.dataset.n; commit(); toast(`+${el.dataset.n} min — later stops shifted`); },
  'leave-now': el => { const r = rowOf(el.dataset.id); r.st.dur = Math.max(0, tripNow().min - r.arr); r.st.done = true; commit(); },
  'pv-go': () => { UI.preview = { date: document.querySelector('[data-input=pv-day]').value, min: toMin(document.querySelector('[data-input=pv-time]').value) }; renderAll(); },
  'pv-off': () => { UI.preview = null; renderAll(); },
  backup: () => openSheet('backup'),
  'copy-export': async () => { const t = $('#exportText'); try { await navigator.clipboard.writeText(t.value); toast('Copied'); } catch (_) { t.focus(); t.select(); toast('Select all + copy'); } },
  'download-export': () => {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([store.exportTrip(ctx.trip)], { type: 'application/json' }));
      a.download = (ctx.trip.title || 'trip').replace(/[^\w-]+/g, '-').toLowerCase() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast('Download blocked here — use Copy'); }
  },
  'reset-trip': async el => { if (!confirmTap(el, 'Tap again — replaces your changes')) return; let t; try { t = await store.loadTemplate(ctx.trip.templatePath); } catch (e) { return toast('The original plan isn’t available anymore'); } t.id = ctx.trip.id; closeSheet(); await openTrip(t); toast('Original plan restored'); },
  'delete-trip': el => { if (!confirmTap(el, 'Tap again to delete this trip')) return; store.deleteTrip(ctx.trip.id); goHome(); toast('Trip deleted'); },
  install: async () => { const ok = await promptInstall(); if (ok) toast('Installing — find “Trips” on your home screen'); },
  'hours-lookup': async el => {
    const p = ctx.trip.places[el.dataset.id]; if (!p) return;
    const run = lookupHours(p, { force: true });
    refreshSheet();
    const r = await run;
    toast({ found: 'Opening hours found', none: 'OpenStreetMap has no hours for this place', nomatch: 'Couldn’t find this place on OpenStreetMap', failed: pwa.online ? 'Lookup failed — will try again later' : 'You’re offline — will try again later' }[r] || '');
  },
  rescue: el => openRescue(el.dataset.di != null ? +el.dataset.di : UI.day, false),
  'rescue-live': el => openRescue(+el.dataset.di, true),
  'rescue-apply': el => {
    const args = UI.sheet?.args; if (!args) return;
    const res = suggestFixes(ctx.trip, args.di, rescueOpts(args));
    const o = res?.options[+el.dataset.i]; if (!o) return;
    const before = JSON.parse(JSON.stringify(ctx.trip.days));
    applyOps(ctx.trip, o.ops);
    UI.rescueDone = { msg: o.label + (o.full ? ' — you’re on time now.' : '.'), undo: before };
    UI.sel = null;
    commit();
    toast(o.full ? 'Fixed — you’re on time' : 'That helps');
  },
  'rescue-undo': () => {
    if (!UI.rescueDone) return;
    ctx.trip.days = UI.rescueDone.undo;
    UI.rescueDone = null;
    commit(); toast('Undone');
  },
  optimise: () => {
    const di = UI.day;
    UI.opt = { di, r: optimiseDay(ctx.trip, di) };
    UI.optDone = null;
    openSheet('optimise', { di });
  },
  'optimise-apply': () => {
    const O = UI.opt; if (!O?.r?.changed) return;
    const before = JSON.parse(JSON.stringify(ctx.trip.days[O.di].stops));
    applyOrder(ctx.trip, O.di, O.r.order);
    const saved = O.r.before.travel - O.r.after.travel;
    UI.optDone = { di: O.di, undo: before, msg: saved > 0 ? saved + ' min less travel.' : 'better timing.' };
    UI.sel = null;
    commit(); fitDay();
    toast('New order saved');
  },
  'optimise-undo': () => {
    const D = UI.optDone; if (!D) return;
    ctx.trip.days[D.di].stops = D.undo;
    UI.optDone = null;
    UI.opt = { di: D.di, r: optimiseDay(ctx.trip, D.di) };
    commit(); toast('Undone');
  },
  autoplan: () => {
    // During the trip, don't plan into days that are already over.
    const today = ctx.trip.days.findIndex(d => d.date === tripNow().date);
    const pace = UI.ap?.pace || 'normal', minDay = Math.max(0, today);
    UI.ap = { pace, minDay, res: autoPlan(ctx.trip, { pace, minDay }) };
    UI.apDone = null;
    openSheet('autoplan');
  },
  'ap-pace': el => {
    const A = UI.ap; if (!A) return;
    A.pace = el.dataset.pace;
    A.res = autoPlan(ctx.trip, { pace: A.pace, minDay: A.minDay });
    refreshSheet();
  },
  'ap-apply': () => {
    const res = UI.ap?.res; if (!res?.added.length) return;
    const before = JSON.parse(JSON.stringify(ctx.trip.days));
    ctx.trip.days = res.trip.days;
    const n = res.added.length, nd = res.days.length;
    UI.apDone = { undo: before, firstDay: res.days[0]?.di ?? 0, msg: `Added ${n} place${n === 1 ? '' : 's'} over ${nd} day${nd === 1 ? '' : 's'}.` };
    UI.sel = null;
    commit(); fitDay();
    toast('Plan made — tweak it as you like');
  },
  'ap-undo': () => {
    const D = UI.apDone; if (!D) return;
    ctx.trip.days = D.undo;
    UI.apDone = null;
    if (UI.ap) UI.ap.res = autoPlan(ctx.trip, { pace: UI.ap.pace, minDay: UI.ap.minDay });
    commit(); toast('Undone');
  },
  'ap-show': () => { const di = UI.apDone?.firstDay ?? 0; closeSheet(); UI.view = 'plan'; UI.day = di; renderAll(); fitDay(); },
  near: () => openNear(),
  'near-locate': () => locate(),
  'near-plan': () => { const N = UI.near; if (!N?.planSpot) return; N.here = N.planSpot; N.err = null; N.status = 'ready'; refreshSheet(); loadNearSights(); },
  'near-km': el => { const N = UI.near; if (!N) return; N.km = +el.dataset.km; refreshSheet(); loadNearSights(); },
  'near-add': el => {
    const N = UI.near, t = ctx.trip; if (!N) return;
    let p;
    if (el.dataset.kind === 'idea') p = t.places[el.dataset.id];
    else { const s = N.sights?.find(x => x.wd === el.dataset.wd); if (s) p = placeFromSight(s); }
    if (!p) return;
    const today = t.days.findIndex(d => d.date === N.date);
    const di = today >= 0 ? today : UI.day;
    addStop(di, p.id, today >= 0 ? nextIndex(t, di, N.min) : 'end');
    commit();
    toast(today >= 0 ? `${p.name} is your next stop` : `${p.name} added to ${dayShort(t.days[di])}`);
  },
  // share links
  share: () => openShare(),
  'share-copy': () => UI.shareLink?.url && copyText(UI.shareLink.url, $('#shareLink')),
  'share-native': async () => {
    const url = UI.shareLink?.url; if (!url) return;
    try { await navigator.share({ title: ctx.trip.title, text: 'Our trip plan: ' + ctx.trip.title, url }); }
    catch (e) { if (e?.name !== 'AbortError') copyText(url, $('#shareLink')); }
  },
  'incoming-cancel': () => { UI.incoming = null; closeSheet(); },
  'incoming-add': async el => {
    const t = UI.incoming; if (!t) return;
    const mode = el.dataset.mode;
    if (mode === 'copy') { t.id = 'trip-' + uid(); t.title += ' (shared)'; }
    UI.incoming = null; closeSheet();
    if (!store.saveTrip(t)) return toast('This browser won’t save trips — try another browser');
    await openTrip(t);
    toast(mode === 'replace' ? 'Your copy is updated' : 'Trip added');
  },
  // hotels & travel
  stays: () => { UI.pq = ''; UI.found = null; openSheet('stays'); },
  'hide-setup': () => { ctx.trip.hideSetup = true; commit(); },
  'choose-open': el => { UI.pq = ''; UI.found = null; openSheet('choose', { slot: el.dataset.slot, i: el.dataset.i != null ? +el.dataset.i : null }); },
  'choose-place': el => assignSlot(el.dataset.id),
  'found-choose': el => { const d = UI.found?.list?.[+el.dataset.idx]; if (d) assignSlot(placeFromFound(d).id); },
  'clear-slot': el => { delete ctx.trip[el.dataset.slot]; commit(); },
  'remove-stay': el => { ctx.trip.stays.splice(+el.dataset.i, 1); commit(); },
  // search results & discover
  'found-add': el => {
    const d = UI.found?.list?.[+el.dataset.idx]; if (!d) return;
    const p = placeFromFound(d), di = el.dataset.di != null ? +el.dataset.di : null;
    if (di != null) {
      const at = UI.sheet?.type === 'picker' ? UI.sheet.args.at : 'end';
      addStop(di, p.id, at);
      if (UI.sheet?.type === 'picker') closeSheet();
      commit(); toast(`${p.name} added to ${dayShort(ctx.trip.days[di])}`);
    } else { commit(); toast(`${p.name} saved to your places`); }
  },
  'go-discover': () => goDiscover(),
  'ideas-tab': el => { UI.ideasTab = el.dataset.t; if (UI.ideasTab === 'discover') loadDiscover(); else renderAll(); },
  'disc-km': el => { UI.disc.km = +el.dataset.km; ctx.trip.discKm = UI.disc.km; save(); loadDiscover(); },
  'disc-cat': el => { UI.disc.cat = el.dataset.cat; UI.disc.limit = 30; renderAll(); },
  'disc-more': () => { UI.disc.limit += 30; renderAll(); },
  'disc-retry': () => loadDiscover(true),
  'open-sight': el => openSight(el.dataset.wd),
  'sight-add': el => {
    const s = UI.disc.list?.find(x => x.wd === el.dataset.wd); if (!s) return;
    const p = placeFromSight(s), di = el.dataset.di != null ? +el.dataset.di : null;
    if (di != null) addStop(di, p.id, 'end');
    if (UI.sheet?.type === 'sight') closeSheet();
    commit();
    toast(di != null ? `${s.name} added to ${dayShort(ctx.trip.days[di])}` : `${s.name} saved to your places`);
  },
  'show-sight': el => {
    const s = UI.disc.list?.find(x => x.wd === el.dataset.wd); if (!s) return;
    closeSheet(); if (UI.mobile) { UI.view = 'map'; renderAll(); ctx.map?.resize(); }
    ctx.map?.centerOn(s, true);
  },
  zin: () => ctx.map?.zoom(1.6),
  zout: () => ctx.map?.zoom(1 / 1.6),
  fit: () => fitDay(),
  'toggle-ideas': () => { UI.showIdeas = !UI.showIdeas; renderMapChrome(); updateMap(); toast(UI.showIdeas ? 'Showing ideas on map' : 'Hiding ideas'); }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act],[data-view]'); if (!el) return;
  if (el.dataset.view) {
    UI.view = el.dataset.view; renderAll();
    if (UI.view === 'map') { ctx.map?.resize(); fitDay(); }
    return;
  }
  if (e.target.closest('.handle')) return; // drag handle, not a tap on the card
  const fn = A[el.dataset.act];
  if (fn) fn(el, e);
});

/* ================= form inputs ================= */
/** Trip settings → First / Last day. */
function setDates(start, end) {
  const t = ctx.trip, r = store.setTripDates(t, start, end);
  if (!r.ok) { toast(r.error); refreshSheet(); return; }
  UI.day = Math.min(UI.day || 0, t.days.length - 1); UI.preview = null;
  const n = Math.abs(r.shift);
  const parts = [r.shift ? `Trip moved ${n} day${n === 1 ? '' : 's'} ${r.shift > 0 ? 'later' : 'earlier'}` : '',
    r.added ? `${r.added} day${r.added === 1 ? '' : 's'} added` : '', r.removed ? `${r.removed} empty day${r.removed === 1 ? '' : 's'} removed` : ''].filter(Boolean);
  if (parts.length) toast(parts.join(' · ') + (r.shift % 7 ? ' — check opening hours' : ''));
  commit();
}
const INPUTS = {
  dur: el => { stopOf(el.dataset.id).st.dur = Math.max(0, +el.value || 0); commit(); },
  fixed: el => { stopOf(el.dataset.id).st.fixed = el.value || null; commit(); },
  note: el => { stopOf(el.dataset.id).st.note = el.value; save(); renderAll(); },
  done: el => { stopOf(el.dataset.id).st.done = el.checked; commit(); },
  must: el => { const s = stopOf(el.dataset.id).st; if (el.checked) s.must = true; else delete s.must; commit(); },
  tmin: el => { const s = stopOf(el.dataset.id).st, r = rowOf(el.dataset.id); s.min = Math.max(0, +el.value || 0); if (!s.mode || s.mode === 'auto') s.mode = r.tr.mode; commit(); },
  'day-start': el => { if (el.value) { const t = ctx.trip, di = +el.dataset.di; t.days[di].start = el.value; if (di === 0 && t.arrive) t.arrive.time = el.value; commit(); } },
  'arrive-time': el => { if (!el.value) return; const t = ctx.trip; t.arrive = { ...t.arrive, time: el.value }; t.days[0].start = el.value; commit(); },
  'depart-time': el => { const t = ctx.trip; t.depart = { ...t.depart, time: el.value || '' }; commit(); },
  'stay-from': el => { const st = ctx.trip.stays[+el.dataset.i]; st.from = el.value; if (st.to <= st.from) st.to = isoAddDays(st.from, 1); commit(); },
  'stay-to': el => { const st = ctx.trip.stays[+el.dataset.i]; st.to = el.value; if (st.to <= st.from) st.from = isoAddDays(st.to, -1); commit(); },
  'day-date': el => { if (el.value) { ctx.trip.days[+el.dataset.di].date = el.value; commit(); } },
  'day-sunset': el => { ctx.trip.days[+el.dataset.di].sunset = el.value || undefined; commit(); },
  'trip-start': el => setDates(el.value, null),
  'trip-end': el => setDates(ctx.trip.days[0].date, el.value),
  'trip-title': el => { ctx.trip.title = el.value || 'My trip'; commit(); },
  'trip-dest': el => { ctx.trip.destination = el.value; commit(); },
  'trip-tz': el => { try { new Intl.DateTimeFormat('en', { timeZone: el.value }); ctx.trip.tz = el.value; ctx.trip.tzChecked = true; commit(); } catch (e) { toast('Unknown time zone'); } },
  'trip-suffix': el => { ctx.trip.mapsSuffix = el.value; commit(); },
  routing: el => { ls.set('tp.routing', el.value); routePauseUntil = 0; if (el.value === 'on') queueRoutes(); toast(el.value === 'on' ? 'Real walking routes on' : 'Walking times are estimates now'); },
  'map-mode': async el => { setMapPref(el.value); ctx.map?.destroy(); ctx.map = null; await ensureMap(); renderAll(); fitDay(); refreshSheet(); }
};
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.upload) {
    const ok = await addPhotos(ctx.trip.id, el.dataset.upload, [...el.files]); el.value = '';
    if (!ok) toast('Photo shown, but this browser won’t keep it');
    renderAll(); refreshSheet(); return;
  }
  INPUTS[el.dataset.input]?.(el);
});
document.addEventListener('input', e => {
  const k = e.target.dataset.input;
  if (k !== 'q' && k !== 'pq') return;
  UI[k] = e.target.value; const pos = e.target.selectionStart;
  queueSearch(e.target.value);
  if (k === 'q') renderAll(); else refreshSheet();
  const n = document.querySelector(`[data-input=${k}]`); n.focus(); n.setSelectionRange(pos, pos);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (UI.picking) endPick(); else closeSheet(); } });
$('#importFile').addEventListener('change', async e => { const f = e.target.files[0]; if (f) importText(await f.text()); e.target.value = ''; });

/* ================= drag to reorder ================= */
let DRAG = null;
document.addEventListener('pointerdown', e => {
  const h = e.target.closest('.handle'); if (!h) return;
  e.preventDefault();
  const row = h.closest('.row'), tl = $('#tl'); if (!row || !tl) return;
  const rows = [...tl.querySelectorAll('.row')];
  DRAG = { row, rows, y0: e.clientY, from: rows.indexOf(row), to: rows.indexOf(row), mids: rows.map(r => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; }) };
  row.querySelector('.stop').classList.add('dragging'); row.style.position = 'relative'; row.style.zIndex = 20;
  h.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove', e => {
  if (!DRAG) return;
  const dy = e.clientY - DRAG.y0; DRAG.row.style.transform = `translateY(${dy}px)`;
  const y = DRAG.mids[DRAG.from] + dy;
  const to = Math.max(0, Math.min(DRAG.rows.length - 1, DRAG.mids.filter((m, i) => i !== DRAG.from && m < y).length));
  DRAG.to = to;
  const h = DRAG.row.getBoundingClientRect().height + 34;
  DRAG.rows.forEach((r, i) => {
    if (r === DRAG.row) return;
    let s = 0;
    if (DRAG.from < to && i > DRAG.from && i <= to) s = -h;
    if (DRAG.from > to && i >= to && i < DRAG.from) s = h;
    r.style.transition = 'transform .12s'; r.style.transform = s ? `translateY(${s}px)` : '';
  });
  const p = $('#panel'), b = p.getBoundingClientRect();
  if (e.clientY < b.top + 60) p.scrollTop -= 8; else if (e.clientY > b.bottom - 60) p.scrollTop += 8;
});
function endDrag() {
  if (!DRAG) return;
  const { from, to, rows } = DRAG; DRAG = null;
  if (from === to) { renderAll(); return; }
  // Work with stop ids so hidden/skipped stops can't shift the indices.
  const arr = ctx.trip.days[UI.day].stops;
  const movedId = rows[from].dataset.stop, targetId = rows[to].dataset.stop;
  const [moved] = arr.splice(arr.findIndex(s => s.id === movedId), 1);
  const ti = arr.findIndex(s => s.id === targetId);
  arr.splice(to > from ? ti + 1 : ti, 0, moved);
  commit(); toast('Reordered — times updated');
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

/* ================= boot ================= */
export async function start() {
  shell();
  ctx.ui.canSave = ls.ok();
  initPwa(evt => {
    if (evt === 'installed') toast('Installed — open it from your home screen');
    if (evt === 'offline') toast('You’re offline — your plan still works');
    if (evt === 'online') { toast('Back online'); refreshHours(); routePauseUntil = 0; queueRoutes(); }
    renderAll(); refreshSheet();
  });
  ctx.templates = await store.listTemplates();

  // carry over the first prototype's saved plan, if any
  if (!store.listTrips().length) {
    const tpl = ctx.templates[0];
    let basemap = null;
    if (tpl) try { basemap = (await store.loadTemplate(tpl.path)).basemap; } catch (e) { /* ignore */ }
    store.migrateLegacy(basemap);
  }

  new ResizeObserver(() => {
    const was = UI.mobile; UI.mobile = !matchMedia('(min-width:900px)').matches;
    if (was !== UI.mobile && ctx.trip) renderAll();
    ctx.map?.resize();
  }).observe(document.body);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => ctx.map?.redraw());
  setInterval(() => { if (ctx.trip && UI.view === 'now' && !UI.sheet && !DRAG) renderAll(); }, 60000);

  // open the last trip, else the only trip, else home
  const trips = store.listTrips();
  const id = store.lastTripId();
  const t = (id && store.loadTrip(id)) || (trips.length === 1 ? store.loadTrip(trips[0].id) : null);
  if (t) await openTrip(t); else renderAll();
  window.addEventListener('hashchange', checkShareHash);
  await checkShareHash();
}
