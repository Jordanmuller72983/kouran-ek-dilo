import { Droplet, Zap } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { Outage, Utility } from '../api';
import { api } from '../api';
import { isNotice, useOutageLabels } from '../components/OutageCard';
import { useI18n } from '../i18n';

const OutageMap = lazy(() => import('../components/OutageMap'));

const DAY = 86_400_000;

/** Shared by the map page and the home preview: turns an outage into popup text. */
export function useMapDescribe() {
  const { place, when, kindLabel } = useOutageLabels();
  return (o: Outage) => ({ title: place(o), when: when(o), kind: kindLabel(o) });
}

export function MapFallback({ height }: { height: number | string }) {
  return <div className="map map-loading" style={{ height }} aria-hidden />;
}

export function MapView() {
  const { t, lang } = useI18n();
  const describe = useMapDescribe();
  const [outages, setOutages] = useState<Outage[] | null>(null);
  const [period, setPeriod] = useState<'now' | 'week' | 'all'>('week');
  const [utility, setUtility] = useState<Utility | ''>('');
  const [error, setError] = useState(false);

  useEffect(() => {
    api.outages({ utility: utility || undefined }).then((r) => setOutages(r.outages)).catch(() => setError(true));
  }, [utility]);

  const shown = useMemo(() => {
    const now = Date.now();
    return (outages ?? []).filter((o) => {
      if (isNotice(o) && o.kind !== 'schedule' && o.kind !== 'advisory') return false; // general news isn't a place
      if (period === 'now') return o.status === 'ongoing' && !isNotice(o); // cuts in progress only
      if (period === 'week') return Date.parse(o.startsAt) < now + 7 * DAY;
      return true;
    });
  }, [outages, period]);

  const national = shown.filter((o) => o.scope === 'national').length;
  const onMap = shown.filter((o) => o.scope !== 'national');
  const mappedCuts = onMap.filter((o) => !isNotice(o)).length;
  const mappedNotices = onMap.length - mappedCuts;

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Mauritius · Rodrigues</p>
        <h1 className="display">{t.mapTitle}</h1>
        <p className="lede">{t.mapIntro}</p>
      </header>

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Period">
          {([['now', t.mapNow], ['week', t.mapWeek], ['all', t.mapAll]] as const).map(([w, label]) => (
            <button key={w} role="tab" aria-selected={period === w} className={period === w ? 'active' : ''} onClick={() => setPeriod(w)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-tabs" role="group" aria-label="Utility">
        <button className={utility === '' ? 'active' : ''} aria-pressed={utility === ''} onClick={() => setUtility('')}>{t.all}</button>
        <button className={`electricity ${utility === 'electricity' ? 'active' : ''}`} aria-pressed={utility === 'electricity'} onClick={() => setUtility('electricity')}>
          <Zap size={14} aria-hidden />{t.electricity}
        </button>
        <button className={`water ${utility === 'water' ? 'active' : ''}`} aria-pressed={utility === 'water'} onClick={() => setUtility('water')}>
          <Droplet size={14} aria-hidden />{t.water}
        </button>
      </div>

      <div className="map-frame">
        {error ? (
          <div className="empty"><h3>{t.error}</h3></div>
        ) : (
          <Suspense fallback={<MapFallback height="min(62vh, 560px)" />}>
            <OutageMap outages={shown} height="min(62vh, 560px)" describe={describe} lang={lang} />
          </Suspense>
        )}
        <div className="map-legend" aria-hidden>
          <span><i className="map-pin electricity" />{t.electricity}</span>
          <span><i className="map-pin water" />{t.water}</span>
          <span><i className="map-pin plain live" />{t.legendLive}</span>
        </div>
      </div>

      {outages && (
        <p className="hint" style={{ marginTop: 12 }}>
          {onMap.length === 0 ? t.nothingOnMap : t.cutsCount(mappedCuts)}
          {mappedNotices > 0 && <> · {t.noticesCount(mappedNotices)}</>}
          {national > 0 && <> · {t.notOnMap(national)}</>}
        </p>
      )}
    </>
  );
}
