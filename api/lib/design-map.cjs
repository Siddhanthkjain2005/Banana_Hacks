'use strict';

const { hexToRgb, colorFamily } = require('./color.cjs');
const { encodePNG } = require('./png.cjs');

const BACKGROUND = [244, 241, 234];
const MISSING = [190, 188, 182];
const PRODUCT_NOUNS = { tote: 'patchwork tote bag', pouch: 'zipped patchwork pouch', cushion: 'patchwork envelope cushion cover' };
const STYLES = {
  studio: 'studio product photograph on a plain warm-grey backdrop, soft diffuse light, three-quarter view',
  lifestyle: 'lifestyle photograph in a bright community repair-café workshop, natural window light',
  flatlay: 'top-down flat-lay photograph on a light wooden worktable, a few sewing tools at the edges',
  sketch: 'clean fashion technical illustration with ink linework and soft watercolour fills',
};
const ORDINALS = ['top', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

/** Deterministic per-pixel hash for a subtle woven texture that reads as cloth to image models. */
const grain = (x, y) => {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) & 255) / 255 - .5;
};

/** Every grid slot of the product, placed or not, with the cut colour assigned to it. */
function productSlots(plan, arrangement) {
  const assigned = new Map((arrangement?.slots || plan.pieces.map(p => ({ slotId: p.id, color: p.color, scrapId: p.scrapId }))).map(s => [s.slotId, s]));
  return [...plan.pieces, ...(plan.unplaced || [])].map(p => ({ id: p.id, panel: p.panel, row: p.row, col: p.col, rows: p.rows, cols: p.cols,
    color: assigned.get(p.id)?.color || null, scrapId: assigned.get(p.id)?.scrapId || null }));
}

/** Lay panels side by side and handle strips beneath them, in centimetres. */
function layoutPanels(plan) {
  const gap = Math.max(plan.dimensions.widthCm * .12, 2), boxes = [];
  let x = 0;
  for (const panel of plan.panels) {
    boxes.push({ id: panel.id, x, y: 0, w: panel.widthCm, h: panel.heightCm });
    x += panel.widthCm + gap;
  }
  const panelsWidth = x - gap, panelsHeight = Math.max(...boxes.map(b => b.h));
  if (plan.product === 'tote') {
    const d = plan.dimensions, strap = d.handleWidthCm * 1.6;
    ['handle-left', 'handle-right'].forEach((id, i) => boxes.push({ id, x: 0, y: panelsHeight + gap + i * (strap + gap * .6), w: Math.min(d.handleLengthCm, panelsWidth), h: strap, strip: true }));
  }
  return { boxes, width: Math.max(panelsWidth, ...boxes.map(b => b.x + b.w)), height: Math.max(...boxes.map(b => b.y + b.h)) };
}

/**
 * Rasterize the validated plan into a flat "design map": each patch slot is
 * filled with the measured colour of the scrap cut for it, with seams drawn
 * where the plan joins patches. It is the reference image for concept renders.
 */
function renderDesignMap(plan, arrangement, size = 1024) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let p = 0; p < size * size; p++) data.set([...BACKGROUND, 255], p * 4);
  const layout = layoutPanels(plan), margin = size * .08;
  const scale = Math.min((size - 2 * margin) / layout.width, (size - 2 * margin) / layout.height);
  const offsetX = (size - layout.width * scale) / 2, offsetY = (size - layout.height * scale) / 2;
  const seam = Math.max(2, Math.round(size / 340));
  const fill = (x0, y0, x1, y1, rgb, textured, hatch) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(size, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(size, Math.ceil(x1)); x++) {
      const weave = textured ? grain(x, y) * 14 + ((x + y) % 4 < 2 ? 3 : -3) : 0;
      const stripe = hatch && (x + y) % 14 < 3 ? -40 : 0;
      data.set([rgb[0] + weave + stripe, rgb[1] + weave + stripe, rgb[2] + weave + stripe, 255], (y * size + x) * 4);
    }
  };
  const slots = productSlots(plan, arrangement);
  for (const box of layout.boxes) {
    const bx = offsetX + box.x * scale, by = offsetY + box.y * scale, bw = box.w * scale, bh = box.h * scale;
    fill(bx - seam, by - seam, bx + bw + seam, by + bh + seam, [70, 66, 60], false, false);
    for (const slot of slots.filter(s => s.panel === box.id)) {
      // Handle segments run along the strip; panel patches follow the row/column grid.
      const [sx, sy, sw, sh] = box.strip ? [bx + slot.row * bw / slot.rows, by, bw / slot.rows, bh] : [bx + slot.col * bw / slot.cols, by + slot.row * bh / slot.rows, bw / slot.cols, bh / slot.rows];
      const rgb = slot.color ? hexToRgb(slot.color) : MISSING;
      fill(sx + seam / 2, sy + seam / 2, sx + sw - seam / 2, sy + sh - seam / 2, rgb, Boolean(slot.color), !slot.color);
    }
  }
  return { png: encodePNG({ width: size, height: size, data }), width: size, height: size };
}

/** Engineered prompt built only from measured colours and the validated plan. */
function conceptPrompt(plan, arrangement, style = 'studio') {
  const slots = productSlots(plan, arrangement), used = new Map();
  slots.forEach(s => { if (s.color) used.set(s.color, (used.get(s.color) || 0) + 1); });
  const palette = [...used.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => `${colorFamily(hex)} (${hex})`);
  const front = slots.filter(s => s.panel === 'front').sort((a, b) => a.row - b.row || a.col - b.col);
  const rows = [...new Set(front.map(s => s.row))].map(row => `${ORDINALS[row] || `row ${row + 1}`} row: ${front.filter(s => s.row === row).map(s => s.color ? colorFamily(s.color) : 'missing patch').join(', ')}`);
  const d = plan.dimensions, grid = `${plan.grid.cols} × ${plan.grid.rows}`;
  const extras = plan.product === 'tote' ? 'Two shoulder handles are pieced from short fabric segments, as in the strips below the panels.'
    : plan.product === 'pouch' ? 'A metal zipper runs along the top edge.' : 'The back is an overlapping envelope closure made of two flaps.';
  return [
    `A ${STYLES[style]} of a handmade ${PRODUCT_NOUNS[plan.product]} sewn from upcycled cotton fabric offcuts.`,
    `The reference image is the product's validated cutting layout: follow its patch grid, seam positions, and patch colours exactly.`,
    `Each panel is a ${grid} grid of rectangular patches joined with straight, visible seams. Front panel, ${rows.join('; ')}.`,
    `Use only this measured fabric palette: ${palette.join(', ')}. Finished size about ${Math.round(d.widthCm)} × ${Math.round(d.heightCm)} cm.`,
    `${extras} Visible woven cotton texture, neat topstitching, realistic proportions. No prints, logos, text, labels, or extra colours.`,
  ].join(' ');
}

module.exports = { renderDesignMap, conceptPrompt, productSlots, STYLES };
