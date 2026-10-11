import { ArrowRight, CircleCheck, Clock, Droplet, Globe, MapPin, TriangleAlert, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Outage, Utility } from '../api';
import { api } from '../api';
import { Skeleton } from '../App';
import { LocalityPicker } from '../components/LocalityPicker';
import { OutageCard, isNotice, useOutageLabels } from '../components/OutageCard';
import { dayKey, formatDay, formatTime } from '../format';
import { useI18n } from '../i18n';
import { storage, usePlaces } from '../state';

export function Home() {
  const { t, lang } = useI18n();
  const { byId, districtName } = usePlaces();
  const { place, kindLabel } = useOutageLabels();
  // null = whole island
  const [area, setArea] = useState<string | null>(() => {
    const saved = storage.get('area');
    return saved && byId.has(saved) ? saved : null;
  });
  const [picking, setPicking] = useState(false);
  const [utility, setUtility] = useState<Utility | ''>('');
  const [outages, setOutages] = useState<Outage[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    setOutages(null);
    api.outages({ utility: utility || undefined, locality: area ?? undefined })
      .then((r) => setOutages(r.outages))
      .catch(() => setError(true));
  }, [utility, area]);
  useEffect(load, [load]);

  const choose = (id: string | null) => {
    setArea(id);
    storage.set('area', id);
    setPicking(false);
  };

  const loc = area ? byId.get(area) : undefined;
  const cuts = outages?.filter((o) => !isNotice(o)) ?? [];
  const live = cuts.filter((o) => o.status === 'ongoing');
  const upcoming = cuts.filter((o) => o.status === 'upcoming');
  const notices = outages?.filter((o) => o.kind === 'schedule' || o.kind === 'advisory') ?? [];

  // Upcoming cuts grouped by calendar day (Mauritius time).
  const days = new Map<string, Outage[]>();
  for (const o of upcoming) days.set(dayKey(o.startsAt), [...(days.get(dayKey(o.startsAt)) ?? []), o]);

  if (picking) {
    return (
      <section className="panel">
        <h2>{t.chooseArea}</h2>
        <LocalityPicker onPick={choose} autoFocus />
        <div className="panel-actions between">
          <button className="btn ghost sm" onClick={() => choose(null)}><Globe size={15} aria-hidden />{t.wholeIsland}</button>
          <button className="btn ghost sm" onClick={() => setPicking(false)}>{t.cancel}</button>
        </div>
      </section>
    );
  }

  const next = upcoming[0];

  return (
    <>
      <div className="place-switch">
        <button className="ps-main" onClick={() => setPicking(true)} aria-label={t.chooseArea}>
          {loc ? <MapPin size={18} aria-hidden /> : <Globe size={18} aria-hidden />}
          <span className="ps-text">
            <span className="ps-name">{loc ? loc.name : t.wholeIsland}</span>
            <span className="ps-sub">{loc ? districtName(loc.district) : t.setAreaPrompt}</span>
          </span>
        </button>
        <div className="ps-actions">
          <button className="ps-change" onClick={() => setPicking(true)}>{loc ? t.change : t.setArea}</button>
          {loc && (
            <button className="ps-clear" onClick={() => choose(null)} aria-label={t.clearArea} title={t.clearArea}>
              <X size={16} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="empty">
          <h3>{t.error}</h3>
          <button className="btn" onClick={load}>{t.retry}</button>
        </div>
      ) : !outages ? (
        <div className="status loading" aria-hidden />
      ) : live.length > 0 ? (
        <Status tone="alert" icon={<TriangleAlert size={20} />} title={t.statusLiveTitle(live.length)}
          sub={`${kindLabel(live[0])} · ${place(live[0])}${live[0].endsAt ? ` · ${t.until} ${formatTime(live[0].endsAt)}` : ''}`}
          href={`#/outage/${live[0].id}`} />
      ) : next ? (
        <Status tone="warn" icon={<Clock size={20} />} title={t.statusNextTitle}
          sub={[
            formatDay(next.startsAt, lang),
            formatTime(next.startsAt) + (next.endsAt ? `–${formatTime(next.endsAt)}` : ''),
            kindLabel(next),
            loc ? null : place(next),
          ].filter(Boolean).join(' · ')}
          href={`#/outage/${next.id}`} />
      ) : (
        <Status tone="ok" icon={<CircleCheck size={20} />} title={t.statusClearTitle} sub={t.nothingHint}
          action={<a className="btn sm" href="#/alerts">{t.alertsTitle}</a>} />
      )}

      <div className="filter-tabs" role="group" aria-label="Utility">
        <button className={utility === '' ? 'active' : ''} aria-pressed={utility === ''} onClick={() => setUtility('')}>{t.all}</button>
        <button className={`electricity ${utility === 'electricity' ? 'active' : ''}`} aria-pressed={utility === 'electricity'} onClick={() => setUtility('electricity')}>
          <Zap size={14} aria-hidden />{t.electricity}
        </button>
        <button className={`water ${utility === 'water' ? 'active' : ''}`} aria-pressed={utility === 'water'} onClick={() => setUtility('water')}>
          <Droplet size={14} aria-hidden />{t.water}
        </button>
      </div>

      {!outages && !error && <Skeleton />}

      {live.length > 0 && (
        <Section title={t.mapNow}>{live.map((o) => <OutageCard key={o.id} outage={o} />)}</Section>
      )}
      {[...days.values()].map((items) => (
        <Section key={dayKey(items[0].startsAt)} title={formatDay(items[0].startsAt, lang)}>
          {items.map((o) => <OutageCard key={o.id} outage={o} />)}
        </Section>
      ))}
      {notices.length > 0 && (
        <Section title={t.waterNotices}>{notices.map((o) => <OutageCard key={o.id} outage={o} />)}</Section>
      )}

      {outages && (
        <nav className="more-links">
          <a href="#/map"><span>{t.viewOnMap}</span><ArrowRight size={16} aria-hidden /></a>
          <a href="#/communiques"><span>{t.allCommuniques}</span><ArrowRight size={16} aria-hidden /></a>
        </nav>
      )}
    </>
  );
}

function Status({ tone, icon, title, sub, href, action }: {
  tone: 'ok' | 'warn' | 'alert';
  icon: React.ReactNode;
  title: string;
  sub: string;
  href?: string;
  action?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="status-icon" aria-hidden>{icon}</span>
      <span className="status-text">
        <span className="status-title">{title}</span>
        <span className="status-sub">{sub}</span>
        {action && <span className="status-action">{action}</span>}
      </span>
      {href && <ArrowRight className="status-arrow" size={18} aria-hidden />}
    </>
  );
  return href ? (
    <a className={`status ${tone}`} href={href} role="status">{body}</a>
  ) : (
    <div className={`status ${tone}`} role="status">{body}</div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <div className="section-head"><h2>{title}</h2></div>
      <div className="rows">{children}</div>
    </section>
  );
}
