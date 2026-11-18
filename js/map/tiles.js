// Real map: Leaflet + OpenStreetMap tiles. Loaded only when tiles are reachable.
// OSM tile policy: fine for personal, low-volume use; switch TILE_URL (map/index.js)
// to a provider with an API key before sharing widely.

import { esc, fmt } from '../util.js';
import { cat, pinText } from '../config.js';
import { TILE_URL } from './index.js';

export function createTileMap(el, handlers) {
  const L = window.L;
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;inset:0';
  el.appendChild(div);
  const map = L.map(div, { zoomControl: false, attributionControl: true }).setView([0, 0], 2);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  let state = null, pick = null;

  map.on('click', e => {
    if (pick) { const cb = pick; pick = null; div.style.cursor = ''; cb({ lat: e.latlng.lat, lng: e.latlng.lng }); return; }
    handlers.onBackground?.();
  });
  map.on('zoomend', () => draw());

  function draw() {
    if (!state) return;
    layer.clearLayers();
    const { trip, rows, color, sel, showIdeas, extra, me } = state;
    if (me) layer.addLayer(L.circleMarker([me.lat, me.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2a7de1', fillOpacity: 1, interactive: false }));
    const inDay = new Set(rows.map(r => r.place.id));
    const showLabels = map.getZoom() >= 15;

    (extra || []).forEach(x => {
      const m = L.marker([x.lat, x.lng], { icon: L.divIcon({ className: '', html: `<div class="lf-idea lf-extra">${x.e}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }), title: x.name, zIndexOffset: 200 })
        .on('click', ev => { L.DomEvent.stopPropagation(ev); handlers.onExtra?.(x.key); });
      if (map.getZoom() >= 15) m.bindTooltip(esc(x.name), { permanent: true, direction: 'right', className: 'lf-label', offset: [10, 0] });
      layer.addLayer(m);
    });

    if (showIdeas) Object.values(trip.places).forEach(p => {
      if (inDay.has(p.id) || p.lat == null) return;
      const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div class="lf-idea">${cat(p).e}</div>`, iconSize: [18, 18], iconAnchor: [9, 9] }), title: p.name })
        .on('click', ev => { L.DomEvent.stopPropagation(ev); handlers.onPlace?.(p.id); });
      if (map.getZoom() >= 16) m.bindTooltip(esc(p.name), { permanent: true, direction: 'right', className: 'lf-label', offset: [8, 0] });
      layer.addLayer(m);
    });

    for (let k = 1; k < rows.length; k++) {
      const a = rows[k - 1].place, b = rows[k].place;
      const dashed = rows[k].tr && rows[k].tr.mode !== 'walk';
      layer.addLayer(L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color, weight: 4, opacity: 0.8, dashArray: dashed ? '2 8' : null, interactive: false }));
    }
    rows.forEach((r, k) => {
      const p = r.place, isSel = sel === r.st.id;
      const html = `<div class="lf-pin ${isSel ? 'sel' : ''} ${r.st.done ? 'done' : ''}" style="background:${color};${r.st.done ? `color:${color};border-color:${color}` : ''}">${pinText(r)}</div>`;
      const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html, iconSize: [28, 28], iconAnchor: [14, 14] }), zIndexOffset: isSel ? 1000 : 500 })
        .on('click', ev => { L.DomEvent.stopPropagation(ev); handlers.onStop?.(r.st.id); });
      if (showLabels || isSel) m.bindTooltip(`${esc(p.name)} <span style="font-weight:500;opacity:.7">${fmt(r.arr)}</span>`, { permanent: true, direction: 'right', className: 'lf-label', offset: [12, 0] });
      layer.addLayer(m);
    });
  }

  return {
    kind: 'tiles',
    update(s) { const first = !state; state = s; draw(); if (first && s.trip.center) map.setView(s.trip.center, 13); },
    fit(points, { bottomPad = 50 } = {}) {
      const pts = points.filter(p => p && p.lat != null); if (!pts.length) return;
      if (pts.length === 1) { map.setView([pts[0].lat, pts[0].lng], 15); return; }
      map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])), { paddingTopLeft: [40, 70], paddingBottomRight: [40, bottomPad], maxZoom: 16 });
    },
    centerOn(p, close) { if (p) map.setView([p.lat, p.lng], close ? Math.max(map.getZoom(), 16) : map.getZoom()); },
    zoom: f => (f > 1 ? map.zoomIn() : map.zoomOut()),
    startPick(cb) { pick = cb; div.style.cursor = 'crosshair'; },
    cancelPick() { pick = null; div.style.cursor = ''; },
    resize: () => map.invalidateSize(),
    redraw: () => draw(),
    destroy() { map.remove(); div.remove(); }
  };
}
