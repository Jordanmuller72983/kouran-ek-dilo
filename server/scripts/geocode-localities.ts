// One-off: look up coordinates for every locality via OpenStreetMap Nominatim and save them to
// src/data/locality-coords.json. Resumable; respects Nominatim's 1 request/second policy.
//   node scripts/geocode-localities.ts            (only missing ones)
//   node scripts/geocode-localities.ts --check    (report outliers far from their district)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DISTRICTS, LOCALITIES } from '../src/localities.ts';

const file = path.resolve(import.meta.dirname, '../src/data/locality-coords.json');
mkdirSync(path.dirname(file), { recursive: true });
const coords: Record<string, [number, number]> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};

// Mainland Mauritius and Rodrigues bounding boxes: [south, north, west, east]
const MAINLAND = [-20.56, -19.95, 57.29, 57.82];
const RODRIGUES = [-19.8, -19.65, 63.3, 63.52];
const inBox = (lat: number, lng: number, [s, n, w, e]: number[]) => lat >= s && lat <= n && lng >= w && lng <= e;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lookup(q: string): Promise<Array<{ lat: string; lon: string }>> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=mu&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'KouranEkDilo/0.1 (Mauritius outage tracker; one-off geocode)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

if (!process.argv.includes('--check')) {
  const todo = LOCALITIES.filter((l) => !coords[l.id]);
  console.log(`${todo.length} localities to geocode`);
  for (const l of todo) {
    const box = l.district === 'rodrigues' ? RODRIGUES : MAINLAND;
    const query = l.district === 'rodrigues' ? `${l.name}, Rodrigues` : `${l.name}, Mauritius`;
    try {
      const hit = (await lookup(query)).map((r) => [+r.lat, +r.lon] as [number, number]).find(([a, b]) => inBox(a, b, box));
      if (hit) coords[l.id] = [+hit[0].toFixed(5), +hit[1].toFixed(5)];
      console.log(hit ? '✓' : '✗', l.name, hit ?? '');
      writeFileSync(file, JSON.stringify(coords, null, 0).replace(/\],/g, '],\n'));
    } catch (err) {
      console.log('!', l.name, (err as Error).message);
    }
    await sleep(1100);
  }
}

// Outliers: localities more than ~12 km from their district's median point.
const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 111, (a[1] - b[1]) * 104);
for (const d of DISTRICTS) {
  const pts = LOCALITIES.filter((l) => l.district === d.id && coords[l.id]).map((l) => ({ l, c: coords[l.id] }));
  if (!pts.length) continue;
  const med = (i: 0 | 1) => pts.map((p) => p.c[i]).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
  const center: [number, number] = [med(0), med(1)];
  for (const p of pts) if (km(p.c, center) > 12) console.log(`outlier: ${p.l.name} (${d.name}) ${km(p.c, center).toFixed(1)} km`);
}
const missing = LOCALITIES.filter((l) => !coords[l.id]).map((l) => l.name);
console.log(`missing ${missing.length}: ${missing.join(', ')}`);
