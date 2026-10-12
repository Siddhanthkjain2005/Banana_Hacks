// FabricNet inference and grain estimation. Runs inside the vision worker on
// local pixels; nothing here touches the network except loading the weights.
//
// 1. Pattern: a small CNN (trained from scratch on synthetic textile patches,
//    see scripts/train-fabricnet.mjs) classifies up to ten patches per scrap at
//    two scales; class probabilities are averaged.
// 2. Grain: two independent estimates of how far the fabric's straight grain
//    is rotated from the photo axes. Woven warp and weft are perpendicular, so
//    angles are folded into (-45°, 45°].
//    - Pattern orientation: gradient structure averaged at 4× angle (mod 90°).
//    - Cut edges: length-weighted orientation histogram of the traced outline.

const PATCH = 32;

function decodeBase64(text) {
  const binary = typeof atob === 'function' ? atob(text) : Buffer.from(text, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function loadFabricNet(model) {
  if (!model || model.name !== 'FabricNet' || !Array.isArray(model.weights?.tensors)) throw new Error('FabricNet weights are missing or invalid.');
  const layers = model.architecture.map(() => ({}));
  for (const t of model.weights.tensors) {
    const data = decodeBase64(t.data);
    if (data.length !== t.length) throw new Error('FabricNet tensor length mismatch.');
    layers[t.layer][t.key] = data;
  }
  return { classes: model.classes, version: model.version, sha256: model.weights.sha256, layers, evaluation: model.evaluation };
}

function conv(input, C, S, w, b, OC) {
  const out = new Float32Array(OC * S * S);
  for (let oc = 0; oc < OC; oc++) {
    const o = out.subarray(oc * S * S, (oc + 1) * S * S); o.fill(b[oc]);
    for (let c = 0; c < C; c++) {
      const inp = input.subarray(c * S * S, (c + 1) * S * S);
      for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
        const k = w[((oc * C + c) * 3 + ky) * 3 + kx], dy = ky - 1, dx = kx - 1;
        const y0 = Math.max(0, -dy), y1 = Math.min(S, S - dy), x0 = Math.max(0, -dx), x1 = Math.min(S, S - dx);
        for (let y = y0; y < y1; y++) { const orow = y * S, irow = (y + dy) * S + dx; for (let x = x0; x < x1; x++) o[orow + x] += k * inp[irow + x]; }
      }
    }
  }
  return out;
}
function reluPool(x, C, S) {
  const H = S / 2, out = new Float32Array(C * H * H);
  for (let c = 0; c < C; c++) for (let y = 0; y < H; y++) for (let xx = 0; xx < H; xx++) {
    const i = c * S * S + y * 2 * S + xx * 2;
    out[c * H * H + y * H + xx] = Math.max(0, x[i], x[i + 1], x[i + S], x[i + S + 1]);
  }
  return out;
}

/** Class probabilities for one 3 × 32 × 32 patch with RGB values in [0, 1]. */
export function classifyPatch(net, patch) {
  const n = PATCH * PATCH, x = new Float32Array(3 * n), L = net.layers;
  for (let c = 0; c < 3; c++) { let m = 0; for (let i = 0; i < n; i++) m += patch[c * n + i]; m /= n; for (let i = 0; i < n; i++) x[c * n + i] = (patch[c * n + i] - m) * 4; }
  const p1 = reluPool(conv(x, 3, 32, L[0].w, L[0].b, 8), 8, 32);
  const p2 = reluPool(conv(p1, 8, 16, L[1].w, L[1].b, 16), 16, 16);
  const a3 = conv(p2, 16, 8, L[2].w, L[2].b, 32), gap = new Float32Array(32);
  for (let c = 0; c < 32; c++) { let s = 0; for (let i = 0; i < 64; i++) { const v = a3[c * 64 + i]; if (v > 0) s += v; } gap[c] = s / 64; }
  const h = new Float32Array(32);
  for (let o = 0; o < 32; o++) { let s = L[3].b[o]; for (let i = 0; i < 32; i++) s += L[3].w[o * 32 + i] * gap[i]; h[o] = s > 0 ? s : 0; }
  const logits = new Float32Array(net.classes.length);
  for (let o = 0; o < logits.length; o++) { let s = L[4].b[o]; for (let i = 0; i < 32; i++) s += L[4].w[o * 32 + i] * h[i]; logits[o] = s; }
  const max = Math.max(...logits), e = Array.from(logits, v => Math.exp(v - max)), sum = e.reduce((a, b) => a + b, 0);
  return e.map(v => v / sum);
}

function invalidIntegral(mask, w, h) {
  const stride = w + 1, integral = new Uint32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) { let sum = 0; for (let x = 0; x < w; x++) { sum += mask[y * w + x] ? 0 : 1; integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum; } }
  return integral;
}
function squareInside(integral, w, x, y, s) {
  const stride = w + 1;
  return integral[(y + s) * stride + x + s] - integral[y * stride + x + s] - integral[(y + s) * stride + x] + integral[y * stride + x] === 0;
}

/** Up to `count` well-spread square windows fully inside the scrap's usable mask. */
export function squareWindows(scrap, size, count) {
  const { width, height } = scrap.bbox, mask = scrap.usableMask || scrap.mask;
  if (width < size || height < size) return [];
  const integral = invalidIntegral(mask, width, height), step = Math.max(2, Math.floor(size / 4)), candidates = [];
  for (let y = 0; y + size <= height; y += step) for (let x = 0; x + size <= width; x += step) if (squareInside(integral, width, x, y, size)) candidates.push({ x, y });
  if (!candidates.length) return [];
  const cx = width / 2 - size / 2, cy = height / 2 - size / 2, chosen = [];
  candidates.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2));
  chosen.push(candidates[0]);
  while (chosen.length < count) {
    let best = null, bestD = -1;
    for (const c of candidates) { const d = Math.min(...chosen.map(k => (k.x - c.x) ** 2 + (k.y - c.y) ** 2)); if (d > bestD) { bestD = d; best = c; } }
    if (!best || bestD < (size * .5) ** 2) break; chosen.push(best);
  }
  return chosen.map(p => ({ x: scrap.bbox.x + p.x, y: scrap.bbox.y + p.y, size }));
}

function readPatch(imageData, win) {
  const { width, data } = imageData, out = new Float32Array(3 * PATCH * PATCH), f = win.size / PATCH;
  for (let y = 0; y < PATCH; y++) for (let x = 0; x < PATCH; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const i = ((win.y + y * f + dy) * width + win.x + x * f + dx) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; }
    const n = f * f * 255, o = y * PATCH + x;
    out[o] = r / n; out[PATCH * PATCH + o] = g / n; out[2 * PATCH * PATCH + o] = b / n;
  }
  return out;
}

const fold = deg => { let d = ((deg % 90) + 90) % 90; return d > 45 ? d - 90 : d; };
function peakOfFoldedHistogram(hist) {
  // hist: 90 one-degree bins over [0°, 90°), circular. Smooth, then find the peak.
  const smooth = hist.map((_, i) => { let s = 0; for (let k = -2; k <= 2; k++) s += hist[(i + k + 90) % 90] * Math.exp(-k * k / 4); return s; });
  let peak = 0; for (let i = 1; i < 90; i++) if (smooth[i] > smooth[peak]) peak = i;
  const a = smooth[(peak + 89) % 90], b = smooth[peak], c = smooth[(peak + 1) % 90], denom = a - 2 * b + c;
  const offset = denom ? Math.max(-.5, Math.min(.5, .5 * (a - c) / denom)) : 0;
  const total = hist.reduce((s, v) => s + v, 0);
  let near = 0; for (let k = -4; k <= 4; k++) near += hist[(peak + k + 90) % 90];
  return { angle: peak + offset + .5, share: total ? near / total : 0 };
}

/**
 * Orientation of a pattern inside a square window, by projection profiles (a
 * discrete Radon transform). For each candidate angle the smoothed luminance
 * inside a circular aperture is binned by signed distance along that angle;
 * stripes or checks aligned with the angle give a sharply varying profile,
 * measured as the share of luminance variance explained by the 1D profile.
 * Angles θ and θ + 90° are summed because warp and weft are perpendicular, so
 * the result is folded into (-45°, 45°]. Coherence is the explained share.
 */
export function textureGrain(imageData, win) {
  const N = win.size, { width, data } = imageData, lum = new Float32Array(N * N), tmp = new Float32Array(N * N), k = [1, 4, 6, 4, 1];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = ((win.y + y) * width + win.x + x) * 4; lum[y * N + x] = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2]; }
  // Separable binomial blur suppresses pixel-level weave and sensor noise.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0, w = 0; for (let j = -2; j <= 2; j++) { const xx = x + j; if (xx < 0 || xx >= N) continue; s += lum[y * N + xx] * k[j + 2]; w += k[j + 2]; } tmp[y * N + x] = s / w; }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0, w = 0; for (let j = -2; j <= 2; j++) { const yy = y + j; if (yy < 0 || yy >= N) continue; s += tmp[yy * N + x] * k[j + 2]; w += k[j + 2]; } lum[y * N + x] = s / w; }
  const c = (N - 1) / 2, R = N / 2 - 1, xs = [], ys = [], vs = [];
  let mean = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = x - c, dy = y - c; if (dx * dx + dy * dy > R * R) continue; xs.push(dx); ys.push(dy); vs.push(lum[y * N + x]); mean += lum[y * N + x]; }
  mean /= vs.length;
  let variance = 0; for (const v of vs) variance += (v - mean) ** 2; variance /= vs.length;
  if (variance < 4) return { deviationDeg: 0, confidence: 0, energy: variance };
  const bins = 2 * Math.ceil(R) + 3, sum = new Float64Array(bins), count = new Uint32Array(bins);
  const explained = angle => {
    const a = angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    sum.fill(0); count.fill(0);
    for (let i = 0; i < vs.length; i++) { const b = Math.round(xs[i] * ca + ys[i] * sa + R + 1); sum[b] += vs[i] - mean; count[b]++; }
    let e = 0; for (let b = 0; b < bins; b++) if (count[b]) e += sum[b] * sum[b] / count[b];
    return e / vs.length / variance;
  };
  const step = .5, scores = [];
  for (let t = -45; t < 45; t += step) scores.push(explained(t) + explained(t + 90));
  let best = 0; for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  const n = scores.length, a = scores[(best + n - 1) % n], b = scores[best], d = scores[(best + 1) % n], denom = a - 2 * b + d;
  const offset = denom ? Math.max(-.5, Math.min(.5, .5 * (a - d) / denom)) : 0;
  return { deviationDeg: Math.round(fold(-45 + (best + offset) * step) * 10) / 10, confidence: Math.round(Math.min(1, b) * 100) / 100, energy: variance };
}

/** Orientation of straight cut edges from the traced outline (folded mod 90°). */
export function edgeGrain(contour) {
  const hist = new Array(90).fill(0); let total = 0;
  for (let i = 0; i < (contour?.length || 0); i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 2) continue; total += len;
    hist[Math.floor(((Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI) % 90 + 90) % 90) % 90] += len;
  }
  if (!total) return { deviationDeg: 0, confidence: 0 };
  const { angle, share } = peakOfFoldedHistogram(hist);
  return { deviationDeg: Math.round(fold(angle) * 10) / 10, confidence: Math.round(share * 100) / 100 };
}

const LABELS = { solid: 'Solid', textured: 'Textured weave', stripe: 'Stripe', check: 'Check / plaid', dot: 'Dots', print: 'Print' };

/** Pattern class, confidence, and grain estimate for every scrap. Mutates nothing. */
export function analyzeFabric(imageData, scraps, net) {
  const started = Date.now();
  const results = scraps.map(scrap => {
    const windows = [...squareWindows(scrap, 64, 5), ...squareWindows(scrap, 32, 5)];
    let probs = null;
    if (net && windows.length) {
      probs = net.classes.map(() => 0);
      for (const win of windows) classifyPatch(net, readPatch(imageData, win)).forEach((p, i) => { probs[i] += p / windows.length; });
    }
    const best = probs ? probs.indexOf(Math.max(...probs)) : -1, pattern = best >= 0 ? net.classes[best] : null;
    const largest = windows[0];
    const spectral = largest ? textureGrain(imageData, largest) : null, edges = edgeGrain(scrap.contour);
    const periodic = pattern === 'stripe' || pattern === 'check';
    let grain = { deviationDeg: null, confidence: 0, source: null, reliable: false };
    if (periodic && spectral && spectral.confidence >= .3) grain = { deviationDeg: spectral.deviationDeg, confidence: spectral.confidence, source: 'pattern', reliable: true };
    else if (edges.confidence >= .45) grain = { deviationDeg: edges.deviationDeg, confidence: edges.confidence, source: 'edges', reliable: true };
    return {
      scrapId: scrap.id, pattern, label: pattern ? LABELS[pattern] : 'Too small to classify', confidence: probs ? Math.round(probs[best] * 1000) / 1000 : 0,
      probabilities: probs ? Object.fromEntries(net.classes.map((c, i) => [c, Math.round(probs[i] * 1000) / 1000])) : null,
      patches: windows.length, directional: pattern === 'stripe' && (probs?.[best] || 0) >= .5, grain,
      evidence: { edges, spectral: spectral && { deviationDeg: spectral.deviationDeg, confidence: spectral.confidence } },
    };
  });
  return { model: net ? { name: 'FabricNet', version: net.version, sha256: net.sha256 } : null, elapsedMs: Date.now() - started, scraps: results };
}

/** Compact, server-safe summary attached to each scrap for grain-aware planning. */
export function fabricSummary(result) {
  if (!result) return undefined;
  return { pattern: result.pattern, confidence: result.confidence, directional: result.directional, grainDeviationDeg: result.grain.reliable ? result.grain.deviationDeg : null, grainSource: result.grain.source };
}
