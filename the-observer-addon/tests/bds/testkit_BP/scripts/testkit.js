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
        const perm = BlockPermutation.resolve(id);
        console.warn(`[OTEST] states ${id} ${JSON.stringify(perm.getAllStates())} TYPE ${perm.type.id}`);
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

// dev (1.6.0): which way the rift's pieces turn. Lays rift:edge_1 down four times (no turn, 90, 180, 270) and reports
// which side of each has no ground (the edge is drawn on the north side), and the lip's barrier count.
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "otest:riftedge") return;
  riftEdge().catch(fail("riftedge"));
});
async function riftEdge() {
  const say = (m) => console.warn(`[OTEST] riftedge ${m}`);
  const d = world.getDimension("observer:rift");
  const rots = ["None", "Rotate90", "Rotate180", "Rotate270"];
  for (let k = 0; k < 4; k++) {
    const x0 = 2000 + k * 64, z0 = 2000;
    d.runCommand(`tickingarea add ${x0} 0 ${z0} ${x0 + 47} 0 ${z0 + 47} redge${k} true`);
  }
  for (let w = 0; w < 400 && ![0, 1, 2, 3].every((k) => d.isChunkLoaded({ x: 2000 + k * 64 + 40, y: 64, z: 2040 })); w++) await new Promise((r) => system.runTimeout(r, 2));
  for (let k = 0; k < 4; k++) {
    const x0 = 2000 + k * 64, z0 = 2000;
    const t0 = Date.now();
    world.structureManager.place("rift:edge_1", d, { x: x0, y: 48, z: z0 }, { rotation: rots[k], includeEntities: false });
    const ms = Date.now() - t0;
    // ground at y 64 along each side, 4 blocks in, over the middle 20 blocks
    const side = (f) => {
      let n = 0;
      for (let i = 14; i < 34; i++) {
        const [x, z] = f(i);
        const b = d.getBlock({ x: x0 + x, y: 63, z: z0 + z });
        if (b && !b.isAir) n++;
      }
      return n;
    };
    const north = side((i) => [i, 4]), south = side((i) => [i, 43]), west = side((i) => [4, i]), east = side((i) => [43, i]);
    say(`${rots[k]} ms=${ms} ground north=${north} south=${south} west=${west} east=${east}`);
  }
  for (let k = 0; k < 4; k++) d.runCommand(`tickingarea remove redge${k}`);
  say("DONE");
}

// dev (1.6.0): the rift's realm as laid out — every piece down (ground under each cell's middle), the chests, barrels and
// lecterns in each inner cell, anything unknown, and what a chest holds before anyone opens it
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "otest:riftcheck") return;
  riftCheck().catch(fail("riftcheck"));
});
async function riftCheck() {
  const { BlockVolume } = await import("@minecraft/server");
  const say = (m) => console.warn(`[OTEST] riftcheck ${m}`);
  const d = world.getDimension("observer:rift");
  const O = { x: -128, z: -128 }, C = 48;
  for (let k = 0; k < 3; k++) d.runCommand(`tickingarea add ${O.x + k * 80} 0 ${O.z} ${O.x + k * 80 + 79} 0 ${O.z + 239} rcheck${k} true`);
  for (let w = 0; w < 600; w++) {
    let ok = true;
    for (let i = 0; i < 5 && ok; i++) for (let j = 0; j < 5 && ok; j++) ok = d.isChunkLoaded({ x: O.x + i * C + 24, y: 64, z: O.z + j * C + 24 });
    if (ok) break;
    await new Promise((r) => system.runTimeout(r, 2));
  }
  let empty = 0;
  const rows = [];
  for (let j = 0; j < 5; j++) {
    let row = "";
    for (let i = 0; i < 5; i++) {
      const x0 = O.x + i * C, z0 = O.z + j * C;
      let ground = 0, n = 0;
      for (let dx = 4; dx < C; dx += 8) for (let dz = 4; dz < C; dz += 8) {
        n++;
        const top = d.getTopmostBlock({ x: x0 + dx, z: z0 + dz });
        if (top && top.y >= 55) ground++;
      }
      if (i > 0 && i < 4 && j > 0 && j < 4 && ground < n * 0.9) empty++;
      let chests = 0, barrels = 0, lecterns = 0, unknown = 0;
      try {
        const vol = new BlockVolume({ x: x0, y: 40, z: z0 }, { x: x0 + C - 1, y: 100, z: z0 + C - 1 });
        const it = (types) => {
          let c = 0;
          for (const _ of d.getBlocks(vol, { includeTypes: types }, true).getBlockLocationIterator()) c++;
          return c;
        };
        chests = it(["minecraft:chest"]);
        barrels = it(["minecraft:barrel"]);
        lecterns = it(["minecraft:lectern"]);
        unknown = it(["minecraft:unknown"]);
        if (chests && !globalThis.__riftChestSeen) {
          const loc = d.getBlocks(vol, { includeTypes: ["minecraft:chest"] }, true).getBlockLocationIterator().next().value;
          const inv = d.getBlock(loc)?.getComponent("minecraft:inventory")?.container;
          say(`a chest at ${JSON.stringify(loc)} holds ${inv ? inv.size - inv.emptySlotsCount : "?"} stacks before it is opened`);
          globalThis.__riftChestSeen = true;
        }
      } catch (e) {
        say(`cell ${i},${j} scan failed ${e}`);
      }
      say(`cell ${i},${j} ground ${ground}/${n} chests ${chests} barrels ${barrels} lecterns ${lecterns} unknown ${unknown}`);
      row += ground >= n * 0.9 ? "#" : ground > 0 ? "+" : ".";
    }
    rows.push(row);
  }
  say(`map ${rows.join("|")}`);
  say(empty ? `FAIL inner cells without ground: ${empty}` : "PASS every inner cell has its ground");
  for (let k = 0; k < 3; k++) d.runCommand(`tickingarea remove rcheck${k}`);
  say("DONE");
}

// dev (1.6.0): what the rift's loot tables give — each spawned three times; the items, their enchantments, and any
// table that gives nothing
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "otest:riftloot") return;
  riftLoot(ev.message.trim().split(/\s+/)).catch(fail("riftloot"));
});
async function riftLoot(tables) {
  const say = (m) => console.warn(`[OTEST] riftloot ${m}`);
  const d = world.getDimension("overworld");
  const at = { x: 0, y: 200, z: 0 };
  d.runCommand("tickingarea add circle 0 0 0 1 rloot true");
  for (let w = 0; w < 200 && !d.isChunkLoaded(at); w++) await new Promise((r) => system.runTimeout(r, 2));
  for (const t of tables) {
    const seen = new Map();
    let stacks = 0, enchanted = 0;
    const ench = new Set();
    for (let k = 0; k < 3; k++) {
      for (const e of d.getEntities({ type: "minecraft:item", location: at, maxDistance: 8 })) e.remove();
      try {
        d.runCommand(`loot spawn ${at.x} ${at.y} ${at.z} loot "rift/${t}"`);
      } catch (e) {
        say(`FAIL ${t} command ${e}`);
        break;
      }
      await new Promise((r) => system.runTimeout(r, 2));
      for (const e of d.getEntities({ type: "minecraft:item", location: at, maxDistance: 8 })) {
        const it = e.getComponent("minecraft:item")?.itemStack;
        if (!it) continue;
        stacks++;
        seen.set(it.typeId, (seen.get(it.typeId) ?? 0) + it.amount);
        const en = it.getComponent("minecraft:enchantable")?.getEnchantments() ?? [];
        if (en.length) enchanted++;
        for (const x of en) ench.add(`${x.type.id}${x.level}`);
        e.remove();
      }
    }
    say(`${stacks ? "PASS" : "FAIL"} ${t}: ${stacks} stacks, ${enchanted} enchanted; ${[...seen].map(([k, v]) => `${k.replace("minecraft:", "")}x${v}`).join(" ")}`);
    say(`${t} enchantments: ${[...ench].join(" ")}`);
  }
  d.runCommand("tickingarea remove rloot");
  say("DONE");
}

// dev (1.7.0): what lies underground — the cave biomes. otest:cavemap [half] [step] [y,y,…]: loads the square ±half round
// 0,0 window by window and counts the biome at each sample height every step blocks (the Hollows, the Stillwater Caves,
// dripstone and lush caves, the deep dark, the rest), and the Hollows' share at each height
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "otest:cavemap") return;
  const [h, st, ys] = ev.message.trim().split(/\s+/);
  caveMap(Number(h) || 480, Number(st) || 16, (ys || "-40,-20,0,20,40").split(",").map(Number)).catch(fail("cavemap"));
});
async function caveMap(half, step, ys) {
  const dim = world.getDimension("overworld");
  const counts = {};
  const byY = {};
  let total = 0;
  const W = 480, span = 160;
  for (let wx = -half; wx < half; wx += W) for (let wz = -half; wz < half; wz += W) {
    const areas = [];
    for (let x = wx; x < Math.min(half, wx + W); x += span) for (let z = wz; z < Math.min(half, wz + W); z += span) areas.push([x, z]);
    areas.forEach(([x, z], i) => {
      try {
        dim.runCommand(`tickingarea add ${x} 0 ${z} ${Math.min(half, x + span) - 1} 0 ${Math.min(half, z + span) - 1} cm${i} true`);
      } catch (e) {
        console.warn(`[OTEST] cavemap area ${i} failed ${e}`);
      }
    });
    const cols = [];
    for (let x = wx + 4; x < Math.min(half, wx + W); x += step) for (let z = wz + 4; z < Math.min(half, wz + W); z += step) cols.push({ x, z });
    for (let t = 0; t < 900; t++) {
      let ok = 0, tot = 0;
      for (let k = 0; k < cols.length; k += 23) {
        tot++;
        if (dim.isChunkLoaded({ x: cols[k].x, y: 0, z: cols[k].z })) ok++;
      }
      if (ok >= tot) break;
      await new Promise((r) => system.runTimeout(r, 20));
    }
    for (const c of cols) for (const y of ys) {
      let id = "?";
      try {
        id = dim.getBiome({ x: c.x, y, z: c.z })?.id ?? "?";
      } catch {}
      const k = /hollows|stillwater|dripstone|lush|deep_dark/.test(id) ? id.replace(/^[a-z_]+:/, "") : "other";
      counts[k] = (counts[k] ?? 0) + 1;
      byY[y] ??= {};
      byY[y][k] = (byY[y][k] ?? 0) + 1;
      total++;
    }
    areas.forEach((_, i) => {
      try {
        dim.runCommand(`tickingarea remove cm${i}`);
      } catch {}
    });
    await new Promise((r) => system.runTimeout(r, 40));
  }
  const pct = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${((100 * v) / n).toFixed(1)}%`).join(" ");
  console.warn(`[OTEST] cavemap all (${total} samples): ${pct(counts, total)}`);
  for (const y of ys) {
    const n = Object.values(byY[y] ?? {}).reduce((a, b) => a + b, 0);
    console.warn(`[OTEST] cavemap y=${y}: ${pct(byY[y] ?? {}, n)}`);
  }
  console.warn("[OTEST] cavemap DONE");
}

// dev (1.7.0): the cave biomes over a wide area, sparsely: otest:cavewide [half] [step] — one chunk loaded per sample column
// (ten at a time), the biome at y -30, 0 and 20
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "otest:cavewide") return;
  const [h, st] = ev.message.trim().split(/\s+/).map(Number);
  caveWide(h || 1024, st || 64).catch(fail("cavewide"));
});
async function caveWide(half, step) {
  const dim = world.getDimension("overworld");
  const cols = [];
  for (let x = -half; x < half; x += step) for (let z = -half; z < half; z += step) cols.push({ x: x + 8, z: z + 8 });
  const counts = {};
  let total = 0;
  for (let i = 0; i < cols.length; i += 10) {
    const batch = cols.slice(i, i + 10);
    batch.forEach((c, k) => {
      try {
        dim.runCommand(`tickingarea add circle ${c.x} 0 ${c.z} 0 cw${k} true`);
      } catch {}
    });
    for (let t = 0; t < 200 && !batch.every((c) => dim.isChunkLoaded({ x: c.x, y: 0, z: c.z })); t++) await new Promise((r) => system.runTimeout(r, 2));
    for (const c of batch) for (const y of [-30, 0, 20]) {
      let id = "?";
      try {
        id = dim.getBiome({ x: c.x, y, z: c.z })?.id ?? "?";
      } catch {}
      const k = /hollows|stillwater|dripstone|lush|deep_dark/.test(id) ? id.replace(/^[a-z_]+:/, "") : "other";
      counts[k] = (counts[k] ?? 0) + 1;
      total++;
    }
    batch.forEach((_, k) => {
      try {
        dim.runCommand(`tickingarea remove cw${k}`);
      } catch {}
    });
  }
  console.warn(`[OTEST] cavewide ${2 * half} blocks (${total} samples): ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${((100 * v) / total).toFixed(1)}%`).join(" ")}`);
  console.warn("[OTEST] cavewide DONE");
}

// dev (1.7.0): the Hollows underground — found by sampling outward from 0,0 (/locate does not take custom biomes), then
// what it is made of round there: its painted walls, its flesh, its organs, its great chambers' bone (ribstone)
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "otest:hollows") return;
  hollowsCheck(Number(ev.message.trim()) || 3).catch(fail("hollows"));
});
async function hollowsCheck(want) {
  const { BlockVolume } = await import("@minecraft/server");
  const say = (m) => console.warn(`[OTEST] hollows ${m}`);
  const dim = world.getDimension("overworld");
  const found = [];
  const cols = [];
  for (let r = 0; r <= 1536; r += 96) for (let a = 0; a < 360; a += r ? Math.max(6, 6000 / r) : 360) cols.push({ x: Math.round(r * Math.cos((a * Math.PI) / 180)), z: Math.round(r * Math.sin((a * Math.PI) / 180)) });
  for (let i = 0; i < cols.length && found.length < want; i += 10) {
    const batch = cols.slice(i, i + 10);
    batch.forEach((c, k) => {
      try {
        dim.runCommand(`tickingarea add circle ${c.x} 0 ${c.z} 0 hs${k} true`);
      } catch {}
    });
    for (let t = 0; t < 200 && !batch.every((c) => dim.isChunkLoaded({ x: c.x, y: 0, z: c.z })); t++) await new Promise((r) => system.runTimeout(r, 2));
    for (const c of batch) for (const y of [-30, -10, 10, 30]) {
      let id = "";
      try {
        id = dim.getBiome({ x: c.x, y, z: c.z })?.id ?? "";
      } catch {}
      if (id === "shaftbreaker:the_hollows" && !found.some((f) => Math.hypot(f.x - c.x, f.z - c.z) < 200)) found.push({ x: c.x, y, z: c.z });
    }
    batch.forEach((_, k) => {
      try {
        dim.runCommand(`tickingarea remove hs${k}`);
      } catch {}
    });
  }
  say(`found ${found.length}: ${JSON.stringify(found)}`);
  const types = ["shaftbreaker:veinstone", "shaftbreaker:fleshstone", "shaftbreaker:cracked_veinstone", "shaftbreaker:pulsing_flesh", "shaftbreaker:ribstone",
    "shaftbreaker:organ_core", "shaftbreaker:bloodmoss", "shaftbreaker:bloodroot_vines", "shaftbreaker:dripfang", "shaftbreaker:watcher_pod", "shaftbreaker:glowspore_cluster",
    "minecraft:air", "minecraft:water"];
  let total = 0;
  for (const f of found) {
    dim.runCommand(`tickingarea add circle ${f.x} 0 ${f.z} 3 hsx true`);
    for (let t = 0; t < 300 && !dim.isChunkLoaded({ x: f.x + 40, y: 0, z: f.z + 40 }); t++) await new Promise((r) => system.runTimeout(r, 2));
    const vol = new BlockVolume({ x: f.x - 40, y: Math.max(-60, f.y - 24), z: f.z - 40 }, { x: f.x + 40, y: f.y + 24, z: f.z + 40 });
    const counts = {};
    for (const ty of types) {
      let n = 0;
      try {
        for (const _ of dim.getBlocks(vol, { includeTypes: [ty] }, true).getBlockLocationIterator()) n++;
      } catch (e) {
        n = -1;
      }
      counts[ty.replace(/^[a-z_]+:/, "")] = n;
    }
    total += counts.veinstone > 0 ? 1 : 0;
    say(`at ${f.x},${f.y},${f.z}: ${JSON.stringify(counts)}`);
    dim.runCommand("tickingarea remove hsx");
  }
  say(found.length && total === found.length ? "PASS every Hollows found has its walls" : `FAIL ${total}/${found.length} with walls`);
  say("DONE");
}
