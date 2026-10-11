import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { Outage } from '../api';
import { isNotice } from './OutageCard';
import { usePlaces } from '../state';

// Mainland Mauritius. Rodrigues is ~600 km east; the map pans there only when it has outages.
const MAINLAND: L.LatLngBoundsExpression = [[-20.53, 57.3], [-19.97, 57.81]];

// OpenStreetMap's standard tiles need no key; CSS tones them down to match the UI (see .map-tiles).
// For real traffic, point VITE_TILE_URL at a paid provider (MapTiler, Stadia…) and update the attribution.
const TILE_URL: string = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION: string = import.meta.env.VITE_TILE_ATTRIBUTION ??
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

type Point = { key: string; lat: number; lng: number; name: string; outages: Outage[] };

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type OutageMapProps = {
  outages: Outage[];
  /** Locality to centre on (e.g. the user's area). */
  focus?: string | null;
  height: number | string;
  /** Static preview: no zoom controls or scroll zoom; tapping opens `href`. */
  preview?: boolean;
  describe: (o: Outage) => { title: string; when: string; kind: string };
  /** Popups are rebuilt when this changes (labels are translated). */
  lang: string;
};

/** Leaflet map with one marker per affected place. */
export default function OutageMap({ outages, focus, height, preview, describe, lang }: OutageMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const { byId, districts } = usePlaces();
  // describe() is a fresh closure every render; read it through a ref so markers only redraw on real changes.
  const describeRef = useRef(describe);
  describeRef.current = describe;

  // Create the map once.
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, {
      zoomControl: !preview,
      scrollWheelZoom: false,
      dragging: !preview || !L.Browser.mobile,
      attributionControl: true,
      zoomSnap: 1, // fractional zoom scales tiles and leaves hairline seams between them
    });
    m.attributionControl.setPrefix(false);
    L.tileLayer(TILE_URL, { maxZoom: 18, attribution: TILE_ATTRIBUTION, className: 'map-tiles' }).addTo(m);
    m.fitBounds(MAINLAND);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(el.current);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
    };
  }, [preview]);

  // Redraw markers whenever the data changes.
  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    if (!m || !group) return;
    group.clearLayers();

    const points = new Map<string, Point>();
    const add = (key: string, lat: number, lng: number, name: string, o: Outage) => {
      const p = points.get(key) ?? { key, lat, lng, name, outages: [] };
      if (!p.outages.includes(o)) p.outages.push(o);
      points.set(key, p);
    };
    for (const o of outages) {
      if (o.scope === 'national') continue;
      let placed = false;
      for (const id of o.localities) {
        const l = byId.get(id);
        if (l?.lat !== undefined && l.lng !== undefined) {
          add(id, l.lat, l.lng, l.name, o);
          placed = true;
        }
      }
      const d = districts.find((x) => x.id === o.district);
      if (!placed && d?.center) add(`d:${d.id}`, d.center[0], d.center[1], d.name, o);
    }

    for (const p of points.values()) {
      // Only an actual cut in progress pulses; supply-hour notices are "current" but not live.
      const isLive = (o: Outage) => o.status === 'ongoing' && !isNotice(o);
      const live = p.outages.some(isLive);
      const utilities = new Set(p.outages.map((o) => o.utility));
      const tone = utilities.size > 1 ? 'both' : [...utilities][0];
      const n = p.outages.length;
      const icon = L.divIcon({
        className: '',
        html: `<span class="map-pin ${tone} ${live ? 'live' : ''}">${n > 1 ? n : ''}</span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const rows = p.outages
        .map((o) => {
          const d = describeRef.current(o);
          return `<a class="map-pop-row" href="#/outage/${o.id}">
            <span class="map-pop-kind ${o.utility}">${escape(d.kind)}${isLive(o) ? ' · <b>LIVE</b>' : ''}</span>
            <span class="map-pop-when">${escape(d.when)}</span>
          </a>`;
        })
        .join('');
      const marker = L.marker([p.lat, p.lng], { icon, keyboard: true, title: p.name });
      marker.bindPopup(`<div class="map-pop"><div class="map-pop-title">${escape(p.name)}</div>${rows}</div>`, {
        closeButton: false,
        maxWidth: 260,
        autoPanPadding: [16, 16],
      });
      group.addLayer(marker);
    }

    const f = focus ? byId.get(focus) : undefined;
    if (f?.lat !== undefined && f.lng !== undefined) {
      m.setView([f.lat, f.lng], 12.5);
    } else if (points.size && [...points.values()].every((p) => p.lng > 63)) {
      // Only Rodrigues affected.
      m.fitBounds(L.latLngBounds([...points.values()].map((p) => [p.lat, p.lng])).pad(0.5), { maxZoom: 12 });
    } else {
      m.fitBounds(MAINLAND);
    }
  }, [outages, focus, byId, districts, lang]);

  return <div ref={el} className={`map ${preview ? 'preview' : ''}`} style={{ height }} />;
}
