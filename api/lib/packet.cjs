'use strict';

const { PdfDocument } = require('./pdf.cjs');
const { productSlots } = require('./design-map.cjs');
const { hexToRgb } = require('./color.cjs');

const INK = '#161b18', MUTED = '#5c625d', RULE = '#c9c6bd', ACCENT = '#57765b', WARN = '#a33a2a';
const M = 15;
const fixed = (x, n = 1) => Number(x).toFixed(n);
const tint = (hex, amount = .28) => hexToRgb(hex).map(c => Math.round(255 - (255 - c) * amount));

/** Page frame with a running header and page footer. */
function framedPage(doc, heading, meta) {
  const page = doc.addPage();
  page.text(M, M, 'ReThread maker packet', { size: 8, color: MUTED });
  page.text(page.width - M, M, meta.planTitle, { size: 8, color: MUTED, align: 'right' });
  page.line(M, M + 2.5, page.width - M, M + 2.5, { stroke: RULE, lineWidth: .25 });
  page.text(M, M + 13, heading, { size: 16, bold: true });
  page.text(M, page.height - 9, meta.footer, { size: 7, color: MUTED });
  page.text(page.width - M, page.height - 9, `Page ${doc.pages.length}`, { size: 7, color: MUTED, align: 'right' });
  return page;
}

function coverPage(doc, input, meta) {
  const { plan, analytics, impact } = input, page = framedPage(doc, plan.title, meta), right = page.width - M;
  let y = M + 22;
  page.rect(M, y, right - M, 11, { fill: plan.feasible ? '#e7efe6' : '#f6e3df' });
  page.text(M + 4, y + 7.3, plan.feasible ? 'COMPLETE, GEOMETRICALLY VALIDATED LAYOUT' : 'INCOMPLETE LAYOUT: PARTIAL CUTS ONLY. DO NOT CUT AS A COMPLETE PRODUCT.', { size: 10, bold: true, color: plan.feasible ? ACCENT : WARN });
  y += 20;
  const d = plan.dimensions, s = plan.stats;
  const facts = [
    ['Finished size', `${fixed(d.widthCm)} × ${fixed(d.heightCm)} cm${d.handleLengthCm ? ` · handles ${fixed(d.handleLengthCm)} cm` : ''}`],
    ['Seam allowance', `${plan.seamAllowanceCm} cm, already included in every cut`],
    ['Patch grid', `${plan.grid.cols} columns × ${plan.grid.rows} rows per panel`],
    ['Cuts', `${s.placed} placed of ${s.totalPieces} required, from ${s.scrapsUsed} scraps`],
    ['Fabric', `${fixed(s.usedAreaCm2, 0)} cm² cut from ${fixed(s.availableAreaCm2, 0)} cm² usable (${fixed(s.utilization * 100)}%)`],
    ...(analytics ? [['Sewing', `${analytics.seams.patchworkSeams} patchwork joins (${fixed(analytics.seams.patchworkSeamCm, 0)} cm) + about ${fixed(analytics.seams.assemblySeamCm, 0)} cm assembly seams`]] : []),
    ...(analytics?.leftovers?.largestRectangleCm ? [['Largest leftover', `${fixed(analytics.leftovers.largestRectangleCm.width)} × ${fixed(analytics.leftovers.largestRectangleCm.height)} cm rectangle remains for another project`]] : []),
  ];
  facts.forEach(([label, value]) => { page.text(M, y, label, { size: 9, bold: true }); y = page.paragraph(M + 38, y, value, right - M - 38, { size: 9 }) + 1.5; });
  if (impact) {
    y += 4;
    page.rect(M, y, right - M, 27, { fill: '#f1efe8' });
    page.text(M + 4, y + 7, 'Material impact estimate', { size: 10, bold: true });
    page.text(M + 4, y + 13.5, `${fixed(impact.fabricReusedCm2, 0)} cm² of offcuts reused · about ${fixed(impact.estimatedMassG, 0)} g at ${impact.assumptions.fabricGsm} g/m²`, { size: 9 });
    page.text(M + 4, y + 19, `About ${fixed(impact.avoidedVirginFabric.kgCo2e, 2)} kg CO2e of new-fabric production avoided at ${impact.assumptions.kgCo2ePerKg} kg CO2e/kg (assumption).`, { size: 9 });
    page.text(M + 4, y + 24, 'Estimate only: it assumes the project replaces buying new cotton fabric.', { size: 7, color: MUTED });
    y += 33;
  }
  y += 4;
  page.text(M, y, 'Supplies', { size: 10, bold: true }); y += 5.5;
  plan.supplies.forEach(item => { page.text(M + 2, y, `• ${item}`, { size: 9 }); y += 5; });
  // Calibration: 100 mm at 100% print scale.
  const barY = page.height - 52;
  page.text(M, barY - 8, 'Print check', { size: 10, bold: true });
  page.text(M, barY - 3, 'Print at 100% (“Actual size”). This bar must measure exactly 10 cm.', { size: 8, color: MUTED });
  page.line(M, barY + 4, M + 100, barY + 4, { lineWidth: .5 });
  for (let i = 0; i <= 10; i++) page.line(M + i * 10, barY + (i % 5 ? 2 : 1), M + i * 10, barY + 4, { lineWidth: .3 });
  page.text(M + 50, barY + 9, '10 cm', { size: 8, align: 'center' });
  page.rect(right - 30, barY - 6, 30, 30, { stroke: INK, lineWidth: .3 });
  page.text(right - 15, barY + 10, '3 × 3 cm', { size: 7, align: 'center', color: MUTED });
  return page;
}

function cutListPages(doc, input, meta, numbers) {
  const { plan, scrapsById, cutToSlot } = input;
  const columns = [['#', 0], ['Cut', 7], ['Scrap', 38], ['Cut size (cm)', 84], ['Rot.', 108], ['From scrap edge x, y (cm)', 118], ['Sew into', 155]];
  let page, y;
  const startPage = () => {
    page = framedPage(doc, 'Cut list', meta); y = M + 22;
    page.paragraph(M, y, 'Positions are measured from the leftmost and topmost edges of each scrap as photographed, at the calibrated scale. Every size already includes the seam allowance.', page.width - 2 * M, { size: 8, color: MUTED });
    y += 12;
    columns.forEach(([label, x]) => page.text(M + x, y, label, { size: 7.5, bold: true }));
    page.line(M, y + 2, page.width - M, y + 2, { stroke: RULE, lineWidth: .3 }); y += 7;
  };
  startPage();
  plan.pieces.forEach(p => {
    if (y > page.height - 20) startPage();
    const scrap = scrapsById.get(p.scrapId), ppcm = p.pixelsPerCm;
    const ox = scrap ? (p.x - scrap.bbox.x) / ppcm : 0, oy = scrap ? (p.y - scrap.bbox.y) / ppcm : 0;
    page.text(M, y, String(numbers.get(p.id)), { size: 8, bold: true });
    page.text(M + 7, y, p.id, { size: 7.5 });
    page.rect(M + 38, y - 3, 3.2, 3.2, { fill: p.color, stroke: RULE, lineWidth: .15 });
    page.text(M + 43, y, (scrap?.label || p.scrapId).slice(0, 26), { size: 7.5 });
    page.text(M + 84, y, `${fixed(p.widthCm)} × ${fixed(p.heightCm)}`, { size: 7.5 });
    page.text(M + 108, y, p.rotated ? 'yes' : '', { size: 7.5 });
    page.text(M + 118, y, `${fixed(ox)}, ${fixed(oy)}`, { size: 7.5 });
    page.text(M + 155, y, cutToSlot.get(p.id) || p.id, { size: 7.5 });
    page.line(M, y + 2, page.width - M, y + 2, { stroke: '#ebe8e0', lineWidth: .15 });
    y += 6.2;
  });
}

/** Scrap silhouette from the decoded mask, downsampled into filled cell runs. */
function drawSilhouette(page, scrap, x0, y0, scale, fill) {
  const { width: w, height: h } = scrap.bbox, cell = Math.max(1, Math.ceil(Math.max(w, h) / 110)), columns = Math.ceil(w / cell);
  // Runs overlap their neighbours slightly so viewers do not show hairline gaps between rows.
  const draw = (cy, from, to) => page.rect(x0 + from * scale, y0 + cy * scale, (to - from) * scale + .15, Math.min(cell, h - cy) * scale + .15, { fill });
  for (let cy = 0; cy < h; cy += cell) {
    let run = -1;
    for (let column = 0; column <= columns; column++) {
      const cx = column * cell;
      let on = false;
      if (column < columns) {
        let count = 0, total = 0;
        for (let y = cy; y < Math.min(h, cy + cell); y++) for (let x = cx; x < Math.min(w, cx + cell); x++) { total++; count += scrap.mask[y * w + x]; }
        on = count * 2 > total;
      }
      if (on && run < 0) run = cx;
      if (!on && run >= 0) { draw(cy, run, Math.min(w, cx)); run = -1; }
    }
  }
}

function scrapPages(doc, input, meta, numbers) {
  const { plan, scraps } = input;
  const used = scraps.filter(s => plan.pieces.some(p => p.scrapId === s.id));
  for (let i = 0; i < used.length; i += 2) {
    const page = framedPage(doc, 'Cutting diagrams', meta), boxW = page.width - 2 * M, boxH = (page.height - M - 30 - 18) / 2;
    used.slice(i, i + 2).forEach((scrap, k) => {
      const top = M + 22 + k * (boxH + 6), ppcm = scrap.pixelsPerCm, cuts = plan.pieces.filter(p => p.scrapId === scrap.id);
      page.rect(M - 2, top - 5, 4, 4, { fill: scrap.color });
      page.text(M + 4, top - 1.5, `${scrap.label} · ${cuts.length} cuts · bounding box ${fixed(scrap.bbox.width / ppcm)} × ${fixed(scrap.bbox.height / ppcm)} cm`, { size: 9, bold: true });
      const scale = Math.min((boxW - 4) / scrap.bbox.width, (boxH - 18) / scrap.bbox.height), x0 = M, y0 = top + 3;
      if (scrap.mask) drawSilhouette(page, scrap, x0, y0, scale, tint(scrap.color));
      else page.rect(x0, y0, scrap.bbox.width * scale, scrap.bbox.height * scale, { fill: tint(scrap.color), stroke: RULE, dash: [1.2, 1], lineWidth: .25 });
      cuts.forEach(p => {
        const rx = x0 + (p.x - scrap.bbox.x) * scale, ry = y0 + (p.y - scrap.bbox.y) * scale, rw = p.width * scale, rh = p.height * scale;
        page.rect(rx, ry, rw, rh, { stroke: INK, lineWidth: .35 });
        const seam = plan.seamAllowanceCm * ppcm * scale;
        if (rw > 2 * seam && rh > 2 * seam) page.rect(rx + seam, ry + seam, rw - 2 * seam, rh - 2 * seam, { stroke: ACCENT, lineWidth: .2, dash: [1, .8] });
        page.text(rx + rw / 2, ry + rh / 2 + 1.2, String(numbers.get(p.id)), { size: Math.max(5, Math.min(9, rh * 1.4)), bold: true, align: 'center' });
      });
      const barCm = [1, 2, 5, 10, 20, 50].find(cm => cm * ppcm * scale >= 15) || 50, barY = y0 + scrap.bbox.height * scale + 5;
      page.line(x0, barY, x0 + barCm * ppcm * scale, barY, { lineWidth: .4 });
      page.text(x0 + barCm * ppcm * scale + 2, barY + 1, `${barCm} cm at this drawing’s scale (1:${fixed(10 / (ppcm * scale), 1)})${scrap.mask ? '' : ' · outline shown as bounding box'}`, { size: 7, color: MUTED });
    });
  }
}

function assemblyPage(doc, input, meta, numbers) {
  const { plan, arrangement } = input, page = framedPage(doc, 'Sewing layout', meta);
  const slots = productSlots(plan, arrangement), byCut = new Map(arrangement?.slots.map(s => [s.slotId, s.cutId]) || []);
  let y = M + 22;
  page.paragraph(M, y, arrangement ? `Numbers show which cut sews into each position. Interchangeable cuts were arranged for colour contrast: mean neighbouring ΔE ${arrangement.before.meanAdjacentDeltaE ?? '-'} → ${arrangement.after.meanAdjacentDeltaE ?? '-'}, same-scrap neighbours ${arrangement.before.sameScrapAdjacencies} → ${arrangement.after.sameScrapAdjacencies}.` : 'Numbers show which cut sews into each position.', page.width - 2 * M, { size: 8, color: MUTED });
  y += 12;
  const panels = [...new Set(slots.map(s => s.panel))], area = page.width - 2 * M;
  const columns = Math.min(2, panels.length), gridW = (area - (columns - 1) * 8) / columns;
  // Panels keep their finished aspect ratio; handle strips are drawn as short bands.
  const heightOf = panel => {
    const definition = plan.panels.find(p => p.id === panel);
    return definition ? Math.min(gridW * definition.heightCm / definition.widthCm, 95) : 14;
  };
  const rowTops = [];
  panels.forEach((panel, i) => {
    const row = Math.floor(i / columns);
    rowTops[row + 1] = Math.max(rowTops[row + 1] || 0, (rowTops[row] ?? y) + heightOf(panel) + 18);
    rowTops[row] ??= y;
  });
  panels.forEach((panel, i) => {
    const panelSlots = slots.filter(s => s.panel === panel), rows = panelSlots[0].rows, cols = panelSlots[0].cols, strip = panel.startsWith('handle');
    const gridH = heightOf(panel), x0 = M + (i % columns) * (gridW + 8), y0 = rowTops[Math.floor(i / columns)];
    page.text(x0, y0, panel.replace('-', ' '), { size: 9, bold: true });
    panelSlots.forEach(slot => {
      const [sx, sy, sw, sh] = strip ? [x0 + slot.row * gridW / rows, y0 + 3, gridW / rows, gridH] : [x0 + slot.col * gridW / cols, y0 + 3 + slot.row * gridH / rows, gridW / cols, gridH / rows];
      page.rect(sx, sy, sw, sh, { fill: slot.color ? tint(slot.color, .55) : '#dddad2', stroke: INK, lineWidth: .3 });
      const cut = byCut.get(slot.id) || (slot.color ? slot.id : null);
      page.text(sx + sw / 2, sy + sh / 2 + 1.3, cut ? String(numbers.get(cut) ?? '') : 'missing', { size: 8, bold: Boolean(cut), align: 'center', color: cut ? INK : WARN });
    });
  });
}

function stepsPage(doc, input, meta) {
  const { plan } = input, page = framedPage(doc, 'Assembly steps', meta), width = page.width - 2 * M;
  let y = M + 24;
  plan.assembly.forEach((step, i) => { page.text(M, y, `${i + 1}.`, { size: 9.5, bold: true }); y = page.paragraph(M + 7, y, step, width - 7, { size: 9.5 }) + 3; });
  if (plan.warnings.length) {
    y += 4; page.text(M, y, 'Warnings', { size: 10, bold: true, color: WARN }); y += 6;
    plan.warnings.forEach(w => { y = page.paragraph(M, y, `• ${w}`, width, { size: 8.5 }) + 1.5; });
  }
  y += 4; page.text(M, y, 'Limitations', { size: 10, bold: true }); y += 6;
  ['Dimensions come from a flat, top-down photograph and the entered scene width. Check the printed scale and measure the fabric before cutting.',
    'Fabric type, grain, stretch, strength, and hidden holes are not verified by the image.',
    'The nesting heuristic finds validated layouts, not provably optimal ones.',
    ...(meta.provenance ? [meta.provenance] : [])].forEach(text => { y = page.paragraph(M, y, `• ${text}`, width, { size: 8.5, color: MUTED }) + 1.5; });
}

/**
 * Printable workshop packet: summary and calibration bar, cut list with
 * positions, per-scrap cutting diagrams, sewing layout, and assembly steps.
 */
function buildPacket({ plan, scraps, arrangement, analytics, impact, paper = 'a4', meta = {} }) {
  const doc = new PdfDocument({ paper, title: `${plan.title} — ReThread maker packet` });
  const numbers = new Map(plan.pieces.map((p, i) => [p.id, i + 1]));
  const cutToSlot = new Map(arrangement?.slots.map(s => [s.cutId, s.slotId]) || []);
  const input = { plan, scraps, scrapsById: new Map(scraps.map(s => [s.id, s])), arrangement, analytics, impact, cutToSlot };
  const footer = [meta.jobId ? `Saved plan ${meta.jobId}` : 'Unsaved plan', meta.inputDigest ? `input ${meta.inputDigest.slice(0, 12)}…` : null, `generated ${meta.generatedAt || new Date().toISOString().slice(0, 10)}`, 'source photographs are never uploaded'].filter(Boolean).join(' · ');
  const pageMeta = { planTitle: plan.title, footer, provenance: meta.provenance };
  coverPage(doc, input, pageMeta);
  if (plan.pieces.length) {
    cutListPages(doc, input, pageMeta, numbers);
    scrapPages(doc, input, pageMeta, numbers);
    assemblyPage(doc, input, pageMeta, numbers);
  }
  stepsPage(doc, input, pageMeta);
  return { pdf: doc.toBuffer(), pages: doc.pages.length };
}

module.exports = { buildPacket };
