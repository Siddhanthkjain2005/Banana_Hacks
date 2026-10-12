import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendProducts } from '../dist/recommend.js';

function scrap(id, width = 200, height = 180, pixelsPerCm = 5, extra = {}) {
  const mask = new Uint8Array(width * height).fill(1);
  return { id, label: id, color: '#75835c', bbox: { x: 0, y: 0, width, height },
    mask, pixelsPerCm, areaPx: mask.length, areaCm2: mask.length / pixelsPerCm ** 2, usable: true, ...extra };
}
const plentiful = () => [scrap('a'), scrap('b'), scrap('c')];

test('all recommendations contain real plans and rank complete layouts by measured utilization', () => {
  const recommendations = recommendProducts(plentiful());
  assert.equal(recommendations.length, 3);
  assert.deepEqual([...recommendations.map(r => r.product)].sort(), ['cushion', 'pouch', 'tote']);
  assert.ok(recommendations.every(r => r.feasible));
  for (let i = 0; i < recommendations.length; i++) {
    const r = recommendations[i];
    assert.equal(r.plan.product, r.product);
    assert.equal(r.plan.validated, true);
    assert.equal(r.completionRatio, 1);
    assert.equal(r.utilization, r.plan.stats.utilization);
    assert.equal(r.stats.inputScrapCount, 3);
    assert.equal(r.stats.usableScrapCount, 3);
    assert.match(r.reason, new RegExp(`${r.plan.stats.placed} of ${r.plan.stats.totalPieces} cuts placed`));
    assert.ok(r.reason.includes(`${(r.utilization * 100).toFixed(1)}%`));
    if (i) assert.ok(recommendations[i - 1].utilization >= r.utilization);
  }
});

test('a complete pouch ranks ahead of partial larger products', () => {
  const recommendations = recommendProducts([scrap('a', 80, 90), scrap('b', 80, 90), scrap('c', 80, 90)]);
  assert.equal(recommendations[0].product, 'pouch');
  assert.equal(recommendations[0].feasible, true);
  assert.ok(recommendations.slice(1).every(r => !r.feasible));
  assert.ok(recommendations.slice(1).every(r => r.reason.includes('Incomplete')));
});

test('an undersized scene returns honest infeasible comparisons for all products', () => {
  const recommendations = recommendProducts([scrap('tiny', 20, 20, 10)]);
  assert.ok(recommendations.every(r => !r.feasible));
  assert.ok(recommendations.every(r => r.completionRatio < 1));
  assert.ok(recommendations.every(r => r.plan.stats.unplaced > 0));
  assert.ok(recommendations.every(r => r.reason.includes('not found')));
  assert.ok(recommendations.every(r => r.score < 1000));
});

test('excluded material cannot contribute area, cuts, or a completed recommendation', () => {
  const recommendations = recommendProducts([
    scrap('excluded', 400, 400, 5, { usable: false }),
    scrap('tiny', 20, 20, 10),
  ]);
  assert.ok(recommendations.every(r => !r.feasible));
  for (const r of recommendations) {
    assert.equal(r.stats.inputScrapCount, 2);
    assert.equal(r.stats.usableScrapCount, 1);
    assert.equal(r.stats.excludedScrapCount, 1);
    assert.ok(r.plan.pieces.every(p => p.scrapId !== 'excluded'));
    assert.ok(r.stats.availableAreaCm2 < 4);
  }
  const empty = recommendProducts([]);
  assert.ok(empty.every(r => !r.feasible && r.reason.includes('No usable measured scraps')));
});

test('shared design size, seam, rotation and objective constraints reach every real plan', () => {
  const sizes = { tote: [24, 28], pouch: [18, 12], cushion: [28, 28] };
  for (const objective of ['balanced', 'waste', 'color']) {
    const recommendations = recommendProducts(plentiful(), { size: .75, seamAllowanceCm: 1.1, rotation: false, objective });
    for (const r of recommendations) {
      assert.equal(r.plan.objective, objective);
      assert.equal(r.plan.rotation, false);
      assert.equal(r.plan.seamAllowanceCm, 1.1);
      assert.equal(r.plan.dimensions.widthCm, sizes[r.product][0] * .75);
      assert.equal(r.plan.dimensions.heightCm, sizes[r.product][1] * .75);
      assert.ok(r.plan.pieces.every(p => !p.rotated && p.seamAllowanceCm === 1.1));
    }
  }
});

test('invalid measurement collection and invalid shared constraints fail explicitly', () => {
  assert.throws(() => recommendProducts(null), /array/);
  assert.throws(() => recommendProducts(plentiful(), { seamAllowanceCm: 0 }), /Seam allowance/);
  assert.throws(() => recommendProducts(plentiful(), { size: -1 }), /Finished dimensions/);
});

test('product comparisons obey the maker’s grain-awareness toggle', () => {
  const scraps = ['a', 'b', 'c'].map(id => scrap(id, 220, 230, 5, {
    fabric: { pattern: 'stripe', confidence: .9, directional: true, grainDeviationDeg: 2, grainSource: 'pattern' },
  }));
  const locked = recommendProducts(scraps, { grainAware: true });
  assert.ok(locked.every(r => r.plan.grainAware && r.plan.stats.grain.rotationLockedScraps.length === 3));
  const unlocked = recommendProducts(scraps, { grainAware: false });
  assert.ok(unlocked.every(r => r.plan.grainAware === false && r.plan.stats.grain.rotationLockedScraps.length === 0));
});
