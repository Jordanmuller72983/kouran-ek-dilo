# Kouran ek Dilo 🇲🇺 ⚡💧

Power cut and water cut tracker for Mauritius. It pulls official CEB and CWA notices, matches them to your town or village, and alerts you on WhatsApp, SMS or browser push. Residents can report unannounced cuts, and moderators check each report before it appears.

The interface is available in **Kreol Morisien**, **French** and **English**. All times are in Mauritius time.

## Stack

| Part | Choice | Why |
|---|---|---|
| Frontend | React 19 + Vite, PWA | Mobile-first, about 90 KB gzipped on first load, installable, supports web push |
| Backend | Node 24 + Express 5 + TypeScript | Node runs `.ts` directly, so there is no build step |
| Database | SQLite (`node:sqlite`, built in) | No setup. Swap for Postgres if you outgrow it |
| Jobs | In-process schedulers | Ingest every 30 min, dispatch alerts every 60 s |
| Alerts | Web Push (VAPID), Twilio SMS + WhatsApp | Logged to the console when no credentials are set |
| Map | Leaflet + OpenStreetMap tiles | Lazy-loaded so the first page stays light; tiles toned down with CSS |
| Posters | pdf.js + @napi-rs/canvas | Renders page 1 of each CWA PDF communiqué to a JPEG thumbnail |

## Quick start

```bash
npm install
npm run dev          # API on :4000, web on :5173 (proxied)
```

Open http://localhost:5173. The first ingest runs about 2 s after the API starts.

On first start, the API prints a generated admin token. Use it at http://localhost:5173/#/admin. You can also set `ADMIN_TOKEN` in `server/.env` (copy it from `server/.env.example`).

```bash
npm test             # parser + API tests (node:test)
npm run ingest       # one-off fetch from CEB + CWA, prints a summary
npm run build && npm start   # production: API serves the built app on :4000
```

## Data sources

| Source | How it is read | Notes |
|---|---|---|
| **CEB** (`ceb.mu/customer-corner/power-outage-information`) | The page embeds `var arDistrictLocations = {district: "<table>…"}` in a script. We extract that JSON and parse each district's Date / Locality / Streets rows. | The list is authoritative: future notices that disappear are marked cancelled. If the variable is missing, the ingest fails loudly instead of silently returning nothing. |
| **CWA** (`cwa.govmu.org`) | The public WordPress REST API (`?rest_route=/wp/v2/posts`) | **Every communiqué is published.** Only job vacancies and tenders/expressions of interest are left out. Water-supply notices become `interruption`, `schedule` or `advisory` and can trigger alerts. Everything else (Water Tank Grant, tanker registration, new rates, office closures…) becomes `news`, shown in the feed and on the Communiqués page, without alerts. The first run backfills the full archive (back to 2022); later runs fetch the latest 30 posts. Communiqués are often PDFs, so we link the PDF. |
| **Facebook / radio** | Admin "Add a notice manually" form | We deliberately don't scrape Facebook, because it breaks their terms of service and is brittle. |
| **Residents** | `POST /api/reports`, moderated | Rate-limited and stored with a salted IP hash only. The admin view flags clusters of similar reports. |

Locality matching ([server/src/localities.ts](server/src/localities.ts)) uses a gazetteer of 227 towns and villages across the 9 districts plus Rodrigues. It ignores accents, hyphens and "St/Ste" abbreviations, and prefers the longest match (e.g. "Grand Bel Air" over "Bel Air"). **When a notice names a place that isn't matched, add it or an alias there.**

## Map and posters

- **Map:** each locality has coordinates in [server/src/data/locality-coords.json](server/src/data/locality-coords.json), geocoded once from OpenStreetMap Nominatim with `node server/scripts/geocode-localities.ts`. Rerun it after adding localities; it only fetches missing ones and reports outliers. Notices that only name a district are placed at the district's centre. Island-wide notices are listed under the map rather than pinned.
- **Tiles:** the map uses OpenStreetMap's standard tiles, which need no key and are fine for light use. Their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) forbids heavy traffic, so before a big launch point `VITE_TILE_URL` (and `VITE_TILE_ATTRIBUTION`) at a provider such as MapTiler or Stadia.
- **Posters:** after each ingest, the server downloads new CWA attachments and renders a 640px JPEG of page 1 into `DATA_DIR/media/`, served at `/media/<id>.jpg`. If there is no PDF, it uses an image from the post or its featured image. Each item is tried once.

## API

```
GET  /api/health                         last ingest run per source
GET  /api/localities                     districts + localities
GET  /api/outages?locality=&district=&utility=&window=current|past
GET  /api/outages/:id
GET  /api/communiques?offset=           every CWA communiqué ever ingested, newest first (20 per page)
POST /api/outages/:id/confirm            "Mo osi" — one per person
POST /api/reports                        {utility, locality, description}

GET  /api/push/public-key
POST /api/subscriptions/webpush          {subscription, localities[], utilities[], lang}
POST /api/subscriptions/phone            {channel: whatsapp|sms, phone, localities[], utilities[], lang} → sends OTP
POST /api/subscriptions/phone/verify     {channel, phone, code}
POST /api/unsubscribe                    {token}

# Bearer ADMIN_TOKEN
GET  /api/admin/reports?status=pending
POST /api/admin/reports/:id/approve|reject   {notify: boolean}
POST /api/admin/outages                  {utility, title, when: "20 October 09:00 to 16:00", localities[], details, url}
POST /api/admin/outages/:id/hide
POST /api/admin/ingest
GET  /api/admin/stats
```

## Before launch

- **Kreol translations:** the strings in [web/src/i18n.ts](web/src/i18n.ts) and [server/src/notify/messages.ts](server/src/notify/messages.ts) should be reviewed by a native speaker.
- **WhatsApp:** Meta requires pre-approved *templates* for business-initiated messages outside the 24-hour window. Register a template for outage alerts with your Twilio WhatsApp sender, or use the Meta Cloud API directly. The Twilio sandbox is fine for testing.
- **SMS cost:** SMS to Mauritian numbers costs money per message. Consider WhatsApp and push first, and SMS as a fallback.
- **CEB row format:** the CEB tables were empty when this was built, so the date parser is written defensively (English/French, `08:30`, `8h30`, `2 pm`, day-first dates). Check the first real rows with `npm run ingest`.
- **CWA PDFs:** most details live inside the PDF communiqués. A next step is extracting text from them (e.g. `pdf-parse`) to find localities and times.
- **Hosting:** use a single small VM or Render/Fly instance with a persistent disk for `DATA_DIR`, and set `TRUST_PROXY=1` behind a proxy. Being polite to government sites matters: the default polling interval is 30 minutes.

## Ideas for later

- A "starting tomorrow" reminder at 18:00 the evening before a planned cut.
- Outage history per locality ("Triolet had 6 water cuts this month").
- A map view using district boundaries.
- A WhatsApp bot (`STOP`, `STATUS Curepipe`).
- Calendar feed (`.ics`) per locality.
