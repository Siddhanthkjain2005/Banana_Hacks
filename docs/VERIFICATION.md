# Verification

Verified on October 12, 2026. These results describe the prototype's behavior, not textile segmentation benchmarks or physically validated sewing patterns.

## Version 1.3 checks (FabricNet, grain, assembly, zero-waste lab)

Run on October 12, 2026 with Node.js 22 and headless Chromium (SwiftShader WebGL) against `npm run dev`, which serves the same Azure Functions handler with local file storage. The public Azure v1.3 deployment was subsequently verified on October 12, 2026 using the end-to-end API demo and interactive browser checks; see the public verification section below.

**`npm test`: 72 of 72 pass**, including the 14 new tests listed in the README.

| Check | Observed result |
| --- | --- |
| FabricNet held-out synthetic test (1,500 new patches, seed 4242) | 96.3% accuracy; most errors are textured weaves read as solids (19 of 250) |
| Browser vs training forward pass | Equal to 1e-5 on every class |
| Grain, synthetic stripes (11 angles × 5 periods) | Worst error 0.9° |
| Pattern mix classes | Stripe 85%, check 90%, dots 91%, print 96%, textured 50%, solid 53%, pinstripe → stripe 79% |
| Pattern mix grain (known rotation) | Stripe −6.0° (−6°), gingham +1.8° (+2°), pinstripe +8.9° (+9°), from pattern orientation; others within 1° from cut edges |
| Grain-aware tote, Pattern mix | Complete, 20/20 cuts, 68.5% of usable fabric; 2 stripe scraps rotation-locked; 1 off-grain cut flagged. Grain rules off: 16/16 cuts on a 2 × 2 grid |
| Server re-plan with FabricNet summaries | Identical cut IDs, scraps, positions, and rotations; malformed summaries → 400 |
| Leftover chain, Pattern mix | Tote, then a 50% pouch: 68.5% → 76.2%; 38 cuts cross-validated |
| Colour harmony | Same-fabric neighbours 0 → 0, mean neighbour ΔE 41.4 → 42.8, 1 swap; applied to the 3D model |
| Deep search (7 s budget, seed 1) | 26 restarts; largest reusable offcut 22.2 × 5.6 cm → 5.3 × 31.2 cm, all 20 cuts placed |
| Deep search, Denim repair tote (`npm run demo`, 3 s) | 12 restarts; all 26 cuts kept; largest reusable offcut 11.1 × 18.9 cm → 19.2 × 18.5 cm |
| Original v1.2 demo numbers | Unchanged: 26/26 cuts, 64.5% → 76.6% chain, ΔE 21.2 → 29.5 |
| Community pool, 125% tote with Earth & olive | Pooled plan complete with 26 cuts; alone: 8/10 and 14/16 cuts, so pooling unlocked it |
| Maker packet, save, share | A4 PDF downloaded; cloud save verified; read-only link opened in a new browser context with `access: viewer` |
| Layout and errors | No horizontal overflow at 360, 390, 768, 1024, and 1280 px; no console errors or page errors through the interaction run |

FabricNet labels every scrap in the solid-colour samples (Earth & olive and the AI-generated photos) as textured or solid, as expected. Its accuracy on real photographs has not been measured.

## Integration review

The final review adds three regression tests: a selected search seed and fixed grid reproduce exactly the same cuts in cloud plans and saved receipts (and are accepted by packet generation); malformed reproduction hints are rejected; and product comparisons respect the grain-awareness toggle. A further fault-injection check covers safe startup errors and healthy request forwarding in the Azure entry. All 72 tests pass. Browser checks also confirmed that changing products during an active lab run clears stale results while retaining donor controls, both PDF buttons, and read-only sharing.

FabricNet’s recorded evaluation was independently repeated on all 1,500 freshly synthesized patches (seed 4242), reproducing 1,445 correct classifications and the recorded confusion matrix: 96.3%. This remains a synthetic-data result.

## Public Azure v1.3 verification

The production API reports version 1.3.0 and private Blob storage is ready. `npm run demo -- --base https://salmon-stone-073245e00.4.azurestaticapps.net/` passed planning, arrangement, impact, chaining, pooling, deep search, design-map generation, maker packets, private saving, viewer retrieval, and owner deletion. Viewer deletion was denied with HTTP 403. The demo also reproduces the selected optimized cuts exactly in a separate planning call and the saved receipt. External image generation remains unconfigured.

In the live browser, Pattern mix classified seven scraps, locked two directional stripes, flagged one off-grain cut, and produced a complete 20-cut tote. The lab completed in 14.3 seconds: 68.5% → 76.2% chained utilization with 38 cross-validated cuts; a larger reusable offcut after 48 seeded restarts; complete 125% pooled tote where neither donor alone could finish it; and the server design map. No browser console errors were observed. Timing and restart counts vary by device and instance load.

The function entry now converts dependency initialization failures into a safe HTTP 503 response and logs only the missing module identifier and error category, rather than exposing stack traces or request content. Source files are deployed with standard readable permissions.

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
