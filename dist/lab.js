// FabricNet readout, Zero-waste lab (Azure Functions features), and read-only
// share links. Every server call sends derived masks and settings only.
import { createColorDNA } from './dna.js';
import { SAMPLE_COLLECTIONS } from './sample.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PATTERN_COLORS = { solid: '#9fb48a', textured: '#c9b27c', stripe: '#6f8fb8', check: '#cf6f6a', dot: '#e0b04a', print: '#a78bc9' };
const PATTERN_LABELS = { solid: 'Solid', textured: 'Textured', stripe: 'Stripe', check: 'Check', dot: 'Dots', print: 'Print' };
const PROJECT_COLORS = ['#a6d86f', '#f2b84b', '#6fc1e0', '#ef86a8', '#b9a0f3'];

export function encodeMask(mask) {
  const out = [];
  for (let i = 0; i < mask.length;) { if (!mask[i]) { i++; continue; } const start = i; while (i < mask.length && mask[i]) i++; out.push(start, i - start); }
  return out;
}
const fabricPayload = f => f ? { pattern: f.pattern, confidence: f.confidence, directional: f.directional, grainDeviationDeg: f.grainDeviationDeg ?? null, grainSource: f.grainDeviationDeg === null || f.grainDeviationDeg === undefined ? null : f.grainSource } : undefined;

/** Derived job body shared by cloud saving and every lab route. Never includes pixels. */
export function buildJobBody(state, extra = {}, analysis = state.analysis, excluded = state.excluded) {
  const a = analysis;
  return {
    image: { width: a.width, height: a.height, sceneWidthCm: a.sceneWidthCm },
    scraps: a.scraps.map(s => ({ id: s.id, label: s.label, color: s.color, bbox: s.bbox, usable: s.usable, maskRle: encodeMask(s.mask), ...(s.fabric ? { fabric: fabricPayload(s.fabric) } : {}) })),
    options: { product: state.product, objective: state.objective, seamAllowanceCm: state.seam, size: state.size, rotation: state.rotation, grainAware: state.grainAware !== false, ...(analysis === state.analysis && state.plan?.layoutSearch ? { searchSeed: state.plan.layoutSearch.seed, grid: state.plan.layoutSearch.grid } : {}) },
    excludedScrapIds: [...(excluded || [])],
    analysisProvenance: a.modelProvenance || { engine: 'color-vision' },
    ...extra,
  };
}

export async function api(path, { method = 'GET', body, headers = {}, binary = false, timeout = 32000 } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch('/api/' + path, { method, cache: 'no-store', signal: controller.signal, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (binary && res.ok) return await res.blob();
    const data = await res.json().catch(() => ({ error: { message: 'The cloud service is unavailable here. Run `npm run dev` or open the Azure deployment.' } }));
    if (!res.ok) throw new Error(data.error?.message || data.message || 'The cloud request could not be completed.');
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The cloud request took too long. Please try again.');
    throw e;
  } finally { clearTimeout(timer); }
}

function compass(deg, reliable) {
  if (!reliable) return '<svg class="compass muted-compass" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16"/><path d="M20 8v24M8 20h24" class="axis"/></svg>';
  const off = Math.abs(deg) > 7;
  return `<svg class="compass${off ? ' off' : ''}" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16"/><path d="M20 6v28M6 20h28" class="axis"/><g transform="rotate(${deg} 20 20)"><path d="M20 7v26" class="needle"/><path d="m20 5-3 5h6Z" class="tip"/></g></svg>`;
}

export function initLab({ state, $, modal, toast, compute, studio, updateMetrics, download }) {
  const dna = createColorDNA($('dna-stage'));
  let modelCard = null, results = null, running = false, harmonyPlan = null, revision = 0;
  fetch('./models/fabricnet/fabricnet.json').then(r => r.json()).then(m => { modelCard = m; renderModelCard(); }).catch(() => {});

  // ── FabricNet readout ───────────────────────────────────────────────────
  function cropThumb(scrap, size = 46) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'), b = scrap.bbox, side = Math.min(b.width, b.height) * .55;
    ctx.drawImage(state.photo, b.x + b.width / 2 - side / 2, b.y + b.height / 2 - side / 2, side, side, 0, 0, size, size);
    return c.toDataURL('image/jpeg', .82);
  }
  function renderModelCard() {
    const intel = state.analysis?.fabricIntel;
    const params = modelCard ? modelCard.parameters.toLocaleString() : '7,286';
    const acc = modelCard ? (modelCard.evaluation.syntheticHeldOutAccuracy * 100).toFixed(1) + '%' : '—';
    $('fabricnet-model').innerHTML = `<strong>FabricNet ${esc(modelCard?.version || '1.0.0')}</strong> · ${params} parameters · trained from scratch on synthetic textiles · ${acc} held-out synthetic accuracy${intel ? ` · ran in ${intel.elapsedMs} ms on this device` : ''} <button class="link-button" id="fabricnet-how">How it works ↗</button>`;
    $('fabricnet-how').onclick = showModel;
  }
  function renderFabricNet() {
    const a = state.analysis;
    if (!a) { $('fabricnet-list').innerHTML = '<p class="muted">Analyze a photo to classify each scrap.</p>'; return; }
    const rows = a.scraps.map((s, i) => {
      const f = s.fabric;
      if (!f) return '';
      const probs = f.probabilities ? Object.entries(f.probabilities).map(([k, v]) => `<i style="width:${(v * 100).toFixed(1)}%;background:${PATTERN_COLORS[k]}" title="${PATTERN_LABELS[k]} ${(v * 100).toFixed(0)}%"></i>`).join('') : '';
      const g = f.grain || {}, grain = g.reliable ? `${g.deviationDeg > 0 ? '+' : ''}${g.deviationDeg.toFixed(1)}° <small>${g.source === 'pattern' ? 'pattern' : 'cut edges'}</small>` : '<small>no straight edge</small>';
      return `<button class="fn-row${state.selected === s.id ? ' selected' : ''}" data-fn="${esc(s.id)}"><img src="${cropThumb(s)}" alt=""><span class="fn-name"><strong>${esc(s.label.replace(/ \d+$/, ''))} ${String(i + 1).padStart(2, '0')}</strong><span class="fn-class" style="--c:${PATTERN_COLORS[f.pattern] || '#999'}">${esc(PATTERN_LABELS[f.pattern] || 'Unclassified')} · ${(f.confidence * 100).toFixed(0)}%${f.directional ? ' · rotation locked' : ''}</span><span class="fn-bar">${probs}</span></span><span class="fn-grain">${compass(g.deviationDeg || 0, g.reliable)}<span>${grain}</span></span></button>`;
    }).join('');
    $('fabricnet-list').innerHTML = rows || '<p class="muted">No scraps were large enough to classify.</p>';
    $('fabricnet-list').querySelectorAll('[data-fn]').forEach(b => b.onclick = () => { state.selected = state.selected === b.dataset.fn ? null : b.dataset.fn; updateMetrics(); });
    const locked = state.plan?.stats?.grain?.rotationLockedScraps?.length || 0, off = state.plan?.stats?.grain?.offGrainCuts || 0;
    $('fabricnet-badge').textContent = state.grainAware === false ? 'GRAIN RULES OFF' : `${locked} LOCKED · ${off} OFF-GRAIN`;
    renderModelCard();
  }
  function showModel() {
    if (!modelCard) return toast('FabricNet details are still loading.');
    const m = modelCard, classes = m.classes, conf = m.evaluation.confusion, max = Math.max(...conf.flat());
    const table = `<table class="confusion"><tr><th>true ↓ / predicted →</th>${classes.map(c => `<th>${PATTERN_LABELS[c]}</th>`).join('')}</tr>${conf.map((row, i) => `<tr><th>${PATTERN_LABELS[classes[i]]}</th>${row.map((v, j) => `<td style="background:rgba(${i === j ? '120,170,90' : '200,90,80'},${(v / max * .85).toFixed(2)})">${v}</td>`).join('')}</tr>`).join('')}</table>`;
    const h = m.training.history, w = 300, ht = 90, pts = key => h.map((e, i) => `${(i / (h.length - 1) * w).toFixed(1)},${(ht - (e[key] - .5) / .5 * ht).toFixed(1)}`).join(' ');
    const chart = `<svg class="train-chart" viewBox="-4 -4 ${w + 8} ${ht + 22}" role="img" aria-label="Training and held-out accuracy by epoch"><polyline points="${pts('trainAccuracy')}" class="train"/><polyline points="${pts('validationAccuracy')}" class="val"/><text x="0" y="${ht + 16}">epoch 1</text><text x="${w}" y="${ht + 16}" text-anchor="end">epoch ${h.length}</text></svg><p class="legend-line"><span class="train"></span> training batches <span class="val"></span> held-out synthetic (y: 50–100%)</p>`;
    modal('FabricNet: a CNN we trained ourselves.', `<p><strong>Architecture.</strong> 3 × 32 × 32 patch → conv 3×3 (8) → max-pool → conv 3×3 (16) → max-pool → conv 3×3 (32) → global average pool → dense 32 → softmax over ${classes.length} classes. ${m.parameters.toLocaleString()} parameters, ${m.weights.encoding}, SHA-256 <code>${m.weights.sha256.slice(0, 16)}…</code></p><p><strong>Training.</strong> ${esc(m.training.implementation)} ${m.training.samples.toLocaleString()} freshly synthesized patches over ${m.training.epochs} epochs (${m.training.seconds} s on two CPU cores). ${esc(m.training.data)}</p>${chart}<p><strong>Held-out evaluation.</strong> ${(m.evaluation.syntheticHeldOutAccuracy * 100).toFixed(1)}% on ${m.evaluation.samples.toLocaleString()} new synthetic patches (seed ${m.evaluation.seed}). ${esc(m.evaluation.note)}</p>${table}<p><strong>In the studio.</strong> Up to ten windows per scrap at two scales are classified in the vision worker and averaged. Grain is estimated separately: a projection-profile (Radon) search over the scrap’s pattern for stripes and checks, otherwise the length-weighted orientation of its straight cut edges. Directional stripes lock cut rotation; fabric more than 7° off grain is used last and flagged.</p><p class="small-print">${m.limitations.map(esc).join(' ')}</p>`, 'MODEL CARD · ON-DEVICE INFERENCE');
  }

  // ── Zero-waste lab ──────────────────────────────────────────────────────
  const tiles = { chain: $('lab-chain'), harmony: $('lab-harmony'), impact: $('lab-impact'), optimize: $('lab-optimize'), pool: $('lab-pool'), packet: $('lab-packet') };
  function localImpact() {
    const used = state.plan?.stats?.usedAreaCm2 || 0, grams = used / 10000 * 150, co2 = grams / 1000 * 3.5;
    return { fabricReusedM2: used / 10000, estimatedMassG: grams, avoidedVirginFabric: { kgCo2e: co2 }, local: true };
  }
  function renderImpact(impact = results?.plan?.impact || localImpact()) {
    const chain = results?.chain;
    const chainRow = chain ? `<div class="impact-chain"><span>With the leftover chain (${chain.projects.length} projects)</span><strong>${Math.round(chain.impact.fabricReusedCm2).toLocaleString()} cm² · ${Math.round(chain.impact.estimatedMassG)} g · ${chain.impact.avoidedVirginFabric.kgCo2e.toFixed(2)} kg CO₂e</strong></div>` : '';
    tiles.impact.querySelector('.tile-body').innerHTML = `<div class="impact-grid"><div><strong data-count="${(impact.fabricReusedM2 * 10000).toFixed(0)}">${Math.round(impact.fabricReusedM2 * 10000).toLocaleString()}</strong><span>cm² of offcuts reused</span></div><div><strong>${Math.round(impact.estimatedMassG)}<small>g</small></strong><span>textile kept from landfill</span></div><div><strong>${impact.avoidedVirginFabric.kgCo2e.toFixed(2)}<small>kg</small></strong><span>CO₂e avoided*</span></div></div>${chainRow}<p class="small-print">*${impact.local ? 'Local estimate with the API’s defaults: ' : 'Server estimate: '}150 g/m² cotton and 3.5 kg CO₂e per kg of finished cotton fabric (<a href="https://repositum.tuwien.at/handle/20.500.12708/4130" target="_blank" rel="noopener">Surinder, TU Wien 2015</a>). Assumes the project replaces buying new fabric.</p>`;
  }
  function chainCanvas(chain) {
    const c = document.createElement('canvas'), W = state.photo.width, H = state.photo.height; c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.drawImage(state.photo, 0, 0); ctx.fillStyle = 'rgba(8,18,14,.42)'; ctx.fillRect(0, 0, W, H);
    chain.projects.forEach((p, k) => { const col = PROJECT_COLORS[k % PROJECT_COLORS.length]; for (const piece of p.plan.pieces) { const w = piece.occupiedPixelWidth || piece.width, h = piece.occupiedPixelHeight || piece.height; ctx.fillStyle = col + '99'; ctx.fillRect(piece.x, piece.y, w, h); ctx.strokeStyle = col; ctx.lineWidth = W / 600; ctx.strokeRect(piece.x, piece.y, w, h); } });
    c.className = 'chain-canvas'; c.setAttribute('aria-label', 'Cuts for each chained project over the source photo'); return c;
  }
  function renderChain(chain) {
    const body = tiles.chain.querySelector('.tile-body'); body.innerHTML = '';
    body.append(chainCanvas(chain));
    const s = chain.summary, first = s.firstProjectUtilization * 100, total = s.utilization * 100;
    body.insertAdjacentHTML('beforeend', `<ol class="chain-steps">${chain.projects.map((p, k) => `<li style="--c:${PROJECT_COLORS[k % 5]}"><strong>${esc(p.title)}</strong> · ${Math.round(p.sizeMultiplier * 100)}% · ${p.plan.pieces.length} cuts<small>${esc(p.reason)}</small></li>`).join('')}</ol><div class="dual-meter" role="img" aria-label="Fabric use rises from ${first.toFixed(1)}% to ${total.toFixed(1)}%"><span style="width:${first}%"></span><span style="width:${total - first}%"></span></div><p class="meter-caption"><strong>${first.toFixed(1)}% → ${total.toFixed(1)}%</strong> of usable fabric · ${chain.validation.checkedCuts} cuts cross-validated · ${(s.searchMs / 1000).toFixed(1)} s on Azure</p>`);
  }
  function miniGrid(cells, rows, cols) {
    return `<div class="mini-grid" style="grid-template-columns:repeat(${cols},1fr)">${Array.from({ length: rows * cols }, (_, i) => { const c = cells.get(`${Math.floor(i / cols)}:${i % cols}`); return `<i style="background:${c ? esc(c.color) : 'transparent'}" class="${c?.dupe ? 'dupe' : ''}"></i>`; }).join('')}</div>`;
  }
  function panelCells(entries, panel) {
    const cells = new Map(); entries.filter(e => e.panel === panel).forEach(e => cells.set(`${e.row}:${e.col}`, { color: e.color, scrap: e.scrapId }));
    for (const [key, c] of cells) { const [r, col] = key.split(':').map(Number); for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) if (cells.get(`${r + dr}:${col + dc}`)?.scrap === c.scrap) c.dupe = true; }
    return cells;
  }
  function renderHarmony(plan, arrangement) {
    const forRevision = revision;
    const panels = [...new Set(arrangement.slots.map(s => s.panel))].filter(p => !p.startsWith('handle')).slice(0, 2), b = arrangement.before, a = arrangement.after;
    const pair = panel => {
      const slots = arrangement.slots.filter(s => s.panel === panel), rows = Math.max(...slots.map(s => s.row)) + 1, cols = Math.max(...slots.map(s => s.col)) + 1;
      return `<div class="harmony-pair"><figure>${miniGrid(panelCells(plan.pieces, panel), rows, cols)}<figcaption>${esc(panel)} · planner</figcaption></figure><span class="harmony-arrow">→</span><figure>${miniGrid(panelCells(arrangement.slots, panel), rows, cols)}<figcaption>${esc(panel)} · arranged</figcaption></figure></div>`;
    };
    tiles.harmony.querySelector('.tile-body').innerHTML = `${panels.map(pair).join('')}<dl class="harmony-stats"><div><dt>Same-fabric neighbours</dt><dd>${b.sameScrapAdjacencies} → <strong>${a.sameScrapAdjacencies}</strong></dd></div><div><dt>Mean neighbour ΔE</dt><dd>${b.meanAdjacentDeltaE} → <strong>${a.meanAdjacentDeltaE}</strong></dd></div><div><dt>Swaps</dt><dd><strong>${arrangement.swaps}</strong></dd></div></dl><button class="secondary-button tile-action" id="apply-harmony">Apply to the 3D model ↗</button>`;
    $('apply-harmony').onclick = () => {
      if (forRevision !== revision) return toast('This arrangement belongs to an older plan. Run the lab again.');
      const byId = new Map(state.plan.pieces.map(p => [p.id, p]));
      if (!arrangement.slots.every(s => byId.has(s.cutId))) return toast('This arrangement belongs to an older plan. Run the lab again.');
      const moved = new Map(arrangement.slots.map(s => [s.cutId, s]));
      harmonyPlan = { ...state.plan, arranged: true, pieces: state.plan.pieces.map(p => { const s = moved.get(p.id); return s ? { ...p, panel: s.panel, row: s.row, col: s.col } : p; }) };
      state.plan = harmonyPlan; updateMetrics(); studio.playAssembly();
      toast('Colour-arranged layout applied. Cut positions on the fabric are unchanged.');
    };
  }
  function renderOptimize(r) {
    const forRevision = revision;
    const off = s => s.largestOffcut.areaCm2 ? `${s.largestOffcut.widthCm} × ${s.largestOffcut.heightCm} cm` : 'none';
    const b = r.baseline.score, s = r.score;
    tiles.optimize.querySelector('.tile-body').innerHTML = `<table class="opt-table"><tr><th></th><th>Browser greedy</th><th>Azure deep search</th></tr><tr><td>Cuts placed</td><td>${b.placed}/${b.total}</td><td><strong>${s.placed}/${s.total}</strong></td></tr><tr><td>Largest reusable offcut</td><td>${off(b)}</td><td><strong>${off(s)}</strong></td></tr><tr><td>Scraps left whole</td><td>${b.scrapsUntouched}</td><td><strong>${s.scrapsUntouched}</strong></td></tr></table><p class="meter-caption">${r.search.tries} seeded restarts in ${(r.search.elapsedMs / 1000).toFixed(1)} s · ${r.search.improvements} improvements · ${r.improved ? 'a better validated layout was found' : 'the browser layout was already the best found'}</p>${r.improved ? '<button class="secondary-button tile-action" id="use-optimized">Use the optimized layout ↗</button>' : ''}`;
    if (r.improved) $('use-optimized').onclick = () => { if (forRevision !== revision) return toast('This result belongs to an older plan. Run the lab again.'); state.plan = { ...r.plan, layoutSearch: { seed: r.seed, grid: r.plan.grid }, excludedScrapIds: [...state.excluded] }; invalidatePlan(); updateMetrics(); studio.playAssembly(); toast('Optimized layout applied. Cloud saves and packets reproduce these cuts.'); };
  }
  function renderConcept(concept) {
    tiles.packet.querySelector('.design-map').innerHTML = `<img src="data:image/png;base64,${concept.designMap.base64}" alt="Server-rendered design map of the validated, colour-arranged layout">${concept.render?.generated && concept.render.base64 ? `<img src="data:${concept.render.mimeType || 'image/png'};base64,${concept.render.base64}" alt="AI concept render conditioned on the design map">` : ''}<details><summary>Layout-conditioned prompt</summary><p>${esc(concept.prompt)}</p><small>${esc(concept.render?.reason || concept.disclosure)}</small></details>`;
  }
  function setStatus(text, cls = '') { $('lab-status').textContent = text; $('lab-status').className = 'cloud-status ' + cls; }
  // The API allows two geometry jobs per instance, so routes run two at a time.
  async function pool2(tasks) {
    const out = new Array(tasks.length); let next = 0;
    const worker = async () => { while (next < tasks.length) { const i = next++; try { out[i] = { status: 'fulfilled', value: await tasks[i]() }; } catch (reason) { out[i] = { status: 'rejected', reason }; } } };
    await Promise.all([worker(), worker()]);
    return out;
  }
  async function run({ generate = true } = {}) {
    if (running) return;
    if (!state.analysis || !state.plan) return toast('Analyze a fabric photo first.');
    running = true; $('lab-run').disabled = true; setStatus('RUNNING ON AZURE…', 'busy');
    Object.values(tiles).forEach(t => t.classList.add('loading'));
    const body = buildJobBody(state), started = performance.now(), planAtStart = state.plan, forRevision = revision;
    const runResults = {}; results = runResults;
    const current = () => forRevision === revision;
    const accept = (key, tile, render) => value => { if (current()) { runResults[key] = value; render(value); tile.classList.remove('loading'); } };
    const fail = (tile, e) => { if (!current()) return; tile.classList.remove('loading'); const target = tile === tiles.packet ? tile.querySelector('.design-map') : tile.querySelector('.tile-body'); target.innerHTML = `<p class="tile-error">${esc(e?.message || 'Unavailable')}</p>`; };
    const done = tile => { if (current()) tile.classList.remove('loading'); };
    // Each tile renders as soon as its own route answers.
    const outcomes = await pool2([
      () => api('plan', { method: 'POST', body: { ...body, impact: {} } }).then(accept('plan', tiles.harmony, v => { renderHarmony(planAtStart, v.arrangement); renderImpact(v.impact); done(tiles.impact); }), e => { fail(tiles.harmony, e); if (current()) renderImpact(); done(tiles.impact); throw e; }),
      () => api('chain', { method: 'POST', body: { ...body, chain: { maxProjects: 3, minSize: .5 } } }).then(accept('chain', tiles.chain, v => { renderChain(v); if (runResults.plan) renderImpact(runResults.plan.impact); }), e => { fail(tiles.chain, e); throw e; }),
      () => api('optimize', { method: 'POST', body: { ...body, optimize: { budgetMs: 7000, seed: 1 } } }).then(accept('optimize', tiles.optimize, renderOptimize), e => { fail(tiles.optimize, e); throw e; }),
      () => api('concept', { method: 'POST', body: { ...body, concept: { style: 'studio', generate } }, timeout: 60000 }).then(accept('concept', tiles.packet, renderConcept), e => { fail(tiles.packet, e); throw e; }),
      () => current() ? runPool(false, forRevision, body).finally(() => done(tiles.pool)) : undefined,
    ]);

    const ok = outcomes.slice(0, 3).filter(r => r.status === 'fulfilled').length;
    if (current()) {
      setStatus(ok === 3 ? `VERIFIED ON AZURE · ${((performance.now() - started) / 1000).toFixed(1)} S` : ok ? `PARTIAL RESULTS · ${ok}/3 CHECKS` : 'API UNAVAILABLE HERE', ok === 3 ? 'connected' : 'error');
      if (!ok) toast(outcomes[0].reason?.message || 'The zero-waste lab needs the Azure API.');
    }
    running = false; $('lab-run').disabled = false;
    if (!current()) setTimeout(autoRun, 400);
  }
  $('lab-run').onclick = () => run({ generate: true });
  // Run once automatically (without paid image generation) when the lab scrolls into view.
  let labVisible = false, autoFor = null;
  const autoRun = () => { if (labVisible && state.plan && !results && !running && autoFor !== state.plan) { autoFor = state.plan; run({ generate: false }); } };
  new IntersectionObserver(([entry]) => { labVisible = entry.isIntersecting; autoRun(); }, { threshold: .15 }).observe($('zero-waste-lab'));

  // Community pool: analyze a second photograph locally, then pool on Azure.
  const poolSelect = $('pool-donor');
  function fillDonors() { poolSelect.innerHTML = SAMPLE_COLLECTIONS.filter(s => s.id !== state.variant || !state.sample).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join(''); }
  fillDonors();
  $('pool-run').onclick = () => runPool(true);
  async function runPool(manual = false, forRevision = revision, mine = state.analysis ? buildJobBody(state) : null) {
    if (!state.analysis) return manual && toast('Analyze your own photo first.');
    const meta = SAMPLE_COLLECTIONS.find(s => s.id === poolSelect.value); if (!meta) return;
    const button = $('pool-run'); button.disabled = true; button.textContent = 'Analyzing donor photo…';
    try {
      const image = new Image(); image.src = meta.src; await image.decode();
      const ratio = Math.min(1, 1200 / Math.max(image.width, image.height)), c = document.createElement('canvas'); c.width = Math.round(image.width * ratio); c.height = Math.round(image.height * ratio);
      c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
      const { analysis: donor } = await compute('analyze-extra', { imageData: c.getContext('2d').getImageData(0, 0, c.width, c.height), sceneWidthCm: meta.sceneWidthCm, key: meta.id });
      if (forRevision !== revision) return;
      button.textContent = 'Pooling on Azure…';
      const theirs = buildJobBody(state, {}, donor, []);
      const size = Number($('pool-size').value);
      const result = await api('pool', { method: 'POST', body: { sources: [{ name: 'You', image: mine.image, scraps: mine.scraps, excludedScrapIds: mine.excludedScrapIds, analysisProvenance: mine.analysisProvenance }, { name: meta.name.slice(0, 60), image: theirs.image, scraps: theirs.scraps }], options: { ...mine.options, size }, impact: {} } });
      if (forRevision !== revision) return;
      const share = result.contributions.map((d, k) => `<span style="width:${(d.shareOfProject * 100).toFixed(1)}%;background:${PROJECT_COLORS[k]}" title="${esc(d.name)} ${(d.shareOfProject * 100).toFixed(0)}%"></span>`).join('');
      tiles.pool.querySelector('.pool-result').innerHTML = `<p class="pool-verdict ${result.poolingUnlocks ? 'unlock' : ''}">${result.plan.feasible ? (result.poolingUnlocks ? '✳ Pooling unlocks this project — neither of you could make it alone.' : 'Complete pooled project.') : 'Even pooled, more fabric is needed.'}</p><div class="share-bar">${share}</div><ul class="pool-donors">${result.contributions.map((d, k) => `<li style="--c:${PROJECT_COLORS[k]}"><strong>${esc(d.name)}</strong> ${d.cuts} cuts · ${Math.round(d.usedAreaCm2)} cm² · solo: ${result.solo[k]?.feasible ? 'complete' : `${result.solo[k]?.placed}/${result.solo[k]?.totalPieces}`}</li>`).join('')}</ul><p class="meter-caption">${esc(result.plan.title)} at ${Math.round(size * 100)}% · ${result.plan.pieces.length} cuts from ${result.donors.length} photographs, each with its own calibration.</p>`;
    } catch (e) { if (forRevision !== revision) return; if (manual) toast(e.message); tiles.pool.querySelector('.pool-result').innerHTML = `<p class="tile-error">${esc(e.message)}</p>`; }
    finally { button.disabled = false; button.textContent = 'Pool our scraps ↗'; }
  }

  // Packets and read-only share links.
  async function packet(paper) {
    if (!state.analysis) return toast('Analyze a fabric photo first.');
    try { toast('Writing your maker packet on Azure…'); const blob = await api(`packet?paper=${paper}`, { method: 'POST', body: { ...buildJobBody(state), impact: {} }, binary: true }); download(`rethread-${state.product}-maker-packet-${paper}.pdf`, blob, 'application/pdf'); toast('Maker packet downloaded. Print at 100% and check the 100 mm bar.'); }
    catch (e) { toast(e.message); }
  }
  $('packet-a4').onclick = () => packet('a4'); $('packet-letter').onclick = () => packet('letter');
  $('share-link').onclick = async () => {
    let jobs = []; try { jobs = JSON.parse(localStorage.getItem('rethread-cloud-jobs') || '[]'); } catch { /* storage unavailable */ }
    const job = jobs[0];
    if (!job) return toast('Use “Cloud verify & save” first; then you can share a read-only link.');
    try {
      const r = await api(`jobs/${encodeURIComponent(job.jobId)}/share`, { method: 'POST', headers: { 'X-ReThread-Token': job.accessToken } });
      const url = `${location.origin}${location.pathname}#view=${r.jobId}.${r.shareToken}`;
      try { await navigator.clipboard.writeText(url); toast('Read-only link copied. Viewers can open and print it, never delete it.'); }
      catch { modal('Your read-only link.', `<p>Anyone with this link can view and print the saved plan until ${esc(new Date(r.expiresAt).toLocaleDateString())}. It cannot delete the record.</p><input class="share-input" readonly value="${esc(url)}">`, 'SHARE A SAVED PLAN'); }
    } catch (e) { toast(e.message); }
  };

  // A shared link opens a read-only receipt.
  async function openShared() {
    const match = /^#view=([0-9a-f-]{36})\.([0-9a-f]{64})$/i.exec(location.hash);
    if (!match) return;
    const [, jobId, token] = match;
    try {
      const r = await api(`jobs/${jobId}`, { headers: { 'X-ReThread-Token': token } }), p = r.plan;
      modal('A plan someone shared with you.', `<p><strong>${esc(p.title)}</strong> · ${p.feasible ? 'complete geometric layout' : 'incomplete layout'} · ${p.pieces.length} cuts · ${p.dimensions.widthCm} × ${p.dimensions.heightCm} cm<br>Saved ${esc(new Date(r.createdAt).toLocaleString())} · expires ${esc(new Date(r.expiresAt).toLocaleDateString())} · access: <strong>${esc(r.access)}</strong></p>${r.impact ? `<p>${Math.round(r.impact.fabricReusedCm2).toLocaleString()} cm² of offcuts reused · ≈ ${r.impact.avoidedVirginFabric.kgCo2e} kg CO₂e avoided (stated assumptions).</p>` : ''}<p>The server recomputed this geometry from derived masks; no photograph was stored.</p><button class="primary-button" id="shared-packet">Download the maker packet · PDF</button>`, 'READ-ONLY SHARED RECEIPT');
      $('shared-packet').onclick = async () => { try { const blob = await api(`jobs/${jobId}/packet?paper=a4`, { headers: { 'X-ReThread-Token': token }, binary: true }); download('rethread-shared-maker-packet.pdf', blob, 'application/pdf'); } catch (e) { toast(e.message); } };
    } catch (e) { toast('This shared link could not be opened: ' + e.message); }
  }
  openShared();

  function invalidatePlan() {
      // A new plan invalidates server results computed for the previous one.
      if (harmonyPlan && state.plan === harmonyPlan) return;
      revision++;
      harmonyPlan = null;
      if (results) {
        results = null; setStatus('SETTINGS CHANGED · RUN AGAIN');
        Object.values(tiles).forEach(t => t.classList.remove('loading'));
        // Keep pool inputs and packet/share buttons, including their handlers.
        [tiles.chain, tiles.harmony, tiles.optimize].forEach(t => { t.querySelector('.tile-body').innerHTML = '<p class="muted">Run the lab to compute this for the current plan.</p>'; });
        tiles.pool.querySelector('.pool-result').innerHTML = '';
        tiles.packet.querySelector('.design-map').innerHTML = '<p class="muted">Run the lab to render the current design map.</p>';
        renderImpact();
      }
      fillDonors();
  }
  return {
    onPlan() {
      renderFabricNet(); dna.update(state.analysis, state.photo);
      if (!results) { renderImpact(); setTimeout(autoRun, 400); }
      const caption = state.analysis ? `${state.analysis.scraps.length} scraps · ${state.analysis.metrics.clusters} colour clusters` : '—';
      $('dna-caption').textContent = caption;
    },
    onNewPlan: invalidatePlan,
    buildJobBody: () => buildJobBody(state),
  };
}
