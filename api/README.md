# ReThread geometry API

Node.js 20, Azure Functions host v4 with the Node.js v3 programming model (`function.json`). The single HTTP function runs the same native-pixel geometry engine used in the browser and saves derived cutting reports to private Azure Blob storage. Source photographs are never accepted or stored.

Set `STORAGE_CONNECTION_STRING` as an Azure app setting, using a dedicated storage account. Set `RETHREAD_ALLOWED_ORIGIN` to the exact deployed website origin, without a trailing slash. Never place either setting in frontend JavaScript or commit a connection string. Install dependencies from `api/package.json`; the Azure Blob SDK is loaded only when storage is used.

The `rethread-plans` container is created privately. If an existing container permits public access, jobs fail rather than use it. Production has no in-memory persistence fallback. Configure a storage lifecycle rule to delete blobs under `rethread-plans/` 30 days after creation for physical retention cleanup; the API independently denies access after the stored 30-day expiry.

## Routes

- `GET /api/ready`: actually probes the private Blob container and returns `storageReady: true` only after connectivity and private access checks pass.
- `GET /api/health`: service version, configuration availability, and input limits. Configuration availability is not a storage connectivity test.
- `POST /api/jobs`: server validates derived masks, reruns nesting and product comparisons, commits the report, then returns `201` with `saved: true`, a random job UUID and a one-time 32-byte hex capability token. Partial plans retain `feasible: false`; saving does not turn them into complete designs.
- `GET /api/jobs/{uuid}`: retrieve the saved report using the `X-ReThread-Token` header. No token or token hash is returned.
- `DELETE /api/jobs/{uuid}`: delete the private report with the same header.
- `OPTIONS`: accepts only the configured website origin. No public list endpoint or wildcard CORS exists.

Keep the returned access token privately on the requesting device. It grants retrieval and deletion of that single job; anyone who has it has those capabilities. Server records contain only a SHA-256 token hash. Loss of the capability makes retrieval unavailable.

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

RLE is a flat sequence of `[start, length]` pairs in each bounding box's row-major pixel mask. Only foreground runs are included. Runs must be ordered, disjoint, positive, and in bounds. All masks must also be disjoint in the full source image. Areas and pixels per centimetre are recomputed from the image width and entered scene width; client-supplied area or scale fields are rejected.

Limits: 2 MiB JSON, source dimensions 12–1600 pixels, at most 48 scraps, at most 2.56 million combined bounding-box mask pixels, scene width 10–300 cm, size multiplier 0.5–1.25, seam allowance 0.4–1.5 cm. Options accept the three supported products and objectives only. Cropped frame-edge scraps and explicitly excluded material are not cut.

Rate limits are per running instance: 60 requests/minute per forwarded client address, 10 job submissions/minute, and two in-flight geometry jobs. These are lightweight instance limits, not a distributed admission queue. Storage operations have a 25-second request deadline and abort signal. Synchronous geometry is bounded by input limits; the API does not claim a durable background queue or a global optimization guarantee.

Errors return a status code, safe message, and correlation ID without request content, credentials, or stack traces. Storage absence/failure returns `503` without a saved acknowledgement. Same-origin responses use `Cache-Control: no-store`.

The server verifies geometry on client-derived masks. It cannot independently verify the source photo, fabric condition, strength, stretch, grain direction, or hidden holes. Users must check measurements and physical fabric before cutting.

Run backend tests from the project root: `node --test tests/backend.test.mjs`. The test-only injected memory store never becomes a production fallback.

Runtime and SDK references: [Azure Functions Node.js developer reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node), [Azure Static Web Apps configuration](https://learn.microsoft.com/en-in/azure/static-web-apps/configuration), and [Azure Blob ContainerClient](https://learn.microsoft.com/en-us/javascript/api/preview-docs/@azure/storage-blob/containerclient?view=az-js-storage-v12).

## Retry-safe saves

For replay protection, send a UUIDv4 `Idempotency-Key` and a browser-generated 32-byte hex `X-ReThread-Token` on POST. Retain both privately before making the request. The first durable write returns201; replaying the same JSON content and capability returns200 with `replayed: true`, the same job ID and original expiry. Reordered object properties are equivalent. Different input or capabilities return409. Conditional Blob creation protects cross-instance races; no distributed in-memory lock is claimed. Lost write responses can be recovered by retrying with the same key.

Receipts include a SHA-256 `inputDigest`. Optional `analysisProvenance` accepts only the pinned SlimSAM model or color-vision engine; it is client-reported metadata, not independent server proof of inference. Photographs remain local.
