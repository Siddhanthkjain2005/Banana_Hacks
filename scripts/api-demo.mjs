#!/usr/bin/env node
/**
 * End-to-end backend demo on the bundled sample photographs.
 *
 *   node scripts/api-demo.mjs                      # in-process API with local file storage
 *   node scripts/api-demo.mjs --base http://127.0.0.1:4173   # a running `npm run dev` or Azure deployment
 *   node scripts/api-demo.mjs --generate           # also request an AI concept render (needs RETHREAD_IMAGE_API_KEY)
 *
 * Each photo is analyzed locally with the same engine as the browser studio;
 * only derived masks are sent to the API. Outputs are written to demo-output/.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analyzeImage } from '../dist/vision.js';
import { SAMPLE_COLLECTIONS } from '../dist/sample.js';

const require = createRequire(import.meta.url);
const { decodePNG, downscale } = require('../api/lib/png.cjs');
const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const base = option('--base'), out = new URL(`../${option('--out') || 'demo-output'}/`, import.meta.url), generate = args.includes('--generate');
await mkdir(out, { recursive: true });

async function sample(id) {
  const meta = SAMPLE_COLLECTIONS.find(s => s.id === id);
  const image = downscale(decodePNG(await readFile(new URL(`../dist${meta.src}`, import.meta.url))), 1200);
  return { meta, analysis: analyzeImage(image, { sceneWidthCm: meta.sceneWidthCm }) };
}
const encodeMask = mask => { const runs = []; for (let i = 0; i < mask.length;) { if (!mask[i]) { i++; continue; } const start = i; while (i < mask.length && mask[i]) i++; runs.push(start, i - start); } return runs; };
const derived = (analysis, only) => ({ image: { width: analysis.width, height: analysis.height, sceneWidthCm: analysis.sceneWidthCm },
  scraps: analysis.scraps.filter(s => !only || only.includes(s.id)).map(s => ({ id: s.id, label: s.label, color: s.color, bbox: s.bbox, usable: s.usable, maskRle: encodeMask(s.mask) })) });

let call;
if (base) {
  call = async (method, route, body, headers = {}) => {
    const response = await fetch(new URL(`/api/${route}`, base), { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const type = response.headers.get('content-type') || '';
    return { status: response.status, type, body: type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
} else {
  const { createHandler } = require('../api/lib/service.cjs'), { createFileStore } = require('../api/lib/file-store.cjs');
  // Each demo step gets its own simulated client so the per-client rate limit does not throttle the demo itself.
  const handler = createHandler({ storage: createFileStore(fileURLToPath(new URL('.store/', out))) });
  call = async (method, route, body, headers = {}) => {
    const response = await handler({ method, url: `http://localhost/api/${route}`, headers: { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250)}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { rawBody: JSON.stringify(body) } : {}) });
    const type = response.headers['Content-Type'];
    return { status: response.status, type, body: type.includes('json') ? JSON.parse(response.body) : response.body };
  };
}
const expect = (result, status, step) => { if (result.status !== status) throw new Error(`${step}: HTTP ${result.status} ${JSON.stringify(result.body?.error || '')}`); return result.body; };
const save = (name, value) => writeFile(new URL(name, out), Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2));
const pct = x => `${(x * 100).toFixed(1)}%`;

console.log(`ReThread backend demo → ${base || 'in-process API with local file storage'}\n`);
const health = expect(await call('GET', 'health'), 200, 'health');
console.log(`health      v${health.version} · features: ${health.features.join(', ')} · image generation ${health.imageGeneration.configured ? `via ${health.imageGeneration.model}` : 'not configured'}`);

const denim = await sample('denim-photo'), autumn = await sample('autumn-photo');
const job = { ...derived(denim.analysis), options: { product: 'tote', objective: 'color', seamAllowanceCm: .7, size: 1, rotation: true } };

const plan = expect(await call('POST', 'plan', job), 200, 'plan');
await save('plan.json', plan);
console.log(`plan        ${plan.plan.title}: ${plan.plan.stats.placed}/${plan.plan.stats.totalPieces} cuts, ${pct(plan.plan.stats.utilization)} of usable fabric · ${plan.analytics.seams.patchworkSeams} patchwork joins`);
console.log(`arrangement same-scrap neighbours ${plan.arrangement.before.sameScrapAdjacencies} → ${plan.arrangement.after.sameScrapAdjacencies}, mean ΔE ${plan.arrangement.before.meanAdjacentDeltaE} → ${plan.arrangement.after.meanAdjacentDeltaE} (${plan.arrangement.swaps} swaps)`);
console.log(`impact      ${plan.impact.fabricReusedCm2} cm² reused ≈ ${plan.impact.estimatedMassG} g ≈ ${plan.impact.avoidedVirginFabric.kgCo2e} kg CO2e avoided (stated assumptions)`);

const chain = expect(await call('POST', 'chain', { ...job, chain: { maxProjects: 5 } }), 200, 'chain');
await save('chain.json', chain);
console.log(`chain       ${chain.projects.map(p => `${p.product}@${Math.round(p.sizeMultiplier * 100)}%`).join(' → ')} · utilization ${pct(chain.summary.firstProjectUtilization)} → ${pct(chain.summary.utilization)} · ${chain.validation.checkedCuts} cuts cross-validated`);
const optimized = expect(await call('POST', 'optimize', { ...job, optimize: { budgetMs: 3000, seed: 1 } }), 200, 'optimize');
await save('optimize.json', optimized);
const offcut = s => `${s.largestOffcut.widthCm} × ${s.largestOffcut.heightCm} cm`;
console.log(`optimize    ${optimized.search.tries} seeded restarts · cuts ${optimized.baseline.score.placed} → ${optimized.score.placed} · largest offcut ${offcut(optimized.baseline.score)} → ${offcut(optimized.score)}`);
const selectedJob = optimized.improved ? { ...job, options: { ...job.options, searchSeed: optimized.seed, grid: optimized.plan.grid } } : job;
const reproduced = expect(await call('POST', 'plan', selectedJob), 200, 'selected layout reproduction');
assert.deepEqual(reproduced.plan.pieces, optimized.plan.pieces);
console.log(`reproduction ${reproduced.plan.pieces.length} selected cuts reproduced exactly by the server`);

// Each donor brings only their three smallest scraps: too little for a tote alone.
const smallest = analysis => analysis.scraps.filter(s => s.usable).sort((a, b) => a.areaPx - b.areaPx).slice(0, 3).map(s => s.id);
const poolRequest = { sources: [{ name: 'Asha', ...derived(denim.analysis, smallest(denim.analysis)) }, { name: 'Ben', ...derived(autumn.analysis, smallest(autumn.analysis)) }, { name: 'Chen', ...derived((await sample('bright-photo')).analysis, smallest((await sample('bright-photo')).analysis)) }],
  options: { product: 'pouch', objective: 'color', size: 1.25 } };
const pool = expect(await call('POST', 'pool', poolRequest), 200, 'pool');
await save('pool.json', pool);
console.log(`pool        ${pool.summary} ${pool.contributions.map(c => `${c.name} ${pct(c.shareOfProject)}`).join(', ')}`);

const concept = expect(await call('POST', 'concept', { ...job, concept: { style: 'studio', generate } }), 200, 'concept');
await save('design-map.png', Buffer.from(concept.designMap.base64, 'base64'));
if (concept.render.generated) await save(`concept-render.${concept.render.mimeType.split('/')[1]}`, Buffer.from(concept.render.base64, 'base64'));
await save('concept.json', { ...concept, designMap: { ...concept.designMap, base64: '(written to design-map.png)' }, render: { ...concept.render, base64: concept.render.base64 ? '(written to concept-render file)' : undefined } });
console.log(`concept     design map written · ${concept.render.generated ? `rendered by ${concept.render.model} in ${concept.render.elapsedMs} ms` : concept.render.reason}`);

const packet = expect(await call('POST', 'packet', selectedJob), 200, 'packet');
await save('maker-packet.pdf', packet);
console.log(`packet      maker-packet.pdf (${(packet.length / 1024).toFixed(0)} KiB)`);

const ready = await call('GET', 'ready');
if (ready.status === 200) {
  const ticket = { 'Idempotency-Key': randomUUID(), 'X-ReThread-Token': randomBytes(32).toString('hex') };
  const saved = expect(await call('POST', 'jobs', selectedJob, ticket), 201, 'save');
  assert.deepEqual(saved.plan.pieces, optimized.plan.pieces);
  const share = expect(await call('POST', `jobs/${saved.jobId}/share`, undefined, { 'X-ReThread-Token': saved.accessToken }), 200, 'share');
  const viewed = expect(await call('GET', `jobs/${saved.jobId}`, undefined, { 'X-ReThread-Token': share.shareToken }), 200, 'viewer read');
  const denied = await call('DELETE', `jobs/${saved.jobId}`, undefined, { 'X-ReThread-Token': share.shareToken });
  await save('saved-packet.pdf', expect(await call('GET', `jobs/${saved.jobId}/packet?paper=letter`, undefined, { 'X-ReThread-Token': share.shareToken }), 200, 'saved packet'));
  expect(await call('DELETE', `jobs/${saved.jobId}`, undefined, { 'X-ReThread-Token': saved.accessToken }), 200, 'owner delete');
  console.log(`receipts    saved ${saved.jobId.slice(0, 8)}… · viewer read as "${viewed.access}" · viewer delete → ${denied.status} · owner delete → 200`);
} else console.log('receipts    storage not ready on this deployment; skipped save/share/delete');
console.log(`\nOutputs: ${fileURLToPath(out)}`);
