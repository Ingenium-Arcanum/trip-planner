// Day timeline view.

import { esc, fmt, toMin, dayLong, dayName } from '../util.js';
import { dayColor, MODES } from '../config.js';
import { computeDay } from '../schedule.js';
import { routeUrl } from '../links.js';
import { ctx } from '../state.js';
import { dayTabs, anyRow } from './components.js';

function gapHtml(r) {
  const tr = r.tr, m = MODES[tr.mode] || MODES.walk;
  const dist = tr.d < 1 ? Math.round(tr.d * 100) * 10 + ' m' : tr.d.toFixed(1) + ' km';
  return `<div class="gap"><div></div><div class="rail"><div class="gapline">
    <button class="travel" data-act="edit-travel" data-id="${r.st.id}">${m.e} ${tr.min} min ${m.l} · ${dist}${tr.manual ? '' : ' (est.)'}</button>
    ${r.wait >= 10 ? `<span class="wait">⏳ ${r.wait} min free</span>` : ''}
    ${r.late ? `<span class="late">⚠ ${r.late} min late</span>` : ''}
    <button class="addhere" data-act="add-to-day" data-at="${Math.max(0, r.i)}" aria-label="Insert a place here">＋</button>
  </div></div></div>`;
}

export function renderPlan() {
  const t = ctx.trip, di = ctx.ui.day, day = t.days[di];
  if (!day) return dayTabs() + `<div class="pad empty">No days yet — tap ＋ day.</div>`;
  const rows = computeDay(t, di);
  const sunset = toMin(day.sunset);
  const setUp = (t.stays || []).length || t.arrive?.place || t.depart?.place;
  const realStops = rows.filter(r => !r.st.virtual).length;
  let html = dayTabs() + `<div class="pad" style="--dc:${dayColor(di)}">
    ${!setUp && !t.hideSetup ? `<div class="setupcard"><div style="font-size:26px">🛏️</div><div style="flex:1;min-width:0"><b>Where are you staying?</b>
      <div class="muted" style="font-size:13px">Add your hotel and arrival time — every day then starts and ends there, with travel times included.</div>
      <div class="btns" style="margin:8px 0 0"><button class="btn small primary" data-act="stays">Add hotel &amp; arrival</button><button class="btn small" data-act="hide-setup">Not now</button></div></div></div>` : ''}
    <div class="dayhead"><h2>${esc(dayLong(day))}</h2>
      <button class="chip" data-act="edit-day">▶ Start ${esc(day.start)}</button>
      <button class="chip" data-act="stays">🛏️ Hotel &amp; travel</button>
      ${rows.length ? `<span class="chip">🏁 End ${fmt(rows[rows.length - 1].end)}</span>` : ''}
      ${sunset ? `<span class="chip">🌅 Sunset ≈${esc(day.sunset)}</span>` : ''}
      ${rows.length > 1 ? `<a class="chip" target="_blank" rel="noopener" href="${routeUrl(t, rows)}">🧭 Route in Google Maps</a>` : ''}
    </div><div class="tl" id="tl">`;
  let sunsetShown = false;
  rows.forEach((r, k) => {
    if (k > 0) html += gapHtml(r);
    if (sunset && !sunsetShown && r.arr >= sunset) { sunsetShown = true; html += `<div class="sunset">🌅 sunset around ${esc(day.sunset)}</div>`; }
    html += anyRow(r, k);
  });
  html += `</div>${realStops ? '' : `<div class="empty">Nothing planned yet. Tap ＋ below, or browse <button class="linkbtn" data-act="go-discover">🔭 top sights</button>.</div>`}
    <button class="addbtn" data-act="add-to-day" data-at="end">＋ Add a place to ${esc(dayName(day))}</button></div>`;
  return html;
}
