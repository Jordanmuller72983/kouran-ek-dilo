import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

/** Selectable card used for utility and channel choices (radio or checkbox under the hood). */
export function Option({ type, name, checked, onChange, icon, label, className = '' }: {
  type: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  onChange: () => void;
  icon: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <label className={`option ${className} ${checked ? 'active' : ''}`}>
      <input type={type} name={name} checked={checked} onChange={onChange} />
      <span className="o-icon">{icon}</span>
      <span className="o-label">{label}</span>
      <span className="o-check" aria-hidden><Check size={12} strokeWidth={3} /></span>
    </label>
  );
}
