import { analyzeImage, optimizePattern, refineScrapMask } from './vision.js';
import { recommendProducts } from './recommend.js';
import { loadFabricNet, analyzeFabric, fabricSummary } from './fabric-intel.js';

let analysis, imageData, netPromise, queue = Promise.resolve();
const extra = new Map();
const getNet = () => netPromise ||= fetch(new URL('./models/fabricnet/fabricnet.json', import.meta.url)).then(r => { if (!r.ok) throw Error('missing'); return r.json(); }).then(loadFabricNet).catch(() => null);

// FabricNet pattern classes and grain estimates are attached to each scrap.
// The planner uses `directional` and `grainDeviationDeg`; the rest is shown.
async function attachFabric(target, pixels) {
  const net = await getNet(), intel = analyzeFabric(pixels, target.scraps, net);
  const byId = new Map(intel.scraps.map(r => [r.scrapId, r]));
  target.scraps.forEach(s => { const r = byId.get(s.id); s.fabric = r ? { ...r, ...fabricSummary(r) } : undefined; });
  target.fabricIntel = { model: intel.model, elapsedMs: intel.elapsedMs };
  return target;
}

async function handle(data) {
  try {
    if (data.type === 'analyze') { imageData = data.imageData; analysis = await attachFabric(analyzeImage(data.imageData, { sceneWidthCm: data.sceneWidthCm }), imageData); }
    if (data.type === 'analyze-extra') {
      // A second photograph for community pooling; it never replaces the main analysis.
      const result = await attachFabric(analyzeImage(data.imageData, { sceneWidthCm: data.sceneWidthCm }), data.imageData);
      extra.set(data.key, result);
      self.postMessage({ requestId: data.requestId, analysis: result }); return;
    }
    if (!analysis) throw Error('Analyze a fabric photo first.');
    if (data.type === 'refine') analysis = await attachFabric(refineScrapMask(analysis, data.scrapId, data.foregroundMask, data.modelProvenance), imageData);
    const scraps = analysis.scraps.filter(s => !(data.excludedIds || []).includes(s.id));
    if (data.type === 'recommend') { self.postMessage({ requestId: data.requestId, recommendations: recommendProducts(scraps, data.options || {}) }); return; }
    const plan = optimizePattern(scraps, data.options || {});
    plan.excludedScrapIds = data.excludedIds || [];
    self.postMessage({ requestId: data.requestId, analysis: ['analyze', 'refine'].includes(data.type) ? analysis : null, plan });
  } catch (error) {
    self.postMessage({ requestId: data.requestId, error: error.message });
  }
}

self.onmessage = ({ data }) => { queue = queue.then(() => handle(data)); };
