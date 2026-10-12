# ReThread verification notes

Verified on 12 October 2026 against the local source and the actual generated fabric assets.

## Fabric library

All six local assets were visually inspected in a browser verification page. Each detects seven separated fabric scraps. All 18 sample/product combinations produced complete validated layouts at their illustrative scene widths. The three photo-style samples are labelled AI generated; the remaining examples are procedural swatches. The gallery implementation lists all six metadata entries and loads their local image assets.

## Actual denim photo and new controls

The Denim repair photo was read at the application's 1200 × 800 analysis resolution, with a 90 cm illustrative scene-width assumption.

- Default tote: complete, 26 of 26 cuts; 24 × 28 cm finished dimensions.
- Best fit: returns three actual, complete validated plans for tote, cushion and pouch, ranked using the measured material and constraints.
- Size 50%: 12 × 14 cm tote; complete layout.
- Size 125%: 30 × 35 cm tote; the solver honestly returns an incomplete layout for these scraps.
- Excluding the first large scrap: none of its cuts are assigned; the remaining partial result contains 9 of 10 required cuts.
- Restoring that scrap: complete 26-cut tote is restored.
- Rotation disabled: no placed piece is rotated; a complete tote is still found.

The worker filters excluded scraps before both optimization and recommendations, and receives the current size, seam allowance, objective and rotation setting. The UI displays dimensions from the resulting plan rather than from fixed captions.

## Scope and remaining UI check

The six-sample verification page and earlier tote, pouch, cushion, textured-material and exploded-assembly checks were completed in a browser. The final new-controls click-through could not be completed from the QA agent: its in-app browser was unavailable, and a native Chrome attempt was interrupted by an app change. Final gallery, material review, size slider, rotation checkbox and recommendation modal clicks should therefore be checked in the root agent's active preview. No claim is made that this final click-through was executed.

The quick palette switch was found using a modulo-three cycle despite six entries. The root agent corrected it to use the library length, and the corrected source was verified. The independent Browse samples modal includes all six.

Local preview cloud endpoints are not deployed, so their 404 responses are expected. Cloud persistence needs a separate live Azure check.

## Neural model and backend reliability upgrade

Real browser inference with the pinned INT8 SlimSAM encoder and decoder completed in 9.8 seconds on the illustrative Earth&olive sample. The displayed foreground isolated the selected Oat scrap. Applying removed 2,311 edge pixels conservatively, changed detected scene area from 3,967 to 3,954 cm² at the assumed sample scale, and retained a validated 26-cut tote. These are workflow observations, not segmentation-accuracy or physical-measurement benchmarks.

38 tests pass, including SHA-256 verification of both vendored neural networks, mask-intersection invariants, failure rollback, actual storage readiness, replay across instance restart, interrupted-write recovery, and conditional-create collision handling.
