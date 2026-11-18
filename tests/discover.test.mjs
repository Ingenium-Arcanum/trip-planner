import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpeningHours, prettyHours, classifySight, parseSights, photonToPlace, osmCat, findExisting, sightsQuery, shortName, dedupeFound } from '../js/discover.js';
import { hoursCheck } from '../js/schedule.js';

test('opening_hours: weekday ranges, lists and overrides', () => {
  assert.deepEqual(parseOpeningHours('Mo-Fr 09:30-17:30; Sa 09:30-18:00; Su 09:30-17:00'), {
    1: ['09:30-17:30'], 2: ['09:30-17:30'], 3: ['09:30-17:30'], 4: ['09:30-17:30'], 5: ['09:30-17:30'],
    6: ['09:30-18:00'], 0: ['09:30-17:00']
  });
  const h = parseOpeningHours('Mo-Su 10:00-18:00; Mo off');
  assert.equal(h['1'], undefined, 'Monday closed');
  assert.deepEqual(h['2'], ['10:00-18:00']);
  assert.deepEqual(parseOpeningHours('Tu,Th 12:00-14:00,18:00-22:00')['4'], ['12:00-14:00', '18:00-22:00']);
  assert.deepEqual(parseOpeningHours('10:00-16:00')['0'], ['10:00-16:00'], 'no day selector = every day');
});

test('opening_hours: 24/7, past midnight, wrap-around, holidays, unsupported', () => {
  assert.deepEqual(parseOpeningHours('24/7')['3'], ['00:00-24:00']);
  const pub = parseOpeningHours('Mo-Th 12:00-23:30; Fr,Sa 12:00-00:30; Su 12:30-23:00');
  assert.deepEqual(pub['5'], ['12:00-24:30']);
  assert.equal(hoursCheck({ hours: pub }, 6, 23 * 60 + 45, 24 * 60 + 15), null, 'open after midnight on Saturday');
  assert.deepEqual(Object.keys(parseOpeningHours('Sa-Mo 10:00-12:00')).sort(), ['0', '1', '6']);
  assert.ok(parseOpeningHours('Mo-Fr 09:00-17:00; PH off'));
  assert.equal(parseOpeningHours('Jan-Mar Mo-Fr 09:00-17:00'), null);
  assert.equal(parseOpeningHours('Mo-Fr sunrise-sunset'), null);
  assert.equal(parseOpeningHours(''), null);
  assert.equal(prettyHours('Mo-Fr 09:00-17:30; Sa 10:00-16:00'), 'Mon–Fri 9:00–17:30 · Sat 10:00–16:00');
});

test('classifySight keeps sights and drops stations, universities, offices', () => {
  const c = (desc, classes = [], links = 10) => classifySight({ desc, classes, links });
  assert.equal(c('castle'), 'sight');
  assert.equal(c('cathedral in Lisbon, Portugal'), 'church');
  assert.equal(c('Museum and visitor attraction in Lisbon, Portugal', ['Q33506']), 'museum');
  assert.equal(c('pub in Lisbon, Portugal', ['Q41176']), 'pub');
  assert.equal(c('18th century coaching inn in Lisbon, Portugal'), 'pub');
  assert.equal(c('public park in central Lisbon, Portugal'), 'park');
  assert.equal(c('theatre in Lisbon, Portugal'), 'music');
  assert.equal(c('constituent college of the University of Lisbon in Portugal'), 'sight');
  assert.equal(c('former prison in Portugal'), 'sight');
  assert.equal(c('university located in Lisbon, Portugal'), null);
  assert.equal(c('railway station in Lisbon, Portugal'), null);
  assert.equal(c('province in Portugal'), null);
  assert.equal(c('central bank of Portugal'), null);
  assert.equal(c('NUTS 2 region of Portugal'), null);
  assert.equal(c('capital and largest city of Portugal', [], 238), null);
  assert.equal(c('commune in Hauts-de-Seine, France', [], 60), null);
  assert.equal(c('French department in Île-de-France', [], 90), null);
  assert.equal(c('International airport serving Lisbon, Portugal', [], 60), null);
  assert.equal(c('rapid transport system of Paris', [], 90), null);
  assert.equal(c('tennis tournament held in Paris', [], 90), null);
  assert.equal(c('City district of Lisbon, Portugal', [], 40), 'sight', 'famous neighbourhood');
  assert.equal(c('district of Lisbon, Portugal', [], 9), null, 'ordinary district');
  assert.equal(c('department store in Paris', [], 30), 'shop');
  assert.equal(c('city hall of Lisbon', [], 20), 'sight');
  assert.equal(c('1st arrondissement of Paris', [], 90), null);
  assert.equal(c('2019 fire at Notre-Dame de Paris', [], 90), null);
  assert.equal(c('private university in Lisbon, Portugal', [], 30), null);
  assert.equal(c('stock exchange in Lisbon, Portugal'), null);
  assert.equal(c('prison in Portugal'), null);
  assert.equal(c('road in Lisbon, Portugal', [], 8), null, 'minor street');
  assert.equal(c('road in Lisbon, Portugal', [], 19), 'sight', 'famous street');
  assert.equal(c('football stadium in Lisbon, Portugal', [], 13), null);
  assert.equal(c('sports venue in Lisbon, Portugal', [], 38), null);
});

test('parseSights reads SPARQL json, dedupes, ranks and filters', () => {
  const b = (id, label, desc, links, extra = {}) => ({
    item: { value: 'http://www.wikidata.org/entity/' + id }, itemLabel: { value: label }, itemDescription: { value: desc },
    coord: { value: 'Point(-9.1335 38.7139)' }, links: { value: String(links) }, classes: { value: '' }, ...extra
  });
  const out = parseSights({ results: { bindings: [
    b('Q1', 'Small Pub', 'pub in Lisbon', 6),
    b('Q2', 'Lisbon Castle', 'castle', 39, { img: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/X.jpg' } }),
    b('Q2', 'Lisbon Castle', 'castle', 39),
    b('Q3', 'Rossio', 'railway station in Lisbon', 18),
    b('Q4', 'Q4', 'no label', 50),
    b('Q5', 'Porto District', 'district of Portugal', 80),
    b('Q6', 'Metro do Porto', 'light rail system in Porto, Portugal', 40),
    b('Q7', '5th arrondissement of Paris', 'one of the 20 administrative districts of Paris', 60)
  ] } });
  assert.deepEqual(out.map(s => s.wd), ['Q2', 'Q1']);
  assert.equal(out[0].lat, 38.7139);
  assert.equal(out[0].lng, -9.1335);
  assert.equal(out[0].img, 'https://commons.wikimedia.org/wiki/Special:FilePath/X.jpg?width=400');
  assert.match(sightsQuery(53.3, -6.2, 6), /Point\(-6\.2 53\.3\)/);
});

test('source files contain no stray control characters (a mangled \\b in a regex)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../js/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).filter(f => String(f).endsWith('.js'));
  for (const f of files) assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(readFileSync(new URL(String(f).replace(/\\/g, '/'), dir), 'utf8')), f);
});

test('photonToPlace + osmCat', () => {
  const p = photonToPlace({ geometry: { coordinates: [-9.1366, 38.7105] }, properties: {
    osm_type: 'N', osm_id: 1001, osm_key: 'amenity', osm_value: 'pub', name: 'The Old Tavern',
    street: 'Rua Augusta', housenumber: '19-20', city: 'Lisbon', country: 'Portugal' } });
  assert.equal(p.cat, 'pub');
  assert.equal(p.lat, 38.7105);
  assert.equal(p.osm, 'N1001');
  assert.equal(p.q, 'The Old Tavern, Rua Augusta 19-20, Lisbon');
  assert.equal(osmCat('tourism', 'hotel'), 'hotel');
  assert.equal(osmCat('aeroway', 'aerodrome'), 'transport');
  assert.equal(osmCat('historic', 'castle'), 'sight');
  assert.equal(osmCat('foo', 'bar'), 'other');
});

test('findExisting matches by wikidata id, osm id or name nearby', () => {
  const trip = { places: { a: { id: 'a', name: 'Lisbon Cathedral', lat: 38.7099, lng: -9.1334 }, b: { id: 'b', name: 'X', wd: 'Q9', lat: 0, lng: 0 } } };
  assert.equal(findExisting(trip, { wd: 'Q9', name: 'Other', lat: 1, lng: 1 }).id, 'b');
  assert.equal(findExisting(trip, { name: 'lisbon cathedral', lat: 38.7100, lng: -9.1335 }).id, 'a');
  assert.equal(findExisting(trip, { name: 'Lisbon Cathedral', lat: 40, lng: -3 }), null);
});

test('findExisting: similar names close by count as the same place', () => {
  const trip = { destination: 'Lisbon, Portugal', places: {
    c: { id: 'c', name: 'Lisbon Castle & Alfama', lat: 38.7139, lng: -9.1335 },
    t: { id: 't', name: 'Jerónimos Monastery & Belém', lat: 38.6979, lng: -9.2068 } } };
  assert.equal(findExisting(trip, { name: 'Castle of Saint George', lat: 38.7137, lng: -9.1336 })?.id, 'c');
  assert.equal(findExisting(trip, { name: 'Alfama Fado Museum', lat: 38.7125, lng: -9.1330 })?.id, 'c');
  assert.equal(findExisting(trip, { name: 'Jeronimos Monastery, Lisbon', lat: 38.6978, lng: -9.2065 })?.id, 't');
  assert.equal(findExisting(trip, { name: 'Lisbon Story Centre', lat: 38.7140, lng: -9.1334 }), null, 'only "Lisbon" in common');
  assert.equal(findExisting(trip, { name: 'Castle Market', lat: 38.75, lng: -9.20 }), null, 'too far away');
});

test('shortName and dedupeFound', () => {
  assert.equal(shortName('Ajuda Palace, Lisbon', 'Lisbon, Portugal'), 'Ajuda Palace');
  assert.equal(shortName('Rossio (Lisbon)', 'Lisbon'), 'Rossio');
  assert.equal(shortName('Lisbon Cathedral', 'Lisbon'), 'Lisbon Cathedral');
  const a = { name: 'Central', lat: 48.1402, lng: 11.5600 };
  assert.equal(dedupeFound([a, { ...a, lat: 48.1404 }, { name: 'Central', lat: 48.20, lng: 11.56 }]).length, 2);
});
