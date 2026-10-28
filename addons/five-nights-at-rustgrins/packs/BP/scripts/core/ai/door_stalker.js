// Mirehop (left door) and Noxbriar (right window/door): FNAF 1 Bonnie/Chica
// rules. They roam a weighted route table; at their door node the guard sees
// them only with that side's hall light. A shut door makes them give up after
// a while; an open door at a successful opportunity lets them in, and then
// the office belongs to them: that side's buttons die and the jumpscare comes
// when the monitor goes down (or after a short wait).

import { Animatronic, pickFrom } from './base.js';
import { NODES } from '../../data/nodes.js';

export class DoorStalker extends Animatronic {
  constructor(s, id) {
    super(s, id);
    this.side = this.cfg.side; // 'L' | 'R'
    this.holdLeft = 0;
    this.enterAt = 0;
    this.killAt = 0;
    this.nextTell = 0;
  }

  tick() {
    if (this.tickWalk()) return;
    const s = this.s;
    if (this.state === 'inside') {
      // jumpscare once the monitor is down (FNAF 1: they wait for you to look up)
      if (!s.devices.cams.open && s.t >= this.killAt) s.kill(this.id);
      return;
    }
    if (this.state === 'entering') {
      if (s.t >= this.enterAt) {
        this.state = 'inside';
        this.inside = true;
        s.breach(this.side, this.id);
        this.killAt = s.t + (s.devices.cams.open ? 10 : s.rng.int(40, 100));
        s.emit({ fx: 'hide', who: this.id });
      }
      return;
    }
    if (this.node === this.cfg.door) {
      this.state = 'door';
      if (s.t >= this.nextTell) this.tell();
      const shut = s.doorClosed(this.side);
      if (shut) {
        this.holdLeft--;
        if (this.holdLeft <= 0) this.retreat();
        return;
      }
      if (this.opportunity()) {
        this.state = 'entering';
        this.enterAt = s.t + this.cfg.enterDelay;
        s.emit({ fx: 'sound', id: 'fnar.servo.move', at: this.id, vol: 0.8 });
      }
      return;
    }
    this.state = 'roam';
    if (!this.opportunity()) return;
    const row = this.cfg.table[this.node];
    if (!row) return;
    const next = pickFrom(s.rng, row);
    if (next === this.cfg.door && s.occupiedDoor(this.side, this.id)) return; // someone else is already there
    this.goTo(next);
  }

  onArrive(node) {
    super.onArrive(node);
    const s = this.s;
    if (node === this.cfg.door) {
      this.holdLeft = this.cfg.hold(this.ai);
      s.emit({ fx: 'at_door', who: this.id, side: this.side, window: !!NODES[node].window });
      this.tell();
    } else if (node === 'KIT' && this.id === 'noxbriar' && s.rng.chance(this.cfg.kitchenHum)) {
      s.emit({ fx: 'sound', id: 'fnar.noxbriar.hum', at: this.id, vol: 0.7, kitchen: true });
    } else if (this.id === 'mirehop' && s.rng.chance(0.25)) {
      s.emit({ fx: 'sound', id: 'fnar.step.heavy', at: this.id, vol: 0.8 });
    }
  }

  /** The audio tell at the door, repeated while they stand there. */
  tell() {
    const s = this.s;
    this.nextTell = s.t + 90 + s.rng.int(0, 60);
    if (this.id === 'mirehop') s.emit({ fx: 'sound', id: 'fnar.mirehop.strum', at: this.id, vol: 0.9 });
    if (this.id === 'noxbriar') s.emit({ fx: 'sound', id: 'fnar.noxbriar.hum', at: this.id, vol: 0.9 });
  }

  retreat() {
    const s = this.s;
    const back = s.rng.pick(this.cfg.retreat);
    this.state = 'roam';
    s.emit({ fx: 'left_door', who: this.id, side: this.side });
    s.emit({ fx: 'sound', id: 'fnar.step.heavy', at: this.id, vol: 0.9 });
    // the walk away happens off-camera: they vanish into static
    this.placeAt(back, 'stand');
    this.nextMo = s.t + (this.cfg.mo ?? 100) * 2;
  }
}
