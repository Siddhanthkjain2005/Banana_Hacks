// Procedural textile texture synthesizer used to train and evaluate FabricNet.
// Every sample is drawn at 64 × 64 and box-downsampled to 32 × 32, the same
// path the browser uses for scale-2 patches. Labels come from the generator,
// so the dataset is synthetic by construction; no photographs are used.

export const CLASSES = Object.freeze(['solid', 'textured', 'stripe', 'check', 'dot', 'print']);
export const PATCH = 32;
const HI = PATCH * 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const lum = c => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}
function randomColor(r, minL = .12, maxL = .9) {
  return hsl(r(), Math.pow(r(), .8) * .85, minL + r() * (maxL - minL));
}
function contrasting(r, base, minDelta = .1) {
  for (let i = 0; i < 40; i++) {
    const c = randomColor(r, .06, .95);
    if (Math.abs(lum(c) - lum(base)) >= minDelta) return c;
  }
  const l = lum(base) > .5 ? .1 : .9;
  return [l, l, l];
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const frac = v => v - Math.floor(v);

function fill(img, fn) {
  for (let y = 0; y < HI; y++) for (let x = 0; x < HI; x++) {
    const c = fn(x + .5, y + .5), i = (y * HI + x) * 3;
    img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2];
  }
}
function paintEllipse(img, cx, cy, rx, ry, angle, color) {
  const ca = Math.cos(angle), sa = Math.sin(angle), R = Math.max(rx, ry) + 1;
  for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(HI, Math.ceil(cy + R)); y++) {
    for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(HI, Math.ceil(cx + R)); x++) {
      const dx = x + .5 - cx, dy = y + .5 - cy, u = (dx * ca + dy * sa) / rx, v = (-dx * sa + dy * ca) / ry;
      if (u * u + v * v <= 1) { const i = (y * HI + x) * 3; img[i] = color[0]; img[i + 1] = color[1]; img[i + 2] = color[2]; }
    }
  }
}
function valueNoise(r, cell) {
  const n = Math.ceil(HI / cell) + 2, grid = Float32Array.from({ length: n * n }, () => r() * 2 - 1);
  return (x, y) => {
    const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), g = (i, j) => grid[(j % n) * n + (i % n)];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx, b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

// Pattern periods are expressed in 32-pixel units and doubled at 64 pixels.
const period = (r, lo, hi) => (lo + r() * (hi - lo)) * 2;

const generators = {
  solid(r, img) {
    const c = randomColor(r), weave = r() < .5 ? r() * .012 : 0, p = 2 + Math.floor(r() * 2);
    fill(img, (x, y) => { const w = weave * ((Math.floor(x / p) + Math.floor(y / p)) % 2 ? 1 : -1); return [c[0] + w, c[1] + w, c[2] + w]; });
    return { noise: .004 + r() * .016 };
  },
  textured(r, img) {
    const c = randomColor(r), kind = Math.floor(r() * 4), amp = .04 + r() * .09;
    if (kind === 0) { // twill: fine diagonal ribs
      const p = period(r, 1.6, 3.2), dir = r() < .5 ? 1 : -1, theta = (r() - .5) * .5;
      const ca = Math.cos(theta), sa = Math.sin(theta);
      fill(img, (x, y) => { const u = x * ca + y * sa, v = -x * sa + y * ca, w = amp * Math.sin(2 * Math.PI * (u + dir * v) / p); return [c[0] + w, c[1] + w, c[2] + w]; });
    } else if (kind === 1) { // slub / linen streaks
      fill(img, () => c);
      const horizontal = r() < .5, count = 40 + Math.floor(r() * 60);
      for (let i = 0; i < count; i++) {
        const t = (r() - .5) * 2 * amp, len = 8 + r() * 40, thick = .6 + r() * 1.6, cx = r() * HI, cy = r() * HI;
        paintEllipse(img, cx, cy, horizontal ? len / 2 : thick, horizontal ? thick : len / 2, (r() - .5) * .12, [c[0] + t, c[1] + t, c[2] + t]);
      }
    } else if (kind === 2) { // heathered: two-tone fibres and mottling
      const c2 = mix(c, contrasting(r, c, .05), .35 + r() * .3), noise = valueNoise(r, 2 + r() * 5), fleck = .1 + r() * .35;
      fill(img, (x, y) => { const m = noise(x, y) * amp; const base = r() < fleck ? c2 : c; return [base[0] + m, base[1] + m, base[2] + m]; });
    } else { // denim-like twill with white weft flecks
      const p = period(r, 1.5, 2.6), light = mix(c, [1, 1, 1], .4 + r() * .3), noise = valueNoise(r, 3 + r() * 6);
      fill(img, (x, y) => { const rib = Math.sin(2 * Math.PI * (x + y) / p) > .2; const base = rib ? c : mix(c, light, .5 + noise(x, y) * .5); const m = noise(x, y) * amp * .5; return [base[0] + m, base[1] + m, base[2] + m]; });
    }
    return { noise: .008 + r() * .02 };
  },
  stripe(r, img) {
    const c1 = randomColor(r), c2 = contrasting(r, c1, .08 + r() * .2), theta = r() * Math.PI;
    const p = period(r, 3, 16), ca = Math.cos(theta), sa = Math.sin(theta), phase = r();
    const kind = r();
    if (kind < .55) {
      const duty = .2 + r() * .6;
      fill(img, (x, y) => frac((x * ca + y * sa) / p + phase) < duty ? c1 : c2);
    } else if (kind < .8) { // pinstripe
      const duty = .07 + r() * .12;
      fill(img, (x, y) => frac((x * ca + y * sa) / p + phase) < duty ? c2 : c1);
    } else { // multi-colour band sequence
      const c3 = contrasting(r, c2, .08), bands = [[.0, c1], [.3 + r() * .2, c2], [.6 + r() * .15, c3], [.8 + r() * .1, c2]];
      fill(img, (x, y) => { const f = frac((x * ca + y * sa) / p + phase); let col = c1; for (const [s, c] of bands) if (f >= s) col = c; return col; });
    }
    return { noise: .005 + r() * .02 };
  },
  check(r, img) {
    const c1 = randomColor(r, .5, .95), c2 = contrasting(r, c1, .12 + r() * .25), theta = r() * Math.PI / 2;
    const ca = Math.cos(theta), sa = Math.sin(theta), kind = r(), p = period(r, 4, 16), ph1 = r(), ph2 = r();
    if (kind < .45) { // gingham
      const mid = mix(c1, c2, .5);
      fill(img, (x, y) => { const a = frac((x * ca + y * sa) / p + ph1) < .5, b = frac((-x * sa + y * ca) / p + ph2) < .5; return a && b ? c2 : a || b ? mid : c1; });
    } else if (kind < .75) { // plaid with woven colour mixing
      const c3 = contrasting(r, c2, .08), seq = t => { const f = frac(t); return f < .4 ? c1 : f < .62 ? c2 : f < .7 ? c3 : f < .9 ? c1 : c2; };
      const p2 = r() < .7 ? p : period(r, 4, 16);
      fill(img, (x, y) => mix(seq((x * ca + y * sa) / p + ph1), seq((-x * sa + y * ca) / p2 + ph2), .5));
    } else { // windowpane / grid lines
      const duty = .08 + r() * .14;
      fill(img, (x, y) => frac((x * ca + y * sa) / p + ph1) < duty || frac((-x * sa + y * ca) / p + ph2) < duty ? c2 : c1);
    }
    return { noise: .005 + r() * .02 };
  },
  dot(r, img) {
    const bg = randomColor(r), fg = contrasting(r, bg, .12 + r() * .25), p = period(r, 5, 14), radius = p * (.13 + r() * .22);
    fill(img, () => bg);
    if (r() < .75) {
      const theta = r() * Math.PI, ca = Math.cos(theta), sa = Math.sin(theta), hex = r() < .5, ox = r() * p, oy = r() * p;
      for (let j = -6; j < 14; j++) for (let i = -6; i < 14; i++) {
        const u = i * p + (hex && j % 2 ? p / 2 : 0) + ox, v = j * p * (hex ? .866 : 1) + oy;
        const x = u * ca - v * sa, y = u * sa + v * ca;
        if (x > -radius && y > -radius && x < HI + radius && y < HI + radius) paintEllipse(img, x, y, radius, radius, 0, fg);
      }
    } else { // scattered spots
      const count = Math.round(HI * HI / (p * p) * (.8 + r() * .6));
      for (let i = 0; i < count; i++) { const rr = radius * (.6 + r() * .8); paintEllipse(img, r() * HI, r() * HI, rr, rr * (.8 + r() * .4), r() * 3, fg); }
    }
    return { noise: .005 + r() * .02 };
  },
  print(r, img) {
    const bg = randomColor(r), palette = Array.from({ length: 2 + Math.floor(r() * 3) }, () => contrasting(r, bg, .1 + r() * .2));
    fill(img, () => bg);
    const scale = .6 + r() * 1.2, count = Math.round((14 + r() * 26) / scale);
    for (let i = 0; i < count; i++) {
      const color = palette[Math.floor(r() * palette.length)], cx = r() * HI, cy = r() * HI, kind = r(), s = (3 + r() * 7) * scale;
      if (kind < .35) { // five-petal flower
        const petals = 4 + Math.floor(r() * 3), rot = r() * 6;
        for (let k = 0; k < petals; k++) { const a = rot + k * 2 * Math.PI / petals; paintEllipse(img, cx + Math.cos(a) * s * .55, cy + Math.sin(a) * s * .55, s * .5, s * .26, a, color); }
        paintEllipse(img, cx, cy, s * .22, s * .22, 0, palette[(palette.indexOf(color) + 1) % palette.length]);
      } else if (kind < .65) { // leaf
        paintEllipse(img, cx, cy, s, s * (.25 + r() * .2), r() * Math.PI, color);
      } else if (kind < .85) { // curved stroke
        let x = cx, y = cy, a = r() * 6.28; const w = .8 + r() * 1.6 * scale;
        for (let k = 0; k < 18; k++) { paintEllipse(img, x, y, w, w, 0, color); a += (r() - .5) * .7; x += Math.cos(a) * 1.4; y += Math.sin(a) * 1.4; }
      } else { // irregular blob
        for (let k = 0; k < 4; k++) paintEllipse(img, cx + (r() - .5) * s, cy + (r() - .5) * s, s * (.3 + r() * .4), s * (.3 + r() * .4), r() * 3, color);
      }
    }
    return { noise: .005 + r() * .02 };
  },
};

function boxBlur(img, radius) {
  const out = new Float32Array(img.length);
  for (let y = 0; y < HI; y++) for (let x = 0; x < HI; x++) for (let c = 0; c < 3; c++) {
    let s = 0, n = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= HI || yy >= HI) continue; s += img[(yy * HI + xx) * 3 + c]; n++;
    }
    out[(y * HI + x) * 3 + c] = s / n;
  }
  return out;
}

/** One labelled sample: RGB values in [0, 1], channel-first, 3 × 32 × 32. */
export function synthesize(classIndex, r) {
  let img = new Float32Array(HI * HI * 3);
  const { noise } = generators[CLASSES[classIndex]](r, img);
  if (r() < .3) img = boxBlur(img, 1);
  // Uneven lighting, exposure, and sensor noise.
  const gx = (r() - .5) * .16, gy = (r() - .5) * .16, gain = .8 + r() * .35, offset = (r() - .5) * .08;
  const out = new Float32Array(3 * PATCH * PATCH);
  for (let y = 0; y < PATCH; y++) for (let x = 0; x < PATCH; x++) {
    const light = gain * (1 + gx * (x / PATCH - .5) + gy * (y / PATCH - .5));
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s += img[((y * 2 + dy) * HI + x * 2 + dx) * 3 + c];
      out[c * PATCH * PATCH + y * PATCH + x] = clamp01(s / 4 * light + offset + gaussian(r) * noise);
    }
  }
  return out;
}
function gaussian(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

/** Balanced dataset with the given seed. Returns flat inputs and integer labels. */
export function makeDataset(perClass, seed) {
  const r = mulberry32(seed), n = perClass * CLASSES.length, x = new Float32Array(n * 3 * PATCH * PATCH), y = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const label = i % CLASSES.length; x.set(synthesize(label, r), i * 3 * PATCH * PATCH); y[i] = label; }
  return { x, y, n };
}

/** Synthetic stripe image at a known angle, for grain-estimation tests. */
export function stripeImage(size, angleDeg, periodPx, seed = 7) {
  const r = mulberry32(seed), a = angleDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Stripes run along the angle, so intensity varies across it.
    const v = frac((-x * sa + y * ca) / periodPx) < .5 ? 60 : 200, n = (r() - .5) * 10, i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v + n; data[i + 3] = 255;
  }
  return { width: size, height: size, data };
}
