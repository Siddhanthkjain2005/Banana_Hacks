// Train FabricNet from scratch on procedurally synthesized textile patches.
//   node scripts/train-fabricnet.mjs [--epochs 10] [--per-epoch 9000] [--workers 2]
// Writes dist/models/fabricnet/fabricnet.json with base64 float32 weights,
// held-out metrics, the confusion matrix, and a SHA-256 of the weights.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCH, initParams, forward, backward, zeroGrads, createAdam } from './lib/cnn.mjs';
import { CLASSES, PATCH, synthesize, mulberry32, makeDataset } from './lib/texture-synth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

if (!isMainThread) {
  parentPort.on('message', ({ params, seed, count }) => {
    const p = params.map(l => ({ w: new Float32Array(l.w), b: new Float32Array(l.b) }));
    const grads = zeroGrads(p), r = mulberry32(seed);
    let loss = 0, correct = 0;
    for (let i = 0; i < count; i++) {
      const label = Math.floor(r() * CLASSES.length), x = synthesize(label, r);
      const result = backward(p, grads, x, label);
      loss += result.loss; if (result.correct) correct++;
    }
    parentPort.postMessage({ grads, loss, correct, count });
  });
} else {
  const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
  const epochs = arg('epochs', 10), perEpoch = arg('per-epoch', 9000), batch = 48, workerCount = Math.max(1, Math.min(arg('workers', 2), os.cpus().length));
  const seed = 20261012, rand = mulberry32(seed), params = initParams(rand), adam = createAdam(params, { lr: 3e-3 });
  const workers = Array.from({ length: workerCount }, () => new Worker(fileURLToPath(import.meta.url)));
  const run = (w, msg) => new Promise(resolve => { w.once('message', resolve); w.postMessage(msg); });
  const validation = makeDataset(250, 99), started = Date.now(), history = [];
  const evaluate = () => {
    const confusion = CLASSES.map(() => CLASSES.map(() => 0)); let correct = 0;
    for (let i = 0; i < validation.n; i++) {
      const x = validation.x.subarray(i * 3 * PATCH * PATCH, (i + 1) * 3 * PATCH * PATCH), probs = forward(params, x), pred = probs.indexOf(Math.max(...probs));
      confusion[validation.y[i]][pred]++; if (pred === validation.y[i]) correct++;
    }
    return { accuracy: correct / validation.n, confusion };
  };
  const steps = epochs * Math.ceil(perEpoch / batch); let step = 0, batchSeed = 1;
  for (let epoch = 1; epoch <= epochs; epoch++) {
    let loss = 0, correct = 0, seen = 0;
    for (let b = 0; b < perEpoch; b += batch) {
      const share = Math.ceil(batch / workerCount), snapshot = params.map(l => ({ w: l.w, b: l.b }));
      const results = await Promise.all(workers.map(w => run(w, { params: snapshot, seed: seed + batchSeed++ * 7919, count: share })));
      const total = zeroGrads(params); let n = 0;
      for (const r of results) { r.grads.forEach((g, li) => { for (const k of ['w', 'b']) for (let i = 0; i < g[k].length; i++) total[li][k][i] += g[k][i]; }); loss += r.loss; correct += r.correct; n += r.count; }
      seen += n;
      const rate = 3e-3 * .5 * (1 + Math.cos(Math.PI * step / steps)) + 5e-5; step++;
      adam.step(total, 1 / n, rate);
    }
    const val = evaluate();
    history.push({ epoch, trainLoss: +(loss / seen).toFixed(4), trainAccuracy: +(correct / seen).toFixed(4), validationAccuracy: +val.accuracy.toFixed(4) });
    console.log(`epoch ${epoch}/${epochs}  loss ${(loss / seen).toFixed(3)}  train ${(100 * correct / seen).toFixed(1)}%  held-out ${(100 * val.accuracy).toFixed(1)}%  ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  workers.forEach(w => w.terminate());
  const final = evaluate(), test = makeDataset(250, 4242), confusion = CLASSES.map(() => CLASSES.map(() => 0)); let testCorrect = 0;
  for (let i = 0; i < test.n; i++) { const probs = forward(params, test.x.subarray(i * 3072, (i + 1) * 3072)), pred = probs.indexOf(Math.max(...probs)); confusion[test.y[i]][pred]++; if (pred === test.y[i]) testCorrect++; }
  const tensors = [], buffers = [];
  params.forEach((p, i) => { for (const key of ['w', 'b']) { const bytes = Buffer.from(p[key].buffer.slice(0)); buffers.push(bytes); tensors.push({ layer: i, key, length: p[key].length, data: bytes.toString('base64') }); } });
  const sha256 = createHash('sha256').update(Buffer.concat(buffers)).digest('hex');
  const model = {
    name: 'FabricNet', version: '1.0.0', task: 'Textile surface pattern classification from 32 × 32 RGB patches',
    classes: CLASSES, input: { size: PATCH, channels: 3, layout: 'CHW', normalization: 'per-patch channel mean removed, then × 4', scales: ['1:1 crop of 32 px', '64 px crop box-downsampled 2×'] },
    architecture: ARCH, parameters: params.reduce((s, p) => s + p.w.length + p.b.length, 0),
    training: {
      data: 'Procedurally synthesized textile patches (scripts/lib/texture-synth.mjs): solid, textured weave/slub/heather/denim, stripes, checks/plaids, dots, and floral or irregular prints, with random colour, orientation, scale, blur, lighting, and sensor noise. No photographs were used.',
      samples: epochs * perEpoch, epochs, perEpochFreshSamples: perEpoch, batch, optimizer: 'Adam with cosine learning-rate decay and L2 weight decay', seed, seconds: Math.round((Date.now() - started) / 1000), history,
      implementation: 'Hand-written forward/backward passes in JavaScript (scripts/lib/cnn.mjs); no ML framework.',
    },
    evaluation: { syntheticHeldOutAccuracy: +(testCorrect / test.n).toFixed(4), samples: test.n, seed: 4242, confusion, note: 'Measured on freshly generated synthetic patches. Accuracy on real photographs has not been measured and will be lower.' },
    limitations: ['Trained only on synthetic textures; classifies visual pattern, not fibre content, weight, or strength.', 'Fine weaves below the photo resolution look solid.', 'Large motifs bigger than the patch can look like solids or prints.'],
    weights: { encoding: 'base64 little-endian float32', sha256, tensors },
  };
  const out = path.join(here, '..', 'dist', 'models', 'fabricnet', 'fabricnet.json');
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(model));
  console.log(`held-out synthetic accuracy ${(100 * testCorrect / test.n).toFixed(1)}% · ${model.parameters} parameters · sha256 ${sha256.slice(0, 12)}… → ${path.relative(process.cwd(), out)}`);
  void final;
}
