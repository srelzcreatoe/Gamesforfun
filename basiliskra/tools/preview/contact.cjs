#!/usr/bin/env node
// Measures, on the shipped geometry and client animation (run in the offline viewer's Molang runtime):
//   Form III  how high each sole is, how far a planted sole slides, how many feet are down at once, tail club clearance
//   Form II   how far a planted foreclaw moves while the body is pulled past it, tail knob clearance
// Uses the scripted model timelines (tools/preview/model_replays.mjs).   node tools/preview/contact.cjs
const { open, ROOT } = require('./render.cjs');
const fs = require('fs'), path = require('path');
const FILES = { geo: '/packs/RP/models/entity/basiliskra_%.geo.json', tex: '/packs/RP/textures/entity/basiliskra/basiliskra_%.png', glow: '/packs/RP/textures/entity/basiliskra/basiliskra_%_glow.png',
  client: { entity: '/packs/RP/entity/basiliskra.entity.json', animations: ['/packs/RP/animations/basiliskra.animation.json'], controllers: ['/packs/RP/animation_controllers/basiliskra.animation_controllers.json'], renderControllers: ['/packs/RP/render_controllers/basiliskra.render_controllers.json'] } };

async function sample(name, seconds, locs) {
  const pf = fs.readdirSync(path.join(ROOT, 'packs/RP/particles')).filter((f) => f.endsWith('.json')).map((f) => '/packs/RP/particles/' + f);
  const s = await open();
  await s.page.evaluate(([n, pf, files]) => window.BK.openScene(n, pf, files), [name, pf, FILES]);
  const rows = await s.page.evaluate(([seconds, locs]) => {
    const P = window.BK.player, out = [];
    for (let t = 0; t < seconds; t += 1 / 60) {
      P.step(1 / 60);
      const r = { t: P.time, gait: P.props['basiliskra:gait'], phase: P.props['basiliskra:phase'], body: P.pos.toArray() };
      for (const l of locs) r[l] = P.loc(l).toArray();
      out.push(r);
    }
    return out;
  }, [seconds, locs]);
  await s.close();
  return rows;
}

(async () => {
  const report = {};
  { // Form III walking: 10 s at 2.8 blocks a second
    const feet = ['foot_fl', 'foot_fr', 'foot_bl', 'foot_br'];
    const rows = (await sample('model_iii', 9.6, [...feet, 'club_core', 'spike_tip_4', 'spike_tip_9'])).filter((r) => r.t > 4);   // after he is up to speed and the cycle has locked
    const G = 64, DOWN = 0.2;            // a sole within a fifth of a block of the ground is counted as planted
    const r3 = { lowestSole: 1e9, highestLift: 0, worstSlide: 0, meanSlide: 0, minDown: 4, downHist: [0, 0, 0, 0, 0], clubLowest: 1e9 };
    let slideN = 0;
    for (let i = 1; i < rows.length; i++) {
      let down = 0;
      for (const f of feet) {
        const a = rows[i - 1][f], b = rows[i][f];
        r3.lowestSole = Math.min(r3.lowestSole, b[1] - G); r3.highestLift = Math.max(r3.highestLift, b[1] - G);
        if (b[1] - G < DOWN) {
          down++;
          // slide is judged only while the sole is actually on the ground (within 0.03 of a block), not while it skims in to land
          if (a[1] - G < 0.03 && b[1] - G < 0.03) { const sl = Math.hypot(b[0] - a[0], b[2] - a[2]) * 60; if (process.env.CONTACT_DEBUG && sl > 0.6) console.log('slide', sl.toFixed(2), f, 't', rows[i].t.toFixed(3), 'y', (a[1] - G).toFixed(3), (b[1] - G).toFixed(3), 'dz', (b[2] - a[2]).toFixed(3), 'gait', rows[i - 1].gait, rows[i].gait); r3.worstSlide = Math.max(r3.worstSlide, sl); r3.meanSlide += sl; slideN++; }
        }
      }
      r3.minDown = Math.min(r3.minDown, down); r3.downHist[down]++;
      r3.clubLowest = Math.min(r3.clubLowest, rows[i].spike_tip_4[1] - G, rows[i].spike_tip_9[1] - G);
    }
    r3.meanSlide /= Math.max(1, slideN);
    r3.downHist = r3.downHist.map((n) => +(100 * n / (rows.length - 1)).toFixed(1));
    report.formIII = Object.fromEntries(Object.entries(r3).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v]));
  }
  { // Form II dragging: the planted claw during each pull
    const rows = await sample('model_ii', 11.8, ['claw_l', 'claw_r', 'knob_core', 'foot_l', 'foot_r']);
    const G = 64;
    const r2 = { pulls: 0, worstClawTravel: 0, meanClawTravel: 0, bodyTravelPerPull: 0, clawLowest: 1e9, knobLowest: 1e9 };
    let start = null;
    for (let i = 1; i < rows.length; i++) {
      const g = rows[i].gait, pulling = g === 1 || g === 4, claw = g === 1 ? 'claw_l' : 'claw_r';
      r2.clawLowest = Math.min(r2.clawLowest, rows[i].claw_l[1] - G, rows[i].claw_r[1] - G);
      r2.knobLowest = Math.min(r2.knobLowest, rows[i].knob_core[1] - G);
      if (pulling && !start) start = { claw, at: rows[i][claw], body: rows[i].body };
      if (!pulling && start) {
        const end = rows[i - 1][start.claw], d = Math.hypot(end[0] - start.at[0], end[2] - start.at[2]);
        r2.pulls++; r2.worstClawTravel = Math.max(r2.worstClawTravel, d); r2.meanClawTravel += d;
        r2.bodyTravelPerPull += Math.hypot(rows[i - 1].body[0] - start.body[0], rows[i - 1].body[2] - start.body[2]);
        start = null;
      }
    }
    r2.meanClawTravel /= Math.max(1, r2.pulls); r2.bodyTravelPerPull /= Math.max(1, r2.pulls);
    report.formII = Object.fromEntries(Object.entries(r2).map(([k, v]) => [k, +v.toFixed(3)]));
  }
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'build/contact.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
