# Verification

Verified on October 12, 2026. These results describe the prototype's behavior, not textile segmentation benchmarks or physically validated sewing patterns.

## Automated checks

Run `npm test` with Node.js 20 or newer. All 38 tests pass:

- Pixel-derived calibration, disconnected scraps, noise removal, clipping, and quality flags.
- Real mask containment, holes and concave boundaries, cut overlap, complete/partial layouts, product definitions, and calibrated SVG export.
- Recommendations under shared size, seam, rotation, and exclusion settings.
- Conservative neural mask intersection, failure rollback, pinned model provenance, and SHA-256 checks of both ONNX networks.
- Storage availability, bounded JSON/RLE validation, capability access, constant-time checks, expiry, origins, rate/concurrency limits, and timeouts.
- Retry recovery after instance restart or lost write response, content conflicts, and atomic create across concurrent instances.

## Real neural browser check

SlimSAM ran on the illustrative Earth&olive scene, isolated the selected Oat piece, and displayed its predicted foreground for review. Applying the result conservatively removed 2,311 pixels, changed estimated scene area from 3,967 to 3,954 cm² at the illustrative scale, and recalculated a complete 26-cut tote. Local inference including initialization took 9.8 seconds; the first Azure browser run including asset downloads took 24.1 seconds. These observations are not performance guarantees.

[Actual neural prediction](screenshots/neural-review.jpg) · [Desktop studio](screenshots/studio.jpg) · [Mobile studio](screenshots/mobile-studio.jpg) · [Private neural receipt](screenshots/private-receipt.jpg)

## Public Azure backend checks

The deployed 1.1 service passed:

| Check | Observed result |
| --- | --- |
| Actual private-container readiness |200, `storageReady:true` |
| Durable geometry-validated save |201, `saved:true` |
| Identical-request replay |200, same receipt and original expiry |
| Changed input with the same save key |409 |
| Retrieval with the private capability |200, no token or token hash in the result |
| Retrieval with the wrong capability |401 |
| Delete the disposable test report |200, subsequent retrieval404 |

The browser also applied actual neural pixels and displayed **VERIFIED & SAVED** after cloud validation. Source photographs were processed locally; the server received derived geometry and client-reported model provenance. Retrieval displayed the actual SlimSAM model provenance, a derived-input fingerprint, 26 placed cuts, and the 30-day expiry. The new controls were inspected at both mobile and desktop breakpoints.

## Samples and controls

All six samples detected seven separated scraps. All 18 sample/product combinations produced complete validated layouts at their illustrative widths. On the Denim repair scene, 50% size produced 12 × 14 cm, while 125% produced 30 × 35 cm and an honest incomplete layout. Exclusion removed all assignments from that scrap; restoration returned a complete 26-cut tote. Rotation disabled produced no rotated cuts. The gallery, real product comparison, material review, 3D controls, and cloud receipt were inspected through the browser.
