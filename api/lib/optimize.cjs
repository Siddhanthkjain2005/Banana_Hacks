'use strict';

const { planAnalytics } = require('./analytics.cjs');

/**
 * Deep search for a better layout of the same product and patch grid.
 *
 * The browser runs one deterministic greedy pass. On the server we spend a
 * bounded time budget on seeded restarts: each restart visits equal-size cuts
 * in a different order and perturbs scrap preferences, and every candidate is
 * produced and validated by the same mask-containment engine. Candidates are
 * ranked lexicographically by
 *   1. a complete, validated plan,
 *   2. more cuts placed,
 *   3. the largest single rectangle left in any offcut (the most reusable piece),
 *   4. fewer scraps cut into (more pieces left whole),
 *   5. more total usable leftover.
 * This is a randomized multi-start heuristic, not a proof of optimality.
 */
function scorePlan(plan, scraps) {
  const analytics = planAnalytics(plan, scraps);
  let largest = { widthCm: 0, heightCm: 0, areaCm2: 0, scrapId: null };
  for (const s of analytics.perScrap) {
    const r = s.largestLeftoverRectangleCm, area = r ? r.width * r.height : 0;
    if (area > largest.areaCm2) largest = { widthCm: r.width, heightCm: r.height, areaCm2: Math.round(area * 10) / 10, scrapId: s.id };
  }
  const leftoverCm2 = analytics.perScrap.reduce((t, s) => t + s.leftoverUsableCm2, 0);
  return {
    feasible: plan.feasible && plan.validated, placed: plan.pieces.length, total: plan.stats.totalPieces,
    largestOffcut: largest, scrapsUsed: plan.stats.scrapsUsed, scrapsUntouched: scraps.filter(s => s.usable !== false).length - plan.stats.scrapsUsed,
    leftoverUsableCm2: Math.round(leftoverCm2 * 10) / 10, utilization: Math.round(plan.stats.utilization * 10000) / 10000,
  };
}

function better(a, b) {
  if (a.feasible !== b.feasible) return a.feasible;
  if (a.placed !== b.placed) return a.placed > b.placed;
  if (Math.abs(a.largestOffcut.areaCm2 - b.largestOffcut.areaCm2) > .5) return a.largestOffcut.areaCm2 > b.largestOffcut.areaCm2;
  if (a.scrapsUsed !== b.scrapsUsed) return a.scrapsUsed < b.scrapsUsed;
  return a.leftoverUsableCm2 > b.leftoverUsableCm2 + .5;
}

function deepOptimize(core, scraps, options, { budgetMs = 6000, seed = 1, maxTries = 400 } = {}, checkDeadline = () => {}, clock = Date.now) {
  const started = clock();
  const baseline = core.optimizePattern(scraps, options);
  const baselineScore = scorePlan(baseline, scraps);
  let best = baseline, bestScore = baselineScore, bestSeed = null, tries = 0, improvements = 0;
  const trace = [{ tryIndex: 0, ms: clock() - started, largestOffcutCm2: baselineScore.largestOffcut.areaCm2, placed: baselineScore.placed }];
  // Keep the baseline's grid so the design the maker chose stays the same.
  const fixed = { ...options, grid: baseline.grid };
  while (tries < maxTries && clock() - started < budgetMs) {
    checkDeadline();
    const searchSeed = (seed * 7919 + tries * 104729) >>> 0;
    tries++;
    const plan = core.optimizePattern(scraps, { ...fixed, searchSeed });
    if (!plan.validated) continue;
    const score = scorePlan(plan, scraps);
    if (better(score, bestScore)) {
      best = plan; bestScore = score; bestSeed = searchSeed; improvements++;
      trace.push({ tryIndex: tries, ms: clock() - started, largestOffcutCm2: score.largestOffcut.areaCm2, placed: score.placed });
    }
  }
  return {
    baseline: { score: baselineScore, grid: baseline.grid },
    plan: best, score: bestScore, improved: best !== baseline, seed: bestSeed,
    search: { tries, improvements, elapsedMs: clock() - started, budgetMs, trace,
      method: 'Seeded multi-start restarts of the validated nesting engine, ranked by completeness, cuts placed, largest reusable offcut, scraps left whole, then leftover area. Heuristic; no optimality guarantee.' },
  };
}

module.exports = { deepOptimize, scorePlan };
