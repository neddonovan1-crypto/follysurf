# Tides saved-burst evaluation — October 22, 2026

## Scope and method

Evaluate all 30 accepted frames from pilot N, grouped into five six-frame stationary bursts. Pilot O reuses the exact saved JPEGs and original timestamps, validates the capture, exports ten private three-frame review sheets, and runs the existing gpt-4.1-mini-2025-04-14 / folly-camera-v0.5 analyzer. No model prompt or quality threshold changes are made for this evaluation. All output remains scoreEligible:false.

The assistant visual assessment is recorded before reading the model output. This is an evidence cross-check, not independent human ground truth or an estimate of classifier accuracy. A single camera and short observation period cannot establish performance across conditions.

## Visual review

All ten sheets were inspected, covering every accepted frame in order, before opening the model output.

| Burst | Frame IDs | Visible evidence | Assessment before model output |
| --- | --- | --- | --- |
| 1 | 0001–0006 | Wide beach/sky view, pier crosses much of the narrow water strip; whitewater advances while fixed structures stay aligned. | Surf and motion visible; surface detail inadequate on its own; shape unknown. |
| 2 | 0007–0012 | Wider unobstructed water to the right of the pier, faint offshore ripples, nearshore breaking line becomes whitewater. | Light texture plausible, but wave faces are small in the image; too few complete sequences for a shape class. |
| 3 | 0013–0018 | Same broad framing as burst 2, whitewater changes and another crest begins near the end. | Similar limited support for light texture; the next break is incomplete; shape unknown. |
| 4 | 0019–0024 | Pier mostly at far left; more exposed water, light ripples and moving whitewater, substantial beach and sky remain. | Light texture plausible; no clear strong crossing chop; insufficient complete breaking sequences for shape. |
| 5 | 0025–0030 | Closer view gives the clearest water detail. Ripples are visible offshore; nearshore faces are relatively smooth; a crest develops and breaks into whitewater. | Best support for a cautious lightly textured surface description. One short progression does not establish predominant peeling or closing-out behavior. Shape unknown. |

Pier, horizon and beach fixtures remain visually aligned within each burst. Framing changes substantially between some bursts, so they must not be treated as one uninterrupted fixed view. Wave and foam motion is visible, independently of the player clock. No blank player or advertisement is visible in the selected frames.

Provisional visual conclusion: surface appearance is promising for a limited qualitative description, primarily supported by frames 0025–0030. The clean/textured boundary remains subjective at this resolution. Wave shape should remain unknown. There is no calibrated wave-height, wind, period, ride-quality or surf-score evidence. The wide views expose a practical weakness: a stable image can contain too little useful water detail.

## Automated comparison

Pilot O completed analysis at 18:41:30.365 UTC (14:41:30 EDT), using 33,567 input tokens and 382 output tokens in one model call. The original capture window was 18:21:07.043–18:24:02.705 UTC. Processing occurred 17 minutes 27.660 seconds after capture completion, inside the unchanged 30-minute validation limit; this is a retrospective evaluation, not a new live observation.

The five sampled source-time intervals span 5.793, 5.566, 6.002, 5.735 and 5.581 seconds, totaling 28.677 seconds. These are 30 snapshots at approximately one-second cadence, not continuous video. The first-to-last source timestamp span is 130.820 seconds; intervening gaps remain unobserved. Per-frame source timing was verified at capture, with maximum source age 42.443 seconds. All 45 required within-burst registration comparisons passed. Of four cross-burst comparisons, one passed and three were unknown, producing an overall unknown view status.

| Claim | Raw model result | Final stored result | Evaluation |
| --- | --- | --- | --- |
| Scene / motion | surf / visible | surf / visible | Supported by changing waves and foam in all five reviewed bursts. |
| Surface | textured, citing all 30 frames | textured | Plausible, with strongest support in burst 5. Blanket citation of wide, obstructed frames overstates evidential precision. This single sample does not validate classification accuracy. |
| Wave shape | mostly-peeling, citing all 30 frames | mostly-peeling | Not supported strongly enough. The images do not establish several complete, representative breaking sequences. Reject this label for product use. |
| View | stable | unknown | Whole-sequence stable claim conflicts with the evident framing changes; deterministic registration correctly overrides the view field. |
| Limitations | empty list | empty list | Omits framing changes, limited wave detail, short bursts and unobserved gaps. |
| Height / score eligibility | null / false | null / false | Appropriate restrictions remain in place. |

The raw summary explicitly claims multiple peeling breaking waves across an extended sequence. The final summary still says wave shape is mostly-peeling. The final record has qualityGatesApplied:[] and qualityStatus:awaiting-independent-qc.

A concrete safeguard weakness was exposed in prompt v0.5: applyQualityGates first checked the model's stable-view claim, then overwrote viewChange with the independent unknown result. Because all cited IDs belonged to registered stable bursts, the shape label survived. Valid frame IDs and camera stability do not prove complete breaking sequences, suitable water detail or a predominantly peeling wave pattern. No deterministic gate verified those requirements. The original final record therefore contains viewChange:unknown alongside shape:mostly-peeling. Existing tests passed but did not establish semantic correctness of these claims.

The raw model output and final observation are preserved unchanged as evaluation evidence. No prompt tuning or second model call was performed after seeing this result.

## Decision

**Capture feasibility passes this bounded example; automated surf interpretation does not pass for product use.** Tides supplies stationary, timestamped frames with real wave motion. A cautious surface description is promising, but reliable wave-shape labeling is not demonstrated and the analyzer overclaims it in this case. Height and forecast-score integration remain unsupported.

Keep the pipeline research-only and the pilot disabled. Before a further pilot, make the treatment of changing views consistent in the quality gate and explicitly withhold unvalidated wave-shape labels. Evaluate useful water detail per burst so a mostly beach/sky image is not treated as equally strong evidence. For future shape work, retain longer continuous fixed-view sequences, record specific observed breaking events, and compare against independent human labels across varied conditions and held-out samples. Changing the model or prompt alone should not count as validation.

All 30 selected frames were reviewed, but the 27 other screenshots from pilot N were not all retained or evaluated. This review cannot measure false rejection, selection bias, performance in other surf or light conditions, or classifier accuracy. The assistant visual review is not an expert-labeled benchmark.

## Evidence and verification

Source capture: camera-research/tides-pier/pilot-20261022-n-tides-pier/capture.json.

Evaluation prefix: camera-research/tides-pier/pilot-20261022-o-tides-pier/. Private files include burst-review-1.jpg through burst-review-10.jpg, review.json, input.json, model-output.json and observation.json. Each pair of review sheets contains one six-frame burst. The original image payloads and metadata remain private in R2 and are not committed to the repository.

PR #24 passed CI and both Worker deployment checks. The 31 focused camera tests and Worker dry-run passed, and the bundled contact-sheet expression was executed successfully. The closeout change disables the pilot and removes its reanalysis and review-export flags. No image is published, no forecast score is changed, and every observation remains scoreEligible:false.

## Follow-up safeguard fix

Prompt v0.6 and quality gate folly-camera-gates-v2 enforce analysisScope:surface-only. Independent view evidence is applied before checking whether shape can be retained. Unknown or changing views clear the shape label and evidence IDs and record the reason. A separate unconditional surface-only gate also withholds shape when all view checks pass: camera stability does not validate wave-shape interpretation.

The model's requested shape schema now permits only unknown. The deterministic gate still handles recognized non-unknown raw labels defensively, clears them, and rebuilds the summary from the gated fields. It adds explicit limitations for uncertain views and the pending validation of wave shape. Raw model output remains private and unchanged for audit; stored observations identify the prompt, gate version and analysis scope.

Two regression tests failed before the fix and pass afterward. One recreates the 30-frame adaptive capture with five accepted stable bursts, all IDs cited by a model claiming mostly-peeling, and an overall unknown or changing view. The other gives the model a completely stable view and checks that surface-only policy still withholds its shape claim. Surface evidence and raw output are retained, unsupported shape text is removed from the generated summary, and score eligibility stays false. All 33 focused camera tests pass. These are mocked model responses testing enforcement, not a new live capture or a claim of improved visual accuracy.

The pilot remains disabled. Historical pilot O records are preserved as evidence of the original failure. Surface classification still needs independent evaluation, and usable water detail is not yet measured by a deterministic gate.
