// Schematic SVG map. Draws trip.basemap (sea, parks, rivers, roads, rail, labels — all
// optional) plus pins and the day's route. Works with no network at all.

import { esc, fmt } from '../util.js';
import { projection } from '../geo.js';
import { cat, pinText } from '../config.js';

export function createSchematicMap(el, handlers) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('map');
  el.appendChild(svg);

  const V = { x: 0, y: 0, s: 0.02, w: 300, h: 300 };
  let state = null, proj = projection({ lat: 0, lng: 0 }), originKey = '', pick = null;

  const P = (lat, lng) => proj.toXY(lat, lng);
  const S2 = pt => [(pt[0] - V.x) * V.s + V.w / 2, (pt[1] - V.y) * V.s + V.h / 2];
  const pathOf = (ll, close) => ll.map((p, i) => { const [x, y] = S2(P(p[0], p[1])); return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }).join('') + (close ? 'Z' : '');
  const measure = () => { const r = svg.getBoundingClientRect(); V.w = r.width || 300; V.h = r.height || 300; };

  function setOrigin(trip) {
    const c = trip.basemap?.center || trip.center || [0, 0];
    const k = c.join(',');
    if (k !== originKey) { originKey = k; proj = projection({ lat: c[0], lng: c[1] }); }
  }

  function draw() {
    if (!state) return;
    measure();
    const css = getComputedStyle(document.documentElement);
    const c = n => css.getPropertyValue(n).trim();
    const { trip, rows, color, sel, showIdeas, extra } = state;
    const B = trip.basemap || {};
    const LAB = [], OBST = [];
    const tw = (t, fs) => t.length * fs * 0.56;
    const halo = `style="paint-order:stroke" stroke="${c('--land')}" stroke-linejoin="round"`;
    let g = '', pins = '';

    if (B.sea) g += `<path d="${pathOf(B.sea, 1)}" fill="${c('--sea')}"/>`;
    (B.campus || []).forEach(p => g += `<path d="${pathOf(p.poly, 1)}" fill="${c('--campus')}"/>`);
    (B.parks || []).forEach(p => g += `<path d="${pathOf(p.poly, 1)}" fill="${c('--park')}"/>`);
    (B.roads || []).forEach(r => g += `<path d="${pathOf(r.line)}" fill="none" stroke="${c('--road')}" stroke-width="${Math.max(1.2, Math.min(7, 16 * V.s))}" stroke-linecap="round" stroke-linejoin="round"/>`);
    (B.canals || []).forEach(r => g += `<path d="${pathOf(r.line)}" fill="none" stroke="${c('--river')}" stroke-width="${Math.max(1.5, 14 * V.s)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    (B.rivers || []).forEach(r => g += `<path d="${pathOf(r.line)}" fill="none" stroke="${c('--river')}" stroke-width="${Math.max(2.5, (r.w || 40) * V.s)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    (B.rail || []).forEach(r => g += `<path d="${pathOf(r.line)}" fill="none" stroke="${r.color || '#888'}" stroke-opacity=".5" stroke-width="${V.s > 0.03 ? 2.5 : 1.5}" ${r.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linecap="round"/>`);
    (B.labels || []).forEach(l => {
      if (V.s < (l.z || 0) || (l.zmax && V.s > l.zmax)) return;
      const [x, y] = S2(P(l.p[0], l.p[1]));
      if (x < -100 || x > V.w + 100 || y < -20 || y > V.h + 20) return;
      const fs = l.sea || l.park ? 12 : 11, w = tw(l.t, fs) + 6;
      const col = l.sea ? c('--sea-ink') : l.park ? c('--park-ink') : c('--muted');
      LAB.push({ prio: 3, x: x - w / 2, y: y - fs, w, h: fs + 4, svg: `<text x="${x}" y="${y}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="${col}" ${l.sea ? 'font-style="italic"' : ''} letter-spacing=".04em" ${halo} stroke-width="${l.sea ? 0 : 3}">${esc(l.t)}</text>` });
    });

    const inDay = new Set(rows.map(r => r.place.id));
    if (showIdeas) Object.values(trip.places).forEach(p => {
      if (inDay.has(p.id) || p.lat == null) return;
      const [x, y] = S2(P(p.lat, p.lng));
      if (x < -20 || x > V.w + 20 || y < -20 || y > V.h + 20) return;
      pins += `<g class="pin" data-pid="${p.id}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="14" fill="transparent"/><circle cx="${x}" cy="${y}" r="7.5" fill="${c('--card')}" stroke="${c('--muted')}" stroke-width="1.5"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="8.5">${cat(p).e}</text></g>`;
      OBST.push({ x: x - 8, y: y - 8, w: 16, h: 16 });
      if (V.s > 0.06) LAB.push({ prio: 2, x: x + 10, y: y - 8, w: tw(p.name, 11), h: 15, svg: `<text x="${x + 11}" y="${y + 4}" font-size="11" fill="${c('--muted')}" ${halo} stroke-width="3">${esc(p.name)}</text>` });
    });

    (extra || []).forEach(q => {
      const [x, y] = S2(P(q.lat, q.lng));
      if (x < -20 || x > V.w + 20 || y < -20 || y > V.h + 20) return;
      pins += `<g class="pin" data-xid="${esc(q.key)}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="15" fill="transparent"/><circle cx="${x}" cy="${y}" r="9" fill="${c('--card')}" stroke="${c('--accent')}" stroke-width="2"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10">${q.e}</text></g>`;
      OBST.push({ x: x - 9, y: y - 9, w: 18, h: 18 });
      if (V.s > 0.04) LAB.push({ prio: 2, x: x + 11, y: y - 8, w: tw(q.name, 11), h: 15, svg: `<text x="${x + 12}" y="${y + 4}" font-size="11" fill="${c('--ink')}" ${halo} stroke-width="3">${esc(q.name)}</text>` });
    });

    for (let k = 1; k < rows.length; k++) {
      const a = S2(P(rows[k - 1].place.lat, rows[k - 1].place.lng)), b = S2(P(rows[k].place.lat, rows[k].place.lng));
      const dashed = rows[k].tr && rows[k].tr.mode !== 'walk';
      g += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="3.5" stroke-opacity=".75" ${dashed ? 'stroke-dasharray="2 7"' : ''} stroke-linecap="round"/>`;
    }
    const seen = {}, dayPins = [];
    rows.forEach((r, k) => {
      const p = r.place; let [x, y] = S2(P(p.lat, p.lng));
      const n = seen[p.id] = (seen[p.id] || 0) + 1; if (n > 1) { x += (n - 1) * 18; y -= (n - 1) * 10; }
      const isSel = sel === r.st.id, rad = isSel ? 16 : 13;
      dayPins.push({ isSel, svg: `<g class="pin" data-sid="${r.st.id}" style="cursor:pointer">
        ${isSel ? `<circle cx="${x}" cy="${y}" r="${rad + 7}" fill="${color}" fill-opacity=".22"/>` : ''}
        <circle cx="${x}" cy="${y}" r="${rad}" fill="${r.st.done ? c('--card') : color}" stroke="${r.st.done ? color : '#fff'}" stroke-width="2.5"/>
        <text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="13" font-weight="700" fill="${r.st.done ? color : '#fff'}">${pinText(r)}</text></g>` });
      OBST.push({ x: x - rad, y: y - rad, w: rad * 2, h: rad * 2 });
      const t2 = ' ' + fmt(r.arr), w = tw(p.name, 12.5) + tw(t2, 12.5) * 0.9;
      const mk = (lx, anchor) => `<text x="${lx}" y="${y + 4.5}" text-anchor="${anchor}" font-size="12.5" font-weight="700" fill="${c('--ink')}" ${halo} stroke-width="3.5">${esc(p.name)}<tspan font-weight="500" fill="${c('--muted')}">${t2}</tspan></text>`;
      LAB.push({ prio: isSel ? 0 : 1, alts: [
        { x: x + rad + 4, y: y - 9, w, h: 18, svg: mk(x + rad + 5, 'start') },
        { x: x - rad - 4 - w, y: y - 9, w, h: 18, svg: mk(x - rad - 5, 'end') }] });
    });
    pins += dayPins.filter(d => !d.isSel).map(d => d.svg).join('') + dayPins.filter(d => d.isSel).map(d => d.svg).join('');

    // Greedy label placement: important labels first, skip any that would overlap.
    const placed = OBST.slice();
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    let labels = '';
    LAB.sort((a, b) => a.prio - b.prio).forEach(l => {
      for (const o of (l.alts || [l])) {
        if (l.prio === 0 || !placed.some(q => hit(o, q))) { placed.push(o); labels += o.svg; return; }
      }
    });

    const target = 120 / V.s;
    const nice = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].find(v => v >= target * 0.6) || 50000;
    const px = nice * V.s, sx = V.w - px - 16, sy = V.h - 16;
    g += pins + labels + `<g opacity=".7"><line x1="${sx}" y1="${sy}" x2="${sx + px}" y2="${sy}" stroke="${c('--ink')}" stroke-width="2"/><text x="${sx + px / 2}" y="${sy - 5}" text-anchor="middle" font-size="10.5" fill="${c('--ink')}">${nice >= 1000 ? nice / 1000 + ' km' : nice + ' m'}</text></g>`;
    svg.innerHTML = g;
  }

  function zoom(f, cx, cy) {
    measure(); cx ??= V.w / 2; cy ??= V.h / 2;
    const wx = (cx - V.w / 2) / V.s + V.x, wy = (cy - V.h / 2) / V.s + V.y;
    V.s = Math.max(0.0008, Math.min(1.2, V.s * f));
    V.x = wx - (cx - V.w / 2) / V.s; V.y = wy - (cy - V.h / 2) / V.s;
    draw();
  }

  // ---- input: pan, pinch, wheel, tap ----
  const PTR = new Map(); let PAN = null;
  svg.addEventListener('pointerdown', e => {
    svg.setPointerCapture?.(e.pointerId);
    PTR.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (PTR.size === 1) PAN = { x: e.clientX, y: e.clientY, mx: V.x, my: V.y, moved: 0, target: e.target };
    if (PTR.size === 2) { const [a, b] = [...PTR.values()]; PAN = { pinch: Math.hypot(a.x - b.x, a.y - b.y), s: V.s, moved: 99 }; }
  });
  svg.addEventListener('pointermove', e => {
    if (!PTR.has(e.pointerId) || !PAN) return;
    PTR.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (PTR.size === 2 && PAN.pinch) {
      const [a, b] = [...PTR.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = svg.getBoundingClientRect();
      zoom((PAN.s * d / PAN.pinch) / V.s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); return;
    }
    if (PAN.pinch) return;
    const dx = e.clientX - PAN.x, dy = e.clientY - PAN.y;
    PAN.moved = Math.max(PAN.moved, Math.abs(dx) + Math.abs(dy));
    if (PAN.moved > 4) { V.x = PAN.mx - dx / V.s; V.y = PAN.my - dy / V.s; cancelAnimationFrame(draw.raf); draw.raf = requestAnimationFrame(draw); }
  });
  const up = e => {
    const p = PAN; PTR.delete(e.pointerId);
    if (PTR.size === 0) PAN = null;
    else if (PTR.size === 1) { const [v] = [...PTR.values()]; PAN = { x: v.x, y: v.y, mx: V.x, my: V.y, moved: 99 }; }
    if (!p || p.moved > 6 || p.pinch) return;
    const r = svg.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (pick) { const cb = pick; pick = null; svg.style.cursor = ''; cb(proj.toLL((x - V.w / 2) / V.s + V.x, (y - V.h / 2) / V.s + V.y)); return; }
    const pin = p.target?.closest?.('.pin');
    if (pin?.dataset.sid) handlers.onStop?.(pin.dataset.sid);
    else if (pin?.dataset.xid) handlers.onExtra?.(pin.dataset.xid);
    else if (pin?.dataset.pid) handlers.onPlace?.(pin.dataset.pid);
    else handlers.onBackground?.();
  };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', e => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });

  return {
    kind: 'schematic',
    update(s) { state = s; setOrigin(s.trip); draw(); },
    fit(points, { bottomPad = 50 } = {}) {
      if (!state) return; measure();
      const pts = points.filter(p => p && p.lat != null); if (!pts.length) return;
      const xy = pts.map(p => P(p.lat, p.lng)), xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
      const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
      const topPad = 70, side = 60;
      V.s = Math.min((V.w - side * 2) / Math.max(400, maxx - minx), (V.h - topPad - bottomPad) / Math.max(400, maxy - miny), 0.25);
      V.x = (minx + maxx) / 2; V.y = (miny + maxy) / 2 - (bottomPad - topPad) / 2 / V.s;
      draw();
    },
    centerOn(p, close) { if (!p) return; const [x, y] = P(p.lat, p.lng); V.x = x; V.y = y; if (close) V.s = Math.max(V.s, 0.12); draw(); },
    zoom: f => zoom(f),
    startPick(cb) { pick = cb; svg.style.cursor = 'crosshair'; },
    cancelPick() { pick = null; svg.style.cursor = ''; },
    resize: () => draw(),
    redraw: () => draw(),
    destroy() { svg.remove(); }
  };
}
