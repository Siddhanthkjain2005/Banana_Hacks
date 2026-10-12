import { optimizePattern } from './vision.js';

const PRODUCT_NAMES = {
  tote: 'tote',
  pouch: 'pouch',
  cushion: 'cushion cover',
};
const percent = value => `${(value * 100).toFixed(1)}%`;
const isUsableMeasuredScrap = scrap => scrap?.usable !== false && scrap?.mask
  && Number.isFinite(scrap.pixelsPerCm) && scrap.pixelsPerCm > 0;

/**
 * Compare the three supported products using the same measured material and
 * user constraints. Each result contains its actual validated cutting plan.
 * This ranks the layouts found by the heuristic; it does not prove a global
 * optimum or infer fabric strength, suitability, or environmental savings.
 */
export function recommendProducts(scraps, options = {}) {
  if (!Array.isArray(scraps)) throw new TypeError('Provide the measured scraps as an array.');
  const constraints = {
    objective: options.objective ?? 'balanced',
    seamAllowanceCm: options.seamAllowanceCm ?? .7,
    rotation: options.rotation !== false,
    grainAware: options.grainAware !== false,
    ...(options.size !== undefined ? { size: options.size } : {}),
  };
  const usableScrapCount = scraps.filter(isUsableMeasuredScrap).length;
  const sourceStats = {
    inputScrapCount: scraps.length,
    usableScrapCount,
    excludedScrapCount: scraps.length - usableScrapCount,
  };
  const recommendations = ['tote', 'pouch', 'cushion'].map(product => {
    const plan = optimizePattern(scraps, { ...constraints, product });
    const total = plan.stats.totalPieces, placed = plan.stats.placed;
    const feasible = plan.feasible === true && plan.validated === true;
    const utilization = plan.stats.utilization;
    const completionRatio = total ? placed / total : 0;
    const reason = usableScrapCount === 0
      ? `No usable measured scraps are available. ${placed} of ${total} required ${PRODUCT_NAMES[product]} cuts placed; uses ${percent(utilization)} of usable detected fabric. A complete layout was not found.`
      : feasible
        ? `Complete validated ${PRODUCT_NAMES[product]}: ${placed} of ${total} cuts placed; uses ${percent(utilization)} of usable detected fabric, including seam allowances.`
        : `Incomplete ${PRODUCT_NAMES[product]}: ${placed} of ${total} cuts placed (${percent(completionRatio)} complete); uses ${percent(utilization)} of usable detected fabric. A complete cutting layout was not found at this size.`;
    return {
      product, plan, feasible, utilization, completionRatio, reason,
      // Feasibility dominates this display score. Sorting uses the exact
      // fractions below, so rounding never changes the ranking.
      score: Number(((feasible ? 1000 : 0) + utilization * 100 + completionRatio / 100).toFixed(4)),
      stats: { ...plan.stats, ...sourceStats },
    };
  });
  return recommendations.sort((a, b) => Number(b.feasible) - Number(a.feasible)
    || b.utilization - a.utilization || b.completionRatio - a.completionRatio
    || ['tote', 'pouch', 'cushion'].indexOf(a.product) - ['tote', 'pouch', 'cushion'].indexOf(b.product));
}
