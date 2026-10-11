import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { DistrictId } from '../localities.ts';
import { getLocality, matchLocalities } from '../localities.ts';
import type { OutageInput } from '../store.ts';
import { parseWindow } from './dates.ts';

// ceb.mu/customer-corner/power-outage-information embeds every district's schedule in a script:
//   var arDistrictLocations = {"blackriver":"<h3>Black River</h3><table>…Date|Locality|Streets…</table>", …};
const CEB_DISTRICTS: Record<string, DistrictId> = {
  portlouis: 'port-louis',
  pamplemousses: 'pamplemousses',
  rivieredurempart: 'riviere-du-rempart',
  flacq: 'flacq',
  moka: 'moka',
  plainewilhems: 'plaines-wilhems',
  blackriver: 'black-river',
  grandport: 'grand-port',
  savanne: 'savanne',
  rodrigues: 'rodrigues',
};

export class CebFormatError extends Error {}

export function extractDistrictTables(html: string): Record<string, string> {
  const m = html.match(/var\s+arDistrictLocations\s*=\s*(\{[\s\S]*?\})\s*;\s*(?:\r?\n|var\s|<\/script>)/);
  if (!m) throw new CebFormatError('arDistrictLocations not found — CEB page layout may have changed');
  return JSON.parse(m[1]);
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function parseCebPage(html: string, url: string, now = Date.now()): OutageInput[] {
  const tables = extractDistrictTables(html);
  const outages: OutageInput[] = [];

  for (const [key, tableHtml] of Object.entries(tables)) {
    const district = CEB_DISTRICTS[key];
    if (!district) continue;
    const $ = cheerio.load(tableHtml);
    let lastDate = '';

    $('tbody tr').each((_, tr) => {
      const cells = $(tr).find('td').map((_, td) => clean($(td).text())).get();
      if (cells.length === 0) return;
      // A date cell may span several rows (rowspan), leaving only Locality + Streets.
      const [dateText, area, streets] = cells.length >= 3 ? cells : [lastDate, cells[0], cells[1] ?? ''];
      lastDate = dateText;

      const window = parseWindow(dateText, now);
      if (!window) return;

      const localities = matchLocalities(`${area} ${streets}`)
        .filter((id) => getLocality(id)?.district === district)
        .slice(0, 10);
      outages.push({
        utility: 'electricity',
        kind: 'planned',
        source: 'ceb',
        sourceRef: 'ceb:' + createHash('sha1').update([key, dateText, area, streets].join('|')).digest('hex'),
        title: area || 'Planned power outage',
        details: streets || null,
        areaLabel: area || null,
        district,
        scope: localities.length ? 'locality' : 'district',
        localities,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        url,
      });
    });
  }
  return outages;
}
