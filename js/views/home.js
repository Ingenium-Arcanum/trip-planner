// Trips home: list saved trips, start a new one, or load a bundled template.

import { esc, dayLong, isoAddDays, nowIn } from '../util.js';
import { listTrips } from '../store.js';
import { ctx } from '../state.js';
import { pwa } from '../pwa.js';

const range = e => {
  if (!e.start) return '';
  const a = dayLong({ date: e.start }), b = dayLong({ date: e.end || e.start });
  return a === b ? a : `${a} – ${b}`;
};

export function renderHome() {
  const trips = listTrips(), have = new Set(trips.map(t => t.id));
  const templates = ctx.templates.filter(t => !have.has(t.id));
  const today = nowIn(Intl.DateTimeFormat().resolvedOptions().timeZone).date;
  return `<div class="pad home">
    <h2 style="font-size:26px;margin:6px 2px 4px">Your trips</h2>
    <p class="muted" style="margin:0 2px 14px">Saved in this browser. Use 🔗 Share inside a trip to send it to another phone.</p>
    ${pwa.canInstall ? `<div class="setupcard"><div style="font-size:26px">📲</div><div style="flex:1;min-width:0"><b>Install as an app</b>
      <div class="muted" style="font-size:13px">Opens full-screen from your home screen and keeps working without a connection.</div>
      <div class="btns" style="margin:8px 0 0"><button class="btn small primary" data-act="install">Install</button></div></div></div>` : ''}
    <div class="cards">${trips.map(e => `<div class="tripcard" data-act="open-trip" data-id="${esc(e.id)}">
      <div class="tc-ic">🧳</div><div style="flex:1;min-width:0"><h3>${esc(e.title)}</h3><div class="muted" style="font-size:13px">${esc(e.destination || '')}${e.destination && e.start ? ' · ' : ''}${esc(range(e))}</div></div><span class="muted">›</span></div>`).join('') || '<div class="empty">No trips yet.</div>'}</div>

    ${templates.length ? `<div class="sectionlabel">Ready-made plans</div><div class="cards">${templates.map(t => `<div class="tripcard" data-act="load-template" data-path="${esc(t.path)}">
      <div class="tc-ic" style="background:linear-gradient(135deg,#c2502e,#6b2a16)">🗺️</div><div style="flex:1"><h3>${esc(t.title)}</h3><div class="muted" style="font-size:13px">${esc(t.destination || '')}</div></div><span class="btn small">Open</span></div>`).join('')}</div>` : ''}

    <div class="sectionlabel">New trip</div>
    <div class="nowcard"><div class="body">
      <div class="field"><label>Where to?</label><input data-new="destination" placeholder="e.g. Lisbon, Portugal"></div>
      <div class="grid2">
        <div class="field"><label>First day</label><input type="date" data-new="start" value="${isoAddDays(today, 14)}"></div>
        <div class="field"><label>Number of days</label><input type="number" min="1" max="30" value="3" data-new="days"></div>
      </div>
      <div class="field"><label>Trip name (optional)</label><input data-new="title" placeholder="Long weekend in Lisbon"></div>
      <div class="field"><label>Time zone</label><input data-new="tz" value="${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}" placeholder="Europe/Lisbon"></div>
      <div class="btns"><button class="btn primary" data-act="create-trip">Create trip</button><button class="btn" data-act="import-file">📂 Import a trip file…</button><button class="btn" data-act="import-paste">📋 Paste a trip…</button></div>
    </div></div>
  </div>`;
}
