// Small HTML builders reused across views and sheets.

import { esc, fmt, dur, dayShort } from '../util.js';
import { cat, dayColor } from '../config.js';
import { photosOf } from '../photos.js';
import { ctx } from '../state.js';

/** A URL safe to drop unquoted into url(...) inside a style="" attribute. */
const cssUrl = u => 'url(' + String(u).replace(/[()'"\\\s<>]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')) + ')';

/** Background for a place (or a found sight): your photo > web picture > category gradient. */
export function coverStyle(p) {
  const ph = p.id && photosOf(ctx.trip.id, p.id)[0];
  if (ph) return `background-image:url(${ph.url})`;
  const g = cat(p).g;
  const grad = `radial-gradient(circle at 80% 15%,rgba(255,255,255,.22),transparent 45%),linear-gradient(135deg,${g[0]},${g[1]})`;
  // If the web picture is blocked (artifact sandbox, offline) the gradient underneath still shows.
  return `background-image:${p.img ? cssUrl(p.img) + ',' : ''}${grad}`;
}
const hasPhoto = p => !!p.id && photosOf(ctx.trip.id, p.id).length > 0;
const hasPic = p => hasPhoto(p) || !!p.img;
export const thumb = p => `<div class="thumb" style="${coverStyle(p)}">${hasPic(p) ? '' : cat(p).e}</div>`;
export const coverBlock = (p, h) => `<div class="cover" style="${coverStyle(p)}${h ? ';height:' + h + 'px' : ''}">${hasPic(p) ? '' : cat(p).e}<div class="cv-name">${cat(p).l}${p.tipFrom ? ' · ★ Tip from ' + esc(p.tipFrom) : ''}</div></div>`;

export function dayTabs() {
  const t = ctx.trip;
  return `<div class="daytabs">${t.days.map((d, i) => `<button class="daytab ${i === ctx.ui.day ? 'on' : ''}" style="--dc:${dayColor(i)}" data-act="day" data-i="${i}"><b><span class="dot"></span>${esc(dayShort(d))}</b><small>${d.stops.length} stop${d.stops.length === 1 ? '' : 's'}</small></button>`).join('')}
    <button class="daytab" data-act="add-day" style="min-width:auto"><b>＋</b><small>day</small></button></div>`;
}

/** A stop card in a timeline. opts: {nohandle, compact} */
export function stopCard(r, k, opts = {}) {
  const p = r.place, st = r.st;
  const warns = [];
  if (r.warn) warns.push('⚠ ' + r.warn);
  if (r.late) warns.push(`⚠ ${r.late} min late for ${st.fixed}`);
  const nph = photosOf(ctx.trip.id, p.id).length;
  return `<div class="stop ${ctx.ui.sel === st.id ? 'sel' : ''} ${st.done ? 'done' : ''}" data-act="open-stop" data-id="${st.id}">
    <div class="badge">${st.done ? '✓' : r.n ?? k + 1}</div>
    ${thumb(p)}
    <div class="info"><div class="nm">${esc(p.name)}</div>
      <div class="meta"><span>${cat(p).e} ${st.dur ? dur(st.dur) : cat(p).l}</span>${st.fixed ? `<span>📌 ${esc(st.fixed)}</span>` : ''}${p.tipFrom ? `<span class="uncle">★ ${esc(p.tipFrom)}</span>` : ''}${nph ? `<span>📷 ${nph}</span>` : ''}</div>
      ${warns.length ? `<div class="warnline">${warns.map(esc).join('<br>')}</div>` : ''}
      ${st.note && !opts.compact ? `<div class="meta">${esc(st.note.length > 90 ? st.note.slice(0, 88) + '…' : st.note)}</div>` : ''}
    </div>
    ${opts.nohandle ? '' : `<button class="handle" data-drag="${st.id}" aria-label="Drag to reorder">⋮⋮</button>`}
  </div>`;
}
const ENDPOINT_TEXT = {
  start: { arrive: 'You arrive here', hotel: 'Start from your hotel' },
  end: { hotel: 'Back to your hotel', depart: 'Leave from here' }
};
/** Hotel / arrival / departure row at the start or end of a day (not draggable). */
export function endpointRow(r, opts = {}) {
  const p = r.place, st = r.st;
  const what = ENDPOINT_TEXT[st.virtual]?.[st.kind] || '';
  const by = st.virtual === 'end' && st.fixed ? ` · be there by ${esc(st.fixed)}` : '';
  const warn = r.late ? `<div class="warnline">⚠ ${r.late} min too late for ${esc(st.fixed)}</div>` : '';
  return `<div class="erow"><div class="time"><b>${fmt(r.arr)}</b></div>
    <div class="stop endpoint" data-act="open-place" data-id="${p.id}">
      <div class="badge ep">${cat(p).e}</div>
      <div class="info"><div class="nm">${esc(p.name)}</div><div class="meta"><span>${what}${by}</span></div>${warn}</div>
      ${opts.compact ? '' : `<button class="iconbtn small" data-act="stays" aria-label="Edit hotels and travel">✎</button>`}
    </div></div>`;
}
export const anyRow = (r, k, opts) => r.st.virtual ? endpointRow(r, opts) : timeRow(r, k, opts);

export const timeRow = (r, k, opts) => `<div class="row" data-stop="${r.st.id}"><div class="time"><b>${fmt(r.arr)}</b>${r.st.dur && !opts?.compact ? `<small>${fmt(r.end)}</small>` : ''}</div>${stopCard(r, k, opts)}</div>`;
