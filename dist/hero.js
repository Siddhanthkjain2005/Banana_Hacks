// Hero: the current photo's scraps float as waving cloth swatches, threaded
// together by a running stitch. Purely decorative; textures come from the
// analysed photo, so it changes with every collection.
import * as THREE from './vendor/three.module.js';

const FALLBACK = ['#75835c', '#c5b79a', '#527281', '#a9674e', '#b8a164', '#92948b', '#3c5145'];

export function createHero(container) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { return { update() {} }; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 2, .1, 50);
  camera.position.set(0, 0, 7.2);
  scene.add(new THREE.HemisphereLight(0xf7f6ec, 0x8a9a80, 2.4));
  const key = new THREE.DirectionalLight(0xfff1d8, 2.4); key.position.set(-2, 3, 4); scene.add(key);
  const swatches = [], group = new THREE.Group(); scene.add(group);
  const threadMat = new THREE.LineDashedMaterial({ color: 0x6f8a55, dashSize: .09, gapSize: .07, transparent: true, opacity: .85 });
  let thread = null, mouse = { x: 0, y: 0 }, visible = true, frame;

  function swatchTexture(photo, scrap, color) {
    const c = document.createElement('canvas'); c.width = c.height = 192; const ctx = c.getContext('2d');
    if (photo && scrap) { const b = scrap.bbox, side = Math.min(b.width, b.height) * .6; ctx.drawImage(photo, b.x + b.width / 2 - side / 2, b.y + b.height / 2 - side / 2, side, side, 0, 0, 192, 192); }
    else { ctx.fillStyle = color; ctx.fillRect(0, 0, 192, 192); }
    ctx.setLineDash([7, 5]); ctx.strokeStyle = 'rgba(250,248,232,.75)'; ctx.lineWidth = 2.2; ctx.strokeRect(11, 11, 170, 170);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  function build(photo, scraps) {
    swatches.splice(0).forEach(s => { group.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.map.dispose(); s.mesh.material.dispose(); });
    const list = (scraps?.length ? scraps : FALLBACK.map(color => ({ color }))).slice(0, 7);
    list.forEach((scrap, i) => {
      const size = .78 + (i % 3) * .14, geo = new THREE.PlaneGeometry(size, size, 14, 14);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: swatchTexture(photo, scrap.bbox ? scrap : null, scrap.color), roughness: .95, side: THREE.DoubleSide }));
      const angle = i / list.length * Math.PI * 2;
      const home = new THREE.Vector3(Math.cos(angle) * 2.15, Math.sin(angle) * .62, Math.sin(angle * 2) * .5);
      mesh.position.copy(home); group.add(mesh);
      swatches.push({ mesh, home, base: Float32Array.from(geo.attributes.position.array), phase: i * 1.7, spin: (i % 2 ? 1 : -1) * (.18 + i * .03) });
    });
    if (thread) { group.remove(thread); thread.geometry.dispose(); }
    thread = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new Array(220).fill(0).map(() => new THREE.Vector3())), threadMat); group.add(thread);
  }
  function step(t) {
    for (const s of swatches) {
      const p = s.mesh.geometry.attributes.position, b = s.base;
      for (let k = 0; k < p.count; k++) {
        const x = b[k * 3], y = b[k * 3 + 1];
        p.array[k * 3 + 2] = Math.sin(x * 3.1 + t * 1.5 + s.phase) * .07 + Math.sin(y * 2.3 + t * 1.1 + s.phase) * .05 + Math.sin((x + y) * 4 + t * 2.2) * .015;
      }
      p.needsUpdate = true; s.mesh.geometry.computeVertexNormals();
      s.mesh.position.set(s.home.x + Math.sin(t * .4 + s.phase) * .12, s.home.y + Math.sin(t * .55 + s.phase) * .14, s.home.z + Math.cos(t * .35 + s.phase) * .12);
      s.mesh.rotation.set(Math.sin(t * .3 + s.phase) * .35, Math.cos(t * .25 + s.phase) * .5 + s.spin, Math.sin(t * .2 + s.phase) * .25);
    }
    if (thread && swatches.length > 1) {
      const pts = [...swatches.map(s => s.mesh.position), swatches[0].mesh.position], curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
      const pos = thread.geometry.attributes.position, sample = curve.getSpacedPoints(pos.count - 1);
      sample.forEach((v, k) => pos.setXYZ(k, v.x, v.y, v.z - .05)); pos.needsUpdate = true; thread.computeLineDistances();
      const d = thread.geometry.attributes.lineDistance; for (let k = 0; k < d.count; k++) d.array[k] -= t * .35; d.needsUpdate = true;
    }
    group.rotation.y = Math.sin(t * .15) * .25 + mouse.x * .25; group.rotation.x = mouse.y * .15;
  }
  function resize() { const r = container.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); }
  function loop(now) { frame = requestAnimationFrame(loop); if (!visible) return; step(reduced ? 2 : now / 1000); renderer.render(scene, camera); }
  addEventListener('pointermove', e => { mouse = { x: e.clientX / innerWidth - .5, y: e.clientY / innerHeight - .5 }; }, { passive: true });
  new ResizeObserver(resize).observe(container); resize();
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(container);
  build(null, null); frame = requestAnimationFrame(loop);
  return { update(analysis, photo) { build(photo, analysis?.scraps?.filter(s => s.bbox.width > 40 && s.bbox.height > 40)); }, dispose() { cancelAnimationFrame(frame); renderer.dispose(); } };
}
