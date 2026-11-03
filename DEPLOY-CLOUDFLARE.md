# Deploy Folly Surf to Cloudflare

The production dashboard is [follysurf.com](https://follysurf.com). Cloudflare Workers Builds deploys GitHub `main` to Worker `folly-surf`. The private R2 bucket `folly-surf-forecasts` is bound as `BUCKET`; traffic uses a runtime `TOMTOM_API_KEY` secret.

The application uses Vinext, React and `vite.cloudflare.config.ts`, with the Worker entry in `build/cloudflare-worker.ts`.

## Build and deploy

Use Node 22.13 or newer and npm:

```sh
npm ci
npm run check
npm test
npm run build
```

The established Workers Builds command is `node scripts/build-cloudflare.mjs`; the deployment command is `npx wrangler deploy`. Cloudflare installs npm dependencies from the lockfile. Keep the repository root as the build root and `main` as the production branch. Release the combined application through this Git integration so camera work, scoring and collection use the same reviewed commit.

For a manual deployment from an authorized account, first reconcile all intended changes into GitHub `main`, use a clean checkout of that exact commit, and build it immediately before deployment. Do not deploy the original project mirror's unrelated working changes or reuse generated assets from another checkout. Confirm that no newer Git build is in progress, then run:

```sh
npx wrangler login
npx wrangler deploy
```

The build emits the deployment configuration and `.wrangler/deploy/config.json` pointer. Always build immediately before deployment. Do not recreate the existing bucket or replace the configured domain during a routine release. Preview deployments should use separate Workers and buckets; this configuration targets production.

For local development use `npm run dev`; `npm run start` serves the built Worker locally. Local serving alone does not verify production secrets, R2 access or scheduled execution.

## Runtime configuration

Keep `folly-surf-forecasts` private and in the Worker's account, bound as `BUCKET`. Configure API keys as Worker secrets, never as client variables or repository files. To replace the TomTom secret using a hidden CLI prompt:

```sh
npx wrangler secret put TOMTOM_API_KEY --name folly-surf
```

Optional Google fallback uses `GOOGLE_MAPS_API_KEY` and requires Routes API access and billing. The server prefers TomTom when both keys exist. Each traffic refresh uses four geocodes and three routes; traffic responses are not archived. Provider quotas apply. Without a usable key, the interface retains external driving links and reports traffic unavailable.

The custom domain is configured in Cloudflare Workers Settings → Domains & Routes. Changing an existing route or hostname is a separate infrastructure change, not a build requirement.

## Scheduled collection and retention

The deployed cron is `0 */6 * * *`: midnight, 06:00, noon and 18:00 **UTC** daily. The scheduled handler refreshes forecast inputs and collects coastal/spectral observations; it does not call traffic providers.

The collector writes `status/scheduled.json` after successful forecast collection and persistence. The application checks this heartbeat before reporting unattended collection active. A configured cron or successful deployment alone does not prove a successful scheduled run. Check Cloudflare's Cron Trigger event history and the saved heartbeat timestamp.

R2 stores immutable input snapshots, prospective rating snapshots and observation records. Actual NWS product JSON and NWPS/buoy source text are retained separately; coastal/spectral archives explicitly retain normalized observations rather than raw responses. No automatic retention expiry is configured. Choose any lifecycle policy deliberately because deleting older records reduces future evaluation coverage.

## Release verification

- `/` loads the dashboard and `/dashboard/` serves generated assets; verify mobile layout, camera views, Current Wave Mix, map, tide inspection, forecast selectors, attribution and Terms/Privacy links.
- `/api/conditions` returns source statuses, retrieval/model timestamps and actual forecast coverage. Failed inputs remain unavailable or explicitly cached.
- `/api/traffic?destination=pier` and `?destination=washout` return per-origin estimates when provider access works, without exposing secrets.
- `/api/history?date=YYYY-MM-DD&source=ratings` returns saved prospective ratings for that UTC date. Follow pagination when exporting history. Other source names and raw-response access are documented in the history implementation.
- `/api/spectra` returns measured buoy spectra with timestamps and missing-bin handling; `/api/coastal` returns station-specific wind and water levels with units, datum and quality flags.
- `/api/wave-spectra` returns the regional NOAA model spectra with point IDs and `archiveSaved`; read the saved record back through `/api/history?source=nwpsSpectra&date=YYYY-MM-DD`. A successful collector response alone does not verify the next scheduled run.
- `/api/swell-components` returns explicitly selected MFWAM primary/secondary components for the compass, including the returned offshore grid point and original retrieval time. This separate request does not delay the normal conditions API or change its marine coverage; it does not enter scoring.
- Check that Cloudflare's active deployment corresponds to the intended Git commit after verification. A later manual Wrangler deployment can replace a successful Git release without changing `main`.
- `/api/verification` reports eligible offshore forecast/observation comparisons. It does not validate local breaking waves or surf quality.
- Verify new snapshots in private R2 and inspect the scheduled heartbeat after a real cron run.

## References

- [Cloudflare Vite configuration](https://developers.cloudflare.com/workers/vite-plugin/reference/programmatic-configuration/)
- [Vinext Cloudflare handler](https://github.com/cloudflare/vinext/blob/main/packages/vinext/src/server/app-router-entry.ts)
- [Scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workers Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)
- [Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
