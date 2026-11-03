# Surface-only validation

## Step 1: retrospective burst review

The exact 30 JPEGs in pilot N are reused, with original source and capture times.
A separate retrospective service entrypoint permits review of stored captures up
to 30 days old; it does not relax the live analyzer's 30-minute freshness limit.
One model request evaluates all five bursts separately. No new camera session is
needed. Raw replies remain private, source JPEG hashes are recorded, and every
result is explicitly historical, score-ineligible and publication-ineligible.

The following assistant assessment was recorded after inspecting all 30 frames
and native-size examples, before running the new per-burst model prompt. It is a
development cross-check, NOT independent human ground truth or held-out data.

| Burst | Expected interpretation | Main limitation |
| --- | --- | --- |
| 1 | Unknown; insufficient usable water detail | Pier obscures narrow water strip; beach and sky dominate |
| 2 | Unknown under a conservative detail threshold; light texture plausible | Distant, narrow water strip; clean/textured boundary uncertain |
| 3 | Same as burst 2 | Similar framing, distant faces; not an independent sea state |
| 4 | Textured is plausible, requiring human confirmation | More unobstructed water but still a wide, short view |
| 5 | Textured is plausible and best supported | Ripples visible offshore, relatively smooth nearshore faces; short sample |

The model must assess water detail for each burst. Limited/insufficient detail,
unverified motion, non-surf scenes, missing evidence or failed within-burst
registration withhold the surface label. Water-detail classification is still a
model self-assessment, not a calibrated deterministic measurement. Schema and
gate tests verify enforcement only; they cannot establish visual accuracy.

### Observed result: pilot P

The retrospective request completed at 15:31 EDT on October 22. It used the original
30 images, 33,358 input tokens and 294 output tokens. No new camera session was opened.
The images were about 67 minutes old at processing and were correctly marked as
historical, with currentConditions:false and publicationEligible:false.

| Burst | Model detail / surface | Cited frames | Model limitations | Review |
| --- | --- | --- | --- | --- |
| 1 | Sufficient / textured | 0003-0006 | None | Conflicts with the conservative assistant assessment; narrow water and pier obstruction should prevent this confident label |
| 2 | Sufficient / textured | 0009-0012 | Limited water area | Texture plausible, but sufficient-detail judgment remains disputed |
| 3 | Sufficient / textured | 0014-0018 | Limited water area | Same ambiguity as burst 2 |
| 4 | Sufficient / textured | 0021-0024 | Limited water area | Plausible provisional description |
| 5 | Sufficient / textured | 0028-0030 | None | Plausible, best-resolved water; short-sample limitation still omitted |

All five shape fields were unknown and all heights null. Evidence IDs stayed inside
their own bursts. None triggered the surface abstention gates because the model
claimed sufficient detail, surf and visible motion in every burst. This shows the
remaining limitation: deterministic enforcement of a model's own detail judgment
does not make that judgment accurate. Do not report this test as a classifier pass.
The disagreement is with an assistant review, not an expert human benchmark.

Keep the raw result unchanged at
camera-research/tides-pier/pilot-20261022-p-tides-pier/surface-review.json.
The corresponding surface-review-input.json records original clocks and SHA-256
hashes; surface-review-model-output.json holds the unmodified model response.
No prompt retuning or repeated calls are used to force agreement on this sample.

## Step 2: independent validation gate

Before public display, freeze the prompt and obtain a separate, unseen sample
from at least three capture dates and three visibly different surface/lighting
conditions. Target at least 30 bursts, with at least five independently confirmed
examples of each surface label proposed for publication, plus inadequate-detail
examples. Adjacent bursts from the same run stay in the same dataset partition.
These are provisional engineering acceptance rules, not a statistical guarantee.

Two human reviewers should independently label usable detail, motion and surface
without model outputs or forecast scores. Record disagreements rather than forcing
consensus. Require at least 90% abstention on jointly inadequate-detail examples
and at least 85% exact agreement on jointly classifiable examples; report coverage,
per-class errors, the full confusion matrix and denominators. Do not count excluded
or unlabeled cases as correct. Tune only on development examples; evaluate once on
held-out runs, and gather fresh validation data after substantive prompt changes.

Pilot N and earlier material already reviewed during development are not held out.
No AI assessment is recorded as an independent human rating. If varied coverage or
human labels are missing, validation remains incomplete and publication stays off.

### Bounded collection plan

Six capture-only windows are scheduled for October 23, 24 and 25, 2026, at 10:05
and 14:05 America/New_York (EDT). Each dispatch window lasts 15 minutes; each
observation watches for stable bursts for at most three minutes. Durable run IDs
allow only one attempt per window, including failures. The plan has no catch-up
or fallback capture outside its windows and cannot run after October 25 at 14:20.
It makes no model calls. Browser cleanup and existing hard timeouts remain active.

The six IDs are validation-20261023-1005, validation-20261023-1405,
validation-20261024-1005, validation-20261024-1405, validation-20261025-1005 and
validation-20261025-1405. Append -tides-pier for the capture run ID. Outputs stay
under camera-research/tides-pier/<runId>/capture.json in private R2.

These windows target different lighting and dates; they do not guarantee different
sea states, successful captures or enough examples of each class. Inspect coverage
afterward, retain failures in the trial accounting, and do not extend the plan
automatically. Do not inspect model answers before collecting human ratings on the
new clips. The current six-page fillable PDF is only a development review packet;
generate a new blinded packet from the future captures for validation.

Status: step 1 complete with an unresolved surface-detail disagreement; step 2
collection scheduled, independent human labels pending; step 3 blocked. Forty-two
camera tests pass, including finite-window expiry, capture-only enforcement, and
worker dispatch that cannot fall back to ordinary pilot collection.

## Step 3: conditional website display

Enable a separate camera-observation feature only after step 2 passes. Display a
brief surface description, original source timestamp, age, and relevant limitations.
Expire stale observations and show an unavailable state when detail or freshness
checks fail. Historical reviews must never populate a current-observation API.
Camera observations remain separate from the forecast score. This change does not
enable a public feature, recurring captures, wave shape or height estimation.
