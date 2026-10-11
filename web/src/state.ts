import { createContext, useContext } from 'react';
import type { District, Locality } from './api';

export type Places = {
  districts: District[];
  localities: Locality[];
  byId: Map<string, Locality>;
  districtName: (id: string | null) => string;
};

export const PlacesContext = createContext<Places | null>(null);

export function usePlaces(): Places {
  const places = useContext(PlacesContext);
  if (!places) throw new Error('PlacesContext missing');
  return places;
}

// localStorage can be unavailable (private mode, blocked storage); the app must still work.
export const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* ignore */ }
  },
};
