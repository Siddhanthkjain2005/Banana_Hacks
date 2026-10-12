# Verification

Verified on October 12, 2026. These results describe the prototype's behavior, not textile segmentation benchmarks or physically validated sewing patterns.

## Automated checks

Run `npm test` with Node.js 20 or newer. The original v1.1 suite contains 38 checks:

- Pixel-derived calibration, disconnected scraps, noise removal, clipping, and quality flags.
- Real mask containment, holes and concave boundaries, cut overlap, complete/partial layouts, product definitions, and calibrated SVG export.
- Recommendations under shared size, seam, rotation, and exclusion settings.
- Conservative neural mask intersection, failure rollback, pinned model provenance, and SHA-256 checks of both ONNX networks.
- Storage availability, bounded JSON/RLE validation, capability access, constant-time checks, expiry, origins, rate/concurrency limits, and timeouts.
- Retry recovery after instance restart or lost write response, content conflicts, and atomic create across concurrent instances.

## Version 1.2 backend checks

Run `npm test` and `npm run demo`. All 58 tests pass. The 20 additional tests cover:

- Stateless planning without storage, per-scrap analytics, and seam workload.
- Bounded impact assumptions, and strict per-route body sections.
- Colour arrangement as a pure permutation of identical-size cuts.
- The exact leftover-erosion identity and maximal-rectangle search.
- Zero-waste chains, with every cut re-checked against the original masks and for cross-project overlap; project limits; and graceful budget stops.
- Pools that unlock a project no single donor can complete, per-donor calibration, and pool bounds.
- Design maps drawn from measured colours, and prompts that contain the palette.
- Image-provider requests carrying only the design map and prompt, Bearer versus Azure `api-key` auth, and safe error mapping including deadlines through stalled success and error response bodies.
- Render rate limits.
- PDF structure: every xref offset, page count, Letter media box, required sections, and an exact 100 mm calibration bar.
- Owner and viewer capabilities, and pre-1.2 receipts.
- OpenAPI path coverage, security headers, structured logs, and local create-only storage.

The end-to-end demo analyzed the bundled sample photographs with the browser engine in Node.js and sent only derived masks. Observed results:

| Check | Observed result |
| --- | --- |
| Plan, Denim repair tote | 26/26 cuts, 64.5% of usable fabric, 24 patchwork joins |
| Colour arrangement | Same-scrap neighbours 7 → 0; mean neighbouring ΔE 21.2 → 29.5 |
| Zero-waste chain | Tote, then a 75% pouch; utilization 64.5% → 76.6%; 44 cuts cross-validated |
| Community pool | Three donors' three smallest scraps each: no donor can make a 125% pouch alone; the pool completes it |
| Maker packet | 8-page PDF; MuPDF parsed it with no warnings; pages inspected visually |
| Receipts, local handler and public Azure | Save, viewer read (`access: viewer`), viewer delete → 403, owner delete → 200 |

The same end-to-end demo passed on the public Azure deployment on October 12, 2026. Health reported version 1.2.0. Stateless planning, chained projects, pooled fabric, design maps, unsaved A4 packets, saved Letter packets, private storage readiness, durable saving, and owner/viewer capabilities all succeeded. The temporary receipt was deleted by its owner capability after verification. The image-provider integration is tested against a mocked API; external image generation is not configured on this deployment, and no live render is claimed here.

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
