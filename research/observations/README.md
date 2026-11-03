# Prospective Folly observation workflow

This is an implemented offline evaluation path, not community voting, an automatic calibration system, or a claim that the rating is validated. No beach observations have been supplied with this repository. The template contains no fabricated records. Do not label model output or camera guesses as observations.

## Collect before evaluating

1. Copy `template.json` to a new dataset. New templates select formula version 4; keep existing frozen plans and archived scores unchanged. Replace placeholders. Use Unix UTC seconds for every timestamp; retain original capture timestamps in your source records. Predeclare `formulaVersion`, a written `protocol` and `sessionMinutes` (5–120 minutes). The plan must be frozen before the events begin. Commit or otherwise timestamp the immutable plan and record its identifier.
2. Define the exact observation locations and explicit radius (maximum 1 km). Use the rating archive's `locationId` only for the corresponding Folly area. Define whole swell/storm events using `eventGroup`, event start/end and development/holdout assignment. Never distribute adjacent hours from one event between training and holdout. The validator rejects groups or overlapping windows crossing splits.
3. Record the nourishment era as `pre`, `post` or `unknown`, using documented project dates, not the current shoreline's appearance. Pre/post events require `nourishmentWindow: {startAt, endAt, sourceUrl}`; the validator rejects an event crossing the work window. Use `unknown` if evidence is insufficient. Keep pre/post data in separate report strata; do not silently pool changed morphology.
4. Obtain at least two independent observers for each session, blind to the forecast and each other's answers. Independence and blinding are declarations that collection must actually enforce; software cannot prove them. Collect each observer's entry within one hour of the shared session's `observedAt` (session end). Each record's `durationMinutes` must equal the plan's `sessionMinutes`, and the whole observation window must fall inside the event. Retain distinct pseudonymous IDs; do not collect names, contact details or free-text personal information. One observer counts once per session.
5. Agree board and skill classes before collection. Every report keeps those cohorts separate. A session's observers must use the same boardability assumptions, location, session ID and observation timestamp. Do not reinterpret a beginner/longboard report as expert/shortboard quality.

## Observer rubric: `folly-observer-v1`

Record overall observed wave quality for the declared surfer/board cohort, without consulting the model score. This provisional rubric itself needs observer-agreement assessment:

- **1:** No usable rides observed for the declared cohort.
- **2:** Occasional usable rides; predominantly poor shape or limited opportunity.
- **3:** Some usable waves with mixed shape and consistency.
- **4:** Frequent usable waves with mostly consistent shape.
- **5:** Consistently high-quality rides for the declared cohort throughout the session.

Use the same agreed observation duration/protocol for all sessions and document it in the collection plan. A quality rating is not safety, accessibility, crowding or enjoyment. Keep hazardous conditions in a separate field/record; this evaluator does not turn danger into a quality bonus or infer safety.

Record wave height separately. Optional `height` requires a physical definition (`breaking-face-range`, `nearshore-significant`, or `offshore-significant`), metres, and a min/max range. Leave height null when it cannot be measured honestly. A visual breaking-face estimate is not significant wave height. This evaluator deliberately produces **no height error metric** by comparing unlike quantities. It preserves the measurements for a later, appropriately matched study.

## Run

Export immutable `folly-index` rating snapshots from the history archive. Supply a single snapshot, an array, or the history API's `{snapshots:[{data:...}]}` response. Multiple files are accepted. Truncated history responses are rejected: follow cursor pagination and combine every page into a snapshot array before evaluating.

```sh
node scripts/evaluate-folly-observations.mjs \
  --dataset observations.json \
  --ratings ratings-export.json \
  --out evaluation-report.json
```

The command is local only, makes no network requests, and refuses to overwrite an existing report. It does not publish observer data, fit coefficients or change production ratings.

## Timing and selection rules

A rating record must have its `firstSeenAt` before its valid hour and before observation. Known upstream issue/retrieval times must not be after that first-seen timestamp. Unknown model issue time remains unknown; retrieval time is not relabelled as issuance. Thus downloading an old forecast after an event cannot create prospective validation.

Only scores based on `nearshore-significant` inputs are eligible. Missing-input ranges are not treated as point forecasts. Matching uses the exact location ID, a valid-time difference no greater than 30 minutes, and the plan's half-open lead window `[leadMinHours, leadMaxHours)`. Selection is deterministic: only the predeclared formula version, nearest valid hour, then earliest archived record. Do not repeatedly poll and count the same observation as multiple independent samples.

## Read the output

Outputs retain forecast and observation timestamps, event identity, formula version, location, board/skill cohort and nourishment era. Each stratum reports session and event counts, median observer quality, predicted band gaps and pairwise observer agreement. Band gaps are descriptive comparisons between an unvalidated model heuristic and a provisional subjective rubric; they are **not calibrated error probabilities**. Sessions with fewer than two independent observers are excluded from comparisons, and rejected/unmatched records carry explicit reasons.

Review observer agreement before interpreting model agreement. Report development and holdout results separately. Holdout outcomes must not guide coefficient changes; if you inspect them while tuning, retire that holdout and predeclare new events. Never claim validation from a small number of hours in one storm. No minimum evidence count magically establishes skill, and this tool makes no such claim.

An offshore-only numerical fallback is currently withheld: the available offshore feed supplies mean wave period rather than a verified compatible peak period. Substituting that mean into the peak-period formula would be a new, unvalidated model. Offshore context remains available on the dashboard, and raw snapshots are retained for future work.

## Missing-data implementation audit

| Rule | Current implementation |
| --- | --- |
| NWS period absent | Does not gate Folly Index; current nearshore peak period and wind drive it. |
| Nearshore height, peak period or wind missing/stale | Withholds the score. No offshore mean-period substitution. |
| Gust missing or inconsistent with sustained wind | Shows a possible-score range, no scalar/band. |
| Direction missing at light nonzero wind | Shows a range across all alignments; if gust is also missing, maximises both unknowns. |
| Direction missing at 3 mph or more | Withholds the score. |
| Wind is zero | Direction is irrelevant. |
| Missing optional context | Offshore swell share, local approach, tides and buoy observations cannot award points or cause quality changes. |
| Offshore-only conditions | Remain separately displayed context, not a Folly Index rating or Standout claim. A compatible verified peak-period input is not currently supplied. |
| Safety | Kept outside quality; no score means safe, and no hazard absence is inferred. |

The executable cases are `tests/outlook.test.js`; observation-integrity checks are `tests/calibration.test.js`.
