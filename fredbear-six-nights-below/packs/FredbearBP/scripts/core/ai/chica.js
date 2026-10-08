// CHICA - the resource-pressure threat.
//
// * Route: stage -> dining (east) -> KITCHEN -> pantry -> east service
//   corridor -> (employee entrance / party room D) -> east hall -> RIGHT door.
//   A direct dining -> east hall route exists as well.
// * After every retreat she returns to the kitchen first and lingers 10-30 s.
//   While there she makes pots-and-pans clatter every 3-7 s. This clatter is
//   ONLY ever produced by Chica in the kitchen (ambient sounds never use it),
//   so it is a reliable tell. CAM 10 relays it.
// * Sabotage: while lingering, each movement opportunity may trip the hall-light
//   breaker (chance aggression/40, at most maxSabotage per night, 60 s apart).
//   A trip disables BOTH hall lights until the player presses Reset Breaker
//   (2 s, 1 % power). Doors, cameras and the strobe are never affected, so
//   the defence that actually stops her always remains available.
// * Approach tells: metallic footsteps; heavy breathing at the right door.

import { DoorAttacker } from './door_attacker.js';
import { NODE_BY_ID } from '../../data/nodes.js';

export class Chica extends DoorAttacker {
  constructor(session) {
    super(session, 'chica');
  }

  reset() {
    super.reset();
    this.kitchenDone = false;
    this.lingerLeft = 0;
    this.clatterIn = 0;
  }

  chooseTarget() {
    this.target = 'R';
  }

  goalNode() {
    return this.kitchenDone ? 'E_DOOR' : 'KIT';
  }

  wantsEntry() {
    return this.kitchenDone;
  }

  beginRecover(reason) {
    super.beginRecover(reason);
    this.kitchenDone = false;
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
      s.emit({ fx: 'sound', id: 'fb.chica.clatter', at: { x: 166.5, y: 1, z: 30.5 }, vol: 1.0, kitchen: true });
      s.caption('Pots and pans clattering — kitchen', this.id);
    }
    if (this.lingerLeft % this.cfg.moInterval === 0) this.trySabotage();
    if (this.lingerLeft === 0) {
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
