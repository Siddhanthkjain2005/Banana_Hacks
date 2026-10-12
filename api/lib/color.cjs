'use strict';

/** sRGB hex to CIELAB (D65), matching the conversion used by the shared vision engine. */
function hexToLab(hex) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const linear = v => { v /= 255; return v > .04045 ? ((v + .055) / 1.055) ** 2.4 : v / 12.92; };
  const [r, g, b] = rgb.map(linear);
  const f = v => v > .008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  const x = f((.4124564 * r + .3575761 * g + .1804375 * b) / .95047);
  const y = f(.2126729 * r + .7151522 * g + .0721750 * b);
  const z = f((.0193339 * r + .1191920 * g + .9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIE76 colour difference, consistent with the engine's Euclidean CIELAB clustering. */
const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

/** A plain-language colour family for prompts, derived from CIELAB lightness, chroma, and hue. */
function colorFamily(hex) {
  const [L, a, b] = hexToLab(hex), C = Math.hypot(a, b), h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  if (C < 8) return L > 85 ? 'ivory' : L > 62 ? 'light grey' : L > 38 ? 'stone grey' : 'charcoal';
  const light = L > 68, dark = L < 30, muted = C < 25;
  let name;
  if (h < 25 || h >= 345) name = light ? 'dusty pink' : L < 40 ? 'burgundy' : muted ? 'dusty rose' : 'red';
  else if (h < 55) name = light ? 'peach' : C > 50 ? (L < 55 ? 'rust' : 'coral') : L < 40 ? 'brown' : 'terracotta';
  else if (h < 85) name = C < 20 ? (L > 65 ? 'oat' : 'khaki') : C > 45 ? (L > 70 ? 'golden yellow' : 'ochre') : L > 45 ? 'tan' : 'brown';
  else if (h < 110) name = C < 20 ? (L > 65 ? 'oat' : 'khaki') : L < 60 ? 'olive' : C > 50 ? 'mustard yellow' : 'mustard';
  else if (h < 145) name = L < 60 ? (muted ? 'sage green' : 'olive green') : C > 50 ? 'lime green' : 'sage green';
  else if (h < 185) name = muted ? 'sage green' : C > 35 ? 'emerald green' : 'green';
  else if (h < 225) name = muted ? 'slate teal' : 'teal';
  else if (h < 300) name = dark ? 'navy' : muted ? 'denim blue' : C > 45 && h >= 265 ? 'cobalt blue' : 'blue';
  else name = light ? 'lilac' : C > 45 ? 'purple' : 'plum';
  if (dark && !['navy', 'burgundy', 'brown'].includes(name)) return `deep ${name}`;
  return light && muted && !/oat|pink|peach|lilac/.test(name) ? `pale ${name}` : name;
}

module.exports = { hexToLab, hexToRgb, deltaE, colorFamily };
