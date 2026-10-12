import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { createHandler, validateJobPayload, constants } = require('../api/lib/service.cjs');

function payload() {
  return { image: { width: 300, height: 220, sceneWidthCm: 60 },
    scraps: [10, 110, 210].map((x, i) => ({ id: `scrap-${i + 1}`, label: `Measured ${i + 1}`, color: '#75835c',
      bbox: { x, y: 10, width: 85, height: 190 }, maskRle: [0, 85 * 190], usable: true })),
    options: { product: 'pouch', objective: 'waste', seamAllowanceCm: .7, rotation: true, size: 1 } };
}
class MemoryStore {
  records = new Map();
  async put(id, value) { this.records.set(id, structuredClone(value)); }
  async get(id) { return structuredClone(this.records.get(id) || null); }
  async delete(id) { return this.records.delete(id); }
}
const request = (method, route, body, token, extra = {}) => ({ method, url: `https://rethread.test/api/${route}`,
  headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.1', ...(token ? { 'X-ReThread-Token': token } : {}), ...(extra.headers || {}) },
  ...(body !== undefined ? { body } : {}), ...extra });
const json = response => JSON.parse(response.body);

test('production core files are byte-identical to the actual browser engine', async () => {
  for (const [source, copy] of [['vision.js', 'vision.mjs'], ['recommend.js', 'recommend.mjs'], ['vision.js', 'vision.js']]) {
    const [a, b] = await Promise.all([readFile(new URL(`../dist/${source}`, import.meta.url)), readFile(new URL(`../api/core/${copy}`, import.meta.url))]);
    assert.equal(Buffer.compare(a, b), 0);
  }
});

test('server recomputes calibration, decoded area, exclusions and conservative valid cutting geometry', async () => {
  const p = payload(), measured = validateJobPayload(p);
  assert.equal(measured.image.pixelsPerCm, 5);
  assert.equal(measured.scraps[0].areaPx, 85 * 190);
  assert.equal(measured.scraps[0].areaCm2, 646);
  p.excludedScrapIds = ['scrap-3'];
  const store = new MemoryStore(), handler = createHandler({ storage: store });
  const response = await handler(request('POST', 'jobs', p)), result = json(response);
  assert.equal(response.status, 201);
  assert.equal(result.saved, true);
  assert.equal(result.plan.feasible, true);
  assert.equal(result.plan.validated, true);
  assert.equal(result.plan.stats.availableAreaCm2, 1248.32);
  assert.ok(result.plan.pieces.every(cut => cut.scrapId !== 'scrap-3'));
  assert.equal(result.metrics.excludedScrapCount, 1);
  assert.equal(result.recommendations.length, 3);
  assert.match(result.jobId, /^[0-9a-f-]{36}$/);
  assert.match(result.accessToken, /^[0-9a-f]{64}$/);
  assert.equal(result.accessTokenHash, undefined);
  const saved = store.records.get(result.jobId);
  assert.equal(saved.accessToken, undefined);
  assert.match(saved.accessTokenHash, /^[0-9a-f]{64}$/);
  assert.ok(saved.scraps.every(s => s.mask === undefined && s.usableMask === undefined));
  assert.equal(Date.parse(result.expiresAt) - Date.parse(result.createdAt), constants.RETENTION_MS);
});

test('retrieval and deletion require the capability and never return its hash or another token', async () => {
  const store = new MemoryStore(), handler = createHandler({ storage: store });
  const saved = json(await handler(request('POST', 'jobs', payload()))), route = `jobs/${saved.jobId}`;
  assert.equal((await handler(request('GET', route))).status, 401);
  assert.equal((await handler(request('GET', route, undefined, '0'.repeat(64)))).status, 401);
  const good = await handler(request('GET', route, undefined, saved.accessToken));
  assert.equal(good.status, 200);
  assert.equal(json(good).jobId, saved.jobId);
  assert.equal(json(good).accessToken, undefined);
  assert.equal(json(good).accessTokenHash, undefined);
  assert.equal((await handler(request('DELETE', route, undefined, '0'.repeat(64)))).status, 401);
  assert.equal((await handler(request('DELETE', route, undefined, saved.accessToken))).status, 200);
  assert.equal((await handler(request('GET', route, undefined, saved.accessToken))).status, 404);
  assert.equal((await handler(request('GET', 'jobs'))).status, 404);
});

test('30-day expiry denies access even with the correct saved-job token', async () => {
  let time = 1_800_000_000_000;
  const handler = createHandler({ storage: new MemoryStore(), now: () => time });
  const saved = json(await handler(request('POST', 'jobs', payload())));
  time += constants.RETENTION_MS;
  const response = await handler(request('GET', `jobs/${saved.jobId}`, undefined, saved.accessToken));
  assert.equal(response.status, 404);
  assert.equal(json(response).error.code, 'JOB_EXPIRED');
});

test('unconfigured or failed durable storage never claims a saved job', async () => {
  const absent = createHandler({ env: {} });
  assert.equal(json(await absent(request('GET', 'health'))).storageConfigured, false);
  const unsaved = await absent(request('POST', 'jobs', payload()));
  assert.equal(unsaved.status, 503);
  assert.equal(json(unsaved).saved, undefined);
  const broken = createHandler({ storage: { async put() { throw new Error('secret connection string'); } } });
  const failure = await broken(request('POST', 'jobs', payload()));
  assert.equal(failure.status, 503);
  assert.equal(json(failure).error.code, 'STORAGE_UNAVAILABLE');
  assert.ok(!failure.body.includes('secret'));
  assert.ok(!failure.body.includes('stack'));
});

test('malformed RLE, duplicate material, unsafe bounds and tampered fields fail before storage', async () => {
  const mutations = [
    p => { p.scraps[0].maskRle = [0, 100, 99, 10]; },
    p => { p.scraps[0].maskRle = [0, 20000]; },
    p => { p.scraps[0].maskRle = [-1, 1]; },
    p => { p.scraps[0].maskRle = [0, 0]; },
    p => { p.scraps[0].maskRle = [0]; },
    p => { p.scraps[0].bbox.x = 290; },
    p => { p.scraps[1].bbox.x = p.scraps[0].bbox.x; },
    p => { p.scraps[1].id = p.scraps[0].id; },
    p => { p.scraps[0].areaCm2 = 100000; },
    p => { p.scraps[0].pixelsPerCm = 1; },
    p => { p.image.width = 1601; },
    p => { p.image.sceneWidthCm = 9; },
    p => { p.options.size = 2; },
    p => { p.options.seamAllowanceCm = .1; },
    p => { p.options.rotation = 'true'; },
    p => { p.options.objective = 'guaranteed-optimal'; },
    p => { p.options.apiKey = 'untrusted'; },
    p => { p.excludedScrapIds = ['missing']; },
    p => { p.scraps[0].color = 'javascript:alert(1)'; },
  ];
  for (const mutate of mutations) {
    const p = payload(); mutate(p);
    const response = await createHandler({ storage: new MemoryStore() })(request('POST', 'jobs', p));
    assert.equal(response.status, 400, JSON.stringify(p.options));
    assert.ok(json(response).correlationId);
  }
});

test('combined mask allocation limit and photo payloads are rejected', () => {
  const p = payload(); p.image.width = 1600; p.image.height = 1600;
  p.scraps = [0, 1].map(i => ({ id: `s${i}`, color: '#123456', bbox: { x: 2, y: 2, width: 1590, height: 1590 }, maskRle: [i * 10, 1] }));
  assert.throws(() => validateJobPayload(p), /Combined decoded/);
  const photograph = payload(); photograph.image.photo = 'base64 data';
  assert.throws(() => validateJobPayload(photograph), /unsupported field/);
});

test('oversized and invalid JSON requests have bounded, consistent errors', async () => {
  const handler = createHandler({ storage: new MemoryStore() });
  const tooLarge = await handler(request('POST', 'jobs', undefined, undefined, { rawBody: ' '.repeat(constants.MAX_BODY_BYTES + 1) }));
  assert.equal(tooLarge.status, 413);
  const invalid = await handler(request('POST', 'jobs', undefined, undefined, { rawBody: '{broken' }));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers['Cache-Control'], 'no-store');
  assert.ok(invalid.headers['X-Correlation-ID']);
});

test('only the configured browser origin is allowed and OPTIONS never uses wildcard CORS', async () => {
  const handler = createHandler({ storage: new MemoryStore(), env: { RETHREAD_ALLOWED_ORIGIN: 'https://rethread.test' } });
  const good = await handler(request('OPTIONS', 'jobs', undefined, undefined, { headers: { origin: 'https://rethread.test' } }));
  assert.equal(good.status, 204);
  assert.equal(good.headers['Access-Control-Allow-Origin'], 'https://rethread.test');
  const bad = await handler(request('OPTIONS', 'jobs', undefined, undefined, { headers: { origin: 'https://other.test' } }));
  assert.equal(bad.status, 400);
  assert.equal(bad.headers['Access-Control-Allow-Origin'], undefined);
});

test('per-instance request and POST rates are enforced', async () => {
  const handler = createHandler({ storage: new MemoryStore() });
  for (let i = 0; i < 60; i++) assert.equal((await handler(request('GET', 'health'))).status, 200);
  assert.equal((await handler(request('GET', 'health'))).status, 429);
  const posts = createHandler({ env: {} });
  for (let i = 0; i < 10; i++) assert.equal((await posts(request('POST', 'jobs', payload()))).status, 503);
  assert.equal((await posts(request('POST', 'jobs', payload()))).status, 429);
});

test('two simultaneous geometry jobs are allowed and a third is bounded', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const core = await import('../api/core/vision.mjs'), recommendations = await import('../api/core/recommend.mjs');
  const handler = createHandler({ storage: new MemoryStore(), loadCore: async () => { await gate; return { optimizePattern: core.optimizePattern, recommendProducts: recommendations.recommendProducts }; } });
  const first = handler(request('POST', 'jobs', payload())), second = handler(request('POST', 'jobs', payload()));
  const third = await handler(request('POST', 'jobs', payload()));
  assert.equal(third.status, 429);
  assert.equal(json(third).error.code, 'JOB_CAPACITY_REACHED');
  release();
  assert.deepEqual((await Promise.all([first, second])).map(r => r.status), [201, 201]);
});

test('a stalled storage request times out without a false saved acknowledgment', async () => {
  const handler = createHandler({ storage: { async put() { return new Promise(() => {}); } }, timeoutMs: 15 });
  const response = await handler(request('POST', 'jobs', payload()));
  assert.equal(response.status, 503);
  assert.equal(json(response).error.code, 'OPERATION_TIMEOUT');
  assert.equal(json(response).saved, undefined);
});
