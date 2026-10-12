// A small convolutional network with hand-written forward and backward passes.
// No ML framework: typed arrays, explicit loops, Adam. Used only for training;
// the browser runs the same architecture through dist/fabric-intel.js.

export const ARCH = Object.freeze([
  { type: 'conv', inC: 3, outC: 8, size: 32 },   // 32×32, then ReLU + 2×2 max pool
  { type: 'conv', inC: 8, outC: 16, size: 16 },  // 16×16, then ReLU + 2×2 max pool
  { type: 'conv', inC: 16, outC: 32, size: 8 },  // 8×8, then ReLU + global average pool
  { type: 'dense', inF: 32, outF: 32 },          // ReLU
  { type: 'dense', inF: 32, outF: 6 },           // softmax
]);

export function initParams(rand) {
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  return ARCH.map(l => {
    const fanIn = l.type === 'conv' ? l.inC * 9 : l.inF, count = l.type === 'conv' ? l.outC * l.inC * 9 : l.outF * l.inF;
    const w = new Float32Array(count), std = Math.sqrt(2 / fanIn);
    for (let i = 0; i < count; i++) w[i] = gauss() * std;
    return { w, b: new Float32Array(l.type === 'conv' ? l.outC : l.outF) };
  });
}

function convForward(input, C, S, w, b, OC) {
  const out = new Float32Array(OC * S * S);
  for (let oc = 0; oc < OC; oc++) {
    const o = out.subarray(oc * S * S, (oc + 1) * S * S); o.fill(b[oc]);
    for (let c = 0; c < C; c++) {
      const inp = input.subarray(c * S * S, (c + 1) * S * S);
      for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
        const k = w[((oc * C + c) * 3 + ky) * 3 + kx], dy = ky - 1, dx = kx - 1;
        const y0 = Math.max(0, -dy), y1 = Math.min(S, S - dy), x0 = Math.max(0, -dx), x1 = Math.min(S, S - dx);
        for (let y = y0; y < y1; y++) {
          const orow = y * S, irow = (y + dy) * S + dx;
          for (let x = x0; x < x1; x++) o[orow + x] += k * inp[irow + x];
        }
      }
    }
  }
  return out;
}

function convBackward(input, C, S, w, OC, dOut, gw, gb, needInput) {
  const dIn = needInput ? new Float32Array(C * S * S) : null;
  for (let oc = 0; oc < OC; oc++) {
    const d = dOut.subarray(oc * S * S, (oc + 1) * S * S);
    let sb = 0; for (let i = 0; i < d.length; i++) sb += d[i]; gb[oc] += sb;
    for (let c = 0; c < C; c++) {
      const inp = input.subarray(c * S * S, (c + 1) * S * S), di = needInput ? dIn.subarray(c * S * S, (c + 1) * S * S) : null;
      for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
        const idx = ((oc * C + c) * 3 + ky) * 3 + kx, k = w[idx], dy = ky - 1, dx = kx - 1;
        const y0 = Math.max(0, -dy), y1 = Math.min(S, S - dy), x0 = Math.max(0, -dx), x1 = Math.min(S, S - dx);
        let g = 0;
        if (di) {
          for (let y = y0; y < y1; y++) {
            const orow = y * S, irow = (y + dy) * S + dx;
            for (let x = x0; x < x1; x++) { const dv = d[orow + x]; g += dv * inp[irow + x]; di[irow + x] += k * dv; }
          }
        } else {
          for (let y = y0; y < y1; y++) {
            const orow = y * S, irow = (y + dy) * S + dx;
            for (let x = x0; x < x1; x++) g += d[orow + x] * inp[irow + x];
          }
        }
        gw[idx] += g;
      }
    }
  }
  return dIn;
}

function reluPool(x, C, S) {
  const H = S / 2, out = new Float32Array(C * H * H), arg = new Int32Array(C * H * H);
  for (let c = 0; c < C; c++) for (let y = 0; y < H; y++) for (let xx = 0; xx < H; xx++) {
    let best = -Infinity, bi = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const i = c * S * S + (y * 2 + dy) * S + xx * 2 + dx; if (x[i] > best) { best = x[i]; bi = i; } }
    const o = c * H * H + y * H + xx; out[o] = best > 0 ? best : 0; arg[o] = best > 0 ? bi : -1;
  }
  return { out, arg };
}

export function normalizeInput(patch) {
  // Remove the patch's mean colour so the network sees structure, not hue.
  const n = patch.length / 3, x = new Float32Array(patch.length);
  for (let c = 0; c < 3; c++) {
    let m = 0; for (let i = 0; i < n; i++) m += patch[c * n + i]; m /= n;
    for (let i = 0; i < n; i++) x[c * n + i] = (patch[c * n + i] - m) * 4;
  }
  return x;
}

export function forward(params, patch, keep = false) {
  const x0 = normalizeInput(patch);
  const a1 = convForward(x0, 3, 32, params[0].w, params[0].b, 8), p1 = reluPool(a1, 8, 32);
  const a2 = convForward(p1.out, 8, 16, params[1].w, params[1].b, 16), p2 = reluPool(a2, 16, 16);
  const a3 = convForward(p2.out, 16, 8, params[2].w, params[2].b, 32);
  const gap = new Float32Array(32);
  for (let c = 0; c < 32; c++) { let s = 0; for (let i = 0; i < 64; i++) { const v = a3[c * 64 + i]; if (v > 0) s += v; } gap[c] = s / 64; }
  const h = new Float32Array(32);
  for (let o = 0; o < 32; o++) { let s = params[3].b[o]; for (let i = 0; i < 32; i++) s += params[3].w[o * 32 + i] * gap[i]; h[o] = s > 0 ? s : 0; }
  const logits = new Float32Array(6);
  for (let o = 0; o < 6; o++) { let s = params[4].b[o]; for (let i = 0; i < 32; i++) s += params[4].w[o * 32 + i] * h[i]; logits[o] = s; }
  const max = Math.max(...logits), e = logits.map(v => Math.exp(v - max)), sum = e.reduce((a, b) => a + b, 0), probs = e.map(v => v / sum);
  return keep ? { probs, cache: { x0, a1, p1, a2, p2, a3, gap, h } } : probs;
}

export function zeroGrads(params) { return params.map(p => ({ w: new Float32Array(p.w.length), b: new Float32Array(p.b.length) })); }

/** Accumulate cross-entropy gradients for one sample; returns its loss and whether it was classified correctly. */
export function backward(params, grads, patch, label) {
  const { probs, cache } = forward(params, patch, true), { x0, a1, p1, a2, p2, a3, gap, h } = cache;
  const dLogits = Float32Array.from(probs); dLogits[label] -= 1;
  const dh = new Float32Array(32);
  for (let o = 0; o < 6; o++) { grads[4].b[o] += dLogits[o]; for (let i = 0; i < 32; i++) { grads[4].w[o * 32 + i] += dLogits[o] * h[i]; dh[i] += params[4].w[o * 32 + i] * dLogits[o]; } }
  const dgap = new Float32Array(32);
  for (let o = 0; o < 32; o++) { if (h[o] <= 0) continue; grads[3].b[o] += dh[o]; for (let i = 0; i < 32; i++) { grads[3].w[o * 32 + i] += dh[o] * gap[i]; dgap[i] += params[3].w[o * 32 + i] * dh[o]; } }
  const da3 = new Float32Array(32 * 64);
  for (let c = 0; c < 32; c++) for (let i = 0; i < 64; i++) if (a3[c * 64 + i] > 0) da3[c * 64 + i] = dgap[c] / 64;
  const dp2 = convBackward(p2.out, 16, 8, params[2].w, 32, da3, grads[2].w, grads[2].b, true);
  const da2 = new Float32Array(16 * 256); for (let i = 0; i < dp2.length; i++) if (p2.arg[i] >= 0) da2[p2.arg[i]] += dp2[i];
  const dp1 = convBackward(p1.out, 8, 16, params[1].w, 16, da2, grads[1].w, grads[1].b, true);
  const da1 = new Float32Array(8 * 1024); for (let i = 0; i < dp1.length; i++) if (p1.arg[i] >= 0) da1[p1.arg[i]] += dp1[i];
  convBackward(x0, 3, 32, params[0].w, 8, da1, grads[0].w, grads[0].b, false);
  return { loss: -Math.log(Math.max(1e-9, probs[label])), correct: probs.indexOf(Math.max(...probs)) === label };
}

export function createAdam(params, { lr = 2e-3, beta1 = .9, beta2 = .999, eps = 1e-8, weightDecay = 1e-4 } = {}) {
  const m = zeroGrads(params), v = zeroGrads(params); let t = 0;
  return {
    step(grads, scale, rate = lr) {
      t++;
      const c1 = 1 - Math.pow(beta1, t), c2 = 1 - Math.pow(beta2, t);
      params.forEach((p, li) => {
        for (const key of ['w', 'b']) {
          const P = p[key], G = grads[li][key], M = m[li][key], V = v[li][key], decay = key === 'w' ? weightDecay : 0;
          for (let i = 0; i < P.length; i++) {
            const g = G[i] * scale + decay * P[i];
            M[i] = beta1 * M[i] + (1 - beta1) * g; V[i] = beta2 * V[i] + (1 - beta2) * g * g;
            P[i] -= rate * (M[i] / c1) / (Math.sqrt(V[i] / c2) + eps);
          }
        }
      });
    },
  };
}
