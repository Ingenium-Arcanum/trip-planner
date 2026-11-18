# CLAUDE.md — working notes for this repo

Context for an AI coding session picking this project up.

## What this is
Vanilla-JS (ES modules, no build) trip planner. Started as a single-file prototype for a
city weekend, then restructured into a generic multi-trip app. No trips are bundled any more
(`trips/index.json` is empty); users create trips in the app and fill them via search / Discover.
Primary use: phone during a trip; planning on laptop.

## Ground rules
- **No build step, no framework.** Plain ES modules + `innerHTML` rendering. Keep it that way
  unless there's a strong reason (discuss first).
- **The engine knows nothing about any city.** Everything trip-specific lives in trip data
  (`trips/*/trip.json` or the user's stored trip). Don't hard-code places, cities or dates in JS.
- `js/schedule.js`, `js/geo.js`, `js/store.js` (except storage calls) must stay **pure / DOM-free**
  so `node --test` can import them. Add tests in `tests/` for any engine change.
- Run `npm test` after changes to scheduling/storage.
- Mobile first: test at 390×800 and ≥900px (desktop shows panel + map side by side;
  the breakpoint is `min-width:900px`, mirrored in `UI.mobile`).

## Must keep working inside the claude.ai artifact sandbox
The app is also published as a claude.ai artifact. That viewer has a strict CSP:
- remote `<img>`/tiles **blocked** → `map/index.js` probes a tile and falls back to `schematic.js`
- `fetch` only to the artifact's own files (fine for `trips/*.json`)
- scripts only from cdnjs/jsdelivr/unpkg; stylesheets inline/own files/Google Fonts
- no `alert/confirm/prompt`, downloads, geolocation, service workers
So: always keep the schematic fallback, never use native dialogs (use sheets / confirmTap),
wrap storage in try/catch (`util.ls`). Features that need network (geocoding, routing APIs,
PWA) must **degrade gracefully** there.

## Architecture
- `state.js` — `ctx.trip` (open trip), `ctx.ui` (view, selected day/stop, sheet, …).
  Mutate `ctx.trip`, then call `commit()` (= debounced save + re-render + refresh sheet).
- `app.js` — `renderAll()` re-renders the side panel + map chrome every change (cheap enough).
  User input is event-delegated: `data-act="name"` → `A[name](el)`, `data-input="name"` → `INPUTS[name](el)`,
  `data-view` switches views. Add new actions to those tables.
- `sheets.js` — `openSheet(type, args)`; builders return HTML, `''` closes the sheet.
- Map adapters share an interface (see header of `js/map/index.js`): `update/fit/centerOn/zoom/startPick/…`.
- Storage keys in `config.js` `STORAGE`. Each trip = one localStorage key; photos in IndexedDB
  (`trip-planner-photos`, records `{id, trip, place, blob, t}`).
- Legacy: the first prototype stored one plan at `trip-planner.state.v1`; `store.migrateLegacy`
  imports it once as trip `legacy`. Photos from then have no `trip` field → treated as that trip.

## Data model (schema 2) — see `schema/trip.schema.json`
```
trip  { schema, id, title, destination, tz, mapsSuffix, center:[lat,lng], basemap?, templatePath?,
        days:[ { id, date:'YYYY-MM-DD', start:'HH:MM', sunset?, back?{mode,min}, stops:[stop] } ],
        places:{ [id]: place },            // array in template files, map in memory/storage
        stays?:[{id, place, from:date (check-in), to:date (check-out)}],
        arrive?:{place, time}, depart?:{place, time /* be there by */}, discKm?, hideSetup? }
stop  { id, place, dur(min), fixed?'HH:MM', mode:'auto'|'walk'|'transit'|'taxi'|'bike', min?, note?, done? }
place { id, name, cat, lat, lng, desc?, tip?, tipFrom?, hoursText?, hours?{'0'..'6':['HH:MM-HH:MM']},
        cost?, url?, q? (Google Maps search text), addr?, img? (web picture), wiki?, wd? (Wikidata id), osm? ('N123') }
```
Hotels/arrival/departure add virtual *endpoint* rows to `computeDay` (`st.virtual='start'|'end'`, ids `@s:<dayId>`/`@e:<dayId>`,
`r.n` = real stop number). An explicit first/last stop at the same place replaces the endpoint (older plans).
Online lookups live in `net.js` (Photon search, Wikidata top sights, Wikipedia summaries, Overpass opening hours);
their pure parsing/filtering is in `discover.js` (tested). All of it fails soft in the artifact sandbox.
Timeline rule: `arrival = prev.end + travel`, but not before `fixed` (wait); after `fixed` → `late` warning.
`hours` uses JS weekdays (0 = Sunday); a missing weekday key means closed; for ticketed sights store last-entry times.

## Known limitations / tech debt
- Travel times are straight-line estimates (`config.MODES` speeds). Users override per hop.
- Times past midnight are shown with ⁺ but hours checks don't handle overnight opening.
- Leaflet labels (permanent tooltips) can overlap; schematic map has its own collision handling.
- `renderAll()` rebuilds the whole panel; fine for <100 stops.
- OSM tiles: OK for personal use per OSM tile policy; switch provider before any wider sharing.

## Roadmap (suggested order)
1. ✅ **Hosted** on GitHub Pages (push to `main` redeploys).
2. ✅ **PWA**: `manifest.json`, `icons/`, `sw.js` (network-first app shell with 4 s fallback to cache, cache-first
   tiles/CDN/Wikimedia images with caps), `js/pwa.js` (register, install button, `storage.persist`, online state).
   **Adding/renaming a file in js/, css/ or icons/? Add it to `PRECACHE` in sw.js** — `tests/pwa.test.mjs` enforces it.
   Bump `VERSION` in sw.js only to force-drop old app caches.
3. ✅ **Search to add places** (Photon) and **Discover** (Wikidata) — hosted only.
4. **Sync between devices**: share links are done (`js/share.js`: trip → deflate → base64url in `#t=…`,
   never sent to a server; opening offers add / update / keep both, using `editedAt` vs `sharedAt`).
   Next step would be live sync via a tiny backend.
5. **Sunrise/sunset** computed from `center` + date instead of the manual `sunset` field.
6. **Real routing** (OSRM / Google Directions) to replace estimates, cached per hop.
7. Weather per day, budget/costs per stop, packing list, notes per day.
8. Playwright UI tests (drag, add place, Now preview).
