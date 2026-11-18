# Trip Planner

A small, offline-first trip planner for city trips. Plan each day as a timeline of stops,
see it on a map, and follow it live on your phone ("where should I be now?").

- **Multi-trip** — any destination: type a city and it shows its top sights.
- **Search & Discover** — find places by name, or browse the most famous sights nearby and add them to a day.
- **Hotels & travel** — set arrival, hotels and departure; every day starts and ends there.
- **Day timelines** — durations + travel estimates; 📌 fixed booking times; the rest flows around them.
- **Drag to reorder**, move stops between days, “add where it fits best on the route”.
- **Opening-hours warnings** per weekday.
- **Now screen** — current/next stop, *I’m here now*, *+15 min*, *done, move on*.
- **Map** — real OpenStreetMap tiles when available, a schematic SVG fallback otherwise.
- **Your photos** per place (IndexedDB, stays on the device).
- **Backup / import** a trip as JSON to move it between devices.

No build step, no framework, no dependencies at runtime except Leaflet (lazy-loaded from cdnjs).

## Run it

```bash
npm start            # serves the folder on http://localhost:8080 (npx http-server)
# or
python3 -m http.server 8080
```

ES modules need to be served over http(s) — opening `index.html` from disk won’t work.

## Test

```bash
npm test             # node --test: scheduling engine, hours, travel, parsing
```

## Project layout

```
index.html              shell; loads css/app.css and js/main.js
css/app.css             all styles (light + dark via prefers-color-scheme)
js/
  main.js               entry: init photo DB, start app
  app.js                shell, renderAll(), every user action, drag & drop, boot
  state.js              shared ctx (trip + ui state), commit()/save()
  store.js              trips in localStorage, templates, import/export, migration
  schedule.js           PURE scheduling engine (computeDay, hoursCheck, bestIndex…)
  geo.js                haversine, coordinate parsing, local projection
  links.js              Google Maps / image-search deep links
  photos.js             IndexedDB photo storage
  config.js             categories, travel modes + speed model, colours, storage keys
  sheets.js             bottom-sheet dialogs (stop, place, edit, travel, picker, menu…)
  views/                plan, now, ideas, home + shared components
  map/index.js          picks a map adapter
  map/tiles.js          Leaflet + OSM adapter
  map/schematic.js      SVG adapter drawing trip.basemap
trips/index.json        list of bundled templates
trips/<id>/trip.json    a template trip (see schema/trip.schema.json)
trips/<id>/basemap.json optional schematic map data for that city
schema/                 JSON Schema for trip files
tests/                  node:test unit tests
```

## Adding a new ready-made trip

1. Create `trips/<id>/trip.json` (see `schema/trip.schema.json`; places can be a list).
2. Optionally add `basemap.json` (only used by the schematic map).
3. Add an entry to `trips/index.json`.

Users can also just create trips in the app (Home → New trip) — no files needed.
