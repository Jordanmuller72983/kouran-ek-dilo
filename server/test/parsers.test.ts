import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchLocalities } from '../src/localities.ts';
import { parseCebPage } from '../src/parsers/ceb.ts';
import { classifyCwa, parseCwaPosts } from '../src/parsers/cwa.ts';
import { parseWindow } from '../src/parsers/dates.ts';
import { normaliseMuMobile } from '../src/notify/phone.ts';
import { muTime } from '../src/time.ts';

const NOW = muTime(2026, 10, 11, 18, 0);
const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());

describe('parseWindow', () => {
  it('reads English CEB-style dates', () => {
    const w = parseWindow('Sunday 12 October 2026 from 08:30:00 to 15:30:00', NOW)!;
    assert.equal(iso(w.startsAt), '2026-10-12T04:30:00.000Z'); // 08:30 Mauritius = 04:30 UTC
    assert.equal(iso(w.endsAt), '2026-10-12T11:30:00.000Z');
  });

  it('reads French dates with "h" times', () => {
    const w = parseWindow('Dimanche 12 octobre 2026 de 8h30 à 15h', NOW)!;
    assert.equal(iso(w.startsAt), '2026-10-12T04:30:00.000Z');
    assert.equal(iso(w.endsAt), '2026-10-12T11:00:00.000Z');
  });

  it('reads day-first numeric dates and am/pm', () => {
    const w = parseWindow('13/10/2026 9 am - 2.30 pm', NOW)!;
    assert.equal(iso(w.startsAt), '2026-10-13T05:00:00.000Z');
    assert.equal(iso(w.endsAt), '2026-10-13T10:30:00.000Z');
  });

  it('infers the year, rolling over December → January', () => {
    const dec = muTime(2026, 12, 28, 12);
    const w = parseWindow('Tuesday 5 January from 09:00 to 12:00', dec)!;
    assert.equal(iso(w.startsAt), '2027-01-05T05:00:00.000Z');
  });

  it('handles overnight windows', () => {
    const w = parseWindow('14 October 2026 22:00 to 04:00', NOW)!;
    assert.equal(iso(w.endsAt), '2026-10-15T00:00:00.000Z');
  });

  it('returns null without a date', () => {
    assert.equal(parseWindow('from 08:30 to 15:30', NOW), null);
  });
});

describe('matchLocalities', () => {
  it('ignores accents, hyphens and St/Ste', () => {
    assert.deepEqual(matchLocalities('Part of Rose-Hill and Ste Croix').sort(), ['rose-hill', 'sainte-croix']);
    assert.deepEqual(matchLocalities('MAHEBOURG'), ['mahebourg']);
  });

  it('prefers the longest name', () => {
    assert.deepEqual(matchLocalities('Grand Bel Air'), ['grand-bel-air']);
    assert.deepEqual(matchLocalities('Poste de Flacq'), ['poste-de-flacq']);
  });

  it('finds several places in a CWA title', () => {
    const found = matchLocalities("Nouveaux horaires de distribution d'eau pour les régions de Vacoas, Phoenix, St. Pierre, Curepipe, Forest-Side et Floréal");
    assert.deepEqual(found.sort(), ['curepipe', 'floreal', 'forest-side', 'phoenix', 'saint-pierre', 'vacoas']);
  });
});

describe('parseCebPage', () => {
  const tables = {
    plainewilhems: `<h3>Plaines Wilhems</h3><table><thead><th>Date</th><th>Locality</th><th>Streets</th></thead><tbody>
      <tr><td rowspan="2">Sunday 12 October 2026 from 08:30:00 to 15:30:00</td><td>Quatre Bornes</td><td>Part of Avenue Victoria, Rue Sir Virgile Naz</td></tr>
      <tr><td>Rose Hill</td><td>Royal Road near Plaza</td></tr>
    </tbody></table>`,
    rodrigues: '<h3>Rodrigues</h3><table><thead></thead><tbody></tbody></table>',
  };
  const html = `<script>\nvar moduleCurrentPath = "x";\nvar arDistrictLocations = ${JSON.stringify(tables)};\n$(".mau-districts").on('click', function(){});</script>`;

  it('extracts rows per district, including rowspan dates', () => {
    const outages = parseCebPage(html, 'https://ceb.mu/x', NOW);
    assert.equal(outages.length, 2);
    const [qb, rh] = outages;
    assert.equal(qb.district, 'plaines-wilhems');
    assert.deepEqual(qb.localities, ['quatre-bornes']);
    assert.equal(qb.details, 'Part of Avenue Victoria, Rue Sir Virgile Naz');
    assert.equal(iso(qb.startsAt), '2026-10-12T04:30:00.000Z');
    assert.deepEqual(rh.localities, ['rose-hill']);
    assert.equal(rh.startsAt, qb.startsAt);
    assert.notEqual(rh.sourceRef, qb.sourceRef);
  });

  it('throws if the page layout changes', () => {
    assert.throws(() => parseCebPage('<html></html>', 'x', NOW), /arDistrictLocations not found/);
  });
});

describe('CWA', () => {
  it('keeps every communiqué and drops only vacancies/tenders', () => {
    assert.equal(classifyCwa('Communiqué – Interruption de la Fourniture d’Eau'), 'interruption');
    assert.equal(classifyCwa('Nouveaux horaires de distribution d&#8217;eau pour les régions de Vacoas'), 'schedule');
    assert.equal(classifyCwa('Communiqué – La fourniture d’eau dans l’ensemble du pays sera réduite'), 'advisory');
    assert.equal(classifyCwa('Dry Season Regulations (2026)'), 'advisory');
    for (const news of [
      'Water Tank Grant Scheme: Enregistrement à partir du lundi 12 Octobre 2026',
      'Registration of Private Water Tankers',
      'Instruction Notice No.13 of 2026 – New Rates applicable as from 01 September 2026',
      'Communiqué – Le bureau régional de Centre de Flacq de nouveau opérational',
      'Communiqué de la CWA – 8 Janvier 2026',
      'KYC Update',
    ]) assert.equal(classifyCwa(news), 'news', news);
    assert.equal(classifyCwa('Vacancies – September 2026'), null);
    assert.equal(classifyCwa('Expression of Interest – C2026/244 – Barcode-Based Inventory Management System'), null);
  });

  it('puts general news on the feed without alerting subscribers', () => {
    const [o] = parseCwaPosts([{ id: 5009, date: '2026-10-11T09:23:43', link: 'https://cwa.govmu.org/cwa/?p=5009',
      title: { rendered: 'Water Tank Grant Scheme: Enregistrement à partir du lundi 12 Octobre 2026' } }]);
    assert.equal(o.kind, 'news');
    assert.equal(o.notify, false);
    assert.equal(o.scope, 'national');
  });

  it('builds outages from WordPress posts', () => {
    const outages = parseCwaPosts([
      { id: 5001, date: '2026-10-10T07:56:04', link: 'https://cwa.govmu.org/cwa/?p=5001',
        title: { rendered: 'Nouveaux horaires de distribution d&#8217;eau pour les régions de Vacoas, Phoenix, Curepipe' },
        content: { rendered: '<p><a href="https://cwa.govmu.org/cwa/wp-content/uploads/c.pdf">Communique (Click Here)</a></p>' } },
      { id: 4999, date: '2026-10-09T10:00:00', link: 'x', title: { rendered: 'Vacancies – October 2026' } },
      { id: 4998, date: '2026-08-04T10:00:00', link: 'x', title: { rendered: 'La fourniture d’eau dans l’ensemble du pays sera réduite' } },
    ]);
    assert.equal(outages.length, 2, 'vacancies are skipped, older communiqués kept as archive');
    const [o] = outages;
    assert.equal(o.kind, 'schedule');
    assert.equal(o.district, 'plaines-wilhems');
    assert.equal(o.attachmentUrl, 'https://cwa.govmu.org/cwa/wp-content/uploads/c.pdf');
    assert.equal(iso(o.startsAt), '2026-10-10T03:56:04.000Z');
  });

  it('keeps the PDF poster link and a fallback picture', () => {
    const [o] = parseCwaPosts([{ id: 7, date: '2026-10-10T08:00:00', link: 'https://cwa.govmu.org/cwa/?p=7',
      title: { rendered: 'Communiqué – Interruption de la fourniture d’eau à Triolet' },
      content: { rendered: '<a href="/cwa/wp-content/uploads/n.pdf">Click</a>' },
      _embedded: { 'wp:featuredmedia': [{ source_url: 'https://cwa.govmu.org/cwa/wp-content/uploads/drop.jpg' }] } }]);
    assert.equal(o.attachmentUrl, 'https://cwa.govmu.org/cwa/wp-content/uploads/n.pdf');
    assert.equal(o.imageSource, 'https://cwa.govmu.org/cwa/wp-content/uploads/drop.jpg');
    assert.deepEqual(o.localities, ['triolet']);
  });

  it('marks island-wide notices as national', () => {
    const [o] = parseCwaPosts([{ id: 1, date: '2026-10-10T08:00:00', link: 'x',
      title: { rendered: 'Communiqué – La fourniture d’eau dans l’ensemble du pays sera réduite' } }]);
    assert.equal(o.scope, 'national');
    assert.equal(o.notify, true);
  });
});

describe('normaliseMuMobile', () => {
  it('accepts common Mauritian formats', () => {
    for (const n of ['5712 3456', '+230 5712 3456', '00230-5712-3456', '23057123456']) {
      assert.equal(normaliseMuMobile(n), '+23057123456', n);
    }
  });
  it('rejects landlines and junk', () => {
    assert.equal(normaliseMuMobile('464 1234'), null);
    assert.equal(normaliseMuMobile('hello'), null);
  });
});
