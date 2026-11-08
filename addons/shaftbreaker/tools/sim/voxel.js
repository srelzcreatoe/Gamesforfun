// Small voxel world with procedurally carved caves, a mineshaft corridor and a surface, for simulation.
const PASSABLE = /air|torch|short_grass|rail|web|light_block|_carpet|lichen|vine|den_dust|den_spine/;

export class VoxelWorld {
  constructor(seed = 1, size = 112, minY = -24, maxY = 72) {
    this.size = size; this.minY = minY; this.maxY = maxY;
    this.h = maxY - minY;
    this.pal = ['minecraft:air']; this.palIdx = new Map([['minecraft:air', 0]]);
    this.data = new Uint16Array(size * size * this.h);
    this.states = new Map();
    this.torches = new Set();
    let s = seed; this.rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    this.generate();
  }
  idx(x, y, z) { const h = this.size / 2; return ((x + h) * this.size + (z + h)) * this.h + (y - this.minY); }
  inBounds(x, y, z) { const h = this.size / 2; return x >= -h && x < h && z >= -h && z < h && y >= this.minY && y < this.maxY; }
  pid(id) { let i = this.palIdx.get(id); if (i === undefined) { i = this.pal.length; this.pal.push(id); this.palIdx.set(id, i); } return i; }
  get(x, y, z) { if (!this.inBounds(x, y, z)) return y >= this.maxY ? 'minecraft:air' : 'minecraft:bedrock'; return this.pal[this.data[this.idx(x, y, z)]]; }
  getStates(x, y, z) { return { ...(this.states.get(`${x},${y},${z}`) || {}) }; }
  set(x, y, z, id, states = {}) {
    if (!this.inBounds(x, y, z)) return;
    const k = `${x},${y},${z}`;
    this.data[this.idx(x, y, z)] = this.pid(id);
    if (Object.keys(states).length) this.states.set(k, states); else this.states.delete(k);
    if (/torch|lantern/.test(id)) this.torches.add(k); else this.torches.delete(k);
    if (id === 'minecraft:gravel' && this.get(x, y - 1, z) === 'minecraft:air') { // gravel falls
      let yy = y; while (this.get(x, yy - 1, z) === 'minecraft:air' && yy > this.minY) yy--;
      this.data[this.idx(x, y, z)] = 0; this.data[this.idx(x, yy, z)] = this.pid('minecraft:gravel');
    }
  }
  passable(x, y, z) { return PASSABLE.test(this.get(x, y, z)); }
  solid(x, y, z) { const id = this.get(x, y, z); return !PASSABLE.test(id) && !/water|lava/.test(id); }
  topY(x, z) { for (let y = this.maxY - 1; y >= this.minY; y--) if (!this.passable(x, y, z)) return y; return null; }
  sky(x, y, z) { for (let yy = y + 1; yy < this.maxY; yy++) if (!this.passable(x, yy, z)) return 0; return 15; }
  light(x, y, z) {
    let best = this.sky(x, y, z) > 0 ? 15 : 0;
    for (const k of this.torches) {
      const [tx, ty, tz] = k.split(',').map(Number);
      const d = Math.abs(tx - x) + Math.abs(ty - y) + Math.abs(tz - z);
      if (d < 14) best = Math.max(best, 14 - d);
    }
    return best;
  }
  raycast(o, dir, maxD, passable, liquids) {
    const L = Math.hypot(dir.x, dir.y, dir.z) || 1; const d = { x: dir.x / L, y: dir.y / L, z: dir.z / L };
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const step = { x: Math.sign(d.x), y: Math.sign(d.y), z: Math.sign(d.z) };
    const tD = { x: Math.abs(1 / (d.x || 1e-9)), y: Math.abs(1 / (d.y || 1e-9)), z: Math.abs(1 / (d.z || 1e-9)) };
    const frac = (v, s) => (s > 0 ? Math.floor(v) + 1 - v : v - Math.floor(v));
    let tM = { x: tD.x * frac(o.x, step.x), y: tD.y * frac(o.y, step.y), z: tD.z * frac(o.z, step.z) };
    let t = 0;
    for (let i = 0; i < 400 && t <= maxD; i++) {
      const id = this.get(x, y, z);
      const isPass = PASSABLE.test(id); const isLiq = /water|lava/.test(id);
      if (i > 0 && !(isPass && !passable) && !(isLiq && !liquids) && id !== 'minecraft:air') {
        return { x, y, z, fx: o.x + d.x * t, fy: o.y + d.y * t, fz: o.z + d.z * t };
      }
      if (tM.x < tM.y && tM.x < tM.z) { x += step.x; t = tM.x; tM.x += tD.x; } else if (tM.y < tM.z) { y += step.y; t = tM.y; tM.y += tD.y; } else { z += step.z; t = tM.z; tM.z += tD.z; }
    }
    return null;
  }
  standable(x, y, z, crawl = false) { return this.solid(x, y - 1, z) && this.passable(x, y, z) && (crawl || this.passable(x, y + 1, z)); }

  generate() {
    const S = this.size / 2;
    for (let x = -S; x < S; x++) for (let z = -S; z < S; z++) for (let y = this.minY; y < this.maxY; y++) {
      let id = 'minecraft:air';
      if (y < 60) id = y < 4 ? 'minecraft:deepslate' : 'minecraft:stone';
      if (y === 60) id = 'minecraft:grass_block';
      if (y < 60 && y > 55) id = 'minecraft:dirt';
      if (y === this.minY) id = 'minecraft:bedrock';
      if (id === 'minecraft:stone' && this.rand() < 0.01) id = 'minecraft:iron_ore';
      if (id === 'minecraft:stone' && this.rand() < 0.02) id = 'minecraft:gravel';
      if (id === 'minecraft:deepslate' && this.rand() < 0.02) id = 'minecraft:tuff';
      this.data[this.idx(x, y, z)] = this.pid(id);
    }
    const carve = (cx, cy, cz, r, ry) => {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) for (let z = Math.floor(cz - r); z <= cz + r; z++) for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
        if (!this.inBounds(x, y, z) || y <= this.minY + 1) continue;
        if (((x - cx) / r) ** 2 + ((z - cz) / r) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.data[this.idx(x, y, z)] = 0;
      }
    };
    // worm tunnels
    for (let w = 0; w < 16; w++) {
      let x = (this.rand() - 0.5) * this.size * 0.8, z = (this.rand() - 0.5) * this.size * 0.8, y = -10 + this.rand() * 50;
      let yaw = this.rand() * 6.28, pitch = 0;
      for (let i = 0; i < 120; i++) {
        const r = 1.3 + this.rand() * 1.4;
        carve(x, y, z, r, 1.4 + this.rand() * 1.3);
        yaw += (this.rand() - 0.5) * 0.5; pitch = Math.max(-0.4, Math.min(0.4, pitch + (this.rand() - 0.5) * 0.2));
        x += Math.cos(yaw) * 1.2; z += Math.sin(yaw) * 1.2; y += pitch;
        if (Math.abs(x) > S - 4 || Math.abs(z) > S - 4) yaw += Math.PI;
        y = Math.max(-18, Math.min(50, y));
      }
    }
    // chambers
    for (let c = 0; c < 6; c++) carve((this.rand() - 0.5) * this.size * 0.6, -8 + this.rand() * 40, (this.rand() - 0.5) * this.size * 0.6, 5 + this.rand() * 4, 3 + this.rand() * 2.5);
    // mineshaft corridor
    const my = 20;
    for (let x = -40; x <= 40; x++) for (let y = my; y < my + 3; y++) for (let z = -1; z <= 1; z++) this.data[this.idx(x, y, z)] = 0;
    for (let x = -40; x <= 36; x += 4) { for (const z of [-1, 1]) for (let y = my; y < my + 2; y++) this.data[this.idx(x, y, z)] = this.pid('minecraft:oak_fence'); for (let z = -1; z <= 1; z++) this.data[this.idx(x, my + 2, z)] = this.pid('minecraft:oak_planks'); }
    for (let x = -40; x <= 40; x += 7) this.data[this.idx(x, my, 0)] = this.pid('minecraft:web');
    // staircase from the mineshaft corridor (y=20) up to the surface: +x then -z
    const carveCell = (x, y, z) => { for (let yy = y; yy < y + 3; yy++) for (let dz = -1; dz <= 1; dz++) if (this.inBounds(x, yy, z + dz)) this.data[this.idx(x, yy, z + dz)] = 0; };
    const carveCellX = (x, y, z) => { for (let yy = y; yy < y + 3; yy++) for (let dx = -1; dx <= 1; dx++) if (this.inBounds(x + dx, yy, z)) this.data[this.idx(x + dx, yy, z)] = 0; };
    let sx = 40, sy = 20, sz = 0;
    for (let i = 1; i <= 13; i++) { sx++; sy++; carveCell(sx, sy, sz); }
    for (let j = 1; sy < 61; j++) { sz--; sy++; carveCellX(sx, sy, sz); }
    this.stairTop = { x: sx, y: sy, z: sz };
    // a player base underground: chest + cobble walls + bed area (must never be broken)
    for (let x = -30; x <= -26; x++) for (let z = 6; z <= 10; z++) for (let y = my; y < my + 3; y++) this.data[this.idx(x, y, z)] = (x === -30 || x === -26 || z === 6 || z === 10) ? this.pid('minecraft:cobblestone') : 0;
    this.data[this.idx(-28, my, 8)] = this.pid('minecraft:chest');
    for (let z = 2; z <= 6; z++) for (let y = my; y < my + 2; y++) this.data[this.idx(-28, y, z)] = 0;
    this.data[this.idx(-28, my, 6)] = this.pid('minecraft:oak_door');
    this.data[this.idx(-28, my + 1, 6)] = this.pid('minecraft:oak_door');
  }
}
