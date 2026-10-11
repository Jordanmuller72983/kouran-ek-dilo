import { getLocality } from '../localities.ts';
import type { Outage } from '../store.ts';
import { HOUR, MU_OFFSET_HOURS } from '../time.ts';

export type Lang = 'en' | 'fr' | 'mfe';
export const LANGS: Lang[] = ['en', 'fr', 'mfe'];

// Kreol Morisien follows the Lortograf Kreol Morisien spelling. Have a native speaker review before launch.
const T = {
  en: {
    electricity: 'Power cut', water: 'Water cut', schedule: 'Water supply hours', advisory: 'CWA notice',
    community: 'Reported by residents', from: 'from', to: 'to', more: 'Details', stop: 'Reply STOP to unsubscribe',
    days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    code: (c: string) => `Kouran ek Dilo: your verification code is ${c}. It expires in 10 minutes.`,
  },
  fr: {
    electricity: 'Coupure de courant', water: "Coupure d'eau", schedule: "Horaires de distribution d'eau",
    advisory: 'Communiqué CWA', community: 'Signalé par des habitants', from: 'de', to: 'à', more: 'Détails',
    stop: 'Répondez STOP pour vous désabonner',
    days: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
    months: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
    code: (c: string) => `Kouran ek Dilo : votre code de vérification est ${c}. Il expire dans 10 minutes.`,
  },
  mfe: {
    electricity: 'Koupir kouran', water: 'Koupir dilo', schedule: 'Nouvo ler distribisyon dilo',
    advisory: 'Kominike CWA', community: 'Dimounn dan landrwa finn rapporte', from: 'depi', to: 'ziska',
    more: 'Plis detay', stop: 'Avoy STOP pou aret resevwar',
    days: ['Dim', 'Lin', 'Mar', 'Mer', 'Ze', 'Van', 'Sam'],
    months: ['Zan', 'Fev', 'Mar', 'Avr', 'Me', 'Zin', 'Zil', 'Out', 'Sep', 'Okt', 'Nov', 'Des'],
    code: (c: string) => `Kouran ek Dilo: ou kod verifikasyon se ${c}. Li bon pou 10 minit.`,
  },
} satisfies Record<Lang, unknown>;

export function otpMessage(lang: Lang, code: string): string {
  return T[lang].code(code);
}

function fmt(iso: string, lang: Lang, withDate: boolean): string {
  const d = new Date(Date.parse(iso) + MU_OFFSET_HOURS * HOUR); // read UTC fields as Mauritius wall time
  const t = T[lang];
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return withDate ? `${t.days[d.getUTCDay()]} ${d.getUTCDate()} ${t.months[d.getUTCMonth()]}, ${time}` : time;
}

function heading(o: Outage, lang: Lang): string {
  const t = T[lang];
  const icon = o.utility === 'electricity' ? '⚡' : '💧';
  const label = o.kind === 'schedule' ? t.schedule : o.kind === 'advisory' || o.kind === 'news' ? t.advisory : t[o.utility];
  return `${icon} ${label}`;
}

function place(o: Outage): string {
  const names = o.localities.map((id) => getLocality(id)?.name ?? id);
  return o.areaLabel ?? (names.length ? names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '') : 'Mauritius');
}

/** Short text for SMS / WhatsApp (keep under ~300 chars). */
export function outageText(o: Outage, lang: Lang, link: string, channel: 'sms' | 'whatsapp'): string {
  const t = T[lang];
  const lines = [`${heading(o, lang)} – ${place(o)}`];
  if (o.kind === 'planned' || o.kind === 'interruption') {
    lines.push(o.endsAt
      ? `${fmt(o.startsAt, lang, true)} ${t.to} ${fmt(o.endsAt, lang, false)}`
      : `${t.from} ${fmt(o.startsAt, lang, true)}`);
  } else if (o.kind === 'schedule' || o.kind === 'advisory' || o.kind === 'news') {
    lines.push(o.title);
  }
  if (o.kind === 'community') lines.push(t.community);
  if (o.details && (o.kind === 'planned' || o.kind === 'interruption' || o.kind === 'community')) {
    lines.push(o.details.length > 140 ? o.details.slice(0, 137) + '…' : o.details);
  }
  lines.push(`${t.more}: ${link}`);
  if (channel === 'sms') lines.push(t.stop);
  return lines.join('\n');
}

/** Title + body for a browser push notification. */
export function outagePush(o: Outage, lang: Lang): { title: string; body: string } {
  const t = T[lang];
  const when = o.kind === 'planned' || o.kind === 'interruption'
    ? (o.endsAt ? `${fmt(o.startsAt, lang, true)} ${t.to} ${fmt(o.endsAt, lang, false)}` : fmt(o.startsAt, lang, true))
    : o.title;
  return { title: `${heading(o, lang)} – ${place(o)}`, body: when };
}
