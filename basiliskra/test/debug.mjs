import fs from 'node:fs';
import path from 'node:path';
import { Sim } from './mock.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CODE = fs.readFileSync(path.join(ROOT, 'build/test-bundle.js'), 'utf8');
const P = (n) => 'basiliskra:' + n;
export function makeFormThree() {
  const sim = new Sim();
  globalThis.__MC__ = sim.api; new Function(CODE)(); const bk = globalThis.__BK__;
  sim.ev.worldLoad.fire({}); sim.flush();
  const ana = sim.addPlayer('Ana', { x: 0, y: 64, z: 12 });
  bk.ctl.requestArrival({ region: 'd', site: { x: 0, y: 64, z: 12 }, guilty: ana.id, guiltyName: 'Ana' });
  sim.save.timeOfDay = 12000;
  for (let i = 0; i < 3000 && bk.store.rec.stage !== 'alive'; i++) sim.step(1);
  const c = bk.ctl.creature;
  c.pos = { x: 150, y: 64, z: 90 }; c.yaw = 90;
  ana.moveTo({ x: 150, y: 64, z: 60 });
  bk.ctl.brain.finish();
  bk.store.rec.evolve = { to: 3, step: 0, t0: sim.save.tick, at: null };
  for (let i = 0; i < 400 && bk.store.rec.evolve; i++) sim.step(1);
  return { sim, bk, ana };
}
if (process.argv[1].endsWith('debug.mjs')) {
  const { sim, bk, ana } = makeFormThree();
  const c = () => bk.ctl.creature;
  console.log('form', bk.store.rec.form, 'pos', c().pos, 'yaw', c().yaw);
  const fmt = (v) => `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
  console.log('rest anchors: mouth', fmt(c().anchor('mouth')), 'muzzle', fmt(c().anchor('muzzle')), 'throat', fmt(c().anchor('throat')), 'club', fmt(c().anchor('club_core')), 'foot_fl', fmt(c().anchor('foot_fl')), 'foot_br', fmt(c().anchor('foot_br')));
  // stand a target 24 blocks ahead-left of the mouth
  const f = { x: -Math.sin(c().yaw * Math.PI / 180), z: Math.cos(c().yaw * Math.PI / 180) };
  const tgt = { x: c().pos.x + f.x * 40 + f.z * 8, y: 64, z: c().pos.z + f.z * 40 - f.x * 8 };
  ana.moveTo(tgt);
  bk.ctl.brain.finish();
  let fired = false;
  for (let i = 0; i < 3000; i++) {
    sim.step(1);
    const e = c().entity;
    const ph = e.getProperty(P('phase'));
    if (ph === 18 && i % 20 === 0) console.log('charge', e.getProperty(P('charge')), 'look', e.getProperty(P('look_yaw')), e.getProperty(P('look_pitch')), 'act', bk.ctl.brain.actName, 'club', fmt(c().anchor('club_core')));
    if (ph === 19 && !fired) {
      fired = true;
      const { from, dir } = c().aim();
      const head = ana.getHeadLocation();
      const to = { x: head.x - from.x, y: head.y - from.y, z: head.z - from.z };
      const L = Math.hypot(to.x, to.y, to.z);
      const dotp = (to.x * dir.x + to.y * dir.y + to.z * dir.z) / L;
      console.log('FIRE from', fmt(from), 'dir', fmt(dir), 'target head', fmt(head), 'dist', L.toFixed(1), 'cos(angle)', dotp.toFixed(4), 'miss by', (L * Math.sqrt(1 - dotp * dotp)).toFixed(2), 'blocks; ana hp', ana.health);
    }
    if (fired && ph !== 19) { console.log('after fire ana hp', ana.health, 'beams', bk.store.rec.mut.beams); break; }
  }
  if (!fired) console.log('never fired; act', bk.ctl.brain.actName, 'phase', c().phase, 'dist', Math.hypot(ana.loc.x - c().pos.x, ana.loc.z - c().pos.z));
}
