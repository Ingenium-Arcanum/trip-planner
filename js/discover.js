// Pure helpers for finding places online: turning OpenStreetMap search results,
// Wikidata "famous places nearby" and OSM opening_hours into trip data.
// No DOM, no fetch — the network calls live in net.js. Tested in tests/discover.test.mjs.

/* ---------- OpenStreetMap tags -> category ---------- */
const OSM_CAT = {
  'amenity:pub': 'pub', 'amenity:bar': 'pub', 'amenity:biergarten': 'pub', 'amenity:nightclub': 'music',
  'amenity:cafe': 'cafe', 'amenity:ice_cream': 'cafe',
  'amenity:restaurant': 'food', 'amenity:fast_food': 'food', 'amenity:food_court': 'food',
  'amenity:place_of_worship': 'church', 'amenity:theatre': 'music', 'amenity:concert_hall': 'music',
  'amenity:arts_centre': 'music', 'amenity:cinema': 'activity', 'amenity:library': 'museum',
  'amenity:bus_station': 'transport', 'amenity:ferry_terminal': 'transport', 'amenity:marketplace': 'shop',
  'tourism:museum': 'museum', 'tourism:gallery': 'museum', 'tourism:attraction': 'sight', 'tourism:artwork': 'sight',
  'tourism:viewpoint': 'nature', 'tourism:zoo': 'activity', 'tourism:aquarium': 'activity', 'tourism:theme_park': 'activity',
  'tourism:hotel': 'hotel', 'tourism:hostel': 'hotel', 'tourism:guest_house': 'hotel', 'tourism:motel': 'hotel',
  'tourism:apartment': 'hotel', 'tourism:camp_site': 'hotel',
  'leisure:park': 'park', 'leisure:garden': 'park', 'leisure:nature_reserve': 'nature', 'leisure:stadium': 'activity',
  'building:cathedral': 'church', 'building:church': 'church', 'building:train_station': 'transport',
  'aeroway:aerodrome': 'transport', 'aeroway:terminal': 'transport'
};
const OSM_KEY_CAT = { historic: 'sight', shop: 'shop', natural: 'nature', railway: 'transport', public_transport: 'transport', aeroway: 'transport', waterway: 'nature', mountain_pass: 'nature' };

export function osmCat(key, value) {
  return OSM_CAT[key + ':' + value] || OSM_KEY_CAT[key] || 'other';
}

/** Human label for an OSM key/value, e.g. amenity/pub -> "Pub". */
export const osmLabel = (key, value) => String(value || key || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/** Photon (photon.komoot.io) GeoJSON feature -> place draft (no id). */
export function photonToPlace(f) {
  const p = f.properties || {}, [lng, lat] = f.geometry?.coordinates || [];
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const town = p.city || p.town || p.village || p.county || '';
  const name = p.name || street || town || 'Unnamed place';
  const addr = [street, town !== name ? town : '', p.country].filter(Boolean).join(', ');
  return {
    name, cat: osmCat(p.osm_key, p.osm_value), lat, lng,
    addr, kind: osmLabel(p.osm_key, p.osm_value),
    q: [name, street, town].filter((x, i, a) => x && a.indexOf(x) === i).join(', '),
    osm: p.osm_type && p.osm_id ? p.osm_type + p.osm_id : undefined
  };
}

/* ---------- OSM opening_hours -> { '0'..'6': ['HH:MM-HH:MM'] } ---------- */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_RE = /^(Mo|Tu|We|Th|Fr|Sa|Su)(-(Mo|Tu|We|Th|Fr|Sa|Su))?$/;
const TIME_RE = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/;
const pad = n => String(n).padStart(2, '0');

function daySet(sel) {
  const out = new Set();
  for (const part of sel.split(',')) {
    const m = part.trim().match(DAY_RE);
    if (!m) return null;
    const a = DAYS.indexOf(m[1]), b = m[3] ? DAYS.indexOf(m[3]) : a;
    // Week order is Mo..Su; walk forward from a to b wrapping around Sunday.
    for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === b) break; }
  }
  return out;
}

/**
 * Parse the common subset of OSM opening_hours ("Mo-Fr 09:00-17:30; Sa,Su 10:00-16:00", "24/7",
 * "Mo off", overnight "18:00-02:00"). Public-holiday rules ("PH off") are skipped.
 * Returns null for anything more exotic (months, weeks, sunrise, comments…) — keep it as text then.
 */
export function parseOpeningHours(s) {
  if (!s || typeof s !== 'string') return null;
  s = s.trim();
  if (s === '24/7') return Object.fromEntries(DAYS.map((_, d) => [String(d), ['00:00-24:00']]));
  const week = {};
  let any = false;
  for (let rule of s.split(';')) {
    rule = rule.trim();
    if (!rule) continue;
    if (/^PH\b|^SH\b/.test(rule)) continue;
    const m = rule.match(/^([A-Za-z,\- ]+?)?\s*((?:\d{1,2}:\d{2}-\d{1,2}:\d{2}\+?\s*,?\s*)+|off|closed)$/);
    if (!m) return null;
    let sel = (m[1] || '').trim().replace(/\s+/g, '');
    sel = sel.replace(/,?PH$/, '');
    const days = sel ? daySet(sel) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days) return null;
    let ranges = [];
    if (!/^(off|closed)$/.test(m[2])) {
      for (const t of m[2].split(',').map(x => x.trim()).filter(Boolean)) {
        const tm = t.match(TIME_RE);
        if (!tm) return null;
        let a = +tm[1] * 60 + +tm[2], b = +tm[3] * 60 + +tm[4];
        if (b <= a) b += 1440; // past midnight
        ranges.push(`${pad(Math.floor(a / 60))}:${pad(a % 60)}-${pad(Math.floor(b / 60))}:${pad(b % 60)}`);
      }
    }
    for (const d of days) { week[d] = ranges; any = true; }
  }
  if (!any) return null;
  const out = {};
  for (const [d, r] of Object.entries(week)) if (r.length) out[d] = r;
  return out;
}

/** "Mo-Fr 09:00-17:30" -> "Mon–Fri 9:00–17:30" (readable, best effort). */
export function prettyHours(s) {
  if (!s) return '';
  const names = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun', PH: 'holidays' };
  return s.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, m => names[m]).replace(/-/g, '–').replace(/;\s*/g, ' · ').replace(/\b0(\d):/g, '$1:');
}

/* ---------- Wikidata: famous places around a point ---------- */

/**
 * SPARQL for query.wikidata.org: things with coordinates within `km` of the point, that sit in an
 * administrative area (so not events or companies) and still exist, ranked by how many
 * Wikipedias write about them (a good "how famous is this" signal). Towns, airports etc. are
 * filtered afterwards in classifySight — doing that in SPARQL made big radii take 40+ s.
 */
export function sightsQuery(lat, lng, km = 8, lang = 'en', limit = 300, minLinks = km >= 15 ? 10 : 6) {
  return `SELECT ?item ?itemLabel ?itemDescription ?coord ?links ?img ?article ?site
 (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/"); separator=",") AS ?classes) WHERE {
  SERVICE wikibase:around { ?item wdt:P625 ?coord . bd:serviceParam wikibase:center "Point(${+lng} ${+lat})"^^geo:wktLiteral . bd:serviceParam wikibase:radius "${+km}" . }
  ?item wikibase:sitelinks ?links . FILTER(?links >= ${+minLinks})
  ?item wdt:P131 [] .
  FILTER NOT EXISTS { ?item wdt:P576 [] }
  FILTER NOT EXISTS { ?item wdt:P585 [] }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://${lang}.wikipedia.org/> . }
  OPTIONAL { ?item wdt:P18 ?img }
  OPTIONAL { ?item wdt:P856 ?site }
  OPTIONAL { ?item wdt:P31 ?c }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en". }
} GROUP BY ?item ?itemLabel ?itemDescription ?coord ?links ?img ?article ?site ORDER BY DESC(?links) LIMIT ${+limit}`;
}

/** Wikidata classes (P31) that decide the category outright. */
const WD_CLASS = {
  Q33506: 'museum', Q207694: 'museum', Q17431399: 'museum', Q1007870: 'museum', Q7075: 'museum', Q2772772: 'museum',
  Q16970: 'church', Q2977: 'church', Q56242250: 'church', Q56242215: 'church', Q32815: 'church', Q34627: 'church',
  Q44539: 'church', Q160742: 'church', Q108325: 'church', Q44613: 'church',
  Q22698: 'park', Q22746: 'park', Q167346: 'park', Q1107656: 'park', Q5003624: 'park',
  Q24354: 'music', Q1060829: 'music', Q153562: 'music', Q708676: 'music',
  Q43501: 'activity', Q2281788: 'activity', Q194195: 'activity',
  Q187456: 'pub', Q5526883: 'pub', Q131734: 'pub', Q11707: 'food', Q30022: 'cafe',
  Q8502: 'nature', Q40080: 'nature', Q23397: 'nature', Q179049: 'nature'
};
const DESC_CAT = [
  [/museum|gallery|exhibition/, 'museum'],
  [/\b(church|cathedral|mosque|synagogue|temple|abbey|chapel|basilica|monastery|minster)\b/, 'church'],
  [/\b(pub|bar|tavern|inn|brewery|distillery)\b/, 'pub'],
  [/\b(restaurant|food market)\b/, 'food'],
  [/\b(caf[eé]|coffee ?house)\b/, 'cafe'],
  [/\b(theat(re|er)|concert hall|opera|music venue)\b/, 'music'],
  [/\b(zoo|aquarium|amusement park|theme park)\b/, 'activity'],
  [/(?<!car |business |industrial |sporting )\b(park|gardens?)\b/, 'park'],
  [/\b(beach|mountain|cliffs?|nature reserve|lake|peninsula|hill)\b/, 'nature'],
  [/\b(shopping|department store|market)\b/, 'shop']
];
/** Not a place you'd visit as a tourist (applied only when nothing above matched). */
const NOT_A_SIGHT = /railway|train station|bus station|\bstation\b|tram stop|^(public |technological )?university|higher education|\bschool\b|hospital|province|\bcounty\b|\bport of\b|tunnel|apartment|power station|generating station|central bank|public body|academy of|\binstitution\b|conservatory|^proposed|^prison|residence (in|of)|official residence|headquarters|civil parish|^district|suburb|sporting field|cricket|convention cent|controls the|recording studio|archive|office building|company|organi[sz]ation|stock exchange|\bregion\b|\bnuts\b|municipality|metropolitan area|parish of|road traffic|motorway|^canal|^river/;
/** Towns and areas, transport, events and institutions — checked before anything else. */
const PLACE_OR_THING = /^\d{3,4}\b|\b(fire|attack|bombing|riot|protest|siege|uprising|election|rebellion) (at|in|of|on)\b|arrondissement|borough of|ward of|administrative (district|division|area)|learned society|^(the )?(capital|(largest |french |italian |spanish |german |dutch )?(city(?! (hall|district|gate|walls?|park|museum|cent(re|er)|library|square))|town(?! hall)|village|commune|municipality|department(?! store)))\b(?! district)|\b(city|town|village|commune|municipality|department|county|region|state|country|island nation) (in|of)\b|\bdepartment of\b|^(international )?airport|airport serv|transport system|rapid transit|light rail|metro system|tram network|bus network|tournament|championship|marathon|festival|engineering college|polytechnic|business school|^(public |private |technological |research )?university|\bairline\b/;
/** Neighbourhoods are worth it only when famous (Alfama, Montmartre, Temple Bar). */
const AREA = /neighbo(u)?rhood|city district|district of|quarter of|historic quarter|\bquarter\b|\barea of\b/;
const STREETISH = /\b(road|street|avenue|boulevard|square|lane)\b/;
const SPORTS = /\b(stadium|sports venue|arena|racecourse)\b/;

/** Category for a Wikidata hit, or null if it isn't worth showing. */
export function classifySight({ desc = '', classes = [], links = 0 }) {
  const d = desc.toLowerCase();
  if (PLACE_OR_THING.test(d)) return null;
  if (/\buniversity\b/.test(d) && !/college|library|museum/.test(d)) return null;
  for (const c of classes) if (WD_CLASS[c]) return WD_CLASS[c];
  for (const [re, cat] of DESC_CAT) if (re.test(d)) return cat;
  if (AREA.test(d)) return links >= 15 ? 'sight' : null;
  if (NOT_A_SIGHT.test(d)) return null;
  if (SPORTS.test(d)) return null; // famous on Wikipedia, rarely a sight (search them if you want a tour)
  if (STREETISH.test(d)) return links >= 15 ? 'sight' : null;
  return 'sight';
}

const commonsThumb = (url, w = 400) => url ? url.replace(/^http:/, 'https:') + '?width=' + w : undefined;

/** SPARQL JSON -> [{ wd, name, desc, lat, lng, links, img, wiki, site, cat }] sorted by fame. */
export function parseSights(json) {
  const seen = new Map();
  for (const b of json?.results?.bindings || []) {
    const wd = b.item.value.split('/').pop();
    if (seen.has(wd)) continue;
    const m = (b.coord?.value || '').match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/);
    if (!m) continue;
    const name = b.itemLabel?.value || '';
    if (!name || /^Q\d+$/.test(name)) continue; // no label in this language
    const desc = b.itemDescription?.value || '';
    const classes = (b.classes?.value || '').split(',').filter(Boolean);
    const links = +b.links?.value || 0;
    if (/arrondissement|\bborough\b|\bdistrict$/i.test(name)) continue; // admin areas named like places
    const cat = classifySight({ desc, classes, links });
    if (!cat) continue;
    seen.set(wd, {
      wd, name, desc, lat: +m[2], lng: +m[1], links, cat,
      img: commonsThumb(b.img?.value), wiki: b.article?.value, site: b.site?.value
    });
  }
  return [...seen.values()].sort((a, b) => b.links - a.links);
}

/** "Ajuda Palace, Lisbon" -> "Ajuda Palace" when the trip is in Lisbon. */
export function shortName(name, city) {
  if (!city) return name;
  const c = city.split(',')[0].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return name.replace(new RegExp(`(,\\s*${c}|\\s*\\(${c}\\))$`, 'i'), '') || name;
}

/** Draft a trip place from a Wikidata sight (description can be upgraded later from Wikipedia). */
export function sightToPlace(s, city) {
  return {
    name: shortName(s.name, city), cat: s.cat, lat: s.lat, lng: s.lng,
    desc: s.desc ? s.desc.charAt(0).toUpperCase() + s.desc.slice(1) + '.' : undefined,
    url: s.site || s.wiki, wiki: s.wiki, wd: s.wd, img: s.img
  };
}

const STOPWORDS = new Set(['the', 'and', 'of', 'de', 'la', 'le', 'les', 'du', 'des', 'der', 'die', 'das', 'het', 'van', 'del', 'saint', 'sankt', 'street', 'road', 'city', 'great', 'little', 'national', 'royal', 'house', 'square']);
const words = (s, skip) => new Set(String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOPWORDS.has(w) && !skip.has(w)));
const km = (a, b) => {
  const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371;
};

/**
 * Is a found place already in the trip? Same Wikidata/OSM id, or close by (≤250 m) with a
 * distinctive word in common ("Lisbon Castle & Alfama" ≈ "Castle of Saint George").
 */
export function findExisting(trip, cand) {
  const skip = words(trip.destination || '', new Set());
  const cw = words(cand.name || '', skip);
  return Object.values(trip.places).find(p => {
    if ((cand.wd && p.wd === cand.wd) || (cand.osm && p.osm === cand.osm)) return true;
    if (p.lat == null || cand.lat == null || !p.name || !cand.name || km(p, cand) > 0.25) return false;
    if (p.name.toLowerCase() === cand.name.toLowerCase()) return true;
    for (const w of words(p.name, skip)) if (cw.has(w)) return true;
    return false;
  }) || null;
}

/** Drop near-duplicate search hits (OSM often has a station, its platforms and tram stop). */
export function dedupeFound(list) {
  const out = [];
  for (const x of list) {
    if (out.some(o => o.name.toLowerCase() === x.name.toLowerCase() && km(o, x) < 0.5)) continue;
    out.push(x);
  }
  return out;
}
