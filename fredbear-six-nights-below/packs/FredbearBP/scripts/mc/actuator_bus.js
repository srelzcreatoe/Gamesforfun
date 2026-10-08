// Actuator bus: the only code path that triggers command-block modules.
//
// trigger(id) queues a module; each tick the bus places a redstone block on
// the module's pad. The module's own first command clears the pad, so it can
// fire again. Safeguards:
//   * a module fires at most once per 2 ticks (later requests wait in order);
//   * pads in unloaded chunks are retried (counted as deferred);
//   * a pad that is still powered 4+ ticks after firing means command blocks
//     are not running - it is cleared and a diagnostic is raised.

import { system } from '@minecraft/server';
import { layoutModules } from '../data/actuators.js';
import { W, dim } from './world_io.js';
import { log } from './log.js';

const PADS = new Map(layoutModules().modules.map((p) => [p.module.id, p.pad]));

/** Session effect ids that map onto a shared module. */
const ALIASES = Object.freeze({ 'js.freddy': 'js.common', 'js.bonnie': 'js.common', 'js.chica': 'js.common', 'js.fredbear': 'js.common' });

export class ActuatorBus {
  constructor() {
    this.queue = [];
    this.lastFire = new Map();
    this.stats = { fired: 0, deferred: 0, unknown: 0, stuck: 0 };
    this.pong = 0;
    this.heartbeat = 0;
  }

  has(id) {
    return PADS.has(ALIASES[id] ?? id);
  }

  trigger(id) {
    const real = ALIASES[id] ?? id;
    if (!PADS.has(real)) {
      this.stats.unknown++;
      log.warn(`unknown actuator ${id}`);
      return;
    }
    this.queue.push(real);
  }

  tick() {
    if (!this.queue.length) return;
    const now = system.currentTick;
    const later = [];
    const firedThisTick = new Set();
    for (const id of this.queue) {
      const last = this.lastFire.get(id) ?? -100;
      if (now - last < 2 || firedThisTick.has(id)) {
        later.push(id);
        continue;
      }
      const [x, y, z] = PADS.get(id);
      const loc = W(x, y, z);
      try {
        const block = dim().getBlock(loc);
        if (!block) {
          this.stats.deferred++;
          later.push(id);
          continue;
        }
        if (block.typeId === 'minecraft:redstone_block') {
          // Still powered from an earlier fire: command blocks did not run.
          this.stats.stuck++;
          log.warn(`actuator ${id} pad still powered - are command blocks enabled?`);
          block.setType('minecraft:air');
          later.push(id);
          continue;
        }
        block.setType('minecraft:redstone_block');
        this.lastFire.set(id, now);
        firedThisTick.add(id);
        this.stats.fired++;
      } catch (e) {
        this.stats.deferred++;
        later.push(id);
        log.warn(`actuator ${id} deferred: ${e?.message ?? e}`);
      }
    }
    this.queue = later;
  }

  onDiag(message) {
    if (message === 'pong') this.pong = system.currentTick;
    if (message === 'heartbeat') this.heartbeat = system.currentTick;
  }

  /** True when the repeating heartbeat command block has reported recently. */
  commandBlocksAlive() {
    return system.currentTick - this.heartbeat < 240;
  }
}
