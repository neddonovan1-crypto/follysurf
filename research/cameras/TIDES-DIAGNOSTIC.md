# Tides detector diagnostic — October 22, 2026

Pilot M returned unknown for all 48 scout checks without preserving the rejected images or detailed comparison results. That outcome cannot establish continuous camera movement or explain the detector's uncertainty.

Pilot N keeps the original stability decision and thresholds. It records all three scout comparisons, including rejection reasons, textured patches, high-correlation matches and available transform metrics. It saves three review triples selected by time (first completed check in each 60-second bin), independently of the result. Original JPEGs, timestamp metadata and a labeled contact sheet are stored privately in R2. Review writes happen after any candidate burst so storage does not disturb burst timing.

The pilot is Tides-only, capture-only, once-only and bounded by an expiry. There are at most nine review images and three contact sheets. No model call or forecast-score eligibility is introduced. The pilot will be disabled after inspection.

Validation before deployment: 31 focused camera tests pass; Wrangler dry-run succeeds; the bundled scout, full-capture and contact-sheet browser expressions execute correctly. Review selection limits and image/timestamp correspondence are tested.

## Live result

PR #22 passed GitHub checks and deployed successfully to both Workers. Pilot N completed on October 22 at 14:24:09 EDT (18:24:09 UTC). It took 57 screenshots, made eight scout checks, attempted seven bursts and accepted five complete bursts containing 30 frames. Seven scout checks were stable and one was unknown. Two candidate bursts were rejected as unknown. No playback recovery occurred. Per-frame source timestamps were verified, with maximum footage age of 42.443 seconds for accepted frames.

The three time-selected review sequences were saved at observation offsets 6.298, 81.055 and 131.005 seconds. All nine original images and three contact sheets were retained. Visual inspection of all three sheets showed stationary pier, shoreline and beach fixtures within each triple, with moving waves and beachgoers. The camera framing differed substantially between sequences. All nine within-triple comparisons agreed with that visual assessment: zero estimated displacement, unit scale and zero rotation, supported by 9–12 inlier matches. These are three reviewed examples, not a general accuracy estimate or independent human-labeled validation set.

The one unknown scout check contained two insufficient-trackable-landmarks comparisons: scout-17 to scout-18 had two matches, and scout-17 to scout-19 had one, below the unchanged requirement of eight. Scout-18 to scout-19 was stable with 13 inliers. This localizes the uncertainty to comparisons involving scout-17; the images for that check were outside the fixed review sample, so we cannot establish visually whether it was a transition, loss of useful landmarks or a false rejection. Likewise, the two rejected full bursts were not retained in full, so their unknown decisions are not resolved by the preceding stable scout triples.

The detector successfully identifies some stationary windows without loosening thresholds. This run does not explain every unknown result from yesterday, whose scout images were not saved. It does establish that Tides can supply intermittent stationary, timestamped evidence. The full selected set has viewStatus unknown because separate bursts do not constitute one continuous fixed view; all five retained bursts independently passed every required within-burst comparison.

All output remains scoreEligible:false. No vision model was called. Surface or wave-shape classification still needs a separate evaluation against reviewed examples before it can support a product claim or influence forecast scores. The pilot is disabled after this result, and the optional scout-image flag has been removed.

Private evidence prefix: camera-research/tides-pier/pilot-20261022-n-tides-pier/. Files include capture.json and scout-review-1 through scout-review-3 as metadata JSON, labeled contact-sheet JPEG and three original frame JPEGs per review. The status record is camera-research/status/tides-pier.json. These images remain private in R2 and are not copied into the source repository.
