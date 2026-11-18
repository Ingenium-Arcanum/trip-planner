// Map adapter factory.
//
// Two interchangeable implementations share one interface:
//   update({trip, rows, dayIndex, color, sel, showIdeas})  redraw pins/route
//   fit(points)  centerOn(place, close)  zoom(factor)
//   startPick(cb)  cancelPick()  resize()  destroy()  kind
// and report user input through handlers:
//   onStop(stopId)  onPlace(placeId)  onBackground()
//
// 'tiles'      Leaflet + OpenStreetMap tiles — used whenever tiles can load
//              (laptop, normal hosting).
// 'schematic'  Hand-drawn SVG from trip.basemap — used inside sandboxes that
//              block remote images (e.g. the claude.ai artifact viewer), or offline.

import { ls } from '../util.js';
import { createSchematicMap } from './schematic.js';

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const mapPref = () => ls.get('tp.mapMode') || 'auto'; // auto | tiles | schematic
export const setMapPref = v => ls.set('tp.mapMode', v);

function canLoadTiles(timeout = 2500) {
  return new Promise(res => {
    const img = new Image();
    const t = setTimeout(() => res(false), timeout);
    img.onload = () => { clearTimeout(t); res(true); };
    img.onerror = () => { clearTimeout(t); res(false); };
    img.src = TILE_URL.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
  });
}
function loadLeaflet() {
  if (window.L) return Promise.resolve(true);
  return new Promise(res => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LEAFLET_CSS; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = LEAFLET_JS;
    s.onload = () => res(!!window.L); s.onerror = () => res(false);
    document.head.appendChild(s);
  });
}

export async function createMap(el, handlers) {
  const pref = mapPref();
  if (pref !== 'schematic') {
    const ok = (await canLoadTiles()) && (await loadLeaflet());
    if (ok) {
      const { createTileMap } = await import('./tiles.js');
      return createTileMap(el, handlers);
    }
  }
  return createSchematicMap(el, handlers);
}
