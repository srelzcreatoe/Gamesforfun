// FREDBEAR - the central threat.
//
// PHASES (by night): 0 foreshadow only (N1-3), 1 Stirring (N4: hatch only,
// camera disruption), 2 Haunting (N5: all entries, relocation, false camera
// events, local blackouts), 3 Golden Hour (N6: shorter cooldowns + finale).
//
// STATES
//   DORMANT  in his chamber until the night's activation tick.
//   STIR     walks to the sealed diner stage and stands (CAM 16) for `stir` ticks.
//   PATROL   hunts toward the chosen entry along hidden basement routes
//            (on foot to the hatch) or by warned RELOCATION between golden nodes.
//   RELOCATING  40-tick warning (chime + golden shimmer + static on the
//            destination camera), then he appears at the destination node.
//   APPROACH walks the final edge into the entry (hatch climb or alcove).
//   TELEGRAPH W1 = max(100, 180-4A) ticks: golden glow + music box at the entry.
//            Barrier OPEN at the end -> ATTACK. Barrier CLOSED -> FORCING.
//   FORCING  W2 = max(60, 100-2A) ticks of pounding. Opening the barrier -> ATTACK.
//            Window ends -> the barrier is forced open and JAMMED.
//   JAMMED   W3 = 60 ticks with the barrier stuck open -> ATTACK unless repelled.
//   RECOVER  cooldown after a repel; powers may still be used.
//   SPENT    mercy cap: after maxAttempts repelled attempts he stays in the diner.
//
// COUNTERMEASURE: fire the EMERGENCY STROBE while he is at an entry
// (TELEGRAPH/FORCING/JAMMED) AND that entry's barrier is closed or jammed.
// A strobe with the barrier open only stuns him (+40 ticks, once per attempt).
// He never attacks through a closed barrier: a closed barrier is first visibly
// forced open (JAMMED) and a further strobe window follows.

import { Animatronic } from './base.js';
import { CONFIG } from '../config.js';
import { NODE_BY_ID, ENTRY_NODE, GOLDEN_NODES } from '../../data/nodes.js';
import { CAMERAS } from '../../data/cameras.js';

const APPROACH_NODE = Object.freeze({ H: 'SUB_N', L: 'WH_S', R: 'EH_S' });
const ENTRY_NAME = Object.freeze({ L: 'LEFT DOOR', R: 'RIGHT DOOR', H: 'HATCH' });
const BASEMENT_GOLDEN = Object.freeze(['DINER_STAGE', 'CRAWL_MID', 'SUB_N']);

export class Fredbear extends Animatronic {
  constructor(session) {
    super(session, 'fredbear');
  }

  reset() {
    super.reset();
    this.attempts = 0;
    this.cool = { disrupt: 0, false_cam: 0, blackout: 0, relocate: 0 };
    this.blackoutHours = new Set();
    this.relocateTo = null;
    this.stunned = false;
    this.holdTicks = 0;
    this.anim = 'dormant';
    this.target = 'H';
  }

  get fdef() {
    return this.s.def.fredbear ?? { phase: 0 };
  }

  get phase() {
    return this.fdef.phase ?? 0;
  }

  get maxAttempts() {
    return (this.fdef.maxAttempts ?? 0) + (this.s.finale ? this.fdef.finale?.extraAttempts ?? 0 : 0);
  }

  hasPower(p) {
    return (this.fdef.powers ?? []).includes(p);
  }

  think() {
    const s = this.s;
    switch (this.state) {
      case 'DORMANT':
        this.anim = 'dormant';
        if (this.phase > 0 && s.t >= this.activationTick) {
          this.setState('STIR', 'activation time reached');
          const path = this.graph.path(this.node, 'DINER_STAGE');
          if (path && path.length > 1) this.followPath(path.slice(1), 'walk');
          this.timer = this.fdef.stir ?? 300;
        }
        return;
      case 'STIR':
        this.eyes = true;
        if (this.node !== 'DINER_STAGE') {
          if (!(this.path.length && this.advancePath())) {
            const path = this.graph.path(this.node, 'DINER_STAGE');
            if (path && path.length > 1) this.followPath(path.slice(1), 'walk');
          }
          return;
        }
        this.anim = 'look';
        if (--this.timer <= 0) {
          this.chooseEntry();
          this.setState('PATROL', `hunting toward ${this.target}`);
        }
        return;
      case 'PATROL':
      case 'STALK':
        this.tickPowers();
        if (this.attempts >= this.maxAttempts) {
          this.becomeSpent();
          return;
        }
        this.hunt();
        return;
      case 'RELOCATING':
        if (--this.timer <= 0) this.completeRelocation();
        return;
      case 'APPROACH':
        if (!this.move) {
          s.director.releaseEntry(this.id);
          this.setState('PATROL', 'approach blocked');
        }
        return;
      case 'TELEGRAPH':
        return this.thinkTelegraph();
      case 'FORCING':
        return this.thinkForcing();
      case 'JAMMED':
        return this.thinkJammed();
      case 'RECOVER':
        this.tickPowers();
        if (--this.timer <= 0) {
          if (this.attempts >= this.maxAttempts) {
            this.becomeSpent();
            return;
          }
          this.chooseEntry();
          this.setState('PATROL', `recovered; hunting toward ${this.target}`);
        }
        return;
      case 'SPENT':
        this.anim = 'idle';
        this.eyes = false;
        if (this.attempts < this.maxAttempts) {
          // The finale grants extra attempts.
          this.chooseEntry();
          this.setState('PATROL', 'finale: Fredbear rises again');
        }
        return;
      case 'SUSPENDED':
        this.anim = 'dormant';
        return;
      default:
    }
  }

  // ------------------------------------------------------------ hunting
  chooseEntry() {
    const entries = this.fdef.entries ?? ['H'];
    if (entries.length === 1) {
      this.target = entries[0];
      return;
    }
    const d = this.s.director.doorUse;
    const w = entries.map((e) => (1 + (10 - d[e]) / 5) * (e === this.memory.lastEntry ? 0.5 : 1));
    this.target = this.s.rng.weighted(entries, w);
  }

  hunt() {
    const s = this.s;
    const entry = this.target;
    const approach = APPROACH_NODE[entry];
    if (this.node === approach) {
      if (s.director.reserveEntry(this.id, entry)) {
        if (this.beginEdgeMove(ENTRY_NODE[entry], 'walk')) {
          this.entry = entry;
          this.holdTicks = 0;
          this.setState('APPROACH', `climbing toward the ${ENTRY_NAME[entry]}`);
          const p = this.pose();
          s.emit({ fx: 'sound', id: 'fb.step.fredbear', at: { x: p.x, y: p.y, z: p.z }, vol: 1.0 });
          s.caption(`Heavy metal footsteps — ${ENTRY_NAME[entry]}`, this.id);
          return;
        }
        s.director.releaseEntry(this.id);
      }
      this.anim = 'look';
      if (++this.holdTicks > CONFIG.characters.fredbear.holdMax) {
        this.holdTicks = 0;
        this.chooseEntry();
      }
      return;
    }
    // Supernatural relocation (phase 2+): only between golden nodes, always warned.
    if (this.phase >= 2 && this.hasPower('relocate') && this.cool.relocate === 0 && GOLDEN_NODES.includes(this.node)) {
      const dest = APPROACH_NODE[entry];
      if (dest !== this.node && GOLDEN_NODES.includes(dest) && !s.occupancy.isTaken(dest, this.id)) {
        this.startRelocate(dest);
        return;
      }
    }
    if (--this.moTimer > 0) return;
    this.moTimer = s.rng.jitter(this.cfg.moInterval);
    if (!s.rng.d20(this.aggression)) return;
    let goal = ENTRY_NODE[entry];
    if (!isFinite(this.graph.distance(this.node, goal))) {
      // Door entries are only reachable by relocation; walk toward the
      // nearest golden basement node and wait for the power there.
      if (this.phase < 2 || !this.hasPower('relocate')) {
        this.target = 'H';
        goal = ENTRY_NODE.H;
      } else if (GOLDEN_NODES.includes(this.node)) {
        this.anim = 'look';
        return;
      } else {
        goal = BASEMENT_GOLDEN.reduce((best, n) => (this.graph.distance(this.node, n) < this.graph.distance(this.node, best) ? n : best));
      }
    }
    const next = this.chooseStep(goal);
    if (next) this.beginEdgeMove(next, 'walk');
  }

  startRelocate(dest) {
    const s = this.s;
    if (!s.occupancy.claim(dest, this.id)) return false;
    this.relocateTo = dest;
    this.timer = CONFIG.characters.fredbear.relocateWarn;
    this.cool.relocate = CONFIG.fredbearPowers.relocate.cooldown[this.phase];
    this.setState('RELOCATING', `warned relocation to ${dest}`);
    const n = NODE_BY_ID[dest];
    s.emit({ fx: 'shimmer', node: dest, at: { x: n.x, y: n.y + 1, z: n.z } });
    s.emit({ fx: 'sound', id: 'fb.fredbear.chime', at: { x: n.x, y: n.y + 1.5, z: n.z }, vol: 1.0 });
    const cam = CAMERAS.find((c) => c.sees.includes(dest));
    if (cam) s.emit({ fx: 'camfx', kind: 'static_burst', cam: cam.id });
    s.caption(`A music box chimes — ${n.y < -3 ? 'below' : n.x < 100 ? 'west hall' : 'east hall'}`, this.id);
    return true;
  }

  completeRelocation() {
    const s = this.s;
    s.occupancy.release(this.node, this.id);
    this.prevNode = this.node;
    this.node = this.relocateTo;
    s.occupancy.force(this.node, this.id);
    this.relocateTo = null;
    this.yaw = NODE_BY_ID[this.node].yaw ?? this.yaw;
    this.anim = 'look';
    this.eyes = true;
    this.setState('PATROL', `appeared at ${this.node}`);
  }

  onArrive(node) {
    const n = NODE_BY_ID[node];
    if (this.state === 'APPROACH' && n.zone === 'entry') this.startTelegraph();
    else if (this.state === 'STIR') this.anim = 'look';
  }

  // ------------------------------------------------------------ entry
  startTelegraph() {
    const s = this.s;
    this.timer = this.cfg.w1(this.aggression);
    this.stunned = false;
    this.anim = 'threat';
    this.eyes = true;
    this.setState('TELEGRAPH', `at the ${ENTRY_NAME[this.entry]}, W1 ${this.timer}t`);
    s.emit({ fx: 'actuate', id: `sig.fredbear_glow_${this.entry.toLowerCase()}` });
    const p = this.pose();
    s.emit({ fx: 'sound', id: 'fb.fredbear.musicbox', at: { x: p.x, y: p.y + 1.5, z: p.z }, vol: 1.0, loopKey: 'fredbear_entry' });
    s.caption(`A music box plays at the ${ENTRY_NAME[this.entry]}`, this.id);
  }

  thinkTelegraph() {
    const s = this.s;
    if (s.blackout.stage === 'on') return;
    if (--this.timer > 0) return;
    if (s.barrierClosed(this.entry)) {
      this.timer = this.cfg.w2(this.aggression);
      this.setState('FORCING', `${ENTRY_NAME[this.entry]} closed: forcing (W2 ${this.timer}t)`);
      s.emit({ fx: 'actuate', id: `sig.strain_${this.entry.toLowerCase()}` });
      s.caption(`Something is forcing the ${ENTRY_NAME[this.entry]} — use the STROBE!`, this.id);
    } else {
      this.attack(`${ENTRY_NAME[this.entry]} open at the end of the telegraph`);
    }
  }

  thinkForcing() {
    const s = this.s;
    if (!s.barrierClosed(this.entry) && !s.jammed[this.entry]) {
      this.attack(`${ENTRY_NAME[this.entry]} opened while being forced`);
      return;
    }
    if (this.stateTicks % 20 === 0) {
      const p = this.pose();
      s.emit({ fx: 'sound', id: 'fb.door.bang', at: { x: p.x, y: p.y + 1, z: p.z }, vol: 1.0 });
    }
    if (--this.timer > 0) return;
    s.jamBarrier(this.entry);
    this.timer = this.cfg.w3;
    this.setState('JAMMED', `${ENTRY_NAME[this.entry]} forced open`);
    s.caption(`The ${ENTRY_NAME[this.entry]} is jammed open — STROBE NOW!`, this.id);
  }

  thinkJammed() {
    if (--this.timer > 0) return;
    this.attack(`${ENTRY_NAME[this.entry]} jammed and no strobe`);
  }

  /** Called by the session when the emergency strobe fires. */
  onStrobe() {
    const s = this.s;
    if (!['TELEGRAPH', 'FORCING', 'JAMMED'].includes(this.state)) return 'none';
    if (s.barrierClosed(this.entry) || s.jammed[this.entry]) {
      this.repel();
      return 'repelled';
    }
    if (!this.stunned) {
      this.stunned = true;
      this.timer += this.cfg.stunTicks;
      s.caption(`Fredbear flinches — close the ${ENTRY_NAME[this.entry]} first!`, this.id);
      return 'stunned';
    }
    return 'wasted';
  }

  repel() {
    const s = this.s;
    const entry = this.entry;
    this.attempts++;
    this.memory.repelled[entry] = Math.min(5, this.memory.repelled[entry] + 1);
    this.memory.lastEntry = entry;
    s.unjam(entry);
    s.director.releaseEntry(this.id);
    s.emit({ fx: 'actuate', id: `sig.fredbear_glow_off` });
    s.emit({ fx: 'stop_loop', loopKey: 'fredbear_entry' });
    s.emit({ fx: 'sound', id: 'fb.fredbear.roar', at: 'office', vol: 0.9 });
    s.emit({ fx: 'repel', who: this.id, entry });
    this.entry = null;
    // Vanishes in the flash and reappears on the diner stage (documented).
    if (this.move) {
      s.occupancy.release(this.move.to, this.id);
      this.move = null;
    }
    this.path = [];
    s.occupancy.release(this.node, this.id);
    this.node = s.occupancy.isTaken('DINER_STAGE', this.id) ? 'DINER_FLOOR' : 'DINER_STAGE';
    s.occupancy.force(this.node, this.id);
    this.yaw = NODE_BY_ID[this.node].yaw ?? 0;
    this.eyes = false;
    this.anim = 'idle';
    this.timer = s.finale ? this.fdef.finale?.cooldown ?? 500 : this.fdef.cooldown ?? 1200;
    this.setState('RECOVER', `repelled at ${ENTRY_NAME[entry]} (attempt ${this.attempts}/${this.maxAttempts})`);
  }

  attack(reason) {
    const s = this.s;
    if (s.director.requestAttack(this.id)) {
      this.anim = 'attack';
      this.setState('ATTACK', reason);
      s.emit({ fx: 'stop_loop', loopKey: 'fredbear_entry' });
      s.beginJumpscare(this.id);
    }
  }

  becomeSpent() {
    const s = this.s;
    s.director.releaseEntry(this.id);
    this.eyes = false;
    this.anim = 'idle';
    this.setState('SPENT', `mercy cap reached (${this.attempts} repelled)`);
  }

  // ------------------------------------------------------------ powers
  tickPowers() {
    const s = this.s;
    for (const k of Object.keys(this.cool)) if (this.cool[k] > 0) this.cool[k]--;
    if (s.t % 40 !== 0 || s.phase !== 'RUNNING') return;
    const P = CONFIG.fredbearPowers;
    const ph = this.phase;
    if (this.hasPower('disrupt') && this.cool.disrupt === 0 && s.disrupt.left === 0) {
      const chance = (s.devices.cams.open ? 0.3 : 0.06) + (this.watchedTicks > 100 ? 0.5 : 0);
      if (s.rng.chance(chance)) {
        s.startDisrupt(P.disrupt.duration[ph]);
        this.cool.disrupt = P.disrupt.cooldown[ph];
        return;
      }
    }
    if (this.hasPower('false_cam') && this.cool.false_cam === 0 && !s.echo && s.rng.chance(0.2)) {
      const real = CAMERAS.find((c) => c.sees.includes(this.node));
      const options = CAMERAS.filter((c) => !c.audioOnly && c !== real && c.sees.length && !s.occupancy.isTaken(c.sees[0], '__echo__'));
      const cam = s.rng.pick(options);
      if (cam) {
        s.startEcho(cam.id, cam.sees[0], P.false_cam.duration[ph], 'false');
        this.cool.false_cam = P.false_cam.cooldown[ph];
        return;
      }
    }
    if (this.hasPower('blackout') && this.cool.blackout === 0 && !this.blackoutHours.has(s.hour) && s.director.blackoutAllowed() && s.rng.chance(0.2)) {
      s.startBlackout(P.blackout.warn, P.blackout.duration[ph]);
      this.blackoutHours.add(s.hour);
      this.cool.blackout = P.blackout.cooldown[ph];
    }
  }
}
