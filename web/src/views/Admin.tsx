import { LogOut, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Report } from '../api';
import { api } from '../api';
import { Skeleton } from '../App';
import { LocalityPicker } from '../components/LocalityPicker';
import { UtilityIcon } from '../components/OutageCard';
import { storage, usePlaces } from '../state';

// Moderator screen (English only). Reached via #/admin; protected by the server's ADMIN_TOKEN.
export function Admin() {
  const { byId, districtName } = usePlaces();
  const [token, setToken] = useState(() => storage.get('adminToken') ?? '');
  const [input, setInput] = useState('');
  const [reports, setReports] = useState<Report[] | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    api.admin.reports(token).then((r) => setReports(r.reports)).catch((err) => {
      setMessage(err.message);
      if (/token/i.test(err.message)) { storage.set('adminToken', null); setToken(''); }
    });
  }, [token]);
  useEffect(load, [load]);

  if (!token) {
    return (
      <form className="form" style={{ maxWidth: 380 }} onSubmit={(e) => { e.preventDefault(); storage.set('adminToken', input); setToken(input); }}>
        <header>
          <p className="eyebrow">Moderation</p>
          <h1 className="display sm">Sign in</h1>
        </header>
        <label className="field">
          <span className="label">Admin token</span>
          <input className="input" type="password" value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
        </label>
        {message && <p className="error">{message}</p>}
        <button className="btn primary block">Continue</button>
      </form>
    );
  }

  const moderate = async (id: number, action: 'approve' | 'reject', notify = false) => {
    await api.admin.moderate(token, id, action, notify);
    load();
  };

  const ingest = async () => {
    setMessage('Fetching CEB and CWA…');
    const { results } = await api.admin.ingest(token);
    setMessage(results.map((r) => `${r.source.toUpperCase()}: ${r.found} found, ${r.created} new${r.error ? ` (${r.error})` : ''}`).join(' · '));
  };

  return (
    <>
      <header className="page-head" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p className="eyebrow">Moderation</p>
          <h1 className="display sm">Review queue</h1>
        </div>
        <div className="btn-row">
          <button className="btn sm" onClick={ingest}><RefreshCw size={14} aria-hidden />Run ingest</button>
          <button className="btn sm ghost" onClick={() => { storage.set('adminToken', null); setToken(''); }}><LogOut size={14} aria-hidden />Sign out</button>
        </div>
      </header>
      {message && <p className="hint" role="status">{message}</p>}

      <section className="section">
        <div className="section-head">
          <h2>Pending community reports</h2>
          {reports && <span className="count">{reports.length}</span>}
        </div>
        {!reports ? <Skeleton rows={2} /> : reports.length === 0 ? (
          <p className="hint" style={{ padding: '16px 0' }}>Nothing to review.</p>
        ) : reports.map((r) => {
          const loc = byId.get(r.locality);
          return (
            <div key={r.id} className="admin-item">
              <div className="kicker">
                <span className={`kind ${r.utility}`}><UtilityIcon utility={r.utility} size={13} />{r.utility === 'electricity' ? 'Electricity' : 'Water'}</span>
                <span className="tag-quiet">{loc?.name ?? r.locality} · {loc ? districtName(loc.district) : ''}</span>
              </div>
              <p>{r.description}</p>
              <p className="meta">
                {new Date(r.created_at).toLocaleString('en-GB', { timeZone: 'Indian/Mauritius', dateStyle: 'medium', timeStyle: 'short' })}
                {r.similar > 1 && <span className="cluster"> · {r.similar} similar reports within 2h</span>}
              </p>
              <div className="btn-row">
                <button className="btn sm primary" onClick={() => moderate(r.id, 'approve')}>Approve</button>
                <button className="btn sm" onClick={() => moderate(r.id, 'approve', true)}>Approve and alert</button>
                <button className="btn sm ghost danger" onClick={() => moderate(r.id, 'reject')}>Reject</button>
              </div>
            </div>
          );
        })}
      </section>

      <ManualOutage token={token} onDone={setMessage} />
    </>
  );
}

/** For notices posted only on Facebook, radio or WhatsApp groups. */
function ManualOutage({ token, onDone }: { token: string; onDone: (m: string) => void }) {
  const { byId } = usePlaces();
  const [utility, setUtility] = useState<'electricity' | 'water'>('water');
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [details, setDetails] = useState('');
  const [url, setUrl] = useState('');
  const [localities, setLocalities] = useState<string[]>([]);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const { outage } = await api.admin.addOutage(token, { utility, title, when, details, url, localities });
      onDone(`Published #${outage.id}: ${outage.title}`);
      setTitle(''); setWhen(''); setDetails(''); setUrl(''); setLocalities([]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="section">
      <div className="section-head"><h2>Add a notice manually</h2></div>
      <form className="form" style={{ gap: 16, marginTop: 16 }} onSubmit={submit}>
        <p className="hint">For notices posted only on Facebook, radio or WhatsApp groups. Subscribers in the selected areas are alerted.</p>
        <label className="field">
          <span className="label">Utility</span>
          <select className="select" style={{ height: 46 }} value={utility} onChange={(e) => setUtility(e.target.value as typeof utility)}>
            <option value="water">Water (CWA)</option>
            <option value="electricity">Electricity (CEB)</option>
          </select>
        </label>
        <label className="field">
          <span className="label">Title</span>
          <input className="input" placeholder="Goodlands and Grand Gaube" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="field">
          <span className="label">When</span>
          <input className="input" placeholder="20 October 09:00 to 16:00" value={when} onChange={(e) => setWhen(e.target.value)} required />
        </label>
        <label className="field">
          <span className="label">Streets / details</span>
          <textarea className="input" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Source link</span>
          <input className="input" placeholder="https://facebook.com/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <div className="field">
          <span className="label">Localities</span>
          {localities.length > 0 && (
            <div className="chips">
              {localities.map((l) => (
                <span key={l} className="chip">
                  {byId.get(l)?.name}
                  <button type="button" aria-label="Remove" onClick={() => setLocalities(localities.filter((x) => x !== l))}><X size={12} strokeWidth={2.5} /></button>
                </span>
              ))}
            </div>
          )}
          <LocalityPicker exclude={localities} onPick={(id) => setLocalities([...localities, id])} />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn primary block">Publish and alert subscribers</button>
      </form>
    </section>
  );
}
