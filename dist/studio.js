import * as THREE from './vendor/three.module.js';

const DEFAULT_COLORS = ['#c9bea1', '#72825d', '#a96c53', '#466c78', '#8f9878', '#c1ad76', '#40554a'];
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const validColor = (value, fallback) => typeof value === 'string' && /^(#[0-9a-f]{3,8}|rgb\(|hsl\()/i.test(value) ? value : fallback;

function fabricTexture(color, seed = 1) {
  const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 384;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 384, 384);
  let n = seed;
  const random = () => { n = (n * 1664525 + 1013904223) >>> 0; return n / 4294967296; };
  for (let i = 0; i < 384; i += 2) {
    ctx.strokeStyle = i % 6 === 0 ? 'rgba(255,255,229,.2)' : 'rgba(20,28,14,.15)';
    ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + .6, 384); ctx.stroke();
    ctx.strokeStyle = i % 8 === 0 ? 'rgba(255,255,238,.15)' : 'rgba(15,25,18,.12)';
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(384, i + .5); ctx.stroke();
  }
  for (let i = 0; i < 22000; i++) {
    ctx.fillStyle = random() > .5 ? 'rgba(255,255,243,.10)' : 'rgba(10,20,12,.08)';
    ctx.fillRect(random() * 384, random() * 384, .7 + random(), .4 + random() * 1.8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.6, 1.8);
  return texture;
}

function weaveTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#888'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 4) {
    ctx.fillStyle = '#b5b5b5'; ctx.fillRect(i, 0, 1, 256); ctx.fillRect(0, i, 256, 1);
    ctx.fillStyle = '#686868'; ctx.fillRect(i + 2, 0, 1, 256); ctx.fillRect(0, i + 2, 256, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(6, 6);
  return texture;
}

function patchGeometry(x0, x1, y0, y1, surface, nx = 16, ny = 16) {
  const positions = [], uv = [], indices = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const u = x0 + (x1 - x0) * i / nx, v = y0 + (y1 - y0) * j / ny;
    const p = surface(u, v); positions.push(p.x, p.y, p.z); uv.push(i / nx, j / ny);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    indices.push(a, b, d, a, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function stitchPath(points, material, every = 2) {
  const positions = [];
  for (let i = 0; i < points.length - 1; i += every) {
    const a = points[i], b = points[i + 1]; positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, material);
}

function seam(points, material, radius = .008) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(20, points.length * 2), radius, 4, false), material);
}

function handleGeometry(z, width = .14, start = 0, end = 1) {
  const positions = [], uvs = [], indices = [], segments = Math.max(12, Math.ceil(60 * (end - start)));
  function center(t) { return new THREE.Vector3(-.65 + 1.3 * t, 1.03 + .99 * Math.pow(Math.sin(Math.PI * t), .72), z + .03 * Math.sin(Math.PI * t)); }
  for (let i = 0; i <= segments; i++) {
    const t = start + (end - start) * i / segments, c = center(t), before = center(Math.max(0, t - .002)), after = center(Math.min(1, t + .002));
    const tangent = after.sub(before).normalize(), normal = new THREE.Vector3(-tangent.y, tangent.x, 0);
    for (let k = 0; k < 4; k++) {
      const sign = k === 0 || k === 3 ? -1 : 1, depth = k < 2 ? .018 : -.018;
      const p = c.clone().addScaledVector(normal, width * .5 * sign); p.z += depth;
      positions.push(p.x, p.y, p.z); uvs.push(k % 2, t * 3);
    }
  }
  for (let i = 0; i < segments; i++) for (let k = 0; k < 4; k++) {
    const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = a + 4, d = b + 4;
    indices.push(a, b, d, a, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return { geometry, center };
}

function fallback(container, onReady) {
  const node = document.createElement('div');
  node.style.cssText = 'display:grid;place-items:center;min-height:380px;padding:40px;color:#dce4d1;text-align:center;font-family:inherit;';
  node.innerHTML = '<div><svg width="170" height="210" viewBox="0 0 170 210" aria-hidden="true"><path d="M47 64C47 0 123 0 123 64" fill="none" stroke="#cfc1a2" stroke-width="12"/><path d="M20 62L150 62L145 197Q85 210 25 197Z" fill="#7f8e65"/><path d="M20 62H88V135H23Z" fill="#c5b599"/><path d="M88 135H147L145 197H88Z" fill="#aa7259"/><path d="M88 62V199M22 135H148" stroke="#e4d9bc" stroke-width="2" stroke-dasharray="4 4"/></svg><p style="margin:18px 0 6px;font-size:17px">Your patchwork, reimagined.</p><p style="margin:0;font-size:12px;opacity:.65">3D preview needs a browser with WebGL enabled.</p></div>';
  container.appendChild(node); onReady?.({ supported: false });
  return { update() {}, playAssembly: () => false, assembling: false, setExploded() {}, setWireframe() {}, setPhoto() {}, resetView() {}, capture: () => null, dispose: () => node.remove() };
}

export function createStudio(container, options = {}) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }); }
  catch { return fallback(container, options.onReady); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x111e1a, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab;';
  canvas.setAttribute('aria-label', 'Interactive 3D patchwork product. Drag to rotate, scroll to zoom.');
  canvas.setAttribute('role', 'img'); container.appendChild(canvas);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(34, 1, .1, 40);
  const rig = new THREE.Group(); scene.add(rig);
  const target = new THREE.Vector3(0, .3, 0);
  scene.add(new THREE.HemisphereLight(0xe8efdd, 0x30433a, 2.5));
  const key = new THREE.DirectionalLight(0xffedce, 4.2); key.position.set(-3, 5, 5);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -4; key.shadow.camera.right = 4;
  key.shadow.camera.top = 4; key.shadow.camera.bottom = -4; key.shadow.bias = -.0003; key.shadow.normalBias = .03; key.shadow.radius = 5; scene.add(key);
  const fill = new THREE.DirectionalLight(0xc9e4db, 2.2); fill.position.set(4, 2, -3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xf1dcaa, 2.6); rim.position.set(1, 3, -4); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ color: 0x020806, opacity: .10 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.5; floor.receiveShadow = true; scene.add(floor);
  // A radial contact shadow keeps the floating studio object anchored visually.
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
  const sc = shadowCanvas.getContext('2d'), gradient = sc.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(0,0,0,.30)'); gradient.addColorStop(.5, 'rgba(0,0,0,.12)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
  sc.fillStyle = gradient; sc.fillRect(0, 0, 128, 128);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = -1.47; scene.add(contact);
  const weave = weaveTexture(), textures = [], materials = [];
  const threadMat = new THREE.LineBasicMaterial({ color: 0xe4d5b3, transparent: true, opacity: .82 });
  const seamMat = new THREE.MeshStandardMaterial({ color: 0xaaa182, roughness: 1 });
  const liningMat = new THREE.MeshStandardMaterial({ color: 0x354539, side: THREE.DoubleSide, roughness: 1 });
  const zipperMat = new THREE.MeshStandardMaterial({ color: 0xaba797, metalness: .75, roughness: .45 });
  let product, groups = [], sourcePhoto = options.photo || null, savedPlan = null, savedScraps = [], disposed = false;
  let assignedMaterials = null, missingMaterial = null;
  let exploded = false, wireframe = false, explodeValue = 0, rotationY = -.38, rotationX = .05, distance = 6.9, idleAngle = 0;
  let lastInteraction = performance.now(), dragging = false, pointer = null, frame, time = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function material(color, index, scrap, piece) {
    let map;
    const bbox = piece ? { x: piece.x, y: piece.y, width: piece.occupiedPixelWidth || piece.width, height: piece.occupiedPixelHeight || piece.height } : scrap?.bbox || scrap?.bounds;
    if (sourcePhoto && bbox) {
      const w = bbox.width ?? bbox.w ?? ((bbox.maxX ?? 0) - (bbox.x ?? bbox.minX ?? 0));
      const h = bbox.height ?? bbox.h ?? ((bbox.maxY ?? 0) - (bbox.y ?? bbox.minY ?? 0));
      if (w > 2 && h > 2) {
        const crop = document.createElement('canvas'); crop.width = crop.height = 256;
        try {
          const ctx = crop.getContext('2d');
          if (piece?.rotated) { ctx.translate(256, 0); ctx.rotate(Math.PI / 2); }
          // Planned rectangles are inside the fabric mask. For an unplanned
          // swatch, crop to its centre to avoid irregular background margins.
          const inset = piece ? 0 : .17;
          ctx.drawImage(sourcePhoto, (bbox.x ?? bbox.minX ?? 0) + w * inset, (bbox.y ?? bbox.minY ?? 0) + h * inset, w * (1 - inset * 2), h * (1 - inset * 2), 0, 0, 256, 256);
          map = new THREE.CanvasTexture(crop); map.colorSpace = THREE.SRGBColorSpace;
        } catch { /* An uploaded image without accessible pixels uses a woven colour swatch. */ }
      }
    }
    if (!map) map = fabricTexture(color, 213 + index * 13);
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); textures.push(map);
    const m = new THREE.MeshPhysicalMaterial({ map, bumpMap: weave, bumpScale: .008, roughness: .96, metalness: 0, sheen: .65, sheenColor: new THREE.Color(color).multiplyScalar(.8), sheenRoughness: .85, side: THREE.DoubleSide, wireframe });
    materials.push(m); return m;
  }

  function mesh(geometry, mat, group) {
    const m = new THREE.Mesh(geometry, mat); m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
  }
  function newPart(name, offset) {
    const part = new THREE.Group(); part.name = name; part.userData.offset = new THREE.Vector3(...offset); product.add(part); groups.push(part); return part;
  }
  function addStitches(group, surface, x0, x1, y0, y1, lift = .012) {
    const paths = [
      [x0 + .016, y0 + .014, x1 - .016, y0 + .014], [x0 + .016, y1 - .014, x1 - .016, y1 - .014],
      [x0 + .014, y0 + .016, x0 + .014, y1 - .016], [x1 - .014, y0 + .016, x1 - .014, y1 - .016]
    ];
    for (const [ax, ay, bx, by] of paths) {
      const length = Math.hypot(bx - ax, by - ay), steps = Math.max(4, Math.round(length * 45)), pts = [];
      for (let i = 0; i <= steps; i++) { const p = surface(ax + (bx - ax) * i / steps, ay + (by - ay) * i / steps); p.z += lift; pts.push(p); }
      group.add(stitchPath(pts, threadMat));
    }
  }
  function assigned(panel, row, col, fallback) {
    if (!assignedMaterials) return fallback;
    return assignedMaterials.get(`${panel}:${row}:${col}`) || missingMaterial;
  }
  function addGrid(group, surface, palette, splitX, splitY, scraps, reverse = false, panel = reverse ? 'back' : 'front') {
    for (let j = 0; j < splitY.length - 1; j++) for (let i = 0; i < splitX.length - 1; i++) {
      const index = (j * (splitX.length - 1) + i + (reverse ? 2 : 0)) % palette.length;
      const mat = assigned(panel, splitY.length - 2 - j, i, palette[index]);
      const patch = mesh(patchGeometry(splitX[i], splitX[i + 1], splitY[j], splitY[j + 1], surface), mat, group);
      patch.userData.patch = { panel, row: splitY.length - 2 - j, col: i, back: reverse };
      const before = group.children.length;
      addStitches(group, surface, splitX[i], splitX[i + 1], splitY[j], splitY[j + 1], reverse ? -.012 : .012);
      for (let k = before; k < group.children.length; k++) group.children[k].userData.stitch = true;
    }
    for (const u of splitX.slice(1, -1)) {
      const pts = Array.from({ length: 45 }, (_, i) => { const p = surface(u, -1 + 2 * i / 44); p.z += reverse ? -.006 : .006; return p; });
      group.add(seam(pts, seamMat, .005)).children.at(-1).userData.seam = true;
    }
    for (const v of splitY.slice(1, -1)) {
      const pts = Array.from({ length: 45 }, (_, i) => { const p = surface(-1 + 2 * i / 44, v); p.z += reverse ? -.006 : .006; return p; });
      group.add(seam(pts, seamMat, .005)).children.at(-1).userData.seam = true;
    }
  }
  function label(group, surface, x = .62, y = -.65) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#eee6d1'; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#42553c'; ctx.font = '700 30px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('RETHREAD', 128, 63);
    ctx.font = '14px sans-serif'; ctx.fillText('MADE AGAIN', 128, 90);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; textures.push(tx);
    const mat = new THREE.MeshStandardMaterial({ map: tx, roughness: 1, side: THREE.DoubleSide }); materials.push(mat);
    const geo = patchGeometry(x - .15, x + .15, y - .07, y + .07, (u, v) => { const p = surface(u, v); p.z += .02; return p; }, 6, 3);
    mesh(geo, mat, group);
  }

  function buildTote(palette, scraps, grid) {
    const front = newPart('Front patchwork panel', [-.40, .03, .76]), back = newPart('Back patchwork panel', [.40, .03, -.76]);
    const side = newPart('Joined edges and folded top', [.38, -.1, 0]);
    const width = v => 1.08 - .07 * (1 - v) - .10 * Math.pow(Math.max(0, Math.abs(v) - .75) / .25, 2);
    const surface = (u, v, sign = 1) => {
      const fold = .018 * Math.sin(u * 15 + v * 2) * Math.pow(Math.abs(u), 4) + .013 * Math.sin(v * 17 + u * 3) * Math.pow(Math.abs(v), 3);
      return new THREE.Vector3(u * width(v), v * 1.04, sign * (.35 + .17 * (1 - Math.pow(u, 4)) * (1 - v * v) + fold));
    };
    const sx = grid?.x || [-1, -.32, .35, 1], sy = grid?.y || [-1, -.28, .38, 1];
    addGrid(front, (u, v) => surface(u, v), palette, sx, sy, scraps);
    addGrid(back, (u, v) => surface(u, v, -1), palette, sx, sy, scraps, true);
    label(front, (u, v) => surface(u, v));
    for (const sign of [-1, 1]) {
      mesh(patchGeometry(-1, 1, -1, 1, (u, v) => new THREE.Vector3(sign * width(v), v * 1.04, u * .35 + .045 * Math.sin(v * 7) * (1 - u * u)), 12, 24), palette[1 % palette.length], side);
    }
    mesh(patchGeometry(-1, 1, -1, 1, (u, v) => new THREE.Vector3(u * width(-1), -1.04 - .035 * (1 - u * u), v * .35), 16, 8), palette[1 % palette.length], side);
    mesh(patchGeometry(-1, 1, -1, 1, (u, v) => new THREE.Vector3(u * .99, .98 - .035 * (1 - u * u), v * .33), 16, 4), liningMat, side);
    for (const sign of [-1, 1]) {
      const pts = Array.from({ length: 56 }, (_, i) => surface(-1 + 2 * i / 55, 1, sign));
      side.add(seam(pts, seamMat, .014));
      const handles = newPart(sign === 1 ? 'Front handle' : 'Back handle', [sign * .42, .60, sign * .45]);
      const handle = handleGeometry(sign * .35);
      const handlePanel = sign === 1 ? 'handle-left' : 'handle-right';
      if (assignedMaterials) {
        handle.geometry.dispose();
        for (let segment = 0; segment < 4; segment++) mesh(handleGeometry(sign * .35, .14, segment / 4, (segment + 1) / 4).geometry, assigned(handlePanel, segment, 0, palette[1 % palette.length]), handles);
        for (const t of [.25, .5, .75]) {
          const center = handle.center(t), a = handle.center(t - .001), b = handle.center(t + .001), tangent = b.sub(a).normalize(), normal = new THREE.Vector3(-tangent.y, tangent.x, 0);
          const pts = Array.from({ length: 7 }, (_, i) => { const p = center.clone().addScaledVector(normal, -.057 + .114 * i / 6); p.z += .024; return p; });
          handles.add(stitchPath(pts, threadMat));
        }
      } else mesh(handle.geometry, palette[1 % palette.length], handles);
      for (const edge of [-1, 1]) {
        const pts = Array.from({ length: 98 }, (_, i) => {
          const t = i / 97, c = handle.center(t), a = handle.center(Math.max(0, t - .001)), b = handle.center(Math.min(1, t + .001));
          const tangent = b.sub(a).normalize(); c.addScaledVector(new THREE.Vector3(-tangent.y, tangent.x, 0), edge * .048); c.z += .023; return c;
        }); handles.add(stitchPath(pts, threadMat));
      }
      for (const x of [-.65, .65]) {
        const geo = new THREE.BoxGeometry(.15, .25, .035); const tab = mesh(geo, assigned(handlePanel, x < 0 ? 0 : 3, 0, palette[1 % palette.length]), handles); tab.position.set(x, .92, sign * .375);
      }
    }
  }

  function buildPouch(palette, scraps, grid) {
    const front = newPart('Front patchwork panel', [0, 0, .65]), back = newPart('Back patchwork panel', [0, 0, -.65]);
    const body = newPart('Joined edges and zipper', [.4, .25, 0]);
    const surface = (u, v, sign = 1) => new THREE.Vector3(u * (1.35 - .05 * Math.abs(v)), v * .81, sign * (.20 + .17 * (1 - Math.pow(u, 4)) * (1 - v * v) + .012 * Math.sin(u * 19) * v * v));
    addGrid(front, (u, v) => surface(u, v), palette, grid?.x || [-1, -.12, 1], grid?.y || [-1, .12, 1], scraps);
    addGrid(back, (u, v) => surface(u, v, -1), palette, grid?.x || [-1, -.12, 1], grid?.y || [-1, .12, 1], scraps, true);
    label(front, (u, v) => surface(u, v), .67, -.63);
    for (const sign of [-1, 1]) mesh(patchGeometry(-1, 1, -1, 1, (u, v) => new THREE.Vector3(sign * (1.35 - .05 * Math.abs(v)), v * .81, u * .2), 8, 20), palette[1 % palette.length], body);
    mesh(patchGeometry(-1, 1, -1, 1, (u, v) => new THREE.Vector3(u * 1.3, -.81, v * .2), 16, 6), palette[1 % palette.length], body);
    const tape = mesh(new THREE.BoxGeometry(2.63, .06, .35), palette[1 % palette.length], body); tape.position.y = .81;
    for (let i = 0; i < 64; i++) { const tooth = mesh(new THREE.BoxGeometry(.025, .045, .065), zipperMat, body); tooth.position.set(-1.27 + i * .04, .85, 0); }
    const pull = mesh(new THREE.TorusGeometry(.08, .018, 6, 18), zipperMat, body); pull.position.set(.92, .89, .1); pull.rotation.x = .2;
    if (!assignedMaterials) {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(.27, .06, 8, 32), palette[2 % palette.length]); strap.scale.set(.6, 1, .4); strap.position.set(1.48, .50, 0); body.add(strap);
    }
  }

  function buildCushion(palette, scraps, grid) {
    const front = newPart('Front patchwork panel', [0, 0, .74]), back = newPart('Back patchwork panel', [0, 0, -.74]);
    const edge = newPart('Sewn perimeter', [.15, .1, 0]);
    const surface = (u, v, sign = 1) => new THREE.Vector3(u * (1.18 + .07 * (1 - v * v)), v * (1.18 + .07 * (1 - u * u)), sign * (.08 + .49 * Math.pow(Math.max(0, (1 - u * u) * (1 - v * v)), .58)));
    addGrid(front, (u, v) => surface(u, v), palette, grid?.x || [-1, -.34, .34, 1], grid?.y || [-1, -.34, .34, 1], scraps);
    if (assignedMaterials) {
      const upperRows = Math.max(1, Math.ceil((savedPlan?.grid?.rows || 3) * .65));
      const flapY = Array.from({ length: upperRows + 1 }, (_, i) => -1 + 2 * i / upperRows);
      const topSurface = (u, v) => surface(u, .34 + .66 * v, -1);
      const bottomSurface = (u, v) => { const p = surface(u, -.34 + .66 * v, -1); p.z -= .016; return p; };
      addGrid(back, topSurface, palette, grid.x, flapY, scraps, true, 'back-upper');
      addGrid(back, bottomSurface, palette, grid.x, flapY, scraps, true, 'back-lower');
      const opening = Array.from({ length: 48 }, (_, i) => { const p = topSurface(-1 + 2 * i / 47, -1); p.z -= .014; return p; });
      back.add(seam(opening, seamMat, .011));
    } else addGrid(back, (u, v) => surface(u, v, -1), palette, [-1, -.34, .34, 1], [-1, -.34, .34, 1], scraps, true);
    label(front, (u, v) => surface(u, v), .64, -.70);
    const pts = [];
    for (let side = 0; side < 4; side++) for (let i = 0; i <= 30; i++) {
      const t = -1 + 2 * i / 30;
      const p = side === 0 ? surface(t, -1) : side === 1 ? surface(1, t) : side === 2 ? surface(-t, 1) : surface(-1, -t);
      p.z = 0; pts.push(p);
    }
    pts.push(pts[0].clone()); edge.add(seam(pts, palette[1 % palette.length], .016));
    for (let side = 0; side < 4; side++) {
      mesh(patchGeometry(-1, 1, -1, 1, (u, v) => {
        const p = side === 0 ? surface(u, -1) : side === 1 ? surface(1, u) : side === 2 ? surface(-u, 1) : surface(-1, -u); p.z = v * .08; return p;
      }, 24, 3), palette[1 % palette.length], edge);
    }
  }

  function clearProduct() {
    if (product) {
      product.traverse(o => o.geometry?.dispose()); rig.remove(product);
      materials.splice(0).forEach(m => m.dispose()); textures.splice(0).forEach(t => t.dispose());
    }
    product = new THREE.Group(); rig.add(product); groups = [];
  }
  function update(plan = {}, scraps = []) {
    stopAssembly();
    savedPlan = plan; savedScraps = scraps;
    clearProduct();
    const pieces = plan.pieces || plan.placements || [];
    const assignments = pieces.map(p => scraps.find(s => String(s.id) === String(p.scrapId ?? p.scrap ?? p.sourceId)) || p);
    const selections = assignments.length ? assignments : scraps;
    const usable = selections.length ? selections : DEFAULT_COLORS.map(color => ({ color }));
    assignedMaterials = null;
    if (pieces.length && pieces[0].panel && plan.grid) {
      assignedMaterials = new Map();
      pieces.forEach((p, i) => {
        const scrap = scraps.find(s => String(s.id) === String(p.scrapId));
        const color = validColor(p.color || scrap?.color, DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
        assignedMaterials.set(`${p.panel}:${p.row}:${p.col}`, material(color, i, scrap, p));
      });
      missingMaterial = new THREE.MeshStandardMaterial({ color: '#899288', transparent: true, opacity: .25, side: THREE.DoubleSide, roughness: 1, wireframe });
      materials.push(missingMaterial);
    }
    const palette = usable.slice(0, 9).map((s, i) => material(validColor(s.color || s.hex || s.dominantColor, DEFAULT_COLORS[i % DEFAULT_COLORS.length]), i, s));
    const grid = plan.grid ? {
      x: Array.from({ length: plan.grid.cols + 1 }, (_, i) => -1 + 2 * i / plan.grid.cols),
      y: Array.from({ length: plan.grid.rows + 1 }, (_, i) => -1 + 2 * i / plan.grid.rows)
    } : null;
    const name = String(plan.type || plan.productId || plan.product || plan.name || 'tote').toLowerCase();
    if (/pouch|clutch|pencil/.test(name)) { buildPouch(palette, selections, grid); target.y = 0; product.position.y = .08; product.scale.x = (plan.dimensions?.widthCm / plan.dimensions?.heightCm || 1.5) / 1.67; }
    else if (/cushion|pillow/.test(name)) { buildCushion(palette, selections, grid); target.y = 0; product.position.y = .08; product.scale.x = plan.dimensions?.widthCm / plan.dimensions?.heightCm || 1; }
    else { buildTote(palette, selections, grid); target.y = .35; product.position.y = 0; product.scale.x = (plan.dimensions?.widthCm / plan.dimensions?.heightCm || .86) / .98; }
    product.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    render();
  }

  // ── Assembly animation ────────────────────────────────────────────────
  // Every planned cut starts flat on a mat printed with the source photo, at
  // the exact pixels it will be cut from. Each piece lifts, turns, and bends
  // into its slot on the product; the remaining parts fly in; stitches sew
  // themselves. Geometry is morphed from the photographed rectangle to the
  // final curved panel, so the texture never jumps.
  let assembly = null, camOverride = null;
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const smooth = (a, b, t) => { const x = clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
  function pieceKey(p) { return `${p.panel}:${p.row}:${p.col}`; }
  function matCanvas(pieces) {
    const W = sourcePhoto.width, H = sourcePhoto.height, c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.drawImage(sourcePhoto, 0, 0); ctx.fillStyle = 'rgba(14,26,20,.22)'; ctx.fillRect(0, 0, W, H);
    const s = W / 1200;
    for (const p of pieces) {
      const w = p.occupiedPixelWidth || p.width, h = p.occupiedPixelHeight || p.height;
      ctx.fillStyle = 'rgba(10,20,16,.62)'; ctx.fillRect(p.x, p.y, w, h);
      ctx.setLineDash([6 * s, 4 * s]); ctx.strokeStyle = 'rgba(214,236,178,.9)'; ctx.lineWidth = 2 * s; ctx.strokeRect(p.x, p.y, w, h);
    }
    return c;
  }
  function playAssembly() {
    stopAssembly();
    const pieces = savedPlan?.pieces || [];
    if (reducedMotion || !sourcePhoto || !pieces.length || !product) return false;
    exploded = false; explodeValue = 0; groups.forEach(g => g.position.set(0, 0, 0));
    const W = sourcePhoto.width, H = sourcePhoto.height, sx = product.scale.x || 1;
    const matW = 4.4, matH = matW * H / W, matY = -1.36 - product.position.y;
    const toMat = (px, py, lift = 0) => new THREE.Vector3((px / W - .5) * matW / sx, matY + lift, (py / H - .5) * matH);
    const byKey = new Map(pieces.map(p => [pieceKey(p), p]));
    // Photo mat with dark "holes" that appear as pieces are lifted away.
    const matTexture = new THREE.CanvasTexture(matCanvas(pieces)); matTexture.colorSpace = THREE.SRGBColorSpace;
    const matMaterial = new THREE.MeshStandardMaterial({ map: matTexture, roughness: 1, transparent: true });
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(matW / sx, matH), matMaterial);
    mat.rotation.x = -Math.PI / 2; mat.position.y = matY; mat.receiveShadow = true; product.add(mat);
    const photoTexture = new THREE.CanvasTexture(sourcePhoto); photoTexture.colorSpace = THREE.SRGBColorSpace;
    const items = [], others = [], stitches = [], decor = [], used = new Set();
    product.updateMatrixWorld(true);
    for (const group of groups) {
      const hasPatches = group.children.some(c => c.userData.patch);
      if (!hasPatches) { others.push(group); group.visible = false; continue; }
      for (const child of group.children) {
        const piece = child.userData.patch && byKey.get(`${child.userData.patch.panel}:${child.userData.patch.row}:${child.userData.patch.col}`);
        if (piece) items.push({ mesh: child, piece });
        else if (child.userData.stitch) { stitches.push(child); child.geometry.setDrawRange(0, 0); }
        else { decor.push(child); child.visible = false; }
      }
    }
    items.sort((a, b) => (a.mesh.userData.patch.back - b.mesh.userData.patch.back) || a.piece.row - b.piece.row || a.piece.col - b.piece.col);
    items.forEach((item, index) => {
      const { mesh: m, piece } = item; used.add(pieceKey(piece));
      const original = m.geometry, pos = original.attributes.position, uv = original.attributes.uv, n = pos.count;
      const C = new THREE.Vector3(); for (let k = 0; k < n; k++) C.add(new THREE.Vector3().fromBufferAttribute(pos, k)); C.multiplyScalar(1 / n);
      const w = piece.occupiedPixelWidth || piece.width, h = piece.occupiedPixelHeight || piece.height, lift = .004 + index * .0004;
      const L = toMat(piece.x + w / 2, piece.y + h / 2, lift);
      const q0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), m.userData.patch.back ? Math.PI / 2 : -Math.PI / 2), qInv = q0.clone().invert();
      const flat = new Float32Array(n * 3), curved = new Float32Array(n * 3), flatNormal = new Float32Array(n * 3);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(qInv);
      for (let k = 0; k < n; k++) {
        const s = uv.getX(k), t = uv.getY(k);
        // Inverse of the texture crop in material(): uv → source photo pixel.
        const px = piece.rotated ? piece.x + (1 - t) * w : piece.x + s * w, py = piece.rotated ? piece.y + (1 - s) * h : piece.y + (1 - t) * h;
        const f = toMat(px, py, lift).sub(L).applyQuaternion(qInv);
        flat.set([f.x, f.y, f.z], k * 3);
        curved.set([pos.getX(k) - C.x, pos.getY(k) - C.y, pos.getZ(k) - C.z], k * 3);
        flatNormal.set([up.x, up.y, up.z], k * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(flat, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(flatNormal, 3));
      geo.setAttribute('uv', uv); geo.setIndex(original.index);
      geo.morphAttributes.position = [new THREE.BufferAttribute(curved, 3)];
      geo.morphAttributes.normal = [original.attributes.normal];
      m.geometry = geo; m.updateMorphTargets(); m.morphTargetInfluences[0] = 0;
      m.quaternion.copy(q0); m.position.copy(L);
      const spin = (index % 2 ? 1 : -1) * (.25 + (index % 3) * .12);
      Object.assign(item, { original, geo, C, L, q0, spin, start: .85 + 1.7 * index / Math.max(1, items.length - 1), duration: 1.45 });
    });
    // Cuts without a panel mesh (tote handle strips) lift off as flat proxies.
    const proxies = pieces.filter(p => !used.has(pieceKey(p))).map((piece, index) => {
      const w = piece.occupiedPixelWidth || piece.width, h = piece.occupiedPixelHeight || piece.height;
      const geo = new THREE.PlaneGeometry(w / W * matW / sx, h / H * matH), uvs = geo.attributes.uv;
      for (let k = 0; k < uvs.count; k++) uvs.setXY(k, (piece.x + uvs.getX(k) * w) / W, 1 - (piece.y + (1 - uvs.getY(k)) * h) / H);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: photoTexture, roughness: 1, side: THREE.DoubleSide, transparent: true }));
      const L = toMat(piece.x + w / 2, piece.y + h / 2, .006); m.position.copy(L); m.rotation.x = -Math.PI / 2; m.castShadow = true; product.add(m);
      const target = new THREE.Vector3(/left/.test(piece.panel) ? -.4 : .4, 1.75, /left/.test(piece.panel) ? -.35 : .35);
      return { mesh: m, L, target, start: 1.6 + .9 * index / Math.max(1, pieces.length - used.size - 1), duration: 1.3 };
    });
    assembly = { started: performance.now(), items, proxies, others, stitches, decor, mat, matTexture, matMaterial, photoTexture, length: 5.9 };
    camOverride = { rx: 1.02, dist: 7.6, ty: -1.05 };
    lastInteraction = performance.now();
    return true;
  }
  function stepAssembly(now) {
    const a = assembly, t = a.frozenAt ?? (now - a.started) / 1000;
    for (const it of a.items) {
      const e = clamp((t - it.start) / it.duration, 0, 1), k = ease(e);
      const p = new THREE.Vector3().lerpVectors(it.L, it.C, k);
      p.y += Math.sin(Math.PI * k) * 1.25; p.z += Math.sin(Math.PI * k) * (it.mesh.userData.patch.back ? -.55 : .75);
      const q = it.q0.clone().slerp(new THREE.Quaternion(), k), wobble = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.spin * Math.sin(Math.PI * k));
      it.mesh.quaternion.copy(wobble.multiply(q)); it.mesh.position.copy(p);
      it.mesh.morphTargetInfluences[0] = smooth(.35, 1, e);
    }
    for (const pr of a.proxies) {
      const e = clamp((t - pr.start) / pr.duration, 0, 1), k = ease(e);
      pr.mesh.position.lerpVectors(pr.L, pr.target, k); pr.mesh.position.y += Math.sin(Math.PI * k) * .8;
      pr.mesh.rotation.set(-Math.PI / 2 * (1 - k), k * 2.4, 0); pr.mesh.scale.setScalar(1 - .75 * k); pr.mesh.material.opacity = 1 - smooth(.7, 1, e);
    }
    a.matMaterial.opacity = 1 - smooth(2.4, 3.7, t); a.mat.visible = a.matMaterial.opacity > .01;
    const fly = ease(clamp((t - 3.0) / 1.1, 0, 1));
    for (const g of a.others) { g.visible = t > 3.0; g.position.copy(g.userData.offset).multiplyScalar(3.4 * (1 - fly)); g.position.y += 2.2 * (1 - fly); }
    for (const d of a.decor) d.visible = t > 3.7;
    const sew = clamp((t - 3.8) / 1.6, 0, 1);
    a.stitches.forEach((st, i) => { const local = clamp(sew * a.stitches.length * .35 - i * .35 + 1, 0, 1), count = st.geometry.attributes.position.count; st.geometry.setDrawRange(0, Math.floor(count * local / 2) * 2); });
    const cam = ease(clamp((t - .55) / 3.4, 0, 1));
    camOverride = { rx: 1.02 + (rotationX - 1.02) * cam, dist: 7.6 + (distance - 7.6) * cam, ty: -1.05 + (target.y - -1.05) * cam };
    if (t >= a.length) finishAssembly();
  }
  function finishAssembly() {
    if (!assembly) return;
    const a = assembly; assembly = null; camOverride = null;
    for (const it of a.items) {
      it.mesh.geometry = it.original; it.geo.dispose();
      delete it.mesh.morphTargetInfluences; delete it.mesh.morphTargetDictionary;
      it.mesh.position.set(0, 0, 0); it.mesh.quaternion.identity();
    }
    for (const pr of a.proxies) { product?.remove(pr.mesh); pr.mesh.geometry.dispose(); pr.mesh.material.dispose(); }
    for (const g of a.others) { g.visible = true; g.position.set(0, 0, 0); }
    for (const d of a.decor) d.visible = true;
    for (const st of a.stitches) st.geometry.setDrawRange(0, Infinity);
    product?.remove(a.mat); a.mat.geometry.dispose(); a.matMaterial.dispose(); a.matTexture.dispose(); a.photoTexture.dispose();
    options.onAssembly?.(false);
  }
  function stopAssembly() { if (assembly) finishAssembly(); }

  function resize() {
    const rect = container.getBoundingClientRect(), w = Math.max(1, rect.width), h = Math.max(1, rect.height || 560);
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); render();
  }
  function render() {
    if (disposed) return;
    const aspectCompensation = camera.aspect < .8 ? 1.1 : 1;
    const viewDistance = (camOverride?.dist ?? distance) + explodeValue * 1.1, rx = camOverride?.rx ?? rotationX;
    const viewTarget = target.clone(); if (camOverride) viewTarget.y = camOverride.ty; viewTarget.y += explodeValue * .22;
    const yaw = rotationY + idleAngle;
    camera.position.set(Math.sin(yaw) * Math.cos(rx) * viewDistance * aspectCompensation, viewTarget.y + Math.sin(rx + .10) * viewDistance, Math.cos(yaw) * Math.cos(rx) * viewDistance * aspectCompensation);
    camera.lookAt(viewTarget); renderer.render(scene, camera);
  }
  function animate(now) {
    if (disposed) return;
    const dt = Math.min(.05, (now - time) / 1000 || .016); time = now;
    const idleTarget = !reducedMotion && !dragging && now - lastInteraction > 4000 ? Math.sin(now * .0003) * .07 : 0;
    idleAngle += (idleTarget - idleAngle) * Math.min(1, dt * 3);
    explodeValue += ((exploded ? 1 : 0) - explodeValue) * (reducedMotion ? 1 : .10);
    if (assembly) stepAssembly(now);
    else for (const part of groups) part.position.copy(part.userData.offset).multiplyScalar(explodeValue);
    if (product && !reducedMotion) product.rotation.z = Math.sin(now * .00038) * .015;
    contact.scale.setScalar(1 + explodeValue * .15); contact.material.opacity = 1 - explodeValue * .25;
    render(); frame = requestAnimationFrame(animate);
  }
  function onDown(e) { if (assembly) finishAssembly(); dragging = true; pointer = { x: e.clientX, y: e.clientY }; lastInteraction = performance.now(); canvas.style.cursor = 'grabbing'; canvas.setPointerCapture(e.pointerId); }
  function onMove(e) {
    if (!dragging) return;
    rotationY -= (e.clientX - pointer.x) * .006; rotationX = clamp(rotationX + (e.clientY - pointer.y) * .003, -.40, .50);
    pointer = { x: e.clientX, y: e.clientY }; lastInteraction = performance.now(); render();
  }
  function onUp() { dragging = false; canvas.style.cursor = 'grab'; lastInteraction = performance.now(); }
  function onWheel(e) { e.preventDefault(); distance = clamp(distance + e.deltaY * .004, 4.6, 9.6); lastInteraction = performance.now(); render(); }
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp); canvas.addEventListener('wheel', onWheel, { passive: false });
  const observer = new ResizeObserver(resize); observer.observe(container);
  update({}, []); resize(); frame = requestAnimationFrame(animate); options.onReady?.({ supported: true });
  return {
    update,
    playAssembly() { const started = playAssembly(); if (started) options.onAssembly?.(true); return started; },
    get assembling() { return Boolean(assembly); },
    seekAssembly(seconds) { if (assembly) { assembly.frozenAt = seconds; stepAssembly(performance.now()); render(); } },
    setExploded(value) { stopAssembly(); exploded = Boolean(value); lastInteraction = performance.now(); },
    setWireframe(value) { wireframe = Boolean(value); materials.forEach(m => { m.wireframe = wireframe; }); render(); },
    setPhoto(value) { sourcePhoto = value; update(savedPlan || {}, savedScraps); },
    resetView() { stopAssembly(); rotationY = -.38; rotationX = .05; distance = 6.9; lastInteraction = performance.now(); render(); },
    capture() { render(); return canvas.toDataURL('image/png'); },
    dispose() {
      stopAssembly(); disposed = true; cancelAnimationFrame(frame); observer.disconnect(); clearProduct(); weave.dispose(); shadowTexture.dispose();
      threadMat.dispose(); seamMat.dispose(); liningMat.dispose(); zipperMat.dispose(); floor.geometry.dispose(); floor.material.dispose(); contact.geometry.dispose(); contact.material.dispose();
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('wheel', onWheel);
      renderer.dispose(); canvas.remove();
    }
  };
}
