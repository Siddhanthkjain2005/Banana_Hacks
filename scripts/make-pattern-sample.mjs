// Procedurally render the "Pattern mix" sample: seven patterned offcuts on an
// ivory surface, some rotated off the photo axes. Deterministic; illustrative.
//   node scripts/make-pattern-sample.mjs  →  dist/assets/sample-patterns.png
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from './lib/texture-synth.mjs';

const require = createRequire(import.meta.url);
const { encodePNG } = require('../api/lib/png.cjs');
const W = 1200, H = 840, PX_PER_CM = W / 90, r = mulberry32(1012);
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const frac = v => v - Math.floor(v);

const patterns = {
  stripe: (u, v) => frac(u / 1.8) < .48 ? hex('#22385e') : hex('#d4b98a'),
  gingham: (u, v) => { const a = frac(u / 1.1) < .5, b = frac(v / 1.1) < .5; return a && b ? hex('#a12c35') : a || b ? hex('#c9646a') : hex('#e3a9a3'); },
  dots: (u, v) => { const row = Math.round(v / 1.15), du = u - (Math.round(u / 1.3 - (row % 2) * .5) + (row % 2) * .5) * 1.3, dv = v - row * 1.15; return du * du + dv * dv < .34 ** 2 ? hex('#f1e2b0') : hex('#b9821e'); },
  floral: (() => {
    const flowers = Array.from({ length: 420 }, () => ({ u: r() * 40 - 20, v: r() * 40 - 20, s: .45 + r() * .5, rot: r() * 6, c: ['#f2a7b5', '#c9a7e3', '#f0c75e'][Math.floor(r() * 3)] }));
    return (u, v) => {
      for (const f of flowers) {
        const du = u - f.u, dv = v - f.v, d = Math.hypot(du, dv);
        if (d > f.s * 1.1) continue;
        if (d < f.s * .22) return hex('#e8b33d');
        const a = Math.atan2(dv, du) + f.rot, petal = Math.abs(Math.cos(2.5 * a));
        if (d < f.s * (.45 + .6 * petal)) return hex(f.c);
      }
      return hex('#2f4b3a');
    };
  })(),
  denim: (u, v) => { const rib = Math.sin(2 * Math.PI * (u + v) / .28) > .15; const base = hex('#3d5f86'); const n = (r() - .5) * 22; return rib ? base.map(c => c + n) : base.map(c => c + 38 + n); },
  sage: (u, v) => hex('#8a9a6b'),
  pinstripe: (u, v) => frac(u / .9) < .13 ? hex('#b9bdb5') : hex('#3f4446'),
};

// Centre (px), size (cm), rotation (deg), pattern.
const scraps = [
  { cx: 306, cy: 268, w: 40, h: 32, rot: -6, p: 'stripe' },
  { cx: 870, cy: 262, w: 39, h: 32, rot: 2, p: 'gingham' },
  { cx: 132, cy: 676, w: 14, h: 15.5, rot: 0, p: 'dots' },
  { cx: 363, cy: 678, w: 14, h: 15, rot: -1, p: 'floral' },
  { cx: 594, cy: 676, w: 13.5, h: 15.5, rot: 1, p: 'denim' },
  { cx: 825, cy: 676, w: 14, h: 15, rot: 0, p: 'sage' },
  { cx: 1058, cy: 678, w: 13, h: 14.5, rot: 9, p: 'pinstripe' },
].map(s => {
  // A gently frayed outline: many vertices around the rectangle with jitter.
  const pts = [], hw = s.w / 2, hh = s.h / 2, per = 18;
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [x + (r() - .5) * 1.2, y + (r() - .5) * 1.2]);
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = corners[k], [bx, by] = corners[(k + 1) % 4];
    for (let i = 0; i < per; i++) { const t = i / per, j = (r() - .5) * .22, nx = by - ay, ny = -(bx - ax), nl = Math.hypot(nx, ny); pts.push([ax + (bx - ax) * t + nx / nl * j, ay + (by - ay) * t + ny / nl * j]); }
  }
  return { ...s, pts, rad: s.rot * Math.PI / 180 };
});

function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const owner = new Int8Array(W * H).fill(-1), local = new Float32Array(W * H * 2);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  for (let k = 0; k < scraps.length; k++) {
    const s = scraps[k], dx = (x + .5 - s.cx) / PX_PER_CM, dy = (y + .5 - s.cy) / PX_PER_CM;
    const u = dx * Math.cos(-s.rad) - dy * Math.sin(-s.rad), v = dx * Math.sin(-s.rad) + dy * Math.cos(-s.rad);
    if (Math.abs(u) > s.w / 2 + .5 || Math.abs(v) > s.h / 2 + .5) continue;
    if (inside(s.pts, u, v)) { owner[y * W + x] = k; local[(y * W + x) * 2] = u; local[(y * W + x) * 2 + 1] = v; break; }
  }
}
// Soft contact shadow: blurred, offset foreground mask.
let shadow = new Float32Array(W * H); for (let i = 0; i < owner.length; i++) shadow[i] = owner[i] >= 0 ? 1 : 0;
for (let pass = 0; pass < 3; pass++) {
  const tmp = new Float32Array(W * H), R = 5;
  for (let y = 0; y < H; y++) { let s = 0; for (let x = -R; x < W + R; x++) { if (x + R < W) s += shadow[y * W + x + R]; if (x - R - 1 >= 0) s -= shadow[y * W + x - R - 1]; if (x >= 0 && x < W) tmp[y * W + x] = s / (2 * R + 1); } }
  const out = new Float32Array(W * H);
  for (let x = 0; x < W; x++) { let s = 0; for (let y = -R; y < H + R; y++) { if (y + R < H) s += tmp[(y + R) * W + x]; if (y - R - 1 >= 0) s -= tmp[(y - R - 1) * W + x]; if (y >= 0 && y < H) out[y * W + x] = s / (2 * R + 1); } }
  shadow = out;
}
const data = new Uint8Array(W * H * 4), bg = hex('#efece4');
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, k = owner[i], o = i * 4;
  let c;
  if (k >= 0) {
    const s = scraps[k], u = local[i * 2], v = local[i * 2 + 1];
    c = patterns[s.p](u, v);
    const weave = ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 1 : -1) * 3 + (r() - .5) * 9;
    const light = 1 + .05 * (u / s.w) - .04 * (v / s.h);
    c = c.map(ch => ch * light + weave);
  } else {
    const sx = Math.min(W - 1, Math.max(0, x - 4)), sy = Math.min(H - 1, Math.max(0, y - 6)), sh = shadow[sy * W + sx] * .16;
    c = bg.map(ch => ch * (1 - sh) + (r() - .5) * 4);
  }
  data[o] = Math.max(0, Math.min(255, Math.round(c[0]))); data[o + 1] = Math.max(0, Math.min(255, Math.round(c[1]))); data[o + 2] = Math.max(0, Math.min(255, Math.round(c[2]))); data[o + 3] = 255;
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets', 'sample-patterns.png');
fs.writeFileSync(out, encodePNG({ width: W, height: H, data }));
console.log('wrote', path.relative(process.cwd(), out), scraps.map(s => `${s.p}@${s.rot}°`).join(' '));
