import { DAY, muTime, muToday } from '../time.ts';
import { normalize } from '../localities.ts';

// Notices are published in English and French, sometimes mixed in one line.
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, janvier: 1, janv: 1,
  february: 2, feb: 2, fevrier: 2, fev: 2,
  march: 3, mar: 3, mars: 3,
  april: 4, apr: 4, avril: 4, avr: 4,
  may: 5, mai: 5,
  june: 6, jun: 6, juin: 6,
  july: 7, jul: 7, juillet: 7, juil: 7,
  august: 8, aug: 8, aout: 8,
  september: 9, sep: 9, sept: 9, septembre: 9,
  october: 10, oct: 10, octobre: 10,
  november: 11, nov: 11, novembre: 11,
  december: 12, dec: 12, decembre: 12,
};

const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

type DateParts = { year?: number; month: number; day: number };

function findDate(text: string): { parts: DateParts; rest: string } | null {
  // 12 October 2026 / 12th Oct / 12 octobre 2026
  const named = new RegExp(`\\b(\\d{1,2})(?: ?(?:st|nd|rd|th|er))? (${MONTH_RE})\\b(?: (\\d{4}))?`);
  // October 12, 2026
  const namedUs = new RegExp(`\\b(${MONTH_RE}) (\\d{1,2})(?: ?(?:st|nd|rd|th))?\\b(?: (\\d{4}))?`);
  // 12/10/2026 (day first, as in Mauritius) or 2026-10-12
  const numeric = /\b(\d{1,2}) (\d{1,2}) (\d{4})\b/;
  const iso = /\b(\d{4}) (\d{1,2}) (\d{1,2})\b/;

  let m: RegExpMatchArray | null;
  if ((m = text.match(iso))) {
    return { parts: { year: +m[1], month: +m[2], day: +m[3] }, rest: text.replace(m[0], ' ') };
  }
  if ((m = text.match(named))) {
    return { parts: { day: +m[1], month: MONTHS[m[2]], year: m[3] ? +m[3] : undefined }, rest: text.replace(m[0], ' ') };
  }
  if ((m = text.match(namedUs))) {
    return { parts: { day: +m[2], month: MONTHS[m[1]], year: m[3] ? +m[3] : undefined }, rest: text.replace(m[0], ' ') };
  }
  if ((m = text.match(numeric))) {
    return { parts: { day: +m[1], month: +m[2], year: +m[3] }, rest: text.replace(m[0], ' ') };
  }
  return null;
}

function findTimes(text: string): Array<[number, number]> {
  // 08:30, 8.30, 08h30, 8h, 8:30:00, 2 pm, 2.30 pm. Dates are already removed from `text`.
  const re = /\b(\d{1,2})(?: ?(?:h|:)? ?(\d{2}))?(?: \d{2})? ?(am|pm|hrs|h)?\b/g;
  const times: Array<[number, number]> = [];
  for (const m of text.matchAll(re)) {
    const [, h, min, suffix] = m;
    if (min === undefined && !suffix) continue; // a bare number is not a time
    let hour = +h;
    const minute = min ? +min : 0;
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) continue;
    times.push([hour, minute]);
  }
  return times;
}

export type ParsedWindow = { startsAt: number; endsAt: number | null };

/**
 * Extract a Mauritius-time window from text like
 * "Sunday 12 October 2026 from 08:30 to 15:30" or "Dimanche 12 octobre de 8h30 à 15h30".
 * Without a year, picks the closest year to `now` (handles December → January).
 */
export function parseWindow(raw: string, now = Date.now()): ParsedWindow | null {
  // Keep ":" so "08:30" survives normalisation; normalize() would turn it into a space.
  const text = normalize(
    raw
      .replace(/\b(\d{1,2}[:.]\d{2})[:.]\d{2}\b/g, '$1') // drop seconds: 08:30:00 → 08:30
      .replace(/\b(\d{1,2})[:.](\d{2})\b(?![:./-]\d)/g, '$1h$2'), // 08:30 → 08h30, but not 12.10.2026
  );
  const date = findDate(text);
  if (!date) return null;

  const { day, month } = date.parts;
  let year = date.parts.year;
  if (!year) {
    const today = muToday(now);
    year = today.year;
    const candidate = muTime(year, month, day);
    if (candidate < now - 180 * DAY) year += 1;
    else if (candidate > now + 180 * DAY) year -= 1;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const times = findTimes(date.rest);
  const [start = [0, 0], end] = times;
  const startsAt = muTime(year, month, day, start[0], start[1]);
  let endsAt: number | null = null;
  if (end) {
    endsAt = muTime(year, month, day, end[0], end[1]);
    if (endsAt <= startsAt) endsAt += DAY; // overnight works, e.g. 22:00 to 04:00
  } else if (times.length === 0) {
    endsAt = startsAt + DAY; // whole-day notice
  }
  return { startsAt, endsAt };
}
