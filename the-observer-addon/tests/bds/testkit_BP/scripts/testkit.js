import { system, world, BlockPermutation } from "@minecraft/server";
import { runProto } from "./proto.js";
import { runSpeed } from "./speed.js";
import { runSuite, checkRecovery, interruptSetup, measureTps } from "./suite.js";
import "./rival.js";

const fail = (tag) => (e) => console.warn(`[OTEST] FAIL ${tag}_crash ${e} ${e && e.stack}`);
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id === "otest:speed") runSpeed().catch(fail("speed"));
  if (ev.id === "otest:proto") runProto().catch(fail("proto"));
  if (ev.id === "otest:suite") runSuite(ev.message.trim() ? ev.message.trim().split(/[\s,]+/) : []).catch(fail("suite"));
  if (ev.id === "otest:tps") measureTps().catch(fail("tps"));
  if (ev.id === "otest:recovery") checkRecovery().catch(fail("recovery"));
  if (ev.id === "otest:interrupt") interruptSetup().catch(fail("interrupt"));
  // dev: the full default states of some blocks (tools/make_structures.py needs them exactly)
  if (ev.id === "otest:states") {
    for (const id of ev.message.trim().split(/[\s,]+/)) {
      try {
        console.warn(`[OTEST] states ${id} ${JSON.stringify(BlockPermutation.resolve(id).getAllStates())}`);
      } catch (e) {
        console.warn(`[OTEST] states ${id} ERROR ${e}`);
      }
    }
  }
});
// dev (1.6.0): the rift dimension — can a player go there, can blocks and structures be placed, what biome, what spawns
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "otest:riftprobe") return;
  riftProbe().catch(fail("riftprobe"));
});
async function riftProbe() {
  const say = (m) => console.warn(`[OTEST] rift ${m}`);
  let d;
  try {
    d = world.getDimension("observer:rift");
    say(`PASS dimension ${d.id}`);
  } catch (e) {
    return say(`FAIL dimension ${e}`);
  }
  const ow = world.getDimension("overworld");
  // a simulated player, sent there
  const gt = await import("@minecraft/server-gametest");
  let p = world.getAllPlayers().find((x) => x.name === "Prober");
  if (!p) {
    try {
      p = gt.spawnSimulatedPlayer({ dimension: ow, x: 0, y: 120, z: 0 }, "Prober");
    } catch (e) {
      say(`FAIL simulated player ${e}`);
    }
  }
  try {
    d.runCommand("tickingarea add circle 0 0 0 2 riftprobe true");
    say("PASS tickingarea");
  } catch (e) {
    say(`FAIL tickingarea ${e}`);
  }
  for (let i = 0; i < 100 && !d.isChunkLoaded({ x: 0, y: 64, z: 0 }); i++) await new Promise((r) => system.runTimeout(r, 5));
  say(`chunk loaded ${d.isChunkLoaded({ x: 0, y: 64, z: 0 })}; height ${JSON.stringify(d.heightRange)}`);
  try {
    d.runCommand("fill -3 63 -3 3 63 3 minecraft:stone");
    say(`PASS fill -> ${d.getBlock({ x: 0, y: 63, z: 0 })?.typeId}`);
  } catch (e) {
    say(`FAIL fill ${e}`);
  }
  try {
    world.structureManager.place("wmire:eyebloom", d, { x: 1, y: 64, z: 1 });
    // (on stone the plant may pop: just check it was placed for a tick)
    say(`PASS structure -> ${d.getBlock({ x: 1, y: 66, z: 1 })?.typeId}`);
  } catch (e) {
    say(`FAIL structure ${e}`);
  }
  try {
    say(`biome ${d.getBiome({ x: 0, y: 64, z: 0 })?.id}`);
  } catch (e) {
    say(`FAIL biome ${e}`);
  }
  if (p) {
    try {
      p.teleport({ x: 0.5, y: 64, z: 0.5 }, { dimension: d });
      await new Promise((r) => system.runTimeout(r, 20));
      say(`PASS teleport -> ${p.dimension.id} ${JSON.stringify(p.location)}`);
      p.runCommand("fog @s push minecraft:fog_hell probe");
      say("PASS fog");
    } catch (e) {
      say(`FAIL teleport ${e}`);
    }
  }
  // what spawns there in a minute, in the dark, on a stone floor
  d.runCommand("fill -24 63 -24 24 63 24 minecraft:stone");
  await new Promise((r) => system.runTimeout(r, 20 * 60));
  const ents = d.getEntities().map((e) => e.typeId);
  say(`entities after a minute: ${JSON.stringify(ents)}`);
  if (p) {
    p.teleport({ x: 0.5, y: 120, z: 0.5 }, { dimension: ow });
    await new Promise((r) => system.runTimeout(r, 10));
    say(`back -> ${p.dimension.id}`);
  }
  say("DONE");
}

// dev: how big the Weeping Mire is round spawn, and in how many pieces (1.5.1). otest:miremap [half] [step]
//   loads the square ±half round 0,0 with ticking areas, samples the biome every step blocks, and logs the Mire's share,
//   its pieces (4-connected), the biggest, and a small map
if (true) {
  system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (ev.id !== "otest:miremap") return;
    const [h, st] = ev.message.trim().split(/\s+/).map(Number);
    mireMap(h || 240, st || 8).catch(fail("miremap"));
  });
}
async function mireMap(half, step) {
  const dim = world.getDimension("overworld");
  const n = Math.floor((2 * half) / step);
  const grid = [...Array(n)].map(() => Array(n).fill(0));
  let mire = 0, unknown = 0;
  // in windows of 480 blocks (nine ticking areas of 160), one after another
  const W = 480, span = 160;
  for (let wx = -half; wx < half; wx += W) for (let wz = -half; wz < half; wz += W) {
    const areas = [];
    for (let x = wx; x < Math.min(half, wx + W); x += span) for (let z = wz; z < Math.min(half, wz + W); z += span) areas.push([x, z]);
    areas.forEach(([x, z], i) => {
      try {
        dim.runCommand(`tickingarea add ${x} 0 ${z} ${Math.min(half, x + span) - 1} 0 ${Math.min(half, z + span) - 1} mm${i} true`);
      } catch (e) {
        console.warn(`[OTEST] miremap area ${i} failed ${e}`);
      }
    });
    const cells = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = -half + i * step + 4, z = -half + j * step + 4;
      if (x >= wx && x < wx + W && z >= wz && z < wz + W) cells.push([i, j, { x, y: 64, z }]);
    }
    for (let t = 0; t < 900; t++) {
      let ok = 0, tot = 0;
      for (let k = 0; k < cells.length; k += 23) {
        tot++;
        if (dim.isChunkLoaded(cells[k][2])) ok++;
      }
      if (ok >= tot) break;
      await new Promise((r) => system.runTimeout(r, 20));
    }
    for (const [i, j, pt] of cells) {
      let id = "";
      try {
        id = dim.getBiome(pt)?.id ?? "";
      } catch {
        unknown++;
      }
      if (id === "wmire:weeping_mire") {
        grid[i][j] = 1;
        mire++;
      } else if (id === "goatwalker:stellar_taiga") grid[i][j] = 2;
      else if (id === "shaftbreaker:the_hollows") grid[i][j] = 3;
    }
    areas.forEach((_, i) => {
      try {
        dim.runCommand(`tickingarea remove mm${i}`);
      } catch {}
    });
    await new Promise((r) => system.runTimeout(r, 40));
  }
  // (1.6.0) the other two surface biomes too, and where they meet the Mire
  const stats = (code) => {
    const seen2 = grid.map((r) => r.map(() => false));
    const out = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (grid[i][j] !== code || seen2[i][j]) continue;
      let size = 0;
      const st = [[i, j]];
      seen2[i][j] = true;
      while (st.length) {
        const [a, b] = st.pop();
        size++;
        for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c = a + da, d = b + db;
          if (c >= 0 && d >= 0 && c < n && d < n && grid[c][d] === code && !seen2[c][d]) {
            seen2[c][d] = true;
            st.push([c, d]);
          }
        }
      }
      out.push(size);
    }
    out.sort((x, y) => y - x);
    return out;
  };
  let touchMT = 0, touchMH = 0, touchTH = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (const [c, d] of [[i + 1, j], [i, j + 1]]) {
    if (c >= n || d >= n) continue;
    const pair = [grid[i][j], grid[c][d]].sort().join("");
    if (pair === "12") touchMT++;
    else if (pair === "13") touchMH++;
    else if (pair === "23") touchTH++;
  }
  for (const [code, label] of [[2, "stellar_taiga"], [3, "hollows"]]) {
    const z = stats(code);
    const cnt = z.reduce((a, b) => a + b, 0);
    console.warn(`[OTEST] biomemap ${label} share=${(cnt / (n * n)).toFixed(3)} pieces=${z.length} biggest=${(z[0] ?? 0) * step * step}`);
  }
  console.warn(`[OTEST] biomemap borders mire-taiga=${touchMT} mire-hollows=${touchMH} taiga-hollows=${touchTH} (sample edges)`);
  const seen = grid.map((r) => r.map(() => false));
  const sizes = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (grid[i][j] !== 1 || seen[i][j]) continue;
    let size = 0;
    const stack = [[i, j]];
    seen[i][j] = true;
    while (stack.length) {
      const [a, b] = stack.pop();
      size++;
      for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = a + da, d = b + db;
        if (c >= 0 && d >= 0 && c < n && d < n && grid[c][d] === 1 && !seen[c][d]) {
          seen[c][d] = true;
          stack.push([c, d]);
        }
      }
    }
    sizes.push(size);
  }
  sizes.sort((a, b) => b - a);
  const cell = step * step;
  console.warn(`[OTEST] miremap half=${half} step=${step} samples=${n * n} unknown=${unknown} mire=${mire} share=${(mire / (n * n)).toFixed(3)} pieces=${sizes.length} biggest=${(sizes[0] ?? 0) * cell} small(<1024)=${sizes.filter((s) => s * cell < 1024).length} sizes=${sizes.slice(0, 12).map((s) => s * cell).join(",")}`);
  const every = Math.max(1, Math.round(n / 60));
  for (let i = 0; i < n; i += every) console.warn(`[OTEST] map ${grid[i].filter((_, j) => j % every === 0).map((v) => ".MTH"[v] ?? "?").join("")}`);
  console.warn("[OTEST] MIREMAP DONE");
}

system.run(() => console.warn("[OTEST] testkit loaded"));
