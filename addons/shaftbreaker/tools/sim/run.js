// Offline simulation of the Shaftbreaker scripts against a mock Bedrock API.
// usage: node tools/sim/run.js [minutes=120] [players=1] [seed=7] [scenario=mixed]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const MINUTES = Number(process.argv[2] || 120);
const NPLAYERS = Number(process.argv[3] || 1);
const SEED = Number(process.argv[4] || 7);
const SCENARIO = process.argv[5] || 'mixed';

// deterministic randomness
let rs = SEED * 9973 + 17;
Math.random = () => ((rs = (rs * 48271) % 2147483647) / 2147483647);

// ---- copy scripts + install mocks
const build = path.join(here, `build-${process.pid}`);   // per-process copy so several runs can go in parallel
process.on('exit', () => { try { fs.rmSync(build, { recursive: true, force: true }); } catch { /* ignore */ } });
fs.rmSync(build, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'Shaftbreaker_BP/scripts'), path.join(build, 'scripts'), { recursive: true });
for (const [name, file] of [['server', 'server.js'], ['server-ui', 'server-ui.js']]) {
  const d = path.join(here, 'node_modules/@minecraft', name);
  fs.mkdirSync(d, { recursive: true });
  // parallel runs share this shim: write atomically and only when it differs
  const put = (f, txt) => { const fp = path.join(d, f); try { if (fs.readFileSync(fp, 'utf8') === txt) return; } catch { /* missing */ } const tmp = `${fp}.${process.pid}.tmp`; fs.writeFileSync(tmp, txt); fs.renameSync(tmp, fp); };
  put('package.json', JSON.stringify({ name: `@minecraft/${name}`, type: 'module', main: 'index.js' }));
  put('index.js', `export * from ${JSON.stringify(pathToFileURL(path.join(here, 'mock', file)).href)};\n`);
}

const M = await import(pathToFileURL(path.join(here, 'mock/server.js')).href);
const { world, system, SIM, VoxelWorld, Player, ItemStack } = M;
const origWarn = console.warn;
const scriptLog = [];
console.warn = (...a) => { const s = a.join(' '); scriptLog.push(s); if (/\(x\d+\)|Error|TypeError|ReferenceError/.test(s)) SIM.errors.push(s); };

const vw = new VoxelWorld(SEED);
world._init(vw);
SIM.timeOfDay = SCENARIO === 'night' ? 18000 : 6000;
const dim = world.getDimension('minecraft:overworld');

// ---- protected blocks guard (T11)
const PROTECTED = /chest|cobblestone|door|planks|fence|bed/;
SIM.guardSet = (x, y, z, oldId, newId) => {
  if (PROTECTED.test(oldId) && oldId !== newId && !SIM.allowEdit) SIM.errors.push(`GRIEF: ${oldId} at ${x},${y},${z} -> ${newId} (t=${M.system.currentTick})`);
};

// ---- players
function findStart(i) {
  if (SCENARIO === 'night') {                                       // on the surface near the house and the trees
    for (let r = 0; r < 4000; r++) { const x = Math.floor(rand2(-30, 30)), z = Math.floor(rand2(-30, 30)); if (vw.standable(x, 61, z) && vw.sky(x, 61, z) > 0) return { x: x + 0.5, y: 61, z: z + 0.5 }; }
  }
  for (let r = 0; r < 4000; r++) {
    const x = Math.floor((Math.random() - 0.5) * 60), z = Math.floor((Math.random() - 0.5) * 60), y = Math.floor(-10 + Math.random() * 40);
    if (vw.standable(x, y, z) && vw.sky(x, y, z) === 0) return { x: x + 0.5, y, z: z + 0.5 };
  }
  return { x: 0.5, y: 20, z: 0.5 };
}
function rand2(a, b) { return a + Math.random() * (b - a); }
const STRATS = ['stairs', 'door', 'random', 'fighter'];
const bots = [];
for (let i = 0; i < NPLAYERS; i++) {
  const p = new Player(`Bot${i + 1}`, dim, findStart(i));
  p._spawnPoint = { x: 0, y: 61, z: 0, dimension: dim };
  world._players.push(p); world._entities.push(p);
  bots.push({ p, strat: SCENARIO === 'stairs' ? 'stairs' : SCENARIO === 'door' ? 'door' : SCENARIO === 'night' ? (i % 2 ? 'fighter' : 'house') : STRATS[i % STRATS.length], path: [], goal: null, mode: 'explore', lookT: 0, mineDir: null, mineLeft: 0, torchT: 0, react: 0, attackT: 0, deadT: 0, escapes: 0 });
}

// ---- boot the add-on exactly like the game would
await import(pathToFileURL(path.join(build, 'scripts/main.js')).href);
const registry = { registerEnum() {}, registerCommand(def, cb) { registry.cmd = { def, cb }; } };
system.beforeEvents.startup.fire({ customCommandRegistry: registry, blockComponentRegistry: {}, itemComponentRegistry: {} });
world.afterEvents.worldLoad.fire({});
if (SCENARIO === 'harmless') { const cfgm = await import(pathToFileURL(path.join(build, 'scripts/core/config.js')).href); cfgm.applyPreset('harmless'); }

// ---- path finding helper (BFS on voxel standable cells)
function bfs(from, goalFn, maxNodes = 3000, opts = {}) {
  const s = { x: Math.floor(from.x), y: Math.floor(from.y), z: Math.floor(from.z) };
  const key = (c) => `${c.x},${c.y},${c.z}`;
  const prev = new Map([[key(s), null]]); const q = [s];
  const ok = (x, y, z) => vw.solid(x, y - 1, z) && (vw.passable(x, y, z) || (opts.doors && /door/.test(vw.get(x, y, z)))) && (opts.crawl || vw.passable(x, y + 1, z) || (opts.doors && /door/.test(vw.get(x, y + 1, z))));
  while (q.length && prev.size < maxNodes) {
    const c = q.shift();
    if (goalFn(c)) { const out = []; let k = key(c); while (k) { const [x, y, z] = k.split(',').map(Number); out.push({ x, y, z }); k = prev.get(k); } return out.reverse(); }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1, -2]) {
      const n = { x: c.x + dx, y: c.y + dy, z: c.z + dz };
      if (dy === 1 && (!vw.passable(c.x, c.y + 1, c.z) || (!opts.crawl && !vw.passable(c.x, c.y + 2, c.z)))) continue;
      if (dy < 0 && !vw.passable(n.x, c.y, n.z)) continue;
      if (prev.has(key(n))) continue;
      if (ok(n.x, n.y, n.z)) { prev.set(key(n), key(c)); q.push(n); break; }
    }
  }
  return null;
}
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function moveAlong(e, pathArr, speed) {
  if (!pathArr || !pathArr.length) return false;
  const t = pathArr[0]; const c = { x: t.x + 0.5, y: t.y, z: t.z + 0.5 };
  const dx = c.x - e.location.x, dz = c.z - e.location.z; const L = Math.hypot(dx, dz);
  if (L < speed + 0.05) { e.location = { ...c }; pathArr.shift(); return true; }
  const ny = c.y > e.location.y ? c.y : (L < 0.55 ? c.y : e.location.y);
  e.location = { x: e.location.x + dx / L * speed, y: ny, z: e.location.z + dz / L * speed };
  e._vel = { x: dx / L * speed, y: 0, z: dz / L * speed };
  return true;
}
function faceDir(e, to) { e._rot = { x: 0, y: Math.atan2(-(to.x - e.location.x), to.z - e.location.z) * 57.2958 }; }
function angleTo(p, target) {
  const v = p.getViewDirection(); const e = p.getHeadLocation();
  const d = { x: target.x - e.x, y: target.y - e.y, z: target.z - e.z }; const L = Math.hypot(d.x, d.y, d.z) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (v.x * d.x + v.y * d.y + v.z * d.z) / L))) * 57.3;
}
function canSee(p, e) { const h = p.getHeadLocation(); const t = { x: e.location.x, y: e.location.y + 1.6, z: e.location.z }; const d = { x: t.x - h.x, y: t.y - h.y, z: t.z - h.z }; const L = Math.hypot(d.x, d.y, d.z); return !vw.raycast(h, d, L - 0.4, false, false); }

// ---- creature physics (stands in for the game's physics + navigation goals)
const cstate = new Map();
function cellFree(x, y, z, tall) { return vw.passable(Math.floor(x), Math.floor(y), Math.floor(z)) && (!tall || vw.passable(Math.floor(x), Math.floor(y) + 1, Math.floor(z))); }
function creatureStep(e) {
  const st = cstate.get(e.id) || { path: [], repath: 0, atkReady: 0, atkHitAt: 0, target: null };
  cstate.set(e.id, st);
  const mode = e.mode();
  const grav = !e._groups.has('sb:grav_off');
  const crawl = e._groups.has('sb:stance_crawl');
  // physics: velocity from impulses moves the body with collision; ground friction removes most of it each tick
  if (e._impulsed || e._impulse > 0) {
    const v = e._vel;
    const nx = e.location.x + v.x, nz = e.location.z + v.z;
    if (cellFree(nx, e.location.y, nz, !crawl)) e.location = { ...e.location, x: nx, z: nz };
    else if (cellFree(e.location.x + v.x, e.location.y + 1, e.location.z + v.z, !crawl) && vw.solid(Math.floor(nx), Math.floor(e.location.y), Math.floor(nz))) {
      e.location = { x: nx, y: Math.floor(e.location.y) + 1, z: nz };          // auto-step one block
    }
    e._vel = { x: v.x * 0.45, y: 0, z: v.z * 0.45 };
    e._impulsed = false; if (e._impulse > 0) e._impulse--;
  }
  if (grav) {
    const fx = Math.floor(e.location.x), fy = Math.floor(e.location.y), fz = Math.floor(e.location.z);
    if (vw.passable(fx, fy - 1, fz)) { e.location = { ...e.location, y: Math.max(e.location.y - 0.5, fy - 1) }; e.isOnGround = false; } else e.isOnGround = true;
  }
  if (!(mode === 'hunt' || mode === 'frenzy' || mode === 'rage')) return;
  const tp = world._players.find((p) => p.hasTag('sb_target') && p.isValid && !p._dead);
  if (!tp) return;
  st.target = tp;
  const doors = e._groups.has('sb:nav_doors');
  if (--st.repath <= 0 || !st.path.length || (e._tpTick || 0) > (st.planT || 0)) {
    st.planT = M.system.currentTick;
    const g = { x: Math.floor(tp.location.x), y: Math.floor(tp.location.y), z: Math.floor(tp.location.z) };
    st.path = bfs(e.location, (c) => Math.abs(c.x - g.x) + Math.abs(c.z - g.z) <= 1 && Math.abs(c.y - g.y) <= 1, 2500, { crawl, doors }) || [];
    st.repath = 10;
  }
  const spd = (mode === 'hunt' ? 0.36 : mode === 'rage' ? 0.44 * 1.3 : 0.45 * 1.12) * 0.5;
  if (st.path.length) { moveAlong(e, st.path, spd); faceDir(e, tp.location); }
  // delayed attack (engine goal) on the hunt target
  const t = M.system.currentTick;
  const d = d3(e.location, tp.location);
  if (!st.atkHitAt && t >= st.atkReady && d < 2.2) { st.atkHitAt = t + 10; }
  if (st.atkHitAt && t >= st.atkHitAt) {
    st.atkHitAt = 0; st.atkReady = t + 33;
    if (d3(e.location, tp.location) < 2.7 && !tp._dead) {
      SIM.hits.push({ t, n: mode === 'rage' ? 8 : mode === 'frenzy' ? 8 : 7, act: e._props['shaftbreaker:act'], phase: e._props['shaftbreaker:phase'], mode, src: 'engine', p: { ...tp.location }, c: { ...e.location }, los: canSee(tp, e) });
      world._damage(tp, mode === 'rage' ? 8 : mode === 'frenzy' ? 8 : 7, 'entityAttack', e);
    }
  }
}

// ---- bot brains
function randomGoal(p, r = 26) { for (let i = 0; i < 40; i++) { const x = Math.floor(p.location.x + (Math.random() - 0.5) * r * 2), z = Math.floor(p.location.z + (Math.random() - 0.5) * r * 2), y = Math.floor(p.location.y + (Math.random() - 0.5) * 10); if (vw.standable(x, y, z)) return { x, y, z }; } return null; }
function botStep(b) {
  const p = b.p; const t = M.system.currentTick;
  if (p._dead) {
    if (!b.deadT) b.deadT = t;
    if (t - b.deadT > 60) { p._dead = 0; b.deadT = 0; p._hp = 20; p.location = findStart(0); world.afterEvents.playerSpawn.fire({ player: p, initialSpawn: false }); b.mode = 'explore'; b.path = []; }
    return;
  }
  if (t % 80 === 0 && p._hp < 20) p._hp++;
  const sb = world._entities.find((e) => e.typeId === 'shaftbreaker:shaftbreaker' && e.isValid);
  const hunted = sb && (sb.mode() === 'hunt' || sb.mode() === 'frenzy' || sb.mode() === 'rage') && p.hasTag('sb_target');
  if (hunted && b.mode !== 'flee' && b.mode !== 'fight') {
    b.mode = b.strat === 'fighter' && Math.random() < 0.7 ? 'fight' : 'flee'; b.path = [];
    if (Math.random() < 0.12) { const it = dim.spawnItem(new ItemStack('minecraft:beef', 1), { ...p.location }); void it; }
  }
  if (!hunted && (b.mode === 'flee' || b.mode === 'fight')) { b.mode = 'explore'; b.path = []; b.escapes++; }
  if (b.mode === 'fight' && sb) {
    faceDir(p, sb.location);
    if (d3(p.location, sb.location) < 3.2 && t - b.attackT > 12) { b.attackT = t; if (Math.random() < 0.6) world._damage(sb, 7, 'entityAttack', p); }
    if (d3(p.location, sb.location) > 3) { b.path = bfs(p.location, (c) => d3(c, sb.location) < 2.5, 800) || []; moveAlong(p, b.path, 0.2); }
    if (p._hp < 8) { b.mode = 'flee'; b.path = []; }
    return;
  }
  if (b.mode === 'flee') {
    if (!b.path.length) {
      if (b.strat === 'stairs') b.path = bfs(p.location, (c) => vw.sky(c.x, c.y, c.z) > 0, 40000) || [];
      else if (b.strat === 'house') b.path = bfs(p.location, (c) => c.x >= 12 && c.x <= 16 && c.z >= 12 && c.z <= 16 && c.y === 61, 9000, { doors: true }) || [];
      else if (b.strat === 'door') b.path = bfs(p.location, (c) => c.x >= -29 && c.x <= -27 && c.z >= 7 && c.z <= 9 && c.y === 20, 6000, { doors: true }) || [];
      if (!b.path.length) { const g = sb ? (() => { for (let i = 0; i < 30; i++) { const c = randomGoal(p, 30); if (c && d3(c, sb.location) > d3(p.location, sb.location) + 8) return c; } return null; })() : null; if (g) b.path = bfs(p.location, (c) => c.x === g.x && c.y === g.y && c.z === g.z, 4000) || []; }
    }
    if (b.path.length) { const nx = b.path[0]; faceDir(p, { x: nx.x + 0.5, y: nx.y, z: nx.z + 0.5 }); moveAlong(p, b.path, 0.28); p.isSprinting = true; }
    else if (sb) faceDir(p, sb.location);
    if (b.strat === 'door' && /door/.test(vw.get(Math.floor(p.location.x), Math.floor(p.location.y), Math.floor(p.location.z)))) world.afterEvents.playerInteractWithBlock.fire({ player: p, block: dim.getBlock(p.location), isFirstEvent: true });
    if (b.strat === 'house' && !b.path.length && vw.getStates(14, 61, 10).open_bit) { vw.states.set('14,61,10', { open_bit: false, upper_block_bit: false }); vw.states.set('14,62,10', { open_bit: false, upper_block_bit: true }); }
    if (b.strat === 'stairs' && b.path.length && b.path[0].y > p.location.y) p.isClimbing = true; else p.isClimbing = false;
    return;
  }
  p.isSprinting = false;
  // react to a visible creature
  if (sb && canSee(p, sb) && d3(p.location, sb.location) < 40) {
    const ang = angleTo(p, { x: sb.location.x, y: sb.location.y + 2, z: sb.location.z });
    if (ang < 60 && !b.react) {
      const r = Math.random();
      b.reactKind = r < 0.42 ? 'stare' : r < 0.6 ? 'charge' : r < 0.7 ? 'hit' : 'away';
      b.react = t + 20 * (b.reactKind === 'stare' ? 3 + Math.random() * 10 : 2 + Math.random() * 4);
      (SIM.reacts ||= {})[b.reactKind] = (SIM.reacts[b.reactKind] || 0) + 1;
      if (b.reactKind === 'charge') b.path = bfs(p.location, (c) => d3(c, sb.location) < 3, 2500) || [];
      if (b.reactKind === 'hit') { const dd = d3(p.location, sb.location); if (dd < 30 && Math.random() < 0.7) world._damage(sb, dd < 3.5 ? 6 : 4, dd < 3.5 ? 'entityAttack' : 'projectile', p); }
    }
    if (b.react && t < b.react) {
      if (b.reactKind === 'away') { p._rot = { x: 0, y: p._rot.y + 180 }; b.react = 0; b.lookT = t + 60; return; }
      faceDir(p, sb.location);
      if (b.reactKind === 'charge' && b.path.length) { moveAlong(p, b.path, 0.26); p.isSprinting = true; }
      return;
    }
  } else if (!b.react || t >= b.react) b.react = 0;
  // mining run
  if (b.mode === 'mine') {
    if (t % 18 === 0) {
      const f = { x: Math.floor(p.location.x + b.mineDir.x), y: Math.floor(p.location.y), z: Math.floor(p.location.z + b.mineDir.z) };
      for (const dy of [0, 1]) {
        const id = vw.get(f.x, f.y + dy, f.z);
        if (/stone|deepslate|ore|gravel|tuff|dirt/.test(id)) { vw.set(f.x, f.y + dy, f.z, 'minecraft:air'); world.afterEvents.playerBreakBlock.fire({ player: p, block: dim.getBlock({ x: f.x, y: f.y + dy, z: f.z }), brokenBlockPermutation: { type: { id } }, dimension: dim }); }
      }
      if (vw.standable(f.x, f.y, f.z)) { p.location = { x: f.x + 0.5, y: f.y, z: f.z + 0.5 }; b.mineLeft--; } else b.mineLeft -= 2;
      faceDir(p, { x: p.location.x + b.mineDir.x * 5, y: p.location.y, z: p.location.z + b.mineDir.z * 5 });
      if (b.mineLeft <= 0) b.mode = 'explore';
    }
    return;
  }
  // torches
  if (t - b.torchT > 20 * 50 && Math.random() < 0.02) {
    b.torchT = t;
    const c = { x: Math.floor(p.location.x), y: Math.floor(p.location.y), z: Math.floor(p.location.z) };
    if (vw.get(c.x, c.y, c.z) === 'minecraft:air' && vw.sky(c.x, c.y, c.z) === 0) { vw.set(c.x, c.y, c.z, 'minecraft:torch'); world.afterEvents.playerPlaceBlock.fire({ player: p, block: dim.getBlock(c), dimension: dim }); }
  }
  // explore
  if (!b.path.length) {
    if (Math.random() < 0.18) { b.mode = 'mine'; const dirs = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]; b.mineDir = dirs[Math.floor(Math.random() * 4)]; b.mineLeft = 8 + Math.floor(Math.random() * 10); return; }
    const g = randomGoal(p); if (g) b.path = bfs(p.location, (c) => c.x === g.x && c.y === g.y && c.z === g.z, 3000) || [];
    if (!b.path.length && Math.random() < 0.3) b.pause = t + 60;
  }
  if (b.pause && t < b.pause) { if (t % 30 === 0) p._rot = { x: 0, y: p._rot.y + (Math.random() - 0.5) * 160 }; return; }
  if (t % 40 === 0 && Math.random() < 0.5) { p._rot = { x: 0, y: p._rot.y + (Math.random() - 0.5) * 300 }; b.lookT = t + 30; }
  if (b.lookT > t) return;
  if (b.path.length) { const nx = b.path[0]; faceDir(p, { x: nx.x + 0.5, y: nx.y, z: nx.z + 0.5 }); moveAlong(p, b.path, 0.2); }
}

// ---- invariants + stats
const stats = { maxCreatures: 0, spawns: 0, spawnInView: [], creatureInWall: 0, encounters: [], hitsBeforeTell: [], hitsInGrace: 0, frenzyMax: 0, tickMs: [], ugStart: {}, firstContact: {} };
SIM.onSpawn = (e) => {
  if (e.typeId !== 'shaftbreaker:shaftbreaker') return;
  stats.spawns++;
  for (const b of bots) {
    const p = b.p;
    const head = { x: e.location.x, y: e.location.y + 2.4, z: e.location.z };
    const ang = angleTo(p, head);
    const vis = canSee(p, { location: e.location });
    if (vis && ang < 50 && d3(p.location, e.location) < 48) stats.spawnInView.push({ t: M.system.currentTick, ang: ang.toFixed(0), d: d3(p.location, e.location).toFixed(1) });
  }
};
const huntTell = new Map();
const tpStats = { relocations: 0, visibleRelocations: [] };
SIM.onTeleport = (e, from, to) => {
  if (e.typeId !== 'shaftbreaker:shaftbreaker') return;
  e._tpTick = M.system.currentTick;                                // the engine stand-in must replan after any teleport
  if (d3(from, to) < 1.5) return;                                  // path steps are not relocations
  tpStats.relocations++;
  e._lastTp = { t: M.system.currentTick, to: { ...to }, stack: new Error().stack.split('\n').slice(2, 7).map((l) => l.trim().replace(/^at /, '').replace(/\(.*scripts\//, '(').replace(/\(file:.*\//, '(')).join(' < ') };
  if (SIM.particles.some((q) => q.id === 'shaftbreaker:vanish' && q.t === M.system.currentTick)) { tpStats.fxVanish = (tpStats.fxVanish || 0) + 1; return; }   // a visible vanish with its dust cloud: by design
  for (const b of bots) {
    for (const [lbl, pos] of [['from', from], ['to', to]]) {
      const head = { x: pos.x, y: pos.y + 2.2, z: pos.z };
      if (canSee(b.p, { location: pos }) && angleTo(b.p, head) < 50 && d3(b.p.location, pos) < 48) tpStats.visibleRelocations.push({ t: M.system.currentTick, lbl, d: d3(b.p.location, pos).toFixed(1), enc: dir.running() ? dir.running().tpl.id : 'lurk', stack: new Error().stack.split('\n').slice(2, 6).map((l) => l.trim().replace(/^at /, '').replace(/\(.*scripts\//, '(')).join(' < ') });
    }
  }
};
const GUIDES = {};
const presence = { ugTicks: 0, withCreature: 0, distSum: 0, seenTicks: 0 };
const dir = await import(pathToFileURL(path.join(build, 'scripts/ai/director.js')).href);
const WSM = await import(pathToFileURL(path.join(build, 'scripts/ai/worldstate.js')).href);
const crMod = await import(pathToFileURL(path.join(build, 'scripts/ai/creature.js')).href);
const LOGM = await import(pathToFileURL(path.join(build, 'scripts/core/log.js')).href);
const ALLTEL = new Set();
const brMod = await import(pathToFileURL(path.join(build, 'scripts/ai/brain.js')).href);
const mem = await import(pathToFileURL(path.join(build, 'scripts/ai/memory.js')).href);
const learnLog = [];
const encLog = []; const stateHist = {}; const wallWhy = {};
let lastRun = null;
let lastEncId = null;
const total = MINUTES * 60 * 20;
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  if ((SCENARIO === 'learn' || SCENARIO === 'harmless') && i > 0 && i % (20 * 60 * 6) === 0 && !dir.running()) {
    const b = bots[0];
    b.strat = i < total / 2 ? 'stairs' : 'door';
    b.p.location = b.strat === 'door' ? { x: -27.5, y: 20, z: 2.5 } : { x: 30.5, y: 20, z: 0.5 };
    b.path = []; b.mode = 'explore';
    const msg = dir.forceEncounter(b.p, 'hunt');
    learnLog.push(`t=${(i / 1200).toFixed(0)}m strat=${b.strat} ${msg}`);
  }
  if (SCENARIO === 'learn' && i % (20 * 60 * 3) === 0) { const pf = mem.profile(bots[0].p); learnLog.push(`t=${(i / 1200).toFixed(0)}m stairs=${pf.traits.escape_stairs.s.toFixed(0)}/${pf.traits.escape_stairs.c.toFixed(0)} n${pf.traits.escape_stairs.n} door=${pf.traits.escape_door.s.toFixed(0)}/${pf.traits.escape_door.c.toFixed(0)} n${pf.traits.escape_door.n} surface=${pf.traits.escape_surface.s.toFixed(0)} routes=${pf.routes.map((r) => r.n).join(',')}`); }
  for (const b of bots) botStep(b);
  for (const e of [...world._entities]) if (e.isValid && e.typeId === 'shaftbreaker:shaftbreaker') creatureStep(e);
  const s0 = process.hrtime.bigint();
  M._tick();
  const ms = Number(process.hrtime.bigint() - s0) / 1e6;
  stats.tickMs.push(ms);
  const sbs = world._entities.filter((e) => e.isValid && e.typeId === 'shaftbreaker:shaftbreaker');
  for (const m of world._entities) {
    if (!m.isValid || m.typeId !== 'shaftbreaker:shaft_moth' || !m._groups.has('sb:guide')) continue;
    const dens = WSM.ws().dens; if (!dens.length) continue;
    let den = dens[0], bd = 1e9; for (const d of dens) { const q = d3(m.location, d); if (q < bd) { bd = q; den = d; } }
    const g = (GUIDES[m.id] ||= { start: bd, min: bd, ticks: 0, solid: 0, moved: 0, aligned: 0, followerMin: 1e9, last: { ...m.location } });
    g.ticks++; g.min = Math.min(g.min, bd);
    if (vw.solid(Math.floor(m.location.x), Math.floor(m.location.y), Math.floor(m.location.z))) g.solid++;
    const mv = { x: m.location.x - g.last.x, z: m.location.z - g.last.z };
    if (Math.hypot(mv.x, mv.z) > 0.02) { g.moved++; const fd = m.getViewDirection(); if ((fd.x * mv.x + fd.z * mv.z) / Math.hypot(mv.x, mv.z) > 0.7) g.aligned++; }
    g.last = { ...m.location };
    for (const b of bots) g.followerMin = Math.min(g.followerMin, d3(b.p.location, m.location));
  }
  stats.maxCreatures = Math.max(stats.maxCreatures, sbs.length);
  for (const e of sbs) {
    const inBase = e.location.x > -30 && e.location.x < -26 && e.location.z > 6 && e.location.z < 10;
    if (inBase && !e._inBaseLogged) { e._inBaseLogged = 1; const r = dir.running(); console.log(`DEBUG creature entered base t=${(i / 1200).toFixed(2)}m mode=${e.mode()} act=${e._props['shaftbreaker:act']} enc=${r ? r.tpl.id : '-'} trail=${JSON.stringify((e._trail || []).slice(-8).map((q) => [q.x.toFixed(2), q.y.toFixed(1), q.z.toFixed(2)]))} now=${JSON.stringify(e.location)} groups=${[...e._groups].join(',')}`); }
    e._prev = { ...e.location }; (e._trail ||= []).push({ ...e.location }); if (e._trail.length > 40) e._trail.shift();
    const x = Math.floor(e.location.x), y = Math.floor(e.location.y), z = Math.floor(e.location.z);
    if (!e._groups.has('sb:grav_off') && vw.solid(x, y, z)) { stats.creatureInWall++; if (stats.creatureInWall <= 3) console.log('INWALL lastTp', JSON.stringify(e._lastTp), JSON.stringify((e._trail || []).slice(-6).map((q) => [q.x.toFixed(2), q.y.toFixed(2), q.z.toFixed(2)])), e.mode(), 'cell', x, y, z, vw.get(x, y, z)); const r = dir.running(); const k = `${r ? r.tpl.id : '-'}:${e.mode()}:act${e._props['shaftbreaker:act']}`; wallWhy[k] = (wallWhy[k] || 0) + 1; }
    const act = e._props['shaftbreaker:act'];
    if (act === 35 || act === 16) { if (!huntTell.has(e.id)) huntTell.set(e.id, M.system.currentTick); }
    if (act !== e._lastAct) { if (act === 35 || act === 16) (SIM.huntTells ||= []).push(M.system.currentTick); if (act === 17 || act === 43 || act === 44 || act === 35) (SIM.tells ||= []).push(M.system.currentTick); e._lastAct = act; }
    if (e._props['shaftbreaker:phase'] === 'frenzy') { e._fz = (e._fz || 0) + 1; stats.frenzyMax = Math.max(stats.frenzyMax, e._fz); }
  }
  for (let k = (SIM._hbSeen || 0); k < SIM.sounds.length; k++) { const x = SIM.sounds[k]; if (x.id !== 'shaftbreaker.heartbeat' || x.ctx !== 'lurk') continue; const b = bots.find((q) => q.p.name === x.who); const sb = sbs[0]; if (!b || !sb) continue; const dd = d3(sb.location, b.p.location); const vis = canSee(b.p, sb) && angleTo(b.p, { x: sb.location.x, y: sb.location.y + 2, z: sb.location.z }) < 50; const key = `${dd < 8 ? '<8' : dd < 14 ? '<14' : dd < 24 ? '<24' : '24+'}:${vis ? 'vis' : 'hid'}`; (SIM.hbWhy ||= {})[key] = (SIM.hbWhy[key] || 0) + 1; }
  SIM._hbSeen = SIM.sounds.length;
  const r = dir.running();
  SIM.curEnc = r ? r.tpl.id : (sbs.length ? 'lurk' : 'absent');
  if (r !== lastRun) { if (r) encLog.push({ t: M.system.currentTick, id: r.tpl.id, f: r.tpl.family, p: r.ctx.player.name }); lastRun = r; }
  if (i % 100 === 0) for (const r of LOGM.recent(60)) ALLTEL.add(r);
  if (process.env.SBDBG && i % 1200 === 0) { const b = bots[0]; const st = dir.pstate(b.p); const B = brMod.brainState(); const c = crMod.creature(); console.log(`DBG t=${(i / 1200).toFixed(0)}m night=${st.night} ug=${st.underground} ugT=${(st.ugTicks / 20).toFixed(0)} grace=${Math.max(0, st.graceUntil - i)} cr=${!!c} tgt=${B.targetId === b.p.id} mapFor=${B.mapFor === b.p.id} mapAge=${i - B.mapT} nextShow=${st.nextShow ? ((st.nextShow - i) / 20).toFixed(0) : '-'} run=${dir.running() ? dir.running().tpl.id : '-'} pos=${b.p.location.x.toFixed(0)},${b.p.location.y.toFixed(0)},${b.p.location.z.toFixed(0)} elig=${brMod.presenceEligible(b.p)} arrDelay=${st.arrivalDelay} nextArr=${B.nextArrival - i}`); }
  if (i % 200 === 0) for (const b of bots) { const st = dir.pstate(b.p).state; stateHist[st] = (stateHist[st] || 0) + 1; }
  if (i % 20 === 0) for (const b of bots) {
    const ugNow = vw.sky(Math.floor(b.p.location.x), Math.floor(b.p.location.y) + 1, Math.floor(b.p.location.z)) === 0;
    if (!ugNow) continue;
    presence.ugTicks++;
    const sb = sbs[0];
    if (sb) { presence.withCreature++; presence.distSum += d3(sb.location, b.p.location); { const dd = d3(sb.location, b.p.location); const k = SIM.curEnc === 'lurk' ? (dd < 10 ? 'lurk<10' : dd < 16 ? 'lurk<16' : 'lurk16+') : 'enc'; if (k === 'lurk<10') { const c = crMod.creature(); const B = brMod.brainState(); const why = `${c && c.moving ? 'mov' : 'still'}:${c && c.stepMode ? 'step' : 'phys'}:${B.map && B.mapFor === b.p.id ? 'map' : 'nomap'}:${brMod.hiddenSpot(b.p, 12, 30) ? 'spot' : 'nospot'}:${b.mode}`; presence.why = presence.why || {}; presence.why[why] = (presence.why[why] || 0) + 1; } presence.hist = presence.hist || {}; presence.hist[k] = (presence.hist[k] || 0) + 1; } if (canSee(b.p, sb) && angleTo(b.p, { x: sb.location.x, y: sb.location.y + 2, z: sb.location.z }) < 50) presence.seenTicks++; }
  }
  for (const b of bots) {
    const ug = b.p.location.y < 55 && vw.sky(Math.floor(b.p.location.x), Math.floor(b.p.location.y) + 1, Math.floor(b.p.location.z)) === 0;
    if (ug && stats.ugStart[b.p.name] === undefined) stats.ugStart[b.p.name] = M.system.currentTick;
  }
}
const wall = (Date.now() - t0) / 1000;

// hits: every creature hit must follow a telegraph by >= 1.8 s
for (const h of SIM.hits) {
  const tells = (SIM.huntTells || []).filter((t) => t <= h.t);
  const lastTell = tells.length ? Math.max(...tells) : -1e9;
  if (h.src === 'engine' && h.t - lastTell > 20 * 60) stats.hitsBeforeTell.push({ ...h, why: 'engine hit with no roar/scream in the last minute' });
  if (h.t - lastTell < 36 && h.src === 'engine') stats.hitsBeforeTell.push(h);
  // scripted hits (lunge / claw) need their own wind-up within the previous 2 s, or a roar/scream earlier in the chase
  if (h.src === 'script' && !(SIM.tells || []).some((t) => t <= h.t && h.t - t <= 40) && !(lastTell > -1e9 && h.t - lastTell < 20 * 60)) stats.hitsBeforeTell.push({ ...h, why: 'scripted hit without wind-up' });
  if (h.phase === 'dormant') stats.hitsBeforeTell.push({ ...h, why: 'dormant phase' });
}

// telemetry from the scripts' own recorder
const log = await import(pathToFileURL(path.join(build, 'scripts/core/log.js')).href);
const ws = await import(pathToFileURL(path.join(build, 'scripts/ai/worldstate.js')).href);
const recs = log.recent(60);
for (const r of log.recent(60)) ALLTEL.add(r);
{
  const all = [...ALLTEL];
  const notes = all.flatMap((r) => r.notes || []);
  const cnt = (re) => notes.filter((n) => re.test(n)).length;
  const by = (re, strip) => notes.filter((n) => re.test(n)).reduce((a, n) => { const k = n.replace(strip, ''); a[k] = (a[k] || 0) + 1; return a; }, {});
  const shows = all.filter((r) => r.id === 'stalk_show');
  const rages = all.filter((r) => (r.notes || []).some((n) => /^rage \(/.test(n)));
  const firstShow = encLog.find((e) => e.id === 'stalk_show');
  const firstChase = (SIM.musics || []).find((m) => m.id === 'music.shaftbreaker.chase');
  const firstRage = firstChase ? { t: firstChase.t } : null;
  console.log(`STALKER: shows ${shows.length} by kind ${JSON.stringify(by(/^show:/, /^show:/))}; reactions ${JSON.stringify(by(/^reaction:/, /^reaction:/))}; standoff ${JSON.stringify(by(/^standoff:/, /^standoff:/))}`);
  console.log(`STALKER: show outcomes ${JSON.stringify(shows.reduce((a, r) => { a[r.outcome] = (a[r.outcome] || 0) + 1; return a; }, {}))}; tests ${JSON.stringify(by(/^test:/, /^test:/))}; creeps ${cnt(/^crept/)}; lunges ${cnt(/^lunge$/)} (hit ${cnt(/^lunge hit/)}); close strikes ${cnt(/^close strike/)}; rages ${rages.length} why ${JSON.stringify(by(/^rage \(/, /^rage \(|\)$/g))}; ambush armed ${cnt(/^ambush armed/)}, ambushes ${all.filter((r) => r.id === 'stalk_ambush').length}; breaches ${cnt(/^breach:/)}; vanished-in-place ${cnt(/vanished in place|exit: vanished/)}`);
  { // everything it opened or smashed must be back once no chase is running
    const brm = await import(pathToFileURL(path.join(build, 'scripts/world/breach.js')).href);
    const pendingAtEnd = brm.pendingBreaches(); const huntAtEnd = dir.running() ? dir.running().tpl.family === 'hunt' : false;
    console.log(`BREACH: still pending when the run ended: ${pendingAtEnd} (hunt running at end: ${huntAtEnd})`);
    if (!huntAtEnd) brm.restoreBreaches({});
    const glassGone = []; for (let x = 10; x <= 18; x++) for (let z = 10; z <= 18; z++) if ((x === 14 || z === 14) && (x === 10 || x === 18 || z === 10 || z === 18) && vw.get(x, 62, z) === 'minecraft:air' && !(x === 14 && z === 10)) glassGone.push(`${x},62,${z}`);
    const doorOpen = !!vw.getStates(14, 61, 10).open_bit || !!vw.getStates(14, 62, 10).open_bit;
    console.log(`BREACH RESTORE: pending ${brm.pendingBreaches()}, house windows missing ${glassGone.length}, house door left open ${doorOpen} -> ${brm.pendingBreaches() === 0 && !glassGone.length && !doorOpen ? 'OK' : 'FAIL'}`);
  }
  console.log(`STALKER: first show at ${firstShow ? (firstShow.t / 1200).toFixed(1) : '-'} min, first chase at ${firstRage ? (firstRage.t / 1200).toFixed(1) : (rages.length ? 'inline' : '-')} min; damage to players ${SIM.hits.reduce((a, h) => a + h.n, 0).toFixed(0)} in ${SIM.hits.length} hits; deaths ${SIM.deaths || 0}; bot reactions ${JSON.stringify(SIM.reacts || {})}`);
}
const hist = ws.ws().history;
const fam = {}; const ids = {}; const outcomes = {};
for (const r of hist) { fam[r.f] = (fam[r.f] || 0) + 1; ids[r.id] = (ids[r.id] || 0) + 1; }
for (const r of recs) outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
const tms = stats.tickMs.sort((a, b) => a - b);
const pct = (q) => tms[Math.floor(tms.length * q)].toFixed(3);

console.warn = origWarn;
console.log(`\n=== Shaftbreaker simulation: ${MINUTES} min, ${NPLAYERS} player(s), seed ${SEED}, scenario ${SCENARIO} (wall ${wall.toFixed(1)}s) ===`);
console.log(`script errors: ${SIM.errors.length}`);
if (SCENARIO === 'harmless') console.log(`HARMLESS CHECK: hits=${SIM.hits.length} damage-events=${SIM.hits.length} blocks-broken=${SIM.broken.length} -> ${SIM.hits.length === 0 && SIM.broken.length === 0 ? 'OK' : 'FAIL'}`);
for (const e of SIM.errors.slice(0, 12)) console.log('  ERR', e.split('\n').slice(0, 3).join(' | '));
console.log(`max simultaneous Shaftbreakers: ${stats.maxCreatures} (singleton ${stats.maxCreatures <= 1 ? 'OK' : 'VIOLATED'})`);
console.log(`creature spawns: ${stats.spawns}, spawned inside a player's direct view: ${stats.spawnInView.length}`, stats.spawnInView.slice(0, 5));
console.log(`creature-in-wall ticks: ${stats.creatureInWall}`);
console.log(`relocations (teleports > 1.5 blocks): ${tpStats.relocations} (${tpStats.fxVanish || 0} visible vanishes with fx), silent ones inside someone's view: ${tpStats.visibleRelocations.length}`, tpStats.visibleRelocations.slice(0, 4));
console.log(`presence: creature around for ${(100 * presence.withCreature / Math.max(1, presence.ugTicks)).toFixed(0)}% of underground time, mean distance ${(presence.distSum / Math.max(1, presence.withCreature)).toFixed(1)} blocks, in view ${(100 * presence.seenTicks / Math.max(1, presence.withCreature)).toFixed(1)}% of that time`);
console.log('guide moths: ' + Object.values(GUIDES).length + ' ' + JSON.stringify(Object.values(GUIDES).map((g) => ({ den: `${g.start.toFixed(0)}->${g.min.toFixed(0)}`, s: (g.ticks / 20).toFixed(0), solid: g.solid, faceTravel: g.moved ? (g.aligned / g.moved).toFixed(2) : '-', pl: g.followerMin.toFixed(0) }))));
const denm = await import(pathToFileURL(path.join(build, 'scripts/world/den.js')).href);
console.log(`dens: ${ws.ws().dens.length}; guide moths active at end: ${denm.guideCount()}; music: ${JSON.stringify(SIM.musics.reduce((a, m) => { a[m.id] = (a[m.id] || 0) + 1; return a; }, {}))}`);
if (stats.hitsBeforeTell.length) console.log('UNTELEGRAPHED', JSON.stringify(stats.hitsBeforeTell.slice(0, 4).map((h) => ({ t: h.t, src: h.src, act: h.act, mode: h.mode, phase: h.phase, why: h.why, n: h.n }))));
console.log(`hits on players: ${SIM.hits.length} (engine ${SIM.hits.filter((h) => h.src === 'engine').length}, scripted ${SIM.hits.filter((h) => h.src === 'script').length}); untelegraphed: ${stats.hitsBeforeTell.length}`);
console.log(`longest frenzy: ${(stats.frenzyMax / 20).toFixed(1)} s; blocks broken by commands: ${SIM.broken.length}`);
console.log(`encounters (history ring, last 40): ${hist.length}  by family: ${JSON.stringify(fam)}`);
console.log(`by template: ${JSON.stringify(ids)}`);
console.log(`outcomes (last 60): ${JSON.stringify(outcomes)}`);
const famAll = {}; for (const e of encLog) famAll[e.f] = (famAll[e.f] || 0) + 1;
console.log(`ALL encounters: ${encLog.length} by family ${JSON.stringify(famAll)}; director state samples ${JSON.stringify(stateHist)}`);
console.log(`creature-in-block causes: ${JSON.stringify(wallWhy)}`);
console.log(`plan failures: ${JSON.stringify(dir.planFails)}`);
const firstMajor = encLog.find((h) => !['audio', 'env'].includes(h.f));
console.log(`first encounter at ${encLog.length ? (encLog[0].t / 1200).toFixed(1) : '-'} min; first major (${firstMajor ? firstMajor.id : '-'}) at ${firstMajor ? (firstMajor.t / 1200).toFixed(1) : '-'} min`);
const majors = encLog.filter((h) => !['audio', 'env'].includes(h.f)).map((h) => h.t);
const gaps = majors.slice(1).map((t, i) => ((t - majors[i]) / 1200).toFixed(1));
console.log(`gaps between major encounters (min): ${gaps.join(', ')}`);
console.log(`tick cost ms: p50 ${pct(0.5)} p95 ${pct(0.95)} p99 ${pct(0.99)} max ${tms[tms.length - 1].toFixed(2)}`);
for (const b of bots) {
  const pf = mem.profile(b.p);
  const tr = Object.entries(pf.traits).filter(([, t]) => t.n > 0).map(([k, t]) => `${k}=${t.s.toFixed(0)}/${t.c.toFixed(0)}(n${t.n})`).join(' ');
  console.log(`${b.p.name} [${b.strat}] enc=${pf.encounters} seen=${pf.sightings} hunts=${pf.hunts} esc=${pf.huntsEscaped} caught=${pf.huntsCaught} deaths=${pf.deaths} fam=${pf.familiarity.toFixed(0)} routes=${pf.routes.length} | ${tr}`);
  console.log(`   learned: ${pf.learnLog.slice(-4).join(' / ')}`);
}
console.log(`dens: ${ws.ws().dens.length}; sounds played: ${SIM.sounds.length}; particles: ${SIM.particles.length}; music starts: ${SIM.musics.length}`);
const dynSizes = Object.entries(world._dyn).map(([k, v]) => `${k}:${String(v).length}`).join(' ');
console.log(`world dynamic properties: ${dynSizes}`);
console.log('lurk distance samples: ' + JSON.stringify(presence.hist) + ' close-why ' + JSON.stringify(presence.why));
console.log('lurk heartbeat by dist/vis: ' + JSON.stringify(SIM.hbWhy));
console.log('heartbeat by context: ' + JSON.stringify(SIM.sounds.filter((x) => x.id === 'shaftbreaker.heartbeat').reduce((a, x) => { a[x.ctx] = (a[x.ctx] || 0) + 1; return a; }, {})));
console.log('top sounds: ' + Object.entries(SIM.sounds.reduce((a, x) => { a[x.id] = (a[x.id] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}=${v}`).join(' '));
if (learnLog.length) console.log(learnLog.join('\n'));
if (SCENARIO === 'learn') console.log('last hits: ' + SIM.hits.slice(-6).map((h) => `${h.src}@${(h.t / 1200).toFixed(1)}m p(${h.p.x.toFixed(1)},${h.p.y.toFixed(0)},${h.p.z.toFixed(1)}) c(${h.c.x.toFixed(1)},${h.c.y.toFixed(0)},${h.c.z.toFixed(1)}) los=${h.los}`).join(' | '));
if (SCENARIO === 'learn') console.log('hunt outcomes: ' + recs.filter((r) => r.family === 'hunt').map((r) => `${r.outcome}${r.notes.filter((n) => /L45|L47|door/.test(n)).length ? '(' + r.notes.filter((n) => /L45|L47|door/.test(n)).join(',') + ')' : ''}`).join(' '));
if (process.env.SIM_TELEMETRY) for (const r of recs.slice(-12)) console.log(`  ${r.id} ${r.outcome} ${r.duration} ${r.phases.join('>')} | ${r.notes.join('; ')}`);
fs.writeFileSync(path.join(here, `last_run_${SCENARIO}_${NPLAYERS}p.json`), JSON.stringify({ hist, recs, errors: SIM.errors, scriptLog: scriptLog.slice(0, 200) }, null, 1));
process.exit(SIM.errors.length || stats.maxCreatures > 1 ? 1 : 0);
