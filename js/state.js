// Single shared app context. Views read from it; actions mutate it then call commit().

import { saveTrip } from './store.js';

export const ctx = {
  trip: null,          // the open trip (null = trips home screen)
  templates: [],       // bundled trip templates (trips/index.json)
  map: null,           // active map adapter (see js/map/index.js)
  ui: {
    view: 'plan',      // plan | now | ideas | map (map only as a view on phones)
    day: 0,            // selected day index
    sel: null,         // selected stop id
    preview: null,     // {date, min} to preview the Now screen
    sheet: null,       // {type, args} of the open bottom sheet
    showIdeas: true,   // show unplanned places on the map
    canSave: true,
    mobile: false,
    q: '', pq: '',     // search boxes (ideas / picker)
    draft: null,       // new-place form draft
    afterCreate: null, // where to add a newly created place
    picking: false,
    ideasTab: 'mine',  // mine | discover
    found: null,       // online name search: {q, list, loading, err}
    disc: { km: null, cat: 'all', limit: 30, list: null, loading: false, err: null, key: null }, // top sights
    sum: {}            // Wikipedia summaries by Wikidata id
  }
};

/** Hooks wired up by app.js so modules don't import each other in circles. */
export const hooks = { render: () => {}, refreshSheet: () => {} };

let saveTimer = null;
export function save() {
  if (!ctx.trip) return;
  ctx.trip.editedAt = Date.now(); // real edits only (opening a trip doesn't count) — used when a shared link arrives
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const ok = saveTrip(ctx.trip);
    if (ok !== ctx.ui.canSave) { ctx.ui.canSave = ok; hooks.render(); }
  }, 150);
}
/** Persist + re-render everything. Call after any change to ctx.trip. */
export function commit() { save(); hooks.render(); hooks.refreshSheet(); }
