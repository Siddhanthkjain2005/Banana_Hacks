'use strict';

const ref = name => ({ $ref: `#/components/schemas/${name}` });
const json = schema => ({ content: { 'application/json': { schema } } });
const errors = codes => Object.fromEntries(codes.map(code => [code, { description: { 400: 'Invalid input', 401: 'Missing or invalid capability', 403: 'Read-only capability', 404: 'Not found or expired', 409: 'Conflict', 413: 'Payload too large', 422: 'Request cannot be fulfilled', 429: 'Rate or capacity limit', 502: 'Image provider failure', 503: 'Unavailable or geometry validation failed', 504: 'Image provider timeout' }[code], ...json(ref('Error')) }]));
const jobId = { name: 'jobId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const paper = { name: 'paper', in: 'query', schema: { type: 'string', enum: ['a4', 'letter'], default: 'a4' } };
const pdf = { description: 'Printable maker packet', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } };
const compute = (summary, description, body, response, extra = []) => ({ post: { summary, description, requestBody: { required: true, ...json(body) }, responses: { 200: { description: 'Computed result', ...json(response) }, ...errors([400, 413, 429, 503, ...extra]) } } });

function openApiDocument(version) {
  return {
    openapi: '3.1.0',
    info: { title: 'ReThread geometry API', version,
      description: 'Validates client-derived fabric masks, recomputes calibrated geometry, plans products, chains zero-waste projects, pools donor fabric, renders layout-conditioned concepts, and stores private receipts. Source photographs are never accepted.' },
    servers: [{ url: '/api' }],
    components: {
      securitySchemes: { capability: { type: 'apiKey', in: 'header', name: 'X-ReThread-Token', description: 'Owner (read and delete) or viewer (read-only) capability for one saved job.' } },
      schemas: {
        Error: { type: 'object', required: ['error', 'correlationId'], properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } }, correlationId: { type: 'string', format: 'uuid' } } },
        Image: { type: 'object', required: ['width', 'height', 'sceneWidthCm'], additionalProperties: false, properties: { width: { type: 'integer', minimum: 12, maximum: 1600 }, height: { type: 'integer', minimum: 12, maximum: 1600 }, sceneWidthCm: { type: 'number', minimum: 10, maximum: 300 } } },
        Scrap: { type: 'object', required: ['id', 'color', 'bbox', 'maskRle'], additionalProperties: false, properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' }, label: { type: 'string', maxLength: 80 }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          bbox: { type: 'object', required: ['x', 'y', 'width', 'height'], properties: { x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } } },
          maskRle: { type: 'array', items: { type: 'integer' }, description: 'Ordered [start, length] foreground runs in the bounding box, row-major.' }, usable: { type: 'boolean' } } },
        Options: { type: 'object', additionalProperties: false, properties: { product: { enum: ['tote', 'pouch', 'cushion'] }, objective: { enum: ['balanced', 'waste', 'color'] }, seamAllowanceCm: { type: 'number', minimum: .4, maximum: 1.5 }, size: { type: 'number', minimum: .5, maximum: 1.25 }, rotation: { type: 'boolean' } } },
        Provenance: { type: 'object', description: 'Client-reported analysis engine: color-vision, or the pinned SlimSAM model with its prompt point.' },
        ImpactAssumptions: { type: 'object', additionalProperties: false, properties: { fabricGsm: { type: 'number', minimum: 30, maximum: 600 }, kgCo2ePerKg: { type: 'number', minimum: 0, maximum: 100 }, waterLitresPerKg: { type: 'number', minimum: 0, maximum: 100000 } } },
        Job: { type: 'object', required: ['image', 'scraps'], properties: { image: ref('Image'), scraps: { type: 'array', maxItems: 48, items: ref('Scrap') }, options: ref('Options'), excludedScrapIds: { type: 'array', items: { type: 'string' } }, analysisProvenance: ref('Provenance') } },
        PlanRequest: { allOf: [ref('Job'), { type: 'object', properties: { impact: ref('ImpactAssumptions') } }] },
        ChainRequest: { allOf: [ref('Job'), { type: 'object', properties: { impact: ref('ImpactAssumptions'), chain: { type: 'object', properties: { maxProjects: { type: 'integer', minimum: 1, maximum: 5, default: 3 }, minSize: { type: 'number', minimum: .5, maximum: 1.25, default: .5 } } } } }] },
        ConceptRequest: { allOf: [ref('Job'), { type: 'object', properties: { concept: { type: 'object', properties: { style: { enum: ['studio', 'lifestyle', 'flatlay', 'sketch'] }, generate: { type: 'boolean', default: true } } } } }] },
        PoolRequest: { type: 'object', required: ['sources'], properties: { sources: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'object', required: ['image', 'scraps'], properties: { name: { type: 'string', maxLength: 60 }, image: ref('Image'), scraps: { type: 'array', items: ref('Scrap') }, excludedScrapIds: { type: 'array', items: { type: 'string' } }, analysisProvenance: ref('Provenance') } } }, options: ref('Options'), impact: ref('ImpactAssumptions') } },
        Plan: { type: 'object', description: 'Validated cutting plan from the shared browser/server engine.' },
        PlanResponse: { type: 'object', properties: { plan: ref('Plan'), recommendations: { type: 'array' }, analytics: { type: 'object' }, arrangement: { type: 'object' }, impact: { type: 'object' } } },
        ChainResponse: { type: 'object', properties: { projects: { type: 'array' }, summary: { type: 'object' }, leftovers: { type: 'array' }, validation: { type: 'object' }, impact: { type: 'object' } } },
        PoolResponse: { type: 'object', properties: { plan: ref('Plan'), poolingUnlocks: { type: 'boolean' }, contributions: { type: 'array' }, solo: { type: 'array' }, impact: { type: 'object' } } },
        ConceptResponse: { type: 'object', properties: { prompt: { type: 'string' }, designMap: { type: 'object', properties: { mimeType: { const: 'image/png' }, base64: { type: 'string' } } }, render: { type: 'object', properties: { generated: { type: 'boolean' } } } } },
        SavedJob: { type: 'object', properties: { jobId: { type: 'string', format: 'uuid' }, access: { enum: ['owner', 'viewer'] }, plan: ref('Plan'), createdAt: { type: 'string' }, expiresAt: { type: 'string' } } },
      },
    },
    paths: {
      '/health': { get: { summary: 'Service version, features, limits, and configuration availability', responses: { 200: { description: 'OK', ...json({ type: 'object' }) } } } },
      '/ready': { get: { summary: 'Probe private storage connectivity', responses: { 200: { description: 'Storage ready', ...json({ type: 'object' }) }, ...errors([503]) } } },
      '/openapi.json': { get: { summary: 'This document', responses: { 200: { description: 'OpenAPI 3.1 document', ...json({ type: 'object' }) } } } },
      '/plan': compute('Validate masks and plan a product without saving', 'Returns the validated plan, product comparison, per-scrap analytics, colour-aware patch arrangement, and impact estimate.', ref('PlanRequest'), ref('PlanResponse')),
      '/chain': compute('Zero-waste project chain', 'Plans the requested product, then further complete products from the leftover offcuts.', ref('ChainRequest'), ref('ChainResponse')),
      '/pool': compute('Community fabric pool', 'Plans one product from several donors’ photographs and reports whether pooling unlocks it.', ref('PoolRequest'), ref('PoolResponse')),
      '/concept': compute('Layout-conditioned concept render', 'Rasterizes the validated layout into a design map and prompt; when configured, an image model renders the product from them.', ref('ConceptRequest'), ref('ConceptResponse'), [422, 502, 504]),
      '/packet': { post: { summary: 'Printable PDF maker packet for an unsaved plan', parameters: [paper], requestBody: { required: true, ...json(ref('PlanRequest')) }, responses: { 200: pdf, ...errors([400, 413, 429, 503]) } } },
      '/jobs': { post: { summary: 'Verify and save a private receipt', description: 'Send Idempotency-Key and X-ReThread-Token for retry-safe saves.', requestBody: { required: true, ...json(ref('Job')) }, responses: { 200: { description: 'Replayed save', ...json(ref('SavedJob')) }, 201: { description: 'Saved', ...json(ref('SavedJob')) }, ...errors([400, 409, 413, 429, 503]) } } },
      '/jobs/{jobId}': {
        get: { summary: 'Retrieve a saved receipt', security: [{ capability: [] }], parameters: [jobId], responses: { 200: { description: 'Saved receipt', ...json(ref('SavedJob')) }, ...errors([400, 401, 404, 503]) } },
        delete: { summary: 'Delete a saved receipt (owner only)', security: [{ capability: [] }], parameters: [jobId], responses: { 200: { description: 'Deleted', ...json({ type: 'object' }) }, ...errors([400, 401, 403, 404, 503]) } },
      },
      '/jobs/{jobId}/share': { post: { summary: 'Create a read-only viewer capability (owner only)', security: [{ capability: [] }], parameters: [jobId], responses: { 200: { description: 'Viewer capability', ...json({ type: 'object', properties: { shareToken: { type: 'string' }, access: { const: 'viewer' } } }) }, ...errors([401, 403, 404, 409, 503]) } } },
      '/jobs/{jobId}/packet': { get: { summary: 'Printable PDF maker packet for a saved receipt', security: [{ capability: [] }], parameters: [jobId, paper], responses: { 200: pdf, ...errors([400, 401, 404, 503]) } } },
    },
  };
}

module.exports = { openApiDocument };
