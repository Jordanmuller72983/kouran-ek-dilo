import * as cheerio from 'cheerio';
import { getLocality, matchLocalities, normalize } from '../localities.ts';
import type { OutageInput } from '../store.ts';
import { DAY, HOUR, MU_OFFSET_HOURS } from '../time.ts';
import { parseWindow } from './dates.ts';

// Shape of cwa.govmu.org WordPress REST posts (?rest_route=/wp/v2/posts).
export type WpPost = {
  id: number;
  date: string; // site-local time (Mauritius), no offset, e.g. "2026-10-10T07:56:04"
  link: string;
  title: { rendered: string };
  content?: { rendered: string };
  _embedded?: { 'wp:featuredmedia'?: Array<{ source_url?: string }> };
};

// Every public CWA communiqué goes on the platform. Only job adverts and procurement are left out.
const EXCLUDED = /\b(vacanc\w*|expression of interest|tenders?|procurement|bids?|appel d offres|request for proposals?)\b/;
// Notices about the water supply itself; everything else (grants, rates, office hours…) is general news.
const SUPPLY = /\b(interruption|coupure|distribution|fourniture|horaires?|supply|pression|reservoirs?|approvisionnement|secheresse|dry season|reduite?)\b/;
const NATIONAL = /\b(ensemble du pays|toute l ile|tout le pays|whole island|island wide|islandwide|all regions)\b/;

export function classifyCwa(title: string): OutageInput['kind'] | null {
  const t = normalize(title);
  if (EXCLUDED.test(t)) return null;
  if (/\b(interruption|coupure|perturbation|disruption|suspension)\b/.test(t)) return 'interruption';
  if (/\b(horaires?|hours of supply|distribution|schedule)\b/.test(t)) return 'schedule';
  if (SUPPLY.test(t)) return 'advisory';
  return 'news';
}

/** WordPress gives local time without offset; interpret it as Mauritius time. */
function wpDateToEpoch(date: string): number {
  return Date.parse(date + 'Z') - MU_OFFSET_HOURS * HOUR;
}

export function parseCwaPosts(posts: WpPost[]): OutageInput[] {
  const outages: OutageInput[] = [];
  for (const post of posts) {
    const title = cheerio.load(post.title.rendered).text().replace(/\s+/g, ' ').trim();
    const kind = classifyCwa(title);
    if (!kind) continue;

    const $ = cheerio.load(post.content?.rendered ?? '');
    const body = $.text().replace(/\s+/g, ' ').trim();
    const href = $('a[href]').first().attr('href');
    const attachment = href ? new URL(href, post.link).href : null; // links are often site-relative
    // Fallback picture when there's no PDF poster: an image in the post, else its (often stock) featured image.
    const img = $('img[src]').first().attr('src') ?? post._embedded?.['wp:featuredmedia']?.[0]?.source_url;
    const imageSource = img ? new URL(img, post.link).href : null;
    // Old posts are kept as an archive; they're already past `visible_until`, so nobody gets alerted for them.
    const published = wpDateToEpoch(post.date);

    const text = `${title} ${body}`;
    const localities = matchLocalities(text);
    const districts = new Set(localities.map((id) => getLocality(id)!.district));
    // Dates without a year are read relative to when the notice was published, not today.
    const window = kind === 'interruption' ? parseWindow(text, published) : null;
    const startsAt = window?.startsAt ?? published;

    outages.push({
      utility: 'water',
      kind,
      source: 'cwa',
      sourceRef: `cwa:${post.id}`,
      title,
      details: body.length > 40 ? body.slice(0, 2000) : null,
      areaLabel: null,
      district: districts.size === 1 ? [...districts][0] : null,
      scope: NATIONAL.test(normalize(text)) || localities.length === 0 ? 'national' : 'locality',
      localities,
      startsAt,
      // Schedules and advisories have no fixed end; keep them on the feed for a week, news for a month.
      endsAt: window?.endsAt ?? null,
      visibleFor: kind === 'interruption' ? 2 * DAY : kind === 'news' ? 30 * DAY : 7 * DAY,
      url: post.link,
      attachmentUrl: attachment,
      imageSource,
      // General news (grants, rates…) is feed-only; so is a vague advisory with no place names.
      notify: kind === 'news' ? false : kind !== 'advisory' || localities.length > 0 || NATIONAL.test(normalize(text)),
    });
  }
  return outages;
}
