/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Map tile URL template, e.g. a MapTiler or Stadia style with your key. Defaults to OpenStreetMap. */
  readonly VITE_TILE_URL?: string;
  readonly VITE_TILE_ATTRIBUTION?: string;
}
