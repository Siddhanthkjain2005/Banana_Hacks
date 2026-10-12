'use strict';

const { bad, exactKeys, numberInRange } = require('./http.cjs');

const MAX_PIXELS = 1600 * 1600;
const MAX_SCRAPS = 48;
const MAX_POOL_SOURCES = 8;
const SCRAP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SLIMSAM = { modelId: 'Xenova/slimsam-77-uniform', revision: '5850ab45f587c112167512ffef949107115e26a0', precision: 'int8', runtime: 'Transformers.js 2.17.2' };
const PRODUCTS = ['tote', 'pouch', 'cushion'];
const OBJECTIVES = ['balanced', 'waste', 'color'];
const CONCEPT_STYLES = ['studio', 'lifestyle', 'flatlay', 'sketch'];
const plainText = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

function validateOptions(rawOptions = {}) {
  exactKeys(rawOptions, ['product', 'seamAllowanceCm', 'rotation', 'size', 'objective'], 'Options');
  const product = rawOptions.product ?? 'tote';
  const objective = rawOptions.objective ?? 'balanced';
  if (!PRODUCTS.includes(product)) bad('Product must be tote, pouch, or cushion.');
  if (!OBJECTIVES.includes(objective)) bad('Objective must be balanced, waste, or color.');
  if (rawOptions.rotation !== undefined && typeof rawOptions.rotation !== 'boolean') bad('Rotation must be true or false.');
  return { product, objective, rotation: rawOptions.rotation ?? true,
    seamAllowanceCm: numberInRange(rawOptions.seamAllowanceCm ?? .7, .4, 1.5, 'Seam allowance'),
    size: numberInRange(rawOptions.size ?? 1, .5, 1.25, 'Design size multiplier') };
}

function validateProvenance(raw, width, height) {
  const analysisProvenance = raw || { engine: 'color-vision' };
  exactKeys(analysisProvenance, ['engine', 'modelId', 'revision', 'precision', 'runtime', 'elapsedMs', 'prompt'], 'Analysis provenance');
  if (!['color-vision', 'slimsam'].includes(analysisProvenance.engine)) bad('Unsupported image analysis engine.');
  if (analysisProvenance.engine === 'slimsam') {
    if (analysisProvenance.modelId !== SLIMSAM.modelId || analysisProvenance.revision !== SLIMSAM.revision || analysisProvenance.precision !== SLIMSAM.precision || analysisProvenance.runtime !== SLIMSAM.runtime) bad('Use the pinned SlimSAM model provenance.');
    numberInRange(analysisProvenance.elapsedMs, 0, 90000, 'Neural elapsed time');
    if (!Array.isArray(analysisProvenance.prompt) || analysisProvenance.prompt.length !== 2) bad('Neural provenance needs one source-image prompt point.');
    numberInRange(analysisProvenance.prompt[0], 0, width - 1, 'Prompt x'); numberInRange(analysisProvenance.prompt[1], 0, height - 1, 'Prompt y');
  } else if (Object.keys(analysisProvenance).length !== 1) bad('Color vision provenance only contains the engine.');
  return analysisProvenance;
}

/**
 * Decode one photograph's untrusted local-bbox RLE masks and recompute every
 * calibrated measurement. `budget` is shared across photographs in a pool so
 * the combined decoded allocation stays bounded.
 */
function measureSource(source, excluded, budget = { pixels: 0, scraps: 0 }) {
  exactKeys(source.image, ['width', 'height', 'sceneWidthCm'], 'Image metadata');
  const width = numberInRange(source.image.width, 12, 1600, 'Image width', true);
  const height = numberInRange(source.image.height, 12, 1600, 'Image height', true);
  const sceneWidthCm = numberInRange(source.image.sceneWidthCm, 10, 300, 'Scene width');
  const pixelsPerCm = width / sceneWidthCm;
  if (!Array.isArray(source.scraps) || source.scraps.length > MAX_SCRAPS) bad('Provide at most 48 derived scraps.');
  budget.scraps += source.scraps.length;
  if (budget.scraps > MAX_SCRAPS) bad('Provide at most 48 derived scraps in total.');
  const excludedSet = new Set(excluded), seenIds = new Set(), occupied = new Uint8Array(width * height);
  let detectedAreaPx = 0;
  const scraps = source.scraps.map((s, index) => {
    exactKeys(s, ['id', 'label', 'color', 'bbox', 'maskRle', 'usable'], `Scrap ${index + 1}`);
    if (typeof s.id !== 'string' || !SCRAP_ID_RE.test(s.id) || seenIds.has(s.id)) bad('Scrap IDs must be unique letters, numbers, underscores, or hyphens (1–64 characters).');
    seenIds.add(s.id);
    if (s.label !== undefined && !plainText(s.label, 80)) bad('Scrap labels must be text of at most 80 characters without control characters.');
    if (typeof s.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(s.color)) bad('Scrap colors must be six-digit hex colors.');
    if (s.usable !== undefined && typeof s.usable !== 'boolean') bad('Scrap usable must be true or false.');
    exactKeys(s.bbox, ['x', 'y', 'width', 'height'], 'Scrap bounding box');
    const x = numberInRange(s.bbox.x, 0, width - 1, 'Bounding box x', true);
    const y = numberInRange(s.bbox.y, 0, height - 1, 'Bounding box y', true);
    const bw = numberInRange(s.bbox.width, 1, width, 'Bounding box width', true);
    const bh = numberInRange(s.bbox.height, 1, height, 'Bounding box height', true);
    if (x + bw > width || y + bh > height) bad('Every scrap bounding box must stay inside the source image.');
    budget.pixels += bw * bh;
    if (budget.pixels > MAX_PIXELS) bad('Combined decoded mask dimensions must not exceed 2.56 million pixels.');
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
  return { image: { width, height, sceneWidthCm, sceneHeightCm: height / pixelsPerCm, pixelsPerCm }, scraps, detectedAreaPx };
}

function validateExcluded(value) {
  const excluded = value ?? [];
  if (!Array.isArray(excluded) || excluded.length > MAX_SCRAPS || excluded.some(id => typeof id !== 'string' || !SCRAP_ID_RE.test(id)) || new Set(excluded).size !== excluded.length) bad('Excluded scrap IDs must be a unique list of measured scrap IDs.');
  return excluded;
}

const sourceMetrics = (scraps, detectedAreaPx, pixelsPerCm) => ({ inputScrapCount: scraps.length, usableScrapCount: scraps.filter(s => s.usable).length,
  excludedScrapCount: scraps.filter(s => !s.usable).length, detectedAreaPx, detectedAreaCm2: detectedAreaPx / pixelsPerCm ** 2 });

/**
 * Validate a single-photograph job. `extraKeys` lets feature endpoints accept
 * their own optional sections; the saved-job route accepts none.
 */
function validateJobPayload(payload, extraKeys = []) {
  exactKeys(payload, ['image', 'scraps', 'options', 'excludedScrapIds', 'analysisProvenance', ...extraKeys], 'Job');
  exactKeys(payload.image, ['width', 'height', 'sceneWidthCm'], 'Image metadata');
  const width = numberInRange(payload.image.width, 12, 1600, 'Image width', true);
  const height = numberInRange(payload.image.height, 12, 1600, 'Image height', true);
  numberInRange(payload.image.sceneWidthCm, 10, 300, 'Scene width');
  const analysisProvenance = validateProvenance(payload.analysisProvenance, width, height);
  if (!Array.isArray(payload.scraps) || payload.scraps.length > MAX_SCRAPS) bad('Provide at most 48 derived scraps.');
  const options = validateOptions(payload.options ?? {});
  const excluded = validateExcluded(payload.excludedScrapIds);
  const { image, scraps, detectedAreaPx } = measureSource(payload, excluded);
  return { image, scraps, options, analysisProvenance, excludedScrapIds: excluded, metrics: sourceMetrics(scraps, detectedAreaPx, image.pixelsPerCm) };
}

/** Optional impact assumptions. Defaults are documented in impact.cjs. */
function validateImpactOptions(raw) {
  if (raw === undefined) return {};
  exactKeys(raw, ['fabricGsm', 'kgCo2ePerKg', 'waterLitresPerKg'], 'Impact assumptions');
  const result = {};
  if (raw.fabricGsm !== undefined) result.fabricGsm = numberInRange(raw.fabricGsm, 30, 600, 'Fabric weight (g/m²)');
  if (raw.kgCo2ePerKg !== undefined) result.kgCo2ePerKg = numberInRange(raw.kgCo2ePerKg, 0, 100, 'Emission factor (kg CO2e/kg)');
  if (raw.waterLitresPerKg !== undefined) result.waterLitresPerKg = numberInRange(raw.waterLitresPerKg, 0, 100000, 'Water factor (L/kg)');
  return result;
}

function validateConceptOptions(raw) {
  if (raw === undefined) return { style: 'studio', generate: true };
  exactKeys(raw, ['style', 'generate'], 'Concept options');
  const style = raw.style ?? 'studio';
  if (!CONCEPT_STYLES.includes(style)) bad(`Concept style must be one of ${CONCEPT_STYLES.join(', ')}.`);
  if (raw.generate !== undefined && typeof raw.generate !== 'boolean') bad('Concept generate must be true or false.');
  return { style, generate: raw.generate !== false };
}

function validateChainOptions(raw) {
  if (raw === undefined) return { maxProjects: 3, minSize: .5 };
  exactKeys(raw, ['maxProjects', 'minSize'], 'Chain options');
  return { maxProjects: numberInRange(raw.maxProjects ?? 3, 1, 5, 'Maximum chained projects', true),
    minSize: numberInRange(raw.minSize ?? .5, .5, 1.25, 'Minimum chained design size') };
}

/**
 * A community pool combines derived masks from several photographs, each with
 * its own calibration. Scrap IDs are namespaced per donor so cuts stay traceable.
 */
function validatePoolPayload(payload) {
  exactKeys(payload, ['sources', 'options', 'impact'], 'Pool');
  if (!Array.isArray(payload.sources) || payload.sources.length < 2 || payload.sources.length > MAX_POOL_SOURCES) bad(`A pool needs between 2 and ${MAX_POOL_SOURCES} photographed sources.`);
  const options = validateOptions(payload.options ?? {});
  const budget = { pixels: 0, scraps: 0 }, scraps = [], donors = [];
  payload.sources.forEach((source, index) => {
    exactKeys(source, ['name', 'image', 'scraps', 'excludedScrapIds', 'analysisProvenance'], `Source ${index + 1}`);
    if (source.name !== undefined && (!plainText(source.name, 60) || !source.name.trim())) bad('Donor names must be 1–60 characters without control characters.');
    const excluded = validateExcluded(source.excludedScrapIds);
    const measured = measureSource(source, excluded, budget), donorId = `d${index + 1}`;
    const analysisProvenance = validateProvenance(source.analysisProvenance, measured.image.width, measured.image.height);
    const name = source.name?.trim() || `Donor ${index + 1}`;
    measured.scraps.forEach(s => {
      const id = `${donorId}-${s.id}`;
      if (!SCRAP_ID_RE.test(id)) bad('Pooled scrap IDs must stay within 64 characters; shorten the source scrap IDs.');
      scraps.push({ ...s, id, sourceScrapId: s.id, donorId, label: `${s.label} (${name})` });
    });
    donors.push({ donorId, name, image: measured.image, analysisProvenance, excludedScrapIds: excluded,
      metrics: sourceMetrics(measured.scraps, measured.detectedAreaPx, measured.image.pixelsPerCm) });
  });
  return { donors, scraps, options, impact: validateImpactOptions(payload.impact) };
}

module.exports = { validateJobPayload, validatePoolPayload, validateImpactOptions, validateConceptOptions, validateChainOptions,
  constants: { MAX_PIXELS, MAX_SCRAPS, MAX_POOL_SOURCES, PRODUCTS, OBJECTIVES, CONCEPT_STYLES, SLIMSAM } };
