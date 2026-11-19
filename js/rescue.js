// Running-late helper. When a day's plan says you'll be late for a booking (a stop with a fixed
// time) or for your departure, try concrete fixes, check each one by recalculating the day(s), and
// return the least disruptive ones that actually work. Pure — no DOM (tests/rescue.test.mjs).

import { clone, dayShort as dayLabel } from './util.js';
import { computeDay, findStop, estimate, bestIndex } from './schedule.js';

const MIN_SHARE = 0.4;   // never shorten a visit below 40 % of its planned time…
const MIN_MINUTES = 15;  // …or below 15 minutes
const up5 = m => Math.ceil(m / 5) * 5;

/** Apply fix operations to a trip (mutates it). Ops are plain objects, so a fix can be shown and applied later. */
export function applyOps(trip, ops) {
  for (const o of ops) {
    const f = findStop(trip, o.stop);
    if (!f) continue;
    if (o.op === 'dur') f.st.dur = o.dur;
    else if (o.op === 'mode') { f.st.mode = o.mode; f.st.min = null; }
    else if (o.op === 'remove' && !f.virtual) trip.days[f.di].stops.splice(f.i, 1);
    else if (o.op === 'move' && !f.virtual) {
      const [st] = trip.days[f.di].stops.splice(f.i, 1);
      const day = trip.days[o.toDi];
      const idx = o.after ? day.stops.findIndex(s => s.id === o.after) + 1 : bestIndex(trip, o.toDi, trip.places[st.place]);
      day.stops.splice(Math.max(0, idx), 0, st);
    }
  }
  return trip;
}

const lateIn = rows => rows.reduce((s, r) => s + (r.late || 0), 0);
const warnsIn = rows => rows.filter(r => r.warn).length;
function totals(trip) {
  let late = 0, warns = 0;
  trip.days.forEach((_, di) => { const rs = computeDay(trip, di); late += lateIn(rs); warns += warnsIn(rs); });
  return { late, warns };
}

/**
 * How much room a booking needs before it counts as safely on time: walks without a real route
 * are straight-line estimates and can be ~20% longer once the route is known.
 */
function slack(rows, target) {
  let m = 0;
  // walk back from the booking; a place where you'd wait absorbs any delay before it
  for (let k = rows.indexOf(target); k > 0; k--) {
    const r = rows[k];
    if (r !== target && r.wait > 0) break;
    if (r.tr && r.tr.mode === 'walk' && !r.tr.routed && !r.tr.manual) m += r.tr.min * 0.2;
  }
  return Math.round(m);
}

/** The first late row of day `di` at or after row index `from`, or null. */
export function firstProblem(trip, di, from = 0) {
  const rows = computeDay(trip, di);
  const i = rows.findIndex((r, k) => k >= from && r.late > 0);
  return i < 0 ? null : { rows, index: i, row: rows[i] };
}

/**
 * Suggest fixes for the first lateness in day `di`.
 *  opts.from  first row index you can still change (live: the stop you're at / heading to)
 *  opts.keep  { stopId: minutes } minimum time for a stop (live: time already spent there)
 *  opts.minDay  don't move stops to days before this index (live: today)
 * Returns null when nothing is late, else
 *  { target: { id, name, late, fixed, arr, kind:'booking'|'depart' }, options: [ { kind, label, ops, full, after:{late, arr}, newWarn } ] }
 */
export function suggestFixes(trip, di, { from = 0, keep = {}, minDay = 0, max = 3 } = {}) {
  const prob = firstProblem(trip, di, from);
  if (!prob) return null;
  const { rows, index: ti, row: target } = prob;
  const late = target.late;
  const base = totals(trip);
  const name = r => trip.places[r.st.place]?.name || 'this stop';

  const options = [];
  const consider = (kind, label, ops, cost) => {
    const t = applyOps(clone(trip), ops);
    const rs = computeDay(t, di);
    const tr = rs.find(r => r.st.id === target.st.id);
    const now = tr ? tr.late : 0;
    if (now >= late) return;                                   // doesn't help
    const all = totals(t);
    if (all.late - now > base.late - late) return;             // makes something else late
    const newWarn = all.warns > base.warns;                    // e.g. now arrives after closing time
    const tight = now === 0 && tr.wait < slack(rs, tr);        // on time only if the estimated walks are right
    options.push({ kind, label, ops, full: now === 0, tight, after: { late: now, arr: tr?.arr }, newWarn,
      cost: cost + (now > 0 ? 200 + now * 5 : 0) + (newWarn ? 40 : 0) + (tight ? 25 : 0) });
  };

  // Stops you could change: after `from`, before the problem, not booked, not must-do, not done.
  const flex = rows.slice(from, ti).filter(r => !r.st.virtual && !r.st.fixed && !r.st.must && !r.st.done && (r.st.dur || 0) > 0);
  const minDur = r => Math.max(MIN_MINUTES, up5((r.st.dur || 0) * MIN_SHARE), keep[r.st.id] || 0);
  // Cut a little extra when the walks are estimates (they can turn out longer), if there's room for it.
  const exact = up5(late), padded = up5(late + slack(rows, target));
  const cutCost = c => exact + (c - exact) * 0.3;              // the extra is insurance, not a real loss

  // 1. Spend less time at one place (prefer the one where the cut hurts least, relatively).
  flex.map(r => ({ r, cut: [padded, exact].find(c => r.st.dur - c >= minDur(r)) }))
    .filter(x => x.cut)
    .sort((a, b) => a.cut / a.r.st.dur - b.cut / b.r.st.dur)
    .slice(0, 2)
    .forEach(({ r, cut }) => consider('shorten', `Spend ${cut} min less at ${name(r)}`, [{ op: 'dur', stop: r.st.id, dur: r.st.dur - cut }], cutCost(cut) * (1 + exact / r.st.dur)));

  // 2. Spread the cut over several visits.
  const room = flex.map(r => ({ r, can: Math.max(0, r.st.dur - minDur(r)) })).filter(x => x.can >= 5);
  const roomTotal = room.reduce((s, x) => s + x.can, 0);
  const cut = roomTotal >= padded ? padded : exact;
  if (room.length >= 2 && roomTotal >= late) {
    let left = cut;
    const ops = room.map(({ r, can }, i) => {
      const take = i === room.length - 1 ? Math.min(can, left) : Math.min(can, up5(cut * can / roomTotal));
      left -= take;
      return { op: 'dur', stop: r.st.id, dur: r.st.dur - take };
    }).filter((o, i) => o.dur !== room[i].r.st.dur);
    if (ops.length >= 2) consider('spread', `Shorten ${ops.length} visits a little (${cut} min in total)`, ops, cutCost(cut) * 0.9);
  }

  // 3. Take a taxi for a hop (one hop if that's enough, else every hop that saves time).
  const hops = rows.slice(Math.max(1, from), ti + 1)
    .filter(r => r.tr && !r.tr.manual && r.tr.mode !== 'taxi')
    .map(r => ({ r, save: r.tr.min - estimate('taxi', r.tr.d) }))
    .filter(h => h.save >= 5)
    .sort((a, b) => b.save - a.save);
  const oneTaxi = hops.find(h => h.save >= late);
  if (oneTaxi) consider('taxi', `Take a taxi to ${name(oneTaxi.r)} (saves ~${oneTaxi.save} min)`, [{ op: 'mode', stop: oneTaxi.r.st.id, mode: 'taxi' }], 15);
  else if (hops.length >= 2) consider('taxi', `Take taxis for ${hops.length} trips (saves ~${hops.reduce((s, h) => s + h.save, 0)} min)`,
    hops.map(h => ({ op: 'mode', stop: h.r.st.id, mode: 'taxi' })), 15 + 5 * hops.length);
  else if (hops.length === 1) consider('taxi', `Take a taxi to ${name(hops[0].r)} (saves ~${hops[0].save} min)`, [{ op: 'mode', stop: hops[0].r.st.id, mode: 'taxi' }], 15);

  for (const r of flex) {
    // 4. Do it after the booking instead.
    if (!target.st.virtual) consider('later', `Visit ${name(r)} after ${name(target)} instead`, [{ op: 'move', stop: r.st.id, toDi: di, after: target.st.id }], 12 + r.st.dur / 4);
    // 5. Move it to another day.
    trip.days.forEach((d, odi) => {
      if (odi === di || odi < minDay) return;
      consider('day', `Move ${name(r)} to ${dayLabel(d)}`, [{ op: 'move', stop: r.st.id, toDi: odi }], 30 + r.st.dur / 4 + Math.abs(odi - di));
    });
    // 6. Skip it (the place stays in your Ideas).
    consider('skip', `Skip ${name(r)} (it stays in your ideas)`, [{ op: 'remove', stop: r.st.id }], 40 + r.st.dur / 3);
  }

  // Best option per kind, then the cheapest few — so you get different kinds of choices.
  const best = new Map();
  for (const o of options.sort((a, b) => a.cost - b.cost)) if (!best.has(o.kind)) best.set(o.kind, o);
  return {
    target: { id: target.st.id, name: name(target), late, fixed: target.st.fixed, arr: target.arr, kind: target.st.virtual ? 'depart' : 'booking' },
    options: [...best.values()].sort((a, b) => a.cost - b.cost).slice(0, max)
  };
}
