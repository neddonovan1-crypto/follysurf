# Browser page sampling pilot

The active capture implementation opens the public Washout and Tides pages in Cloudflare Browser Run using the pinned official `@cloudflare/playwright` package. It uses ordinary player playback and JPEG screenshots of the rendered video rectangle. One `Page.captureScreenshot` compositor command captures each frame; the player position is refreshed before each burst using its viewport box and document scroll offset. This avoids the repeated font, stability and scrolling setup in locator screenshots. It does not fetch discovered stream URLs, extract tokens, alter request headers, or bypass player access controls.

## Bounds and quality controls

- The checked-in enable flag and immutable pilot ID are defined in `wrangler.jsonc`; check the deployed values separately. Each pilot permits one attempt per camera, including failures. Five-minute cron checks only start unattempted work between 10:00 and 16:00 America/New_York. This is not yet recurring camera collection.
- Cameras run serially. Each browser uses a 60-second idle timeout, closes before analysis, and has a persisted session ID and Durable Object cleanup alarm. The capture deadline is 285 seconds after launch. The alarm fires 330 seconds after startup. Only this object's own session can be closed.
- Six bursts of six frames, nominally at 0–5, 30–35, 60–65, 90–95, 120–125 and 150–155 seconds. Actual request/completion timestamps and media clock readings are retained. Late, paused, reset, non-decoding and repeated captures fail closed. Brief buffering may recover within the four-second lateness allowance, with actual timestamps retained and at least 0.8 seconds between requests. Failure diagnostics include playback state and separate media-check/screenshot durations.
- The browser checks demonstrate playback, not verified live source time. `sourceTimeVerified:false`, null source timestamps and `scoreEligible:false` remain mandatory.
- Vision prompt v0.4 separately labels scene, camera movement and visible motion. Ads, uncertain/frozen footage and unusable scenes cannot support surface/shape labels. Panning or zooming prevents shape labels. Server quality gates force unsupported labels and evidence lists to unknown/empty after structural validation; the retained summary is generated from those gated fields. Raw model output is saved privately as `model-output.json` for review. These model checks still require independent human review.
- No numeric height, period, ride length, surf score, or safety assessment is inferred. No camera output enters the public formula.
- Existing private analysis retains the four-attempt daily model budget, run deduplication, pinned model, and `store:false`. Both raw capture metadata/images and analysis inputs are private R2 objects under `camera-research/`.

## Deployment

The camera Worker uses `camera-service/package-lock.json`, Browser Run binding `BROWSER`, existing `CAPTURE` Durable Object, private R2 `BUCKET`, and private `ANALYSIS` service entrypoint. The obsolete FFmpeg/Docker collector and its container build configuration have been removed. The existing `CameraCapture` Durable Object class, `CAPTURE` binding, SQLite namespace and attempt records are retained. Removing the container build entry does not delete the previously provisioned Container application; no remote application or stored-data deletion is part of this source cleanup.

Deploy the updated main analysis entrypoint before enabling the browser pilot so v0.4 scene/view checks and actual timestamp retention are active. Then deploy `camera-service/wrangler.jsonc` with Wrangler 4.136.0. Install the camera package dependencies from its lockfile first. There are no public routes, workers.dev URLs or preview URLs.

For verification, inspect `camera-research/status/{cameraId}.json`, then the matching `capture.json`, `input.json`, and `observation.json` or `failure.json`. A claim/status alone is not successful capture or analysis. Confirm no browser session remains after either success or failure.

Before expanding to recurring sampling, review the actual frames and observations, establish source freshness and per-view calibration, configure retention, and measure costs and error rates. This pilot does not train or fine-tune a model.

## Retired capture approach

On October 21, 2026, the original direct-HLS pilot failed: Washout returned HTTP 403; the configured Pier playlist was an ended promotional recording with an unavailable segment. These failures concerned the direct endpoints, not the availability of the public camera pages. Subsequent normal page playback in Browser Run showed moving beach video, leading to the current browser implementation. The first stream attempts and their results remain in private pilot records and Git history; the retired collector is no longer shipped.

The browser pilot is still experimental. Successful playback, capture, analysis and verified live source time are separate claims. Failure diagnostics are stored privately as `capture-failure.json` and, when available, `capture-failure.jpg`; inspect those alongside the status and run records described above.

## Automated test record — October 21, 2026

- Pilot C exposed a page interaction error: the Washout link targets a `data-scroll-id`, not an element ID. Pilot D corrected this and produced beach video before a playback-readiness failure. The Pier browser startup issue was followed by safer owned-session cleanup.
- Pilot E reached playing, decoding 1920×1080 media on both cameras, but locator screenshot overhead missed the required burst cadence (Washout frame 1; Pier frame 4). No complete batch or vision observation was produced by C–E.
- PR #11 replaces per-frame locator screenshots with compositor captures. Its 22 targeted camera checks, full GitHub checks, and Worker bundle check passed. Cloudflare version `7cf1aa38` built from merge `ea6a471f598c546d9f80d8bfe16369fe85a3a57f`; pilot F was enabled for one attempt per camera after verifying deployment. Pilot F produced a complete Pier batch of 36 frames over 159.622 seconds, saved privately as `camera-research/tides-pier/pilot-20261021-f-tides-pier/capture.json`. Analysis validation rejected sequential timestamps that shared a millisecond; no vision call was made. Washout stopped at nominal frame 2 with `readyState:1` and media time 29.991 seconds; its failure screenshot showed beach footage. Screenshot timings were 399–741 ms, while locator media checks took 1263–1496 ms. Both browser sessions closed.

PR #12 retains a video element handle to eliminate repeated lookup/disposal, rejects replaced elements, records media duration/buffer state, separates subsequent request timestamps by at least one clock tick, and dismisses the late cookie notice visible in the first Pier batch. Eleven targeted tests and the full GitHub checks passed before merge `a894f895fd4538a64352124897cce9df3a37bd2c`. Cloudflare version `ca61be09` deployed this merge successfully. Pilot G was enabled for one attempt per camera at the next scheduled tick; its outcome must be checked before calling the pipeline verified.

Pilot G's Washout attempt captured the first six frames with media checks of 143–146 ms and screenshots of 224–285 ms. It then failed at nominal frame 30 because the connected player had `readyState:1` (media time 59.981 s, duration 89.972 s, reported buffered end 9.998 s). This is a playback continuity failure, not screenshot throughput. The exact upstream cause is not established. The run correctly withheld a complete batch and vision call.

Pilot G completed the Pier batch: 36 unique frames over 155.321 seconds with zero measured request lateness. The cookie notice was absent in reviewed first/last frames. Capture validation passed, and the vision API returned a response, but v0.3 rejected shape/evidence supplied with a changing or uncertain view. This consumed one API attempt and produced private `capture.json`, `input.json`, and `failure.json`, not an accepted observation.

PR #14 (merge `09929fcf83d2367167ea6f941c0946c73c9553b4`) adds deterministic v0.4 label withholding and bounded saved-capture analysis. Eighteen targeted tests, source checks, the camera bundle check and full GitHub CI passed. Pilot H is configured, disabled by default, to analyze only the existing Pier G capture; both Workers deployed from documentation commit `01432fcb58ae6ab9c2f3e64041300ffa6ebfac04` (camera version `6b0f803d`, analysis version `2f539639`). Pilot H completed at 18:16:18 UTC and saved `input.json`, `model-output.json`, and `observation.json` under `camera-research/tides-pier/pilot-20261021-h-tides-pier/`, retaining source capture ID G. The pilot was then disabled and Browser Run reported no active sessions.

## Reanalyzing a saved batch

`PILOT_REANALYZE_FROM` selects a fixed previous pilot prefix; `PILOT_CAMERA` selects one of the two allowed cameras. A new immutable `PILOT_ID` claims the analysis attempt. Original image bytes and capture clocks are preserved, and input/observation records retain `sourceCaptureRunId`. The normal 30-minute capture freshness validation and four-attempt daily model budget still apply. This mode opens no browser and never resets prior claims. Remove both optional selectors when returning to a new two-camera capture pilot. Keep `PILOT_ENABLED:false` after the bounded verification.

## Final bounded-test outcome

The Pier capture-to-private-vision pipeline is verified, but the resulting observation is **not approved for condition scoring**. H labeled the view stable and shape mixed, while direct comparison of original frames `frame-0001` and `frame-0156` clearly shows panning/zooming. The research record remains `scoreEligible:false` and `qualityStatus:awaiting-independent-qc`; the review in `research/cameras/pilot-h-review.json` rejects its shape result and supplies the view-change correction. Do not mistake a successful API response or schema validation for an accurate surf assessment. Deterministic field withholding still depends on correct scene/motion/view classification; independent camera movement detection is required before expanding beyond research.

Washout ordinary page playback works briefly but did not sustain the full sample window; its buffering cause remains unresolved. Neither source has independently verified live source timestamps. Recurring production sampling and formula integration remain disabled. No camera output from these tests changes the public forecast score.
