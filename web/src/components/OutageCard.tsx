import { ChevronRight, Droplet, Zap } from 'lucide-react';
import type { Outage } from '../api';
import { dateBadge, formatDay, formatTime } from '../format';
import { useI18n } from '../i18n';
import { usePlaces } from '../state';

export const isNotice = (o: Outage) => o.kind === 'schedule' || o.kind === 'advisory' || o.kind === 'news';

export const SOURCE_NAMES: Record<Outage['source'], string> = {
  ceb: 'Central Electricity Board',
  cwa: 'Central Water Authority',
  community: '',
  admin: 'Kouran ek Dilo',
};

export function UtilityIcon({ utility, size = 14 }: { utility: Outage['utility']; size?: number }) {
  const Icon = utility === 'electricity' ? Zap : Droplet;
  return <Icon size={size} strokeWidth={2.2} aria-hidden />;
}

export function useOutageLabels() {
  const { t, lang } = useI18n();
  const { byId, districtName } = usePlaces();

  const place = (o: Outage) => {
    if (o.areaLabel) return o.areaLabel;
    if (isNotice(o)) return o.title;
    const names = o.localities.map((id) => byId.get(id)?.name ?? id);
    if (names.length) return names.join(', ');
    return o.scope === 'national' ? t.islandWide : districtName(o.district);
  };

  const when = (o: Outage) => {
    if (isNotice(o)) return formatDay(o.startsAt, lang);
    const day = formatDay(o.startsAt, lang);
    if (!o.endsAt) return `${t.since} ${formatTime(o.startsAt)} · ${day}`;
    return `${day} · ${formatTime(o.startsAt)} – ${formatTime(o.endsAt)}`;
  };

  const kindLabel = (o: Outage) => {
    if (o.kind === 'schedule') return t.kindSchedule;
    if (o.kind === 'advisory') return t.kindAdvisory;
    if (o.kind === 'news') return t.kindNews;
    return o.utility === 'electricity' ? t.electricity : t.water;
  };

  return { place, when, kindLabel };
}

function Aside({ o }: { o: Outage }) {
  const { t, lang } = useI18n();
  if (isNotice(o)) {
    const b = dateBadge(o.startsAt, lang);
    return (
      <div className="date-badge">
        <span className="d">{b.day}</span>
        <span className="m">{b.month}{b.year ? ` ${b.year}` : ''}</span>
      </div>
    );
  }
  if (!o.endsAt) {
    return (
      <>
        <span className="since">{t.since}</span>
        <span className="t-start">{formatTime(o.startsAt)}</span>
      </>
    );
  }
  return (
    <>
      <span className="t-start">{formatTime(o.startsAt)}</span>
      <span className="rail" aria-hidden />
      <span className="t-end">{formatTime(o.endsAt)}</span>
    </>
  );
}

/** One line of the timetable: times on the left, place and streets on the right. */
export function OutageCard({ outage: o }: { outage: Outage }) {
  const { t } = useI18n();
  const { districtName } = usePlaces();
  const { place, kindLabel } = useOutageLabels();
  const notice = isNotice(o);

  const meta = [
    !notice && o.district ? districtName(o.district) : null,
    o.source === 'community' ? t.affected(o.confirmations + 1) : o.source === 'admin' ? null : o.source.toUpperCase(),
  ].filter(Boolean).join(' · ');

  return (
    <a href={`#/outage/${o.id}`} className={`row ${o.utility}`}>
      <div className="row-aside"><Aside o={o} /></div>
      <div className="row-main">
        <div className="kicker">
          <span className={`kind ${o.utility}`}><UtilityIcon utility={o.utility} size={13} />{kindLabel(o)}</span>
          {o.status === 'ongoing' && !notice && <span className="live-badge">{t.live}</span>}
          {o.source === 'community' && <span className="tag-quiet">{t.kindCommunity}</span>}
        </div>
        <h3 className="row-title">{place(o)}</h3>
        {o.details && !notice && <p className="row-details">{o.details}</p>}
        <p className="row-meta">{meta}</p>
      </div>
      {o.imageUrl ? (
        <img className="row-thumb" src={o.imageUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <ChevronRight className="row-chevron" size={18} aria-hidden />
      )}
    </a>
  );
}
