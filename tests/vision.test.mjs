import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImage, optimizePattern, isPieceContained, exportCuttingSVG, exportPlanJSON } from '../dist/vision.js';

function image(width = 480, height = 320, background = [238, 236, 229]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([...background, 255], p * 4);
  return { width, height, data };
}
function rectangle(img, x, y, width, height, color) {
  for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) img.data.set([...color, 255], (yy * img.width + xx) * 4);
}
function polygon(img, points, color) {
  const ys = points.map(p => p[1]);
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(img.height, Math.ceil(Math.max(...ys))); y++) {
    const crosses = [];
    points.forEach(([x1, y1], i) => {
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) crosses.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1));
    });
    crosses.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crosses.length; i += 2) for (let x = Math.max(0, Math.ceil(crosses[i])); x < Math.min(img.width, Math.floor(crosses[i + 1])); x++) img.data.set([...color, 255], (y * img.width + x) * 4);
  }
}
function workshop() {
  const img = image(1200, 840);
  const shapes = [
    [[52, 62], [484, 48], [535, 126], [514, 505], [461, 563], [62, 541], [43, 304]],
    [[657, 61], [1119, 43], [1161, 101], [1130, 535], [1032, 567], [654, 539], [637, 336]],
    [[52, 591], [229, 581], [239, 604], [236, 810], [62, 824], [44, 802], [47, 617]],
    [[285, 590], [461, 583], [472, 608], [468, 812], [299, 826], [278, 810], [279, 613]],
    [[523, 584], [699, 590], [704, 615], [697, 815], [523, 823], [511, 807], [513, 603]],
    [[756, 592], [925, 583], [939, 608], [933, 812], [765, 825], [747, 802], [749, 615]],
    [[991, 588], [1162, 583], [1175, 606], [1171, 812], [1004, 824], [982, 806], [983, 614]],
  ];
  const colors = [[117, 131, 92], [197, 183, 154], [82, 114, 129], [169, 103, 78], [184, 161, 100], [146, 148, 139], [60, 81, 69]];
  shapes.forEach((p, i) => polygon(img, p, colors[i]));
  return analyzeImage(img, { sceneWidthCm: 80 });
}

test('per-image clusters separate actual fabric pixels and preserve measured geometry', () => {
  const img = image();
  rectangle(img, 25, 30, 120, 100, [162, 79, 57]);
  rectangle(img, 220, 80, 160, 180, [56, 93, 114]);
  const a = analyzeImage(img, { sceneWidthCm: 48 });
  assert.equal(a.scraps.length, 2);
  assert.equal(a.pixelsPerCm, 10);
  assert.ok(a.metrics.clusters >= 3);
  assert.ok(a.metrics.clusteringIterations >= 1);
  const largest = a.scraps[0];
  assert.deepEqual(largest.bbox, { x: 220, y: 80, width: 160, height: 180 });
  assert.equal(largest.areaPx, 160 * 180);
  assert.equal(largest.areaCm2, 288);
  assert.ok(largest.contour.length >= 5);
  assert.equal(a.mask[0], 0);
  assert.equal(a.mask[100 * img.width + 250], 1);
  assert.equal(largest.quality.touchesBorder, false);
});

test('same-color disconnected pieces remain separate; isolated sensor noise is removed', () => {
  const img = image();
  rectangle(img, 25, 30, 70, 90, [117, 131, 92]);
  rectangle(img, 190, 100, 90, 90, [117, 131, 92]);
  rectangle(img, 400, 200, 1, 1, [8, 8, 8]);
  const a = analyzeImage(img);
  assert.equal(a.scraps.length, 2);
  assert.equal(a.mask[200 * img.width + 400], 0);
});

test('cm calibration is measured from whole image width and areas scale quadratically', () => {
  const img = image(); rectangle(img, 30, 30, 160, 120, [80, 110, 123]);
  const narrow = analyzeImage(img, { sceneWidthCm: 48 }), wide = analyzeImage(img, { sceneWidthCm: 96 });
  assert.equal(wide.scraps[0].areaCm2, narrow.scraps[0].areaCm2 * 4);
  assert.equal(wide.sceneHeightCm, 64);
  assert.deepEqual(narrow.scraps[0].bbox, wide.scraps[0].bbox);
});

test('blank scenes and clipped scraps produce actionable honest quality flags', () => {
  const blank = analyzeImage(image());
  assert.equal(blank.scraps.length, 0);
  assert.ok(blank.warnings.some(w => w.includes('No separated scraps')));
  const img = image(); rectangle(img, 0, 40, 180, 160, [162, 79, 57]);
  const clipped = analyzeImage(img);
  assert.equal(clipped.scraps[0].usable, false);
  assert.ok(clipped.scraps[0].quality.touchesBorder);
});

test('a real patchwork tote nests inside image masks without intersecting cut rectangles', () => {
  const a = workshop(), p = optimizePattern(a.scraps, { product: 'tote', objective: 'balanced' });
  assert.equal(a.scraps.length, 7);
  assert.equal(p.feasible, true, p.warnings.join(' '));
  assert.equal(p.validated, true);
  assert.equal(p.stats.unplaced, 0);
  assert.ok(p.pieces.some(x => x.panel === 'front'));
  assert.ok(p.pieces.some(x => x.panel === 'back'));
  assert.equal(p.pieces.filter(x => x.panel.startsWith('handle')).length, 8);
  assert.ok(p.stats.utilization > .35 && p.stats.utilization < 1);
  for (let i = 0; i < p.pieces.length; i++) {
    const cut = p.pieces[i], scrap = a.scraps.find(s => s.id === cut.scrapId);
    assert.ok(isPieceContained(cut, scrap), cut.id);
    assert.ok(Math.abs(cut.width / scrap.pixelsPerCm - cut.widthCm) < 1e-8);
    for (const other of p.pieces.slice(0, i).filter(q => q.scrapId === cut.scrapId)) {
      const overlap = cut.x < other.x + other.width && cut.x + cut.width > other.x && cut.y < other.y + other.height && cut.y + cut.height > other.y;
      assert.equal(overlap, false, `${cut.id} overlaps ${other.id}`);
    }
  }
});

test('a rectangle cannot cross a concave boundary or a hole inside its bounding box', () => {
  const mask = new Uint8Array(100 * 100).fill(1);
  for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) mask[y * 100 + x] = 0;
  const scrap = { bbox: { x: 20, y: 30, width: 100, height: 100 }, mask };
  assert.equal(isPieceContained({ x: 25, y: 35, width: 20, height: 20 }, scrap), true);
  assert.equal(isPieceContained({ x: 55, y: 65, width: 30, height: 30 }, scrap), false);
  assert.equal(isPieceContained({ x: 100, y: 100, width: 30, height: 30 }, scrap), false);
});

test('impossible product is a partial, explicitly infeasible result rather than a fake completion', () => {
  const img = image(); rectangle(img, 30, 30, 40, 40, [80, 100, 125]);
  const a = analyzeImage(img, { sceneWidthCm: 48 });
  const p = optimizePattern(a.scraps, { product: 'tote', size: { widthCm: 50, heightCm: 70 } });
  assert.equal(p.feasible, false);
  assert.ok(p.stats.unplaced > 0);
  assert.ok(p.stats.requiredAreaCm2 > p.stats.availableAreaCm2);
  assert.ok(p.warnings.some(w => w.includes('complete cutting layout')));
});

test('physical SVG export has mm dimensions, an exact 100mm scale bar, and included seam lines', () => {
  const a = workshop(), p = optimizePattern(a.scraps, { product: 'pouch' }), svg = exportCuttingSVG(p, a.scraps);
  assert.equal(p.feasible, true);
  assert.match(svg, /width="[0-9.]+mm"/);
  assert.match(svg, /h100m-100/);
  assert.match(svg, /stroke-dasharray/);
  assert.match(svg, /100%/);
  const report = JSON.parse(exportPlanJSON(p, a));
  assert.equal(report.measurement.sceneWidthCm, 80);
  assert.equal(report.plan.feasible, true);
  assert.equal(report.measurement.scraps[0].mask, undefined);
  assert.ok(report.limitations.some(x => x.includes('not verified')));
});

test('all three product definitions provide complete geometry and construction steps', () => {
  const a = workshop();
  for (const product of ['tote', 'pouch', 'cushion']) {
    const p = optimizePattern(a.scraps, { product, size: { widthCm: 18, heightCm: 18 } });
    assert.equal(p.feasible, true, product);
    assert.ok(p.assembly.length > 4);
    assert.ok(p.pieces.every(c => c.seamAllowanceCm === .7));
    assert.ok(p.panels.length >= 2);
  }
});

test('invalid inputs reject missing calibration and invalid product constraints', () => {
  assert.throws(() => analyzeImage({}), /valid RGBA/);
  assert.throws(() => analyzeImage(image(), { sceneWidthCm: 0 }), /positive/);
  assert.throws(() => optimizePattern([], { product: 'spaceship' }), /Choose/);
  assert.throws(() => optimizePattern([], { seamAllowanceCm: -2 }), /Seam allowance/);
});
