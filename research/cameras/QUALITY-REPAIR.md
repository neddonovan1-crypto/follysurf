# Webcam quality repair — October 21, 2026

The sampler now compares rendered image patches independently of the vision model. It fits distributed landmark motion, tests each burst against its first frame, and reports stable, pan-or-zoom, or unknown. Textureless, unmatched, inconsistent and poorly distributed landmarks fail closed. Player controls and image borders are excluded. Only independently stable bursts can support shape evidence; the model cannot restore rejected evidence. Thresholds are conservative engineering gates, not validated measurement accuracy.

Program time is read only from an Hls instance attached to the sampled video. Every frame must carry a current, advancing, continuous program timestamp from a live playlist to verify source time. Age is limited to 120 seconds with five seconds of clock tolerance. Missing mappings remain unverified. Recent advancing playlist timestamps alone are labeled recent-live-manifest-unmapped, never verified images. Passive playlist diagnostics retain only timing/sequence flags; no media URLs, credentials or raw manifests are saved. No extra stream requests are made.

During gaps between bursts, a playhead stranded outside buffered ranges can seek forward to eight seconds before the buffered end (requiring a nine-second buffer). Recovery is bounded to two attempts. Each seek creates a recorded playback epoch, and the next burst starts a new continuity check. Recovery never happens inside a burst and is not hidden by changing timestamps. Normal buffering, ended recordings and decoder errors do not trigger speculative seeks. Backward seeks are forbidden: pilot J showed they replay old footage and do not solve missing segments. A real full-window capture is still required to verify recovery.

The v2 private analysis contract validates recovery epochs and source-time evidence. All outputs remain scoreEligible:false. The test uses capture-only mode and a once-only immutable ID, expires at a fixed time, and calls no vision API. Recurring sampling remains off. The final configuration disables the pilot after the test.

Validation: 23 targeted tests, including pan/zoom/low-texture cases, old-model stable claims, source-clock freshness, recorded playlists, bounded recovery and explicit discontinuities. The actual saved Tides G first/middle/last images are independently rejected as untrackable across changing views; an unchanged reference is stable. This demonstrates rejection of the earlier false-stability result, not field-validated pan/zoom accuracy.

Deployment and observed live-test results are recorded below after verification.

Pilot J was deployed in PR #16. Washout failed at the 60-second burst after two backward recoveries; the last buffer ended at 29.99s while the player had jumped to 79.975s. Observed live playlists advanced but carried no program date/time. Tides had a normal browser closure after 3m10s, but no saved capture or terminal status appeared. Cloudflare subsequently confirmed "Durable Object's isolate exceeded its memory limit and was reset" at 20:40:43 UTC. This does not count as a successful test.

The follow-up disallows backward recovery, requires an eight-second buffered runway, moves image registration into Chromium to avoid serializing 1.2 million grayscale numbers back through Playwright, and saves capture evidence before browser shutdown. It adds progress stages for diagnosis. Pilot K is a bounded capture-only retest; results must be recorded before declaring success.

Pilot K Washout failed at the 30-second burst (20:52:01 UTC). It had zero recovery seeks; the player was seeking at 49.984s, while buffered media ended at 19.993s. One media-segment request failed. Advancing manifests again lacked program date/time. The forward-only guard correctly rejected a rewind, but this is not a buffering fix. Reliable source delivery and timestamp metadata remain provider/infrastructure requirements; do not claim a current live observation from this feed.

Pilot K Tides saved all frames, then failed while reading the undefined view-quality result. The serialized browser expression returned a function instead of invoking it. The fix explicitly invokes the expression and adds a regression test that executes it, including a separate check of the actual Wrangler-bundled function. Pilot L recomputes only image quality from K's saved frames on a blank browser page; it does not request either camera or call a vision model. Original capture and source clocks remain unchanged.

## Verified result and final state

Pilot L completed at 21:00:58 UTC. It repaired the quality metadata for all 36 saved Tides K frames. Independent comparison reports pan-or-zoom with zero stable bursts. Shape evidence must therefore be withheld. Tides source time is verified using the attached player's program timestamps: sourceStartAt=1792615875.703, sourceEndAt=1792616030.683, maximum source age at capture=65.875 seconds. No recovery seeks were used. This is delayed live footage, not zero-latency video.

Washout is still unresolved in Cloudflare Browser Run: K failed at frame-30 with an unavailable forward buffer and a failed segment request; observed manifests lack program date/time. Safe failure handling is deployed, but reliable Washout capture and source-time verification are not claimed. A reliable authorized stream/working capture route and source timestamp metadata are still needed.

The final configuration sets PILOT_ENABLED=false and removes the saved-quality repair source. There are no recurring capture or vision jobs. All camera results remain scoreEligible:false. PRs #16–18 contain the implementation; the closing change records results and disables the pilot.
