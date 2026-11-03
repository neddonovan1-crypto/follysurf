# Developing Folly Surf

Folly Surf is **vibe coded**: built and iterated with AI coding assistants. This public repository includes the application source and the checks used to exercise its behaviour.

## Run locally

Use Node.js 22.13 or newer and npm.

```sh
git clone https://github.com/neddonovan1-crypto/follysurf.git
cd follysurf
npm ci
npm run dev
```

Open the local address printed by the development server. `web/` is the canonical browser source; `public/dashboard/` is generated. Use the server rather than opening the source HTML directly.

## Check a change

```sh
npm run check
npm test
python3 -m unittest discover -s research/surveys -p 'test_*.py' -v
npm run build
```

`npm run check` checks JavaScript syntax and dashboard DOM references. The JavaScript tests cover forecast handling, scoring, traffic, archives, camera research and interface helpers. The Python checks exercise the survey importer. `npm run start` serves the built Worker locally.

## Find the code

| Area | Location |
| --- | --- |
| Dashboard and browser modules | `web/` |
| Forecast ingestion, traffic, archival and evaluation logic | `server/` |
| HTTP endpoints | `app/api/` |
| Worker entry and build configuration | `build/`, `vite.cloudflare.config.ts` |
| Camera sampling Worker and research notes | `camera-service/` |
| Automated checks | `tests/`, `research/surveys/test_import.py` |
| Evidence, limitations and research methods | `research/` |

The published scoring method is in [web/formula.html](web/formula.html). The formula implementation has its own [MIT licence](web/FORMULA-LICENSE.txt); that licence does not cover third-party data or camera media.

## Configuration and deployment

Public forecast inputs need no private key. Traffic estimates require a server-side `TOMTOM_API_KEY`; the optional Google fallback uses `GOOGLE_MAPS_API_KEY`. Without a usable provider key, traffic estimates are unavailable. Keep credentials outside Git and browser code.

The configuration and [deployment guide](DEPLOY-CLOUDFLARE.md) describe the existing production installation. Before deploying your own instance, choose your own Worker, domain and storage resources. This public repository's workflow runs checks only; it is not connected to the live deployment.

See [SOURCE_RELEASE.md](SOURCE_RELEASE.md) for the publication date, source revision and scope.
