# From nearshore forecasts to rideable Folly waves

Research and formula revision, 21 October 2026. No independent beach calibration has been performed. The proposal below is a study design, not a completed experiment or a preregistered collection plan.

## Conclusion

Treat NWPS as the modeled nearshore sea state. Learn the relationship between that state and observed breaking-wave outcomes at a defined spot. Do not apply a second offshore-to-nearshore exposure, shoaling or refraction correction to its height without diagnosing a specific residual error.

Period and direction can still contain information about *shape* at a given nearshore height. Including a predictor already used upstream is not automatically double counting: its downstream target may differ. The test is whether it adds reproducible predictive value for local rideability after conditioning on the nearshore inputs. A physical-sounding multiplier alone does not establish that relationship.

## What NOAA already does, and what we actually consume

[NWS's NWPS physics description](https://www.weather.gov/ilm/NWPS) lists shoaling, depth/current refraction, wind generation, nonlinear interactions, whitecapping, bottom friction and depth-induced breaking. The [NOAA system overview](https://polar.ncep.noaa.gov/nwps/) describes offshore wave boundary guidance, local wind forcing, currents and water-level inputs. Thus neither wind nor tide is wholly absent from the upstream system.

Our ingestion in `server/forecast.js` selects CHS nearshore output points and retains significant wave height, peak period and a direction relative to shore normal. Those bulk fields do not specify an individual breaking face, a peeling track or the number of rideable waves. The [incoming-wave research pipeline](waves/README.md) now ingests directional spectra at three regional reference points and preserves raw matrices for future partitioning. These are not spectra at the exact Folly breaking spots and do not affect the public score. A dominant spectral peak is not necessarily the period of every incoming wave.

The five-metre contour describes **depth, not horizontal resolution**. NOAA's [2021 NWPS v1.3 change notice](https://www.weather.gov/media/notification/pdf2/scn20-116nwps_v1.3_aab.pdf) explicitly includes Charleston among domains moved to unstructured meshes spanning 5 km to 200 m, with output interpolated onto regular grids. This is stronger deployment evidence than the older generic 500 m–1.8 km overview, but does not identify today's exact mesh spacing at each Folly point. We have not verified the active CHS computational mesh, bathymetry survey vintage, or detailed physics switches. Output point spacing cannot establish computational resolution.

The [SWAN manual](https://swanmodel.sourceforge.io/online_doc/swanuse/node5.html) warns that insufficient bathymetry/wave resolution and interpolation can impair local accuracy. We therefore cannot infer that including depth-induced breaking means the moving bar, trough and breaking line at the Pier or Washout are accurately represented. Conversely, we have not demonstrated a particular NOAA error that warrants a corrective multiplier.

## What makes the difference at a spot

| Question | Already represented or provided | Remaining relationship to measure |
| --- | --- | --- |
| How much wave energy reaches the nearshore point? | NWPS propagation and bulk height | Error at that point; transformation from its location to the actual breaking line |
| Does the wave peel or close out? | Bulk period and relative approach direction are useful descriptors | The interaction of wavefronts with the current bar geometry, local depth and water level |
| How many usable opportunities arrive? | A bulk height and one spectral peak | Potential rides per fixed observation window, open-face duration and consistency |
| Are faces clean enough to ride? | Wind affects wave generation and dissipation upstream | Incremental local surface/face effects associated with wind and gusts, measured independently |
| Is it suitable for this surfer? | No universal physical answer | A declared board/skill cohort, separate from physical wave measurements |

“Peeling” means a breaking section progresses along the crest while an adjacent open face persists. A high wave that closes across the whole usable section can offer fewer rides than a smaller peeling wave. This is why a nearshore height-to-score curve cannot by itself establish quality.

[Thompson et al. (2021)](https://doi.org/10.3390/rs13173372) demonstrated a camera-based wave-peel tracking method using potential ride rate, length, duration, speed and direction. They checked tracks against surfer GPS at an Australian reef and neighbouring beach and found spatial breaking patterns varied with tide. This provides a measurement approach, not validation for Folly or for our camera model.

Local [Isla Surf School guidance](https://www.islasurfschool-charleston.com/journal/2019/10/29/what-you-should-know-about-swell-periods-and-direction) describes 6–8-second waves as commonly surfable at Folly, 8–10-second swells as favourable, and potential closeouts at longer periods. This practitioner evidence challenges a universal longer-is-better rule. It does not give a fitted response curve, and its swell-period guidance is not identical to our bulk nearshore peak-period input.

## Newly saved archival research, incorporated

The [saved refinement-study summary from commit eb740e4](models/archive-evidence.json) is now part of this decision. Its summary was recomputed from the reviewed observations and validated measurement matches; both input SHA-256 checks passed. Local study files also matched the saved Git blobs. [archive-evidence.json](models/archive-evidence.json) preserves the summary, source commit and checksums without relabeling the archive as a nearshore dataset.

| Saved finding | Consequence for this revision |
| --- | --- |
| 105 eligible timed reports; 101 Edisto wave matches | Useful descriptive evidence, not 105 independent swell events |
| 11 of 17 matched “fun” reports had offshore dominant period below 8 s | Strong reason to question the old automatic short-period discount; insufficient to estimate a nearshore-period coefficient |
| Both “fun” and “weak” groups had median offshore dominant period 7.69 s | Period alone does not separate these labels in this selected sample; identical medians do not prove there is no conditional relationship |
| Four reports were both weak and longboardable | Wave power and usefulness for a particular board must remain separate |
| Six closeout-tagged reports had matched offshore periods from 4.55 to 8.33 s | Closeouts are not confined to long-period swell; no blanket long-period penalty follows |
| 104 of 105 timed reports came from Ocean Surf Shop; 59 lacked a rideability tag | Provider concentration and missing labels limit generalization; absence of a tag is not poor surf |

I reread the primary [August 14](https://www.oceansurfshop.com/surf-report/tuesday-august-14/) and [August 15, 2018](https://www.oceansurfshop.com/surf-report/wednesday-august-15/) reports: both give tentative favourable advice for high-volume boards in knee-to-thigh Washout surf. These are board-specific visual judgments, not measurements of ride success, and adjacent dates are not independent events. The [2022 Isla guide](https://www.islasurfschool-charleston.com/journal/2022/9/28/understanding-a-surf-forecast-101-surfline-edition) adds a 7–11-second favourable range to the same school's earlier guidance.

The saved study tested square-root size/period changes and a smooth period plateau. V3 used that existing plateau candidate instead of the separately drafted 6/8-second piecewise curve. The size curve stays unchanged: the study's combined size-and-period boost raised a synthetic 0.15 m / 7 s calm setup from 5 to 22, raising a concrete tiny-wave overrating concern. The plateau alone gives 13 for that synthetic setup.

This is an experimental product revision, **not evidence that the archival study selected or validated a winning candidate**. Its study design explicitly says that no candidate passed its validation gate. V3 and the interim v4 blend remain uncalibrated. The archive does not support the new 0.7 gust weight; that is a separate simplification hypothesis. The comparison script isolates period-only and wind-only changes as well as their combined effect.

Do not feed Edisto heights or dominant periods directly into the nearshore formula, convert body-height labels into metres, invent overall quality grades from “clean” or “weak,” or backfill historical Folly scores. Compatible historical nearshore forecasts and their availability times are absent. All archive records have already been inspected during exploration, so none is an untouched holdout.

The prospective study below now includes the saved plan's separate board cohorts, ten-minute sessions, 0–6 h versus 6–24 h leads, and a simple score-remapping control. These additions make it possible to distinguish better ordering of usable sessions from a general upward relabeling of scores.

## V4: an interim period compromise

The public [formula document](../web/formula.html) defines every coefficient. V4 blends the old and new period factors equally:

- `Pold = clamp((Tp − 3) / 10)` from v2.
- `x = clamp((Tp − 3) / 4)`, `Pplateau = x²(3 − 2x)` from v3.
- `P = 0.5 × Pold + 0.5 × Pplateau`.

The blend gives 0.571875 at 6 s, 0.7 at 7 s, 0.75 at 8 s, 0.895 at 10.9 s and 1 at 13 s or longer. The 50/50 weight is an explicitly provisional compromise, not an archival fit or demonstrated accuracy improvement. A later plateau at 8 or 10 seconds would not moderate the 10.9-second Pier example because it would still receive full period credit.

V4 retains v3's single wind response using `max(sustained mph, 0.7 × gust mph)`, the moderate-height preference and representative offshore bearing. These coefficients remain unvalidated. No separate gust penalty, approach-angle bonus, tide bonus or second transformation of NWPS height is introduced. The intended outcome is rideability at the named Folly spot for a declared board/skill cohort; the score is not a percentile of local conditions.

Frozen implementations at `models/folly-index-v2.js` and `models/folly-index-v3.js` preserve historical comparisons. V2 came from commit `a19d5dd74b43a909257f1d039c06253522efdd07`; v3 is byte-for-byte `web/outlook.js` at `8430955735bc007e9282b3f2c86d9a1323b4f445`. New rating snapshots identify version 4. Existing snapshots retain their original scores and versions. Study plans select one formula version and never pool v3/v4 ratings as if they were the same scale.

Run `node scripts/compare-folly-index.mjs` for reproducible examples:

| Diagnostic inputs | V2 | V3 | V4 |
| --- | ---: | ---: | ---: |
| Pier rounded inputs: 3.1 ft Hs, 10.9 s, 10 mph from 17°, gust 13 mph | 46 | 61 | 55 |
| Captured Sunday 25 October, 8 AM | 15 | 29 | 22 |
| Captured Sunday 25 October, 9 AM | 15 | 30 | 23 |
| Synthetic calm, 1.2 m, 6 s | 30 | 84 | 57 |
| Synthetic 5 mph offshore, gust 30 mph, 1.2 m, 8 s | 33 | 52 | 39 |

The Sunday session uses the weaker hour, so it is now **22, Marginal**. These inputs are formula diagnostics, not prospective validation records: the saved Sunday extract lacks original issue/retrieval timestamps, and the Pier comparison has already informed this revision. Neither is an untouched holdout. The Pier's modeled significant height must not be equated to the screenshot's observed breaking-face estimate or used to infer a fixed height conversion.

Changing the provisional gust weight from 0.5 to 1 moves the first Sunday hour from 28 to 0 under v4. That dependence on assumptions is not an uncertainty interval. Retaining a period-free baseline remains essential; either period curve or the blend may prove unnecessary or wrong.

## A test that can demonstrate the missing relationship

1. **Fix the target and place.** Use separate, mapped Pier and Washout observation areas. Use the saved archive study’s two separate cohorts (intermediate high-volume/longboard and intermediate shortboard) as a starting point, and choose the primary cohort before collection. Define “potential ride” for one board/skill cohort, the minimum open-face duration and treatment of reforming sections. First assess whether two independent observers can apply the definition consistently. Do not tune that definition to match model scores.
2. **Measure outcomes directly.** Use scheduled, continuous 10-minute clips or equivalent in-person watches. Record eligible breaking waves, potential ride count, open-face duration and closeout fraction. Include clean/mixed/choppy surface labels. Use calibrated geometry for distances and heights; otherwise retain qualitative labels or nulls. Actual surfers' ride counts confound wave quality with crowding and skill.
3. **Make sampling comparable.** Predeclare times across tides and weather, including poor and flat conditions. Record obscuration, glare, camera motion, outages and the fraction of the area visible. Exclude or flag inadequate visibility; a failed camera is not zero surf. Keep observer labels blind to the score and each other.
4. **Match the forecast as issued.** Join exact location and verified source time to archived forecasts available before the event. Evaluate 0–6-hour and 6–24-hour forecast leads separately. Retain cycle, lead time, source coordinates, units, model version, formula version and missingness. Do not convert an old forecast downloaded afterwards into a prospective prediction. Folly River tide and Charleston water levels are proxies whose transfer to the breaking area must be checked.
5. **Compare small models.** Begin with height alone, height plus local wind/gust, v4 and archived v2/v3. Compare the current formula with its period factor removed. Also compare a monotonic remapping of v2 scores fitted only on development events: changing bands without improving session ordering may be just a scale change. Then fit period, angle and tide individually and jointly, with a few predeclared interactions such as period × angle and height × tide. These predict observed rideability, not a recomputed nearshore height. With enough data, compare local spectral partitions/spread against the bulk-peak approach.
6. **Hold out entire events.** Keep neighbouring hours of one swell/storm together. Split by event before fitting; additionally examine location, season, forecast lead and nourishment/survey era. Use the existing survey records for dated morphology context, not as proof of today's bar geometry. Reserve further events after model selection.
7. **Report added skill and failure.** Report ride-count errors, ordinal-quality agreement, missing-data coverage and observer agreement, with event-grouped uncertainty. For any probability target, report reliability and a proper probability score. Compare paired predictions on the same held-out sessions. Publish when angle, tide or period adds no stable value; remove unnecessary terms. Do not select a coefficient because it makes a remembered day look right.

An initial observer pilot can assess label feasibility and variation; it cannot establish broad predictive skill. The required sample is driven by the number and diversity of independent events and the observed variability, not an arbitrary total of hourly records.

## What the current implementation can support

The existing [observation workflow](observations/README.md) supports independent observer quality labels, prospective matching, event splits and board/skill cohorts. It does not yet compute the proposed wave-peel metrics or fit the candidate models. Its empty template is not a labeled dataset.

The private `server/camera-analysis.js` pilot receives six six-frame bursts, one burst every 30 seconds, over about 155 seconds. It explicitly records `capture-clock-unverified`, null source timestamps, `scoreEligible: false`, and pending independent quality control. These bursts can supply qualitative evidence for review; gaps prevent assuming complete wave counts or continuous peel duration. Camera clock/latency verification, continuous sequences, view calibration and human agreement remain necessary before using it for the proposed measurement target. We have not changed its budget, collection schedule or scoring eligibility in this revision.

The archive and revised score make the study auditable, but **the nearshore-to-rideability relationship remains unproven**. The next substantive improvement is an independently labeled, spot-specific dataset and a held-out comparison, not another guessed multiplier.
