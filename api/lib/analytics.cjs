'use strict';

const { hexToLab, deltaE } = require('./color.cjs');

const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;

/** The shared engine's separable 3x3 erosion, with image borders treated as background. */
function erode(mask, w, h) {
  const horizontal = new Uint8Array(mask.length), output = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    horizontal[i] = (x ? mask[i - 1] : 0) & mask[i] & (x < w - 1 ? mask[i + 1] : 0);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    output[i] = (y ? horizontal[i - w] : 0) & horizontal[i] & (y < h - 1 ? horizontal[i + w] : 0);
  }
  return output;
}

const sum = mask => { let total = 0; for (const v of mask) total += v; return total; };

function usableOf(scrap) {
  if (!scrap.usableMask) scrap.usableMask = erode(scrap.mask, scrap.bbox.width, scrap.bbox.height);
  if (!Number.isFinite(scrap.usableAreaPx)) scrap.usableAreaPx = sum(scrap.usableMask);
  return scrap.usableMask;
}

function clearRect(mask, w, h, x, y, rw, rh) {
  for (let yy = Math.max(0, y); yy < Math.min(h, y + rh); yy++) mask.fill(0, yy * w + Math.max(0, x), yy * w + Math.min(w, x + rw));
}

/**
 * Remove placed cuts from each scrap. Because erode(A − R) = erode(A) − dilate(R)
 * for the engine's 3x3 operator, clearing each cut plus a one-pixel border from
 * the usable mask gives exactly the conservative mask the engine would compute
 * for the physical leftover fabric.
 */
function leftoverScraps(scraps, pieces) {
  const byScrap = new Map();
  pieces.forEach(p => byScrap.set(p.scrapId, [...(byScrap.get(p.scrapId) || []), p]));
  return scraps.map(scrap => {
    const cuts = byScrap.get(scrap.id);
    if (!cuts) return scrap;
    const { width: w, height: h } = scrap.bbox, mask = new Uint8Array(scrap.mask), usableMask = new Uint8Array(usableOf(scrap));
    for (const p of cuts) {
      const x = p.x - scrap.bbox.x, y = p.y - scrap.bbox.y, rw = p.occupiedPixelWidth, rh = p.occupiedPixelHeight;
      clearRect(mask, w, h, x, y, rw, rh);
      clearRect(usableMask, w, h, x - 1, y - 1, rw + 2, rh + 2);
    }
    const areaPx = sum(mask);
    return { ...scrap, mask, usableMask, areaPx, areaCm2: areaPx / scrap.pixelsPerCm ** 2, usableAreaPx: sum(usableMask) };
  });
}

/** Largest axis-aligned rectangle of usable pixels (maximal-rectangle histogram method, O(w·h)). */
function largestRectangle(mask, w, h) {
  const heights = new Int32Array(w), stack = new Int32Array(w + 1);
  let best = { width: 0, height: 0, x: 0, y: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) heights[x] = mask[y * w + x] ? heights[x] + 1 : 0;
    let top = 0;
    for (let x = 0; x <= w; x++) {
      const current = x < w ? heights[x] : 0;
      while (top && heights[stack[top - 1]] >= current) {
        const height = heights[stack[--top]], left = top ? stack[top - 1] + 1 : 0, width = x - left;
        if (width * height > best.width * best.height) best = { width, height, x: left, y: y - height + 1 };
      }
      stack[top++] = x;
    }
  }
  return best;
}

/** Seam workload derived from the actual patch grid. Assembly lengths are perimeter estimates. */
function seamSummary(plan) {
  const cols = plan.grid?.cols || 1, rows = plan.grid?.rows || 1, d = plan.dimensions;
  let count = 0, lengthCm = 0;
  for (const panel of plan.panels || []) {
    const panelRows = panel.hem ? Math.max(1, Math.ceil(rows * .65)) : rows, panelHeight = panel.patternHeightCm || panel.heightCm;
    count += (cols - 1) * panelRows + (panelRows - 1);
    lengthCm += (cols - 1) * panelHeight + (panelRows - 1) * panel.widthCm;
  }
  if (plan.product === 'tote') {
    count += 2 * 3 + 2; // three joins per four-segment handle plus each handle's long tube seam
    lengthCm += 2 * (3 * d.handleWidthCm * 2 + d.handleLengthCm);
  }
  const assemblySeamCm = plan.product === 'tote' ? 2 * d.heightCm + d.widthCm + 2 * d.widthCm
    : plan.product === 'pouch' ? 2 * d.widthCm + 2 * d.heightCm + d.widthCm
      : 2 * (d.widthCm + d.heightCm) + 2 * d.widthCm;
  return { patchworkSeams: count, patchworkSeamCm: round(lengthCm, 1), assemblySeamCm: round(assemblySeamCm, 1),
    totalSeamCm: round(lengthCm + assemblySeamCm, 1),
    basis: 'Patchwork joins follow the planned grid. Assembly length is a perimeter estimate (side, bottom, zipper, or hem seams).' };
}

/** Per-scrap use and the largest rectangle still cuttable from each leftover. */
function planAnalytics(plan, scraps) {
  const usable = scraps.filter(s => s.usable !== false);
  usable.forEach(usableOf);
  const leftovers = leftoverScraps(usable, plan.pieces);
  const perScrap = usable.map((scrap, i) => {
    const cuts = plan.pieces.filter(p => p.scrapId === scrap.id), ppcm = scrap.pixelsPerCm, left = leftovers[i];
    const usedAreaCm2 = cuts.reduce((total, p) => total + p.widthCm * p.heightCm, 0), usableAreaCm2 = scrap.usableAreaPx / ppcm ** 2;
    const rect = largestRectangle(left.usableMask, scrap.bbox.width, scrap.bbox.height);
    return { id: scrap.id, label: scrap.label, color: scrap.color, cuts: cuts.length, usableAreaCm2: round(usableAreaCm2), usedAreaCm2: round(usedAreaCm2),
      utilization: usableAreaCm2 ? round(usedAreaCm2 / usableAreaCm2, 4) : 0, leftoverUsableCm2: round(left.usableAreaPx / ppcm ** 2),
      largestLeftoverRectangleCm: { width: round(rect.width / ppcm, 1), height: round(rect.height / ppcm, 1) } };
  });
  const largest = perScrap.reduce((best, s) => s.largestLeftoverRectangleCm.width * s.largestLeftoverRectangleCm.height > best.area
    ? { area: s.largestLeftoverRectangleCm.width * s.largestLeftoverRectangleCm.height, scrapId: s.id, ...s.largestLeftoverRectangleCm } : best, { area: 0 });
  return { perScrap, seams: seamSummary(plan),
    leftovers: { usableCm2: round(perScrap.reduce((t, s) => t + s.leftoverUsableCm2, 0)), largestRectangleCm: largest.area ? { scrapId: largest.scrapId, width: largest.width, height: largest.height } : null } };
}

const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;

/**
 * Colour-aware patch arrangement. Cuts with identical dimensions are
 * interchangeable, so they may be sewn into any matching grid slot. A
 * deterministic best-improvement swap search maximizes perceptual contrast
 * between neighbouring patches and avoids sewing a scrap next to itself.
 * The cut positions on the fabric are never changed, so cutting validity is preserved.
 */
function arrangePatches(plan) {
  const pieces = plan.pieces || [];
  const lab = new Map(pieces.map(p => [p.scrapId, hexToLab(p.color)]));
  const neighbours = pieces.map(() => []);
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
    const a = pieces[i], b = pieces[j];
    if (a.panel === b.panel && Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1) { neighbours[i].push(j); neighbours[j].push(i); }
  }
  const assignment = pieces.map((_, i) => i), contrast = new Map();
  const deltaFor = (a, b) => {
    const key = pairKey(a.scrapId, b.scrapId);
    if (!contrast.has(key)) contrast.set(key, deltaE(lab.get(a.scrapId), lab.get(b.scrapId)));
    return contrast.get(key);
  };
  const penalty = (a, b) => a.scrapId === b.scrapId ? 2 : Math.max(0, 1 - deltaFor(a, b) / 40);
  const slotCost = slot => neighbours[slot].reduce((total, n) => total + penalty(pieces[assignment[slot]], pieces[assignment[n]]), 0);
  const metrics = () => {
    const deltas = [];
    let same = 0, low = 0, cost = 0;
    pieces.forEach((_, i) => neighbours[i].forEach(j => {
      if (j < i) return;
      const a = pieces[assignment[i]], b = pieces[assignment[j]], d = a.scrapId === b.scrapId ? 0 : deltaFor(a, b);
      deltas.push(d); cost += penalty(a, b);
      if (a.scrapId === b.scrapId) same++; else if (d < 10) low++;
    }));
    return { adjacentPairs: deltas.length, sameScrapAdjacencies: same, lowContrastAdjacencies: low,
      minAdjacentDeltaE: deltas.length ? round(Math.min(...deltas), 1) : null, meanAdjacentDeltaE: deltas.length ? round(deltas.reduce((t, d) => t + d, 0) / deltas.length, 1) : null, cost: round(cost, 4) };
  };
  const before = metrics();
  const groups = new Map();
  pieces.forEach((p, i) => { const key = `${round(p.cutWidthCm, 4)}x${round(p.cutHeightCm, 4)}`; groups.set(key, [...(groups.get(key) || []), i]); });
  let swaps = 0;
  for (let iteration = 0; iteration < 400; iteration++) {
    let best = null;
    for (const slots of groups.values()) for (let x = 0; x < slots.length; x++) for (let y = x + 1; y < slots.length; y++) {
      const i = slots[x], j = slots[y];
      if (pieces[assignment[i]].scrapId === pieces[assignment[j]].scrapId) continue;
      const current = slotCost(i) + slotCost(j);
      [assignment[i], assignment[j]] = [assignment[j], assignment[i]];
      const gain = current - (slotCost(i) + slotCost(j));
      [assignment[i], assignment[j]] = [assignment[j], assignment[i]];
      if (gain > 1e-9 && (!best || gain > best.gain + 1e-9)) best = { i, j, gain };
    }
    if (!best) break;
    [assignment[best.i], assignment[best.j]] = [assignment[best.j], assignment[best.i]];
    swaps++;
  }
  const slots = pieces.map((slot, i) => {
    const cut = pieces[assignment[i]];
    return { slotId: slot.id, panel: slot.panel, row: slot.row, col: slot.col, cutId: cut.id, scrapId: cut.scrapId, color: cut.color,
      cutWidthCm: round(cut.cutWidthCm, 2), cutHeightCm: round(cut.cutHeightCm, 2) };
  });
  return { method: 'Deterministic best-improvement swaps between cuts of identical dimensions; CIE76 ΔE contrast between edge-sharing patches.',
    swaps, before, after: metrics(), slots };
}

module.exports = { planAnalytics, arrangePatches, leftoverScraps, largestRectangle, seamSummary, erode, usableOf };
