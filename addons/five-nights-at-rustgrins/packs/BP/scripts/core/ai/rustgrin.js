// Rustgrin: FNAF 1 Freddy rules. He follows a fixed route down the east side
// and only moves while nobody watches him on a camera. His last stop is the
// nook in the E. Hall Corner, which only CAM 4B can see (never the hall
// light). From there he comes in through an OPEN right door while the guard
// is busy on any other camera; a shut door at a successful opportunity sends
// him back up the East Hall. Every move: a laugh and mic feedback.

import { Animatronic } from './base.js';

export class Rustgrin extends Animatronic {
  constructor(s, id) {
    super(s, id);
    this.idx = 0;
    this.onCams = 0;
  }

  onArrive(node) {
    super.onArrive(node);
    if (node === this.cfg.route[this.cfg.route.length - 1]) {
      // the tell: feedback squeal right outside the right door
      this.s.emit({ fx: 'sound', id: 'fnar.rustgrin.feedback', at: 'door_r', vol: 0.8 });
      this.s.emit({ fx: 'at_nook', who: this.id });
    }
  }

  tick() {
    if (this.tickWalk()) return;
    const s = this.s;
    const route = this.cfg.route;
    if (this.state === 'inside') {
      if (!s.devices.cams.open && s.t >= this.killAt) s.kill(this.id);
      return;
    }
    if (this.node === route[route.length - 1]) {
      this.state = 'nook';
      const doorOpen = !s.doorClosed('R');
      const busy = s.devices.cams.open && s.devices.cams.cam !== '4B';
      this.onCams = doorOpen && busy && this.active ? this.onCams + 1 : 0;
      if (this.onCams >= this.cfg.enterAfter) {
        this.state = 'inside';
        this.inside = true;
        s.breach('R', this.id);
        s.emit({ fx: 'hide', who: this.id });
        s.emit({ fx: 'sound', id: 'fnar.rustgrin.laugh', at: 'office', vol: 0.6 });
        this.killAt = s.t + 10;
        return;
      }
      if (!doorOpen && this.opportunity() && !this.watched()) {
        // the door held: back up the hall (off camera)
        this.idx = route.indexOf(this.cfg.repelTo);
        this.placeAt(this.cfg.repelTo, 'stand');
        s.emit({ fx: 'sound', id: 'fnar.step.heavy', at: 'door_r', vol: 0.9 });
      }
      return;
    }
    this.state = 'route';
    if (this.watched()) {
      // FNAF 1: a watched Freddy also loses his opportunity timing
      if (this.s.t >= this.nextMo) this.nextMo = this.s.t + this.cfg.mo;
      return;
    }
    if (!this.opportunity()) return;
    this.idx = Math.min(route.indexOf(this.node) + 1, route.length - 1);
    const next = route[this.idx];
    if (this.goTo(next)) {
      if (s.rng.chance(this.cfg.laughChance)) s.emit({ fx: 'sound', id: 'fnar.rustgrin.laugh', at: 'near_office', vol: 0.7 });
      s.emit({ fx: 'sound', id: 'fnar.rustgrin.feedback', at: this.id, vol: 0.7 });
    }
  }
}
