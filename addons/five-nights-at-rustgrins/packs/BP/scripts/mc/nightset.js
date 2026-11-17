// How the pizzeria looks at night, and how it gets worse through the night and the week. Presentation
// only (nothing here touches the AI or the rules), and everything goes back as built at daybreak.
//
//   - dying lights: one footlight under the band still sputters, another blips; a few marquee bulbs on
//     the WELCOME arch stutter in the dark; pendant lamps, the backstage bulb and the work lamps sputter
//     now and then (never the halls by the office: those stay dark so the hall lights matter)
//   - the spare heads backstage (CAM 5) face the wall when the night starts, and while nobody is watching
//     CAM 5 they turn to the lens, one by one, until by 4 AM every face on the shelves is looking at you
//   - the writing on the walls (THE SHOW MUST GO ON, HE KNOWS YOUR NAME, the scratches) is only there at
//     night; by day the walls are clean
//   - chalk tally marks on the wall outside the left door: one more every night
//   - from night 3 some of the kids' drawings are different at night (empty black eyes, a too-wide
//     smile; faces at the office doors) - from night 4 the two in the office too
//   - 4 AM: the fog thickens
import { system } from '@minecraft/server';
import { WRITING } from '../data/palette.js';
import { runCmd, setLocal, setStateLocal, typeAtLocal } from './world_io.js';
import { log } from './log.js';

const HEAD_KEY = /^(head_(?:rustgrin|mirehop|noxbriar|cat|rat)|endo_skull)_([nsew])$/;
const DIRS = ['n', 'e', 's', 'w'];
const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };
/** The backstage (CAM 5's room): local x 1..13, z 1..13. */
const inBackstage = (x, z) => x >= 1 && x <= 13 && z >= 1 && z <= 13;
/** The drawings the night brings (drawing variants 6 and 7: see tools/blocks/surfaces/gen_panels.py). */
const NIGHT_DRAWINGS = [6, 7];
/** The two drawings pinned up in the office. */
const OFFICE_DRAWINGS = new Set(['32,3,61', '40,3,61']);
/** Chalk tally marks outside the left door: on the corner's west wall, facing the room. */
const TALLY = Object.freeze({ x: 26, y: 2, z0: 60, dir: 'e', max: 5 });
const FOG_LATE = Object.freeze({ push: 'fog @a push fnar:night_late fnar_late', pop: 'fog @a remove fnar_late' });

export class NightSet {
  /** @param {any} game the Game (plan, act, session, cams, rng) */
  constructor(game) {
    this.game = game;
    this.index();
    this.reset();
  }

  /** Find the heads, the writing and the drawings in the build plan, the dying lights in its metadata. */
  index() {
    /** @type {{ x: number, y: number, z: number, base: string, dir: string }[]} */
    this.heads = [];
    /** @type {{ x: number, y: number, z: number, key: string }[]} */
    this.writing = [];
    /** @type {{ x: number, y: number, z: number, key: string, dir: string, office: boolean }[]} */
    this.drawings = [];
    for (const ops of Object.values(this.game.plan.ops)) {
      for (const op of ops) {
        if (op[0] !== 'L') continue;
        const key = op[1];
        const list = op[2];
        const head = HEAD_KEY.exec(key);
        const isWriting = key.startsWith('pic:wall_writing:');
        const isDrawing = key.startsWith('pic:drawing:');
        if (!head && !isWriting && !isDrawing) continue;
        for (let i = 0; i < list.length; i += 3) {
          const [x, y, z] = [list[i], list[i + 1], list[i + 2]];
          if (head && inBackstage(x, z)) this.heads.push({ x, y, z, base: head[1], dir: head[2] });
          else if (isWriting) this.writing.push({ x, y, z, key });
          else if (isDrawing) this.drawings.push({ x, y, z, key, dir: key.split(':')[3], office: OFFICE_DRAWINGS.has(`${x},${y},${z}`) });
        }
      }
    }
    const meta = this.game.plan.meta;
    this.footlights = meta.spots.filter((s) => s.group === 'stage' && s.y === 0);
    this.bulbs = meta.hanging.filter((h) => h.group === 'foyer' && h.x === 64);
    this.sputter = meta.hanging.filter((h) => ['dining', 'backstage', 'midway', 'parts'].includes(h.group));
  }

  reset() {
    this.active = false;
    /** dying lights: { x, y, z, mostlyOn } */
    this.dying = [];
    this.flick = new Map(); // "x,y,z" -> tick it goes back
    /** heads that already turned to the lens tonight */
    this.turned = new Set();
    this.tallies = [];
    this.swapped = [];
    this.late = false;
    this.dark = false;
  }

  // ---------------------------------------------------------------- the night begins
  begin(night) {
    this.restore(false);
    this.active = true;
    const rng = this.game.rng;
    const n = Math.min(5, Math.max(1, night));
    // the writing is back on the walls
    for (const w of this.writing) this.place(w.x, w.y, w.z, w.key);
    // dying lights: one footlight that still works (sputtering), one that blips; a few marquee bulbs
    const feet = shuffle([...this.footlights], rng);
    if (feet[0]) this.dying.push({ ...feet[0], mostlyOn: true });
    if (feet[1]) this.dying.push({ ...feet[1], mostlyOn: false });
    for (const b of shuffle([...this.bulbs], rng).slice(0, 4)) this.dying.push({ ...b, mostlyOn: rng.chance(0.25) });
    for (const d of this.dying) this.lit(d, d.mostlyOn);
    // the heads backstage face the wall (or the side) when the night starts
    for (const h of this.heads) {
      const away = rng.chance(0.6) ? OPPOSITE[h.dir] : rng.pick(DIRS.filter((d) => d !== h.dir && d !== OPPOSITE[h.dir]));
      this.place(h.x, h.y, h.z, `${h.base}_${away}`);
    }
    // chalk tally marks outside the left door: one for every night you came back
    for (let i = 0; i < Math.min(TALLY.max, n); i++) {
      const z = TALLY.z0 + i;
      if (this.place(TALLY.x, TALLY.y, z, `pic:wall_writing:${WRITING.tally[0]}:${TALLY.dir}`, true)) this.tallies.push({ x: TALLY.x, y: TALLY.y, z });
    }
    // from night 3 some drawings are different at night; from night 4 the two in the office as well
    if (night >= 3) {
      for (const d of this.drawings) {
        const pick = d.office ? night >= 4 : rng.chance(0.3);
        if (!pick) continue;
        const v = NIGHT_DRAWINGS[rng.int(0, NIGHT_DRAWINGS.length - 1)];
        if (this.place(d.x, d.y, d.z, `pic:drawing:${v}:${d.dir}`)) this.swapped.push(d);
      }
    }
  }

  /** Everything as built. With `day`, the night's writing is washed off the walls too. */
  restore(day) {
    runCmd(FOG_LATE.pop);
    for (const d of this.dying) this.lit(d, false);
    for (const k of this.flick.keys()) {
      const [x, y, z] = k.split(',').map(Number);
      this.lit({ x, y, z }, false);
    }
    for (const h of this.heads) this.place(h.x, h.y, h.z, `${h.base}_${h.dir}`);
    for (const t of this.tallies) this.place(t.x, t.y, t.z, 'air');
    for (const d of this.swapped) this.place(d.x, d.y, d.z, d.key);
    if (day) for (const w of this.writing) this.place(w.x, w.y, w.z, 'air');
    this.reset();
  }

  /** The clock struck. */
  onHour(hour) {
    if (!this.active) return;
    if (hour >= 4 && !this.late) {
      this.late = true;
      runCmd(FOG_LATE.push);
    }
  }

  // ---------------------------------------------------------------- every tick of the night
  tick(now) {
    if (!this.active || now % 2 !== 0) return;
    const rng = this.game.rng;
    const s = this.game.session;
    if (!s) return;
    if (s.powerOut) {
      // the power is gone: so are the last lights that were still trying
      if (!this.dark) {
        this.dark = true;
        for (const d of this.dying) this.lit(d, false);
        for (const k of this.flick.keys()) {
          const [x, y, z] = k.split(',').map(Number);
          this.lit({ x, y, z }, false);
        }
        this.flick.clear();
      }
      return;
    }
    // lights going back after a stutter
    for (const [k, until] of [...this.flick]) {
      if (now < until) continue;
      this.flick.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      const dying = this.dying.find((d) => d.x === x && d.y === y && d.z === z);
      this.lit({ x, y, z }, dying ? dying.mostlyOn : false);
    }
    // the dying lights stutter
    for (const d of this.dying) {
      const k = `${d.x},${d.y},${d.z}`;
      if (this.flick.has(k) || !rng.chance(d.mostlyOn ? 0.05 : 0.025)) continue;
      this.lit(d, !d.mostlyOn);
      this.flick.set(k, now + 1 + rng.int(0, d.mostlyOn ? 3 : 2));
    }
    // now and then a dead lamp somewhere in the building catches for a moment
    if (this.sputter.length && rng.chance(0.006)) {
      const l = rng.pick(this.sputter);
      const k = `${l.x},${l.y},${l.z}`;
      if (!this.flick.has(k)) {
        this.lit(l, true);
        this.flick.set(k, now + 2 + rng.int(0, 4));
      }
    }
    if (now % 20 === 0) this.tickHeads(s, rng);
  }

  /** While CAM 5 is not live, the heads turn to the lens one by one: all of them by 4 AM. */
  tickHeads(s, rng) {
    if (this.turned.size >= this.heads.length) return;
    const watching = this.game.cams.active && s.devices.cams.cam === '5';
    if (watching) return;
    const progress = s.t / Math.max(1, s.def.ticksPerHour) / 4; // 0 at 12 AM, 1 at 4 AM
    const due = Math.min(this.heads.length, Math.floor(progress * this.heads.length));
    if (this.turned.size >= due) return;
    const left = this.heads.filter((h) => !this.turned.has(h));
    const h = rng.pick(left);
    this.turned.add(h);
    this.place(h.x, h.y, h.z, `${h.base}_${h.dir}`);
  }

  // ---------------------------------------------------------------- world helpers
  lit(p, on) {
    try {
      setStateLocal(p.x, p.y, p.z, 'fnar:lit', !!on);
    } catch {
      // ignore (chunk not loaded)
    }
  }

  /** Set a cell; with onlyAir, only where nothing is (so nothing built is ever overwritten). */
  place(x, y, z, key, onlyAir = false) {
    try {
      if (onlyAir && typeAtLocal(x, y, z) !== 'minecraft:air') return false;
      setLocal(x, y, z, key);
      return true;
    } catch (e) {
      log.warn(`night set ${key} at ${x},${y},${z}: ${e?.message ?? e}`);
      return false;
    }
  }
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
