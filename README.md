# ReThread

**Give every scrap a second life.** ReThread is a browser-based circular design studio that turns a photo of fabric offcuts into a material inventory, a mask-aware patch layout, an interactive 3D preview, and an SVG cut sheet.

The prototype is intended for sewing students, repair cafés, and small upcycling workshops exploring what they can make from material they already have.

**Team: Oddment Guild** — Siddhanth K Jain, Adithya P, Kamma Rohan, Dinesh Kulkarni.

**Live demo:** [ReThread on Azure](https://salmon-stone-073245e00.4.azurestaticapps.net). Public access and durable cloud save, retrieval, and deletion were verified on October 12, 2026.

## Run locally

Use a current Node.js installation with npm. From this folder:

```sh
npm install
npm start
```

Open the local address printed by the server. Runtime files are vendored in `dist`, so you can also start the static server directly:

```sh
node server.mjs
```

The app is served from the static `dist` folder; there is no remote image-inference backend or API key to configure. Keep the server running while using the app.

## Try the workflow

1. Use **Browse samples** to choose one of six illustrative collections, or **Upload fabric photo** to load an arbitrary photograph. For clearer segmentation, place separate scraps flat on a plain, contrasting background with even lighting.
2. Set **Photo width** to the width of the photographed scene. This user-supplied measurement is used to estimate physical dimensions.
3. Select **Analyze & design** to generate the material inventory and masks.
4. Select **Cutting plan** to inspect the layout. Choose a product, adjust **Design size** from 50% to 125%, set **Seam allowance**, and choose whether to **Allow rotated cuts**. Explore **Color story**, **Balanced**, or **Less stitching** under design priority.
5. Return to **Design studio**, drag to rotate the 3D preview, and select **Explode assembly** to inspect its exploded view.
6. Use **Review materials** to exclude uncertain scraps and restore them when appropriate. **Find my best fit** computes actual layouts for all three products under your current settings, ranking complete plans first, then by geometric utilization.
7. Select **Cutting plan** and **Download cutting sheet**. The top **Export** menu also offers the JSON material report, a TXT sewing guide, and a PNG of the 3D concept. Inspect the SVG and verify real material measurements before cutting.
8. **Cloud verify & save** sends derived masks and settings for server geometry checks and private persistence. **Saved plans → View receipt** retrieves the result. The local studio works without the cloud; live cloud saving is available on the Azure demo.

All six samples are generated illustrations, not measured photographs: three photo-style ImageGen examples and three procedural canvas illustrations. Their assumed scene widths demonstrate calibration and cannot establish physical accuracy. Photos are processed locally. Optional cloud saving sends derived geometry and design settings, including color labels; it does not upload the fabric image.

## Engineering

The vision pipeline fits deterministic k-means clusters to sampled image colors in CIELAB space. It estimates the background from median border colors and adapts the separation threshold to border variation. Morphological cleanup, connected regions, and traced contours form the scrap inventory; the initial inventory uses classical vision. Optional **AI refine selected fabric** runs a real pretrained SlimSAM image encoder and prompt/mask decoder locally, presents its foreground prediction for review, and conservatively intersects it with the selected measured mask before replanning. A conservative boundary reduction produces the usable masks, and scraps touching the image edge are excluded from automatic cutting.

The planner searches rectangular patch grids and optional 90-degree rotations, including seam allowance. Integral-image checks test containment within usable masks, while explicit rectangle checks prevent overlap. A separate validation pass checks the chosen layout. The geometric utilization estimate is:

```text
utilization (%) = planned patch area / detected usable scrap area × 100
```

This metric describes the proposed layout and depends on the segmentation and scale estimate. It does not establish a real-world waste reduction or environmental saving. The deterministic search is a heuristic, without a global-optimality guarantee. A failed search does not prove that no valid arrangement exists; partial layouts are labeled incomplete and cannot make the finished product.

The Three.js preview provides rotation, an exploded view, and product visualization. SVG export includes cut boundaries, seam lines, units, piece labels, completion status, and a 10 cm scale check. Print at 100% size and verify that scale before using the drawing.

## Optional Azure geometry service

The `api` folder contains a Node.js Azure Functions HTTP service with private Azure Blob persistence. The live Azure deployment serves both the studio and `/api`; the local static server serves the studio without cloud endpoints.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/ready` | Verify actual private Blob connectivity before enabling cloud saves. |
| `GET /api/health` | Service metadata, configured-storage status, and limits. Configuration alone does not prove a durable save. |
| `POST /api/jobs` | Validate encoded masks and settings, recompute measurements and layouts, and return a receipt after private storage confirms the write. |
| `GET /api/jobs/{id}` | Retrieve a receipt with its `X-ReThread-Token` capability. |
| `DELETE /api/jobs/{id}` | Delete the record when its capability is valid. |

Requests contain run-length encoded masks, image dimensions, scene width, product constraints, and excluded material IDs. The API checks field types, ranges, mask bounds, source-coordinate overlap, and request size. It recomputes calibrated areas, conservative containment, cut overlap, and recommendations. Supplied geometry cannot independently prove the source photograph or physical fabric suitability.

Records use random job IDs and access capabilities. Only the capability's SHA-256 hash is stored with the record; the browser retains its access key. Anyone holding that capability can access the record, so keep it private. The API rejects access after 30 days and supports deletion. A 30-day Blob lifecycle deletion rule is configured for physical cleanup.

Code limits include 2 MiB requests, 1600 pixels per source dimension, 2.56 million decoded mask pixels, 48 scraps, per-process request/concurrency limits, and timeouts. There is no in-memory persistence fallback. These are prototype safeguards rather than complete production abuse prevention.

Deploy both `dist` and `api`, install API dependencies from the lockfile, and configure `STORAGE_CONNECTION_STRING` securely in Azure settings. Do not commit it or expose it to the browser. `RETHREAD_ALLOWED_ORIGIN` can restrict browser origin. Runtime configuration is in `dist/staticwebapp.config.json`.

## Verification

The complete automated suite passed **38 of 38 tests**. Live anonymous checks confirmed health availability, a durable `201` save with a feasible server-validated plan and exclusions, capability-authorized retrieval without the token hash, rejection of a wrong capability (`401`), deletion followed by not found (`404`), and rejection of invalid dimensions (`400`). Browser verification also confirmed **Cloud verify & save → VERIFIED & SAVED** and **Saved plans → View receipt**, showing a complete 26-cut geometric layout and its 30-day expiry. Health configuration alone is not treated as proof of storage. See [frontend QA notes](docs/QA.md) and [API details](api/README.md).

## Limits

This is a hackathon prototype. Similar foreground/background colors, shadows, touching scraps, perspective, patterned fabric, and uneven lighting can affect the mask. Scene width is set by the user, so all physical dimensions are estimates. The preview is not a cloth simulation, and the exported plan is not a validated sewing pattern. Fabric grain, stretch, thickness, and real assembly requirements need a maker's review before cutting.

SlimSAM is a general pretrained segmentation model, not a textile classifier or evidence of sewing safety. No production inference-accuracy claim is included. The strongest next steps are real maker trials, perspective calibration, grain-direction constraints, and documented comparisons of segmentation and packing methods.

## Neural model and recovery

Select a scrap in the photo or material library, then choose **AI refine selected fabric**. Review the actual green SlimSAM prediction and apply it to recalculate the plan. All runtime and INT8 encoder/decoder weights are hosted with the app; no inference API or photo upload is required. The exact model revision, file sizes and SHA-256 digests are recorded in [model provenance](dist/models/slimsam/provenance.json). First inference also loads the model runtime; subsequent prompts reuse the same photograph embeddings.

Azure `/api/ready` checks actual private-container connectivity. Cloud saves use a browser-retained UUID and random private capability. Repeating the same save retrieves the original durable receipt, including after a lost response or an instance restart. Conditional Blob creation prevents concurrent duplicate writes. Different settings or capabilities cannot reuse a save key. Receipts include a SHA-256 fingerprint of the derived request and explicitly identify neural provenance as client reported.

## Credits and provenance

- **Three.js 0.180.0:** rendering library by the Three.js authors, distributed under the [MIT License](https://github.com/mrdoob/three.js/blob/r180/LICENSE). Preserve the included license notice when redistributing the library.
- **OpenAI Codex:** AI coding assistance was used for research, implementation, design iteration, and documentation. Final functionality and claims require human review.
- **ImageGen:** Denim repair, Autumn linen, and School-day cotton were generated on October 12, 2026. Prompts and provenance are in [sample-provenance.json](dist/assets/sample-provenance.json). These are synthetic examples, not measured fabric photographs.
- **Procedural imagery:** Earth & olive, Coastal remnants, and Quiet neutrals are generated canvas illustrations authored with AI coding assistance. No external textile dataset was used to create these samples.
- **SlimSAM:** [Xenova/slimsam-77-uniform](https://huggingface.co/Xenova/slimsam-77-uniform), revision `5850ab45f587c112167512ffef949107115e26a0`, ONNX INT8 encoder and decoder, Apache-2.0.
- **Transformers.js 2.17.2:** Apache-2.0; **ONNX Runtime Web 1.14.0:** MIT. Their license notices are included in `dist/vendor/ai`.
- **Azure SDK for JavaScript:** `@azure/storage-blob` supplies persistence and is [MIT licensed](https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/storage/storage-blob/package.json).

## Submission materials

- [Devpost draft](docs/DEVPOST.md): project write-up of fewer than 500 words.
- [Three-minute video script](docs/VIDEO-SCRIPT-3MIN.md): narration and screen actions covering every feature.
- [Short demo script](docs/DEMO-SCRIPT.md): a 2:45 recording plan.
- [Submission checklist](docs/SUBMISSION-CHECKLIST.md): account, team, publication, and verification fields still to complete.
- [Organizer research](docs/research.md): sources, eligibility, deliverables, rubric, and conflicting published deadlines.

**Public source:** [Siddhanthkjain2005/Banana_Hacks](https://github.com/Siddhanthkjain2005/Banana_Hacks). Use the verified [Azure demo](https://salmon-stone-073245e00.4.azurestaticapps.net) for judges. The separate Sites preview last returned HTTP 401 while signed out. No external hackathon submission has been confirmed; complete the account and team fields in the checklist before submitting.
