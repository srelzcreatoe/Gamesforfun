/**
 * (On the shots: a shot's distance is from what it looks at, and he is long.  From in front or behind, look at his
 * head, not his middle, or the camera stands inside his neck; from the side, keep more than his half-width off.)
 */
/**
 * His three changes.  Each is a scene of its own: what happens to him, what it does to the place, what is heard,
 * and where the camera stands are different every time, built out of what that form already is.
 *
 *   I  -> II   the water boils.   His gills knock three times and jam; the sea round him seethes; he rears out of it,
 *                                 his fin tears away in a column of steam, and what hauls itself up has horns, and
 *                                 lightning between them for the first time (three arcs, on the beat of the knocks).
 *   II -> III  the sky comes down. Three bolts find his horns, each sooner than the last, each lighting more of him;
 *                                 a fourth, and he is standing on four legs with the charge running to ground through
 *                                 his club.  Then his plates light one by one from the tail, and he shakes them out.
 *   III -> IV  he burns through.   He charges his breath at nothing and it will not leave him: the vent fails, the
 *                                 ground under him starts to glow, his whole hide flickers.  Then white; then a dark
 *                                 shape in smoke with the fire shut inside it; and then the wings come open.
 *
 * A scene is two timelines, one for the animal he was and one for the animal he is, with one instant between
 * them.  The controller owns the record and the body; everything here is only seen and heard (and, where the
 * settings allow his fallout to change the land, a little glass in the ground).
 */
import { MolangVariableMap } from "@minecraft/server";
import type { Creature } from "./creature";
import { glassify } from "./fallout";
import { beamVars, flash, particle, sizeVars, sound } from "./fx";
import { RIGS } from "./generated/rig";
import { blast } from "./havoc";
import { shake } from "./roar";
import type { Shot } from "./scene";
import { hash, norm, sub, dist, type V3 } from "./vec";
import { groundY, idAt, isWaterId } from "./world";

export interface Change {
  /** Ticks of the animal he was, and of the animal he is, before the story goes on. */
  before: number;
  after: number;
  /** How long the camera stays after that (for the roar that follows; none follows the last change). */
  hold: number;
  /** When, after the instant of the change, his new name is shown. */
  nameAt: number;
  /** What the screen flashes at that instant: colour, and seconds held and fading. */
  flash: { red: number; green: number; blue: number; hold: number; fade: number };
  shots(c: Creature, Fo: number, Fn: number): Shot[];
  /** Each tick of the build-up, from 0. */
  pre(c: Creature, t: number): void;
  /** The instant itself (he is still the animal he was). */
  burst(c: Creature): void;
  /** Each tick after it, from 0 (he is the new animal). */
  post(c: Creature, t: number): void;
}

// ---- small tools ---------------------------------------------------------------------------------------------
/** A named place on him, if this form has it; else the middle of him. */
function at(c: Creature, name: string, up = 0): V3 {
  try {
    if (name in RIGS[c.form].locators) { const p = c.anchor(name); return { x: p.x, y: p.y + up, z: p.z }; }
  } catch { /* a form without it */ }
  const m = c.middle();
  return { x: m.x, y: m.y + up, z: m.z };
}
const head = (c: Creature) => (): V3 => at(c, "nose");
const body = (c: Creature) => (): V3 => c.middle();

/** A point on a ring round him, at the height given. */
function ringAt(c: Creature, r: number, a: number, y: number): V3 {
  return { x: c.pos.x + Math.cos(a) * r, y, z: c.pos.z + Math.sin(a) * r };
}
/** The ground at a place near him (his own footing if it cannot be read). */
function floorAt(c: Creature, x: number, z: number): number {
  const g = groundY(c.dim, x, z, c.pos.y + 8, 24);
  return typeof g === "number" ? g : c.pos.y;
}
/** The top of the water he is in (his own height if he is not in any). */
function surface(c: Creature): number {
  let y = Math.floor(c.pos.y);
  for (let k = 0; k < 16; k++) {
    if (!isWaterId(idAt(c.dim, { x: c.pos.x, y: y + 1, z: c.pos.z }))) break;
    y++;
  }
  return y + 1;
}

function reachVars(reach: number): MolangVariableMap {
  const m = new MolangVariableMap();
  m.setFloat("variable.reach", reach);
  return m;
}

/** A bolt out of the sky onto a place on him: drawn in his own red, heard as thunder, and every screen near flashes. */
function bolt(c: Creature, to: V3, seed: number, big = false): void {
  const from = { x: to.x + (hash(seed, 1) - 0.5) * 14, y: to.y + 70, z: to.z + (hash(seed, 2) - 0.5) * 14 };
  const d = norm(sub(to, from)), L = dist(from, to);
  particle(c.dim, "basiliskra:beam_core", from, 224, beamVars(d, L, big ? 0.9 : 0.5));
  particle(c.dim, "basiliskra:beam_halo", from, 224, beamVars(d, L, big ? 2.6 : 1.5));
  particle(c.dim, "basiliskra:beam_arc", from, 192, beamVars(d, L, big ? 1.6 : 1.0));
  particle(c.dim, "basiliskra:impact_glare", to, 192);
  particle(c.dim, "basiliskra:horn_arc_big", to, 128);
}
function thunder(c: Creature, to: V3, seed: number, big = false): void {
  sound(c.dim, "ambient.weather.thunder", to, 192, big ? 2 : 1.4, (big ? 0.6 : 0.85) + hash(seed, 3) * 0.2);
  sound(c.dim, "ambient.weather.lightning.impact", to, 128, 1.2, 0.8 + hash(seed, 4) * 0.2);
  flash(c.dim, to, 150, { red: 1, green: 0.88, blue: 0.84 }, 0.02, big ? 0.1 : 0.05, big ? 0.6 : 0.3);
}

/** A few blocks of the ground under and round him turn to his glass (only where his fallout may change the land). */
function scar(c: Creature, r: number, n: number, seed: number): void {
  for (let k = 0; k < n; k++) {
    const a = hash(seed, k, 5) * Math.PI * 2, d = Math.sqrt(hash(seed, k, 6)) * r;
    const x = c.pos.x + Math.cos(a) * d, z = c.pos.z + Math.sin(a) * d;
    const y = floorAt(c, x, z);
    if (glassify(c.dim, { x, y: y - 1, z })) particle(c.dim, "basiliskra:impact_fire", { x, y: y + 0.2, z }, 96);
  }
}

// ---- I -> II: the water boils ---------------------------------------------------------------------------------
const KNOCKS = [0, 18, 36];
let top = 0;                 // the water's surface, read now and then
const ONE: Change = {
  before: 176, after: 134, hold: 90, nameAt: 0,
  flash: { red: 0.92, green: 0.9, blue: 0.95, hold: 0.14, fade: 1.0 },
  shots: (c, Fo, Fn) => [
    // his gills, from beside his head, as they knock
    { ticks: 54, look: head(c), angle: [72, 96], dist: [Fo * 0.3 + 2, Fo * 0.26 + 2], height: [2.5, 3.5] },
    // straight down on the sea seething round him
    { ticks: 66, look: body(c), angle: 0, dist: 1.5, height: [Fo * 0.9, Fo * 1.25] },
    // low over the water in front of him as he rears out of it
    { ticks: 56, look: head(c), angle: [-25, 10], dist: [Fo * 0.75, Fo * 0.5], height: [1.5, 2.5] },
    // what is left when the steam goes
    { ticks: 44, look: body(c), angle: [42, 66], dist: [Fn * 0.9, Fn * 1.2], height: [Fn * 0.15, Fn * 0.3] },
    // his horns, and what jumps between them
    { ticks: 56, look: () => at(c, "horn_l"), angle: [22, -22], dist: [Fn * 0.34, Fn * 0.3], height: [1.5, 2.5] },
    // his face, for the roar
    { ticks: 34 + 90, look: head(c), angle: [15, 5], dist: [Fn * 0.5, Fn * 0.4], height: [-1, -0.5] },
  ],
  pre(c, t) {
    if (t === 0 || t % 20 === 0) top = surface(c);
    if (t === 0) c.setPhase("knock");
    // three knocks on the gills, as on the night he came; this time they do not open again
    if (KNOCKS.includes(t)) {
      c.say("basiliskra.knock.gill", at(c, "gill_l"), 96, 1, 1 - KNOCKS.indexOf(t) * 0.04);
      c.pulse(1);
      for (const g of ["gill_l", "gill_r"]) { particle(c.dim, "basiliskra:gill_bubbles", at(c, g), 64); particle(c.dim, "basiliskra:gill_silt", at(c, g), 64); }
    }
    if (t === 54) { c.setPhase("spasm"); c.say("basiliskra.i.spasm", c.pos, 96); c.say("basiliskra.i.gill_catch", at(c, "gill_l"), 80); }
    if (t === 120) {
      c.setPhase("rise");
      c.say("basiliskra.i.surface", { x: c.pos.x, y: top, z: c.pos.z }, 112);
      particle(c.dim, "basiliskra:surge_spray", { x: c.pos.x, y: top, z: c.pos.z }, 128);
      particle(c.dim, "basiliskra:fin_splash", at(c, "fin_l"), 96);
    }
    if (t === 150) { c.setPhase("evolve"); c.say("basiliskra.mutate", c.pos, 96); }
    // the light climbs him in two steps: with the spasm, then with the throes
    c.setCharge(t < 54 ? 0 : t < 150 ? ((t - 54) / 96) * 10 : 10 + ((t - 150) / 26) * 10);
    // the sea round him: a ring of it boiling, wider and harder all the time
    const r = 3 + t * 0.06;
    if (t % 3 === 0) {
      for (let k = 0; k < 2 + Math.floor(t / 60); k++) {
        const a = hash(t, k, 11) * Math.PI * 2, d = r * (0.4 + 0.6 * hash(t, k, 12));
        particle(c.dim, "basiliskra:splash", ringAt(c, d, a, top), 96);
        particle(c.dim, "basiliskra:bubble_trail", ringAt(c, d, a, top - 1.5), 64);
      }
    }
    if (t >= 54 && t % 5 === 0) particle(c.dim, "basiliskra:gill_steam", ringAt(c, r * hash(t, 13), hash(t, 14) * 6.28, top + 0.4), 112);
    if (t >= 54 && t % 12 === 0) for (const f of ["fin_l", "fin_r"]) particle(c.dim, "basiliskra:fin_spark", at(c, f), 80);
    if (t >= 100 && t % 8 === 0) sound(c.dim, "random.fizz", { x: c.pos.x, y: top, z: c.pos.z }, 80, 0.9, 0.6 + hash(t, 15) * 0.3);
    if (t >= 150 && t % 6 === 0) particle(c.dim, "basiliskra:mutate_gather", c.middle(), 160, sizeVars(6));
    if (t % 20 === 0) shake(c, 80, 0.1 + 0.4 * (t / 176), 1.0);
  },
  burst(c) {
    top = surface(c);
    const mid = { x: c.pos.x, y: top, z: c.pos.z };
    // his fin goes, and the sea goes up with it: a column of steam and thrown water
    for (const f of ["fin_l", "fin_r"]) particle(c.dim, "basiliskra:fin_break", at(c, f), 128);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      particle(c.dim, "basiliskra:impact_fountain", ringAt(c, 3.5, a, top), 160);
      particle(c.dim, "basiliskra:surge_spray", ringAt(c, 6, a + 0.3, top), 128);
    }
    for (let h = 0; h < 6; h++) particle(c.dim, "basiliskra:gill_steam", { x: mid.x, y: top + h * 2.5, z: mid.z }, 160);
    particle(c.dim, "basiliskra:mutate_burst", c.middle(), 200);
    sound(c.dim, "random.fizz", mid, 128, 2, 0.45);
    sound(c.dim, "basiliskra.splash", mid, 128, 1.5, 0.6);
    shake(c, 96, 1.0, 0.7);
  },
  post(c, t) {
    if (t === 0) { c.setPhase("beach"); c.say("basiliskra.mutate", c.pos, 96, 1, 0.9); }
    // steam hangs over where it happened, and what he shed comes down
    if (t < 70 && t % 4 === 0) particle(c.dim, "basiliskra:gill_steam", ringAt(c, 5 * hash(t, 21), hash(t, 22) * 6.28, c.pos.y + 1 + 3 * hash(t, 23)), 112);
    if (t < 60 && t % 10 === 0) particle(c.dim, "basiliskra:shed_flakes", c.middle(), 96);
    c.setCharge(t < 44 ? 20 - (t / 44) * 14 : Math.max(0, 6 - (t - 44) * 0.07));
    // lightning between his horns, for the first time: three arcs, on the beat of the three knocks
    const k = [44, 62, 80].indexOf(t);
    if (k >= 0) {
      if (k === 0) c.setPhase("arc");
      c.say("basiliskra.ii.arc", at(c, "horn_l"), 112, 1, 1 + k * 0.06);
      c.pulse(2);
      for (const h of ["horn_l", "horn_r"]) particle(c.dim, "basiliskra:horn_arc_big", at(c, h), 112);
      flash(c.dim, c.pos, 60, { red: 1, green: 0.8, blue: 0.82 }, 0.02, 0.03, 0.2);
    }
    if (t === 104) c.setPhase("idle");
  },
};

// ---- II -> III: the sky comes down ----------------------------------------------------------------------------
const STRIKES = [50, 100, 140];
const TWO: Change = {
  before: 200, after: 150, hold: 120, nameAt: 0,
  flash: { red: 1, green: 0.94, blue: 0.9, hold: 0.16, fade: 0.9 },
  shots: (c, Fo, Fn) => [
    // from beside his shoulder and below, up past his horns at the sky the first bolt comes out of
    { ticks: 58, look: () => at(c, "horn_l", 6), angle: [146, 158], dist: [Fo * 0.8, Fo * 0.72], height: [-5, -4] },
    // straight down on him, coming closer, as the second lands
    { ticks: 50, look: body(c), angle: 90, dist: 2, height: [Fo * 1.3, Fo * 0.9] },
    // his face, close, for the third
    { ticks: 52, look: head(c), angle: [60, 40], dist: [Fo * 0.4, Fo * 0.32], height: [1, 0.5] },
    // all of him, low, as it takes hold
    { ticks: 40, look: head(c), angle: [-32, -12], dist: [Fo * 0.9, Fo * 0.6], height: [0.5, 1.5] },
    // what stands there afterwards, with the charge running out through his club
    { ticks: 34, look: body(c), angle: [-56, -40], dist: [Fn * 0.95, Fn * 1.1], height: [-Fn * 0.08, Fn * 0.05] },
    // along his back from the tail, as the plates light one by one
    { ticks: 76, look: () => at(c, "plate_tip_5"), angle: [165, 195], dist: [Fn * 0.75, Fn * 0.6], height: [Fn * 0.3, Fn * 0.22] },
    // his face: he shakes the fire out of his plates, and roars
    { ticks: 40 + 120, look: head(c), angle: [28, 8], dist: [Fn * 0.5, Fn * 0.4], height: [-Fn * 0.1, -Fn * 0.06] },
  ],
  pre(c, t) {
    if (t === 0) { c.setPhase("arc"); c.say("basiliskra.ii.arc", at(c, "horn_l"), 112); }
    if (t > 0 && t < 150 && t % 30 === 0 && !STRIKES.includes(t)) c.say("basiliskra.ii.arc", at(c, "horn_r"), 96, 0.7, 1.1);
    // dust is drawn in toward him along the ground
    if (t % 4 === 0) {
      const a = hash(t, 31) * Math.PI * 2, r = 12 - (t % 40) * 0.2;
      const p = ringAt(c, r, a, 0);
      particle(c.dim, hash(t, 32) < 0.5 ? "basiliskra:step_dust" : "basiliskra:grit", { x: p.x, y: floorAt(c, p.x, p.z) + 0.3, z: p.z }, 96);
    }
    const k = STRIKES.indexOf(t);
    if (k >= 0) {
      const to = at(c, k === 1 ? "horn_r" : "horn_l");
      bolt(c, to, t);
      thunder(c, to, t);
      c.setPhase("flinch");
      c.pulse(3);
      c.setCharge(6 * (k + 1));
      shake(c, 120, 0.9, 0.5);
      particle(c.dim, "basiliskra:shock_ring", { x: c.pos.x, y: c.pos.y + 0.3, z: c.pos.z }, 128);
      particle(c.dim, "basiliskra:impact_ring", { x: c.pos.x, y: c.pos.y + 0.3, z: c.pos.z }, 128);
      scar(c, 4, 2, t);
    }
    // the bolt is drawn for a few ticks, as lightning is seen
    for (const s of STRIKES) if (t === s + 1 || t === s + 3) bolt(c, at(c, STRIKES.indexOf(s) === 1 ? "horn_r" : "horn_l"), s);
    for (const s of STRIKES) if (t === s + 12) c.setPhase("arc");
    if (t === 160) { c.setPhase("evolve"); c.say("basiliskra.mutate", c.pos, 96); }
    if (t >= 160) { c.setCharge(18 + ((t - 160) / 40) * 2); if (t % 6 === 0) particle(c.dim, "basiliskra:mutate_gather", c.middle(), 160, sizeVars(9)); }
    if (t % 20 === 0) shake(c, 90, 0.1 + 0.3 * (t / 200), 1.0);
  },
  burst(c) {
    // the fourth, and the biggest
    const to = c.middle();
    for (let k = 0; k < 3; k++) bolt(c, { x: to.x + (k - 1) * 1.5, y: to.y, z: to.z }, 300 + k, true);
    thunder(c, to, 300, true);
    particle(c.dim, "basiliskra:mutate_burst", to, 200);
    for (let k = 0; k < 10; k++) {
      const p = ringAt(c, 8, (k / 10) * Math.PI * 2, 0);
      const y = floorAt(c, p.x, p.z);
      particle(c.dim, k % 2 ? "basiliskra:impact_debris" : "basiliskra:step_dust", { x: p.x, y: y + 0.4, z: p.z }, 128);
    }
    scar(c, 6, 8, 301);
    shake(c, 140, 1.4, 0.8);
  },
  post(c, t) {
    if (t === 0) {
      // the charge runs to ground through his club
      c.setPhase("grounded");
      c.setCharge(0);
      c.say("basiliskra.iii.ground", at(c, "club_core"), 128);
      for (const s of ["spike_tip_0", "spike_tip_3", "spike_tip_8"]) particle(c.dim, "basiliskra:club_arc", at(c, s), 112);
    }
    if (t === 34) c.setPhase("idle");
    // his plates light one by one, from the tail to the head
    if (t >= 34 && t < 110) {
      const before = Math.floor(c.charge / 2);
      c.setCharge(((t - 34) / 76) * 18);
      const zone = Math.floor(c.charge / 2);
      if (zone > before) {
        const tip = at(c, `plate_tip_${Math.max(0, 9 - zone)}`);
        sound(c.dim, "basiliskra.iii.charge_tick", tip, 112, 0.8, 0.6 + zone * 0.08);
        particle(c.dim, "basiliskra:plate_ember", tip, 112);
      }
    }
    // and he shakes the fire out of them
    if (t === 110) { c.setPhase("scatter"); c.say("basiliskra.iii.scatter", at(c, "plate_tip_5"), 128); shake(c, 96, 0.6, 0.5); }
    if (t > 110) c.setCharge(Math.max(0, 18 - (t - 110) * 0.9));
    if (t === 134) c.setPhase("idle");
  },
};

// ---- III -> IV: he burns through ------------------------------------------------------------------------------
const VENTS = [137, 155, 173];
const THREE: Change = {
  before: 236, after: 210, hold: 0, nameAt: 110,
  flash: { red: 1, green: 1, blue: 1, hold: 0.4, fade: 1.3 },
  shots: (c, Fo, Fn) => [
    // along his back from the tail as the plates light: a charge, like any other
    { ticks: 70, look: () => at(c, "plate_tip_5"), angle: [160, 195], dist: [Fo * 0.7, Fo * 0.55], height: [Fo * 0.3, Fo * 0.2] },
    // his face, as it reaches his mouth and he does not fire
    { ticks: 67, look: head(c), angle: [35, 20], dist: [Fo * 0.36, Fo * 0.28], height: [0.5, -1] },
    // at his feet: the vent fails, and the ground under him begins to glow
    { ticks: 54, look: () => ({ x: c.pos.x, y: c.pos.y + 2, z: c.pos.z }), angle: [70, 110], dist: [Fo * 0.6, Fo * 0.5], height: [1, 2.5] },
    // all of him, drawing back from it
    { ticks: 45, look: head(c), angle: [-14, 14], dist: [Fo * 0.35, Fo * 0.85], height: [0, Fo * 0.12] },
    // from the ground, up at a dark shape in the smoke
    { ticks: 64, look: body(c), angle: [-20, -8], dist: [Fn * 0.5, Fn * 0.6], height: [-21, -20] },
    // from behind him as the wings come open
    { ticks: 46, look: body(c), angle: [180, 168], dist: [Fn * 0.85, Fn * 1.0], height: [Fn * 0.05, Fn * 0.2] },
    // round to the front of him: all of what he is now
    { ticks: 100, look: body(c), angle: [40, -15], dist: [Fn * 0.7, Fn * 1.0], height: [-Fn * 0.2, Fn * 0.1] },
  ],
  pre(c, t) {
    if (t === 0) {
      c.setPhase("charge");
      c.say("basiliskra.iii.club_plant", at(c, "club_core"), 128);
      c.say("basiliskra.iii.charge", at(c, "throat"), 160);
    }
    if (t < 137) {
      const before = Math.floor(c.charge / 2);
      c.setCharge((t / 137) * 18);
      const zone = Math.floor(c.charge / 2);
      if (zone > before) sound(c.dim, "basiliskra.iii.charge_tick", at(c, zone >= 6 ? "throat" : "club_core"), 96, 0.55, 0.6 + zone * 0.08);
    }
    // it should leave him now, and does not: he vents, three knocks, and nothing goes out of him
    const k = VENTS.indexOf(t);
    if (k >= 0) {
      if (k === 0) c.setPhase("vent");
      c.say("basiliskra.knock.vent", at(c, "gill_l"), 96, 1, 1 - k * 0.03);
      c.pulse(3);
    }
    if (t >= 137 && t < 191) {
      c.setCharge(18 + ((t - 137) / 54) * 2);
      if (t % 3 === 0) for (const g of ["gill_l", "gill_r"]) particle(c.dim, "basiliskra:gill_steam", at(c, g), 112);
      // the ground under him starts to glow, further out all the time
      if (t % 4 === 0) scar(c, 4 + (t - 137) * 0.12, 2, t);
      if (t % 6 === 0) particle(c.dim, "basiliskra:rad_shimmer", { x: c.pos.x, y: c.pos.y + 0.5, z: c.pos.z }, 96);
    }
    // his whole hide flickers: more than it can hold
    if (t === 191) { c.setPhase("scatter"); c.say("basiliskra.iii.scatter", at(c, "plate_tip_5"), 160); c.say("basiliskra.mutate", c.pos, 128, 1, 0.8); }
    if (t >= 191) {
      c.setCharge(20);
      if (t % 8 === 0) c.pulse(3);
      if (t % 4 === 0) for (const p of [1, 4, 7]) particle(c.dim, "basiliskra:plate_blaze", at(c, `plate_tip_${p}`), 128);
      if (t % 6 === 0) particle(c.dim, "basiliskra:mutate_gather", c.middle(), 192, sizeVars(16));
      if (t % 5 === 0) scar(c, 11, 2, t);
    }
    if (t % 20 === 0) shake(c, 120, 0.1 + 0.9 * (t / 236) * (t / 236), 1.0);
  },
  burst(c) {
    const feet = { x: c.pos.x, y: c.pos.y + 0.4, z: c.pos.z };
    particle(c.dim, "basiliskra:mutate_burst", c.middle(), 224);
    particle(c.dim, "basiliskra:roar_ring", feet, 192, reachVars(30));
    particle(c.dim, "basiliskra:roar_wave", feet, 192, reachVars(30));
    particle(c.dim, "basiliskra:shock_ring", feet, 192);
    sound(c.dim, "ambient.weather.thunder", feet, 224, 2, 0.45);
    sound(c.dim, "random.explode", feet, 192, 2, 0.4);
    // whatever stands near is thrown back from it (nothing is hurt by this)
    blast(c.dim, feet, 30, 0, 0, 1.5, () => false, c.entity, feet);
    scar(c, 9, 12, 500);
    shake(c, 192, 2.2, 1.2);
  },
  post(c, t) {
    if (t === 0) {
      // dark: the fire is shut inside him, and only one flank shows it
      c.setPhase("swallow");
      c.setCharge(0);
      c.say("basiliskra.iii.fizzle", at(c, "mouth"), 128, 1, 0.7);
    }
    if (t === 24) c.say("basiliskra.iii.breath", at(c, "nose"), 112, 1, 0.7);
    if (t < 80 && t % 5 === 0) {
      const v = c.volumes();
      for (let k = 0; k < 3; k++) particle(c.dim, "basiliskra:impact_smoke", v[Math.floor(hash(t, k, 41) * v.length)].at, 192);
    }
    // the wings come open
    if (t === 64) {
      c.setPhase("recoil");
      sound(c.dim, "mob.enderdragon.flap", at(c, "wing_tip_l"), 192, 2, 0.5);
      sound(c.dim, "mob.enderdragon.flap", at(c, "wing_tip_r"), 192, 2, 0.55);
      c.say("basiliskra.iii.club_swing", c.middle(), 160, 1, 0.7);
      const feet = { x: c.pos.x, y: c.pos.y + 0.4, z: c.pos.z };
      for (let k = 0; k < 12; k++) {
        const p = ringAt(c, 14, (k / 12) * Math.PI * 2, 0);
        particle(c.dim, "basiliskra:step_dust", { x: p.x, y: floorAt(c, p.x, p.z) + 0.3, z: p.z }, 128);
      }
      blast(c.dim, feet, 26, 0, 0, 1.0, () => false, c.entity, feet);
      shake(c, 160, 1.2, 0.6);
    }
    if (t >= 64 && t < 110) c.setCharge(((t - 64) / 46) * 12);
    // and he stands in what he is: lit from the club to the head, wings spread
    if (t === 110) { c.setPhase("rise"); c.say("basiliskra.iii.growl", at(c, "nose"), 160, 1, 0.7); }
    if (t >= 110 && t < 150) c.setCharge(12 + ((t - 110) / 40) * 8);
    if (t >= 110 && t < 170 && t % 6 === 0) particle(c.dim, "basiliskra:plate_ember", at(c, `plate_tip_${Math.floor(hash(t, 42) * 7)}`), 128);
    if (t >= 170) c.setCharge(Math.max(0, 20 - (t - 170) * 0.5));
    if (t === 190) c.setPhase("idle");
  },
};

/** The scene for the change into each form. */
export const CHANGES: Record<2 | 3 | 4, Change> = { 2: ONE, 3: TWO, 4: THREE };
