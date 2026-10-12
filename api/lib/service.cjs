'use strict';

const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { ApiError, bad, object, hashToken, deriveShareToken, header, tokenMatches, TOKEN_RE } = require('./http.cjs');
const { validateJobPayload, validatePoolPayload, validateImpactOptions, validateConceptOptions, validateChainOptions, constants: limits } = require('./validate.cjs');
const { planAnalytics, arrangePatches } = require('./analytics.cjs');
const { estimateImpact } = require('./impact.cjs');
const { planChain } = require('./chain.cjs');
const { planPool } = require('./pool.cjs');
const { renderDesignMap, conceptPrompt } = require('./design-map.cjs');
const { createImageGenerator } = require('./imagegen.cjs');
const { buildPacket } = require('./packet.cjs');
const { openApiDocument } = require('./openapi.cjs');

const VERSION = '1.2.0';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_PIXELS = limits.MAX_PIXELS;
const CONTAINER = 'rethread-plans';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATE = { all: 60, post: 10, render: 3 };
const FEATURES = ['jobs', 'share-links', 'plan', 'chain', 'pool', 'concept', 'packet', 'openapi'];
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' };

const unavailable = () => new ApiError(503, 'STORAGE_UNAVAILABLE', 'Private job storage is unavailable. No saved job is confirmed.');
const geometryFailed = () => new ApiError(503, 'GEOMETRY_VALIDATION_FAILED', 'The cutting geometry failed validation. No result is confirmed.');
const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
const trimRecommendations = list => list.map(({ product, feasible, utilization, completionRatio, reason, score, stats }) => ({ product, feasible, utilization, completionRatio, reason, score, stats }));
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;

function parseBody(req) {
  const length = Number(header(req, 'content-length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Derived-mask requests must be at most 2 MiB.');
  const type = header(req, 'content-type');
  if (type && !/^application\/json(?:\s*;|$)/i.test(type)) bad('Use application/json for derived-mask jobs.');
  let raw;
  try {
    raw = typeof req.rawBody === 'string' ? req.rawBody
      : Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8')
        : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  } catch { bad('Request body is not valid JSON.'); }
  if (raw && Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Derived-mask requests must be at most 2 MiB.');
  if (!raw || !raw.trim()) bad('Provide a JSON request body.');
  try { return JSON.parse(raw); } catch { bad('Request body is not valid JSON.'); }
}

async function loadCore() {
  const [vision, recommend] = await Promise.all([
    import(pathToFileURL(path.join(__dirname, '../core/vision.mjs')).href),
    import(pathToFileURL(path.join(__dirname, '../core/recommend.mjs')).href),
  ]);
  return { optimizePattern: vision.optimizePattern, recommendProducts: recommend.recommendProducts, isPieceContained: vision.isPieceContained };
}

/** Private production storage. There is deliberately no in-memory fallback. */
function createBlobStore(connectionString) {
  const { BlobServiceClient } = require('@azure/storage-blob');
  const service = BlobServiceClient.fromConnectionString(connectionString, { retryOptions: { maxTries: 2, tryTimeoutInMs: 8000 } });
  const container = service.getContainerClient(CONTAINER);
  let ready;
  async function ensure(signal) {
    if (!ready) ready = (async () => {
      await container.createIfNotExists({ abortSignal: signal });
      const properties = await container.getProperties({ abortSignal: signal });
      if (properties.blobPublicAccess) throw new Error('Job container must be private.');
    })().catch(error => { ready = undefined; throw error; });
    await ready;
  }
  return {
    async ready(signal) { await ensure(signal); const properties = await container.getProperties({ abortSignal: signal }); if (properties.blobPublicAccess) throw unavailable(); return true; },
    async put(id, record, signal) {
      await ensure(signal);
      const bytes = Buffer.from(JSON.stringify(record), 'utf8');
      if (bytes.length > MAX_BODY_BYTES) throw new Error('Saved record exceeds the storage size limit.');
      await container.getBlockBlobClient(`${id}.json`).uploadData(bytes, {
        abortSignal: signal, conditions: { ifNoneMatch: '*' },
        blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8', blobCacheControl: 'no-store' },
        metadata: { format: 'rethread-job-v1', expiresat: record.expiresAt },
      });
    },
    async get(id, signal) {
      await ensure(signal);
      try {
        const bytes = await container.getBlobClient(`${id}.json`).downloadToBuffer(0, undefined, { abortSignal: signal, maxRetryRequests: 1 });
        if (bytes.length > MAX_BODY_BYTES) throw new Error('Saved record exceeds the storage size limit.');
        return JSON.parse(bytes.toString('utf8'));
      } catch (error) { if (error.statusCode === 404) return null; throw error; }
    },
    async delete(id, signal) {
      await ensure(signal);
      return container.getBlobClient(`${id}.json`).deleteIfExists({ abortSignal: signal });
    },
  };
}

function safeRecord(record) {
  const { accessTokenHash, shareTokenHash, ...result } = record;
  return result;
}

/**
 * Optional enrichments never block a save: analytics, arrangement, and impact
 * are derived from the already-validated plan and are omitted if they fail.
 */
function enrich(plan, scraps, impactOptions = {}) {
  try {
    return { analytics: planAnalytics(plan, scraps), arrangement: arrangePatches(plan), impact: estimateImpact(plan.stats.usedAreaCm2, impactOptions) };
  } catch {
    return { analytics: null, arrangement: null, impact: null };
  }
}

const verificationNote = { source: 'Client-derived masks; source photographs are not uploaded.', geometry: 'Server recomputed calibrated area, conservative mask containment, and cut non-overlap.',
  limitations: ['A mask cannot independently verify its source photograph; model provenance is client reported.', 'Physical condition, grain, stretch, and strength need manual inspection.', 'Nesting is a validated heuristic, not a guarantee of the best possible layout.'] };

function createHandler(configuration = {}) {
  const env = configuration.env || process.env, now = configuration.now || Date.now;
  const injected = Object.prototype.hasOwnProperty.call(configuration, 'storage');
  const configured = injected ? Boolean(configuration.storage) : Boolean(env.STORAGE_CONNECTION_STRING);
  let store = injected ? configuration.storage : null, activeJobs = 0, activeRenders = 0;
  const pendingSaves = new Set();
  const rates = new Map(), coreLoader = configuration.loadCore || loadCore;
  const timeoutMs = configuration.timeoutMs ?? 25000;
  const images = configuration.imageGenerator || createImageGenerator({ env, fetch: configuration.fetch, timeoutMs: configuration.imageTimeoutMs });
  const logger = typeof configuration.logger === 'function' ? configuration.logger : null;
  const getStore = () => {
    if (!configured) throw unavailable();
    if (!store) { try { store = createBlobStore(env.STORAGE_CONNECTION_STRING); } catch { throw unavailable(); } }
    return store;
  };
  function rateLimit(req, method) {
    const key = String(header(req, 'x-forwarded-for') || req.ip || 'unknown').split(',')[0].trim().slice(0, 128), time = now();
    if (rates.size > 2048) for (const [ip, value] of rates) if (time - value.start >= 60000) rates.delete(ip);
    if (rates.size > 4096 && !rates.has(key)) throw new ApiError(429, 'RATE_LIMITED', 'The service is busy. Try again in a minute.');
    let bucket = rates.get(key);
    if (!bucket || time - bucket.start >= 60000) { bucket = { start: time, all: 0, post: 0, render: 0 }; rates.set(key, bucket); }
    if (++bucket.all > RATE.all || method === 'POST' && ++bucket.post > RATE.post) throw new ApiError(429, 'RATE_LIMITED', 'Request limit reached. Try again in a minute.');
    return bucket;
  }

  return async function handler(req = {}, invocation = undefined) {
    const correlationId = randomUUID(), controller = new AbortController(), started = Date.now();
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, 'X-Correlation-ID': correlationId };
    const respond = (status, value, extra = {}) => ({ status, headers: { ...headers, ...extra }, body: typeof value === 'string' ? value : JSON.stringify({ ...value, correlationId }) });
    const binary = (body, contentType, filename) => ({ status: 200, isRaw: true, body, headers: { ...headers, 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${filename}"`, 'Content-Length': String(body.length) } });
    let timer, method = 'GET', route = '', response;
    const deadline = operation => Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ApiError(503, 'OPERATION_TIMEOUT', 'The service timed out. No saved job is confirmed; retry when it is available.')); }, timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    const checkDeadline = () => {
      if (controller.signal.aborted || Date.now() - started >= timeoutMs) {
        controller.abort();
        throw new ApiError(503, 'OPERATION_TIMEOUT', 'The geometry job timed out. No result is confirmed.');
      }
    };
    /** Bounded synchronous geometry: shares the per-instance two-job capacity with saves. */
    const compute = async work => {
      if (activeJobs >= 2) throw new ApiError(429, 'JOB_CAPACITY_REACHED', 'Two geometry jobs are already running on this instance. Try again shortly.');
      activeJobs++;
      try { return await deadline((async () => { const core = await coreLoader(); checkDeadline(); return work(core); })()); } finally { activeJobs--; }
    };
    const loadRecord = async (jobId, token) => {
      if (!ID_RE.test(jobId)) throw new ApiError(400, 'INVALID_JOB_ID', 'Provide a valid ReThread job UUID.');
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new ApiError(401, 'TOKEN_REQUIRED', 'A valid X-ReThread-Token capability is required.');
      const storage = getStore();
      let record;
      try { record = await deadline(storage.get(jobId.toLowerCase(), controller.signal)); } catch (error) { if (error instanceof ApiError) throw error; throw unavailable(); }
      if (!record) throw new ApiError(404, 'JOB_NOT_FOUND', 'The saved job was not found.');
      const access = tokenMatches(token, record.accessTokenHash) ? 'owner' : record.shareTokenHash && tokenMatches(token, record.shareTokenHash) ? 'viewer' : null;
      if (!access) throw new ApiError(401, 'INVALID_TOKEN', 'The saved-job capability is invalid.');
      if (!Number.isFinite(Date.parse(record.expiresAt)) || now() >= Date.parse(record.expiresAt)) throw new ApiError(404, 'JOB_EXPIRED', 'This saved job has expired.');
      return { record, access, storage, jobId: jobId.toLowerCase() };
    };

    const routes = {
      'GET ready': async () => {
        const storage = getStore();
        try { if (typeof storage.ready !== 'function' || !await deadline(storage.ready(controller.signal))) throw unavailable(); } catch (error) { if (error instanceof ApiError) throw error; throw unavailable(); }
        return respond(200, { status: 'ready', service: 'rethread-geometry', version: VERSION, storageReady: true, checkedAt: new Date(now()).toISOString() });
      },
      'GET health': async () => respond(200, { status: 'ok', service: 'rethread-geometry', version: VERSION, storageConfigured: configured,
        persistence: 'private Azure Blob storage', retentionDays: 30, features: FEATURES, imageGeneration: images.describe(),
        limits: { maxRequestBytes: MAX_BODY_BYTES, maxSourceDimension: 1600, maxCombinedMaskPixels: MAX_PIXELS, maxScraps: limits.MAX_SCRAPS, maxPoolSources: limits.MAX_POOL_SOURCES, concurrentJobsPerInstance: 2, requestsPerMinute: RATE.all, computePostsPerMinute: RATE.post, rendersPerMinute: RATE.render } }),
      'GET openapi.json': async () => respond(200, openApiDocument(VERSION), { 'Cache-Control': 'public, max-age=300' }),

      'POST jobs': async () => {
        const payload = parseBody(req), measured = validateJobPayload(payload);
        const inputDigest = createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
        const idempotencyKey = header(req, 'idempotency-key'), suppliedToken = header(req, 'x-rethread-token');
        if (idempotencyKey !== undefined && (!ID_RE.test(idempotencyKey) || typeof suppliedToken !== 'string' || !TOKEN_RE.test(suppliedToken))) bad('Retry-safe saves need a UUID Idempotency-Key and a 32-byte X-ReThread-Token.');
        const saveKey = idempotencyKey?.toLowerCase();
        if (saveKey && pendingSaves.has(saveKey)) throw new ApiError(429, 'SAVE_IN_PROGRESS', 'This save is still being verified. Retry the same request shortly.');
        const storage = getStore();
        if (activeJobs >= 2) throw new ApiError(429, 'JOB_CAPACITY_REACHED', 'Two geometry jobs are already running on this instance. Try again shortly.');
        activeJobs++;
        if (saveKey) pendingSaves.add(saveKey);
        try {
          const result = await deadline((async () => {
            const replay = record => {
              if (!tokenMatches(suppliedToken, record.accessTokenHash) || record.inputDigest !== inputDigest) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'The save key cannot be used with different settings or a different private key.');
              if (now() >= Date.parse(record.expiresAt)) throw new ApiError(404, 'JOB_EXPIRED', 'This saved job has expired. Start a new save.');
              return { ...safeRecord(record), accessToken: suppliedToken, saved: true, replayed: true };
            };
            if (saveKey) { let previous; try { previous = await storage.get(saveKey, controller.signal); } catch { throw unavailable(); } if (previous) return replay(previous); }
            const core = await coreLoader();
            checkDeadline();
            const plan = core.optimizePattern(measured.scraps, measured.options);
            if (!plan.validated) throw new ApiError(503, 'GEOMETRY_VALIDATION_FAILED', 'The cutting geometry failed validation. No saved job is confirmed.');
            checkDeadline();
            const recommendations = trimRecommendations(core.recommendProducts(measured.scraps, measured.options));
            checkDeadline();
            const extras = enrich(plan, measured.scraps);
            const createdTime = now(), jobId = saveKey || randomUUID(), accessToken = saveKey ? suppliedToken : randomBytes(32).toString('hex'), createdAt = new Date(createdTime).toISOString(), expiresAt = new Date(createdTime + RETENTION_MS).toISOString();
            const record = { format: 'rethread-private-job', version: VERSION, jobId, createdAt, expiresAt, accessTokenHash: hashToken(accessToken), shareTokenHash: hashToken(deriveShareToken(accessToken)),
              image: measured.image, options: measured.options, excludedScrapIds: measured.excludedScrapIds, metrics: measured.metrics, inputDigest, analysisProvenance: measured.analysisProvenance,
              scraps: measured.scraps.map(({ mask, usableMask, ...s }) => s), plan, recommendations, ...extras, verification: verificationNote };
            try { await storage.put(jobId, record, controller.signal); } catch (error) {
              if (saveKey && [409, 412].includes(error.statusCode)) { let existing; try { existing = await storage.get(saveKey, controller.signal); } catch { throw unavailable(); } if (existing) return replay(existing); }
              throw unavailable();
            }
            checkDeadline();
            return { ...safeRecord(record), accessToken, saved: true };
          })());
          return respond(result.replayed ? 200 : 201, result);
        } finally { activeJobs--; if (saveKey) pendingSaves.delete(saveKey); }
      },
      'GET jobs/:id': async id => {
        const { record, access } = await loadRecord(id, header(req, 'x-rethread-token'));
        return respond(200, { ...safeRecord(record), access, saved: true });
      },
      'DELETE jobs/:id': async id => {
        const { record, access, storage, jobId } = await loadRecord(id, header(req, 'x-rethread-token'));
        if (access !== 'owner') throw new ApiError(403, 'READ_ONLY_TOKEN', 'A shared viewer capability cannot delete this saved job.');
        try { await deadline(storage.delete(jobId, controller.signal)); } catch (error) { if (error instanceof ApiError) throw error; throw unavailable(); }
        return respond(200, { jobId: record.jobId, deleted: true });
      },
      'POST jobs/:id/share': async id => {
        const token = header(req, 'x-rethread-token'), { record, access } = await loadRecord(id, token);
        if (access !== 'owner') throw new ApiError(403, 'READ_ONLY_TOKEN', 'Only the owner capability can create share links.');
        if (!record.shareTokenHash) throw new ApiError(409, 'SHARING_UNAVAILABLE', 'This receipt was saved before share links were available. Save the plan again to share it.');
        return respond(200, { jobId: record.jobId, shareToken: deriveShareToken(token), access: 'viewer', expiresAt: record.expiresAt,
          usage: 'Send this value as X-ReThread-Token to GET the receipt or its packet. It cannot delete the receipt.' });
      },
      'GET jobs/:id/packet': async id => {
        const { record } = await loadRecord(id, header(req, 'x-rethread-token'));
        const provenance = record.analysisProvenance?.engine === 'slimsam' ? 'Boundary reviewed with the pinned SlimSAM model in the browser (client-reported provenance).' : null;
        const { pdf } = buildPacket({ plan: record.plan, scraps: record.scraps, arrangement: record.arrangement || null, analytics: record.analytics || null, impact: record.impact || null,
          paper: paperOf(), meta: { jobId: record.jobId, inputDigest: record.inputDigest, provenance } });
        return binary(pdf, 'application/pdf', 'rethread-maker-packet.pdf');
      },

      'POST plan': async () => {
        const payload = parseBody(req), measured = validateJobPayload(payload, ['impact']), impactOptions = validateImpactOptions(payload.impact);
        return respond(200, await compute(core => {
          const plan = core.optimizePattern(measured.scraps, measured.options);
          if (!plan.validated) throw geometryFailed();
          checkDeadline();
          const recommendations = trimRecommendations(core.recommendProducts(measured.scraps, measured.options));
          checkDeadline();
          return { service: 'rethread-geometry', version: VERSION, image: measured.image, metrics: measured.metrics, options: measured.options, analysisProvenance: measured.analysisProvenance,
            plan, recommendations, analytics: planAnalytics(plan, measured.scraps), arrangement: arrangePatches(plan), impact: estimateImpact(plan.stats.usedAreaCm2, impactOptions), verification: verificationNote };
        }));
      },
      'POST chain': async () => {
        const payload = parseBody(req), measured = validateJobPayload(payload, ['impact', 'chain']);
        const impactOptions = validateImpactOptions(payload.impact), chainOptions = validateChainOptions(payload.chain);
        return respond(200, await compute(core => {
          const chain = planChain(measured, core, chainOptions, checkDeadline);
          if (!chain.validation.validated) throw geometryFailed();
          return { service: 'rethread-geometry', version: VERSION, image: measured.image, options: measured.options, chainOptions, ...chain, impact: estimateImpact(chain.summary.usedAreaCm2, impactOptions) };
        }));
      },
      'POST pool': async () => {
        const pool = validatePoolPayload(parseBody(req));
        return respond(200, await compute(core => {
          const result = planPool(pool, core, checkDeadline);
          if (!result.plan.validated) throw geometryFailed();
          checkDeadline();
          const recommendations = trimRecommendations(core.recommendProducts(pool.scraps, pool.options));
          return { service: 'rethread-geometry', version: VERSION, options: pool.options,
            donors: pool.donors.map(({ donorId, name, image, metrics, analysisProvenance }) => ({ donorId, name, image, metrics, analysisProvenance })),
            ...result, recommendations, analytics: planAnalytics(result.plan, pool.scraps), arrangement: arrangePatches(result.plan), impact: estimateImpact(result.plan.stats.usedAreaCm2, pool.impact) };
        }));
      },
      'POST packet': async () => {
        const payload = parseBody(req), measured = validateJobPayload(payload, ['impact']), impactOptions = validateImpactOptions(payload.impact), paper = paperOf();
        const { pdf } = await compute(core => {
          const plan = core.optimizePattern(measured.scraps, measured.options);
          if (!plan.validated) throw geometryFailed();
          checkDeadline();
          return buildPacket({ plan, scraps: measured.scraps, paper, ...enrich(plan, measured.scraps, impactOptions),
            meta: { provenance: measured.analysisProvenance.engine === 'slimsam' ? 'Boundary reviewed with the pinned SlimSAM model in the browser (client-reported provenance).' : null } });
        });
        return binary(pdf, 'application/pdf', 'rethread-maker-packet.pdf');
      },
      'POST concept': async () => {
        const payload = parseBody(req), measured = validateJobPayload(payload, ['concept']), concept = validateConceptOptions(payload.concept);
        const prepared = await compute(core => {
          const plan = core.optimizePattern(measured.scraps, measured.options);
          if (!plan.validated) throw geometryFailed();
          if (!plan.pieces.length) throw new ApiError(422, 'NO_PLACED_CUTS', 'No cuts fit this fabric, so there is no layout to render.');
          const arrangement = arrangePatches(plan), map = renderDesignMap(plan, arrangement);
          return { plan, arrangement, map, prompt: conceptPrompt(plan, arrangement, concept.style) };
        });
        let render = { generated: false, reason: concept.generate ? 'Image generation is not configured on this deployment; the design map and prompt are returned.' : 'Generation was not requested.' };
        if (concept.generate && images.configured) {
          if (++bucket.render > RATE.render) throw new ApiError(429, 'RATE_LIMITED', 'Concept render limit reached. Try again in a minute.');
          if (activeRenders >= 2) throw new ApiError(429, 'RENDER_CAPACITY_REACHED', 'Two concept renders are already running on this instance. Try again shortly.');
          activeRenders++;
          try { render = { generated: true, ...await images.generate({ prompt: prepared.prompt, referencePng: prepared.map.png, signal: controller.signal }) }; } finally { activeRenders--; }
        }
        const { plan, arrangement, map, prompt } = prepared;
        return respond(200, { service: 'rethread-geometry', version: VERSION, style: concept.style,
          plan: { product: plan.product, title: plan.title, feasible: plan.feasible, validated: plan.validated, grid: plan.grid, dimensions: plan.dimensions, stats: plan.stats },
          arrangement, prompt, designMap: { mimeType: 'image/png', width: map.width, height: map.height, base64: map.png.toString('base64') }, render,
          privacy: { sentToImageProvider: render.generated ? ['server-rendered design map', 'prompt text'] : [], neverSent: ['source photographs', 'scrap masks'] },
          disclosure: 'AI concept render conditioned on the validated layout. It illustrates the design; it is not a photograph of a sewn product.' });
      },
    };
    const paperOf = () => {
      const value = new URL(req.url || 'http://localhost', 'http://localhost').searchParams.get('paper') || 'a4';
      if (!['a4', 'letter'].includes(value)) bad('Paper must be a4 or letter.');
      return value;
    };
    let bucket;

    try {
      method = String(req.method || 'GET').toUpperCase();
      bucket = rateLimit(req, method);
      const requestURL = new URL(req.url || 'http://localhost/api/health', 'http://localhost');
      const origin = header(req, 'origin'), allowedOrigin = env.RETHREAD_ALLOWED_ORIGIN || requestURL.origin;
      if (origin && origin !== allowedOrigin) throw new ApiError(400, 'ORIGIN_NOT_ALLOWED', 'This endpoint accepts same-origin browser requests only.');
      if (origin) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; }
      if (method === 'OPTIONS') {
        const extra = origin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-ReThread-Token, Idempotency-Key', 'Access-Control-Max-Age': '600' } : {};
        return (response = respond(204, '', extra));
      }
      route = typeof req.params?.path === 'string' ? req.params.path : requestURL.pathname.replace(/^\/api(?:\/|$)/, '');
      route = route.replace(/^\/+|\/+$/g, '');
      const segments = route.split('/'), id = segments[0] === 'jobs' && segments.length > 1 ? segments[1] : undefined;
      const pattern = id === undefined ? route : ['jobs', ':id', ...segments.slice(2)].join('/');
      const action = routes[`${method} ${pattern}`];
      if (!action) throw new ApiError(404, 'NOT_FOUND', 'This API route does not exist.');
      return (response = await action(id));
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      return (response = respond(status, { error: { code: error instanceof ApiError ? error.code : 'SERVICE_UNAVAILABLE', message: error instanceof ApiError ? error.message : 'The service is temporarily unavailable. No saved job is confirmed.' } }, status === 429 ? { 'Retry-After': '60' } : {}));
    } finally {
      clearTimeout(timer);
      if (logger && response) {
        let code;
        try { code = response.status >= 400 ? JSON.parse(response.body).error?.code : undefined; } catch { /* binary or empty body */ }
        try { logger({ correlationId, method, route: route.replace(/[0-9a-f-]{36}/i, ':id'), status: response.status, durationMs: Date.now() - started, ...(code ? { code } : {}) }, invocation); } catch { /* logging never fails a request */ }
      }
    }
  };
}

module.exports = { createHandler, validateJobPayload: payload => validateJobPayload(payload), createBlobStore, ApiError,
  constants: { MAX_BODY_BYTES, MAX_PIXELS, CONTAINER, RETENTION_MS, VERSION } };
