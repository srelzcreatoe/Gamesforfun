// In-world map builder. Executes the deterministic build plan
// (data/build_plan.js) with Dimension.fillBlocks inside a system.runJob
// generator (time-sliced, never more than a few fills per tick).
//
// The build is resumable: progress (phase + op index) is stored in the
// fnar:build dynamic property, so quitting mid-build continues on reload.
//   1. game rules, a ticking area over the whole lot (so every chunk stays loaded)
//   2. wait until every chunk of the lot reports loaded
//   3. run the plan phases in order
//   4. verification (palette + a few sample cells)

import { system } from '@minecraft/server';
import { generatePlan } from '../data/build_plan.js';
import { PHASES } from '../data/plan.js';
import { LOT, OFFICE } from '../data/layout.js';
import { dim, W, origin, fillLocal, listLocal, setLocal, runCmd, checkPalette, typeAtLocal, blockAt } from './world_io.js';
import { loadBuild, storeBuild } from './persistence.js';
import { log } from './log.js';

export const BUILD_VERSION = 4; // 4: the guard's seat by the desk, door buttons beside it (1.0.2)
const MAX_FILL = 32768;
const UNITS_PER_STEP = 6; // small ops per job step

function* splitFill(x1, y1, z1, x2, y2, z2) {
  const h = y2 - y1 + 1;
  const cols = Math.max(1, Math.floor(MAX_FILL / h));
  const side = Math.max(1, Math.floor(Math.sqrt(cols)));
  for (let x = x1; x <= x2; x += side) {
    for (let z = z1; z <= z2; z += side) yield [x, y1, z, Math.min(x2, x + side - 1), y2, Math.min(z2, z + side - 1)];
  }
}

/** World-space, chunk-aligned bounds of the lot (for the ticking area). */
export function lotWorldBounds() {
  const a = W(LOT.x1, LOT.baseY, LOT.z1);
  const b = W(LOT.x2, LOT.clearTop + 6, LOT.z2);
  const fl = (v) => Math.floor(v / 16) * 16;
  return { x1: fl(a.x), z1: fl(a.z), x2: fl(b.x) + 15, z2: fl(b.z) + 15, y1: a.y, y2: b.y };
}

export class Builder {
  /** @param {(msg: string, frac: number, report?: any) => void} onProgress */
  constructor(onProgress) {
    this.onProgress = onProgress;
    this.running = false;
    this.plan = null;
    this.errors = [];
  }

  isBuilt() {
    const b = loadBuild();
    return !!b.done && b.version === BUILD_VERSION && origin.set;
  }

  start({ rebuild = false } = {}) {
    if (this.running) return false;
    this.errors = [];
    const bad = checkPalette();
    if (bad.length) {
      log.error(`palette entries that do not resolve in this game version:\n${bad.join('\n')}`);
      this.errors.push(...bad.slice(0, 20));
    }
    this.running = true;
    if (rebuild) storeBuild({ version: BUILD_VERSION, done: false, phase: 0, op: 0 });
    const t = lotWorldBounds();
    runCmd('tickingarea remove fnar_lot');
    runCmd(`tickingarea add ${t.x1} ${t.y1} ${t.z1} ${t.x2} ${t.y2} ${t.z2} fnar_lot true`);
    system.runJob(this.job());
    return true;
  }

  *waitForChunks() {
    const t = lotWorldBounds();
    const probes = [];
    for (let x = t.x1; x <= t.x2; x += 16) for (let z = t.z1; z <= t.z2; z += 16) probes.push({ x: x + 8, y: origin.y, z: z + 8 });
    let waited = 0;
    for (;;) {
      const missing = probes.filter((p) => {
        try {
          return !dim().isChunkLoaded(p);
        } catch {
          return true;
        }
      }).length;
      if (!missing) return;
      if (waited % 40 === 0) this.onProgress?.(`Loading chunks... ${probes.length - missing}/${probes.length}`, 0);
      waited++;
      if (waited > 20 * 120) throw new Error('chunks did not load within 2 minutes (is the area too far from players?)');
      yield;
    }
  }

  *job() {
    try {
      yield* this.waitForChunks();
      this.plan ??= generatePlan();
      const state = loadBuild();
      if (state.version !== BUILD_VERSION || state.done) Object.assign(state, { version: BUILD_VERSION, done: false, phase: 0, op: 0 });
      const totalOps = PHASES.reduce((a, p) => a + this.plan.ops[p].length, 0);
      let doneOps = PHASES.slice(0, state.phase).reduce((a, p) => a + this.plan.ops[p].length, 0) + state.op;
      let units = 0;
      for (let pi = state.phase; pi < PHASES.length; pi++) {
        const name = PHASES[pi];
        const ops = this.plan.ops[name];
        for (let oi = pi === state.phase ? state.op : 0; oi < ops.length; oi++) {
          const op = ops[oi];
          if ((op[0] === 'F' || op[0] === 'A') && (op[4] - op[1] + 1) * (op[5] - op[2] + 1) * (op[6] - op[3] + 1) > MAX_FILL / 4) {
            for (const box of splitFill(op[1], op[2], op[3], op[4], op[5], op[6])) {
              this.execute([op[0], ...box, op[7]]);
              yield;
            }
          } else {
            this.execute(op);
            units += op[0] === 'L' ? Math.ceil(op[2].length / 300) : 1;
          }
          doneOps++;
          if (units >= UNITS_PER_STEP) {
            units = 0;
            storeBuild({ version: BUILD_VERSION, done: false, phase: pi, op: oi + 1 });
            if (doneOps % 20 === 0) this.onProgress?.(`Building: ${name}`, doneOps / totalOps);
            yield;
          }
        }
        storeBuild({ version: BUILD_VERSION, done: false, phase: pi + 1, op: 0 });
        this.onProgress?.(`Building: ${name} done`, doneOps / totalOps);
        yield;
      }
      storeBuild({ version: BUILD_VERSION, done: true, phase: PHASES.length, op: 0, builtAtTick: system.currentTick });
      const report = this.verify();
      this.running = false;
      this.onProgress?.('done', 1, report);
    } catch (e) {
      this.running = false;
      log.error('build failed', e);
      this.onProgress?.(`Build failed: ${e?.message ?? e}`, -1);
    }
  }

  execute(op) {
    try {
      switch (op[0]) {
        case 'F':
          fillLocal(op[1], op[2], op[3], op[4], op[5], op[6], op[7]);
          break;
        case 'A':
          fillLocal(op[1], op[2], op[3], op[4], op[5], op[6], op[7], true);
          break;
        case 'L':
          listLocal(op[1], op[2]);
          break;
        case 'T': {
          setLocal(op[1], op[2], op[3], op[4]);
          const sign = blockAt(op[1], op[2], op[3])?.getComponent('minecraft:sign');
          if (sign) {
            sign.setText(op[5].join('\n'));
            sign.setWaxed(true);
          }
          break;
        }
        default:
          throw new Error(`unknown op ${op[0]}`);
      }
    } catch (e) {
      if (this.errors.length < 60) this.errors.push(`${op[0]} ${op[0] === 'L' ? op[1] : op.slice(1, 8).join(',')}: ${e?.message ?? e}`);
    }
  }

  /** Post-build verification: a few cells that must hold specific blocks. */
  verify() {
    const B = OFFICE.buttons;
    const checks = [
      [OFFICE.monitor.x, OFFICE.monitor.y, OFFICE.monitor.z, 'fnar:crt_monitor'],
      [OFFICE.phone.x, OFFICE.phone.y, OFFICE.phone.z, 'fnar:desk_phone'],
      [B.door_l.x, B.door_l.y, B.door_l.z, 'fnar:door_button'],
      [B.light_r.x, B.light_r.y, B.light_r.z, 'fnar:light_button'],
      [OFFICE.vents.L.x, OFFICE.vents.L.y, OFFICE.vents.L.z, 'fnar:vent_cover'],
      [Math.floor(OFFICE.spawn.x), -1, Math.floor(OFFICE.spawn.z), 'fnar:tile_office'],
    ];
    const bad = [];
    for (const [x, y, z, want] of checks) {
      const t = typeAtLocal(x, y, z);
      if (t !== want) bad.push(`${x},${y},${z}: ${t} (want ${want})`);
    }
    if (bad.length) log.warn(`build verification: ${bad.join('; ')}`);
    return { errors: this.errors.slice(0, 60), missing: bad };
  }
}
