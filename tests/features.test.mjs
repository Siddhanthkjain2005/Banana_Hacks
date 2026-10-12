import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { optimizePattern, isPieceContained } from '../api/core/vision.mjs';
import { recommendProducts } from '../api/core/recommend.mjs';
const require = createRequire(import.meta.url);
const { createHandler } = require('../api/lib/service.cjs');
const { arrangePatches, leftoverScraps, largestRectangle, erode, usableOf } = require('../api/lib/analytics.cjs');
const { planChain } = require('../api/lib/chain.cjs');
const { encodePNG, decodePNG } = require('../api/lib/png.cjs');
const { createFileStore } = require('../api/lib/file-store.cjs');
const { createImageGenerator } = require('../api/lib/imagegen.cjs');
const { hexToRgb } = require('../api/lib/color.cjs');
const { validateJobPayload } = require('../api/lib/validate.cjs');

const core = { optimizePattern, recommendProducts, isPieceContained };
const COLORS = ['#75835c', '#b95a2d', '#31556c'];
/** Three 17 × 38 cm rectangles at 5 px/cm: enough for a complete pouch with plenty left over. */
function payload(extra = {}) {
  return { image: { width: 300, height: 220, sceneWidthCm: 60 },
    scraps: [10, 110, 210].map((x, i) => ({ id: `scrap-${i + 1}`, label: `Measured ${i + 1}`, color: COLORS[i], bbox: { x, y: 10, width: 85, height: 190 }, maskRle: [0, 85 * 190], usable: true })),
    options: { product: 'pouch', objective: 'color', seamAllowanceCm: .7, rotation: true, size: 1 }, ...extra };
}
class MemoryStore {
  records = new Map();
  async ready() { return true; }
  async put(id, value) { if (this.records.has(id)) { const e = Error('exists'); e.statusCode = 409; throw e; } this.records.set(id, structuredClone(value)); }
  async get(id) { return structuredClone(this.records.get(id) || null); }
  async delete(id) { return this.records.delete(id); }
}
let client = 0;
const request = (method, route, body, headers = {}) => ({ method, url: `https://rethread.test/api/${route}`,
  headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${++client % 250}`, ...headers }, ...(body !== undefined ? { body } : {}) });
const json = response => JSON.parse(response.body);
const pngBase64 = encodePNG({ width: 2, height: 2, data: new Uint8ClampedArray(16).fill(200) }).toString('base64');

test('stateless planning returns a validated plan with analytics, arrangement and impact without storage', async () => {
  const response = await createHandler({ env: {} })(request('POST', 'plan', payload())), result = json(response);
  assert.equal(response.status, 200);
  assert.equal(result.plan.validated, true);
  assert.equal(result.plan.feasible, true);
  assert.equal(result.recommendations.length, 3);
  assert.equal(result.analytics.perScrap.length, 3);
  const cuts = result.analytics.perScrap.reduce((t, s) => t + s.cuts, 0);
  assert.equal(cuts, result.plan.pieces.length);
  assert.ok(result.analytics.perScrap.every(s => s.leftoverUsableCm2 <= s.usableAreaCm2 && s.utilization >= 0 && s.utilization <= 1));
  assert.ok(result.analytics.seams.patchworkSeams > 0 && result.analytics.seams.totalSeamCm > result.analytics.seams.patchworkSeamCm);
  assert.ok(Math.abs(result.impact.estimatedMassG - result.plan.stats.usedAreaCm2 / 10000 * 150) < .1);
  assert.ok(Math.abs(result.impact.avoidedVirginFabric.kgCo2e - result.impact.estimatedMassG / 1000 * 3.5) < .002);
  assert.equal(result.impact.avoidedVirginFabric.waterLitres, null);
  assert.match(result.impact.assumptions.emissionFactorSource.url, /tuwien/);
});

test('impact assumptions can be supplied and are strictly bounded', async () => {
  const handler = createHandler({ env: {} });
  const custom = json(await handler(request('POST', 'plan', payload({ impact: { fabricGsm: 300, kgCo2ePerKg: 10, waterLitresPerKg: 1000 } })))).impact;
  assert.ok(Math.abs(custom.estimatedMassG - custom.fabricReusedCm2 / 10000 * 300) < .1);
  assert.ok(Math.abs(custom.avoidedVirginFabric.kgCo2e - custom.estimatedMassG / 1000 * 10) < .002);
  assert.ok(Math.abs(custom.avoidedVirginFabric.waterLitres - custom.estimatedMassG) < .2);
  for (const impact of [{ fabricGsm: 1000 }, { kgCo2ePerKg: -1 }, { fabricGsm: '150' }, { guaranteedSaving: true }]) assert.equal((await handler(request('POST', 'plan', payload({ impact })))).status, 400);
  assert.equal((await handler(request('POST', 'plan', payload({ concept: {} })))).status, 400, 'each route accepts only its own sections');
  assert.equal((await createHandler({ storage: new MemoryStore() })(request('POST', 'jobs', payload({ impact: {} })))).status, 400, 'saved jobs stay strict');
});

test('colour arrangement only permutes interchangeable cuts and removes same-scrap neighbours', () => {
  // A 2 × 2 panel cut as two columns of the same scrap: every row joins different scraps but columns repeat.
  const piece = (id, row, col, scrapId, color) => ({ id, panel: 'front', row, col, rows: 2, cols: 2, scrapId, color, cutWidthCm: 10, cutHeightCm: 8 });
  const plan = { pieces: [piece('a', 0, 0, 's1', '#202020'), piece('b', 0, 1, 's2', '#f0f0f0'), piece('c', 1, 0, 's1', '#202020'), piece('d', 1, 1, 's2', '#f0f0f0')] };
  const result = arrangePatches(plan);
  assert.equal(result.before.sameScrapAdjacencies, 2);
  assert.equal(result.after.sameScrapAdjacencies, 0);
  assert.ok(result.after.cost < result.before.cost);
  assert.deepEqual(result.slots.map(s => s.cutId).sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(result.slots.map(s => s.slotId), ['a', 'b', 'c', 'd']);
  // Cuts of different dimensions are never exchanged.
  const mixed = arrangePatches({ pieces: [piece('a', 0, 0, 's1', '#202020'), { ...piece('b', 0, 1, 's1', '#202020'), cutWidthCm: 12 }] });
  assert.equal(mixed.swaps, 0);
});

test('arranged slots on real plans keep identical cut dimensions', async () => {
  const result = json(await createHandler({ env: {} })(request('POST', 'plan', payload())));
  const pieces = new Map(result.plan.pieces.map(p => [p.id, p]));
  for (const slot of result.arrangement.slots) {
    const original = pieces.get(slot.slotId), cut = pieces.get(slot.cutId);
    assert.ok(Math.abs(original.cutWidthCm - cut.cutWidthCm) < 1e-3 && Math.abs(original.cutHeightCm - cut.cutHeightCm) < 1e-3);
  }
  assert.ok(result.arrangement.after.cost <= result.arrangement.before.cost);
});

test('leftover masks equal the engine erosion of the remaining fabric and the largest rectangle is exact', () => {
  const w = 40, h = 30, mask = new Uint8Array(w * h);
  for (let y = 2; y < 28; y++) for (let x = 3; x < 37; x++) if (!(x > 25 && y > 18)) mask[y * w + x] = 1;
  const scrap = { id: 's', bbox: { x: 100, y: 50, width: w, height: h }, mask, pixelsPerCm: 4 };
  usableOf(scrap);
  const cut = { scrapId: 's', x: 110, y: 55, occupiedPixelWidth: 9, occupiedPixelHeight: 7 };
  const [left] = leftoverScraps([scrap], [cut]);
  const remaining = new Uint8Array(mask);
  for (let y = 5; y < 12; y++) for (let x = 10; x < 19; x++) remaining[y * w + x] = 0;
  assert.deepEqual([...left.usableMask], [...erode(remaining, w, h)]);
  assert.equal(left.usableAreaPx, erode(remaining, w, h).reduce((t, v) => t + v, 0));
  const full = new Uint8Array(6 * 5).fill(1);
  assert.deepEqual(largestRectangle(full, 6, 5), { width: 6, height: 5, x: 0, y: 0 });
  full[0] = 0; full[29] = 0; // opposite corners removed: best is 5 × 4
  const rect = largestRectangle(full, 6, 5);
  assert.equal(rect.width * rect.height, 20);
});

test('zero-waste chains add complete projects from offcuts without reusing fabric', async () => {
  const response = await createHandler({ env: {} })(request('POST', 'chain', payload({ chain: { maxProjects: 4 } }))), chain = json(response);
  assert.equal(response.status, 200);
  assert.ok(chain.projects.length >= 2, chain.stopReason);
  assert.equal(chain.validation.validated, true);
  assert.ok(chain.summary.utilization > chain.summary.firstProjectUtilization);
  assert.ok(chain.projects.every(p => p.plan.feasible && p.plan.validated));
  const plan = json(await createHandler({ env: {} })(request('POST', 'plan', payload()))).plan;
  assert.deepEqual(chain.projects[0].plan.pieces, plan.pieces, 'the first project is the requested plan');
  // Independent re-check: decoded original masks contain every cut, and no cuts share fabric.
  const measured = validateJobPayload(payload()), byId = new Map(measured.scraps.map(s => [s.id, s]));
  const cuts = chain.projects.flatMap(p => p.plan.pieces);
  cuts.forEach((c, i) => {
    assert.ok(isPieceContained(c, byId.get(c.scrapId)));
    for (const d of cuts.slice(0, i)) if (d.scrapId === c.scrapId) assert.ok(c.x + c.occupiedPixelWidth <= d.x || d.x + d.occupiedPixelWidth <= c.x || c.y + c.occupiedPixelHeight <= d.y || d.y + d.occupiedPixelHeight <= c.y);
  });
  assert.ok(Math.abs(chain.impact.fabricReusedCm2 - chain.summary.usedAreaCm2) < .1);
});

test('chains respect the project limit and stop gracefully when the search budget is spent', () => {
  const one = planChain(validateJobPayload(payload()), core, { maxProjects: 1, minSize: .5 });
  assert.equal(one.projects.length, 1);
  assert.match(one.stopReason, /maximum of 1/);
  const budgeted = planChain(validateJobPayload(payload()), core, { maxProjects: 5, minSize: .5 }, () => {}, 0);
  assert.equal(budgeted.projects.length, 1);
  assert.match(budgeted.stopReason, /time budget/);
  assert.equal(budgeted.validation.validated, true);
});

/** One 20 × 14 cm offcut per donor: a pouch needs two 19.4 × 13.4 cm panels. */
function poolPayload() {
  const source = (name, width, sceneWidthCm, scale, color) => ({ name, image: { width, height: Math.round(width * .7), sceneWidthCm },
    scraps: [{ id: 'piece', label: 'Offcut', color, bbox: { x: 20 * scale, y: 20 * scale, width: 100 * scale, height: 70 * scale }, maskRle: [0, 100 * 70 * scale * scale] }] });
  return { sources: [source('Asha', 300, 60, 1, '#b95a2d'), source('Ben', 600, 60, 2, '#31556c')], options: { product: 'pouch', objective: 'waste', size: 1 } };
}

test('a community pool completes a project that no single donor can, with traceable contributions', async () => {
  const response = await createHandler({ env: {} })(request('POST', 'pool', poolPayload())), pool = json(response);
  assert.equal(response.status, 200);
  assert.equal(pool.plan.feasible, true);
  assert.equal(pool.poolingUnlocks, true);
  assert.ok(pool.solo.every(s => !s.feasible));
  assert.deepEqual(pool.donors.map(d => d.name), ['Asha', 'Ben']);
  assert.deepEqual(pool.donors.map(d => d.image.pixelsPerCm), [5, 10], 'each photo keeps its own calibration');
  assert.ok(pool.plan.pieces.every(p => /^d[12]-piece$/.test(p.scrapId)));
  const total = pool.contributions.reduce((t, c) => t + c.usedAreaCm2, 0);
  assert.ok(Math.abs(total - pool.plan.stats.usedAreaCm2) < .05);
  assert.ok(pool.contributions.every(c => c.cuts > 0));
  assert.match(pool.summary, /pooling made this project possible/);
});

test('pool inputs are bounded per source and overall', async () => {
  const handler = createHandler({ env: {} });
  const mutations = [
    p => { p.sources = p.sources.slice(0, 1); },
    p => { p.sources = Array.from({ length: 9 }, () => structuredClone(p.sources[0])); },
    p => { p.sources[0].name = 'x'.repeat(61); },
    p => { p.sources[0].name = 'bad\u0007name'; },
    p => { p.sources[0].scraps.push({ ...p.sources[0].scraps[0], id: 'twin' }); },
    p => { p.sources[0].photo = 'base64'; },
    p => { p.sources[1].image.width = 1601; },
    p => { p.options.product = 'quilt'; },
  ];
  for (const mutate of mutations) { const p = poolPayload(); mutate(p); assert.equal((await handler(request('POST', 'pool', p))).status, 400); }
});

test('concept previews render the validated layout and a prompt from measured colours without a provider', async () => {
  const response = await createHandler({ env: {} })(request('POST', 'concept', payload({ concept: { style: 'flatlay' } }))), concept = json(response);
  assert.equal(response.status, 200);
  assert.equal(concept.render.generated, false);
  assert.match(concept.render.reason, /not configured/);
  const image = decodePNG(Buffer.from(concept.designMap.base64, 'base64'));
  assert.deepEqual([image.width, image.height], [1024, 1024]);
  for (const hex of COLORS) {
    const [r, g, b] = hexToRgb(hex);
    let near = 0;
    for (let i = 0; i < image.data.length; i += 4) if (Math.abs(image.data[i] - r) < 14 && Math.abs(image.data[i + 1] - g) < 14 && Math.abs(image.data[i + 2] - b) < 14) near++;
    assert.ok(near > 5000, `${hex} patches are drawn`);
    assert.ok(concept.prompt.includes(hex));
  }
  assert.match(concept.prompt, /flat-lay/);
  assert.match(concept.prompt, /3 × 3|2 × 2|\d × \d/);
  assert.deepEqual(concept.privacy.neverSent, ['source photographs', 'scrap masks']);
  assert.match(concept.disclosure, /not a photograph/);
});

test('configured concept renders send only the design map and prompt, with provider-specific auth', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ data: [{ b64_json: pngBase64, revised_prompt: 'ok' }] }), { status: 200 }); };
  const env = { RETHREAD_IMAGE_API_KEY: 'sk-test-secret', RETHREAD_IMAGE_MODEL: 'gpt-image-1' };
  const response = await createHandler({ env, fetch })(request('POST', 'concept', payload())), concept = json(response);
  assert.equal(response.status, 200);
  assert.equal(concept.render.generated, true);
  assert.equal(concept.render.mimeType, 'image/png');
  assert.equal(concept.render.base64, pngBase64);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/images/edits');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test-secret');
  const form = calls[0].init.body;
  assert.deepEqual([...form.keys()].sort(), ['image', 'model', 'n', 'prompt', 'quality', 'size']);
  const reference = Buffer.from(await form.get('image').arrayBuffer());
  assert.equal(reference.toString('base64'), concept.designMap.base64, 'the reference image is the server-rendered design map');
  assert.ok(!form.get('prompt').includes('maskRle'));
  assert.ok(!response.body.includes('sk-test-secret'));
  const azure = [];
  await createHandler({ env: { RETHREAD_IMAGE_API_KEY: 'azure-key', RETHREAD_IMAGE_BASE_URL: 'https://demo.openai.azure.com/openai/v1/' }, fetch: async (url, init) => { azure.push({ url, init }); return new Response(JSON.stringify({ data: [{ b64_json: pngBase64 }] })); } })(request('POST', 'concept', payload()));
  assert.equal(azure[0].url, 'https://demo.openai.azure.com/openai/v1/images/edits');
  assert.deepEqual(azure[0].init.headers, { 'api-key': 'azure-key' });
  const skipped = [];
  const preview = json(await createHandler({ env, fetch: async () => { skipped.push(1); } })(request('POST', 'concept', payload({ concept: { generate: false } }))));
  assert.equal(preview.render.generated, false);
  assert.equal(skipped.length, 0);
});

test('image provider failures map to safe errors and renders are rate limited', async () => {
  const env = { RETHREAD_IMAGE_API_KEY: 'sk-never-echo' };
  const cases = [
    [async () => new Response(JSON.stringify({ error: { code: 'moderation_blocked', message: 'sk-never-echo' } }), { status: 400 }), 422, 'CONCEPT_REJECTED'],
    [async () => new Response('{}', { status: 401 }), 502, 'IMAGE_PROVIDER_AUTH'],
    [async () => new Response('{}', { status: 429 }), 503, 'IMAGE_PROVIDER_BUSY'],
    [async () => { throw Error('ECONNRESET sk-never-echo'); }, 502, 'IMAGE_PROVIDER_FAILED'],
    [async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] })), 502, 'IMAGE_PROVIDER_FAILED'],
    [(url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('aborted')))), 504, 'IMAGE_PROVIDER_TIMEOUT'],
  ];
  for (const [fetch, status, code] of cases) {
    const response = await createHandler({ env, fetch, imageTimeoutMs: 30 })(request('POST', 'concept', payload()));
    assert.equal(response.status, status, code);
    assert.equal(json(response).error.code, code);
    assert.ok(!response.body.includes('sk-never-echo'));
  }
  const handler = createHandler({ env, fetch: async () => new Response(JSON.stringify({ data: [{ b64_json: pngBase64 }] })) });
  const same = { 'x-forwarded-for': '198.51.100.7' };
  for (let i = 0; i < 3; i++) assert.equal((await handler({ ...request('POST', 'concept', payload()), headers: { 'content-type': 'application/json', ...same } })).status, 200);
  const limited = await handler({ ...request('POST', 'concept', payload()), headers: { 'content-type': 'application/json', ...same } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['Retry-After'], '60');
});

test('image provider deadlines also bound stalled success and error response bodies', { timeout: 1000 }, async () => {
  for (const status of [200, 401]) {
    let requestSignal;
    const generator = createImageGenerator({ env: { RETHREAD_IMAGE_API_KEY: 'sk-test-secret' }, timeoutMs: 20,
      fetch: async (_url, init) => {
        requestSignal = init.signal;
        return { ok: status === 200, status, json: () => new Promise(() => {}) };
      } });
    await assert.rejects(generator.generate({ prompt: 'Test a validated layout.', referencePng: Buffer.from(pngBase64, 'base64') }),
      error => error.status === 504 && error.code === 'IMAGE_PROVIDER_TIMEOUT');
    assert.equal(requestSignal.aborted, true, 'the upstream request is aborted when body decoding stalls');
  }
});

function parsePdf(buffer) {
  const text = buffer.toString('latin1'), start = Number(/startxref\n(\d+)/.exec(text)[1]);
  const xref = text.slice(start).split('\n'), count = Number(xref[1].split(' ')[1]);
  const offsets = xref.slice(3, 2 + count).map(line => Number(line.slice(0, 10)));
  const streams = [...text.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(m => zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'));
  return { text, offsets, streams, pages: (text.match(/\/Type \/Page /g) || []).length };
}

test('the maker packet is a well-formed, calibrated, multi-page PDF', async () => {
  const handler = createHandler({ env: {} }), response = await handler(request('POST', 'packet?paper=letter', payload()));
  assert.equal(response.status, 200);
  assert.equal(response.headers['Content-Type'], 'application/pdf');
  assert.match(response.headers['Content-Disposition'], /attachment; filename="rethread-maker-packet\.pdf"/);
  assert.ok(Buffer.isBuffer(response.body));
  const pdf = parsePdf(response.body);
  assert.ok(pdf.text.startsWith('%PDF-1.4'));
  assert.ok(pdf.text.endsWith('%%EOF\n'));
  pdf.offsets.forEach((offset, i) => assert.ok(pdf.text.startsWith(`${i + 1} 0 obj`, offset), `xref entry ${i + 1}`));
  assert.ok(pdf.pages >= 5, `${pdf.pages} pages`);
  assert.match(pdf.text, /\/MediaBox \[0 0 612 792\]/);
  const content = pdf.streams.join('\n');
  for (const phrase of ['Cut list', 'Cutting diagrams', 'Sewing layout', 'Assembly steps', '10 cm', 'Print at 100%']) assert.ok(content.includes(phrase), phrase);
  // The calibration bar is exactly 100 mm: 283.465 PDF points.
  assert.match(content, /42\.52 \d+(\.\d+)? m 325\.984 \d+(\.\d+)? l S/);
  assert.equal((await handler(request('POST', 'packet?paper=tabloid', payload()))).status, 400);
});

test('owners can mint read-only share capabilities for saved receipts and packets', async () => {
  const storage = new MemoryStore(), handler = createHandler({ storage });
  const saved = json(await handler(request('POST', 'jobs', payload())));
  assert.equal(saved.shareTokenHash, undefined);
  const owner = { 'X-ReThread-Token': saved.accessToken };
  const share = json(await handler(request('POST', `jobs/${saved.jobId}/share`, undefined, owner)));
  assert.match(share.shareToken, /^[0-9a-f]{64}$/);
  assert.notEqual(share.shareToken, saved.accessToken);
  assert.equal(json(await handler(request('POST', `jobs/${saved.jobId}/share`, undefined, owner))).shareToken, share.shareToken, 'derivation is stable');
  const viewer = { 'X-ReThread-Token': share.shareToken };
  const read = await handler(request('GET', `jobs/${saved.jobId}`, undefined, viewer));
  assert.equal(read.status, 200);
  assert.equal(json(read).access, 'viewer');
  assert.ok(!read.body.includes('TokenHash') && !read.body.includes(saved.accessToken));
  assert.equal(json(await handler(request('GET', `jobs/${saved.jobId}`, undefined, owner))).access, 'owner');
  const denied = await handler(request('DELETE', `jobs/${saved.jobId}`, undefined, viewer));
  assert.equal(denied.status, 403);
  assert.equal(json(denied).error.code, 'READ_ONLY_TOKEN');
  assert.equal((await handler(request('POST', `jobs/${saved.jobId}/share`, undefined, viewer))).status, 403);
  const packet = await handler(request('GET', `jobs/${saved.jobId}/packet`, undefined, viewer));
  assert.equal(packet.status, 200);
  assert.ok(parsePdf(packet.body).pages >= 5);
  assert.equal((await handler(request('GET', `jobs/${saved.jobId}/packet`, undefined, { 'X-ReThread-Token': '0'.repeat(64) }))).status, 401);
  assert.ok(storage.records.get(saved.jobId).analytics && storage.records.get(saved.jobId).arrangement && storage.records.get(saved.jobId).impact);
  assert.equal((await handler(request('DELETE', `jobs/${saved.jobId}`, undefined, owner))).status, 200);
  assert.equal((await handler(request('GET', `jobs/${saved.jobId}`, undefined, viewer))).status, 404);
});

test('receipts saved before share links report sharing as unavailable', async () => {
  const storage = new MemoryStore(), handler = createHandler({ storage });
  const saved = json(await handler(request('POST', 'jobs', payload())));
  const record = storage.records.get(saved.jobId);
  delete record.shareTokenHash; delete record.arrangement; delete record.analytics; delete record.impact;
  const response = await handler(request('POST', `jobs/${saved.jobId}/share`, undefined, { 'X-ReThread-Token': saved.accessToken }));
  assert.equal(response.status, 409);
  assert.equal(json(response).error.code, 'SHARING_UNAVAILABLE');
  assert.equal((await handler(request('GET', `jobs/${saved.jobId}/packet`, undefined, { 'X-ReThread-Token': saved.accessToken }))).status, 200, 'older receipts still print');
});

test('health, OpenAPI, and security headers describe the service without leaking configuration', async () => {
  const handler = createHandler({ env: { RETHREAD_IMAGE_API_KEY: 'sk-hidden', RETHREAD_IMAGE_MODEL: 'gpt-image-1' } });
  const health = await handler(request('GET', 'health')), body = json(health);
  assert.deepEqual(body.features, ['jobs', 'share-links', 'plan', 'chain', 'pool', 'concept', 'packet', 'openapi']);
  assert.deepEqual(body.imageGeneration, { configured: true, provider: 'api.openai.com', model: 'gpt-image-1', quality: 'medium' });
  assert.ok(!health.body.includes('sk-hidden'));
  assert.equal(json(await createHandler({ env: {} })(request('GET', 'health'))).imageGeneration.configured, false);
  assert.equal(json(await createHandler({ env: { RETHREAD_IMAGE_API_KEY: 'k', RETHREAD_IMAGE_BASE_URL: 'http://insecure.test/v1' } })(request('GET', 'health'))).imageGeneration.configured, false, 'plain HTTP providers are refused');
  for (const [name, value] of [['Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"], ['X-Frame-Options', 'DENY'], ['X-Content-Type-Options', 'nosniff'], ['Referrer-Policy', 'no-referrer']]) assert.equal(health.headers[name], value);
  const spec = json(await handler(request('GET', 'openapi.json')));
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.info.version, body.version);
  assert.deepEqual(Object.keys(spec.paths).sort(), ['/chain', '/concept', '/health', '/jobs', '/jobs/{jobId}', '/jobs/{jobId}/packet', '/jobs/{jobId}/share', '/openapi.json', '/packet', '/plan', '/pool', '/ready'].sort());
});

test('structured request logs carry correlation and timing but never content or raw IDs', async () => {
  const entries = [], handler = createHandler({ storage: new MemoryStore(), logger: (entry, invocation) => entries.push({ entry, invocation }) });
  const saved = json(await handler(request('POST', 'jobs', payload()), { invocationId: 'abc' }));
  await handler(request('GET', `jobs/${saved.jobId}`, undefined, { 'X-ReThread-Token': '1'.repeat(64) }));
  assert.equal(entries[0].invocation.invocationId, 'abc');
  assert.deepEqual(Object.keys(entries[0].entry).sort(), ['correlationId', 'durationMs', 'method', 'route', 'status']);
  assert.equal(entries[1].entry.route, 'jobs/:id');
  assert.equal(entries[1].entry.code, 'INVALID_TOKEN');
  assert.ok(!JSON.stringify(entries).includes(saved.jobId) && !JSON.stringify(entries).includes('maskRle'));
  const throwing = createHandler({ env: {}, logger: () => { throw Error('log sink down'); } });
  assert.equal((await throwing(request('GET', 'health'))).status, 200);
});

test('local file storage has create-only semantics and supports retry-safe saves end to end', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rethread-'));
  try {
    const store = createFileStore(directory), id = 'd4a7ab96-051b-4aaf-9202-0351bd53ef2a';
    assert.equal(await store.ready(), true);
    await store.put(id, { a: 1 });
    await assert.rejects(store.put(id, { a: 2 }), error => error.statusCode === 409);
    assert.deepEqual(await store.get(id), { a: 1 });
    assert.equal(await store.get('a0da9d60-de9b-445f-b0dc-70da2679640f'), null);
    await assert.rejects(store.get('../escape'), /Invalid record ID/);
    await store.delete(id);
    assert.equal(await store.get(id), null);
    const headers = { 'Idempotency-Key': 'a94fd270-cd3b-4023-bc88-6c5a1d1e2a09', 'X-ReThread-Token': 'e'.repeat(64) };
    const first = await createHandler({ storage: createFileStore(directory) })(request('POST', 'jobs', payload(), headers));
    const second = await createHandler({ storage: createFileStore(directory) })(request('POST', 'jobs', payload(), headers));
    assert.deepEqual([first.status, second.status], [201, 200]);
    assert.equal(json(second).replayed, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('PNG encoding round-trips RGBA pixels', () => {
  const data = new Uint8ClampedArray(7 * 5 * 4).map((_, i) => (i * 37) % 256);
  const decoded = decodePNG(encodePNG({ width: 7, height: 5, data }));
  assert.deepEqual([decoded.width, decoded.height], [7, 5]);
  assert.deepEqual([...decoded.data], [...data]);
  assert.throws(() => decodePNG(Buffer.from('not a png at all, definitely not')), /Not a PNG/);
});
