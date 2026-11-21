// Records what the real behaviour script does in a staged place, tick by tick: where he is, every
// synchronised property, every particle and sound sent to an observer, every block he changes.
// The offline renderer replays these files with the shipped models, textures, animations,
// particle definitions and sounds.     node test/record.mjs [arrival|window|beam]
import fs from 'node:fs';
import path from 'node:path';
import { Sim } from './mock.mjs';
import { TERRAINS, PROPS } from '../tools/preview/scenes/terrain.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CODE = fs.readFileSync(path.join(ROOT, 'build/test-bundle.js'), 'utf8');
const TYPE = 'basiliskra:basiliskra';
const OW = 'minecraft:overworld';

function world(terrainName) {
  const sim = new Sim();
  sim.terrainFn = TERRAINS[terrainName];
  for (const p of PROPS[terrainName]) sim.save.edits.set(`${OW}|${p.x},${p.y},${p.z}`, p.id);
  globalThis.__MC__ = sim.api; new Function(CODE)(); const bk = globalThis.__BK__;
  sim.ev.worldLoad.fire({}); sim.flush();
  return { sim, bk, terrainName };
}

class Recorder {
  constructor(w, cam) {
    this.w = w; this.cam = cam; this.frames = []; this.particles = []; this.sounds = []; this.blocks = []; this.extras = [];
    this.t0 = w.sim.save.tick; this.seenAt = cam.seen.length; this.heardAt = cam.heard.length; this.last = {};
    w.sim.onBlock = (x, y, z, id) => this.blocks.push({ t: this.rel(), x, y, z, id });
  }
  rel() { return this.w.sim.save.tick - this.t0; }
  tick(extra = {}) {
    const { sim, bk } = this.w, t = this.rel();
    const e = [...sim.loaded.values()].find((x) => x.typeId === TYPE);
    const f = { t };
    if (e) {
      f.pos = [e.rec.loc.x, e.rec.loc.y, e.rec.loc.z]; f.yaw = e.rec.rot.y;
      const ch = {};
      for (const [k, v] of Object.entries(e.rec.props)) if (this.last[k] !== v) { ch[k] = v; this.last[k] = v; }
      if (Object.keys(ch).length) f.props = ch;
    }
    f.players = sim.players.filter((p) => p.online && p !== this.cam).map((p) => ({ name: p.name, pos: [p.loc.x, p.loc.y, p.loc.z] }));
    f.boats = [...sim.loaded.values()].filter((x) => x.typeId === 'minecraft:boat').map((b) => [b.rec.loc.x, b.rec.loc.y, b.rec.loc.z]);
    f.items = [...sim.loaded.values()].filter((x) => x.typeId === 'minecraft:item').map((b) => [b.rec.loc.x, b.rec.loc.y, b.rec.loc.z]);
    f.tod = sim.save.timeOfDay;
    Object.assign(f, extra);
    this.frames.push(f);
    for (; this.seenAt < this.cam.seen.length; this.seenAt++) { const s = this.cam.seen[this.seenAt]; this.particles.push({ t, id: s.id, pos: [s.loc.x, s.loc.y, s.loc.z], vars: s.vars }); }
    const before = this.sounds.length;
    for (; this.heardAt < this.cam.heard.length; this.heardAt++) { const s = this.cam.heard[this.heardAt]; this.sounds.push({ t, id: s.id, pos: s.location ? [s.location.x, s.location.y, s.location.z] : null, volume: s.volume ?? 1, pitch: s.pitch ?? 1 }); }
    // sounds played only to the player in the scene (his breath at the window): the camera stands beside them
    for (const ear of this.ears || []) {
      ear.at = ear.at ?? ear.p.heard.length;
      for (; ear.at < ear.p.heard.length; ear.at++) {
        const s = ear.p.heard[ear.at];
        if (this.sounds.slice(before).some((q) => q.id === s.id)) continue;
        this.sounds.push({ t, id: s.id, pos: s.location ? [s.location.x, s.location.y, s.location.z] : null, volume: s.volume ?? 1, pitch: s.pitch ?? 1 });
      }
    }
  }
  save(name, meta) {
    const out = path.join(ROOT, 'build/replays');
    fs.mkdirSync(out, { recursive: true });
    const edits = [...this.w.sim.save.edits.entries()].filter(([k]) => k.startsWith(OW)).map(([k, id]) => { const [x, y, z] = k.split('|')[1].split(',').map(Number); return { x, y, z, id }; });
    fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify({ name, terrain: this.w.terrainName, ticks: this.frames.length, ...meta, initialEdits: this.initial, frames: this.frames, particles: this.particles, sounds: this.sounds, blocks: this.blocks }));
    console.log(`${name}: ${this.frames.length} ticks (${(this.frames.length / 20).toFixed(1)} s), ${this.particles.length} particle packets, ${this.sounds.length} sounds, ${this.blocks.length} block changes`);
  }
}
const snapshotEdits = (w) => [...w.sim.save.edits.entries()].filter(([k]) => k.startsWith(OW)).map(([k, id]) => { const [x, y, z] = k.split('|')[1].split(',').map(Number); return { x, y, z, id }; });

/** Stand a ready-made Form III in the world through the same door a reload uses: a saved entity the record names. */
function formThree(w, at, yaw, beams = 0) {
  const { sim, bk } = w;
  const rec = bk.store.rec;
  Object.assign(rec, { stage: 'alive', token: 'previewtoken00000000000000000000', form: 3, born: 1, rift: { x: 400, y: 56, z: 400, yaw: 0 }, origin: { x: 400, y: 64, z: 380 } });
  rec.mut.beams = beams; rec.mut.formSince = sim.save.tick;
  const r = sim.newRecord(TYPE, OW, at, yaw);
  r.dyn['bk:token'] = rec.token; rec.entityId = r.id;
  bk.store.save();
  sim.attach(r, 'entityLoad'); sim.flush(); sim.step(3);
  return bk.ctl.creature;
}

const SCENES = {
  // The water: the rift opens.  Nothing here is staged except the place: the script does it all.
  arrival() {
    const w = world('bay'), { sim, bk } = w;
    const cam = sim.addPlayer('Cam', { x: -6, y: 64, z: 26 }); cam.mode = 'Creative';
    const ana = sim.addPlayer('Ana', { x: -6.2, y: 64, z: 28.6 });
    const boat = sim.summon('minecraft:boat', OW, { x: -9.7, y: 62.6, z: 27 }); boat.rec.family = ['boat'];
    for (let i = 0; i < 8; i++) { const f = sim.summon('minecraft:cod', OW, { x: -30 + i * 9, y: 55 + (i % 3), z: 50 + (i * 7) % 20 }); f.rec.family = ['fish']; }
    bk.ctl.requestArrival({ region: 'preview', site: { x: 0, y: 64, z: 10 }, guilty: ana.id, guiltyName: 'Ana' });
    sim.save.timeOfDay = 11700;
    for (let i = 0; i < 2000 && !(bk.store.rec.arrival && bk.store.rec.arrival.step >= 1); i++) sim.step(1);
    const rec = new Recorder(w, cam); rec.initial = snapshotEdits(w);
    for (let i = 0; i < 2400 && bk.store.rec.stage !== 'alive'; i++) { sim.step(1); rec.tick({ arrivalStep: bk.store.rec.arrival?.step ?? 7 }); }
    for (let i = 0; i < 80; i++) { sim.step(1); rec.tick({ arrivalStep: 7 }); }
    rec.save('arrival', { rift: bk.store.rec.rift, title: 'The rift opens' });
  },
  // The village: four footfalls, then one small eye level with the window.
  window() {
    const w = world('village'), { sim, bk } = w;
    const cam = sim.addPlayer('Cam', { x: 1.5, y: 64, z: 0.5 }); cam.mode = 'Creative';
    const ana = sim.addPlayer('Ana', { x: 0.5, y: 64, z: 0.5 });
    sim.save.timeOfDay = 15000;
    bk.store.rec.weather = 'rain';
    const c = formThree(w, { x: 68, y: 64, z: 6 }, 90);
    const rec = new Recorder(w, cam); rec.initial = snapshotEdits(w); rec.ears = [{ p: ana, at: ana.heard.length }];
    let seen = false, after = 0;
    for (let i = 0; i < 3200; i++) {
      sim.step(1);
      const ph = bk.ctl.creature?.phase;
      if (ph === 'window') seen = true;
      rec.tick({ act: bk.ctl.brain?.actName });
      if (seen && ph !== 'window' && ++after > 120) break;
    }
    rec.save('window', { title: 'Four footfalls', weather: 'rain' });
  },
  // The beam, and the beam interrupted: the second charge is led into a lightning rod.
  beam() {
    const w = world('village'), { sim, bk } = w;
    const cam = sim.addPlayer('Cam', { x: 30, y: 64, z: -30 }); cam.mode = 'Creative';
    const ana = sim.addPlayer('Ana', { x: 24, y: 64, z: -8 });
    sim.save.timeOfDay = 14000;
    const c = formThree(w, { x: 62, y: 64, z: -8 }, 90, 2);          // he has fired twice before: the focused beam
    const rec = new Recorder(w, cam); rec.initial = snapshotEdits(w);
    const brain = () => bk.ctl.brain;
    let fired = 0, grounded = false, dodged = false, rod = null, after = 0, lastPhase = '';
    for (let i = 0; i < 4000; i++) {
      sim.step(1);
      const cr = bk.ctl.creature, ph = cr.phase;
      const charge = cr.entity.getProperty('basiliskra:charge');
      // the player's part: stand, and step sideways once the eye stops following
      if (ph === 'charge' && fired === 0 && charge >= 16 && !dodged) { dodged = true; }
      if (dodged && fired === 0 && ana.loc.z < 1) ana.moveTo({ x: ana.loc.x, y: 64, z: ana.loc.z + 0.42 });
      if (ph === 'fire' && lastPhase !== 'fire') fired++;
      if (fired === 1 && ph === 'idle' && lastPhase === 'vent') { brain().cooldown.clear(); brain().recoverUntil = 0; }   // (preview only) skip the long recovery
      // second charge: a rod goes down beside the planted club
      if (fired === 1 && ph === 'charge' && !rod && charge >= 3) {
        const k = cr.anchor('club_core');
        rod = { x: Math.floor(k.x) + 2, y: 64, z: Math.floor(k.z) - 4 };
        sim.setBlock(OW, rod.x, rod.y, rod.z, 'minecraft:copper_block');
        sim.setBlock(OW, rod.x, rod.y + 1, rod.z, 'minecraft:lightning_rod');
        rod.y += 1;
      }
      if (ph === 'grounded') grounded = true;
      rec.tick({ act: brain()?.actName, rod });
      lastPhase = ph;
      if (grounded && ph !== 'grounded' && ++after > 110) break;
    }
    rec.save('beam', { title: 'Grounding the charge', fired, grounded });
  },
};

const which = process.argv.slice(2);
for (const n of (which.length ? which : Object.keys(SCENES))) SCENES[n]();
