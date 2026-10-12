/**
 * ReThread's local, image-driven measurement and cutting engine.
 * Color clusters are fitted to each photograph; no pretrained object detector,
 * material identification, strength prediction, or invented model confidence.
 * A photograph is assumed to be a top-down flat lay on a contrasting background.
 */

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
const sqDistance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const hex = (rgb) => '#' + rgb.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
};

function rgbToLab(r, g, b) {
  const linear = v => { v /= 255; return v > .04045 ? ((v + .055) / 1.055) ** 2.4 : v / 12.92; };
  r = linear(r); g = linear(g); b = linear(b);
  const f = v => v > .008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  const x = f((.4124564 * r + .3575761 * g + .1804375 * b) / .95047);
  const y = f(.2126729 * r + .7151522 * g + .0721750 * b);
  const z = f((.0193339 * r + .1191920 * g + .9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function fitClusters(samples, backgroundLab, requested = 7) {
  // Deterministic farthest-point initialization makes repeat analyses stable.
  const centers = [[...backgroundLab]];
  while (centers.length < requested) {
    let farthest = null, distance = 0;
    for (const sample of samples) {
      let d = Infinity;
      for (const center of centers) d = Math.min(d, sqDistance(sample.lab, center));
      if (d > distance) { distance = d; farthest = sample.lab; }
    }
    if (!farthest || distance < 16) break;
    centers.push([...farthest]);
  }
  let iterations = 0;
  for (; iterations < 16; iterations++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const sample of samples) {
      let best = 0, distance = Infinity;
      centers.forEach((center, i) => {
        const d = sqDistance(sample.lab, center);
        if (d < distance) { best = i; distance = d; }
      });
      const s = sums[best];
      s[0] += sample.lab[0]; s[1] += sample.lab[1]; s[2] += sample.lab[2]; s[3]++;
    }
    let movement = 0;
    centers.forEach((center, i) => {
      if (!sums[i][3]) return;
      const next = sums[i].slice(0, 3).map(v => v / sums[i][3]);
      movement += sqDistance(center, next);
      centers[i] = next;
    });
    if (movement < .015) { iterations++; break; }
  }
  return { centers, iterations };
}

function morphology(mask, w, h, dilate) {
  // A separable 3x3 square operator. Image borders are treated as background.
  const horizontal = new Uint8Array(mask.length), output = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const a = x ? mask[row + x - 1] : 0, b = mask[row + x], c = x < w - 1 ? mask[row + x + 1] : 0;
      horizontal[row + x] = dilate ? a | b | c : a & b & c;
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = y ? horizontal[i - w] : 0, b = horizontal[i], c = y < h - 1 ? horizontal[i + w] : 0;
    output[i] = dilate ? a | b | c : a & b & c;
  }
  return output;
}

function components(mask, w, h, minimumArea) {
  const visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length), result = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    let read = 0, write = 1, minX = w, minY = h, maxX = 0, maxY = 0, touches = 0;
    queue[0] = start; visited[start] = 1;
    while (read < write) {
      const i = queue[read++], x = i % w, y = Math.floor(i / w);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      // Cleanup loses the outermost pixel; a region within one pixel of the
      // frame still has an incomplete photographed boundary.
      if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 2) touches++;
      // Four connectivity avoids merging scraps that meet only at a corner.
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (n >= 0 && mask[n] && !visited[n]) { visited[n] = 1; queue[write++] = n; }
      }
    }
    if (write < minimumArea) continue;
    const bbox = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    const localMask = new Uint8Array(bbox.width * bbox.height);
    for (let j = 0; j < write; j++) {
      const i = queue[j], x = i % w - minX, y = Math.floor(i / w) - minY;
      localMask[y * bbox.width + x] = 1;
    }
    result.push({ bbox, mask: localMask, areaPx: write, touchesBorder: touches > 0 });
  }
  return result.sort((a, b) => b.areaPx - a.areaPx);
}

function simplifyPolyline(points, tolerance = 1.4) {
  if (points.length < 7) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]], t2 = tolerance ** 2;
  while (stack.length) {
    const [first, last] = stack.pop(), a = points[first], b = points[last];
    let far = -1, greatest = t2;
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    for (let i = first + 1; i < last; i++) {
      const p = points[i], t = length ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / length, 0, 1) : 0;
      const d = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
      if (d > greatest) { greatest = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([first, far], [far, last]); }
  }
  return points.filter((_, i) => keep[i]);
}

function traceContour(mask, bbox) {
  const { width: w, height: h } = bbox, edges = [], outgoing = new Map(), stride = w + 1;
  const add = (x1, y1, x2, y2) => {
    const index = edges.length, key = y1 * stride + x1;
    edges.push({ x1, y1, x2, y2, used: false });
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push(index);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!mask[i]) continue;
    if (!y || !mask[i - w]) add(x, y, x + 1, y);
    if (x === w - 1 || !mask[i + 1]) add(x + 1, y, x + 1, y + 1);
    if (y === h - 1 || !mask[i + w]) add(x + 1, y + 1, x, y + 1);
    if (!x || !mask[i - 1]) add(x, y + 1, x, y);
  }
  let longest = [], greatestArea = 0;
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].used) continue;
    const points = [], first = edges[i];
    let cursor = i, guard = 0;
    while (cursor !== undefined && !edges[cursor].used && guard++ <= edges.length) {
      const e = edges[cursor]; e.used = true;
      points.push({ x: e.x1, y: e.y1 });
      if (e.x2 === first.x1 && e.y2 === first.y1) { points.push({ x: e.x2, y: e.y2 }); break; }
      cursor = outgoing.get(e.y2 * stride + e.x2)?.find(j => !edges[j].used);
    }
    let area = 0;
    for (let j = 1; j < points.length; j++) area += points[j - 1].x * points[j].y - points[j].x * points[j - 1].y;
    if (Math.abs(area) > greatestArea) { greatestArea = Math.abs(area); longest = points; }
  }
  return simplifyPolyline(longest).map(p => ({ x: p.x + bbox.x, y: p.y + bbox.y }));
}

function colorName([r, g, b]) {
  if (Math.max(r, g, b) - Math.min(r, g, b) < 24) return (r + g + b) / 3 > 175 ? 'Ivory' : (r + g + b) / 3 < 75 ? 'Charcoal' : 'Stone';
  if (r > g && g > b && g / Math.max(1, b) < 1.3 && (r + g + b) / 3 > 145) return 'Oat';
  if (r > g * 1.2 && r > b * 1.15) return r > 170 ? 'Terracotta' : 'Burgundy';
  if (g > r * 1.08 && g > b * 1.05) return 'Sage';
  if (b > r * 1.08 && b > g * 1.02) return 'Indigo';
  if (r > b * 1.3 && g > b * 1.2) return 'Ochre';
  return r > g ? 'Rose' : 'Teal';
}

/** Analyze source pixels. sceneWidthCm is the measured physical width of the whole photograph. */
export function analyzeImage(imageData, options = {}) {
  const { width, height, data } = imageData || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 12 || height < 12 || !data || data.length < width * height * 4) throw new Error('Provide valid RGBA ImageData at least 12 × 12 pixels.');
  if (width * height > 12_000_000) throw new Error('Use an image below 12 megapixels to keep local analysis responsive.');
  const sceneWidthCm = Number(options.sceneWidthCm ?? 60);
  if (!Number.isFinite(sceneWidthCm) || sceneWidthCm <= 0) throw new Error('Scene width must be a positive measurement in centimetres.');
  const pixelsPerCm = width / sceneWidthCm;
  const minimumArea = Math.max(9, Number(options.minAreaPx ?? options.minArea ?? width * height * .002));
  const labCache = new Map(), getLab = (r, g, b) => {
    const key = (r >> 2) * 4096 + (g >> 2) * 64 + (b >> 2);
    if (!labCache.has(key)) labCache.set(key, rgbToLab(r, g, b));
    return labCache.get(key);
  };
  const samples = [], border = [], sampleStep = Math.max(1, Math.floor(Math.sqrt(width * height / 6500)));
  const band = Math.max(2, Math.floor(Math.min(width, height) * .025));
  for (let y = 0; y < height; y += sampleStep) for (let x = 0; x < width; x += sampleStep) {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]], lab = getLab(...rgb), sample = { lab, rgb };
    samples.push(sample);
    if (x < band || y < band || x >= width - band || y >= height - band) border.push(sample);
  }
  if (!border.length) throw new Error('Image border is transparent; photograph scraps on an opaque contrasting background.');
  const backgroundLab = [0, 1, 2].map(k => median(border.map(s => s.lab[k])));
  const backgroundRGB = [0, 1, 2].map(k => median(border.map(s => s.rgb[k])));
  const borderDistances = border.map(s => Math.sqrt(sqDistance(s.lab, backgroundLab)));
  const spread = median(borderDistances), threshold = clamp(7 + spread * 2.7, 10, 25);
  const { centers, iterations } = fitClusters(samples, backgroundLab, clamp(options.clusters ?? 7, 2, 10));
  const nearest = lab => {
    let best = 0, distance = Infinity;
    centers.forEach((center, j) => { const d = sqDistance(lab, center); if (d < distance) { distance = d; best = j; } });
    return best;
  };
  const borderCounts = centers.map(() => 0);
  border.forEach(s => borderCounts[nearest(s.lab)]++);
  const backgroundClusters = centers.map((c, i) => ({ i, distance: Math.sqrt(sqDistance(c, backgroundLab)), borderShare: borderCounts[i] / border.length }))
    .filter(c => c.distance < threshold || c.borderShare > .20 && c.distance < threshold * 1.7).map(c => c.i);
  const bgSet = new Set(backgroundClusters), classification = new Map();
  const rawMask = new Uint8Array(width * height);
  let alphaPixels = 0, luminanceSum = 0, luminanceSquare = 0, clipping = 0;
  for (let p = 0; p < rawMask.length; p++) {
    const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    const key = (r >> 2) * 4096 + (g >> 2) * 64 + (b >> 2);
    let foreground = classification.get(key);
    if (foreground === undefined) {
      const lab = getLab(r, g, b), distance = Math.sqrt(sqDistance(lab, backgroundLab)), cluster = nearest(lab);
      foreground = distance > threshold && (!bgSet.has(cluster) || distance > threshold * 1.6) ? 1 : 0;
      classification.set(key, foreground);
    }
    if (data[i + 3] >= 128) rawMask[p] = foreground; else alphaPixels++;
    if (p % sampleStep === 0) {
      const l = (r * .2126 + g * .7152 + b * .0722) / 255;
      luminanceSum += l; luminanceSquare += l * l;
      if (Math.max(r, g, b) > 252 || Math.min(r, g, b) < 3) clipping++;
    }
  }
  let mask = morphology(morphology(rawMask, width, height, false), width, height, true);
  mask = morphology(morphology(mask, width, height, true), width, height, false);
  const found = components(mask, width, height, minimumArea), cleanMask = new Uint8Array(mask.length);
  const warnings = [], scraps = found.slice(0, 48).map((component, n) => {
    const { bbox, mask: localMask, areaPx } = component, rgbSum = [0, 0, 0], labs = [], histogram = new Map();
    let fillPixels = 0;
    for (let y = 0; y < bbox.height; y++) for (let x = 0; x < bbox.width; x++) {
      if (!localMask[y * bbox.width + x]) continue;
      const p = (bbox.y + y) * width + bbox.x + x, i = p * 4;
      cleanMask[p] = 1;
      rgbSum[0] += data[i]; rgbSum[1] += data[i + 1]; rgbSum[2] += data[i + 2];
      if (!rawMask[p]) fillPixels++;
      if ((x + y) % 11 === 0) {
        const cluster = nearest(getLab(data[i], data[i + 1], data[i + 2]));
        histogram.set(cluster, (histogram.get(cluster) || 0) + 1);
        labs.push(getLab(data[i], data[i + 1], data[i + 2]));
      }
    }
    const rgb = rgbSum.map(v => v / areaPx), color = hex(rgb), usableMask = morphology(localMask, bbox.width, bbox.height, false);
    const usableAreaPx = usableMask.reduce((sum, v) => sum + v, 0), averageLab = rgbToLab(...rgb);
    const contrastDeltaE = Math.sqrt(sqDistance(averageLab, backgroundLab));
    const colorVariance = labs.length ? Math.sqrt(labs.reduce((sum, l) => sum + sqDistance(l, averageLab), 0) / labs.length) : 0;
    const issues = [];
    if (component.touchesBorder) issues.push('Touches photo edge; complete boundary is unknown.');
    if (contrastDeltaE < 18) issues.push('Low background contrast; inspect this boundary before cutting.');
    if (fillPixels / areaPx > .025) issues.push('Texture or small holes were bridged by cleanup; inspect before cutting.');
    return {
      id: `scrap-${n + 1}`, label: `${colorName(rgb)} ${n + 1}`, color, rgb: rgb.map(Math.round),
      areaPx, areaCm2: round(areaPx / pixelsPerCm ** 2), usableAreaPx, usableAreaCm2: round(usableAreaPx / pixelsPerCm ** 2),
      bbox, contour: traceContour(localMask, bbox), mask: localMask, usableMask, pixelsPerCm,
      coverage: round(areaPx / (bbox.width * bbox.height), 3), usable: !component.touchesBorder && usableAreaPx >= minimumArea,
      quality: { contrastDeltaE: round(contrastDeltaE, 1), colorVariationDeltaE: round(colorVariance, 1), touchesBorder: component.touchesBorder, cleanupFilledPixels: fillPixels, issues },
      clusters: [...histogram.entries()].sort((a, b) => b[1] - a[1]).map(([cluster, count]) => ({ cluster, share: round(count / Math.max(1, labs.length), 3) })),
    };
  });
  const foregroundPx = scraps.reduce((sum, s) => sum + s.areaPx, 0), foregroundCoverage = foregroundPx / (width * height);
  if (!scraps.length) warnings.push('No separated scraps detected. Use a top-down photo on a contrasting, plain background.');
  if (spread > 7) warnings.push('The photo border has varied colors or shadows. A plain background will improve measurement.');
  if (foregroundCoverage > .86) warnings.push('Most of the image is foreground. Leave a visible background gap around every scrap.');
  if (foregroundCoverage < .08) warnings.push('Very little fabric was detected; check the background contrast and scene width.');
  if (scraps.some(s => !s.usable)) warnings.push('Scraps touching an image edge are excluded from automatic cutting.');
  if (scraps.some(s => s.quality.contrastDeltaE < 18)) warnings.push('One or more scraps have low contrast; review their traced outlines.');
  if (alphaPixels) warnings.push('Transparent pixels are treated as background. Use the actual photographed scene width.');
  if (found.length > 48) warnings.push('Only the 48 largest regions are kept; remove background clutter.');
  warnings.push('Dimensions assume a flat, top-down photograph. Perspective, folds, holes, and fabric condition require manual review.');
  const sampledPixels = Math.ceil(width * height / sampleStep), meanLuminance = luminanceSum / sampledPixels;
  return {
    width, height, mask: cleanMask, pixelsPerCm, sceneWidthCm, sceneHeightCm: height / pixelsPerCm, scraps,
    background: { color: hex(backgroundRGB), rgb: backgroundRGB, lab: backgroundLab, clusterIds: backgroundClusters, borderVariationDeltaE: round(spread, 1), separationThresholdDeltaE: round(threshold, 1) },
    metrics: {
      scrapCount: scraps.length, foregroundCoverage: round(foregroundCoverage, 4), totalAreaCm2: round(foregroundPx / pixelsPerCm ** 2),
      usableAreaCm2: round(scraps.filter(s => s.usable).reduce((sum, s) => sum + s.usableAreaPx, 0) / pixelsPerCm ** 2),
      clusters: centers.length, clusteringIterations: iterations, processingWidth: width, processingHeight: height,
      meanLuminance: round(meanLuminance, 3), luminanceDeviation: round(Math.sqrt(Math.max(0, luminanceSquare / sampledPixels - meanLuminance ** 2)), 3),
      clippedPixelFraction: round(clipping / sampledPixels, 3), calibration: 'user-entered scene width; no depth or perspective correction',
    }, warnings,
  };
}

function invalidIntegral(mask, w, h) {
  const stride = w + 1, integral = new Uint32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) { sum += mask[y * w + x] ? 0 : 1; integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum; }
  }
  return integral;
}

function rectangleInside(state, x, y, w, h) {
  const { width, height } = state.scrap.bbox;
  if (x < 0 || y < 0 || x + w > width || y + h > height) return false;
  const stride = width + 1, m = state.integral;
  return m[(y + h) * stride + x + w] - m[y * stride + x + w] - m[(y + h) * stride + x] + m[y * stride + x] === 0;
}

const rectanglesOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Validate against the conservative pixel mask, including holes and rounded cell coverage. */
export function isPieceContained(piece, scrap) {
  if (!scrap?.bbox || !scrap.mask || !Number.isFinite(piece?.x) || !Number.isFinite(piece?.y) || !(piece.width > 0) || !(piece.height > 0)) return false;
  const x = Math.floor(piece.x - scrap.bbox.x + 1e-7), y = Math.floor(piece.y - scrap.bbox.y + 1e-7);
  const w = Math.ceil(piece.x - scrap.bbox.x + piece.width - 1e-7) - x;
  const h = Math.ceil(piece.y - scrap.bbox.y + piece.height - 1e-7) - y;
  const mask = scrap.usableMask || scrap.mask;
  return rectangleInside({ scrap, integral: invalidIntegral(mask, scrap.bbox.width, scrap.bbox.height) }, x, y, w, h);
}

function patternDefinition(product, size, seamAllowance) {
  const presets = {
    tote: { widthCm: 24, heightCm: 28, handleLengthCm: 36, handleWidthCm: 3, title: 'Patchwork tote' },
    pouch: { widthCm: 18, heightCm: 12, title: 'Zipped patchwork pouch' },
    cushion: { widthCm: 28, heightCm: 28, title: 'Envelope cushion cover' },
  };
  if (!presets[product]) throw new Error('Choose tote, pouch, or cushion.');
  const d = { ...presets[product], ...(typeof size === 'object' && size ? size : {}) };
  if (typeof size === 'number') { d.widthCm *= size; d.heightCm *= size; if (d.handleLengthCm) d.handleLengthCm *= size; }
  for (const key of ['widthCm', 'heightCm']) if (!Number.isFinite(d[key]) || d[key] < 3 || d[key] > 200) throw new Error('Finished dimensions must be between 3 and 200 centimetres.');
  const panels = product === 'cushion'
    ? [{ id: 'front', widthCm: d.widthCm, heightCm: d.heightCm }, { id: 'back-upper', widthCm: d.widthCm, heightCm: d.heightCm * .65, patternHeightCm: d.heightCm * .65 + seamAllowance, hem: true }, { id: 'back-lower', widthCm: d.widthCm, heightCm: d.heightCm * .65, patternHeightCm: d.heightCm * .65 + seamAllowance, hem: true }]
    : [{ id: 'front', widthCm: d.widthCm, heightCm: d.heightCm, patternHeightCm: d.heightCm + (product === 'tote' ? seamAllowance : 0) }, { id: 'back', widthCm: d.widthCm, heightCm: d.heightCm, patternHeightCm: d.heightCm + (product === 'tote' ? seamAllowance : 0) }];
  const supplies = product === 'pouch' ? [`${d.widthCm} cm zipper`, 'Sewing thread'] : ['Sewing thread'];
  if (product === 'cushion') supplies.push(`${d.widthCm} × ${d.heightCm} cm cushion insert`);
  const assembly = [
    `Use ${seamAllowance} cm seams. Each cut rectangle already includes this allowance on all four edges.`,
    'Label every cut. Join each panel row left to right, then join rows top to bottom. Press seams open and trim thread ends.',
    ...(product === 'tote' ? [
      'Join the labeled handle segments end to end. Fold each handle strip lengthwise with right sides together, sew its long edge, then turn the tube, press flat, and topstitch both edges.',
      'Place front and back right sides together. Stitch the sides and bottom; finish raw edges. Turn the bag right side out.',
      'Fold the top edge inward twice using the reserved seam allowance. Position handles evenly and reinforce their attachment with a box and cross stitch.',
    ] : product === 'pouch' ? [
      'Attach the zipper to the top edges of front and back, right sides together, then topstitch. Leave the zipper partly open.',
      'Place front and back right sides together. Stitch the remaining three edges, finish raw edges, and turn through the zipper opening.',
    ] : [
      'Double fold and stitch the free opening edge of each back flap using the reserved allowance.',
      'Place both back flaps right sides against the front with their finished edges overlapping in the center. Stitch the perimeter and finish raw edges.',
      'Turn the cover through the envelope opening and insert the cushion.',
    ]),
    'Make a paper mock-up and check measurements before cutting. Inspect actual fabric, grain, stretch, holes, and handle strength; the image cannot certify them.',
  ];
  return { dimensions: d, panels, assembly, supplies };
}

function makePatches(definition, columns, rows, seamAllowance, product) {
  const patches = [];
  definition.panels.forEach(panel => {
    const panelRows = panel.hem ? Math.max(1, Math.ceil(rows * .65)) : rows;
    for (let row = 0; row < panelRows; row++) for (let col = 0; col < columns; col++) {
      const finishedWidthCm = panel.widthCm / columns, finishedHeightCm = (panel.patternHeightCm || panel.heightCm) / panelRows;
      patches.push({ id: `${panel.id}-r${row + 1}c${col + 1}`, panel: panel.id, row, col, rows: panelRows, cols: columns,
        finishedWidthCm, finishedHeightCm, cutWidthCm: finishedWidthCm + 2 * seamAllowance, cutHeightCm: finishedHeightCm + 2 * seamAllowance, seamAllowanceCm: seamAllowance,
        grainConstraint: 'Unverified: inspect and align fabric grain manually.' });
    }
  });
  if (product === 'tote') {
    const segments = 4, d = definition.dimensions;
    for (const side of ['left', 'right']) for (let i = 0; i < segments; i++) {
      // A sewn, flattened tube is twice the final strap width before folding.
      const finishedWidthCm = d.handleWidthCm * 2, finishedHeightCm = d.handleLengthCm / segments;
      patches.push({ id: `handle-${side}-${i + 1}`, panel: `handle-${side}`, row: i, col: 0, rows: segments, cols: 1,
        finishedWidthCm, finishedHeightCm, cutWidthCm: finishedWidthCm + 2 * seamAllowance, cutHeightCm: finishedHeightCm + 2 * seamAllowance,
        seamAllowanceCm: seamAllowance, grainConstraint: 'Place length along a strong grain; physical strength must be checked.' });
    }
  }
  return patches;
}

function findPlacement(state, w, h, reverse = false, remainingLike = 1) {
  const { width, height } = state.scrap.bbox;
  if (w > width || h > height) return null;
  const step = Math.max(2, Math.floor(state.scrap.pixelsPerCm * .25));
  const ys = [], xs = [];
  for (let y = 0; y <= height - h; y += step) ys.push(y);
  for (let x = 0; x <= width - w; x += step) xs.push(x);
  if (ys[ys.length - 1] !== height - h) ys.push(height - h);
  if (xs[xs.length - 1] !== width - w) xs.push(width - w);
  // Existing cut boundaries are useful anchors even when off the coarse grid.
  state.placed.forEach(p => { if (p.x + p.w <= width - w) xs.push(p.x + p.w); if (p.y + p.h <= height - h) ys.push(p.y + p.h); });
  const xPositions = [...new Set(xs)].sort((a, b) => a - b), yPositions = [...new Set(ys)].sort((a, b) => a - b);
  if (reverse) { xPositions.reverse(); yPositions.reverse(); }
  // Reserving a free aligned block first prevents a sloped top edge from
  // attracting one cut into the middle of an otherwise usable four-cut row.
  // The reservation is only a search preference; every actual cut is checked.
  const groups = [[3, 2], [2, 3], [2, 2], [3, 1], [1, 3], [2, 1], [1, 2], [1, 1]];
  for (const [cols, rows] of groups) {
    if (cols * rows > remainingLike || cols * w > width || rows * h > height) continue;
    if (cols * rows * w * h > state.scrap.usableAreaPx - state.used) continue;
    for (const y of yPositions) for (const x of xPositions) {
      if (!rectangleInside(state, x, y, w * cols, h * rows)) continue;
      const reservation = { x, y, w: w * cols, h: h * rows };
      if (!state.placed.some(p => rectanglesOverlap(reservation, p))) return { x, y, w, h, capacity: cols * rows };
    }
  }
  return null;
}

function tryPack(scraps, patches, rotation, objective, reverse, sharedIntegrals) {
  const states = scraps.map(scrap => ({ scrap, integral: sharedIntegrals.get(scrap.id), placed: [], used: 0 }));
  const panelPriority = id => id === 'front' ? 0 : id.startsWith('back') ? 1 : 2;
  const sorted = [...patches].sort((a, b) => b.cutWidthCm * b.cutHeightCm - a.cutWidthCm * a.cutHeightCm
    || panelPriority(a.panel) - panelPriority(b.panel) || a.row - b.row || a.col - b.col || a.id.localeCompare(b.id));
  const pieces = [], missing = [], colorUse = new Map();
  const dimensionKey = p => `${round(p.cutWidthCm, 5)}:${round(p.cutHeightCm, 5)}`;
  const remainingCounts = new Map();
  sorted.forEach(p => remainingCounts.set(dimensionKey(p), (remainingCounts.get(dimensionKey(p)) || 0) + 1));
  for (const patch of sorted) {
    const remainingLike = remainingCounts.get(dimensionKey(patch));
    let best = null;
    for (const state of states) {
      const ppcm = state.scrap.pixelsPerCm;
      for (const rotated of rotation && Math.abs(patch.cutWidthCm - patch.cutHeightCm) > .001 ? [false, true] : [false]) {
        const width = (rotated ? patch.cutHeightCm : patch.cutWidthCm) * ppcm;
        const height = (rotated ? patch.cutWidthCm : patch.cutHeightCm) * ppcm;
        const candidate = findPlacement(state, Math.ceil(width - 1e-7), Math.ceil(height - 1e-7), reverse, remainingLike);
        if (!candidate) continue;
        const remaining = state.scrap.usableAreaPx - state.used;
        const preference = objective === 'color' ? (colorUse.get(state.scrap.id) || 0) * 100000 + remaining : remaining;
        const score = preference - candidate.capacity * 50000 + candidate.y * .02 + candidate.x * .001;
        if (!best || score < best.score) best = { state, candidate, score, rotated, width, height };
      }
    }
    remainingCounts.set(dimensionKey(patch), remainingLike - 1);
    if (!best) { missing.push({ ...patch, reason: 'No non-overlapping rectangle found inside the measured usable masks.' }); continue; }
    const { state, candidate, rotated, width, height } = best;
    state.placed.push(candidate); state.used += candidate.w * candidate.h;
    colorUse.set(state.scrap.id, (colorUse.get(state.scrap.id) || 0) + 1);
    pieces.push({ ...patch, scrapId: state.scrap.id, color: state.scrap.color, rotated,
      x: state.scrap.bbox.x + candidate.x, y: state.scrap.bbox.y + candidate.y, width, height,
      widthCm: width / state.scrap.pixelsPerCm, heightCm: height / state.scrap.pixelsPerCm, pixelsPerCm: state.scrap.pixelsPerCm,
      occupiedPixelWidth: candidate.w, occupiedPixelHeight: candidate.h,
    });
  }
  pieces.sort((a, b) => a.panel.localeCompare(b.panel) || a.row - b.row || a.col - b.col);
  return { pieces, missing };
}

/**
 * Mask-aware rectangular patch nesting. A failed heuristic search is not proof
 * that no arrangement exists; feasible is true only for a complete valid plan.
 */
export function optimizePattern(inputScraps, options = {}) {
  const product = options.product || 'tote', seamAllowanceCm = Number(options.seamAllowanceCm ?? .7);
  if (!Number.isFinite(seamAllowanceCm) || seamAllowanceCm < .2 || seamAllowanceCm > 3) throw new Error('Seam allowance must be between 0.2 and 3 centimetres.');
  const objective = ['balanced', 'waste', 'color'].includes(options.objective) ? options.objective : 'balanced';
  const rotation = options.rotation !== false;
  const definition = patternDefinition(product, options.size, seamAllowanceCm);
  const scraps = (inputScraps || []).filter(s => s.usable !== false && s.mask && Number.isFinite(s.pixelsPerCm) && s.pixelsPerCm > 0);
  scraps.forEach(s => { if (!s.usableMask) s.usableMask = morphology(s.mask, s.bbox.width, s.bbox.height, false); if (!s.usableAreaPx) s.usableAreaPx = s.usableMask.reduce((sum, p) => sum + p, 0); });
  const sharedIntegrals = new Map(scraps.map(s => [s.id, invalidIntegral(s.usableMask, s.bbox.width, s.bbox.height)]));
  const availableAreaCm2 = scraps.reduce((sum, s) => sum + s.usableAreaPx / s.pixelsPerCm ** 2, 0);
  const grids = options.grid ? [[Number(options.grid.cols), Number(options.grid.rows)]]
    : objective === 'color' ? [[3, 3], [2, 2], [3, 2], [2, 3], [1, 1], [4, 3], [3, 4], [4, 4]]
    : objective === 'waste' ? [[1, 1], [2, 2], [3, 2], [2, 3], [3, 3], [4, 3], [3, 4], [4, 4]]
    : [[2, 2], [3, 2], [2, 3], [1, 1], [3, 3], [4, 3], [3, 4], [4, 4]];
  let selected = null, attempts = 0;
  for (const [cols, rows] of grids) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 8 || rows > 8) throw new Error('Patch grid must use 1 to 8 rows and columns.');
    const patches = makePatches(definition, cols, rows, seamAllowanceCm, product);
    const requiredAreaCm2 = patches.reduce((sum, p) => sum + p.cutWidthCm * p.cutHeightCm, 0);
    if (selected && selected.missing.length === 0 && requiredAreaCm2 >= selected.requiredAreaCm2 && objective !== 'color') continue;
    for (const reverse of [false, true]) {
      attempts++;
      const packed = tryPack(scraps, patches, rotation, objective, reverse, sharedIntegrals);
      const candidate = { ...packed, requiredAreaCm2, grid: { cols, rows }, patchCount: patches.length };
      const ratio = packed.pieces.length / patches.length, selectedRatio = selected ? selected.pieces.length / selected.patchCount : -1;
      if (!selected || ratio > selectedRatio + 1e-8 || Math.abs(ratio - selectedRatio) < 1e-8 && (packed.missing.length < selected.missing.length || packed.missing.length === selected.missing.length && requiredAreaCm2 < selected.requiredAreaCm2)) selected = candidate;
      if (!packed.missing.length && objective !== 'color') break;
    }
    // Grids are ordered to minimize seams, then larger counts for tighter shapes.
    if (selected?.missing.length === 0) break;
    if (requiredAreaCm2 > availableAreaCm2 * 1.03 && selected && selected.pieces.length === 0) break;
  }
  selected ||= { pieces: [], missing: [], requiredAreaCm2: 0, grid: { cols: 1, rows: 1 }, patchCount: 0 };
  const usedAreaCm2 = selected.pieces.reduce((sum, p) => sum + p.widthCm * p.heightCm, 0);
  let valid = true;
  // Separate validation pass: conservative cell containment and no overlapping cuts.
  for (let i = 0; i < selected.pieces.length; i++) {
    const p = selected.pieces[i], state = scraps.find(s => s.id === p.scrapId);
    if (!state || !isPieceContained(p, state)) valid = false;
    for (let j = 0; j < i; j++) {
      const q = selected.pieces[j];
      if (p.scrapId === q.scrapId && rectanglesOverlap({ x: p.x, y: p.y, w: p.occupiedPixelWidth, h: p.occupiedPixelHeight }, { x: q.x, y: q.y, w: q.occupiedPixelWidth, h: q.occupiedPixelHeight })) valid = false;
    }
  }
  const feasible = selected.missing.length === 0 && selected.patchCount > 0 && valid;
  const warnings = [];
  if (!feasible) warnings.push('A complete cutting layout was not found. The shown partial cuts do not make the finished product; try a smaller size, more fabric, or a different product.');
  if (!valid) warnings.push('Geometric validation failed; this plan must not be cut.');
  if (selected.requiredAreaCm2 > availableAreaCm2) warnings.push('Required cut area exceeds the detected usable fabric area.');
  if (!rotation) warnings.push('Rotation was disabled. Grain direction still needs manual verification.');
  return {
    version: '1.0', product, title: definition.dimensions.title, feasible, validated: valid, objective, rotation,
    seamAllowanceCm, dimensions: definition.dimensions, panels: definition.panels, grid: selected.grid,
    pieces: selected.pieces, unplaced: selected.missing, assembly: definition.assembly, supplies: definition.supplies, warnings,
    stats: { requiredAreaCm2: round(selected.requiredAreaCm2), usedAreaCm2: round(usedAreaCm2), availableAreaCm2: round(availableAreaCm2),
      utilization: availableAreaCm2 ? usedAreaCm2 / availableAreaCm2 : 0, remainingAreaCm2: round(Math.max(0, availableAreaCm2 - usedAreaCm2)),
      unplaced: selected.missing.length, placed: selected.pieces.length, totalPieces: selected.patchCount, scrapsUsed: new Set(selected.pieces.map(p => p.scrapId)).size,
      estimatedFinishedAreaCm2: round(definition.panels.reduce((sum, p) => sum + p.widthCm * p.heightCm, 0)), searchAttempts: attempts,
      method: 'Deterministic rectangular patch nesting on conservative pixel masks; no global-optimality claim.',
    },
  };
}

const escapeXML = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

/** A source-layout SVG whose mm dimensions preserve the entered calibration. */
export function exportCuttingSVG(plan, scraps) {
  if (!plan || !Array.isArray(plan.pieces)) throw new Error('Generate a plan first.');
  const source = scraps || [], ppcm = source[0]?.pixelsPerCm || plan.pieces[0]?.pixelsPerCm;
  if (!ppcm) throw new Error('A calibrated fabric analysis is needed to export a scale drawing.');
  const maxX = Math.max(0, ...source.map(s => s.bbox.x + s.bbox.width)), maxY = Math.max(0, ...source.map(s => s.bbox.y + s.bbox.height));
  const marginCm = 2, widthCm = maxX / ppcm + marginCm * 2, heightCm = maxY / ppcm + marginCm * 2 + 5;
  const mm = pixel => pixel / ppcm * 10, margin = marginCm * 10;
  const paths = source.map(s => `<path d="${s.contour.map((p, i) => `${i ? 'L' : 'M'}${round(mm(p.x) + margin, 3)} ${round(mm(p.y) + margin, 3)}`).join(' ')} Z" fill="${escapeXML(s.color)}" fill-opacity="0.13" stroke="#9a9a93" stroke-width="0.3"/>`).join('\n');
  const pieces = plan.pieces.map(p => {
    const x = mm(p.x) + margin, y = mm(p.y) + margin, w = mm(p.width), h = mm(p.height), seam = plan.seamAllowanceCm * 10;
    const label = `${p.id} · ${round(p.widthCm)}×${round(p.heightCm)} cm${p.rotated ? ' · rotated' : ''}`;
    return `<g><rect x="${round(x, 3)}" y="${round(y, 3)}" width="${round(w, 3)}" height="${round(h, 3)}" fill="none" stroke="#161b18" stroke-width="0.35"/><rect x="${round(x + seam, 3)}" y="${round(y + seam, 3)}" width="${round(Math.max(0, w - 2 * seam), 3)}" height="${round(Math.max(0, h - 2 * seam), 3)}" fill="none" stroke="#57765b" stroke-width="0.25" stroke-dasharray="1.5 1.2"/><text x="${round(x + 2, 3)}" y="${round(y + 5, 3)}" font-size="2.7">${escapeXML(label)}</text></g>`;
  }).join('\n');
  const footerY = maxY / ppcm * 10 + margin + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(widthCm * 10, 3)}mm" height="${round(heightCm * 10, 3)}mm" viewBox="0 0 ${round(widthCm * 10, 3)} ${round(heightCm * 10, 3)}"><title>${escapeXML(plan.title)} — calibrated cutting layout</title><desc>Solid lines are cut lines. Dashed lines mark seam allowances. Source width calibration is user supplied. Print at 100 percent; verify the 10 cm scale bar. ${plan.feasible ? 'Complete validated geometric layout.' : 'INCOMPLETE: partial layout, do not cut as a complete product.'}</desc><rect width="100%" height="100%" fill="white"/><g font-family="Arial, sans-serif" fill="#161b18">${paths}${pieces}<text x="${margin}" y="${round(footerY)}" font-size="4.2">${escapeXML(plan.title)} · ${plan.feasible ? 'Complete layout' : 'INCOMPLETE — partial cuts only'}</text><text x="${margin}" y="${round(footerY + 7)}" font-size="3.2">Solid = cut. Dashed = ${plan.seamAllowanceCm} cm seams, already included. Print at 100%. Check physical fabric and grain.</text><path d="M${margin} ${round(footerY + 17)}h100m-100 -2v4m100 -4v4" stroke="#161b18" stroke-width=".6" fill="none"/><text x="${margin + 37}" y="${round(footerY + 25)}" font-size="3.5">10 cm scale check</text><text x="${margin}" y="${round(footerY + 33)}" font-size="3">${escapeXML(plan.dimensions.widthCm)} × ${escapeXML(plan.dimensions.heightCm)} cm finished · ${plan.pieces.length} placed / ${plan.stats.totalPieces} required cuts</text></g></svg>`;
}

/** Human-auditable measurement and plan export, without megabytes of typed masks. */
export function exportPlanJSON(plan, analysis) {
  const cleanScraps = (analysis?.scraps || []).map(({ mask, usableMask, ...scrap }) => scrap);
  return JSON.stringify({ format: 'rethread-cutting-report', version: 1, createdAt: new Date().toISOString(),
    measurement: analysis ? { widthPx: analysis.width, heightPx: analysis.height, sceneWidthCm: analysis.sceneWidthCm, sceneHeightCm: analysis.sceneHeightCm, pixelsPerCm: analysis.pixelsPerCm, background: analysis.background, metrics: analysis.metrics, warnings: analysis.warnings, scraps: cleanScraps } : null,
    plan, limitations: ['Flat top-down photograph and accurate scene width required.', 'Outlines and physical dimensions are image-derived estimates; inspect every cut boundary.', 'Fabric type, durability, stretch, grain, and hidden holes are not verified.', 'The nesting heuristic finds validated layouts, not provably optimal layouts.'],
  }, null, 2);
}
