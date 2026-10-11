import { ChevronLeft, ExternalLink, FileText, Share2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Outage } from '../api';
import { api } from '../api';
import { Skeleton } from '../App';
import { SOURCE_NAMES, UtilityIcon, isNotice, useOutageLabels } from '../components/OutageCard';
import { useI18n } from '../i18n';
import { usePlaces } from '../state';

export function OutageDetail({ id }: { id: number }) {
  const { t } = useI18n();
  const { byId, districtName } = usePlaces();
  const { place, when, kindLabel } = useOutageLabels();
  const [outage, setOutage] = useState<Outage | null>(null);
  const [error, setError] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    api.outage(id).then((r) => setOutage(r.outage)).catch(() => setError(true));
  }, [id]);

  const back = <a href="#/" className="back"><ChevronLeft size={18} aria-hidden />{t.back}</a>;
  if (error) return <>{back}<div className="empty"><h3>{t.error}</h3></div></>;
  if (!outage) return <>{back}<Skeleton rows={1} /></>;

  const o = outage;
  const confirm = async () => {
    const { confirmations } = await api.confirm(o.id);
    setOutage({ ...o, confirmations });
    setConfirmed(true);
  };

  const title = place(o);
  const shareText = `${title} — ${when(o)}\n${location.href}`;
  const where = o.district ? districtName(o.district) : o.scope === 'national' ? t.islandWide : null;

  return (
    <article>
      {back}
      <p className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className={`kind ${o.utility}`}><UtilityIcon utility={o.utility} size={13} /> {kindLabel(o)}</span>
        {where && <span>· {where}</span>}
        {o.status === 'ongoing' && !isNotice(o) && <span className="live-badge">{t.live}</span>}
      </p>
      <h1 className={`display ${title.length > 48 ? 'sm' : ''}`}>{title}</h1>

      {o.imageUrl && (
        <a className="poster" href={o.attachmentUrl ?? o.imageUrl} target="_blank" rel="noreferrer" aria-label={t.viewPoster}>
          <img src={o.imageUrl} alt={t.poster} />
          <span className="poster-cta"><FileText size={14} aria-hidden />{t.viewPoster}</span>
        </a>
      )}

      <dl className="facts">
        <div>
          <dt>{t.when}</dt>
          <dd className="big">{when(o)}</dd>
        </div>
        {o.details && (
          <div>
            <dt>{o.source === 'community' ? t.describe : t.streets}</dt>
            <dd>{o.details}</dd>
          </div>
        )}
        {o.localities.length > 0 && (
          <div>
            <dt>{t.areas}</dt>
            <dd className="chips">
              {o.localities.map((l) => <span key={l} className="chip static">{byId.get(l)?.name ?? l}</span>)}
            </dd>
          </div>
        )}
        <div>
          <dt>{t.source}</dt>
          <dd>{o.source === 'community' ? t.community : SOURCE_NAMES[o.source]}</dd>
        </div>
      </dl>

      {o.source === 'community' && (
        <div className="notice" role="note">
          <TriangleAlert size={18} aria-hidden />
          <div className="n-body">
            <p><strong>{t.unverified}</strong><br />{t.affected(o.confirmations + 1)}</p>
            <button className="btn sm" onClick={confirm} disabled={confirmed}>{t.meToo}</button>
          </div>
        </div>
      )}

      <div className="actions">
        {o.url && (
          <a className="btn" href={o.url} target="_blank" rel="noreferrer">
            <ExternalLink size={16} aria-hidden />{t.officialNotice}
          </a>
        )}
        {o.attachmentUrl && (
          <a className="btn" href={o.attachmentUrl} target="_blank" rel="noreferrer">
            <FileText size={16} aria-hidden />{t.pdf}
          </a>
        )}
        <a className="btn primary" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">
          <Share2 size={16} aria-hidden />{t.share}
        </a>
      </div>
    </article>
  );
}
