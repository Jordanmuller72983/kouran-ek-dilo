import { Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { usePlaces } from '../state';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-'’.]/g, ' ');

/** Accent-insensitive combobox over all towns and villages. */
export function LocalityPicker({ onPick, exclude = [], autoFocus }: {
  onPick: (id: string) => void;
  exclude?: string[];
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const { localities, districtName } = usePlaces();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const results = useMemo(() => {
    const q = fold(query.trim());
    const pool = localities.filter((l) => !exclude.includes(l.id));
    if (!q) return [...pool].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 50);
    const starts = pool.filter((l) => fold(l.name).startsWith(q));
    const contains = pool.filter((l) => !fold(l.name).startsWith(q) && fold(l.name).includes(q));
    return [...starts, ...contains].slice(0, 50);
  }, [query, localities, exclude]);

  const pick = (id: string) => {
    onPick(id);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); pick(results[active].id); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="combo">
      <div className="combo-field">
        <Search size={17} aria-hidden />
        <input
          className="input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={t.searchPlace}
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && (
        <ul className="combo-list" id={listId} role="listbox">
          {results.length === 0 && <li className="none">{t.noMatch}</li>}
          {results.map((l, i) => (
            <li
              key={l.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(l.id); }}
            >
              <span>{l.name}</span>
              <span className="d">{districtName(l.district)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
