import { Check, Droplet, MapPin, Zap } from 'lucide-react';
import { useState } from 'react';
import type { Utility } from '../api';
import { api } from '../api';
import { LocalityPicker } from '../components/LocalityPicker';
import { Option } from '../components/Options';
import { useI18n } from '../i18n';
import { storage, usePlaces } from '../state';

export function ReportForm() {
  const { t } = useI18n();
  const { byId, districtName } = usePlaces();
  const [utility, setUtility] = useState<Utility>('water');
  const [locality, setLocality] = useState<string | null>(() => {
    const saved = storage.get('area');
    return saved && byId.has(saved) ? saved : null;
  });
  const [picking, setPicking] = useState(false);
  const [description, setDescription] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locality) return setPicking(true);
    setState('sending');
    setError('');
    try {
      await api.report({ utility, locality, description });
      setState('done');
    } catch (err) {
      setError((err as Error).message);
      setState('idle');
    }
  };

  if (state === 'done') {
    return (
      <div className="success">
        <div className="s-icon"><Check size={26} aria-hidden /></div>
        <h2>{t.reportThanks}</h2>
        <button className="btn" onClick={() => { setDescription(''); setState('idle'); }}>{t.reportAnother}</button>
      </div>
    );
  }

  const loc = locality ? byId.get(locality) : undefined;

  return (
    <form className="form" onSubmit={submit}>
      <header>
        <p className="eyebrow">{t.report}</p>
        <h1 className="display sm">{t.reportTitle}</h1>
        <p className="lede">{t.reportIntro}</p>
      </header>

      <fieldset>
        <legend className="label">{t.whatIsOut}</legend>
        <div className="options">
          <Option type="radio" name="utility" className="electricity" checked={utility === 'electricity'}
            onChange={() => setUtility('electricity')} icon={<Zap size={17} />} label={t.electricity} />
          <Option type="radio" name="utility" className="water" checked={utility === 'water'}
            onChange={() => setUtility('water')} icon={<Droplet size={17} />} label={t.water} />
        </div>
      </fieldset>

      <div className="field">
        <span className="label">{t.where}</span>
        {loc && !picking ? (
          <div className="chosen">
            <MapPin size={18} aria-hidden />
            <div className="c-main">
              <div className="c-name">{loc.name}</div>
              <div className="c-sub">{districtName(loc.district)}</div>
            </div>
            <button type="button" className="btn ghost sm" onClick={() => setPicking(true)}>{t.change}</button>
          </div>
        ) : (
          <LocalityPicker autoFocus={picking} onPick={(id) => { setLocality(id); setPicking(false); }} />
        )}
      </div>

      <label className="field">
        <span className="label">{t.describe}</span>
        <textarea className="input" rows={4} maxLength={500} required minLength={5} value={description}
          placeholder={t.describePlaceholder} onChange={(e) => setDescription(e.target.value)} />
        <span className="hint" style={{ alignSelf: 'flex-end' }}>{description.length}/500</span>
      </label>

      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary block" disabled={state === 'sending' || !locality}>
        {state === 'sending' ? t.sending : t.send}
      </button>
    </form>
  );
}
