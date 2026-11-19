// Sunrise / sunset from a position and a date (pure, no DOM — tested in Node).
// NOAA's simplified solar position formulas: accurate to about a minute at mid latitudes,
// which is plenty for "will it be dark when we get to the park?".

const RAD = Math.PI / 180;

/**
 * Sunrise and sunset for `date` ('YYYY-MM-DD') at lat/lng, in minutes after midnight UTC
 * (can be negative or ≥ 1440 far from Greenwich). { polar: 'day' | 'night' } when the sun
 * doesn't rise or set that day.
 */
export function sunTimesUtc(lat, lng, date) {
  const [y, m, d] = date.split('-').map(Number);
  const doy = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
  const g = 2 * Math.PI / 365 * (doy - 1 + 0.5);                       // fractional year at noon
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));        // equation of time, min
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
  if (cosH > 1) return { polar: 'night' };
  if (cosH < -1) return { polar: 'day' };
  const ha = Math.acos(cosH) / RAD;
  const noon = 720 - 4 * lng - eqt;
  return { rise: noon - 4 * ha, set: noon + 4 * ha };
}

/** Minutes after local midnight in time zone `tz` for `utcMin` minutes after UTC midnight of `date`. */
export function toLocalMin(utcMin, date, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d) + Math.round(utcMin) * 60000);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(at).map(x => [x.type, x.value]));
  const dayShift = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day) - Date.UTC(y, m - 1, d)) / 864e5);
  return dayShift * 1440 + Number(p.hour) * 60 + Number(p.minute);
}

const hhmm = min => { const r = Math.round(min); return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`; };

/**
 * Sunset for a trip day as 'HH:MM' local time: the time typed on the day (day.sunset) wins,
 * otherwise it's computed from trip.center and the trip's time zone.
 * Returns { time, auto } or null (no position yet, or no sunset that day).
 */
export function sunsetFor(trip, day) {
  if (day?.sunset) return { time: day.sunset, auto: false };
  const c = trip?.center;
  if (!day?.date || !Array.isArray(c) || c[0] == null) return null;
  try {
    const s = sunTimesUtc(c[0], c[1], day.date);
    if (s.polar) return null;
    const min = toLocalMin(s.set, day.date, trip.tz);
    return min > 0 && min < 1440 ? { time: hhmm(min), auto: true } : null;
  } catch (e) { return null; } // unknown time zone
}

/** Categories that are no fun in the dark. */
export const OUTDOOR = new Set(['park', 'nature']);

/**
 * A note for an outdoor stop that runs into darkness: 'After dark' when you get there after
 * sunset, 'Gets dark at …' when sunset falls well inside the visit. null otherwise.
 */
export function darkNote(cat, arr, end, sunsetMin) {
  if (sunsetMin == null || !OUTDOOR.has(cat)) return null;
  if (arr >= sunsetMin) return `After dark (sunset ${hhmm(sunsetMin)})`;
  if (end > sunsetMin + 15) return `Gets dark at ${hhmm(sunsetMin)}`;
  return null;
}
