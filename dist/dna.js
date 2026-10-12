// Colour DNA: fabric pixels from the photo plotted in CIELAB space with Three.js.
// L* is height, a* runs green→red, b* runs blue→yellow. Each scrap's mean
// colour is a sphere sized by its measured area. Drag to rotate.
import * as THREE from './vendor/three.module.js';

function rgbToLab(r, g, b) {
  const f = c => { c /= 255; return c > .04045 ? ((c + .055) / 1.055) ** 2.4 : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  const x = (R * .4124 + G * .3576 + B * .1805) / .95047, y = R * .2126 + G * .7152 + B * .0722, z = (R * .0193 + G * .1192 + B * .9505) / 1.08883;
  const h = t => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * h(y) - 16, 500 * (h(x) - h(y)), 200 * (h(y) - h(z))];
}
const AB = 1 / 62, LS = 1 / 50;
const toSpace = ([L, a, b]) => new THREE.Vector3(a * AB, (L - 50) * LS, -b * AB);

function label(text, color) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const ctx = c.getContext('2d'); ctx.font = '600 30px "DM Sans", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, 64, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); s.scale.set(.42, .21, 1); return s;
}

export function createColorDNA(container) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { container.innerHTML = '<p class="muted dna-fallback">Colour DNA needs WebGL.</p>'; return { update() {}, dispose() {} }; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement); renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, .1, 30), world = new THREE.Group(); scene.add(world);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223322, 2.2)); const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(2, 3, 2); scene.add(sun);
  // Axes with colour gradients.
  const axisGeo = new THREE.BufferGeometry(), R = 1.35;
  axisGeo.setAttribute('position', new THREE.Float32BufferAttribute([-R, 0, 0, R, 0, 0, 0, 0, R, 0, 0, -R, 0, -1.05, 0, 0, 1.1, 0], 3));
  axisGeo.setAttribute('color', new THREE.Float32BufferAttribute([.3, .75, .45, .9, .35, .35, .35, .5, .95, .95, .8, .3, .15, .15, .15, .95, .95, .9], 3));
  world.add(new THREE.LineSegments(axisGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .75 })));
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 96 }, (_, i) => new THREE.Vector3(Math.cos(i / 96 * Math.PI * 2) * 1.1, 0, Math.sin(i / 96 * Math.PI * 2) * 1.1))), new THREE.LineBasicMaterial({ color: 0x9fb48a, transparent: true, opacity: .22 }));
  world.add(ring);
  [['+a*', '#e88b84', R + .12, 0, 0], ['−a*', '#7ccf98', -R - .12, 0, 0], ['+b*', '#f1d07a', 0, 0, -R - .12], ['−b*', '#86a8f0', 0, 0, R + .12], ['L*', '#e7efdc', 0, 1.22, 0]].forEach(([t, c, x, y, z]) => { const s = label(t, c); s.position.set(x, y, z); world.add(s); });
  const disc = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); return new THREE.CanvasTexture(c); })();
  let points = null, centroids = new THREE.Group(), grow = 1, rotY = .6, rotX = .32, dragging = false, last = null, visible = true, frame = 0, prev = 0;
  world.add(centroids);

  function update(analysis, photo) {
    if (points) { world.remove(points); points.geometry.dispose(); points.material.dispose(); points = null; }
    centroids.children.slice().forEach(m => { centroids.remove(m); m.geometry.dispose(); m.material.dispose(); });
    if (!analysis?.scraps?.length || !photo) return;
    const data = photo.getContext('2d').getImageData(0, 0, photo.width, photo.height).data, W = photo.width;
    const total = analysis.scraps.reduce((s, x) => s + x.areaPx, 0), pos = [], col = [];
    let seed = 7; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const maxArea = Math.max(...analysis.scraps.map(s => s.areaPx));
    for (const s of analysis.scraps) {
      const n = Math.max(60, Math.round(3200 * s.areaPx / total)), b = s.bbox; let got = 0;
      for (let tries = 0; got < n && tries < n * 6; tries++) {
        const x = Math.floor(rand() * b.width), y = Math.floor(rand() * b.height); if (!s.mask[y * b.width + x]) continue;
        const i = ((b.y + y) * W + b.x + x) * 4, p = toSpace(rgbToLab(data[i], data[i + 1], data[i + 2]));
        pos.push(p.x, p.y, p.z); col.push(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255); got++;
      }
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(.045 + .085 * Math.sqrt(s.areaPx / maxArea), 20, 14), new THREE.MeshStandardMaterial({ color: new THREE.Color(s.color), roughness: .45, metalness: .05, emissive: new THREE.Color(s.color), emissiveIntensity: .15 }));
      sphere.position.copy(toSpace(rgbToLab(...s.rgb))); centroids.add(sphere);
      const drop = new THREE.Line(new THREE.BufferGeometry().setFromPoints([sphere.position.clone(), new THREE.Vector3(sphere.position.x, 0, sphere.position.z)]), new THREE.LineBasicMaterial({ color: 0xdfe8cf, transparent: true, opacity: .35 }));
      centroids.add(drop);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    // The colour attribute holds sRGB bytes; tell Three.js so they are not re-encoded.
    const material = new THREE.PointsMaterial({ size: .06, vertexColors: true, map: disc, alphaTest: .5, transparent: true, sizeAttenuation: true });
    geo.getAttribute('color').array.forEach((v, i, a) => { a[i] = v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    points = new THREE.Points(geo, material); world.add(points); grow = 0;
  }
  function resize() { const r = container.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); }
  function draw(now) {
    frame = requestAnimationFrame(draw);
    if (!visible) return;
    const dt = Math.min(.05, (now - prev) / 1000 || .016); prev = now;
    if (!dragging && !matchMedia('(prefers-reduced-motion: reduce)').matches) rotY += dt * .22;
    grow = Math.min(1, grow + dt * 1.1); const e = 1 - Math.pow(1 - grow, 3);
    if (points) points.scale.setScalar(.15 + .85 * e); centroids.scale.setScalar(e);
    world.rotation.set(0, rotY, 0);
    const d = 4.9; camera.position.set(0, Math.sin(rotX) * d, Math.cos(rotX) * d); camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { dragging = true; last = e.clientX; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
  el.addEventListener('pointermove', e => { if (!dragging) return; rotY += (e.clientX - last) * .008; last = e.clientX; });
  const up = () => { dragging = false; el.style.cursor = 'grab'; }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  new ResizeObserver(resize).observe(container); resize();
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(container);
  frame = requestAnimationFrame(draw);
  return { update, dispose() { cancelAnimationFrame(frame); renderer.dispose(); } };
}
