import type { Lang } from './i18n';

// Everything is shown in Mauritius time regardless of the viewer's device timezone.
const TZ = 'Indian/Mauritius';

const MFE_DAYS = ['Dimans', 'Lindi', 'Mardi', 'Merkredi', 'Zedi', 'Vandredi', 'Samdi'];
const MFE_MONTHS = ['Zanvie', 'Fevriye', 'Mars', 'Avril', 'Me', 'Zin', 'Zilye', 'Out', 'Septam', 'Oktob', 'Novam', 'Desam'];

function parts(iso: string) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { weekday, day: +p.day, month: +p.month, year: +p.year, time: `${p.hour}:${p.minute}` };
}

export function formatTime(iso: string): string {
  return parts(iso).time;
}

export function formatDay(iso: string, lang: Lang): string {
  const p = parts(iso);
  const today = parts(new Date().toISOString());
  const tomorrow = parts(new Date(Date.now() + 86_400_000).toISOString());
  const same = (a: typeof p, b: typeof p) => a.day === b.day && a.month === b.month && a.year === b.year;
  if (same(p, today)) return { en: 'Today', fr: "Aujourd'hui", mfe: 'Zordi' }[lang];
  if (same(p, tomorrow)) return { en: 'Tomorrow', fr: 'Demain', mfe: 'Dime' }[lang];
  const year = p.year !== today.year ? ` ${p.year}` : '';
  if (lang === 'mfe') return `${MFE_DAYS[p.weekday]} ${p.day} ${MFE_MONTHS[p.month - 1]}${year}`;
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-MU' : 'en-MU', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}),
  }).format(new Date(iso));
}

/** Stable key for grouping by Mauritius calendar day. */
export function dayKey(iso: string): string {
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

const SHORT_MONTHS: Record<Lang, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  mfe: ['Zan', 'Fev', 'Mar', 'Avr', 'Me', 'Zin', 'Zil', 'Out', 'Sep', 'Okt', 'Nov', 'Des'],
};

/** Day number + short month (and year if not this year) for date badges. */
export function dateBadge(iso: string, lang: Lang): { day: number; month: string; year: number | null } {
  const p = parts(iso);
  const thisYear = parts(new Date().toISOString()).year;
  return { day: p.day, month: SHORT_MONTHS[lang][p.month - 1], year: p.year !== thisYear ? p.year : null };
}
