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
  async ready() { return true; }
  async put(id, value) { this.records.set(id, structuredClone(value)); }
  async get(id) { return structuredClone(this.records.get(id) || null); }
  async delete(id) { return this.records.delete(id); }
}
const request = (method, route, body, token, extra = {}) => ({ method, url: `https://rethread.test/api/${route}`,
  headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.1', ...(token ? { 'X-ReThread-Token': token } : {}), ...(extra.headers || {}) },
  ...(body !== undefined ? { body } : {}), ...extra });
const json = response => JSON.parse(response.body);

test('server uses the same geometry and recommendations as the browser', async () => {
  for (const [source, copy] of [['vision.js', 'vision.mjs'], ['recommend.js', 'recommend.mjs']]) {
    const [a, b] = await Promise.all([readFile(new URL(`../dist/${source}`, import.meta.url)), readFile(new URL(`../api/core/${copy}`, import.meta.url))]);
    const expected = source === 'recommend.js' ? a.toString().replace("from './vision.js'","from './vision.mjs'") : a.toString();
    assert.equal(b.toString(), expected);
  }
});

test('readiness actually checks private storage instead of treating configuration as connectivity',async()=>{
  const absent=await createHandler({env:{}})(request('GET','ready'));assert.equal(absent.status,503);
  let probes=0;const handler=createHandler({storage:{async ready(){probes++;return true;}}});const good=await handler(request('GET','ready'));assert.equal(good.status,200);assert.equal(json(good).storageReady,true);assert.equal(probes,1);
  const broken=await createHandler({storage:{async ready(){throw Error('secret storage key');}}})(request('GET','ready'));assert.equal(broken.status,503);assert.ok(!broken.body.includes('secret'));
});

test('a retry recovers the same durable save without rerunning geometry or duplicating records',async()=>{
  const storage=new MemoryStore(),key='d4a7ab96-051b-4aaf-9202-0351bd53ef2a',token='a'.repeat(64);const handler=createHandler({storage});
  const post=p=>request('POST','jobs',p,undefined,{headers:{'Content-Type':'application/json','Idempotency-Key':key,'X-ReThread-Token':token}});
  const first=await handler(post(payload()));assert.equal(first.status,201);const initial=json(first);assert.equal(initial.jobId,key);assert.equal(initial.accessToken,token);assert.match(initial.inputDigest,/^[0-9a-f]{64}$/);
  const retried=await handler(post(payload()));assert.equal(retried.status,200);assert.equal(json(retried).replayed,true);assert.equal(json(retried).jobId,key);assert.equal(json(retried).createdAt,initial.createdAt);assert.equal(storage.records.size,1);
  const changed=payload();changed.options.size=.5;assert.equal((await handler(post(changed))).status,409);
  const wrong=post(payload());wrong.headers['X-ReThread-Token']='b'.repeat(64);assert.equal((await handler(wrong)).status,409);
});

test('retry recovery survives a new service instance and object property reordering',async()=>{
  const storage=new MemoryStore(),key='a0da9d60-de9b-445f-b0dc-70da2679640f',token='c'.repeat(64),p=payload();const headers={'Content-Type':'application/json','Idempotency-Key':key,'X-ReThread-Token':token};
  assert.equal((await createHandler({storage})(request('POST','jobs',p,undefined,{headers}))).status,201);
  const reordered={options:p.options,scraps:p.scraps,image:p.image};
  const response=await createHandler({storage,loadCore:()=>{throw Error('Replay must not execute inference');}})(request('POST','jobs',reordered,undefined,{headers}));assert.equal(response.status,200);assert.equal(json(response).replayed,true);assert.equal(storage.records.size,1);
});

test('retry keys and neural provenance are strictly bounded before storage',async()=>{
  const handler=createHandler({storage:new MemoryStore()});
  assert.equal((await handler(request('POST','jobs',payload(),undefined,{headers:{'Idempotency-Key':'invalid'}}))).status,400);
  const p=payload();p.analysisProvenance={engine:'slimsam',modelId:'made-up'};assert.equal((await handler(request('POST','jobs',p))).status,400);
  p.analysisProvenance={engine:'slimsam',modelId:'Xenova/slimsam-77-uniform',revision:'5850ab45f587c112167512ffef949107115e26a0',precision:'int8',runtime:'Transformers.js 2.17.2',elapsedMs:1200,prompt:[50,50]};const saved=await handler(request('POST','jobs',p));assert.equal(saved.status,201);assert.equal(json(saved).analysisProvenance.engine,'slimsam');assert.ok(json(saved).verification.limitations[0].includes('client reported'));
});

test('a lost storage response can be recovered with the retained private save key',async()=>{
  const storage=new MemoryStore();let writes=0;const put=storage.put.bind(storage);storage.put=async(id,value)=>{await put(id,value);writes++;throw Error('Response connection was interrupted after commit');};
  const headers={'Content-Type':'application/json','Idempotency-Key':'a36fce6a-b688-4dd4-bd84-1d710fbcbd75','X-ReThread-Token':'d'.repeat(64)},req=request('POST','jobs',payload(),undefined,{headers});
  const first=await createHandler({storage})(req);assert.equal(first.status,503);assert.equal(json(first).saved,undefined);
  const retried=await createHandler({storage})(req);assert.equal(retried.status,200);assert.equal(json(retried).saved,true);assert.equal(json(retried).replayed,true);assert.equal(writes,1);
});

test('atomic create prevents duplicate records across simultaneous service instances',async()=>{
  const storage=new MemoryStore();let count=0,release;const gate=new Promise(resolve=>release=resolve);
  storage.put=async(id,value)=>{if(++count===2)release();await gate;if(storage.records.has(id)){const error=Error('Already exists');error.statusCode=409;throw error;}storage.records.set(id,structuredClone(value));};
  const headers={'Content-Type':'application/json','Idempotency-Key':'a94fd270-cd3b-4023-bc88-6c5a1d1e2a09','X-ReThread-Token':'e'.repeat(64)},req=request('POST','jobs',payload(),undefined,{headers});
  const responses=await Promise.all([createHandler({storage})(req),createHandler({storage})(req)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);assert.equal(storage.records.size,1);assert.equal(json(responses[0]).jobId,json(responses[1]).jobId);
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
