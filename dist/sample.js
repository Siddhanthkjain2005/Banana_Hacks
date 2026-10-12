/** Examples use illustrative scene-width assumptions, never measured photos. */
export const SAMPLE_COLLECTIONS = Object.freeze([
  { id: 'patterns', name: 'Pattern mix', description: 'Navy stripe, red gingham, polka dots, florals, denim and a pinstripe, some lying off grain.', src: '/assets/sample-patterns.png', sceneWidthCm: 90, tag: 'FabricNet showcase', palette: ['#22385e', '#a12c35', '#b9821e', '#2f4b3a'], generated: false, procedural: true },
  { id: 'earth', name: 'Earth & olive', description: 'Linen tones, olive canvas and small denim accents.', src: '/assets/sample-fabric.png', sceneWidthCm: 90, tag: 'Illustrative swatches', palette: ['#75835c', '#c5b79a', '#527281', '#a9674e'], generated: false, procedural: true },
  { id: 'denim-photo', name: 'Denim repair', description: 'Indigo denim, navy twill, teal cotton and warm canvas.', src: '/assets/sample-denim-photo.png', sceneWidthCm: 90, tag: 'AI-generated photo', palette: ['#31556c', '#192c47', '#376363', '#a77e46'], generated: true, procedural: false },
  { id: 'autumn-photo', name: 'Autumn linen', description: 'Rust linen, olive, ochre, burgundy and forest green.', src: '/assets/sample-autumn-photo.png', sceneWidthCm: 90, tag: 'AI-generated photo', palette: ['#b95a2d', '#858550', '#ca901f', '#79473b'], generated: true, procedural: false },
  { id: 'bright-photo', name: 'School-day cotton', description: 'Cobalt, coral, yellow, emerald, plum and bright teal.', src: '/assets/sample-bright-photo.png', sceneWidthCm: 90, tag: 'AI-generated photo', palette: ['#064caa', '#f6524d', '#edb41d', '#007c61'], generated: true, procedural: false },
  { id: 'ocean', name: 'Coastal remnants', description: 'A reversed flat-lay of sea blues, slate and muted sage.', src: '/assets/sample-ocean.png', sceneWidthCm: 90, tag: 'Illustrative swatches', palette: ['#587e88', '#babaa9', '#365566', '#829da1'], generated: false, procedural: true },
  { id: 'mono', name: 'Quiet neutrals', description: 'Tall charcoal and stone remnants with five small tonal patches.', src: '/assets/sample-mono.png', sceneWidthCm: 110, tag: 'Illustrative swatches', palette: ['#737b6f', '#bcb8a9', '#424f49', '#969c8d'], generated: false, procedural: true }
]);

/** Backwards-compatible deterministic canvas helper for procedural examples. */
export function createSampleCanvas(variant = 'earth') {
  const palettes = {
    earth: ['#75835c', '#c5b79a', '#527281', '#a9674e', '#b8a164', '#92948b', '#3c5145'],
    ocean: ['#587e88', '#babaa9', '#365566', '#829da1', '#7b876b', '#4c706c', '#a0aba3'],
    mono: ['#737b6f', '#bcb8a9', '#424f49', '#969c8d', '#b0a891', '#62685e', '#858879']
  };
  const seed = typeof variant === 'number' ? variant : 39;
  const colors = palettes[variant] || palettes.earth;
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 840;
  canvas.defaultSceneWidthCm = variant === 'mono' ? 110 : 90;
  canvas.dataset.sample = 'illustrative';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eceae2'; ctx.fillRect(0, 0, 1200, 840);
  let state = seed;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  let shapes = [
    [[52, 62], [484, 48], [535, 126], [514, 505], [461, 563], [62, 541], [43, 304]],
    [[657, 61], [1119, 43], [1161, 101], [1130, 535], [1032, 567], [654, 539], [637, 336]],
    [[52, 591], [229, 581], [239, 604], [236, 810], [62, 824], [44, 802], [47, 617]],
    [[285, 590], [461, 583], [472, 608], [468, 812], [299, 826], [278, 810], [279, 613]],
    [[523, 584], [699, 590], [704, 615], [697, 815], [523, 823], [511, 807], [513, 603]],
    [[756, 592], [925, 583], [939, 608], [933, 812], [765, 825], [747, 802], [749, 615]],
    [[991, 588], [1162, 583], [1175, 606], [1171, 812], [1004, 824], [982, 806], [983, 614]]
  ];
  if (variant === 'ocean') {
    shapes = shapes.map(points => points.map(([x, y]) => [x, 840 - y]));
  } else if (variant === 'mono') {
    shapes = [
      [[42, 47], [431, 33], [446, 73], [433, 789], [65, 806], [36, 771], [34, 303]],
      [[492, 38], [868, 51], [888, 97], [876, 792], [516, 810], [480, 769], [484, 316]],
      [[947, 34], [1164, 32], [1175, 47], [1169, 169], [952, 175], [941, 160], [943, 50]],
      [[949, 192], [1166, 190], [1177, 205], [1171, 327], [954, 333], [943, 318], [945, 208]],
      [[946, 350], [1163, 348], [1174, 363], [1168, 485], [951, 491], [940, 476], [942, 366]],
      [[950, 508], [1167, 506], [1178, 521], [1172, 643], [955, 649], [944, 634], [946, 524]],
      [[948, 666], [1165, 664], [1176, 679], [1170, 801], [953, 807], [942, 792], [944, 682]]
    ];
  }
  function outline(points) {
    ctx.beginPath(); ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
    ctx.closePath();
  }
  shapes.forEach((points, index) => {
    ctx.save();
    outline(points);
    ctx.shadowColor = 'rgba(39,45,33,.16)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 5;
    ctx.fillStyle = colors[index]; ctx.fill();
    ctx.shadowColor = 'transparent';
    outline(points); ctx.clip();
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    // Warp and weft threads have slight variations in tension and brightness.
    for (let x = x0; x < x1; x += 2) {
      ctx.strokeStyle = x % 6 === 0 ? 'rgba(255,255,244,.19)' : 'rgba(22,29,20,.12)';
      ctx.lineWidth = .65; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + 2, y1); ctx.stroke();
    }
    for (let y = y0; y < y1; y += 3) {
      ctx.strokeStyle = y % 9 === 0 ? 'rgba(242,238,215,.18)' : 'rgba(29,35,26,.10)';
      ctx.lineWidth = .65; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y + 1.2); ctx.stroke();
    }
    if (index === 2) {
      for (let x = x0 - 200; x < x1 + 200; x += 8) {
        ctx.strokeStyle = 'rgba(239,240,229,.13)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + 230, y1); ctx.stroke();
      }
    }
    for (let i = 0; i < (x1 - x0) * (y1 - y0) / 18; i++) {
      ctx.fillStyle = random() > .5 ? 'rgba(255,255,246,.11)' : 'rgba(19,24,16,.09)';
      ctx.fillRect(x0 + random() * (x1 - x0), y0 + random() * (y1 - y0), .8 + random(), .6 + random() * 1.6);
    }
    // Soft folds read as real cloth without obscuring its cutting boundary.
    const fold = ctx.createLinearGradient(x0, y0, x1, y1);
    fold.addColorStop(0, 'rgba(255,255,255,.04)');
    fold.addColorStop(.42, 'rgba(255,255,244,.07)');
    fold.addColorStop(.49, 'rgba(16,26,16,.06)');
    fold.addColorStop(.57, 'rgba(255,255,244,.05)');
    fold.addColorStop(1, 'rgba(0,0,0,.02)');
    ctx.fillStyle = fold; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
    ctx.save(); outline(points); ctx.strokeStyle = 'rgba(28,36,25,.20)'; ctx.lineWidth = .8; ctx.stroke();
    // A few clipped yarn ends on the outside make the silhouette tactile.
    for (let k = 0; k < points.length; k++) {
      const a = points[k], b = points[(k + 1) % points.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 11; d < len; d += 9 + random() * 10) {
        const t = d / len, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        ctx.strokeStyle = colors[index]; ctx.lineWidth = .6;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (random() - .5) * 6, y + (random() - .5) * 6); ctx.stroke();
      }
    }
    ctx.restore();
  });
  return canvas;
}
