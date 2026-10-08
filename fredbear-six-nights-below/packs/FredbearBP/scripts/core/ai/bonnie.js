// BONNIE - the aggressive flanker.
//
// * Primary entry: LEFT door (west hall). From aggression 5 he may flank to
//   the RIGHT door through Party Room A; the flank probability rises each time
//   he is turned away from a side and when the player leans on that door:
//     p(switch) = clamp(0.25 + 0.15*repelled[last] + 0.03*(doorUse[last]-doorUse[other]), 0.15, 0.75)
// * From aggression 6 the Supply Closet maintenance duct is available: a
//   hidden vent crawl that skips the West Hall camera and ends at the left
//   door. It is announced by a vent clank at the closet (CAM 09) and under the
//   left alcove.
// * Being watched on camera for 3 s agitates him: his next movement
//   opportunity is guaranteed.
// * After retreating he recovers briefly in a different room, then re-targets.

import { DoorAttacker } from './door_attacker.js';

export class Bonnie extends DoorAttacker {
  constructor(session) {
    super(session, 'bonnie');
  }

  chooseTarget() {
    const a = this.aggression;
    const last = this.memory.lastEntry ?? this.cfg.primary;
    if (a < this.cfg.flankMinAI) {
      this.target = 'L';
      return;
    }
    const other = last === 'L' ? 'R' : 'L';
    const d = this.s.director.doorUse;
    let p = 0.25 + 0.15 * this.memory.repelled[last] + 0.03 * (d[last] - d[other]);
    p = Math.max(0.15, Math.min(0.75, p));
    this.target = this.s.rng.chance(p) ? other : last;
  }

  stepWeight(o) {
    const a = this.aggression;
    if (o.to === 'SUP') {
      if (this.target !== 'L' || a < this.cfg.ventMinAI) return 0;
      return 1 + a / 10;
    }
    return 1;
  }

  onApproachStart() {
    if (this.move?.mode === 'vent') {
      this.s.emit({ fx: 'sound', id: 'fb.vent.clank', at: { x: 80.5, y: 0.5, z: 132.5 }, vol: 1.0 });
      this.s.emit({ fx: 'sound', id: 'fb.vent.clank', at: { x: 92.5, y: -0.5, z: 132.5 }, vol: 0.7, delay: 40 });
      this.s.caption('Clanking in the vents — west side', this.id);
    }
  }

  onTelegraphStart() {
    // Audible arrival is likely on early nights and rarer later (difficulty
    // through information, not speed): p = max(0.3, 1 - A/25).
    if (!this.s.rng.chance(Math.max(0.3, 1 - this.aggression / 25))) return;
    const p = this.pose();
    this.s.emit({ fx: 'sound', id: 'fb.bonnie.groan', at: { x: p.x, y: 1.5, z: p.z }, vol: 0.6 });
    this.s.caption(this.entry === 'L' ? 'A low groan at the LEFT door' : 'A low groan at the RIGHT door', this.id);
  }
}
