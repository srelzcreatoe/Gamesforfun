// SPRINGBONNIE - Fredbear's partner (1.5).
//
// The golden rabbit who sang with Fredbear on the 1983 diner stage. All game long he sits slumped
// beside Fredbear in the chamber (SB_HOME, CAM 25) - he is there in the 1983 flashback and in the
// night 6 ending too. On night 6, when the Golden Hour starts (the finale at 5 AM), his springlocks
// snap loose and he hunts WITH Fredbear: he climbs out of the supply-closet floor grate (up the duct
// from below) and walks the West Hall to the LEFT door only; he never takes the vent.
//
// At the door he is a window-based door attacker like Bonnie (door_attacker.js): a springlock twang
// (always heard, captioned) tells you he is there; keep the left door shut through his window and he
// backs off. Like everyone else he never engages while Fredbear is engaged (the director's rule), so
// the strobe and a door are never needed in two places at once.

import { DoorAttacker } from './door_attacker.js';
import { NODE_BY_ID } from '../../data/nodes.js';

export class Springbonnie extends DoorAttacker {
  constructor(session) {
    super(session, 'springbonnie');
  }

  chooseTarget() {
    this.target = 'L';
  }

  stepWeight(o) {
    return o.to === 'SUP' || o.to === 'VENT_W' ? 0 : 1; // never the supply-closet duct
  }

  think() {
    if (this.state === 'DORMANT') {
      this.anim = 'dormant';
      if (this.s.finale && this.s.t >= this.activationTick && this.aggression > 0) this.wake();
      return;
    }
    super.think();
  }

  /** The Golden Hour: out of the chamber, up the duct, out of the supply-closet grate. */
  wake() {
    const s = this.s;
    const id = this.cfg.wakeNode;
    const n = NODE_BY_ID[id];
    s.occupancy.release(this.node, this.id);
    this.node = id;
    s.occupancy.force(id, this.id);
    this.path = [];
    this.moTimer = 1;
    this.chooseTarget();
    this.hidden = false;
    this.eyes = true;
    this.setState('PATROL', 'the Golden Hour: out of the supply-closet grate');
    s.emit({ fx: 'sound', id: 'fb.springbonnie.twang', at: { x: n.x, y: n.y + 1.5, z: n.z }, vol: 1.0 });
    s.caption('A spring snaps in the supply closet… Springbonnie is awake', this.id);
  }

  onTelegraphStart() {
    const p = this.pose();
    this.s.emit({ fx: 'sound', id: 'fb.springbonnie.twang', at: { x: p.x, y: 1.5, z: p.z }, vol: 0.9 });
    this.s.caption('A springlock twangs at the LEFT door', this.id);
  }
}
