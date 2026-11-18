// Geometry helpers (no DOM).

/** Great-circle distance in km between {lat,lng} points. */
export function hav(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Pull coordinates out of free text: "53.34, -6.26", or Google Maps URLs
 * (…/@53.34,-6.26,17z  or  ?q=53.34,-6.26).
 */
export function parseCoords(s) {
  if (!s) return null;
  const m = s.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/)
    || s.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+)(?:%2C|,)\s*(-?\d+\.\d+)/)
    || s.match(/(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Local equirectangular projection in metres around an origin — fine at city scale. */
export function projection(origin) {
  const k = Math.cos(origin.lat * Math.PI / 180);
  return {
    toXY: (lat, lng) => [(lng - origin.lng) * 111320 * k, -(lat - origin.lat) * 110540],
    toLL: (x, y) => ({ lat: origin.lat - y / 110540, lng: origin.lng + x / (111320 * k) })
  };
}

export function centroid(points) {
  const pts = points.filter(p => p && p.lat != null);
  if (!pts.length) return null;
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
}

/** Key for a hop in trip.routes: from → to, coordinates rounded to ~1 m (moving a place = new key). */
export const routeKey = (a, b) => `${(+a.lat).toFixed(5)},${(+a.lng).toFixed(5)}>${(+b.lat).toFixed(5)},${(+b.lng).toFixed(5)}`;
