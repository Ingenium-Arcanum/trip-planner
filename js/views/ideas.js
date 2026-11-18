// "Ideas": your own places (unplanned first) + online search, and "Discover": the most
// famous sights around the destination, ready to add to a day.

import { esc, dayShort } from '../util.js';
import { cat, CATS } from '../config.js';
import { scheduledIds, placeUses } from '../schedule.js';
import { findExisting, shortName } from '../discover.js';
import { ctx } from '../state.js';
import { thumb } from './components.js';
import { unplannedIdeas } from '../autoplan.js';

const dayBtns = (act, attrs) => ctx.trip.days.map((d, i) => `<button class="btn small" data-act="${act}" ${attrs} data-di="${i}">＋ ${esc(dayShort(d))}</button>`).join('');

/** Where an existing place is used: "✓ Sat 21" / "✓ in Ideas". */
function usedLabel(p) {
  const t = ctx.trip, uses = placeUses(t, p.id);
  if (uses.length) return '✓ ' + uses.map(u => dayShort(t.days[u.di])).join(', ');
  if (scheduledIds(t).has(p.id)) return '✓ hotel / travel';
  return '✓ in Ideas';
}

/** Results of an online name search, shared by Ideas and the add-to-day picker. */
export function foundHtml(opts = {}) {
  const { mode = 'ideas', di } = opts;
  const f = ctx.ui.found, t = ctx.trip;
  ctx.ui.foundCtx = opts;
  if (!f || (f.q || '').length < 2) return '<div id="foundBox"></div>';
  let body;
  if (f.loading && !f.list?.length) body = '<div class="empty small">Searching the map…</div>';
  else if (f.err) body = `<div class="empty small">${esc(f.err)}</div>`;
  else if (!f.list?.length) body = `<div class="empty small">Nothing found on the map for “${esc(f.q)}”.</div>`;
  else body = f.list.map((x, idx) => {
    const have = findExisting(t, x);
    const btns = have ? `<span class="tag">${esc(usedLabel(have))}</span>`
      : mode === 'pick' ? `<button class="btn small primary" data-act="found-add" data-idx="${idx}" data-di="${di}">＋ Add</button>`
      : mode === 'choose' ? `<button class="btn small primary" data-act="found-choose" data-idx="${idx}">Choose</button>`
      : `<button class="btn small" data-act="found-add" data-idx="${idx}">＋ Ideas</button>${dayBtns('found-add', `data-idx="${idx}"`)}`;
    const choose = have && mode === 'choose' ? `<button class="btn small primary" data-act="choose-place" data-id="${have.id}">Choose</button>` : '';
    return `<div class="fcard">${thumb(x)}<div style="flex:1;min-width:0"><div class="nm">${esc(x.name)}</div>
      <div class="meta"><span>${cat(x).e} ${esc(x.kind || cat(x).l)}</span>${x.addr ? `<span>${esc(x.addr)}</span>` : ''}</div>
      <div class="btns">${btns}${choose}</div></div></div>`;
  }).join('');
  return `<div id="foundBox"><div class="sectionlabel">On the map${f.loading ? ' · searching…' : ''}</div><div class="cards">${body}</div>
    <p class="muted" style="font-size:11px;margin:6px 2px 0">Search by Photon · © OpenStreetMap contributors</p></div>`;
}

function renderMine() {
  const t = ctx.trip, used = scheduledIds(t), q = (ctx.ui.q || '').toLowerCase();
  const all = Object.values(t.places).filter(p => !q || (p.name + ' ' + (p.desc || '') + ' ' + cat(p).l).toLowerCase().includes(q));
  const ideas = all.filter(p => !used.has(p.id)), planned = all.filter(p => used.has(p.id));
  const card = p => `<div class="icard" data-act="open-place" data-id="${p.id}">${thumb(p)}<div style="flex:1;min-width:0">
      <div class="nm">${esc(p.name)}</div>
      <div class="meta"><span>${cat(p).e} ${cat(p).l}</span>${p.tipFrom ? `<span class="uncle">★ ${esc(p.tipFrom)}</span>` : ''}${used.has(p.id) ? `<span>${esc(usedLabel(p))}</span>` : ''}</div>
      <p>${esc(p.desc || '')}</p>
      ${used.has(p.id) ? '' : `<div class="btns">${t.days.map((d, i) => `<button class="btn small" data-act="quick-add" data-id="${p.id}" data-di="${i}">＋ ${esc(dayShort(d))}</button>`).join('')}</div>`}
    </div></div>`;
  const nIdeas = unplannedIdeas(t).length;
  return `
    ${nIdeas >= 2 && !q ? `<div class="setupcard"><div style="font-size:26px">🪄</div><div style="flex:1;min-width:0"><b>Plan it for me</b>
      <div class="muted" style="font-size:13px">Spread your ${nIdeas} ideas over your days — nearby places together, opening hours checked.</div>
      <div class="btns" style="margin:8px 0 0"><button class="btn small primary" data-act="autoplan">Make a plan</button></div></div></div>` : ''}
    <input class="search" type="search" placeholder="Search your places or find one on the map…" value="${esc(ctx.ui.q || '')}" data-input="q" autocomplete="off">
    <div class="btns" style="margin:0 0 4px"><button class="btn small" data-act="new-place">✏️ Add manually</button><button class="btn small" data-act="ideas-tab" data-t="discover">🔭 Browse top sights</button></div>
    ${q.length >= 2 ? `<div class="sectionlabel">In your trip · ${all.length}</div><div class="cards">${all.map(card).join('') || '<div class="empty small">None of your places match.</div>'}</div>` + foundHtml() : `
    <div class="sectionlabel">Not in the plan yet · ${ideas.length}</div>
    <div class="cards">${ideas.map(card).join('') || '<div class="empty">Nothing here yet — search above or browse 🔭 top sights.</div>'}</div>
    ${planned.length ? `<div class="sectionlabel">Already planned · ${planned.length}</div><div class="cards">${planned.map(card).join('')}</div>` : ''}`}`;
}

export const KM_OPTIONS = [[3, 'Centre'], [8, 'City'], [20, 'Wider area']];
const CAT_ORDER = ['sight', 'museum', 'church', 'park', 'pub', 'food', 'cafe', 'music', 'activity', 'nature', 'shop'];

/** Google Maps searches for things Wikidata doesn't rank well (food, coffee, pubs). */
function nearbyLinks(t) {
  if (!t.center) return '';
  const [lat, lng] = t.center;
  const link = (e, label, what) => `<a class="chip" target="_blank" rel="noopener" href="https://www.google.com/maps/search/${encodeURIComponent(what)}/@${lat},${lng},15z">${e} ${label} ↗</a>`;
  return `<div class="chips">${link('🍽️', 'Restaurants', 'restaurants')}${link('☕', 'Cafés', 'cafes')}${link('🍺', 'Pubs', 'pubs')}${link('🛍️', 'Shopping', 'shopping')}</div>`;
}

function renderDiscover() {
  const t = ctx.trip, D = ctx.ui.disc;
  if (!t.center) return `<div class="empty">Set the destination in ⋯ Trip settings (e.g. “Lisbon, Portugal”) to see what there is to see.</div>`;
  const km = D.km;
  let html = `<div class="dischead"><h3>Top sights${t.destination ? ' around ' + esc(t.destination.split(',')[0]) : ''}</h3>
    <p class="muted">The most famous places nearby, ranked by how many Wikipedias write about them.</p>
    <div class="chips">${KM_OPTIONS.map(([k, l]) => `<button class="chip ${km === k ? 'on' : ''}" data-act="disc-km" data-km="${k}">${l} · ${k} km</button>`).join('')}</div></div>`;
  if (D.loading) return html + `<div class="empty">Looking up famous places…<br><small>This can take 10–20 seconds the first time; after that it’s remembered.</small></div>`;
  if (D.err) return html + `<div class="empty">${esc(D.err)}<br><button class="btn small" data-act="disc-retry" style="margin-top:8px">Try again</button></div>` + nearbyLinks(t);
  if (!D.list) return html;
  const counts = {};
  D.list.forEach(s => counts[s.cat] = (counts[s.cat] || 0) + 1);
  const cats = CAT_ORDER.filter(c => counts[c]);
  const list = D.cat === 'all' ? D.list : D.list.filter(s => s.cat === D.cat);
  html += `<div class="chips"><button class="chip ${D.cat === 'all' ? 'on' : ''}" data-act="disc-cat" data-cat="all">All · ${D.list.length}</button>${cats.map(c => `<button class="chip ${D.cat === c ? 'on' : ''}" data-act="disc-cat" data-cat="${c}">${CATS[c].e} ${CATS[c].l} · ${counts[c]}</button>`).join('')}</div>`;
  html += `<div class="cards">${list.slice(0, D.limit).map(s => {
    const have = findExisting(t, s);
    const rank = D.list.indexOf(s) + 1;
    return `<div class="icard dcard" data-act="open-sight" data-wd="${s.wd}">${thumb(s)}<div style="flex:1;min-width:0">
      <div class="nm"><span class="rank">${rank}</span>${esc(shortName(s.name, t.destination))}</div>
      <div class="meta"><span>${CATS[s.cat].e} ${CATS[s.cat].l}</span>${have ? `<span class="tag">${esc(usedLabel(have))}</span>` : ''}</div>
      <p>${esc(s.desc ? s.desc.charAt(0).toUpperCase() + s.desc.slice(1) : '')}</p>
      ${have ? '' : `<div class="btns"><button class="btn small" data-act="sight-add" data-wd="${s.wd}">＋ Ideas</button>${dayBtns('sight-add', `data-wd="${s.wd}"`)}</div>`}
    </div></div>`;
  }).join('') || '<div class="empty">Nothing in this category.</div>'}</div>`;
  if (list.length > D.limit) html += `<button class="addbtn" data-act="disc-more">Show more (${list.length - D.limit} left)</button>`;
  html += `<div class="sectionlabel">Food &amp; drink — search nearby in Google Maps</div>${nearbyLinks(t)}
    <p class="muted" style="font-size:11px;margin:10px 2px 0">Data: Wikidata (CC0), pictures: Wikimedia Commons.</p>`;
  return html;
}

export function renderIdeas() {
  const tab = ctx.ui.ideasTab, n = Object.keys(ctx.trip.places).length;
  return `<div class="pad">
    <div class="seg"><button class="${tab === 'mine' ? 'on' : ''}" data-act="ideas-tab" data-t="mine">💡 My places · ${n}</button><button class="${tab === 'discover' ? 'on' : ''}" data-act="ideas-tab" data-t="discover">🔭 Discover</button></div>
    ${tab === 'discover' ? renderDiscover() : renderMine()}
  </div>`;
}
