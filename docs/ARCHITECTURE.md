# ReThread architecture

## Photo to material inventory

The browser downsizes the photo to at most 1200 pixels along its longest side. A Web Worker fits deterministic k-means clusters in CIELAB space, estimates the background from border colors, cleans masks with morphology, and traces connected regions. Scrap geometry, conservative usable masks, colors, quality flags, and areas come from image pixels. A user-entered scene width supplies pixels per centimetre; areas scale with its square.

## Real neural inference

**Model:** `Xenova/slimsam-77-uniform`  
**Pinned revision:** `5850ab45f587c112167512ffef949107115e26a0`  
**Networks:** INT8 image encoder and prompt encoder/mask decoder  
**Runtime:** Transformers.js 2.17.2 with ONNX Runtime Web 1.14.0, single-thread WASM

The model's approximately 13.8 MB of weights and the runtime are hosted with the app. `neural-worker.js` receives local image pixels and an interior point in the selected piece. The image encoder creates embeddings; the decoder produces three candidate masks. The application selects the candidate with the highest predicted IoU score, resizes the actual model mask, and presents it for human review. The score is not displayed as measurement accuracy.

Applying the prediction intersects it with the existing selected scrap mask. It cannot enlarge the material region. Strong disagreements or invalid dimensions reject the operation and preserve the prior analysis. Accepted pixels update area, conservative boundaries, and the cutting plan. Image embeddings are reused for subsequent prompts on the same photo. The application did not train or fine-tune SlimSAM on textiles.

[Model card](https://huggingface.co/Xenova/slimsam-77-uniform) · [Pinned files and SHA-256 digests](../dist/models/slimsam/provenance.json)

## Cutting and rendering

`dist/vision.js` is the source of truth for geometry. The planner searches rectangular patch grids, seam allowances, and optional quarter-turn rotations. Integral images check mask containment; explicit rectangle checks and a separate validation pass check placement and overlap. Incomplete designs remain incomplete.

Three.js uses real photo texture crops and cut assignments for tote, pouch, and cushion concepts. Preview geometry is not cloth simulation. SVG export uses physical units with an exact 100 mm scale bar. JSON includes model provenance and measurement limitations.

Azure Functions needs its own deployable module files. `npm run sync:api` copies the browser geometry into `api/core/vision.mjs` and rewrites the recommendation import to that module. Automated tests detect drift.

## Backend planning services

`api/lib/service.cjs` is a route table over focused modules. The Azure function and `npm run dev` share it:

| Module | Responsibility |
| --- | --- |
| `validate.cjs` | Strict decoding of derived masks, per-photo calibration, shared allocation budgets, and per-route optional sections. |
| `analytics.cjs` | Per-scrap use, seam workload, leftover masks, maximal-rectangle search, and colour-aware arrangement. |
| `chain.cjs` | Zero-waste project chains with exact fit pre-checks, a search budget, and independent re-validation. |
| `pool.cjs` | Multi-donor planning, solo comparisons, and contributions. |
| `design-map.cjs`, `imagegen.cjs` | Layout rasterization, prompt construction, and the optional OpenAI-compatible image provider. |
| `pdf.cjs`, `packet.cjs` | A dependency-free vector PDF writer and the printable maker packet. |
| `impact.cjs` | Mass and avoided-emission estimates with cited, overridable assumptions. |
| `openapi.cjs`, `file-store.cjs`, `png.cjs` | API description, local create-only storage, and PNG encoding. |

**Leftovers.** The engine's usable mask is a 3 × 3 erosion of the measured mask. For a cut rectangle R, erode(A − R) = erode(A) − dilate(R). Clearing each cut plus a one-pixel border from the usable mask therefore gives exactly the mask the engine would compute for the physical offcut. A test checks the identity. Chained cuts are re-validated against the original decoded masks, independently of the leftover masks.

**Colour arrangement.** Cuts with identical dimensions can be sewn into any matching slot. With slots s, assignment π, and edge-sharing neighbours N, the search minimizes

C(π) = Σ_{(s,t)∈N} p(π(s), π(t)), where p = 2 for the same scrap and otherwise max(0, 1 − ΔE₇₆/40).

It applies the best improving swap until none remains. Cut positions on the fabric never change, so cutting validity is untouched.

**Concept renders.** The design map is a 1024 × 1024 raster of the arranged plan: measured colours per slot, seams where patches join, and hatching for missing cuts. It is the reference image for an Images API `edits` request, so generation is conditioned on validated geometry rather than on a free-text description. Only the map and prompt are sent.

## Private persistence and recovery

Azure receives derived masks, image dimensions, calibration, constraints, and optional model provenance. It never receives the source photograph. Strict validation bounds request size, decoded allocations, colors, IDs, masks, overlaps, and options. The server recomputes geometry before committing a receipt to a private Blob container.

Each receipt has a random UUID and a random 32-byte capability. Only its SHA-256 token hash is stored. Retrieval and deletion check the capability with constant-time comparison. A read-only viewer capability is HMAC-SHA256(owner capability, "rethread-share-v1"), and only its hash is stored, so viewers cannot derive the owner key or delete. The API enforces 30-day expiry; a Blob lifecycle rule supplies physical cleanup.

For retry-safe writes, the browser retains an idempotency UUID and capability before POST. Matching input and key recover the original durable record. Changed input or capability is rejected. Conditional Blob creation prevents duplicate records across concurrent instances; a same-instance in-flight limit bounds work. Limits are per instance, not a distributed job queue.

`/api/ready` probes actual private-container connectivity. `/api/health` reports configuration. Safe error responses include correlation IDs without credentials or source data. The stored input fingerprint is a SHA-256 digest of the submitted derived request. Neural execution provenance is client reported; server geometry validation does not independently prove the original image or model execution.
