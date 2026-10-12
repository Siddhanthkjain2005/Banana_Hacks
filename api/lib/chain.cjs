'use strict';

const { leftoverScraps, largestRectangle, usableOf } = require('./analytics.cjs');

const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
const PRODUCTS = ['pouch', 'cushion', 'tote'];
// The engine's grid preference for each objective, capped at 3 × 3 patches per
// panel for chained projects: finer grids mean far more sewing for a bonus
// project and dominate search time when offcuts are fragmented.
const GRIDS = {
  color: [[3, 3], [2, 2], [3, 2], [2, 3], [1, 1]],
  waste: [[1, 1], [2, 2], [3, 2], [2, 3], [3, 3]],
  balanced: [[2, 2], [3, 2], [2, 3], [1, 1], [3, 3]],
};
const copy = scraps => scraps.map(s => ({ ...s }));
const overlaps = (a, b) => a.x < b.x + b.occupiedPixelWidth && a.x + a.occupiedPixelWidth > b.x && a.y < b.y + b.occupiedPixelHeight && a.y + a.occupiedPixelHeight > b.y;

/** Exact "does a w×h rectangle of usable pixels exist anywhere" test, cached per size. */
function fitIndex(scrap) {
  const { width: w, height: h } = scrap.bbox, stride = w + 1, integral = new Uint32Array(stride * (h + 1)), cache = new Map();
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) { run += scrap.usableMask[y * w + x] ? 0 : 1; integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + run; }
  }
  return (rw, rh) => {
    const key = `${rw}x${rh}`;
    if (cache.has(key)) return cache.get(key);
    let found = false;
    for (let y = 0; !found && y <= h - rh; y++) for (let x = 0; x <= w - rw; x++) {
      if (integral[(y + rh) * stride + x + rw] - integral[y * stride + x + rw] - integral[(y + rh) * stride + x] + integral[y * stride + x] === 0) { found = true; break; }
    }
    cache.set(key, found);
    return found;
  };
}

/**
 * Necessary conditions for a grid: the total cut area fits in the leftover
 * usable area, and every distinct patch size fits somewhere in some leftover.
 * Patch sizes come from the engine itself (an empty-scrap plan lists every
 * required cut as unplaced), so product geometry is never duplicated here.
 */
function gridCheck(core, scraps, fits, usableCm2, options) {
  const patches = core.optimizePattern([], options).unplaced;
  const requiredAreaCm2 = patches.reduce((t, p) => t + p.cutWidthCm * p.cutHeightCm, 0);
  if (!patches.length || requiredAreaCm2 > usableCm2) return { fits: false, requiredAreaCm2 };
  const sizes = new Map(patches.map(p => [`${p.cutWidthCm}x${p.cutHeightCm}`, p]));
  return { requiredAreaCm2, fits: [...sizes.values()].every(p => scraps.some((s, i) => {
    const w = Math.ceil(p.cutWidthCm * s.pixelsPerCm - 1e-7), h = Math.ceil(p.cutHeightCm * s.pixelsPerCm - 1e-7);
    return fits[i](w, h) || options.rotation && fits[i](h, w);
  })) };
}

/**
 * Independent validation across every chained project: each cut must lie in
 * the original conservative usable mask, and no two cuts from any project may
 * share fabric. This does not rely on the per-round leftover masks being right.
 */
function validateCuts(projects, originals, isPieceContained) {
  const byId = new Map(originals.map(s => [s.id, s])), all = projects.flatMap(p => p.plan.pieces);
  const problems = [];
  all.forEach((piece, i) => {
    if (!byId.has(piece.scrapId) || !isPieceContained(piece, byId.get(piece.scrapId))) problems.push(`${piece.id} is outside its scrap's usable mask.`);
    for (let j = 0; j < i; j++) if (all[j].scrapId === piece.scrapId && overlaps(piece, all[j])) problems.push(`${piece.id} overlaps another chained cut.`);
  });
  return { validated: problems.length === 0, checkedCuts: all.length, problems: problems.slice(0, 10) };
}

/**
 * Zero-waste project chain: make the requested product, then repeatedly plan
 * the complete product (and size) that uses the most of the remaining offcuts.
 * Greedy and deterministic; it does not claim a globally optimal sequence.
 * The search stops early, keeping the projects found, when budgetMs runs out.
 */
function planChain(measured, core, chainOptions, checkDeadline = () => {}, budgetMs = 10000) {
  const { options } = measured, originals = measured.scraps.filter(s => s.usable), started = Date.now();
  originals.forEach(usableOf);
  const availableAreaCm2 = originals.reduce((t, s) => t + s.usableAreaPx / s.pixelsPerCm ** 2, 0);
  const sizes = [...new Set([.5, .75, 1, options.size])].filter(s => s <= options.size + 1e-9 && s >= chainOptions.minSize - 1e-9).sort((a, b) => a - b);
  const grids = GRIDS[options.objective] || GRIDS.balanced;
  let current = originals, stopReason = `Reached the requested maximum of ${chainOptions.maxProjects} projects.`, attempts = 0;
  const projects = [];
  const outOfTime = () => Date.now() - started > budgetMs;

  /**
   * Smallest product first, smallest-to-largest sizes; a product stops growing
   * at its first size that does not fit. A complete plan uses exactly its
   * required cut area, so candidates that cannot exceed the best are skipped.
   */
  function bestNext() {
    const usable = current.filter(s => s.usableAreaPx > 0), fits = usable.map(fitIndex);
    const usableCm2 = usable.reduce((t, s) => t + s.usableAreaPx / s.pixelsPerCm ** 2, 0);
    let best = null;
    for (const product of PRODUCTS) for (const size of sizes) {
      let found = null, cannotBeatBest = false;
      for (const [cols, rows] of grids) {
        if (outOfTime()) return { best, timedOut: true };
        checkDeadline();
        const settings = { ...options, product, size, grid: { cols, rows } }, check = gridCheck(core, usable, fits, usableCm2, settings);
        if (!check.fits) continue;
        if (best && check.requiredAreaCm2 <= best.plan.stats.usedAreaCm2 + 1e-6) { cannotBeatBest = true; continue; }
        attempts++;
        const plan = core.optimizePattern(copy(usable), settings);
        if (plan.feasible && plan.validated) { found = plan; break; }
      }
      if (found) { if (!best || found.stats.usedAreaCm2 > best.plan.stats.usedAreaCm2 + 1e-6) best = { plan: found, product, size }; continue; }
      if (!cannotBeatBest) break;
    }
    return { best, timedOut: false };
  }

  for (let step = 0; step < chainOptions.maxProjects; step++) {
    let best = null, timedOut = false;
    if (step === 0) {
      // The first project is exactly what /plan returns for the requested settings.
      attempts++;
      const plan = core.optimizePattern(copy(current), options);
      if (plan.feasible && plan.validated) best = { plan, product: options.product, size: options.size };
    }
    if (!best) ({ best, timedOut } = bestNext());
    if (!best) {
      stopReason = timedOut ? 'The search time budget was reached; the projects found so far are complete and validated.'
        : step === 0 ? 'No complete project fits this fabric at the allowed sizes.' : 'No further complete project fits the remaining offcuts at the allowed sizes.';
      break;
    }
    projects.push({ step: step + 1, product: best.product, sizeMultiplier: best.size, title: best.plan.title,
      reason: step === 0 ? (best.product === options.product && best.size === options.size ? 'Requested product.' : 'The requested product did not fit; this complete project uses the most fabric.') : 'Uses the most remaining offcut area among complete projects found.',
      usedAreaCm2: best.plan.stats.usedAreaCm2, plan: best.plan });
    current = leftoverScraps(current, best.plan.pieces);
  }
  const validation = validateCuts(projects, originals, core.isPieceContained);
  const usedAreaCm2 = projects.reduce((t, p) => t + p.plan.stats.usedAreaCm2, 0);
  const leftovers = current.map(s => {
    const rect = largestRectangle(s.usableMask, s.bbox.width, s.bbox.height);
    return { id: s.id, label: s.label, color: s.color, usableCm2: round(s.usableAreaPx / s.pixelsPerCm ** 2), largestRectangleCm: { width: round(rect.width / s.pixelsPerCm, 1), height: round(rect.height / s.pixelsPerCm, 1) } };
  });
  return {
    projects, validation, stopReason,
    summary: { projectCount: projects.length, usedAreaCm2: round(usedAreaCm2), availableAreaCm2: round(availableAreaCm2),
      utilization: availableAreaCm2 ? round(usedAreaCm2 / availableAreaCm2, 4) : 0,
      firstProjectUtilization: projects.length && availableAreaCm2 ? round(projects[0].plan.stats.usedAreaCm2 / availableAreaCm2, 4) : 0,
      remainingUsableCm2: round(leftovers.reduce((t, s) => t + s.usableCm2, 0)), plannerRuns: attempts, searchMs: Date.now() - started },
    leftovers,
    method: 'Greedy chain over complete, validated plans. Leftover masks remove each cut plus a one-pixel border, matching the engine’s conservative erosion. Chained projects use up to 3 × 3 patches per panel, and a grid is tried only when every patch size provably fits a leftover.',
  };
}

module.exports = { planChain, validateCuts };
