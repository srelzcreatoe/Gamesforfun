#!/usr/bin/env node
// Do Basiliskra IV's wings pass through his body?  Plays the shipped client pose (the offline viewer's Molang runtime)
// through every phase he has, and at each sampled moment tests points spread over every wing cube (the wing's arm,
// fingers and membranes) against every cube of his body (trunk, plates, neck, head, arms, legs, tail).  Prints, per
// phase, how many wing points were inside him and the deepest (in model units), and where.
//   node tools/preview/wing_check.cjs [--client titan] [--json out.json]
const { open, ROOT, arg } = require('./render.cjs');
const fs = require('fs');
const path = require('path');

const POSE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/kit/out/pose.json'), 'utf8'));
const titan = arg(process.argv, 'client', '') === 'titan';
const CLIENT = {
  entity: titan ? '/packs/RP/entity/basiliskra_titan.entity.json' : '/packs/RP/entity/basiliskra.entity.json',
  animations: ['/packs/RP/animations/basiliskra.animation.json'],
  controllers: ['/packs/RP/animation_controllers/basiliskra.animation_controllers.json'],
  renderControllers: ['/packs/RP/render_controllers/basiliskra.render_controllers.json'],
};
// what he is made to do: phase, seconds, and the properties the script would set with it
const SEGS = [
  { phase: 'idle', t: 3 },
  { phase: 'move', t: 6, speed: 3.2 },
  { phase: 'stare', t: 3, look: [40, 15] },
  { phase: 'roar', t: 4, fx: 9 },
  { phase: 'charge', t: 7, charge: [0, 18] },
  { phase: 'pour', t: 2, charge: 20 },
  { phase: 'fire', t: 4, charge: 20 },
  { phase: 'skid', t: 2, charge: 20 },
  { phase: 'pivot', t: 2.5, charge: 20, bend: 30 },
  { phase: 'pivot', t: 2.5, charge: 20, bend: -30 },
  { phase: 'recoil', t: 3, charge: 20 },
  { phase: 'vent', t: 3 },
  { phase: 'swallow', t: 2 },
  { phase: 'carry', t: 3, speed: 2 },
  { phase: 'drag', t: 6 },
  { phase: 'bite', t: 1.6 },
  { phase: 'sweep', t: 2, look: [60, 0] },
  { phase: 'sweep', t: 2, look: [-60, 0] },
  { phase: 'swipe', t: 1.8, look: [30, 0] },
  { phase: 'swipe', t: 1.8, look: [-30, 0] },
  { phase: 'rise', t: 3 },
  { phase: 'evolve', t: 3 },
  { phase: 'grounded', t: 2 },
  { phase: 'scatter', t: 2 },
  { phase: 'fall', t: 3 },
  { phase: 'move', t: 4, speed: 3.2, look: [60, -20] },
  { phase: 'charge', t: 4, charge: 18, look: [-50, -40] },
];

(async () => {
  const s = await open();
  const rows = await s.page.evaluate(async ({ client, SEGS, PH }) => {
    const BK = window.BK, THREE = BK.THREE;
    await BK.loadForm('iv', { geo: '/packs/RP/models/entity/basiliskra_iv.geo.json', tex: '/packs/RP/textures/entity/basiliskra/basiliskra_iv.png', glow: null });
    await BK.makeAnimator('iv', client);
    const m = BK.models.iv, a = m.animator;
    const geo = (await (await fetch('/packs/RP/models/entity/basiliskra_iv.geo.json')).json())['minecraft:geometry'][0];
    const D = Math.PI / 180;
    const fileRot = (rx, ry, rz) => new THREE.Matrix4().makeRotationZ(-rz * D).multiply(new THREE.Matrix4().makeRotationY(ry * D)).multiply(new THREE.Matrix4().makeRotationX(-rx * D));
    // every cube as 8 corners in its bone's (Blockbench-space) frame
    const cubes = [];
    for (const jb of geo.bones) {
      const pivot = jb.pivot || [0, 0, 0];
      for (const c of jb.cubes || []) {
        const inf = c.inflate || 0;
        const lo = c.origin.map((v) => v - inf), hi = c.origin.map((v, i) => v + c.size[i] + inf);
        const M = c.rotation ? fileRot(...c.rotation) : null, cp = c.pivot || pivot;
        const pts = [];
        for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
          const p = new THREE.Vector3(x, y, z);
          if (M) p.sub(new THREE.Vector3(...cp)).applyMatrix4(M).add(new THREE.Vector3(...cp));
          pts.push(new THREE.Vector3(-(p.x - pivot[0]), p.y - pivot[1], p.z - pivot[2]));
        }
        cubes.push({ bone: jb.name, pts, size: c.size });
      }
    }
    const isWing = (b) => /^wing_[lr]_(arm|f\d)$/.test(b);            // the root bone sits on his back by design
    const isBody = (b) => !b.startsWith('wing_') && !/^(spike|eye_|gill_)/.test(b);
    const wingCubes = cubes.filter((c) => isWing(c.bone)), bodyCubes = cubes.filter((c) => isBody(c.bone));
    const world = (c) => { const g = m.bones.get(c.bone).group; return c.pts.map((p) => p.clone().applyMatrix4(g.matrixWorld)); };
    // a body cube as an oriented box: corner 0 and its three edges
    const box = (w) => {
      const o = w[0], ex = w[4].clone().sub(o), ey = w[2].clone().sub(o), ez = w[1].clone().sub(o);
      return { o, axes: [ex, ey, ez].map((e) => ({ u: e.clone().normalize(), len: e.length() })) };
    };
    // how deep a point is inside a box (negative: outside)
    const depth = (p, b) => {
      const d = p.clone().sub(b.o);
      let least = 1e9;
      for (const { u, len } of b.axes) { const t = d.dot(u); least = Math.min(least, t, len - t); }
      return least;
    };
    const props = { form: 4, bound: true, phase: 0, charge: 0, look_yaw: 0, look_pitch: 0, bend: 0, pitch: 0, gait: 1, gill: false, fx_kind: 0, fx_seq: 0, tier: 3, vis_lo: 0, vis_hi: 8 };
    for (const [k, v] of Object.entries(props)) a.setProperty('basiliskra:' + k, v);
    for (let i = 0; i < 30; i++) a.update(1 / 30);
    const out = [];
    let distance = 0, seq = 0;
    for (const sg of SEGS) {
      const n = Math.round(sg.t * 30);
      let hits = 0, worst = 0, where = '', samples = 0;
      a.setProperty('basiliskra:phase', PH[sg.phase]);
      a.setProperty('basiliskra:bend', sg.bend || 0);
      a.setProperty('basiliskra:look_yaw', sg.look ? sg.look[0] : 0);
      a.setProperty('basiliskra:look_pitch', sg.look ? sg.look[1] : 0);
      if (sg.fx) { seq = (seq + 1) & 15; a.setProperty('basiliskra:fx_kind', sg.fx); a.setProperty('basiliskra:fx_seq', seq); }
      for (let f = 0; f < n; f++) {
        const u = f / Math.max(1, n - 1);
        const ch = Array.isArray(sg.charge) ? sg.charge[0] + (sg.charge[1] - sg.charge[0]) * u : sg.charge || 0;
        a.setProperty('basiliskra:charge', Math.round(ch));
        distance += (sg.speed || 0) / 30;
        a.state.distance = distance; a.state.speed = (sg.speed || 0) / 20;
        if (sg.speed && Math.floor(distance / 9.8) !== Math.floor((distance - sg.speed / 30) / 9.8)) a.setProperty('basiliskra:gait', 1 - (a.props['basiliskra:gait'] ?? 0));
        a.update(1 / 30);
        if (f % 3) continue;
        m.holder.updateMatrixWorld(true);
        samples++;
        const bodies = bodyCubes.map((c) => ({ c, b: box(world(c)) }));
        for (const wc of wingCubes) {
          const w = world(wc);
          // corners, the middles of the edges and faces, and the centre
          const pts = [...w];
          for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) pts.push(w[i].clone().add(w[j]).multiplyScalar(0.5));
          for (const { c, b } of bodies) {
            for (const p of pts) {
              const d = depth(p, b);
              if (d > 0.5) { hits++; if (d > worst) { worst = d; where = `${wc.bone} in ${c.bone}`; } }
            }
          }
        }
      }
      out.push({ phase: sg.phase, look: sg.look, bend: sg.bend, samples, hits, worst: +worst.toFixed(1), where });
    }
    return out;
  }, { client: CLIENT, SEGS, PH: POSE.phase });
  await s.close();
  for (const r of rows) console.log(`${r.phase.padEnd(9)} ${JSON.stringify(r.look ?? '').padEnd(10)} ${String(r.bend ?? '').padEnd(4)} ${r.hits ? `${String(r.hits).padStart(6)} points inside, deepest ${r.worst} units (${r.where})` : 'clear'}`);
  const j = arg(process.argv, 'json', null);
  if (j) fs.writeFileSync(j, JSON.stringify(rows, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
