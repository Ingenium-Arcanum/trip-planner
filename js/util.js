// Small, dependency-free helpers shared by every module.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Math.random().toString(36).slice(2, 9);
export const clone = o => JSON.parse(JSON.stringify(o));

/** "09:30" -> 570 (minutes since midnight). Empty/null -> null. */
export const toMin = t => {
  if (t == null || t === '') return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
};
/** 570 -> "09:30". Past midnight gets a ⁺ marker. */
export const fmt = m => {
  m = Math.round(m);
  const d = Math.floor(m / 1440);
  m = ((m % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') + (d > 0 ? '⁺' : '');
};
/** 95 -> "1 h 35 min" */
export const dur = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;

export const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO date "2030-06-01" -> {wd, d, m, y} (timezone-free) */
export function dateParts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { wd: dt.getUTCDay(), d, m: m - 1, y };
}
export const isoAddDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 864e5).toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => {
  const t = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 864e5);
};
export const dayName = day => WD[dateParts(day.date).wd];
export const dayShort = day => { const p = dateParts(day.date); return `${WD[p.wd].slice(0, 3)} ${p.d}`; };
export const dayLong = day => { const p = dateParts(day.date); return `${WD[p.wd]} ${p.d} ${MON[p.m]}`; };

/** Current date + minute in a given IANA timezone. */
export function nowIn(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 1800);
}

/** Safe localStorage wrappers — storage can be missing or throw (private mode, sandboxes). */
export const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  ok() { try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); return true; } catch (e) { return false; } }
};
