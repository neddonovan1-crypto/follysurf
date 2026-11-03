# Incoming-wave evidence and prospective comparison

Implemented October 21, 2026. This work collects additional predictors and supplies an offline comparison. It does not establish a better Folly formula, alter the public score, or supply independent beach observations.

## Deployment verification

PR #4 first merged the collector as `7dfbe5b2b0ef608a6808f2d8f9e408a7d978ab05`. At 2026-10-21 17:01 UTC, `/api/wave-spectra` returned all three points, 145 modeled hours each, and `archiveSaved: true` for the 12Z cycle. A separate manual Wrangler deployment (`d5b2b988`) then superseded that Git release and temporarily removed the history source.

Resolved through PRs #6 and #7. At approximately 17:21 UTC, Cloudflare showed version `5179546f`, built from Git commit `3295aa0dd4ca4385aff5d19b2ece5cda9baba409`, as the active deployment at 100% traffic. GitHub checks and the production build passed. The combined release retains the latest camera runtime changes, v3 scoring, the paired primary/secondary swell compass, and the existing BEST NOW beach badges. The original dirty checkout and local research-only files were left untouched.

Live verification confirmed fresh spectra for CHSHB, NAVB6 and 41004; 145 hours each; `archiveSaved: true`; and successful history readback of snapshot `1792602066480-3d03d6aa8b9dab493b03`. The snapshot records formula version 3. Raw readback with `raw=1` returned all three original SWAN files, each 984,430 characters. The compass's separate MFWAM endpoint returned a paired current-hour primary and secondary swell with explicit mean-period units, and both arrows rendered on the live dashboard. All 178 JavaScript tests, syntax/DOM checks and the production build passed in the clean combined workspace.

These checks verify the deployed routes, retained archive and UI. They do not establish beach accuracy or demonstrate the next scheduled cron execution; that execution remains a separate operational check.

## What is available

The operational [CHS 12Z CG1 directory](https://nomads.ncep.noaa.gov/pub/data/nccf/com/nwps/prod/er.20261021/chs/12/CG1/) contains full SWAN directional spectra at named points. The inspected files contain 37 absolute-frequency bins, 36 directional bins, and hourly output from cycle time through 144 hours. They are forecasts, not buoy observations, even when a buoy's station ID appears in the filename.

| Point | File-header coordinates | Approximate distance from our central Folly nearshore point | Use |
| --- | --- | --- | --- |
| CHSHB | 32.730000, -79.839996 | 12.9 km | Charleston Harbor regional reference |
| NAVB6 | 32.639999, -79.679993 | 24.2 km | Offshore navigation-point reference |
| 41004 | 32.500999, -79.098999 | 80.3 km | Offshore Edisto model reference, distinct from NDBC observations |

Distances are great-circle distances to 32.6489, -79.938, not a claim that the reference point lies along a wave ray arriving at Folly. No published directional spectrum was identified at the exact Pier or Washout five-metre-contour points. The inspected CG2 and CG3 listings expose GRIB2 files, not additional point spectra. This is a finding about these inspected products, not proof that a local spectrum cannot be obtained from NOAA.

The current Folly five-metre-contour feed still supplies nearshore significant height, peak period and approach direction relative to shore normal. Its direction is already retained in v3 and v4 rating snapshots. The new regional spectrum must not replace those local values or be labelled as breaking-wave observations.

## What is collected

`GET /api/wave-spectra` fetches three fixed public NOAA files, checks their coordinates and cycle, and returns hourly diagnostic summaries. The existing six-hour scheduled collector also runs it. The scheduled sequence archives spectra before collecting rating snapshots, allowing the latter to be matched to inputs already available at that time. Interactive conditions requests do not wait for this research feed.

Each point/hour preserves:

- Peak period, mean period and energy period as distinct statistics.
- Integrated variance and a significant-height estimate from the published spectrum; this is not a breaking-face height or a replacement for the existing NWPS bulk height.
- Variance shares in under 6, 6–8, 8–12 and 12-plus-second bands.
- Circular mean approach direction, directional concentration/spread, and the direction/spread within each period band.
- Normalized frequency bandwidth, to retain information beyond the single highest spectral peak.
- Point coordinates, model cycle, valid time, retrieval time, source URL and missing-data status.

The parser follows [SWAN's spectrum-file definition](https://swanmodel.sourceforge.io/online_doc/swanuse/node50.html). It accepts the observed AFREQ/NDIR, spherical-coordinate, single-point, uniformly spaced full-circle format. Nautical directions are normalized to degrees **from** true north, including negative angles. Unsupported conventions fail explicitly. ZERO and NODATA remain different; one undefined matrix cell withholds that hour's derived features. Truncated files, unexpected coordinates and mismatched first time/cycle are rejected.

Integration uses midpoint frequency cells and the directional-bin width. Period boundaries split intersecting cells. No high-frequency tail is invented. Consequently these are diagnostic estimates over the exported frequency range and need not exactly reproduce SWAN's own integrated outputs. Directional spread uses the first circular moment, following the [SWAN variable definitions](https://swanmodel.sourceforge.io/online_doc/swanuse/node35.html). Opposing/isotropic directions can make a mean direction undefined; no direction is assigned in that case.

These period bands are **not separately identified primary/secondary swells**. A short-period band is not automatically local wind sea. We have not implemented or validated a spectral partitioning/tracking algorithm or wave-age classification. Keeping the full raw spectra makes that possible later without reconstructing data from today's summaries.

The full upstream file bodies are retained under content-addressed `archive/raw/nwpsSpectra/` keys. Immutable normalized records are available through `/api/history?source=nwpsSpectra&date=YYYY-MM-DD`; follow cursor pagination. Individual raw records use the existing `snapshot` and `raw=1` options. Raw matrices are omitted from the ordinary visitor response. Partial coverage lists missing point IDs. An upstream failure does not become a zero-height prediction; `archiveSaved` reports whether persistence actually succeeded. The scheduled heartbeat separately records wave-spectrum status and save success.

## A concrete reason to retain the spectrum

For the CHSHB 2026-10-21 12Z model's first hour, the checked two-hour fixture gives approximately:

| Diagnostic | Value |
| --- | --- |
| Discrete spectral peak period | 11.16 s |
| Mean period | 4.74 s |
| Variance in periods below 6 s | 51.84% |
| Variance in 6–8 s | 16.16% |
| Variance in 8–12 s | 24.63% |
| Variance in 12+ s | 7.37% |

Thus an 11-second peak does not mean most variance belongs to an 11-second swell. This is one regional model example, not a beach observation, surf-quality diagnosis or evidence of predictive improvement.

## Comparison that is ready to run

Copy `study-template.json`, fill in an actual frozen plan, and collect observations under the existing [independent-observer protocol](../observations/README.md). The template has no invented events, timestamps or observations. Use ten-minute sessions, at least two independent blinded observers, and explicit surfer/board assumptions. Declare separate lead-time plans for 0–6 and 6–24 hours if those are the intended products. Keep location, board, skill and nourishment era separate.

Before collecting outcomes, freeze the candidate-set version, one reference point, penalty choices, physical-event split assignments and event-count gates. The example 10 development / 5 holdout event gate is an operational minimum for attempting a comparison, not a sufficient sample-size claim or a validation threshold. An event can never cross development and holdout. Camera-pilot outputs remain ineligible; no camera-derived label is silently substituted for independent observations.

```sh
node scripts/evaluate-wave-study.mjs \
  --dataset actual-observations.json \
  --ratings complete-rating-export.json \
  --spectra complete-wave-spectrum-export.json \
  --out new-comparison-report.json
```

New study templates select v4. Existing frozen v3 plans remain supported; do not edit them to relabel earlier predictions. Each run matches only its declared formula version and labels the baseline accordingly. Alternate period candidates retain the frozen v3 size/wind response, which is identical in v4. Historical verification above describes the earlier v3 deployment.

The CLI makes no network calls, refuses to overwrite an existing report, and never changes the production score. Inputs use the existing immutable history envelopes. Combine all pages into snapshot arrays; truncated exports are rejected.

The join requires the declared reference point, the same NWPS cycle, the exact forecast-valid hour, and a spectrum retrieved and archived no later than the rating's original first-seen time. There is no nearest-hour interpolation, cross-cycle substitution or retrospective backfill. All candidate models use the same complete sessions. Missing-feature exclusions are reported so an apparent improvement cannot come from quietly dropping difficult cases for only one model.

| Candidate | Purpose |
| --- | --- |
| Archived v3 or v4 + development-only monotonic calibration | Uses the plan’s single declared version; tests a scale change without changing its original score order |
| Smooth plateau at 8 seconds + calibration | Tests a later plateau with size and wind held fixed |
| Smooth plateau at 10 seconds + calibration | Tests a still later plateau |
| No period multiplier + calibration | Tests whether the period factor helps at all |
| Bulk-input regression | Height, period, squared period, effective wind, wind alignment and their wind interaction |
| Bulk + approach angle | Adds circular local wave angle and period × angle interactions |
| Bulk + regional spectrum | Adds regional height, energy period, bandwidth, concentration, directional vector and three independent period-band shares |
| Bulk + angle + regional spectrum | Tests their combined contribution |

The regressions predict the declared 1–5 observer rubric using ridge regularization. They are diagnostic candidates, not formulas promoted to production. Scaling is learned inside each training fold. Regularization is selected by leaving entire development events out. Every physical event receives equal total fitting weight. Monotonic calibration is also fitted only on development events.

Holdout reports show event-weighted absolute quality error and cross-event ranking concordance. A predicted tie contributes half credit; observed ties and within-event pairs are excluded from the ranking comparison. Counts are exposed; session pairs are not independent sample counts. No significance test or confidence interval is claimed. All eight results are reported, with no automatically selected winner. Inspecting the holdout consumes it: further tuning requires newly reserved events.

## What remains unknown

No eligible independent observations were supplied for this study. Therefore no improvement, fitted production coefficient or preferred plateau is reported. The older 105-report archive remains discovery evidence: it does not contain these prospectively collected nearshore/spectral inputs, and an offshore period should not be substituted for nearshore peak period.

Using approach or spectral features to predict observed rideability is not a second wave-arrival calculation. The production nearshore height remains unchanged. Local bar geometry, tide interactions, the spatial transfer from these regional points, primary/secondary partition tracking and actual ride counts remain separate unresolved questions. A useful result would be a repeatable improvement on independent events for a specified location/cohort, not merely larger scores.
