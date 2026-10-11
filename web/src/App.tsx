import { Bell, House, Map as MapIcon, Megaphone, Moon, Newspaper, Sun } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { LogoMark } from './components/Logo';
import type { Lang } from './i18n';
import { DICTS, I18nContext } from './i18n';
import type { Places } from './state';
import { PlacesContext, storage } from './state';
import { Admin } from './views/Admin';
import { Alerts } from './views/Alerts';
import { Communiques } from './views/Communiques';
import { Home } from './views/Home';
import { MapView } from './views/MapView';
import { OutageDetail } from './views/OutageDetail';
import { ReportForm } from './views/ReportForm';

function useHashRoute(): string {
  const [hash, setHash] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => {
      setHash(location.hash.slice(1) || '/');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function initialLang(): Lang {
  const saved = storage.get('lang');
  if (saved === 'en' || saved === 'fr' || saved === 'mfe') return saved;
  return navigator.language.startsWith('fr') ? 'fr' : 'en';
}

const LANG_SHORT: Array<[Lang, string]> = [['mfe', 'KR'], ['fr', 'FR'], ['en', 'EN']];

export function App() {
  const route = useHashRoute();
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [places, setPlaces] = useState<Places | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (storage.get('theme') === 'dark' ? 'dark' : 'light'));

  // Light by default; dark only when the visitor asks for it.
  useEffect(() => {
    if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0e1013' : '#f6f5f1');
    storage.set('theme', theme === 'dark' ? 'dark' : null);
  }, [theme]);

  const setLang = (l: Lang) => {
    setLangState(l);
    storage.set('lang', l);
  };
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    api.localities().then(({ districts, localities }) => {
      const byId = new Map(localities.map((l) => [l.id, l]));
      const dById = new Map(districts.map((d) => [d.id, d.name]));
      setPlaces({ districts, localities, byId, districtName: (id) => (id ? dById.get(id) ?? id : '') });
    }).catch(() => setLoadError(true));
  }, []);

  const i18n = useMemo(() => ({ lang, t: DICTS[lang], setLang }), [lang]);
  const t = i18n.t;

  let view;
  const outageMatch = route.match(/^\/outage\/(\d+)/);
  if (outageMatch) view = <OutageDetail id={Number(outageMatch[1])} />;
  else if (route === '/report') view = <ReportForm />;
  else if (route === '/alerts') view = <Alerts />;
  else if (route === '/communiques') view = <Communiques />;
  else if (route === '/map') view = <MapView />;
  else if (route === '/admin') view = <Admin />;
  else view = <Home />;

  const tab = route.replace(/^\//, '').split('/')[0] || 'home';
  const nav = [
    { id: 'home', href: '#/', label: t.home, Icon: House },
    { id: 'map', href: '#/map', label: t.map, Icon: MapIcon },
    { id: 'communiques', href: '#/communiques', label: t.newsNav, Icon: Newspaper },
    { id: 'report', href: '#/report', label: t.report, Icon: Megaphone },
    { id: 'alerts', href: '#/alerts', label: t.alerts, Icon: Bell },
  ];
  const isActive = (id: string) => tab === id || (id === 'home' && tab === 'outage');

  return (
    <I18nContext.Provider value={i18n}>
      <header className="topbar">
        {/* The four colours of the Mauritian flag. */}
        <div className="flag-stripe" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className="topbar-inner">
          <a href="#/" className="wordmark" aria-label="Kouran ek Dilo">
            <LogoMark size={24} />
            <span className="wm-text">Kouran <em>ek</em> Dilo</span>
          </a>
          <nav className="topnav" aria-label="Main">
            {nav.map(({ id, href, label }) => (
              <a key={id} href={href} className={isActive(id) ? 'active' : ''} aria-current={isActive(id) ? 'page' : undefined}>
                {label}
              </a>
            ))}
          </nav>
          <button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? t.lightMode : t.darkMode} title={theme === 'dark' ? t.lightMode : t.darkMode}>
            {theme === 'dark' ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
          </button>
          <div className="lang" role="group" aria-label="Language">
            {LANG_SHORT.map(([l, label]) => (
              <button key={l} className={l === lang ? 'active' : ''} onClick={() => setLang(l)} aria-pressed={l === lang}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="container">
        {loadError ? (
          <div className="empty">
            <h3>{t.error}</h3>
            <button className="btn" onClick={() => location.reload()}>{t.retry}</button>
          </div>
        ) : places ? (
          <PlacesContext.Provider value={places}>{view}</PlacesContext.Provider>
        ) : (
          <Skeleton />
        )}
        <footer className="footer">
          <p>{t.disclaimer}</p>
          <p>
            <a href="https://ceb.mu/customer-corner/power-outage-information" target="_blank" rel="noreferrer">ceb.mu</a>
            {' · '}
            <a href="https://cwa.govmu.org/cwa/?cat=2" target="_blank" rel="noreferrer">cwa.govmu.org</a>
          </p>
        </footer>
      </main>

      {tab !== 'admin' && (
        <nav className="bottom-nav" aria-label="Main">
          {nav.map(({ id, href, label, Icon }) => (
            <a key={id} href={href} className={isActive(id) ? 'active' : ''} aria-current={isActive(id) ? 'page' : undefined}>
              <Icon size={21} strokeWidth={isActive(id) ? 2.2 : 1.8} aria-hidden />
              {label}
            </a>
          ))}
        </nav>
      )}
    </I18nContext.Provider>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton">
          <div><i style={{ width: 44 }} /><i style={{ width: 32 }} /></div>
          <div><i style={{ width: '30%' }} /><i style={{ width: '65%' }} /><i style={{ width: '45%' }} /></div>
        </div>
      ))}
    </div>
  );
}
