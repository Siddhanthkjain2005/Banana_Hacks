import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { analyzeImage, optimizePattern } from '../dist/vision.js';
import { loadFabricNet, classifyPatch, analyzeFabric, fabricSummary, textureGrain, edgeGrain } from '../dist/fabric-intel.js';
import { forward, initParams } from '../scripts/lib/cnn.mjs';
import { CLASSES, makeDataset, stripeImage, mulberry32, PATCH } from '../scripts/lib/texture-synth.mjs';

const require = createRequire(import.meta.url);
const { decodePNG } = require('../api/lib/png.cjs');
const { createHandler } = require('../api/lib/service.cjs');
const model = JSON.parse(readFileSync(new URL('../dist/models/fabricnet/fabricnet.json', import.meta.url)));
const net = loadFabricNet(model);
const angleError = (a, b) => Math.abs((((a - b + 45) % 90) + 90) % 90 - 45);

let patternSample;
function analyzedPatternSample() {
  if (patternSample) return patternSample;
  const image = decodePNG(readFileSync(new URL('../dist/assets/sample-patterns.png', import.meta.url)));
  const analysis = analyzeImage(image, { sceneWidthCm: 90 }), intel = analyzeFabric(image, analysis.scraps, net);
  analysis.scraps.forEach(s => { const r = intel.scraps.find(x => x.scrapId === s.id); s.fabric = { ...r, ...fabricSummary(r) }; });
  return (patternSample = { image, analysis, intel });
}

test('FabricNet weights match their recorded SHA-256 and architecture', () => {
  const bytes = Buffer.concat(model.weights.tensors.map(t => Buffer.from(t.data, 'base64')));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), model.weights.sha256);
  assert.deepEqual(model.classes, CLASSES);
  assert.equal(model.parameters, model.weights.tensors.reduce((s, t) => s + t.length, 0));
  assert.ok(model.evaluation.syntheticHeldOutAccuracy >= .9, 'recorded held-out accuracy');
});

test('browser inference reproduces the training forward pass exactly', () => {
  const params = model.architecture.map(() => ({}));
  for (const t of model.weights.tensors) params[t.layer][t.key] = new Float32Array(Uint8Array.from(Buffer.from(t.data, 'base64')).buffer);
  const { x } = makeDataset(2, 31);
  for (let i = 0; i < CLASSES.length * 2; i++) {
    const patch = x.subarray(i * 3 * PATCH * PATCH, (i + 1) * 3 * PATCH * PATCH), a = forward(params, patch), b = classifyPatch(net, patch);
    a.forEach((p, k) => assert.ok(Math.abs(p - b[k]) < 1e-5));
  }
  // An untrained network is not accidentally accurate: training matters.
  const random = initParams(mulberry32(1)), probs = forward(random, x.subarray(0, 3 * PATCH * PATCH));
  assert.ok(Math.max(...probs) < .9);
});

test('FabricNet classifies freshly synthesized textile patches it never saw', () => {
  const { x, y, n } = makeDataset(40, 777);
  let correct = 0;
  for (let i = 0; i < n; i++) { const p = classifyPatch(net, x.subarray(i * 3072, (i + 1) * 3072)); if (p.indexOf(Math.max(...p)) === y[i]) correct++; }
  assert.ok(correct / n >= .9, `accuracy ${(correct / n).toFixed(3)}`);
});

test('pattern-orientation grain estimate recovers known stripe angles within 1.5°', () => {
  for (const angle of [-38, -17, -6, 0, 3, 9, 24, 44]) for (const period of [7, 15, 26]) {
    const r = textureGrain(stripeImage(64, angle, period), { x: 0, y: 0, size: 64 });
    assert.ok(angleError(r.deviationDeg, angle) <= 1.5, `${angle}° / ${period}px → ${r.deviationDeg}°`);
    assert.ok(r.confidence > .5);
  }
});

test('edge grain estimate reads a rotated rectangular outline', () => {
  for (const angle of [-12, 0, 7, 30]) {
    const a = angle * Math.PI / 180, pts = [[-80, -50], [80, -50], [80, 50], [-80, 50]].map(([x, y]) => ({ x: 200 + x * Math.cos(a) - y * Math.sin(a), y: 200 + x * Math.sin(a) + y * Math.cos(a) }));
    const r = edgeGrain(pts);
    assert.ok(angleError(r.deviationDeg, angle) <= 1, `${angle}° → ${r.deviationDeg}°`);
    assert.ok(r.confidence > .9);
  }
});

test('the Pattern mix sample is classified and its known rotations are recovered', () => {
  const { analysis } = analyzedPatternSample();
  const byPattern = analysis.scraps.map(s => s.fabric.pattern);
  for (const expected of ['stripe', 'check', 'dot', 'print']) assert.ok(byPattern.includes(expected), `found ${expected} in ${byPattern}`);
  const stripes = analysis.scraps.filter(s => s.fabric.pattern === 'stripe').map(s => s.fabric.grainDeviationDeg).sort((a, b) => a - b);
  assert.equal(stripes.length, 2);
  assert.ok(angleError(stripes[0], -6) <= 1, `stripe ${stripes[0]}`);
  assert.ok(angleError(stripes[1], 9) <= 1, `pinstripe ${stripes[1]}`);
  const check = analysis.scraps.find(s => s.fabric.pattern === 'check');
  assert.ok(angleError(check.fabric.grainDeviationDeg, 2) <= 1.5);
  assert.ok(analysis.scraps.every(s => !s.quality.touchesBorder));
});

test('grain-aware planning locks rotation on stripes and annotates off-grain cuts', () => {
  const { analysis } = analyzedPatternSample();
  const plan = optimizePattern(analysis.scraps, { product: 'tote', objective: 'color' });
  assert.equal(plan.feasible, true);
  const locked = new Set(plan.stats.grain.rotationLockedScraps);
  assert.ok(locked.size >= 1);
  assert.ok(plan.pieces.filter(p => locked.has(p.scrapId)).every(p => !p.rotated), 'directional fabric is never rotated');
  assert.ok(plan.pieces.every(p => typeof p.grainConstraint === 'string' && /grain/i.test(p.grainConstraint)));
  const offGrain = plan.pieces.filter(p => Math.abs(p.grainDeviationDeg) > 7);
  assert.equal(offGrain.length, plan.stats.grain.offGrainCuts);
  const unaware = optimizePattern(analysis.scraps, { product: 'tote', objective: 'color', grainAware: false });
  assert.deepEqual(unaware.stats.grain.rotationLockedScraps, []);
  assert.ok(unaware.pieces.every(p => p.grainConstraint.startsWith('Unverified') || p.grainConstraint.startsWith('Place length')));
});

test('the server accepts FabricNet summaries, rejects malformed ones, and reproduces the grain-aware plan', async () => {
  const { analysis } = analyzedPatternSample(), handler = createHandler({ env: {} });
  const rle = mask => { const out = []; for (let i = 0; i < mask.length;) { if (!mask[i]) { i++; continue; } const s = i; while (i < mask.length && mask[i]) i++; out.push(s, i - s); } return out; };
  const body = fabric => ({ image: { width: analysis.width, height: analysis.height, sceneWidthCm: 90 },
    scraps: analysis.scraps.map(s => ({ id: s.id, label: s.label, color: s.color, bbox: s.bbox, usable: s.usable, maskRle: rle(s.mask), fabric: fabric(s) })),
    options: { product: 'tote', objective: 'color', seamAllowanceCm: .7, rotation: true, size: 1, grainAware: true } });
  const call = async payload => handler({ method: 'POST', url: 'https://rethread.test/api/plan', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7' }, body: JSON.stringify(payload) });
  const ok = await call(body(s => fabricSummary(s.fabric))), result = JSON.parse(ok.body);
  assert.equal(ok.status, 200);
  const local = optimizePattern(analysis.scraps, { product: 'tote', objective: 'color' });
  assert.equal(result.plan.pieces.length, local.pieces.length);
  assert.deepEqual(result.plan.pieces.map(p => [p.id, p.scrapId, p.x, p.y, p.rotated]), local.pieces.map(p => [p.id, p.scrapId, p.x, p.y, p.rotated]));
  assert.deepEqual(result.plan.stats.grain.rotationLockedScraps, local.stats.grain.rotationLockedScraps);
  const bad = await call(body(s => ({ ...fabricSummary(s.fabric), pattern: 'tartan' })));
  assert.equal(bad.status, 400);
  const extra = await call(body(s => ({ ...fabricSummary(s.fabric), probabilities: {} })));
  assert.equal(extra.status, 400);
});
