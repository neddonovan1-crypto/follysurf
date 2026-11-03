# Stationary-view sampling — October 21, 2026

The Tides research sampler watches for up to 180 seconds. Every two seconds it compares three rendered frames: adjacent pairs and the first-to-last pair must all be independently stable. This checks slow accumulated panning as well as sudden view changes. An unknown result never triggers capture.

Once a stationary view is identified, it captures six consecutive frames about one second apart, using the final scout as the first frame. Every within-burst comparison is checked again. If the camera moves, landmarks become untrackable, or the images arrive too slowly, the entire burst is rejected. A ten-second cooldown separates attempts. There are at most eight attempts, six accepted bursts and 36 saved images. No wave appearance, height or desirability is used for selection. Rejections, scout outcomes, actual times and source timestamps are retained as metadata. This is limited coverage, not a continuous three-minute surf observation.

The v3 analysis contract accepts one to six complete stationary bursts, validates actual cadence, exact comparison coverage and selected frame references, and preserves those limitations. Zero accepted bursts produces a no-stable-window record and no model call. Source freshness still requires actual program timestamps. All camera output remains scoreEligible:false; short stable clips do not themselves establish reliable wave-shape judgments.

The bounded pilot M uses Tides only, capture-only mode, immutable once-only execution, and a fixed expiry. It does not retry Washout, schedule recurring collection or call a vision model. The pilot is disabled after the saved result is inspected.

Validation: 29 focused tests cover waiting through panning, movement restarting during a candidate burst, unknown views, slow captures and playback, source clocks, rejection of falsified timing/coverage, browser-expression execution, and preservation of the research-only output. Worker bundling and live results are recorded below.

## Pilot M result

PR #20 deployed successfully to both Workers. GitHub checks passed. Wrangler bundling succeeded, and executing the bundled browser expressions returned the expected scout result and 59 full-capture comparisons.

The live Tides run started at 21:21:12.386 UTC on October 21 and ended its observation at 21:23:57.492 UTC (165.106 seconds). It took 50 scout screenshots and completed 48 three-frame stability checks. Every check was unknown; none qualified to start a burst. The saved result at 21:24:00.779 UTC was no-stable-window, with zero accepted frames, zero bursts and zero recoveries. No vision model was called, and scoreEligible remained false.

This does not establish that the camera never stopped moving. It establishes that this detector could not independently verify a stationary view during the bounded observation. The scouting record retains status and timing, not per-comparison diagnostic reasons, so it cannot distinguish missing landmarks from other causes of uncertainty. The next technical investigation would need a small reviewable set of scout images and comparison diagnostics, or a fixed provider view; thresholds should not be weakened merely to obtain output.

The saved empty capture has recent-live-manifest-unmapped freshness: manifests advanced, but there are no accepted image timestamps to verify. This does not invalidate the previously verified source timestamps from pilot K/L. Capture and status records remain under camera-research/tides-pier/pilot-20261021-m-tides-pier/capture.json and camera-research/status/tides-pier.json respectively.

The pilot is disabled. A standalone provider inquiry for a supported Washout feed, source timestamps, capture permission and applicable terms was saved as an unsent Gmail draft titled “Washout webcam — feed access for Folly Surf.” No provider outreach was sent during this task.
