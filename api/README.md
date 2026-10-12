# ReThread geometry API

Node.js 20, Azure Functions host v4 with the Node.js v3 programming model (`function.json`). One HTTP function runs the same native-pixel geometry engine as the browser. It validates derived masks, plans products, chains zero-waste projects, pools donor fabric, renders layout-conditioned concepts, prints maker packets, and saves private receipts to Azure Blob storage. **Source photographs are never accepted or stored.**

The machine-readable reference is served at `GET /api/openapi.json` (OpenAPI 3.1).

## Configuration

| Setting | Required | Purpose |
| --- | --- | --- |
| `STORAGE_CONNECTION_STRING` | For saved receipts | Dedicated storage account for the private `rethread-plans` container. |
| `RETHREAD_ALLOWED_ORIGIN` | Production | Exact deployed website origin, without a trailing slash. |
| `RETHREAD_IMAGE_API_KEY` | Optional | Enables AI concept renders. Without it, `/api/concept` still returns the design map and prompt. |
| `RETHREAD_IMAGE_BASE_URL` | Optional | Any OpenAI-compatible Images API. Default `https://api.openai.com/v1`. For Azure OpenAI use `https://<resource>.openai.azure.com/openai/v1`. HTTPS only. |
| `RETHREAD_IMAGE_MODEL` | Optional | Model or Azure deployment name. Default `gpt-image-1`. |
| `RETHREAD_IMAGE_QUALITY` | Optional | `low`, `medium` (default), `high`, or `auto`. |
| `RETHREAD_IMAGE_TIMEOUT_MS` | Optional | Provider timeout, 5–120 s. Default 40 s, inside the Static Web Apps request window. |
| `RETHREAD_IMAGE_AUTH` | Optional | `bearer` or `api-key`. Defaults to `api-key` for `*.azure.com` hosts. |

Never place these settings in frontend JavaScript or commit them. The Azure Blob SDK is loaded only when storage is used.

The `rethread-plans` container is created privately. If an existing container permits public access, jobs fail rather than use it. Production has no in-memory persistence fallback. Configure a storage lifecycle rule to delete blobs under `rethread-plans/` 30 days after creation for physical retention cleanup; the API independently denies access after the stored 30-day expiry.

## Routes

| Route | Storage | Purpose |
| --- | --- | --- |
| `GET /api/health` | No | Version, enabled features, image-generation availability (never the key), and limits. |
| `GET /api/ready` | Yes | Probes the private Blob container; `storageReady: true` only after connectivity and private-access checks pass. |
| `GET /api/openapi.json` | No | OpenAPI 3.1 document for every route. |
| `POST /api/plan` | No | Validated plan, product comparison, per-scrap analytics, colour-aware arrangement, and impact estimate. Nothing is saved. |
| `POST /api/optimize` | No | Deep layout search: seeded multi-start restarts for the same product and grid within a time budget. |
| `POST /api/chain` | No | Zero-waste project chain over the leftover offcuts. |
| `POST /api/pool` | No | Community fabric pool across 2–8 photographed sources. |
| `POST /api/concept` | No | Design map PNG and engineered prompt; an AI render when configured. |
| `POST /api/packet?paper=a4\|letter` | No | Printable PDF maker packet for an unsaved plan. |
| `POST /api/jobs` | Yes | Server recomputes the plan and commits a private receipt; returns `201`, a job UUID, and a one-time 32-byte owner capability. |
| `GET /api/jobs/{uuid}` | Yes | Retrieve with the owner or a viewer capability in `X-ReThread-Token`. The response includes `access: owner\|viewer`. |
| `DELETE /api/jobs/{uuid}` | Yes | Delete; owner capability only (`403 READ_ONLY_TOKEN` for viewers). |
| `POST /api/jobs/{uuid}/share` | Yes | Owner mints a stable read-only viewer capability. |
| `GET /api/jobs/{uuid}/packet?paper=a4\|letter` | Yes | Maker packet for a saved receipt; owner or viewer. |
| `OPTIONS` | No | Accepts only the configured website origin. No list endpoint or wildcard CORS exists. |

Saved receipts store only SHA-256 hashes of the owner and viewer capabilities. The viewer capability is an HMAC of the owner capability, so the server never stores either value, a viewer cannot derive the owner key, and the owner can re-request the same share value at any time. Receipts saved before version 1.2 have no viewer hash and return `409 SHARING_UNAVAILABLE` for sharing. They still retrieve and print. Partial plans keep `feasible: false`; saving never turns them into complete designs.

## Request format

```json
{
  "image": { "width": 1200, "height": 840, "sceneWidthCm": 90 },
  "scraps": [
    {
      "id": "scrap-1",
      "label": "Sage 1",
      "color": "#75835c",
      "bbox": { "x": 10, "y": 10, "width": 30, "height": 20 },
      "maskRle": [0, 600],
      "usable": true
    }
  ],
  "options": {
    "product": "tote",
    "seamAllowanceCm": 0.7,
    "rotation": true,
    "size": 1,
    "objective": "color"
  },
  "excludedScrapIds": []
}
```

RLE is a flat sequence of `[start, length]` pairs in each bounding box's row-major pixel mask. Only foreground runs are included. Runs must be ordered, disjoint, positive, and in bounds. All masks must also be disjoint in the full source image. Areas and pixels per centimetre are recomputed from the image width and entered scene width; client-supplied area or scale fields are rejected. Every object is strict: unknown fields return `400`, and each feature route accepts only its own optional section.

## Feature endpoints

### `POST /api/plan`

Same body as a job, plus optional `impact`. Returns:

- `plan` and `recommendations`, from the shared engine.
- `analytics`: cuts, used area, and utilization per scrap. Also patchwork seam count and length from the planned grid, an assembly-seam estimate, and the largest rectangle still cuttable from each leftover.
- `arrangement`: cuts with identical dimensions are interchangeable, so a deterministic best-improvement swap search reassigns them to grid slots. It maximizes CIELAB ΔE between neighbouring patches and avoids sewing a scrap beside itself. Cut positions on the fabric never change. On the Denim repair sample, same-scrap neighbours fall from 7 to 0 and mean neighbouring ΔE rises from 21.2 to 29.5.
- `impact`: measured cut area, mass at an assumed fabric weight, and an avoided-new-fabric CO2e estimate. See [Impact assumptions](#impact-assumptions).

### `POST /api/optimize`

Same body, plus optional `optimize: { budgetMs: 500–12000 (default 6000), seed: 1–2³¹−1 (default 1) }`. The browser's deterministic plan is the baseline. Restarts keep its grid, visit equal-size cuts in a seeded order, and add bounded noise to scrap preferences; every candidate is produced and validated by the same mask-containment engine. Candidates are ranked by: complete and valid, cuts placed, the largest rectangle left in any offcut, scraps left whole, then total usable leftover. The response has `baseline.score`, the best `plan` and `score`, `improved`, the winning `seed`, `search` (tries, improvements, elapsed time, trace), plus analytics, arrangement, and impact for the best plan. The same seed reproduces the same search. On the Denim repair sample, a 3 s search keeps all 26 tote cuts and grows the largest reusable offcut from 11.1 × 18.9 cm to 19.2 × 18.5 cm. It is a heuristic, not an optimality proof.

### FabricNet summaries and grain rules

Each scrap may include `fabric: { pattern, confidence, directional, grainDeviationDeg, grainSource }`, produced by the browser's FabricNet model and grain estimator (`pattern` is solid, textured, stripe, check, dot, print, or null; `grainDeviationDeg` is −45…45 or null; `grainSource` is pattern, edges, or null). `options.grainAware` (default true) applies the same rules as the browser: directional scraps get no rotated cuts, and scraps more than 7° off grain are used last. Each cut then carries a grain note and `plan.stats.grain` summarises the effect. The summary is client-reported metadata, like SlimSAM provenance; it cannot add material, and unknown or out-of-range fields return `400`.

### `POST /api/chain`

Same body, plus optional `chain: { maxProjects: 1–5 (default 3), minSize: 0.5–1.25 (default 0.5) }`. The first project is exactly the `/api/plan` result. Each later project is the complete, validated product and size that uses the most remaining offcut area.

Leftover masks remove each cut plus a one-pixel border. For the engine's 3 × 3 erosion, erode(A − R) = erode(A) − dilate(R), so this exactly matches the conservative mask of the physical leftover; a test checks the identity. A separate pass re-validates every chained cut against the original decoded masks and checks for cross-project overlap.

To keep requests bounded, chained projects use grids of up to 3 × 3 patches per panel. A grid is tried only when its total cut area fits and every distinct patch size provably fits a leftover (exact integral-image test). The search stops after 10 s with the projects found so far and an explicit `stopReason`. On the Denim repair sample a tote plus a 75% pouch raise fabric use from 64.5% to 76.6%.

### `POST /api/pool`

```json
{ "sources": [ { "name": "Asha", "image": {…}, "scraps": [ … ] }, { "name": "Ben", "image": {…}, "scraps": [ … ] } ],
  "options": { "product": "pouch" }, "impact": { "fabricGsm": 150 } }
```

2–8 sources, each validated exactly like a job with its own calibration. Scrap IDs are namespaced per donor (`d1-scrap-3`). Masks must be disjoint only within a photograph. Totals stay within 48 scraps and 2.56 million decoded mask pixels. The response contains the pooled plan, each donor's solo plan, per-donor contributions (cuts, area, share), and `poolingUnlocks`: true when the pooled project is complete and no donor could complete it alone. Donor names are free text; use first names or nicknames.

### `POST /api/concept`

Same body, plus optional `concept: { style: studio|lifestyle|flatlay|sketch, generate: true|false }`. The server rasterizes the validated, arranged layout into a 1024 × 1024 **design map**: every patch slot is filled with the measured colour of the scrap cut for it, seams sit where the plan joins patches, and missing cuts are hatched. It then builds a prompt from the measured palette and the patch grid.

When an image provider is configured and `generate` is not false, the design map is sent to the Images API `edits` endpoint as the reference image, so the render is conditioned on real geometry. Only the design map and prompt text are sent. Photographs and masks never leave the browser, and the response lists exactly what was shared. Renders are limited to 3 per client per minute and 2 in flight per instance. Provider errors map to safe codes (`422 CONCEPT_REJECTED`, `502 IMAGE_PROVIDER_*`, `503 IMAGE_PROVIDER_BUSY`, `504 IMAGE_PROVIDER_TIMEOUT`) without echoing provider messages or credentials. Without a provider the route returns the design map and prompt with `render.generated: false`.

### Maker packets

`POST /api/packet` (unsaved) and `GET /api/jobs/{uuid}/packet` (saved) return an A4 or Letter PDF written by a dependency-free vector PDF writer:

1. Summary with feasibility, dimensions, cut counts, seams, largest leftover, impact estimate, supplies, and a 100 mm print-calibration bar.
2. Cut list with each cut's size, rotation, position from the scrap's photographed edges, and the slot it sews into.
3. Cutting diagrams per scrap, drawn from the decoded mask, with numbered cuts, seam lines, and a scale bar. Saved receipts store no masks, so their diagrams show bounding boxes.
4. Sewing layout per panel from the colour arrangement.
5. Assembly steps, warnings, and limitations.

### Impact assumptions

Only the cut area is measured. Mass uses an assumed 150 g/m² (a mid-weight woven cotton) unless `impact.fabricGsm` is supplied (30–600). Avoided CO2e defaults to 3.5 kg CO2e per kg of finished cotton fabric, the case-study figure in Surinder (2015), *Sustainable supply chain in the textile industry*, TU Wien ([repository](https://repositum.tuwien.at/handle/20.500.12708/4130)). Override it with `impact.kgCo2ePerKg` (0–100). Published water footprints vary by more than an order of magnitude, so water is reported only when `impact.waterLitresPerKg` is supplied. Every response states that the estimate assumes the project replaces buying new fabric.

## Limits

Limits: 2 MiB JSON, source dimensions 12–1600 pixels, at most 48 scraps, at most 2.56 million combined bounding-box mask pixels, scene width 10–300 cm, size multiplier 0.5–1.25, seam allowance 0.4–1.5 cm. Options accept the three supported products and objectives only. Cropped frame-edge scraps and explicitly excluded material are not cut.

Rate limits are per running instance: 90 requests/minute per forwarded client address, 24 POST requests/minute (saves and compute routes; the studio's zero-waste lab sends five), 3 concept renders/minute, two in-flight geometry jobs, and two in-flight renders. These are lightweight instance limits, not a distributed admission queue. Storage operations and geometry have a 25-second deadline with an abort signal. The API does not claim a durable background queue or a global optimization guarantee.

Errors return a status code, a safe message, and a correlation ID, without request content, credentials, or stack traces. Storage absence or failure returns `503` without a saved acknowledgement. Every response carries `Cache-Control: no-store` (except the OpenAPI document), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`. The Azure entry point writes one structured log line per request with correlation ID, route (IDs redacted), status, duration, and error code. Request content and client addresses are never logged.

The server verifies geometry on client-derived masks. It cannot independently verify the source photo, fabric condition, strength, stretch, grain direction, or hidden holes. Users must check measurements and physical fabric before cutting.

## Retry-safe saves

For replay protection, send a UUIDv4 `Idempotency-Key` and a browser-generated 32-byte hex `X-ReThread-Token` on POST. Retain both privately before making the request. The first durable write returns `201`. Replaying the same JSON content and capability returns `200` with `replayed: true`, the same job ID, and the original expiry. Reordered object properties are equivalent. Different input or capabilities return `409`. Conditional Blob creation protects cross-instance races; no distributed in-memory lock is claimed. Lost write responses can be recovered by retrying with the same key.

Receipts include a SHA-256 `inputDigest`, plus the analytics, arrangement, and impact computed at save time. Optional `analysisProvenance` accepts only the pinned SlimSAM model or the color-vision engine; it is client-reported metadata, not independent server proof of inference.

## Local development and demo

```bash
npm run dev     # studio + this API on http://127.0.0.1:4173, receipts in .rethread-data/
npm run demo    # analyze bundled sample photos locally and exercise every route
npm run demo -- --base http://127.0.0.1:4173   # the same against a running server or deployment
```

`npm run dev` serves the Azure handler with a file store that has the same create-only semantics as Blob storage. It is for development only, and the studio's status label still reads "CONNECTED TO AZURE". `npm run demo` writes `plan.json`, `chain.json`, `optimize.json`, `pool.json`, `design-map.png`, `concept.json`, `maker-packet.pdf`, and `saved-packet.pdf` to `demo-output/`. Add `--generate` to request an AI render when `RETHREAD_IMAGE_API_KEY` is set.

Run backend tests from the project root with `npm test`. The test-only memory and file stores never become a production fallback. Image-provider calls are tested against a mocked `fetch`.

Runtime and SDK references: [Azure Functions Node.js developer reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node), [Azure Static Web Apps configuration](https://learn.microsoft.com/en-in/azure/static-web-apps/configuration), and [Azure Blob ContainerClient](https://learn.microsoft.com/en-us/javascript/api/preview-docs/@azure/storage-blob/containerclient?view=az-js-storage-v12).

### Reproduce an applied deep-search layout

An applied deep-search result includes a seed and fixed patch grid. Send them together as `options.searchSeed` (unsigned 32-bit integer) and `options.grid` (`cols` and `rows`, each 1–8) to planning, saving, and packet routes. The server reproduces and independently validates the same cuts; clients do not submit trusted cut coordinates. Changing the product, photograph, or constraints clears this selection in the studio.
