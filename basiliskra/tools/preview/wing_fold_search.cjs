#!/usr/bin/env node
// Search the angles Basiliskra IV's left wing is folded by (added to its open rest pose, as the client animation adds
// them) for a fold that keeps every bone and membrane of the wing out of his trunk, arms, neck and head, and its bones
// behind his back.  Prints the best few.   node tools/preview/wing_fold_search.cjs
const { open } = require('./render.cjs');
(async () => {
  const s = await open();
  const best = await s.page.evaluate(async () => {
    const BK = window.BK, THREE = BK.THREE;
    const { resetPose, addPose } = await import('/tools/preview/lib/bedrock.js');
    await BK.loadForm('iv', { geo: '/packs/RP/models/entity/basiliskra_iv.geo.json', tex: '/packs/RP/textures/entity/basiliskra/basiliskra_iv.png', glow: null });
    const m = BK.models.iv;
    const geo = (await (await fetch('/packs/RP/models/entity/basiliskra_iv.geo.json')).json())['minecraft:geometry'][0];
    const D = Math.PI / 180;
    const fileRot = (rx, ry, rz) => new THREE.Matrix4().makeRotationZ(-rz * D).multiply(new THREE.Matrix4().makeRotationY(ry * D)).multiply(new THREE.Matrix4().makeRotationX(-rx * D));
    const cubes = [];
    for (const jb of geo.bones) {
      const pivot = jb.pivot || [0, 0, 0];
      for (const c of jb.cubes || []) {
        const lo = c.origin, hi = c.origin.map((v, i) => v + c.size[i]);
        const M = c.rotation ? fileRot(...c.rotation) : null, cp = c.pivot || pivot;
        const pts = [];
        for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
          const p = new THREE.Vector3(x, y, z);
          if (M) p.sub(new THREE.Vector3(...cp)).applyMatrix4(M).add(new THREE.Vector3(...cp));
          pts.push(new THREE.Vector3(-(p.x - pivot[0]), p.y - pivot[1], p.z - pivot[2]));
        }
        cubes.push({ bone: jb.name, pts, membrane: c.size[2] < 2 });
      }
    }
    const WING = /^wing_l(_arm|_f\d)?$/;
    const BODY = /^(body|hips|chest|neck1|neck2|head|jaw|arm_[lr]|forearm_[lr]|hand_[lr]|leg_[lr]|tail[123])$/;
    const wing = cubes.filter((c) => WING.test(c.bone)), body = cubes.filter((c) => BODY.test(c.bone));
    // (in model units: the viewer draws the model at 1/16)
    const world = (c) => { const g = m.bones.get(c.bone).group; return c.pts.map((p) => p.clone().applyMatrix4(g.matrixWorld).multiplyScalar(16)); };
    const box = (w) => { const o = w[0], ex = w[4].clone().sub(o), ey = w[2].clone().sub(o), ez = w[1].clone().sub(o); return { o, axes: [ex, ey, ez].map((e) => ({ u: e.clone().normalize(), len: e.length() })) }; };
    const depth = (p, b) => { const d = p.clone().sub(b.o); let least = 1e9; for (const { u, len } of b.axes) { const t = d.dot(u); least = Math.min(least, t, len - t); } return least; };
    resetPose(m); m.holder.updateMatrixWorld(true);
    const bodies = body.map((c) => box(world(c)));
    // the back of his chest (Blockbench z: his back is +z), and where his shoulder is
    const score = (f) => {
      resetPose(m);
      addPose(m.bones.get('wing_l'), [f.rx, f.ry, f.rz]);
      addPose(m.bones.get('wing_l_arm'), [0, f.ay, f.az]);
      f.fz.forEach((z, i) => addPose(m.bones.get(`wing_l_f${i + 1}`), [0, 0, z]));
      m.holder.updateMatrixWorld(true);
      let pen = 0, front = 0, low = 0, spread = 0;
      for (const c of wing) {
        const w = world(c);
        const pts = [...w];
        for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) pts.push(w[i].clone().add(w[j]).multiplyScalar(0.5));
        for (const p of pts) {
          for (const b of bodies) { const d = depth(p, b); if (d > 0) pen += d; }
          // the bones (not the membranes) must be behind his back: Blockbench z at least 40 (the chest's back is 58)
          if (!c.membrane && c.bone !== 'wing_l' && p.z < 40) front += 40 - p.z;
          if (p.y < 140) low += 140 - p.y;                                     // not trailing on the ground
          spread = Math.max(spread, Math.abs(p.x));
        }
      }
      return { pen, front, low, spread, cost: pen + 0.5 * front + 0.2 * low + 2 * Math.max(0, spread - 170) };
    };
    const results = [];
    const fz = [30, 14, 0, -14];
    for (const ry of [-30, -50, -70, -90, -110])
      for (const rz of [-50, -30, -14, 0, 20])
        for (const rx of [-30, 0, 30])
          for (const az of [90, 110, 130, 150, 165])
            for (const ay of [-50, -25, 0, 25, 50]) {
              const f = { rx, ry, rz, ay, az, fz };
              results.push({ f, ...score(f) });
            }
    results.sort((a, b) => a.cost - b.cost);
    const cur = score({ rx: 0, ry: -30, rz: -14, ay: 0, az: 118, fz });
    return { current: cur, top: results.slice(0, 12) };
  });
  await s.close();
  const fmt = (r) => `cost ${r.cost.toFixed(0).padStart(7)} pen ${r.pen.toFixed(0).padStart(6)} front ${r.front.toFixed(0).padStart(6)} low ${r.low.toFixed(0).padStart(5)} spread ${r.spread.toFixed(0)}`;
  console.log('current fold:', fmt(best.current));
  for (const r of best.top) console.log(fmt(r), JSON.stringify({ rx: r.f.rx, ry: r.f.ry, rz: r.f.rz, ay: r.f.ay, az: r.f.az }));
})().catch((e) => { console.error(e); process.exit(1); });
