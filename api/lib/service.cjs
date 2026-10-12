'use strict';

const { randomUUID, randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const VERSION = '1.1.0';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_PIXELS = 1600 * 1600;
const CONTAINER = 'rethread-plans';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCRAP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = message => { throw new ApiError(400, 'INVALID_INPUT', message); };
const unavailable = () => new ApiError(503, 'STORAGE_UNAVAILABLE', 'Private job storage is unavailable. No saved job is confirmed.');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hashToken = token => createHash('sha256').update(token).digest('hex');

function header(req, name) {
  const key = Object.keys(req.headers || {}).find(k => k.toLowerCase() === name.toLowerCase());
  const value = key ? req.headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function exactKeys(value, allowed, name) {
  if (!object(value)) bad(`${name} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) bad(`${name} contains an unsupported field.`);
}
function numberInRange(value, low, high, name, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || integer && !Number.isInteger(value) || value < low || value > high) bad(`${name} must be ${integer ? 'an integer' : 'a number'} between ${low} and ${high}.`);
  return value;
}

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

/** Decode untrusted local-bbox RLE and recompute all calibrated measurements. */
function validateJobPayload(payload) {
  exactKeys(payload, ['image', 'scraps', 'options', 'excludedScrapIds', 'analysisProvenance'], 'Job');
  exactKeys(payload.image, ['width', 'height', 'sceneWidthCm'], 'Image metadata');
  const width = numberInRange(payload.image.width, 12, 1600, 'Image width', true);
  const height = numberInRange(payload.image.height, 12, 1600, 'Image height', true);
  const sceneWidthCm = numberInRange(payload.image.sceneWidthCm, 10, 300, 'Scene width');
  const pixelsPerCm = width / sceneWidthCm;
  const analysisProvenance = payload.analysisProvenance || { engine: 'color-vision' };
  exactKeys(analysisProvenance, ['engine', 'modelId', 'revision', 'precision', 'runtime', 'elapsedMs', 'prompt'], 'Analysis provenance');
  if (!['color-vision', 'slimsam'].includes(analysisProvenance.engine)) bad('Unsupported image analysis engine.');
  if (analysisProvenance.engine === 'slimsam') {
    if (analysisProvenance.modelId !== 'Xenova/slimsam-77-uniform' || analysisProvenance.revision !== '5850ab45f587c112167512ffef949107115e26a0' || analysisProvenance.precision !== 'int8' || analysisProvenance.runtime !== 'Transformers.js 2.17.2') bad('Use the pinned SlimSAM model provenance.');
    numberInRange(analysisProvenance.elapsedMs, 0, 90000, 'Neural elapsed time');
    if (!Array.isArray(analysisProvenance.prompt) || analysisProvenance.prompt.length !== 2) bad('Neural provenance needs one source-image prompt point.');
    numberInRange(analysisProvenance.prompt[0], 0, width - 1, 'Prompt x');numberInRange(analysisProvenance.prompt[1], 0, height - 1, 'Prompt y');
  } else if (Object.keys(analysisProvenance).length !== 1) bad('Color vision provenance only contains the engine.');
  if (!Array.isArray(payload.scraps) || payload.scraps.length > 48) bad('Provide at most 48 derived scraps.');
  const rawOptions = payload.options ?? {};
  exactKeys(rawOptions, ['product', 'seamAllowanceCm', 'rotation', 'size', 'objective'], 'Options');
  const product = rawOptions.product ?? 'tote';
  const objective = rawOptions.objective ?? 'balanced';
  if (!['tote', 'pouch', 'cushion'].includes(product)) bad('Product must be tote, pouch, or cushion.');
  if (!['balanced', 'waste', 'color'].includes(objective)) bad('Objective must be balanced, waste, or color.');
  if (rawOptions.rotation !== undefined && typeof rawOptions.rotation !== 'boolean') bad('Rotation must be true or false.');
  const options = { product, objective, rotation: rawOptions.rotation ?? true,
    seamAllowanceCm: numberInRange(rawOptions.seamAllowanceCm ?? .7, .4, 1.5, 'Seam allowance'),
    size: numberInRange(rawOptions.size ?? 1, .5, 1.25, 'Design size multiplier') };
  const excluded = payload.excludedScrapIds ?? [];
  if (!Array.isArray(excluded) || excluded.length > 48 || excluded.some(id => typeof id !== 'string' || !SCRAP_ID_RE.test(id)) || new Set(excluded).size !== excluded.length) bad('Excluded scrap IDs must be a unique list of measured scrap IDs.');
  const excludedSet = new Set(excluded), seenIds = new Set(), occupied = new Uint8Array(width * height);
  let combinedPixels = 0, detectedAreaPx = 0;
  const scraps = payload.scraps.map((s, index) => {
    exactKeys(s, ['id', 'label', 'color', 'bbox', 'maskRle', 'usable'], `Scrap ${index + 1}`);
    if (typeof s.id !== 'string' || !SCRAP_ID_RE.test(s.id) || seenIds.has(s.id)) bad('Scrap IDs must be unique letters, numbers, underscores, or hyphens (1–64 characters).');
    seenIds.add(s.id);
    if (s.label !== undefined && (typeof s.label !== 'string' || s.label.length > 80 || /[\u0000-\u001f]/.test(s.label))) bad('Scrap labels must be text of at most 80 characters without control characters.');
    if (typeof s.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(s.color)) bad('Scrap colors must be six-digit hex colors.');
    if (s.usable !== undefined && typeof s.usable !== 'boolean') bad('Scrap usable must be true or false.');
    exactKeys(s.bbox, ['x', 'y', 'width', 'height'], 'Scrap bounding box');
    const x = numberInRange(s.bbox.x, 0, width - 1, 'Bounding box x', true);
    const y = numberInRange(s.bbox.y, 0, height - 1, 'Bounding box y', true);
    const bw = numberInRange(s.bbox.width, 1, width, 'Bounding box width', true);
    const bh = numberInRange(s.bbox.height, 1, height, 'Bounding box height', true);
    if (x + bw > width || y + bh > height) bad('Every scrap bounding box must stay inside the source image.');
    combinedPixels += bw * bh;
    if (combinedPixels > MAX_PIXELS) bad('Combined decoded mask dimensions must not exceed 2.56 million pixels.');
    if (!Array.isArray(s.maskRle) || !s.maskRle.length || s.maskRle.length % 2 || s.maskRle.length > MAX_PIXELS * 2) bad('Every scrap needs start/length pairs in local-bbox maskRle.');
    const mask = new Uint8Array(bw * bh);
    let previousEnd = 0, areaPx = 0;
    for (let i = 0; i < s.maskRle.length; i += 2) {
      const start = s.maskRle[i], length = s.maskRle[i + 1];
      if (!Number.isInteger(start) || !Number.isInteger(length) || start < previousEnd || start < 0 || length <= 0 || start + length > mask.length) bad('Mask RLE must contain ordered, non-overlapping, in-bounds positive runs.');
      mask.fill(1, start, start + length); previousEnd = start + length; areaPx += length;
      for (let p = start; p < start + length; p++) {
        const sourceIndex = (y + Math.floor(p / bw)) * width + x + p % bw;
        if (occupied[sourceIndex]) bad('Derived scrap masks must not overlap in source-image coordinates.');
        occupied[sourceIndex] = 1;
      }
    }
    detectedAreaPx += areaPx;
    const touchesFrame = x <= 1 || y <= 1 || x + bw >= width - 1 || y + bh >= height - 1;
    return { id: s.id, label: s.label || s.id, color: s.color.toLowerCase(), bbox: { x, y, width: bw, height: bh }, mask,
      usable: s.usable !== false && !excludedSet.has(s.id) && !touchesFrame, pixelsPerCm,
      areaPx, areaCm2: areaPx / pixelsPerCm ** 2, contour: [],
      quality: { touchesBorder: touchesFrame, issues: touchesFrame ? ['Photographed frame edge is excluded from automatic cutting.'] : [] } };
  });
  if (excluded.some(id => !seenIds.has(id))) bad('An excluded scrap ID is absent from the measured scraps.');
  return { image: { width, height, sceneWidthCm, sceneHeightCm: height / pixelsPerCm, pixelsPerCm }, scraps, options, analysisProvenance,
    excludedScrapIds: excluded, metrics: { inputScrapCount: scraps.length, usableScrapCount: scraps.filter(s => s.usable).length,
      excludedScrapCount: scraps.filter(s => !s.usable).length, detectedAreaPx, detectedAreaCm2: detectedAreaPx / pixelsPerCm ** 2 } };
}

async function loadCore() {
  const [vision, recommend] = await Promise.all([
    import(pathToFileURL(path.join(__dirname, '../core/vision.mjs')).href),
    import(pathToFileURL(path.join(__dirname, '../core/recommend.mjs')).href),
  ]);
  return { optimizePattern: vision.optimizePattern, recommendProducts: recommend.recommendProducts };
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
    async ready(signal) { await ensure(signal); const properties=await container.getProperties({ abortSignal: signal }); if(properties.blobPublicAccess)throw unavailable(); return true; },
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
  const { accessTokenHash, ...result } = record;
  return result;
}
function authorized(token, hash) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/i.test(token) || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(hash, 'hex'));
}

function createHandler(configuration = {}) {
  const env = configuration.env || process.env, now = configuration.now || Date.now;
  const injected = Object.prototype.hasOwnProperty.call(configuration, 'storage');
  const configured = injected ? Boolean(configuration.storage) : Boolean(env.STORAGE_CONNECTION_STRING);
  let store = injected ? configuration.storage : null, activeJobs = 0;
  const pendingSaves = new Set();
  const rates = new Map(), coreLoader = configuration.loadCore || loadCore;
  const timeoutMs = configuration.timeoutMs ?? 25000;
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
    if (!bucket || time - bucket.start >= 60000) { bucket = { start: time, all: 0, post: 0 }; rates.set(key, bucket); }
    if (++bucket.all > 60 || method === 'POST' && ++bucket.post > 10) throw new ApiError(429, 'RATE_LIMITED', 'Request limit reached. Try again in a minute.');
  }
  return async function handler(req = {}) {
    const correlationId = randomUUID(), controller = new AbortController();
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Correlation-ID': correlationId };
    const respond = (status, value, extra = {}) => ({ status, headers: { ...headers, ...extra }, body: typeof value === 'string' ? value : JSON.stringify({ ...value, correlationId }) });
    let timer;
    const deadline = operation => Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ApiError(503, 'OPERATION_TIMEOUT', 'The service timed out. No saved job is confirmed; retry when it is available.')); }, timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    try {
      const method = String(req.method || 'GET').toUpperCase();
      rateLimit(req, method);
      const requestURL = new URL(req.url || 'http://localhost/api/health', 'http://localhost');
      const origin = header(req, 'origin'), allowedOrigin = env.RETHREAD_ALLOWED_ORIGIN || requestURL.origin;
      if (origin && origin !== allowedOrigin) throw new ApiError(400, 'ORIGIN_NOT_ALLOWED', 'This endpoint accepts same-origin browser requests only.');
      if (origin) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; }
      if (method === 'OPTIONS') {
        const extra = origin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-ReThread-Token, Idempotency-Key', 'Access-Control-Max-Age': '600' } : {};
        return respond(204, '', extra);
      }
      let route = typeof req.params?.path === 'string' ? req.params.path : requestURL.pathname.replace(/^\/api(?:\/|$)/, '');
      route = route.replace(/^\/+|\/+$/g, '');
      if (route === 'ready' && method === 'GET') {
        const storage = getStore();
        try { if (typeof storage.ready !== 'function' || !await deadline(storage.ready(controller.signal))) throw unavailable(); } catch(error) { if(error instanceof ApiError) throw error; throw unavailable(); }
        return respond(200, { status:'ready',service:'rethread-geometry',version:VERSION,storageReady:true,checkedAt:new Date(now()).toISOString() });
      }
      if (route === 'health' && method === 'GET') return respond(200, { status: 'ok', service: 'rethread-geometry', version: VERSION, storageConfigured: configured,
        persistence: 'private Azure Blob storage', retentionDays: 30, limits: { maxRequestBytes: MAX_BODY_BYTES, maxSourceDimension: 1600, maxCombinedMaskPixels: MAX_PIXELS, maxScraps: 48, concurrentJobsPerInstance: 2 } });
      if (route === 'jobs' && method === 'POST') {
        const payload = parseBody(req), measured = validateJobPayload(payload);
        const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k,canonical(value[k])])) : value;
        const inputDigest = createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
        const idempotencyKey = header(req, 'idempotency-key'), suppliedToken = header(req, 'x-rethread-token');
        if (idempotencyKey !== undefined && (!ID_RE.test(idempotencyKey) || typeof suppliedToken !== 'string' || !/^[0-9a-f]{64}$/i.test(suppliedToken))) bad('Retry-safe saves need a UUID Idempotency-Key and a 32-byte X-ReThread-Token.');
        const saveKey = idempotencyKey?.toLowerCase();
        if (saveKey && pendingSaves.has(saveKey)) throw new ApiError(429,'SAVE_IN_PROGRESS','This save is still being verified. Retry the same request shortly.');
        const storage = getStore();
        if (activeJobs >= 2) throw new ApiError(429, 'JOB_CAPACITY_REACHED', 'Two geometry jobs are already running on this instance. Try again shortly.');
        activeJobs++;
        if(saveKey)pendingSaves.add(saveKey);
        try {
          const operationStarted = Date.now();
          const checkDeadline = () => {
            if (controller.signal.aborted || Date.now() - operationStarted >= timeoutMs) {
              controller.abort();
              throw new ApiError(503, 'OPERATION_TIMEOUT', 'The geometry job timed out. No saved job is confirmed.');
            }
          };
          const result = await deadline((async () => {
            const replay = record => {
              if (!authorized(suppliedToken,record.accessTokenHash) || record.inputDigest !== inputDigest) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','The save key cannot be used with different settings or a different private key.');
              if(now() >= Date.parse(record.expiresAt))throw new ApiError(404,'JOB_EXPIRED','This saved job has expired. Start a new save.');
              return {...safeRecord(record),accessToken:suppliedToken,saved:true,replayed:true};
            };
            if(saveKey){let previous;try{previous=await storage.get(saveKey,controller.signal);}catch{throw unavailable();}if(previous)return replay(previous);}
            const core = await coreLoader();
            checkDeadline();
            const plan = core.optimizePattern(measured.scraps, measured.options);
            if (!plan.validated) throw new ApiError(503, 'GEOMETRY_VALIDATION_FAILED', 'The cutting geometry failed validation. No saved job is confirmed.');
            checkDeadline();
            const recommendations = core.recommendProducts(measured.scraps, measured.options).map(({ product, feasible, utilization, completionRatio, reason, score, stats }) => ({ product, feasible, utilization, completionRatio, reason, score, stats }));
            checkDeadline();
            const createdTime = now(), jobId = saveKey || randomUUID(), accessToken = saveKey ? suppliedToken : randomBytes(32).toString('hex'), createdAt = new Date(createdTime).toISOString(), expiresAt = new Date(createdTime + RETENTION_MS).toISOString();
            const record = { format: 'rethread-private-job', version: VERSION, jobId, createdAt, expiresAt, accessTokenHash: hashToken(accessToken),
              image: measured.image, options: measured.options, excludedScrapIds: measured.excludedScrapIds, metrics: measured.metrics, inputDigest, analysisProvenance: measured.analysisProvenance,
              scraps: measured.scraps.map(({ mask, usableMask, ...s }) => s), plan, recommendations,
              verification: { source: 'Client-derived masks; source photographs are not uploaded.', geometry: 'Server recomputed calibrated area, conservative mask containment, and cut non-overlap.',
                limitations: ['A mask cannot independently verify its source photograph; model provenance is client reported.', 'Physical condition, grain, stretch, and strength need manual inspection.', 'Nesting is a validated heuristic, not a guarantee of the best possible layout.'] } };
            try { await storage.put(jobId, record, controller.signal); } catch(error) {
              if(saveKey && [409,412].includes(error.statusCode)){let existing;try{existing=await storage.get(saveKey,controller.signal);}catch{throw unavailable();}if(existing)return replay(existing);}
              throw unavailable();
            }
            checkDeadline();
            return { ...safeRecord(record), accessToken, saved: true };
          })());
          return respond(result.replayed ? 200 : 201, result);
        } finally { activeJobs--; if(saveKey)pendingSaves.delete(saveKey); }
      }
      const match = /^jobs\/([^/]+)$/.exec(route);
      if (match && (method === 'GET' || method === 'DELETE')) {
        if (!ID_RE.test(match[1])) throw new ApiError(400, 'INVALID_JOB_ID', 'Provide a valid ReThread job UUID.');
        const token = header(req, 'x-rethread-token');
        if (typeof token !== 'string' || !/^[0-9a-f]{64}$/i.test(token)) throw new ApiError(401, 'TOKEN_REQUIRED', 'A valid X-ReThread-Token capability is required.');
        const storage = getStore(), jobId = match[1].toLowerCase();
        const result = await deadline((async () => {
          let record;
          try { record = await storage.get(jobId, controller.signal); } catch { throw unavailable(); }
          if (!record) throw new ApiError(404, 'JOB_NOT_FOUND', 'The saved job was not found.');
          if (!authorized(token, record.accessTokenHash)) throw new ApiError(401, 'INVALID_TOKEN', 'The saved-job capability is invalid.');
          if (!Number.isFinite(Date.parse(record.expiresAt)) || now() >= Date.parse(record.expiresAt)) throw new ApiError(404, 'JOB_EXPIRED', 'This saved job has expired.');
          if (method === 'DELETE') {
            try { await storage.delete(jobId, controller.signal); } catch { throw unavailable(); }
            return { jobId, deleted: true };
          }
          return { ...safeRecord(record), saved: true };
        })());
        return respond(200, result);
      }
      throw new ApiError(404, 'NOT_FOUND', 'This API route does not exist.');
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      return respond(status, { error: { code: error instanceof ApiError ? error.code : 'SERVICE_UNAVAILABLE', message: error instanceof ApiError ? error.message : 'The service is temporarily unavailable. No saved job is confirmed.' } }, status === 429 ? { 'Retry-After': '60' } : {});
    } finally { clearTimeout(timer); }
  };
}

module.exports = { createHandler, validateJobPayload, createBlobStore, ApiError, constants: { MAX_BODY_BYTES, MAX_PIXELS, CONTAINER, RETENTION_MS } };
