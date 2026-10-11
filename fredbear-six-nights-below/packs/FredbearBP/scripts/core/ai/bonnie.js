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
// * Teamwork (aggression 8+, chance 0.4, at most once per 2 minutes): when he
//   starts telegraphing at the LEFT door while Chica is free, he pounds on it
//   (door bangs every 25 ticks, captioned) so the player watches the left side
//   while Chica sneaks to the RIGHT door (see chica.js).

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

  /** Entering the supply duct (CAM 18 shows him crawling through it). */
  onVentEnter() {
    this.s.emit({ fx: 'sound', id: 'fb.vent.clank', at: { x: 80.5, y: 0.5, z: 132.5 }, vol: 1.0 });
    this.s.caption('Clanking in the vents — west side', this.id);
  }

  onApproachStart() {
    if (this.move?.mode === 'vent') {
      this.viaVent = true;
      this.s.emit({ fx: 'sound', id: 'fb.vent.clank', at: { x: 92.5, y: -0.5, z: 132.5 }, vol: 1.0 });
      this.s.caption('Something is climbing out of the vent — LEFT corner', this.id);
    } else {
      this.viaVent = false;
    }
  }

  onTelegraphStart() {
    this.banging = false;
    this.tryTeamwork();
    // Audible arrival is likely on early nights and rarer later (difficulty
    // through information, not speed): p = max(0.3, 1 - A/25).
    if (!this.s.rng.chance(Math.max(0.3, 1 - this.aggression / 25))) return;
    const p = this.pose();
    this.s.emit({ fx: 'sound', id: 'fb.bonnie.groan', at: { x: p.x, y: 1.5, z: p.z }, vol: 0.6 });
    this.s.caption(this.entry === 'L' ? 'A low groan at the LEFT door' : 'A low groan at the RIGHT door', this.id);
  }

  tryTeamwork() {
    const s = this.s;
    const c = s.anim.chica;
    if (this.entry !== 'L' || !c || this.aggression < this.cfg.teamworkMinAI) return;
    if (s.teamwork || s.t < (s.nextTeamwork ?? 0) || s.director.entries.R) return;
    if (!['PATROL', 'STALK', 'INVESTIGATE', 'RECOVER'].includes(c.state) || c.aggression <= 0) return;
    if (!s.rng.chance(this.cfg.teamworkChance)) return;
    s.teamwork = { by: this.id, sneaker: 'chica', entry: 'R', until: s.t + 600 };
    s.nextTeamwork = s.t + this.cfg.teamworkCooldown;
    if (c.state === 'RECOVER') c.timer = Math.min(c.timer, 20);
    this.banging = true;
    s.logTransition(this.id, 'TELEGRAPH', 'TELEGRAPH', 'teamwork: pounding on the left door for Chica');
    s.caption('Pounding on the LEFT door!', this.id);
  }
}
