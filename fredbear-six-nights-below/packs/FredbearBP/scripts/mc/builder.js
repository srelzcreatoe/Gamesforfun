// In-game map builder. Executes the deterministic build plan with
// Dimension.fillBlocks inside a system.runJob generator (time-sliced), then
// loads the command-block structures, places controls and writes signs.
//
// The build is resumable: progress (phase + op index) is stored in the
// fb:build dynamic property, so quitting mid-build continues on reload.
// Steps:
//   1. ticking areas (4 x 64 chunks) so every chunk can be written and stays loaded
//   2. wait until all build chunks report loaded
//   3. plan phases terrain .. consoles
//   4. command-block structures (world.structureManager.place)
//   5. plan phases controls + signs
//   6. verification (sample blocks, structure ids, palette)

import { system, world } from '@minecraft/server';
import { generatePlan } from '../data/build_plan.js';
import { CB_STRUCTURES } from '../data/cb_structures.generated.js';
import { COMMAND_TEMPLATES } from './commands.js';
import { dim, W, fillLocal, listLocal, setLocal, runCmd, checkPalette, typeAtLocal } from './world_io.js';
import { loadBuild, storeBuild } from './persistence.js';
import { INPUTS, inputCbPos } from '../data/inputs.js';
import { log } from './log.js';

export const BUILD_VERSION = 1;
const OPS_PER_TICK = 24; // fill operations per job slice
const MAX_FILL = 32768;

function* splitFill(op) {
  // Split large boxes into <= 32768-block columns so no single call is huge.
  const [, x1, y1, z1, x2, y2, z2] = op;
  const h = y2 - y1 + 1;
  const colsPerChunk = Math.max(1, Math.floor(MAX_FILL / h));
  const side = Math.max(1, Math.floor(Math.sqrt(colsPerChunk)));
  for (let x = x1; x <= x2; x += side) {
    for (let z = z1; z <= z2; z += side) yield [x, y1, z, Math.min(x2, x + side - 1), y2, Math.min(z2, z + side - 1)];
  }
}

export class Builder {
  constructor(onProgress) {
    this.onProgress = onProgress;
    this.running = false;
    this.plan = null;
    this.errors = [];
  }

  isBuilt() {
    const b = loadBuild();
    return b.done && b.version === BUILD_VERSION;
  }

  start({ rebuild = false } = {}) {
    if (this.running) return false;
    const bad = checkPalette();
    if (bad.length) {
      log.error(`palette invalid in this game version:\n${bad.join('\n')}`);
      this.errors.push(...bad);
    }
    this.running = true;
    if (rebuild) storeBuild({ version: BUILD_VERSION, done: false, phase: 0, op: 0 });
    for (const c of COMMAND_TEMPLATES.essentials) runCmd(c);
    for (const c of COMMAND_TEMPLATES.tickingAreas) runCmd(c);
    system.runJob(this.job());
    return true;
  }

  *waitForChunks() {
    const probes = [];
    for (let x = -12; x <= 211; x += 16) for (let z = -12; z <= 211; z += 16) probes.push(W(x, 0, z));
    probes.push(W(211, 0, 211));
    let waited = 0;
    for (;;) {
      const missing = probes.filter((p) => !dim().isChunkLoaded(p)).length;
      if (!missing) return;
      if (waited % 40 === 0) this.onProgress?.(`Loading chunks… ${probes.length - missing}/${probes.length}`, 0);
      waited++;
      yield;
    }
  }

  *job() {
    try {
      yield* this.waitForChunks();
      this.plan ??= generatePlan();
      const state = loadBuild();
      if (state.version !== BUILD_VERSION || state.done) Object.assign(state, { version: BUILD_VERSION, done: false, phase: 0, op: 0 });
      const phases = this.plan.phases;
      const structuresAfter = phases.findIndex((p) => p.name === 'consoles');
      const totalOps = phases.reduce((a, p) => a + p.ops.length, 0);
      let doneOps = phases.slice(0, state.phase).reduce((a, p) => a + p.ops.length, 0) + state.op;
      for (let pi = state.phase; pi < phases.length; pi++) {
        const ph = phases[pi];
        for (let oi = pi === state.phase ? state.op : 0; oi < ph.ops.length; oi++) {
          const op = ph.ops[oi];
          if (op[0] === 'F' && (op[4] - op[1] + 1) * (op[5] - op[2] + 1) * (op[6] - op[3] + 1) > MAX_FILL) {
            // Large fills are split and time-sliced (one sub-fill per job step).
            for (const box of splitFill(op)) {
              this.execute(['F', ...box, op[7]]);
              yield;
            }
          } else {
            this.execute(op);
          }
          doneOps++;
          if (doneOps % OPS_PER_TICK === 0) {
            storeBuild({ version: BUILD_VERSION, done: false, phase: pi, op: oi + 1 });
            this.onProgress?.(`Building ${ph.name}…`, doneOps / totalOps);
            yield;
          }
        }
        if (pi === structuresAfter) {
          this.onProgress?.('Installing command blocks…', doneOps / totalOps);
          yield* this.placeStructures();
        }
      }
      storeBuild({ version: BUILD_VERSION, done: true, phase: phases.length, op: 0, builtAtTick: system.currentTick });
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
          const block = dim().getBlock(W(op[1], op[2], op[3]));
          const sign = block?.getComponent('minecraft:sign');
          if (sign) {
            sign.setText(op[5]);
            sign.setWaxed(true);
          }
          break;
        }
        default:
          throw new Error(`unknown op ${op[0]}`);
      }
    } catch (e) {
      if (this.errors.length < 50) this.errors.push(`${op[0]} ${op.slice(1, 7).join(',')}: ${e?.message ?? e}`);
    }
  }

  *placeStructures() {
    const available = new Set(world.structureManager.getPackStructureIds());
    for (const s of CB_STRUCTURES) {
      if (!available.has(s.id)) {
        this.errors.push(`structure ${s.id} missing from the behavior pack`);
        continue;
      }
      try {
        world.structureManager.place(s.id, dim(), { x: s.at[0], y: s.at[1], z: s.at[2] });
      } catch (e) {
        this.errors.push(`structure ${s.id}: ${e?.message ?? e}`);
      }
      yield;
    }
  }

  /** Post-build verification: command blocks present where registered. */
  verify() {
    let cbOk = 0;
    const cbBad = [];
    for (const inp of INPUTS) {
      const [x, y, z] = inputCbPos(inp);
      const t = typeAtLocal(x, y, z);
      if (t === 'minecraft:command_block') cbOk++;
      else cbBad.push(`${inp.id} (${t})`);
    }
    const report = { errors: this.errors.slice(0, 50), inputBlocks: cbOk, inputBlocksMissing: cbBad };
    if (cbBad.length) log.warn(`missing input command blocks: ${cbBad.join(', ')}`);
    return report;
  }
}
