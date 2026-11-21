import { makeFormThree } from './debug.mjs';
const P = (n) => 'basiliskra:' + n;
const { sim, bk, ana } = makeFormThree();
const c = () => bk.ctl.creature;
const fmt = (v) => v ? `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})` : 'null';
const f = { x: -Math.sin(c().yaw * Math.PI / 180), z: Math.cos(c().yaw * Math.PI / 180) };
ana.moveTo({ x: c().pos.x + f.x * 38, y: 64, z: c().pos.z + f.z * 38 });
bk.ctl.brain.finish();
let rod = null;
for (let i = 0; i < 3000; i++) {
  sim.step(1);
  const e = c().entity, ph = e.getProperty(P('phase'));
  if (ph === 18 && !rod) {
    const k = c().anchor('club_core');
    rod = { x: Math.floor(k.x) + 4, y: Math.floor(c().pos.y), z: Math.floor(k.z) };
    sim.setBlock('minecraft:overworld', rod.x, rod.y, rod.z, 'minecraft:lightning_rod');
    console.log('rod placed', fmt(rod), 'club', fmt(k), 'pos', fmt(c().pos), 'block there now', sim.blockId('minecraft:overworld', rod.x, rod.y, rod.z));
  }
  if (ph === 18 && i % 15 === 0) console.log('t', i, 'charge', e.getProperty(P('charge')), 'findRod', fmt(bk.ctl.brain.findRod()), 'clubTop', fmt(bk.ctl.brain.clubTop()));
  if (ph === 21) { console.log('GROUNDED at', i); break; }
  if (ph === 19) { console.log('FIRED at', i, 'findRod', fmt(bk.ctl.brain.findRod())); break; }
}
