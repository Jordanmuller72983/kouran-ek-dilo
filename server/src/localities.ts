import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Gazetteer of Mauritian towns and villages, grouped by district.
// Used to turn free-text notices ("Part of Rose-Hill", "Ste Croix") into stable locality ids.
// Add aliases freely: the matcher ignores accents, case, hyphens and "St"/"Ste" abbreviations.

export const DISTRICTS = [
  { id: 'port-louis', name: 'Port Louis' },
  { id: 'pamplemousses', name: 'Pamplemousses' },
  { id: 'riviere-du-rempart', name: 'Rivière du Rempart' },
  { id: 'flacq', name: 'Flacq' },
  { id: 'moka', name: 'Moka' },
  { id: 'plaines-wilhems', name: 'Plaines Wilhems' },
  { id: 'black-river', name: 'Black River' },
  { id: 'grand-port', name: 'Grand Port' },
  { id: 'savanne', name: 'Savanne' },
  { id: 'rodrigues', name: 'Rodrigues' },
] as const;

export type DistrictId = (typeof DISTRICTS)[number]['id'];

// [name, extra aliases]
const RAW: Record<DistrictId, Array<[string, string[]?]>> = {
  'port-louis': [
    ['Port Louis', ['Port-Louis']],
    ['Plaine Verte'], ['Roche Bois'], ['Vallée Pitot'], ['Vallée des Prêtres'], ['Tranquebar'],
    ['Sainte Croix'], ['Cassis'], ['Bell Village'], ['Camp Yoloff'], ['Plaine Lauzun'],
    ['Cité Martial'], ['Les Salines'], ['Pointe aux Sables'], ['Résidence La Cure', ['La Cure']],
    ['Cité Vallijee'], ['Champ de Mars'], ['Chinatown'],
  ],
  pamplemousses: [
    ['Pamplemousses'], ['Triolet'], ['Terre Rouge'], ['Le Hochet'], ['Baie du Tombeau'],
    ['Arsenal'], ['Calebasses'], ['Congomah'], ['Crève Coeur'], ["D'Épinay"], ['Long Mountain'],
    ['Morcellement Saint André', ['Saint André']], ['Notre Dame'], ['Plaine des Papayes'],
    ['Pointe aux Piments'], ['Trou aux Biches'], ['Villebague'], ['Solitude'], ['Fond du Sac'],
    ['Grande Rosalie'], ['Mont Choisy'], ['Mapou'], ['Bois Rouge'],
  ],
  'riviere-du-rempart': [
    ['Grand Baie', ['Grand-Bay', 'Grand Bay']], ['Pereybère', ['Pereybere']], ['Cap Malheureux'],
    ['Goodlands'], ['Grand Gaube'], ['Rivière du Rempart'], ["Poudre d'Or"], ['Roches Noires'],
    ['Plaine des Roches'], ['Piton'], ['Petit Raffray'], ['Calodyne'], ['Amaury'], ['Schoenfeld'],
    ['Belle Vue Maurel'], ['Cottage'], ['The Vale'], ['Forbach'], ['Saint Antoine'],
    ['Poudre d\'Or Hamlet'], ['Rivière du Rempart Village'], ['Esperance Trebuchet'],
  ],
  flacq: [
    ['Centre de Flacq', ['Flacq']], ['Belle Mare'], ['Poste de Flacq'], ['Quatre Cocos'],
    ['Lalmatie', ['Lallmatie']], ['Bel Air Rivière Sèche', ['Bel Air']], ['Bon Accueil'],
    ['Brisée Verdière'], ['Camp de Masque'], ['Écroignard'], ['Laventure'], ['Olivia'], ['Palmar'],
    ["Trou d'Eau Douce"], ['Saint Julien Village'], ['Médine Camp de Masque'],
    ['Grande Rivière Sud Est', ['GRSE']], ['Clémencia'], ['Sebastopol'], ['Queen Victoria'],
    ['Constance'], ['Bramsthan'], ['Camp Ithier'], ['Mare la Chaux'],
  ],
  moka: [
    ['Moka'], ['Quartier Militaire'], ['Saint Pierre'], ['Montagne Blanche'], ['Dagotière'],
    ['Pailles'], ['Réduit'], ['Nouvelle Découverte'], ['Melrose'], ['Verdun'], ['Ripailles'],
    ["L'Avenir"], ['Providence'], ['Camp Thorel'], ['Alma'], ["Saint Julien d'Hotman"],
    ['La Laura'], ['Malenga'], ['Bois Chéri Moka'], ['Petit Paquet'], ['Circonstance'],
    ['Le Ruisseau'], ['Bon Air'], ['Valetta'], ['Helvetia'],
  ],
  'plaines-wilhems': [
    ['Curepipe'], ['Vacoas'], ['Phoenix'], ['Quatre Bornes', ['4 Bornes']], ['Rose Hill'],
    ['Beau Bassin'], ['Floréal'], ['Forest Side'], ['Highlands'], ['Midlands'], ['La Marie'],
    ['Glen Park'], ['Henrietta'], ['Bonne Terre'], ['Sodnac'], ['Ébène', ['Ebene Cybercity']],
    ['Belle Rose'], ['Coromandel'], ['Stanley'], ['Trèfles'], ['Camp Fouquereaux'],
    ['La Caverne'], ['Mesnil'], ['Eau Coulée'], ['Wooton'], ['Castel'], ['Palma'], ['Candos'],
    ['Pont Fer'], ['Hermitage'], ['Cité La Caverne'], ['Petit Camp'],
    ['Camp Levieux'], ['Chebel'], ['Roches Brunes'],
  ],
  'black-river': [
    ['Flic en Flac'], ['Tamarin'], ['Rivière Noire'], ['Grande Rivière Noire'], ['La Gaulette'],
    ['Le Morne'], ['Bambous'], ['Albion'], ['Petite Rivière'], ['Cascavelle'], ['Chamarel'],
    ['Case Noyale'], ['Gros Cailloux'], ['La Preneuse'], ['Richelieu'], ['Wolmar'],
    ['Coteau Raffin'], ['Médine'], ['Beaux Songes'], ['Canot'],
  ],
  'grand-port': [
    ['Mahébourg', ['Mahebourg']], ['Rose Belle'], ['Plaine Magnien'], ['New Grove'],
    ['Grand Bel Air'], ['Blue Bay'], ['Vieux Grand Port', ['Old Grand Port']], ["Mare d'Albert"],
    ['Cluny'], ['Beau Vallon'], ['Bambous Virieux'], ['Union Park'], ['Mare Tabac'],
    ['Trois Boutiques'], ['Petit Bel Air'], ['Ferney'], ['Grand Sable'], ["L'Escalier"],
    ['Rivière des Créoles'], ['Riche en Eau'], ['Bois des Amourettes'], ['Nouvelle France'],
    ['Plaine des Roches Grand Port'], ['Camp Carol'], ['Pointe d\'Esny'], ['Ville Noire'],
  ],
  savanne: [
    ['Souillac'], ['Surinam'], ['Chemin Grenier'], ['Rivière des Anguilles'], ['Bel Ombre'],
    ['Baie du Cap'], ['Saint Aubin'], ['Grand Bois'], ['Britannia'], ['Tyack'], ['Bois Chéri'],
    ['Camp Diable'], ['Rivière du Poste'], ['Saint Félix'], ['Choisy'], ['Bénarès'],
    ['La Flora'], ['Batimarais'], ['Chamouny'], ['Rivière Dragon'], ['Senneville'],
  ],
  rodrigues: [
    ['Port Mathurin'], ['La Ferme'], ['Baie aux Huîtres'], ['Mont Lubin'], ['Grande Montagne'],
    ['Plaine Corail'], ['Pointe Coton'], ['Baladirou'], ['Petit Gabriel'], ['Citronelle'],
    ['Anse aux Anglais'], ['Rivière Coco'],
  ],
};

export type Locality = { id: string; name: string; district: DistrictId; lat?: number; lng?: number };

/** Lowercase, strip accents and punctuation, expand St/Ste. */
export function normalize(text: string): string {
  return ` ${text} `
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-'’`.,;:/()&"]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ ste /g, ' sainte ')
    .replace(/ st /g, ' saint ')
    .replace(/ mt /g, ' mont ');
}

function slug(name: string): string {
  return normalize(name).trim().replace(/ /g, '-');
}

// Coordinates come from OpenStreetMap (scripts/geocode-localities.ts) and drive the outage map.
const coordsFile = path.join(import.meta.dirname, 'data', 'locality-coords.json');
const COORDS: Record<string, [number, number]> = existsSync(coordsFile) ? JSON.parse(readFileSync(coordsFile, 'utf8')) : {};

export const LOCALITIES: Locality[] = Object.entries(RAW).flatMap(([district, entries]) =>
  entries.map(([name]) => {
    const id = slug(name);
    const c = COORDS[id];
    return { id, name, district: district as DistrictId, ...(c ? { lat: c[0], lng: c[1] } : {}) };
  }),
);

/** Median point of a district's localities, for notices that only name the district. */
export function districtCenter(id: DistrictId): [number, number] | null {
  const pts = LOCALITIES.filter((l) => l.district === id && l.lat !== undefined);
  if (!pts.length) return null;
  const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return [med(pts.map((p) => p.lat!)), med(pts.map((p) => p.lng!))];
}

const byId = new Map(LOCALITIES.map((l) => [l.id, l]));

export function getLocality(id: string): Locality | undefined {
  return byId.get(id);
}

export function isDistrict(id: string): id is DistrictId {
  return DISTRICTS.some((d) => d.id === id);
}

// Longest aliases first so "Grand Bel Air" wins over "Bel Air", "Poste de Flacq" over "Flacq".
const ALIASES: Array<{ alias: string; id: string }> = Object.values(RAW)
  .flat()
  .flatMap(([name, extra = []]) => [name, ...extra].map((a) => ({ alias: normalize(a), id: slug(name) })))
  .sort((a, b) => b.alias.length - a.alias.length);

/** Find every known locality mentioned in a piece of text. */
export function matchLocalities(text: string): string[] {
  let haystack = normalize(text);
  const found = new Set<string>();
  for (const { alias, id } of ALIASES) {
    if (haystack.includes(alias)) {
      found.add(id);
      // Blank out the match so shorter aliases inside it don't also fire.
      haystack = haystack.split(alias).join(' # ');
    }
  }
  return [...found];
}
