// CHICA - the resource-pressure threat.
//
// * Route: stage -> dining (east) -> KITCHEN -> pantry -> east service
//   corridor -> (employee entrance / party room D) -> east hall -> RIGHT door.
//   A direct dining -> east hall route exists as well.
// * At the start, and after some retreats (40 %), she goes to the kitchen first
//   and lingers 3-9 s. While there she makes pots-and-pans clatter (the owner's recording, 3-6 s bursts) every 6-9 s. This clatter is
//   ONLY ever produced by Chica in the kitchen (ambient sounds never use it),
//   so it is a reliable tell. CAM 10 relays it.
// * Sabotage: while lingering, each movement opportunity may trip the hall-light
//   breaker (chance aggression/40, at most maxSabotage per night, 60 s apart).
//   A trip disables BOTH hall lights until the player presses Reset Breaker
//   (2 s, 1 % power). Doors, cameras and the strobe are never affected, so
//   the defence that actually stops her always remains available.
// * Approach tells: metallic footsteps; heavy breathing at the right door.
// * Teamwork (aggression 8+): while Bonnie pounds on the LEFT door she sneaks
//   to the RIGHT door - no kitchen stop, guaranteed moves, silent footsteps.
//   Her breathing at the door and the hall light still give her away.

import { DoorAttacker } from './door_attacker.js';
import { NODE_BY_ID, ENTRY_NODE } from '../../data/nodes.js';

export class Chica extends DoorAttacker {
  constructor(session) {
    super(session, 'chica');
  }

  reset() {
    super.reset();
    this.kitchenDone = !this.s.rng.chance(this.cfg.kitchenFirst ?? 1);
    this.lingerLeft = 0;
    this.clatterIn = 0;
  }

  /** Right door; from aggression 8 she flanks LEFT (like Bonnie) when the right side is busy. */
  chooseTarget() {
    const s = this.s;
    const f = s.anim.freddy;
    const busy = !!s.director.entries.R || (f && ['STALK', 'APPROACH', 'LURK'].includes(f.state) && ['EH_M', 'EH_S', 'E_DOOR'].includes(f.node));
    this.target = busy && this.aggression >= this.cfg.flankMinAI && s.rng.chance(this.cfg.flankChance) ? 'L' : 'R';
  }

  goalNode() {
    return this.kitchenDone ? ENTRY_NODE[this.target] : 'KIT';
  }

  wantsEntry() {
    return this.kitchenDone;
  }

  beginRecover(reason) {
    super.beginRecover(reason);
    if (this.s.rng.chance(this.cfg.kitchenAfterRetreat ?? 1)) this.kitchenDone = false;
  }

  /** Teamwork: Bonnie is pounding on the left door - sneak to the right one. */
  get sneaking() {
    const tw = this.s.teamwork;
    return !!tw && tw.sneaker === this.id && this.s.t < tw.until;
  }

  think() {
    if (this.sneaking && ['PATROL', 'STALK', 'INVESTIGATE'].includes(this.state)) {
      if (!this.quiet) this.s.logTransition(this.id, this.state, this.state, 'teamwork: sneaking to the right door');
      this.quiet = true;
      this.kitchenDone = true;
      this.lingerLeft = 0;
      this.forceNextMove = true;
      this.moTimer = Math.min(this.moTimer, 12);
      if (this.state === 'INVESTIGATE') this.setState('PATROL', 'teamwork');
    } else if (this.quiet && !this.sneaking) {
      this.quiet = false;
    }
    super.think();
  }

  onApproachStart() {
    if (this.s.teamwork?.sneaker === this.id) this.s.teamwork = null; // one sneak per signal
  }

  onReachNode(node) {
    if (NODE_BY_ID[node].kitchen && !this.kitchenDone) {
      const [lo, hi] = this.cfg.linger;
      this.lingerLeft = this.s.rng.int(lo, hi);
      this.clatterIn = this.s.rng.int(10, 40);
    }
  }

  /** Runs every PATROL/STALK tick before the movement roll. */
  extraRoam() {
    if (this.lingerLeft <= 0) return false;
    const s = this.s;
    this.lingerLeft--;
    this.anim = 'look';
    if (--this.clatterIn <= 0) {
      const [lo, hi] = this.cfg.clatterEvery;
      this.clatterIn = s.rng.int(lo, hi);
      s.emit({ fx: 'sound', id: 'fb.chica.clatter', at: { x: 166.5, y: 1, z: 30.5 }, vol: 1.0, kitchen: true, loopKey: 'chica_kitchen' });
      s.caption('Pots and pans clattering — kitchen', this.id);
    }
    if (this.lingerLeft % 30 === 0) this.trySabotage();
    if (this.lingerLeft === 0) {
      s.emit({ fx: 'stop_loop', loopKey: 'chica_kitchen' }); // she leaves: the kitchen goes quiet
      this.kitchenDone = true;
      this.moTimer = 1;
    }
    return true; // no travel while lingering
  }

  trySabotage() {
    const s = this.s;
    if (s.sabotageCount >= (s.def.maxSabotage ?? 0)) return;
    if (s.t < s.nextSabotageTick || s.breaker.tripped) return;
    if (!s.rng.chance(this.cfg.sabotageChance(this.aggression))) return;
    s.tripBreaker('chica');
  }

  onTelegraphStart() {
    if (!this.s.rng.chance(Math.max(0.3, 1 - this.aggression / 25))) return; // see Bonnie
    const p = this.pose();
    this.s.emit({ fx: 'sound', id: 'fb.chica.breath', at: { x: p.x, y: 1.5, z: p.z }, vol: 0.7 });
    this.s.caption(this.entry === 'R' ? 'Heavy breathing at the RIGHT door' : 'Heavy breathing at the LEFT door', this.id);
  }
}
