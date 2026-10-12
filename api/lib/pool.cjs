'use strict';

const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
const copy = scraps => scraps.map(s => ({ ...s }));

/**
 * Community fabric pool for repair cafés and workshops. One plan is computed
 * over every donor's scraps (each keeps its own photo calibration), then each
 * donor's material is planned alone to show whether pooling unlocks a project
 * no single donor could complete.
 */
function planPool(pool, core, checkDeadline = () => {}) {
  const { donors, scraps, options } = pool;
  const plan = core.optimizePattern(copy(scraps), options);
  checkDeadline();
  const solo = donors.map(donor => {
    checkDeadline();
    const own = scraps.filter(s => s.donorId === donor.donorId), alone = core.optimizePattern(copy(own), options);
    return { donorId: donor.donorId, name: donor.name, feasible: alone.feasible && alone.validated, placed: alone.stats.placed, totalPieces: alone.stats.totalPieces };
  });
  const usedTotal = plan.pieces.reduce((t, p) => t + p.widthCm * p.heightCm, 0);
  const contributions = donors.map(donor => {
    const cuts = plan.pieces.filter(p => scraps.find(s => s.id === p.scrapId)?.donorId === donor.donorId);
    const usedAreaCm2 = cuts.reduce((t, p) => t + p.widthCm * p.heightCm, 0);
    return { donorId: donor.donorId, name: donor.name, cuts: cuts.length, scrapsUsed: new Set(cuts.map(p => p.scrapId)).size,
      usedAreaCm2: round(usedAreaCm2), shareOfProject: usedTotal ? round(usedAreaCm2 / usedTotal, 4) : 0 };
  });
  const completeAlone = solo.filter(s => s.feasible).map(s => s.name);
  return {
    plan, solo, contributions,
    poolingUnlocks: plan.feasible && completeAlone.length === 0,
    summary: plan.feasible
      ? completeAlone.length ? `Complete pooled ${plan.title.toLowerCase()}. ${completeAlone.join(', ')} could also complete it alone.` : `Complete pooled ${plan.title.toLowerCase()}. No single donor had enough usable fabric; pooling made this project possible.`
      : `The pooled fabric places ${plan.stats.placed} of ${plan.stats.totalPieces} cuts. A complete layout was not found.`,
  };
}

module.exports = { planPool };
