# Folly Surf

**Vibe coded.** Built with AI coding assistants. The source, tests and development documentation are published here.

[Development guide](DEVELOPMENT.md) · [Source release notes](SOURCE_RELEASE.md)

A free, noncommercial Folly Beach conditions dashboard at [follysurf.com](https://follysurf.com). The live application runs on Cloudflare Workers.

## Features

- Original Folly Index v4, regional NWS breaking-surf guidance, NOAA NWPS nearshore forecasts, local weather, tides and offshore observations. Missing inputs remain explicit; no simulated current conditions.
- Forecast views use available provider coverage: currently about ten days of wave data and sixteen days of weather. NWPS heights are significant wave height, not breaking-wave face height; NWS guidance covers Charleston County beaches.
- **Current Wave Mix** shows measured offshore energy shares across three period groups, with an expandable spectral chart. Edisto buoy measurements describe offshore conditions, not beach quality.
- The compass shows separate primary and secondary offshore swell arrows from the same MFWAM forecast via Open-Meteo, with height, model-mean period and incoming bearing. Missing or stale components have no arrow. This display does not change the Folly Index or replace the nearshore forecast.
- NOAA Charleston harbor wind and water-level observations retain their station, timestamps, units, datum and quality flags. They do not replace Folly beach measurements or change the index.
- Camera views, tide inspection and traffic estimates for fixed origins and Pier/Washout destinations. Traffic refreshes every ten minutes while visible and excludes parking time.
- Immutable private R2 archives preserve forecasts, prospective rating snapshots and coastal/spectral observations. History and offshore verification endpoints expose their timestamps and limitations. Scheduled collection runs on a six-hour UTC schedule; the dashboard checks a saved success heartbeat before reporting unattended collection active.
- Offline survey import and independent observation evaluation tools. The survey import contains 925,274 points across twelve exports; no custom sandbar model or fitted surf-quality correction is claimed.

## Source layout

`web/` is the canonical browser source. `server/` contains portable ESM ingestion, scoring-support, traffic, archival and evaluation logic. `app/api/` exposes endpoints through Vinext. `vite.cloudflare.config.ts` and `build/cloudflare-worker.ts` configure Cloudflare. `npm run prepare:web` copies browser assets to generated `public/dashboard/`; use the development server or deployed application to view the dashboard.

The separate [camera sampling Worker](camera-service/BROWSER-SAMPLING.md) uses Browser Run and private storage. Offline research tools and their historical comparison models remain under `research/` and `scripts/`; they are not alternative production scorers.

## Development

Use Node 22.13 or newer:

```sh
npm ci
npm run check
npm test
npm run build
npm run dev
```

`npm run start` serves the built Worker locally. `npm run prepare:web` regenerates browser assets separately. See [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md) for production deployment and verification.

## Configuration and privacy

Forecast sources need no private key. Traffic uses the server-side `TOMTOM_API_KEY` secret; optional Google fallback uses `GOOGLE_MAPS_API_KEY`. Never put keys in browser code, Git or build logs. There is no analytics or device-location collection. Traffic responses are not persisted in the forecast archive.

Each TomTom refresh currently makes four geocoding and three routing requests. Provider quotas and terms apply; check [TomTom pricing](https://docs.tomtom.com/pricing) and [Google Routes policies](https://developers.google.com/maps/documentation/routes/policies) before changing traffic usage. Open-Meteo's hosted free service is for noncommercial use and has request limits; attribution and CC BY 4.0 appear in the dashboard.

## Method and evidence

The Folly Index v4 is an original 0–100 heuristic: nearshore wave-height preference, a 50/50 blend of v2’s linear peak-period preference and v3’s seven-second plateau, and a single wind/gust response. All coefficients remain provisional. Missing modifiers produce possible ranges without a rating band; missing core inputs withhold the score. Mean period is never substituted for peak period. The formula is not calibrated against independent beach observations and is not a safety score.

The complete method is [web/formula.html](web/formula.html), published at [/dashboard/formula.html](https://follysurf.com/dashboard/formula.html), with MIT-licensed implementation in `web/outlook.js`. Provider data and camera media retain their own rights and terms.

[Research evidence](research/FOLLY-EVIDENCE.md), [survey provenance](research/surveys/README.md) and the [observation evaluation workflow](research/observations/README.md) document implemented tools and remaining limits. Historical profiles do not establish present-day sandbars; offshore verification does not establish breaking-surf accuracy. Forecast freshness and cached-source timestamps remain visible, and interface dates use Eastern time with DST.

The [nearshore-to-surf study](research/NEARSHORE-TO-SURF.md) distinguishes NOAA wave transformation from unvalidated spot rideability. Run `node scripts/compare-folly-index.mjs` for reproducible v2/v3/v4 examples and sensitivity checks; these are formula diagnostics, not validation.

The archival input is the pinned [Folly size-and-period experiment summary](research/models/archive-evidence.json), saved October 21, 2026. Its 105 timed reports and 101 Edisto matches are discovery evidence, not a held-out validation set or historical NWPS replay. V3’s seven-second plateau was an experimental choice informed by that study. V4 moderates it with the agreed equal blend; neither the curves nor the blend are fitted relationships between nearshore waves and rideable surf.

[Incoming-wave research](research/waves/README.md) adds prospective NOAA directional spectra at three explicitly regional points, raw archival retention, and an offline event-holdout comparison of period curves, local approach angle and spectral features. `/api/wave-spectra` exposes collection/archival status. No additional multiplier changes the public score; the study awaits independent matched observations.
