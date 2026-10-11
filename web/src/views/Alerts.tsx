import { Check, Droplet, MessageCircle, MessageSquare, Plus, Smartphone, X, Zap } from 'lucide-react';
import { useState } from 'react';
import type { Utility } from '../api';
import { api } from '../api';
import { LocalityPicker } from '../components/LocalityPicker';
import { Option } from '../components/Options';
import { useI18n } from '../i18n';
import { storage, usePlaces } from '../state';

type Channel = 'webpush' | 'whatsapp' | 'sms';

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export function Alerts() {
  const { t, lang } = useI18n();
  const { byId } = usePlaces();
  const [places, setPlaces] = useState<string[]>(() => {
    const area = storage.get('area');
    return area && byId.has(area) ? [area] : [];
  });
  const [adding, setAdding] = useState(false);
  const [utilities, setUtilities] = useState<Utility[]>(['electricity', 'water']);
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'form' | 'code' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState(() => storage.get('unsubscribeToken'));

  const prefs = () => ({ localities: places, utilities, lang });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  const done = (unsubscribeToken: string) => {
    storage.set('unsubscribeToken', unsubscribeToken);
    setToken(unsubscribeToken);
    setStep('done');
  };

  const enablePush = () => run(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error(t.pushUnsupported);
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error(t.pushDenied);
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { publicKey } = await api.pushKey();
    // Browsers refuse push in private windows and some in-app browsers; show our own message.
    const subscription = await reg.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
      .catch(() => { throw new Error(t.pushUnsupported); });
    const res = await api.subscribePush({ ...prefs(), subscription: subscription.toJSON() });
    done(res.unsubscribeToken);
  });

  const sendCode = () => run(async () => {
    const res = await api.subscribePhone({ ...prefs(), channel, phone });
    setPhone(res.phone);
    setStep('code');
  });

  const verify = () => run(async () => {
    const res = await api.verifyPhone({ channel, phone, code });
    done(res.unsubscribeToken);
  });

  const stop = () => run(async () => {
    if (token) await api.unsubscribe(token).catch(() => {});
    storage.set('unsubscribeToken', null);
    setToken(null);
    setStep('form');
    setError(t.unsubscribed);
  });

  const toggleUtility = (u: Utility) =>
    setUtilities((cur) => (cur.includes(u) ? (cur.length > 1 ? cur.filter((x) => x !== u) : cur) : [...cur, u]));

  if (step === 'done') {
    return (
      <div className="success">
        <div className="s-icon"><Check size={26} aria-hidden /></div>
        <h2>{t.subscribed}</h2>
        <div className="chips" style={{ justifyContent: 'center' }}>
          {places.map((p) => <span key={p} className="chip static">{byId.get(p)?.name}</span>)}
        </div>
        <button className="btn ghost" onClick={stop}>{t.unsubscribe}</button>
      </div>
    );
  }

  const channelIcon = { whatsapp: <MessageCircle size={17} />, sms: <MessageSquare size={17} />, webpush: <Smartphone size={17} /> };
  const channelLabel = { whatsapp: t.whatsapp, sms: t.sms, webpush: t.browser };

  return (
    <div className="form">
      <header>
        <p className="eyebrow">{t.alerts}</p>
        <h1 className="display sm">{t.alertsTitle}</h1>
        <p className="lede">{t.alertsIntro}</p>
      </header>

      <div className="field">
        <span className="label">{t.places}</span>
        {places.length > 0 && (
          <div className="chips">
            {places.map((p) => (
              <span key={p} className="chip">
                {byId.get(p)?.name}
                <button type="button" aria-label={`Remove ${byId.get(p)?.name}`} onClick={() => setPlaces(places.filter((x) => x !== p))}>
                  <X size={12} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
        )}
        {adding || places.length === 0 ? (
          <LocalityPicker autoFocus={adding} exclude={places} onPick={(id) => { setPlaces([...places, id]); setAdding(false); }} />
        ) : places.length < 10 && (
          <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>
            <Plus size={15} aria-hidden />{t.addPlace}
          </button>
        )}
      </div>

      <fieldset>
        <legend className="label">{t.about}</legend>
        <div className="options">
          <Option type="checkbox" name="utilities" className="electricity" checked={utilities.includes('electricity')}
            onChange={() => toggleUtility('electricity')} icon={<Zap size={17} />} label={t.electricity} />
          <Option type="checkbox" name="utilities" className="water" checked={utilities.includes('water')}
            onChange={() => toggleUtility('water')} icon={<Droplet size={17} />} label={t.water} />
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">{t.how}</legend>
        <div className="options three">
          {(['whatsapp', 'sms', 'webpush'] as const).map((c) => (
            <Option key={c} type="radio" name="channel" checked={channel === c}
              onChange={() => { setChannel(c); setStep('form'); }} icon={channelIcon[c]} label={channelLabel[c]} />
          ))}
        </div>
      </fieldset>

      {channel === 'webpush' ? (
        <div className="field">
          <p className="hint">{t.browserHint}</p>
          <button className="btn primary block" disabled={busy || !places.length} onClick={enablePush}>{t.enableBrowser}</button>
        </div>
      ) : step === 'form' ? (
        <div className="field">
          <label className="label" htmlFor="phone">{t.phone}</label>
          <div className="phone">
            <span className="prefix">+230</span>
            <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel-national"
              placeholder={t.phonePlaceholder} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <button className="btn primary block" style={{ marginTop: 8 }}
            disabled={busy || !places.length || phone.replace(/\D/g, '').length < 8} onClick={sendCode}>
            {t.sendCode}
          </button>
        </div>
      ) : (
        <div className="field">
          <label className="label" htmlFor="code">{t.code} <span className="muted tnum">({phone})</span></label>
          <input id="code" className="input code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          <button className="btn primary block" style={{ marginTop: 8 }} disabled={busy || code.length !== 6} onClick={verify}>
            {t.verify}
          </button>
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {token && <p className="small"><button className="link" onClick={stop}>{t.unsubscribe}</button></p>}
    </div>
  );
}
