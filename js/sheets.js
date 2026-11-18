// Bottom sheets (dialogs on desktop). Each builder returns HTML or '' (= close).

import { $, esc, fmt, dayLong, dayName, dayShort, isoAddDays } from './util.js';
import { CATS, MODES, cat, dayColor } from './config.js';
import { computeDay, findStop, placeUses, scheduledIds } from './schedule.js';
import { findExisting, shortName, hoursFor } from './discover.js';
import { foundHtml } from './views/ideas.js';
import { dirUrl, mapsUrl, photosUrl } from './links.js';
import { photosOf } from './photos.js';
import { exportTrip, listTrips, loadTrip } from './store.js';
import { LONG_LINK } from './share.js';
import { pwa } from './pwa.js';
import { suggestFixes } from './rescue.js';
import { PACES, unplannedIdeas } from './autoplan.js';
import { mapPref } from './map/index.js';
import { ctx } from './state.js';
import { coverBlock, thumb } from './views/components.js';

export function openSheet(type, args) {
  ctx.ui.sheet = { type, args };
  $('#sheet').classList.remove('hidden');
  refreshSheet(true);
}
export function closeSheet() {
  ctx.ui.sheet = null;
  $('#sheet').classList.add('hidden');
  $('#sheetBody').innerHTML = '';
}
export function hideSheetTemporarily(hidden) { $('#sheet').classList.toggle('hidden', hidden); }

const BUILDERS = { stop, place, editPlace, travel, picker, day, menu, backup, paste, stays, choose, sight, share, incoming, rescue, optimise, autoplan };
export function refreshSheet(scrollTop) {
  if (!ctx.ui.sheet) return;
  const { type, args } = ctx.ui.sheet;
  const card = $('.sheet-card'), st = card.scrollTop;
  let h = '';
  try { h = BUILDERS[type]?.(args) || ''; } catch (e) { console.error(e); }
  if (!h) { closeSheet(); return; }
  $('#sheetBody').innerHTML = h;
  card.scrollTop = scrollTop ? 0 : st;
}

/** The Hours line: the hours + where they came from, or ways to find them when unknown. */
function hoursRow(p) {
  const t = ctx.trip;
  if (p.hoursText) {
    const used = t.days.some(d => hoursFor(p, d.date));
    const src = p.hoursSrc === 'osm' ? 'from OpenStreetMap — check before you go' : p.hoursSrc === 'you' ? 'added by you' : '';
    const note = used ? '✓ used for warnings' : '⚠ not understood, so no warnings';
    return `<dt>Hours</dt><dd>${esc(p.hoursText)}<div class="hours-note">${[src, note].filter(Boolean).map(esc).join(' · ')}</div></dd>`;
  }
  if (['hotel', 'transport'].includes(p.cat)) return '';
  const busy = ctx.ui.hoursBusy?.has(p.id), f = p.hoursFetch;
  const status = busy ? 'Looking up…'
    : f?.done === 'none' ? 'Not listed on OpenStreetMap'
    : f?.done === 'nomatch' ? 'Couldn’t find this place on OpenStreetMap'
    : f ? 'Lookup didn’t work — will try again later'
    : 'Unknown';
  return `<dt>Hours</dt><dd><span class="muted">${status}</span>
    <div class="btns" style="margin-top:6px">
      <a class="btn small" target="_blank" rel="noopener" href="${mapsUrl(t, p)}">🕒 Check on Google Maps</a>
      ${busy ? '' : `<button class="btn small" data-act="hours-lookup" data-id="${p.id}">↻ Look up again</button>`}
      <button class="btn small" data-act="edit-place" data-id="${p.id}">✏️ Type them in</button>
    </div></dd>`;
}

function placeInfo(p, prev, mode) {
  const t = ctx.trip, ph = photosOf(t.id, p.id);
  const hrs = hoursRow(p);
  return `
    ${p.desc ? `<p style="margin:8px 0 0">${esc(p.desc)}</p>` : ''}
    ${p.tip ? `<div class="tipbox">${p.tipFrom ? `<b>★ ${esc(p.tipFrom)}:</b> ` : '💡 '}${esc(p.tip)}</div>` : ''}
    ${(hrs || p.cost || p.addr) ? `<h3>Practical</h3><dl class="kv">${p.addr ? `<dt>Address</dt><dd>${esc(p.addr)}</dd>` : ''}${hrs}${p.cost ? `<dt>Cost</dt><dd>${esc(p.cost)}</dd>` : ''}</dl>` : ''}
    <div class="btns" style="margin-top:14px">
      <a class="btn primary" target="_blank" rel="noopener" href="${dirUrl(t, prev, p, mode)}">🧭 Directions</a>
      <a class="btn" target="_blank" rel="noopener" href="${mapsUrl(t, p)}">📍 Google Maps</a>
      <a class="btn" target="_blank" rel="noopener" href="${photosUrl(t, p)}">🖼️ See photos</a>
      ${p.url ? `<a class="btn" target="_blank" rel="noopener" href="${esc(p.url)}">🌐 Website</a>` : ''}
      ${p.wiki && p.wiki !== p.url ? `<a class="btn" target="_blank" rel="noopener" href="${esc(p.wiki)}">📖 Wikipedia</a>` : ''}
    </div>
    <h3>Your photos</h3>
    <div class="photos">${ph.map(x => `<div class="ph" style="background-image:url(${x.url})"><button data-act="del-photo" data-pid="${p.id}" data-id="${x.id}" aria-label="Delete photo">✕</button></div>`).join('')}
      <label class="uploadbox">📷<br>Add photo<input type="file" accept="image/*" multiple data-upload="${p.id}"></label></div>
    <p class="muted" style="font-size:12px;margin:6px 0 0">Photos are kept on this device only.</p>`;
}

function stop(stopId) {
  const t = ctx.trip, f = findStop(t, stopId); if (!f) return '';
  const rows = computeDay(t, f.di), r = rows.find(x => x.st.id === stopId); if (!r) return '';
  const p = r.place, st = r.st, k = rows.indexOf(r), prev = rows[k - 1]?.place;
  return `${coverBlock(p)}<div class="sbody" style="--dc:${dayColor(f.di)}">
    <div class="kicker" style="color:var(--dc)">${esc(dayLong(t.days[f.di]))} · stop ${r.n ?? k + 1}</div>
    <h2>${esc(p.name)}</h2>
    <div class="muted">${fmt(r.arr)}${st.dur ? ' – ' + fmt(r.end) : ''}${r.tr ? ` · ${MODES[r.tr.mode]?.e} ${r.tr.min} min from ${esc(prev.name)}` : ''}</div>
    ${r.warn ? `<div class="warnbox">⚠ ${esc(r.warn)}</div>` : ''}
    ${r.late ? `<div class="warnbox">⚠ You’ll arrive ${r.late} min after your ${esc(st.fixed)} booking. <button class="btn small" data-act="rescue" data-di="${f.di}" style="margin-left:6px">🛟 Help me fix this</button></div>` : ''}
    <h3>Timing</h3>
    <div class="grid2">
      <div class="field"><label>Time here (min)</label><div class="stepper"><button data-act="dur" data-id="${st.id}" data-n="-15">−</button><input type="number" min="0" step="5" value="${st.dur || 0}" data-input="dur" data-id="${st.id}"><button data-act="dur" data-id="${st.id}" data-n="15">＋</button></div></div>
      <div class="field"><label>Fixed start (booking)</label><input type="time" value="${esc(st.fixed || '')}" data-input="fixed" data-id="${st.id}"></div>
    </div>
    ${k > 0 ? `<button class="btn small" data-act="edit-travel" data-id="${st.id}">${MODES[r.tr.mode]?.e} Travel: ${r.tr.min} min ${MODES[r.tr.mode]?.l} — change</button>` : ''}
    <div class="field" style="margin-top:12px"><label>Note</label><textarea data-input="note" data-id="${st.id}" placeholder="Booking ref, what to order…">${esc(st.note || '')}</textarea></div>
    <label class="toggle"><input type="checkbox" ${st.must ? 'checked' : ''} data-input="must" data-id="${st.id}"> ⭐ Must-do — never suggest skipping or shortening it</label>
    <label class="toggle"><input type="checkbox" ${st.done ? 'checked' : ''} data-input="done" data-id="${st.id}"> Visited ✓</label>
    <h3>Move</h3>
    <div class="btns">
      <button class="btn small" data-act="move" data-id="${st.id}" data-n="-1" ${f.i === 0 ? 'disabled' : ''}>↑ Earlier</button>
      <button class="btn small" data-act="move" data-id="${st.id}" data-n="1" ${f.i === t.days[f.di].stops.length - 1 ? 'disabled' : ''}>↓ Later</button>
      ${t.days.map((d, i) => i === f.di ? '' : `<button class="btn small" data-act="move-day" data-id="${st.id}" data-di="${i}">→ ${esc(dayShort(d))}</button>`).join('')}
      <button class="btn small danger" data-act="remove-stop" data-id="${st.id}">Remove from plan</button>
    </div>
    <h3>About this place</h3>
    ${placeInfo(p, prev, r.tr?.mode)}
    <div class="btns" style="margin-top:16px"><button class="btn small" data-act="edit-place" data-id="${p.id}">✏️ Edit place info</button><button class="btn small" data-act="show-on-map" data-id="${p.id}">🗺️ Show on map</button></div>
  </div>`;
}

function place(pid) {
  const t = ctx.trip, p = t.places[pid]; if (!p) return '';
  const uses = placeUses(t, pid);
  return `${coverBlock(p)}<div class="sbody">
    <h2>${esc(p.name)}</h2>
    <div class="muted">${uses.length ? 'Planned: ' + uses.map(u => esc(dayShort(t.days[u.di]))).join(', ') : 'Not in the plan yet'}</div>
    <div class="btns" style="margin-top:12px">${t.days.map((d, i) => `<button class="btn ${uses.length ? '' : 'primary'} small" data-act="quick-add" data-id="${p.id}" data-di="${i}">＋ Add to ${esc(dayShort(d))}</button>`).join('')}</div>
    ${uses.length ? `<div class="btns" style="margin-top:8px">${uses.map(u => `<button class="btn small" data-act="open-stop" data-id="${u.st.id}">Open in ${esc(dayShort(t.days[u.di]))} plan</button>`).join('')}</div>` : ''}
    ${placeInfo(p, null, 'transit')}
    <div class="btns" style="margin-top:16px"><button class="btn small" data-act="edit-place" data-id="${p.id}">✏️ Edit place info</button><button class="btn small" data-act="show-on-map" data-id="${p.id}">🗺️ Show on map</button>
    <button class="btn small danger" data-act="delete-place" data-id="${p.id}">Delete place</button></div>
  </div>`;
}

function editPlace(args) {
  const t = ctx.trip;
  const p = args.id ? t.places[args.id] : (ctx.ui.draft ||= { name: '', cat: 'sight', lat: null, lng: null });
  const v = k => esc(p[k] ?? '');
  return `<div class="sbody" style="padding-top:22px">
    <h2>${args.id ? 'Edit place' : 'New place'}</h2>
    <div class="field"><label>Name</label><input data-draft="name" value="${v('name')}" placeholder="e.g. Kehoe's pub"></div>
    <div class="grid2">
      <div class="field"><label>Type</label><select data-draft="cat">${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${p.cat === k ? 'selected' : ''}>${c.e} ${c.l}</option>`).join('')}</select></div>
      <div class="field"><label>Location</label><button class="btn" style="width:100%;justify-content:center" data-act="pick-loc">${p.lat != null ? '📍 Set ✓ — change' : '📍 Tap on map'}</button></div>
    </div>
    <div class="field"><label>…or paste coordinates / a Google Maps link</label><input data-draft="coords" placeholder="53.3438, -6.2638" value="${p.lat != null ? (+p.lat).toFixed(5) + ', ' + (+p.lng).toFixed(5) : ''}"></div>
    <div class="field"><label>Description</label><textarea data-draft="desc">${v('desc')}</textarea></div>
    <div class="grid2">
      <div class="field"><label>Tip / reminder</label><input data-draft="tip" value="${v('tip')}"></div>
      <div class="field"><label>Tip from (optional)</label><input data-draft="tipFrom" value="${v('tipFrom')}" placeholder="e.g. a local friend"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Opening hours</label><input data-draft="hoursText" value="${v('hoursText')}" placeholder="Daily 10–17"></div>
      <div class="field"><label>Cost</label><input data-draft="cost" value="${v('cost')}"></div>
    </div>
    <p class="muted" style="font-size:12px;margin:-4px 0 10px">Hours like “Daily 10–17” or “Mon–Fri 9–17, Sat 10–16, Sun closed” also give a warning when a visit doesn’t fit.</p>
    <div class="field"><label>Website</label><input data-draft="url" value="${v('url')}" placeholder="https://"></div>
    <div class="field"><label>Google Maps search text (optional)</label><input data-draft="q" value="${v('q')}" placeholder="${esc((p.name || 'Name') + (t.mapsSuffix || ''))}"></div>
    <div class="btns" style="margin-top:6px"><button class="btn primary" data-act="save-place">${args.id ? 'Save' : 'Create place'}</button>
    ${args.id ? '' : t.days.map((d, i) => `<button class="btn" data-act="save-place" data-di="${i}">Create + add to ${esc(dayShort(d))}</button>`).join('')}
    <button class="btn" data-act="close-sheet">Cancel</button></div>
  </div>`;
}

function travel(stopId) {
  const t = ctx.trip, f = findStop(t, stopId); if (!f) return '';
  const rows = computeDay(t, f.di), r = rows.find(x => x.st.id === stopId); if (!r || !r.tr) return '';
  const st = r.st, prev = rows[rows.indexOf(r) - 1].place;
  return `<div class="sbody" style="padding-top:22px">
    <h2>Getting there</h2>
    <p class="muted">${esc(prev.name)} → ${esc(r.place.name)} · ${r.tr.d.toFixed(1)} km straight line</p>
    <div class="field"><label>How</label><div class="btns">
      <button class="pill ${!st.mode || st.mode === 'auto' ? 'on' : ''}" data-act="tmode" data-id="${st.id}" data-m="auto">Auto</button>
      ${Object.entries(MODES).map(([k, m]) => `<button class="pill ${st.mode === k ? 'on' : ''}" data-act="tmode" data-id="${st.id}" data-m="${k}">${m.e} ${m.l}</button>`).join('')}
    </div></div>
    <div class="field"><label>Minutes ${st.min == null ? '(estimated — type to override)' : ''}</label>
      <div class="stepper"><button data-act="tmin" data-id="${st.id}" data-n="-5">−</button><input type="number" min="0" value="${r.tr.min}" data-input="tmin" data-id="${st.id}"><button data-act="tmin" data-id="${st.id}" data-n="5">＋</button>
      ${st.min != null ? `<button class="btn small" data-act="tmin-reset" data-id="${st.id}">Use estimate</button>` : ''}</div></div>
    <div class="btns" style="margin-top:10px"><a class="btn primary" target="_blank" rel="noopener" href="${dirUrl(t, prev, r.place, r.tr.mode)}">🧭 Check in Google Maps</a><button class="btn" data-act="close-sheet">Done</button></div>
    <p class="muted" style="font-size:12px">Estimates use straight-line distance and average speeds. Override with real times from Google Maps.</p>
  </div>`;
}

function picker({ di, at }) {
  const t = ctx.trip, used = scheduledIds(t), q = (ctx.ui.pq || '').toLowerCase();
  const list = Object.values(t.places).filter(p => !q || p.name.toLowerCase().includes(q)).sort((a, b) => (used.has(a.id) - used.has(b.id)) || a.name.localeCompare(b.name));
  return `<div class="sbody" style="padding-top:22px">
    <h2>Add to ${esc(dayName(t.days[di]))}</h2>
    <p class="muted">${at === 'end' ? 'Goes where it fits best on the route — drag to adjust.' : 'Inserted at the spot you chose.'}</p>
    <div class="btns" style="margin-bottom:10px"><button class="btn primary" data-act="new-place" data-di="${di}" data-at="${at}">＋ New place</button></div>
    <input type="search" placeholder="Search your places or the map…" value="${esc(ctx.ui.pq || '')}" data-input="pq" style="margin-bottom:10px" autocomplete="off">
    ${q.length >= 2 ? foundHtml({ mode: 'pick', di }) + '<div class="sectionlabel">Your places</div>' : `<div class="btns" style="margin:-2px 0 10px"><button class="btn small" data-act="go-discover">🔭 Browse top sights</button></div>`}
    <div class="cards">${list.map(p => `<div class="icard" data-act="pick-add" data-id="${p.id}">${thumb(p)}<div style="flex:1;min-width:0"><div class="nm">${esc(p.name)}</div><div class="meta"><span>${cat(p).e} ${cat(p).l}</span>${used.has(p.id) ? '<span>✓ planned</span>' : ''}</div><p>${esc(p.desc || '')}</p></div></div>`).join('') || (q ? '<div class="empty small">None of your places match.</div>' : '<div class="empty">No places yet — search above or browse top sights.</div>')}</div>
  </div>`;
}

function day(di) {
  const d = ctx.trip.days[di]; if (!d) return '';
  return `<div class="sbody" style="padding-top:22px"><h2>${esc(dayLong(d))}</h2>
    <div class="grid2"><div class="field"><label>Day starts at</label><input type="time" value="${esc(d.start)}" data-input="day-start" data-di="${di}"></div>
    <div class="field"><label>Date</label><input type="date" value="${esc(d.date)}" data-input="day-date" data-di="${di}"></div></div>
    <div class="field"><label>Sunset (optional)</label><input type="time" value="${esc(d.sunset || '')}" data-input="day-sunset" data-di="${di}"></div>
    <div class="btns"><button class="btn primary" data-act="close-sheet">Done</button><button class="btn danger" data-act="remove-day" data-di="${di}">Delete this day</button></div></div>`;
}

function menu() {
  const t = ctx.trip, mp = mapPref();
  return `<div class="sbody" style="padding-top:22px"><h2>Trip settings</h2>
    <div class="field" style="margin-top:12px"><label>Trip name</label><input value="${esc(t.title)}" data-input="trip-title"></div>
    <div class="grid2">
      <div class="field"><label>Destination</label><input value="${esc(t.destination || '')}" data-input="trip-dest"></div>
      <div class="field"><label>Time zone</label><input value="${esc(t.tz)}" data-input="trip-tz"></div>
    </div>
    <div class="field"><label>Added to Google Maps searches</label><input value="${esc(t.mapsSuffix || '')}" data-input="trip-suffix" placeholder=", Lisbon, Portugal"></div>
    <div class="field"><label>Map style</label><select data-input="map-mode">
      <option value="auto" ${mp === 'auto' ? 'selected' : ''}>Automatic (real map when available)</option>
      <option value="schematic" ${mp === 'schematic' ? 'selected' : ''}>Always schematic</option></select>
      <p class="muted" style="font-size:12px;margin:4px 0 0">Currently: ${ctx.map?.kind === 'tiles' ? 'real map (OpenStreetMap)' : 'schematic drawing'}</p></div>
    <div class="btns">
      ${pwa.canInstall ? '<button class="btn primary" data-act="install">📲 Install as an app</button>' : ''}
      <button class="btn" data-act="share">🔗 Share with a travel companion</button>
      <button class="btn" data-act="stays">🛏️ Hotels &amp; travel</button>
      <button class="btn" data-act="backup">💾 Backup / move to another device</button>
      ${t.templatePath ? '<button class="btn" data-act="reset-trip">↺ Reset to original plan</button>' : ''}
      <button class="btn" data-act="home">🧳 All trips</button>
      <button class="btn danger" data-act="delete-trip">Delete trip</button>
    </div>
    ${!pwa.canInstall && !pwa.standalone ? `<p class="muted" style="font-size:13px;margin-top:10px">📲 To install it as an app: in Chrome tap ⋮ → “Add to Home screen” (or “Install app”).</p>` : ''}
    <h3>How this works</h3>
    <p class="muted" style="font-size:14px">Everything is saved in this browser, and the app keeps working offline once it has been opened. Each stop has a duration; travel is estimated between stops; 📌 fixed times (bookings) hold their place and the rest of the day flows around them.</p>
  </div>`;
}

function backup() {
  return `<div class="sbody" style="padding-top:22px"><h2>Backup & transfer</h2>
    <p class="muted" style="font-size:14px">Copy this text and paste it on your other device (Trips → Paste a trip). Photos stay on the device they were added on.</p>
    <textarea readonly id="exportText" style="min-height:90px;font-size:11px">${esc(exportTrip(ctx.trip))}</textarea>
    <div class="btns" style="margin:8px 0 0"><button class="btn primary" data-act="copy-export">📋 Copy trip</button><button class="btn" data-act="download-export">⬇ Download file</button></div>
  </div>`;
}

function paste() {
  return `<div class="sbody" style="padding-top:22px"><h2>Paste a trip</h2>
    <textarea id="importText" placeholder="Paste a copied trip here…" style="min-height:140px;font-size:12px"></textarea>
    <div class="btns" style="margin-top:8px"><button class="btn primary" data-act="import-text">Load trip</button></div></div>`;
}

/* ---------- hotels & travel ---------- */
const placeName = id => esc(ctx.trip.places[id]?.name || '—');
function slotBtn(slot, id, i, empty) {
  return `<button class="slot ${id ? 'set' : ''}" data-act="choose-open" data-slot="${slot}" ${i != null ? `data-i="${i}"` : ''}>
    ${id ? `<span class="slot-e">${cat(ctx.trip.places[id]).e}</span><b>${placeName(id)}</b><span class="muted">change</span>` : `<span>＋ ${empty}</span>`}</button>`;
}
function stays() {
  const t = ctx.trip, dates = t.days.map(d => d.date), last = dates[dates.length - 1];
  const opt = (list, v) => list.map(d => `<option value="${d}" ${d === v ? 'selected' : ''}>${esc(dayShort({ date: d }))}</option>`).join('');
  const outDates = [...dates.slice(1), last ? isoAddDays(last, 1) : null].filter(Boolean);
  const S = t.stays || [];
  return `<div class="sbody" style="padding-top:22px">
    <h2>Hotels &amp; travel</h2>
    <p class="muted" style="font-size:14px;margin-top:4px">Each day starts and ends at your hotel. The first day starts where you arrive; the last day ends where you leave from.</p>
    <h3>✈️ Arrival</h3>
    ${slotBtn('arrive', t.arrive?.place, null, 'Where do you arrive? (airport, station…)')}
    <div class="grid2" style="margin-top:8px">
      <div class="field"><label>On ${esc(dayShort(t.days[0]))}, ready to go at</label><input type="time" value="${esc(t.arrive?.time || t.days[0]?.start || '')}" data-input="arrive-time"></div>
      ${t.arrive?.place ? `<div class="field"><label>&nbsp;</label><button class="btn small" data-act="clear-slot" data-slot="arrive">Remove arrival</button></div>` : ''}
    </div>
    <p class="muted" style="font-size:12px;margin:-4px 0 0">Tip: the time you’re out of the airport, not the landing time.</p>
    <h3>🛏️ Where you sleep</h3>
    ${S.map((st, i) => `<div class="staybox">${slotBtn('stay', st.place, i, 'Choose hotel')}
      <div class="grid2" style="margin-top:8px">
        <div class="field"><label>Check in</label><select data-input="stay-from" data-i="${i}">${opt(dates, st.from)}</select></div>
        <div class="field"><label>Check out</label><select data-input="stay-to" data-i="${i}">${opt(outDates, st.to)}</select></div>
      </div>
      <button class="btn small danger" data-act="remove-stay" data-i="${i}">Remove hotel</button></div>`).join('')}
    ${slotBtn('stay', null, null, S.length ? 'Add another hotel' : 'Add your hotel')}
    <h3>🛫 Departure</h3>
    ${slotBtn('depart', t.depart?.place, null, 'Where do you leave from?')}
    <div class="grid2" style="margin-top:8px">
      <div class="field"><label>Be there by (${esc(dayShort(t.days[t.days.length - 1]))})</label><input type="time" value="${esc(t.depart?.time || '')}" data-input="depart-time"></div>
      ${t.depart?.place ? `<div class="field"><label>&nbsp;</label><button class="btn small" data-act="clear-slot" data-slot="depart">Remove departure</button></div>` : ''}
    </div>
    <p class="muted" style="font-size:12px;margin:-4px 0 0">For a flight: about 2 hours before take-off.</p>
    <div class="btns" style="margin-top:16px"><button class="btn primary" data-act="close-sheet">Done</button></div>
  </div>`;
}

const SLOT_TITLE = { arrive: 'Where do you arrive?', depart: 'Where do you leave from?', stay: 'Where are you staying?' };
const SLOT_HINT = { arrive: 'e.g. the airport, or a station', depart: 'e.g. the airport or station', stay: 'Search your hotel by name' };
function choose({ slot }) {
  const t = ctx.trip, q = (ctx.ui.pq || '').toLowerCase();
  const pref = slot === 'stay' ? ['hotel'] : ['transport'];
  const list = Object.values(t.places).filter(p => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => (pref.includes(b.cat) - pref.includes(a.cat)) || a.name.localeCompare(b.name));
  return `<div class="sbody" style="padding-top:22px">
    <h2>${SLOT_TITLE[slot]}</h2>
    <input type="search" placeholder="${SLOT_HINT[slot]}" value="${esc(ctx.ui.pq || '')}" data-input="pq" style="margin:10px 0" autocomplete="off">
    ${q.length >= 2 ? foundHtml({ mode: 'choose' }) : ''}
    <div class="sectionlabel">${q ? 'Your places' : 'Or pick one of your places'}</div>
    <div class="cards">${list.map(p => `<div class="icard" data-act="choose-place" data-id="${p.id}">${thumb(p)}<div style="flex:1;min-width:0"><div class="nm">${esc(p.name)}</div><div class="meta"><span>${cat(p).e} ${cat(p).l}</span></div></div></div>`).join('') || '<div class="empty small">Type a name above to search the map.</div>'}</div>
    <div class="btns" style="margin-top:12px"><button class="btn" data-act="stays">‹ Back</button></div>
  </div>`;
}

/* ---------- a famous sight from Discover ---------- */
function sight(wd) {
  const t = ctx.trip, s = ctx.ui.disc.list?.find(x => x.wd === wd);
  if (!s) return '';
  const have = findExisting(t, s), sum = ctx.ui.sum[wd];
  const gm = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s.name + (t.mapsSuffix || ''));
  const desc = sum?.extract || (s.desc ? s.desc.charAt(0).toUpperCase() + s.desc.slice(1) + '.' : '');
  return `${coverBlock({ ...s, img: s.img || sum?.thumb })}<div class="sbody">
    <h2>${esc(shortName(s.name, t.destination))}</h2>
    <div class="muted">${CATS[s.cat].e} ${CATS[s.cat].l}${have ? ' · ✓ already in your trip' : ''}</div>
    <div class="btns" style="margin-top:12px">${have
      ? `<button class="btn primary small" data-act="open-place" data-id="${have.id}">Open in your trip</button>`
      : `<button class="btn small" data-act="sight-add" data-wd="${wd}">＋ Ideas</button>${t.days.map((d, i) => `<button class="btn small primary" data-act="sight-add" data-wd="${wd}" data-di="${i}">＋ Add to ${esc(dayShort(d))}</button>`).join('')}`}</div>
    <p style="margin:14px 0 0">${sum === undefined && s.wiki ? '<span class="muted">Loading description…</span>' : esc(desc)}</p>
    <div class="btns" style="margin-top:14px">
      <a class="btn" target="_blank" rel="noopener" href="${gm}">📍 Google Maps</a>
      ${s.wiki ? `<a class="btn" target="_blank" rel="noopener" href="${esc(s.wiki)}">📖 Wikipedia</a>` : ''}
      ${s.site ? `<a class="btn" target="_blank" rel="noopener" href="${esc(s.site)}">🌐 Website</a>` : ''}
      <button class="btn" data-act="show-sight" data-wd="${wd}">🗺️ Show on map</button>
    </div>
    <p class="muted" style="font-size:12px;margin-top:12px">Check opening hours and tickets before you go.</p>
  </div>`;
}

/* ---------- share a trip as a link ---------- */
function share() {
  const t = ctx.trip, L = ctx.ui.shareLink;
  const hosted = /^https?:$/.test(location.protocol) && !!location.hostname;
  const canShare = typeof navigator.share === 'function';
  const kb = L?.url ? Math.max(1, Math.round(L.url.length / 1024)) : 0;
  return `<div class="sbody" style="padding-top:22px">
    <h2>Share this trip</h2>
    <p class="muted" style="font-size:14px;margin-top:4px">Send this link to the person you’re travelling with. Opening it gives them a copy of the whole plan: days, hotels and your places. Photos aren’t included.</p>
    ${!L ? '<div class="empty small">Making the link…</div>' : L.err ? `<div class="warnbox">⚠ ${esc(L.err)}</div>` : `
      <input readonly class="sharelink" id="shareLink" value="${esc(L.url)}" aria-label="Share link">
      <div class="btns" style="margin-top:10px">
        ${canShare ? '<button class="btn primary" data-act="share-native">📤 Share…</button>' : ''}
        <button class="btn ${canShare ? '' : 'primary'}" data-act="share-copy">📋 Copy link</button>
      </div>
      <p class="muted" style="font-size:12px;margin:6px 2px 0">${esc(t.title)} · ${kb} KB link</p>
      ${L.url.length > LONG_LINK ? `<div class="warnbox">⚠ This link is very long. Some chat apps cut long messages off — if it doesn’t open on the other phone, use ⋯ → Backup and send the file instead.</div>` : ''}`}
    ${hosted ? '' : `<div class="warnbox">⚠ Share links only work from the hosted app (the one on github.io), not inside a preview.</div>`}
    <div class="tipbox">🔒 The trip is stored <b>inside the link itself</b> — it isn’t uploaded anywhere. Anyone who has the link can open it, so only send it to people you trust.</div>
    <p class="muted" style="font-size:13px">Changed the plan later? Share a new link — opening it updates their copy.</p>
  </div>`;
}

function incoming() {
  const t = ctx.ui.incoming;
  if (!t) return '';
  const mine = listTrips().find(e => e.id === t.id);
  const local = mine && loadTrip(t.id);
  const newer = local && (local.editedAt || 0) > (t.sharedAt || 0);
  const first = t.days[0], last = t.days[t.days.length - 1];
  const nPlaces = Object.keys(t.places).length;
  const when = t.sharedAt ? new Date(t.sharedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return `<div class="sbody" style="padding-top:22px">
    <div class="kicker">Shared trip</div>
    <h2>${esc(t.title)}</h2>
    <div class="muted">${[t.destination, first ? dayShort(first) + (last !== first ? ' – ' + dayShort(last) : '') : '', t.days.length + ' day' + (t.days.length === 1 ? '' : 's'), nPlaces + ' place' + (nPlaces === 1 ? '' : 's')].filter(Boolean).map(esc).join(' · ')}</div>
    ${when ? `<p class="muted" style="font-size:12px;margin:4px 0 0">Link made ${esc(when)}</p>` : ''}
    ${mine ? `<p style="margin:14px 0 0">You already have this trip on this phone.</p>
      ${newer ? `<div class="warnbox">⚠ Your copy has changes made after this link was created. Updating replaces them — choose “Keep both” if you’re not sure.</div>` : ''}
      <div class="btns" style="margin-top:12px">
        <button class="btn ${newer ? '' : 'primary'}" data-act="incoming-add" data-mode="replace">Update my copy</button>
        <button class="btn ${newer ? 'primary' : ''}" data-act="incoming-add" data-mode="copy">Keep both</button>
        <button class="btn" data-act="incoming-cancel">Cancel</button>
      </div>` : `
      <div class="btns" style="margin-top:14px">
        <button class="btn primary" data-act="incoming-add" data-mode="new">Add to my trips</button>
        <button class="btn" data-act="incoming-cancel">Cancel</button>
      </div>`}
    <p class="muted" style="font-size:12px;margin-top:12px">It’s saved in this browser only. Your photos stay as they are.</p>
  </div>`;
}

/* ---------- running late: suggested fixes ---------- */
const FIX_ICON = { shorten: '✂️', spread: '✂️', taxi: '🚕', later: '↪️', day: '📅', skip: '⏭️' };

/** Options for suggestFixes() from the sheet args (live mode passes from/keep/minDay). */
export const rescueOpts = a => ({ from: a.from || 0, keep: a.keep || {}, minDay: a.minDay || 0 });

/** One line under a fix: what it changes and where you end up. */
function fixDetail(o, tg) {
  const t = ctx.trip, bits = [];
  const durs = o.ops.filter(op => op.op === 'dur').map(op => {
    const f = findStop(t, op.stop); if (!f) return '';
    return `${t.places[f.st.place]?.name}: ${f.st.dur} → ${op.dur} min`;
  }).filter(Boolean);
  if (o.kind === 'spread') bits.push(durs.join(' · '));
  bits.push(o.full ? `On time: you get there at ${fmt(o.after.arr)}` : `Helps, but still ${o.after.late} min late`);
  return bits.join(' — ');
}

function rescue(args) {
  const t = ctx.trip, di = args.di, day = t.days[di], done = ctx.ui.rescueDone;
  if (!day) return '';
  const res = suggestFixes(t, di, rescueOpts(args));
  let html = `<div class="sbody" style="padding-top:22px"><div class="kicker">${esc(dayLong(day))}</div><h2>Running late</h2>`;
  if (done) html += `<div class="okbox">✓ ${esc(done.msg)} <button class="btn small" data-act="rescue-undo" style="margin-left:6px">↶ Undo</button></div>`;
  if (!res) {
    return html + `<p>${done ? 'Everything that day is on time now.' : 'Nothing is running late on this day.'}</p>
      <div class="btns"><button class="btn primary" data-act="close-sheet">Done</button></div></div>`;
  }
  const tg = res.target;
  html += `<p style="margin-top:8px">${tg.kind === 'depart'
    ? `You’d reach <b>${esc(tg.name)}</b> at ${fmt(tg.arr)} — <b>${tg.late} min</b> after the ${esc(tg.fixed)} you need to be there.`
    : `You’d arrive at <b>${esc(tg.name)}</b> at ${fmt(tg.arr)} — <b>${tg.late} min</b> after your ${esc(tg.fixed)} booking.`}</p>`;
  if (!res.options.length) {
    html += `<div class="warnbox">No single change fixes this. Change the ${tg.kind === 'depart' ? 'departure time' : 'booking time'}, or drag stops around in the plan.</div>`;
  } else {
    html += `<div class="sectionlabel">Ways to fix it</div><div class="cards">${res.options.map((o, i) => `
      <div class="fixcard"><div class="fx-ic">${FIX_ICON[o.kind] || '🛟'}</div>
        <div style="flex:1;min-width:0"><b>${esc(o.label)}</b>
          <div class="muted" style="font-size:13px;margin-top:2px">${esc(fixDetail(o, tg))}</div>
          ${o.newWarn ? '<div class="warnline">⚠ Afterwards a place may be closed when you get there — check the plan</div>' : ''}
        </div>
        <button class="btn small primary" data-act="rescue-apply" data-i="${i}">Do this</button></div>`).join('')}</div>`;
  }
  html += `<p class="muted" style="font-size:13px;margin-top:14px">Or change it yourself:
      ${tg.kind === 'depart' ? '<button class="linkbtn" data-act="stays">departure time</button>' : `<button class="linkbtn" data-act="open-stop" data-id="${tg.id}">the booking</button>`}
      · <button class="linkbtn" data-act="close-sheet">the plan</button></p>
    <p class="muted" style="font-size:12px">⭐ Stops you mark as must-do (in a stop’s details) are never suggested for skipping or shortening.</p>
  </div>`;
  return html;
}

/* ---------- best order for a day ---------- */
const minsTxt = m => m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;

function optimise({ di }) {
  const t = ctx.trip, day = t.days[di], O = ctx.ui.opt, done = ctx.ui.optDone;
  if (!day) return '';
  let html = `<div class="sbody" style="padding-top:22px"><div class="kicker">${esc(dayLong(day))}</div><h2>Best order</h2>`;
  if (done) {
    return html + `<div class="okbox">✓ New order saved — ${esc(done.msg)} <button class="btn small" data-act="optimise-undo" style="margin-left:6px">↶ Undo</button></div>
      <div class="btns" style="margin-top:12px"><button class="btn primary" data-act="close-sheet">Done</button></div></div>`;
  }
  const r = O?.di === di ? O.r : null;
  if (!r) return html + `<p class="muted">Add at least 3 stops to this day first.</p><div class="btns"><button class="btn" data-act="close-sheet">OK</button></div></div>`;
  if (!r.changed) {
    return html + `<p style="margin-top:8px">👍 This order is already the best I can find — no shorter route that keeps your bookings and opening hours.</p>
      <div class="btns"><button class="btn primary" data-act="close-sheet">OK</button></div></div>`;
  }
  const b = r.before, a = r.after, oldPos = new Map(day.stops.map((s, i) => [s.id, i + 1]));
  const gains = [];
  if (a.travel < b.travel) gains.push(`🚶 Travel ${minsTxt(b.travel)} → <b>${minsTxt(a.travel)}</b>`);
  if (a.end !== b.end) gains.push(`🏁 Day ends ${fmt(b.end)} → <b>${fmt(a.end)}</b>`);
  if (a.late < b.late) gains.push(`✓ No longer late for a booking`);
  if (a.warns < b.warns) gains.push(`✓ Fixes ${b.warns - a.warns} opening-hours problem${b.warns - a.warns > 1 ? 's' : ''}`);
  const stopById = new Map(day.stops.map(s => [s.id, s]));
  html += `<div class="gains">${gains.map(g => `<div>${g}</div>`).join('')}</div>
    <div class="sectionlabel">New order</div>
    <ol class="neworder">${r.order.map((id, i) => {
      const s = stopById.get(id), p = t.places[s.place], was = oldPos.get(id);
      return `<li><span>${cat(p).e} ${esc(p.name)}</span>${was !== i + 1 ? `<small>was ${was}</small>` : ''}${s.fixed ? `<small>📌 ${esc(s.fixed)}</small>` : ''}${s.done ? '<small>✓ visited</small>' : ''}</li>`;
    }).join('')}</ol>
    <div class="btns" style="margin-top:14px"><button class="btn primary" data-act="optimise-apply">Use this order</button><button class="btn" data-act="close-sheet">Keep mine</button></div>
    <p class="muted" style="font-size:12px;margin-top:10px">Travel times are estimates. Visited stops, bookings and opening hours are taken into account; a travel time you typed in yourself is reset when the stop before it changes.</p>
  </div>`;
  return html;
}

/* ---------- plan it for me ---------- */
function autoplan() {
  const t = ctx.trip, A = ctx.ui.ap, done = ctx.ui.apDone;
  let html = `<div class="sbody" style="padding-top:22px"><h2>🪄 Plan it for me</h2>`;
  if (done) {
    return html + `<div class="okbox">✓ ${esc(done.msg)} <button class="btn small" data-act="ap-undo" style="margin-left:6px">↶ Undo</button></div>
      <div class="btns" style="margin-top:12px"><button class="btn primary" data-act="ap-show">See the plan</button><button class="btn" data-act="close-sheet">Close</button></div></div>`;
  }
  const res = A?.res, ideas = unplannedIdeas(t).length;
  html += `<p class="muted" style="font-size:14px;margin-top:4px">Spreads your ${ideas} saved place${ideas === 1 ? '' : 's'} over your days: places close together on the same day, each on a day it’s open, and no missed bookings. Your own stops stay where they are.</p>
    <div class="chips">${Object.entries(PACES).map(([k, p]) => `<button class="chip ${A?.pace === k ? 'on' : ''}" data-act="ap-pace" data-pace="${k}">${p.label} · ${p.hint}</button>`).join('')}</div>`;
  if (!ideas) return html + `<div class="empty small">No saved places to plan yet — add some from 🔭 Discover or search first.</div><div class="btns"><button class="btn primary" data-act="go-discover">🔭 Browse top sights</button></div></div>`;
  if (!res?.added.length) {
    html += `<div class="warnbox">Nothing fits${res?.skipped.some(s => s.reason === 'full') ? ' — your days are full for this pace. Try “Packed”, or add a day.' : '.'}</div>`;
  } else {
    html += `<div class="cards" style="margin-top:6px">${res.days.map(d => {
      const day = t.days[d.di];
      return `<div class="apday" style="--dc:${dayColor(d.di)}"><div class="apday-h"><b>${esc(dayLong(day))}</b>
          <span class="muted">+${d.added.length} · ends ${fmt(d.after.end)} · ${minsTxt(d.after.travel)} travel</span></div>
        <div class="apday-list">${d.added.map(id => { const p = t.places[id]; return `<span>${cat(p).e} ${esc(p.name)}</span>`; }).join('')}</div></div>`;
    }).join('')}</div>`;
  }
  if (res?.skipped.length) {
    const why = { closed: 'closed on your days', full: 'no room' };
    html += `<p class="muted" style="font-size:13px;margin-top:12px"><b>Stays in your ideas:</b> ${res.skipped.map(s => `${esc(t.places[s.place]?.name || '')} (${why[s.reason]})`).join(', ')}.</p>`;
  }
  html += `<div class="btns" style="margin-top:14px">${res?.added.length ? '<button class="btn primary" data-act="ap-apply">Use this plan</button>' : ''}<button class="btn" data-act="close-sheet">Cancel</button></div>
    <p class="muted" style="font-size:12px;margin-top:10px">Visit lengths use typical times per type of place — change them in the plan afterwards. Travel times are estimates.</p>
  </div>`;
  return html;
}
