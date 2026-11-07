// Live 3D preview of an entity model with its texture and animations.
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight, Group, Mesh,
  BufferGeometry, Float32BufferAttribute, MeshLambertMaterial, Texture, NearestFilter,
  SRGBColorSpace, GridHelper, Euler, FrontSide,
} from 'three';
import { faceRects, modelBounds } from '../core/geo.js';
import { evalPose } from '../core/anim.js';
import { entityTextureURL, loadImage } from './textures.js';

const D2R = Math.PI / 180;

function cubeGeometry(cube, pivot, texW, texH) {
  const inf = cube.inflate || 0;
  const [ox, oy, oz] = cube.origin, [sx, sy, sz] = cube.size;
  // three space: x mirrored relative to Bedrock (same convention Blockbench uses).
  const x0 = -(ox + sx - pivot[0]) - inf, x1 = -(ox - pivot[0]) + inf;
  const y0 = oy - pivot[1] - inf, y1 = oy + sy - pivot[1] + inf;
  const z0 = oz - pivot[2] - inf, z1 = oz + sz - pivot[2] + inf;
  const r = faceRects(cube);
  let east = r.east, west = r.west;
  if (cube.mirror) [east, west] = [west, east];
  // Corners per face as seen from outside: TL, TR, BL, BR.
  const faces = [
    [east, [x1, y1, z1], [x1, y1, z0], [x1, y0, z1], [x1, y0, z0], [1, 0, 0]],
    [west, [x0, y1, z0], [x0, y1, z1], [x0, y0, z0], [x0, y0, z1], [-1, 0, 0]],
    [r.up, [x1, y1, z1], [x0, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]],
    [r.down, [x1, y0, z0], [x0, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]],
    [r.south, [x0, y1, z1], [x1, y1, z1], [x0, y0, z1], [x1, y0, z1], [0, 0, 1]],
    [r.north, [x1, y1, z0], [x0, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1]],
  ];
  const pos = [], uv = [], nor = [], idx = [];
  let base = 0;
  for (const [rect, tl, tr, bl, br, n] of faces) {
    if (rect.w <= 0 && rect.h <= 0) continue;
    let u0 = rect.x / texW, u1 = (rect.x + rect.w) / texW;
    const v0 = rect.y / texH, v1 = (rect.y + rect.h) / texH;
    if (cube.mirror) [u0, u1] = [u1, u0];
    pos.push(...tl, ...tr, ...bl, ...br);
    uv.push(u0, v0, u1, v0, u0, v1, u1, v1);
    for (let i = 0; i < 4; i++) nor.push(...n);
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    base += 4;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function buildModel(model, material) {
  const root = new Group();
  const groups = {};
  const byName = Object.fromEntries(model.bones.map((b) => [b.name, b]));
  for (const b of model.bones) {
    const g = new Group();
    g.userData.bone = b;
    groups[b.name] = g;
    for (const c of b.cubes) {
      if (c.size.every((v) => v <= 0)) continue;
      const m = new Mesh(cubeGeometry(c, b.pivot, model.texW, model.texH), material);
      g.add(m);
    }
  }
  for (const b of model.bones) {
    const g = groups[b.name];
    const parent = b.parent && byName[b.parent] && b.parent !== b.name ? byName[b.parent] : null;
    const pp = parent ? parent.pivot : [0, 0, 0];
    g.userData.rest = [-(b.pivot[0] - pp[0]), b.pivot[1] - pp[1], b.pivot[2] - pp[2]];
    g.position.set(...g.userData.rest);
    (parent ? groups[parent.name] : root).add(g);
  }
  root.scale.setScalar(1 / 16);
  return { root, groups };
}

function applyPose(groups, pose) {
  for (const g of Object.values(groups)) {
    const b = g.userData.bone;
    const p = pose[b.name];
    const r = b.rotation || [0, 0, 0];
    const rx = r[0] + (p ? p.rot[0] : 0), ry = r[1] + (p ? p.rot[1] : 0), rz = r[2] + (p ? p.rot[2] : 0);
    g.rotation.copy(new Euler(-rx * D2R, -ry * D2R, rz * D2R, 'ZYX'));
    const rest = g.userData.rest;
    if (p) {
      g.position.set(rest[0] - p.pos[0], rest[1] + p.pos[1], rest[2] + p.pos[2]);
      g.scale.set(p.scale[0], p.scale[1], p.scale[2]);
    } else { g.position.set(...rest); g.scale.set(1, 1, 1); }
  }
}

export const PREVIEW_MODES = [
  ['idle', 'Idle'], ['walk', 'Walk'], ['attack', 'Attack'], ['hunt', 'Hunt'], ['fly', 'Fly'], ['swim', 'Swim'], ['still', 'Rest pose'],
];

export function Preview3D({ entity, mode = 'idle', custom = null, height = 260, autoRotate = true, texIdx = 0, highlight }) {
  const host = useRef(null);
  const ctx = useRef(null);
  const [failed, setFailed] = useState(false);
  const modelKey = JSON.stringify([entity.model.bones, entity.model.texW, entity.model.texH]);
  const texURL = entityTextureURL(entity, texIdx);

  useEffect(() => {
    let renderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) { setFailed(true); return undefined; }
    const el = host.current;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    const scene = new Scene();
    const camera = new PerspectiveCamera(35, 1, 0.05, 200);
    scene.add(new AmbientLight(0xffffff, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.3);
    sun.position.set(-3, 6, -5);
    scene.add(sun);
    const grid = new GridHelper(6, 6, 0x6b7280, 0x374151);
    grid.material.transparent = true; grid.material.opacity = 0.35;
    scene.add(grid);
    const tex = new Texture();
    tex.magFilter = NearestFilter; tex.minFilter = NearestFilter; tex.generateMipmaps = false;
    tex.flipY = false; tex.colorSpace = SRGBColorSpace;
    const material = new MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: FrontSide });
    const orbit = { yaw: Math.PI * 0.82, pitch: 0.28, dist: 4, target: [0, 1, 0], auto: true, lastTouch: 0 };
    const c = { renderer, scene, camera, tex, material, orbit, model: null, raf: 0, t0: performance.now(), dist: 0, el };
    ctx.current = c;

    const resize = () => {
      const w = el.clientWidth || 300, h = el.clientHeight || height;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(el);

    // Orbit / pinch controls.
    const pts = new Map();
    let pinch0 = 0, dist0 = 0;
    const cv = renderer.domElement;
    cv.style.touchAction = 'none';
    const down = (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); orbit.auto = false; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = orbit.dist; } };
    const move = (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) {
        orbit.yaw -= (e.clientX - prev[0]) * 0.012;
        orbit.pitch = Math.max(-0.2, Math.min(1.35, orbit.pitch + (e.clientY - prev[1]) * 0.01));
      } else if (pts.size === 2 && pinch0) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        orbit.dist = Math.max(1, Math.min(30, dist0 * (pinch0 / d)));
      }
    };
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0; orbit.lastTouch = performance.now(); };
    const wheel = (e) => { e.preventDefault(); orbit.dist = Math.max(1, Math.min(30, orbit.dist * (1 + Math.sign(e.deltaY) * 0.12))); };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });

    let last = performance.now();
    const loop = (now) => {
      c.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const t = (now - c.t0) / 1000;
      if (!orbit.auto && now - orbit.lastTouch > 4000 && pts.size === 0) orbit.auto = true;
      if (orbit.auto && c.autoRotate) orbit.yaw += dt * 0.35;
      const [tx, ty, tz] = orbit.target;
      camera.position.set(tx + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist, ty + Math.sin(orbit.pitch) * orbit.dist, tz + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist);
      camera.lookAt(tx, ty, tz);
      if (c.model) {
        const m = c.mode;
        const walking = m === 'walk' || m === 'hunt';
        if (walking) c.dist += dt * (m === 'hunt' ? 16 : 9);
        const attackCycle = (t % 1.4) / 0.35;
        const st = {
          time: t, dist: c.dist, speed: walking ? (m === 'hunt' ? 0.95 : 0.65) : 0,
          attack: m === 'attack' && attackCycle < 1 ? attackCycle : 0,
          tx: Math.sin(t * 0.9) * 12, ty: Math.sin(t * 0.6) * 35, hunting: m === 'hunt',
          air: m === 'fly', water: m === 'swim',
        };
        if (m === 'still') st.only = new Set();
        else if (c.custom) { st.only = new Set(['idle']); st.custom = c.custom; }
        else {
          const ambient = ['idle', 'look', 'twitch', 'hunch', 'float'];
          const kinds = { idle: [...ambient, 'fly', 'swim'], walk: ['walk', ...ambient], attack: ['attack', ...ambient], hunt: ['walk', 'reach', ...ambient], fly: ['fly', ...ambient], swim: ['swim', 'idle'] }[m] || ['idle'];
          st.only = new Set(kinds);
          if (m === 'idle') { st.air = true; st.water = true; }
        }
        applyPose(c.model.groups, evalPose(c.entity, st));
      }
      renderer.render(scene, camera);
    };
    c.raf = requestAnimationFrame(loop);
    c.cleanup = () => {
      cancelAnimationFrame(c.raf);
      ro?.disconnect();
      cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); cv.removeEventListener('wheel', wheel);
      renderer.dispose(); material.dispose(); tex.dispose();
      el.removeChild(cv);
    };
    return () => c.cleanup();
  }, []);

  // Rebuild meshes when the model changes.
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    if (c.model) {
      c.scene.remove(c.model.root);
      c.model.root.traverse((o) => o.geometry?.dispose());
    }
    c.model = buildModel(entity.model, c.material);
    c.scene.add(c.model.root);
    const { min, max } = modelBounds(entity.model);
    const hgt = (max[1] - min[1]) / 16, wid = Math.max(max[0] - min[0], max[2] - min[2]) / 16;
    c.orbit.target = [0, (min[1] + max[1]) / 32, 0];
    c.orbit.dist = Math.max(1.6, Math.max(hgt, wid) * 2.3);
  }, [modelKey]);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.entity = entity; c.mode = mode; c.custom = custom; c.autoRotate = autoRotate;
  });

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    let alive = true;
    loadImage(texURL).then((img) => { if (alive) { c.tex.image = img; c.tex.needsUpdate = true; } }).catch(() => {});
    return () => { alive = false; };
  }, [texURL]);

  if (failed) return <div class="preview fallback" style={{ height }}>3D preview needs WebGL, which this device doesn't support.</div>;
  return <div class="preview" ref={host} style={{ height }} />;
}

export function snapshot(hostEl) {
  const cv = hostEl?.querySelector('canvas');
  return cv ? cv.toDataURL('image/png') : null;
}
