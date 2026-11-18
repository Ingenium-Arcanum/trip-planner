// Live "where should I be" screen.

import { esc, fmt, dayLong, dayName, dayShort, nowIn, daysBetween } from '../util.js';
import { cat, dayColor, MODES } from '../config.js';
import { computeDay } from '../schedule.js';
import { dirUrl } from '../links.js';
import { photosOf } from '../photos.js';
import { ctx } from '../state.js';
import { coverStyle, anyRow } from './components.js';

export const tripNow = () => ctx.ui.preview || nowIn(ctx.trip.tz);

const cover = p => `<div class="cover" style="${coverStyle(p)}">${photosOf(ctx.trip.id, p.id).length || p.img ? '' : cat(p).e}</div>`;

export function renderNow() {
  const t = ctx.trip, now = tripNow();
  const di = t.days.findIndex(d => d.date === now.date);
  let html = '<div class="pad">';
  if (di < 0) {
    const first = t.days[0];
    if (first && now.date < first.date) {
      const n = daysBetween(now.date, first.date), rows = computeDay(t, 0);
      html += `<div class="nowcard"><div class="body"><div class="kicker">Countdown</div><div class="big">${n} day${n === 1 ? '' : 's'} to go</div>
        <p class="muted">Day one starts ${esc(dayLong(first))} at ${esc(first.start)}. This screen becomes your live guide once you’re there.</p></div></div>
        <div class="sectionlabel">First up</div><div class="upnext" style="--dc:${dayColor(0)}">${rows.slice(0, 3).map((r, k) => anyRow(r, k, { nohandle: 1, compact: 1 })).join('')}</div>`;
    } else {
      html += `<div class="nowcard"><div class="body"><div class="kicker">Trip finished</div><h2>Hope it was a great trip</h2><p class="muted">Your plan and photos stay on this device.</p></div></div>`;
    }
  } else {
    ctx.ui.day = di;
    const rows = computeDay(t, di), color = dayColor(di);
    // The start-of-day row (hotel / arrival) is where you already are, so it's never "next".
    const cur = rows.find(r => now.min < r.end && r.st.virtual !== 'start');
    if (!cur) html += `<div class="nowcard"><div class="body"><div class="kicker">${esc(dayName(t.days[di]))}</div><h2>That’s the day done 🎉</h2><p class="muted">Nothing left on today’s plan.</p></div></div>`;
    else {
      const k = rows.indexOf(cur), p = cur.place, prev = rows[k - 1]?.place;
      if (now.min < cur.arr) {
        const travelling = k > 0 && now.min >= rows[k - 1].end;
        const leaveBy = cur.arr - (cur.tr ? cur.tr.min : 0);
        const v = cur.st.virtual;
        const kick = v === 'end' ? (cur.st.kind === 'depart' ? 'Time to head out — leaving from' : 'Heading back to') : travelling ? 'On your way to' : 'Next';
        html += `<div class="nowcard" style="--dc:${color}">${cover(p)}<div class="body">
          <div class="kicker">${kick}</div><h2>${esc(p.name)}</h2>
          <div class="muted">Arrive ${fmt(cur.arr)}${cur.tr ? ` · ${MODES[cur.tr.mode]?.e || ''} ${cur.tr.min} min` : ''}${!travelling && cur.tr ? ` · leave by <b>${fmt(leaveBy)}</b>` : ''}${v && cur.st.fixed ? ` · be there by <b>${esc(cur.st.fixed)}</b>` : ''}</div>
          ${cur.late ? `<div class="warnbox">⚠ You’re ${cur.late} min behind for ${esc(cur.st.fixed)}</div>` : ''}
          <div class="btns" style="margin-top:12px"><a class="btn primary" target="_blank" rel="noopener" href="${dirUrl(t, prev, p, cur.tr?.mode)}">🧭 Directions</a>
          ${v ? '' : `<button class="btn" data-act="here-now" data-id="${cur.st.id}">📍 I’m here now</button>`}
          <button class="btn" data-act="${v ? 'open-place' : 'open-stop'}" data-id="${v ? p.id : cur.st.id}">Details</button></div></div></div>`;
      } else {
        const pct = Math.min(100, Math.max(0, (now.min - cur.arr) / Math.max(1, cur.end - cur.arr) * 100));
        html += `<div class="nowcard" style="--dc:${color}">${cover(p)}<div class="body">
          <div class="kicker">Now</div><h2>${esc(p.name)}</h2>
          <div class="muted">${fmt(cur.arr)} – ${fmt(cur.end)} · ${cur.end - now.min} min left</div>
          <div class="prog"><i style="width:${pct}%"></i></div>
          ${cur.warn ? `<div class="warnbox">⚠ ${esc(cur.warn)}</div>` : ''}
          <div class="btns" style="margin-top:12px">
            <button class="btn" data-act="extend" data-id="${cur.st.id}" data-n="15">＋15 min</button>
            <button class="btn" data-act="extend" data-id="${cur.st.id}" data-n="30">＋30 min</button>
            <button class="btn primary" data-act="leave-now" data-id="${cur.st.id}">✓ Done, move on</button>
            <button class="btn" data-act="open-stop" data-id="${cur.st.id}">Details</button>
          </div></div></div>`;
      }
      const next = rows.slice(k + 1, k + 5);
      if (next.length) html += `<div class="sectionlabel">Coming up</div><div class="upnext" style="--dc:${color}">${next.map(r => anyRow(r, rows.indexOf(r), { nohandle: 1, compact: 1 })).join('')}</div>`;
      const last = rows[rows.length - 1];
      html += `<p class="muted" style="font-size:13px;margin-top:12px">Day ends ${fmt(last.end)} at ${esc(last.place.name)}.</p>`;
    }
  }
  const pv = ctx.ui.preview;
  html += `<div class="preview">🔍 Preview this screen at another moment:
    <div class="btns"><select data-input="pv-day">${t.days.map(d => `<option value="${d.date}" ${pv && pv.date === d.date ? 'selected' : ''}>${esc(dayShort(d))}</option>`).join('')}</select>
    <input type="time" data-input="pv-time" value="${pv ? fmt(pv.min) : '12:00'}">
    <button class="btn small" data-act="pv-go">Preview</button>${pv ? '<button class="btn small" data-act="pv-off">Back to real time</button>' : ''}</div></div>`;
  return html + '</div>';
}
