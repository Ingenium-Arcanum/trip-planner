// App-wide constants. Nothing trip-specific belongs here.

export const DAY_COLORS = ['#0f7a5f', '#c2502e', '#3c5fb0', '#9a4fb0', '#b0862a', '#2a8fa0', '#b03c6a'];
export const dayColor = i => DAY_COLORS[i % DAY_COLORS.length];

/** Place categories: emoji, label, cover gradient, default visit length (min). */
export const CATS = {
  sight:     { e: '🏛️', l: 'Sight',     g: ['#5a7d9a', '#2f4b63'], dur: 45 },
  museum:    { e: '🖼️', l: 'Museum',    g: ['#8a5a8a', '#4b2f55'], dur: 75 },
  pub:       { e: '🍺', l: 'Pub / bar', g: ['#b5772a', '#5a3410'], dur: 60 },
  food:      { e: '🍽️', l: 'Food',      g: ['#c0603a', '#6b2a16'], dur: 60 },
  cafe:      { e: '☕', l: 'Café',      g: ['#a0724a', '#4f3420'], dur: 30 },
  park:      { e: '🌳', l: 'Park',      g: ['#5c9a5a', '#2b5a30'], dur: 30 },
  music:     { e: '🎻', l: 'Music',     g: ['#7a5cb0', '#3a2a6b'], dur: 90 },
  shop:      { e: '🛍️', l: 'Shopping',  g: ['#c0507a', '#6b2240'], dur: 30 },
  church:    { e: '⛪', l: 'Church',    g: ['#7d7a6a', '#3f3d33'], dur: 15 },
  activity:  { e: '🎟️', l: 'Activity',  g: ['#2a8fa0', '#14505a'], dur: 90 },
  nature:    { e: '⛰️', l: 'Nature',    g: ['#4f8a6a', '#1f4a36'], dur: 120 },
  transport: { e: '🚆', l: 'Transport', g: ['#5b6478', '#2b3140'], dur: 10 },
  hotel:     { e: '🛏️', l: 'Stay',      g: ['#4a7f8a', '#1f4249'], dur: 0 },
  other:     { e: '📍', l: 'Other',     g: ['#7a8580', '#3a423e'], dur: 45 }
};
export const cat = p => CATS[p?.cat] || CATS.other;

/** Travel modes and the speed model used for estimates (km/h, detour factor, fixed overhead min). */
export const MODES = {
  walk:    { e: '🚶', l: 'walk',    gmaps: 'walking',   kmh: 4.8, detour: 1.25, overhead: 0 },
  transit: { e: '🚆', l: 'transit', gmaps: 'transit',   kmh: 20,  detour: 1.3,  overhead: 12 },
  taxi:    { e: '🚕', l: 'taxi',    gmaps: 'driving',   kmh: 25,  detour: 1.3,  overhead: 6 },
  bike:    { e: '🚲', l: 'bike',    gmaps: 'bicycling', kmh: 14,  detour: 1.25, overhead: 2 }
};
/** Auto mode walks up to this distance (km, straight line), otherwise assumes transit. */
export const WALK_MAX_KM = 2.3;

export const STORAGE = {
  index: 'tp.trips',          // [{id,title,destination,start,end,updated}]
  trip: id => 'tp.trip.' + id, // full trip object
  last: 'tp.lastTrip',
  legacy: 'trip-planner.state.v1' // single-trip format from the first prototype
};

/** Text inside a map pin for a timeline row: number, ✓ when done, or an icon for hotel/arrival/departure. */
export const pinText = r => r.st.virtual ? cat(r.place).e : r.st.done ? '✓' : (r.n ?? '');
