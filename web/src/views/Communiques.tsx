import { useEffect, useState } from 'react';
import type { Outage } from '../api';
import { api } from '../api';
import { Skeleton } from '../App';
import { OutageCard } from '../components/OutageCard';
import { useI18n } from '../i18n';

/** Archive of every CWA communiqué, newest first. */
export function Communiques() {
  const { t } = useI18n();
  const [items, setItems] = useState<Outage[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = (offset: number) => {
    setLoading(true);
    setError(false);
    api.communiques(offset)
      .then((r) => {
        setItems((cur) => (offset === 0 ? r.items : [...cur, ...r.items]));
        setTotal(r.total);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(0), []);

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Central Water Authority</p>
        <h1 className="display">{t.newsTab}</h1>
        <p className="lede">{t.communiquesIntro}</p>
      </header>

      {error && (
        <div className="empty">
          <h3>{t.error}</h3>
          <button className="btn" onClick={() => load(items.length)}>{t.retry}</button>
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <h2>{t.allCommuniques}</h2>
          {total !== null && <span className="count">{total}</span>}
        </div>
        {total === null && !error ? <Skeleton rows={4} /> : (
          <div className="rows">{items.map((o) => <OutageCard key={o.id} outage={o} />)}</div>
        )}
      </section>

      {total !== null && items.length < total && (
        <p className="center" style={{ marginTop: 24 }}>
          <button className="btn" disabled={loading} onClick={() => load(items.length)}>
            {loading ? t.loading : `${t.loadMore} · ${total - items.length}`}
          </button>
        </p>
      )}
    </>
  );
}
