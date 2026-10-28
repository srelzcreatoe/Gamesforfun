// Tiny helper to author fnar-voxels-1 snapshots in tests.
export class VoxelBuilder {
  constructor(size, origin = [0, 0, 0]) {
    this.size = size; this.origin = origin;
    this.palette = [{ name: 'minecraft:air' }];
    this.keys = new Map([[JSON.stringify(['minecraft:air', {}]), 0]]);
    this.data = new Uint16Array(size[0] * size[1] * size[2]);
    this.signs = [];
  }
  id(name, states = {}) {
    if (!name.includes(':')) name = 'minecraft:' + name;
    const k = JSON.stringify([name, states]);
    if (!this.keys.has(k)) { this.keys.set(k, this.palette.length); this.palette.push(Object.keys(states).length ? { name, states } : { name }); }
    return this.keys.get(k);
  }
  /** x,y,z are snapshot-local. */
  set(x, y, z, name, states) {
    const [sx, sy, sz] = this.size;
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return;
    this.data[x + sx * (z + sz * y)] = this.id(name, states);
  }
  fill(x0, y0, z0, x1, y1, z1, name, states) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, z, name, states);
  }
  get(x, y, z) { const [sx, , sz] = this.size; return this.palette[this.data[x + sx * (z + sz * y)]]; }
  sign(x, y, z, lines) { this.signs.push({ pos: [x + this.origin[0], y + this.origin[1], z + this.origin[2]], lines }); }
  toJSON() {
    const buf = Buffer.alloc(this.data.length * 2);
    for (let i = 0; i < this.data.length; i++) buf.writeUInt16LE(this.data[i], i * 2);
    return { format: 'fnar-voxels-1', origin: this.origin, size: this.size, palette: this.palette, data: buf.toString('base64'), signs: this.signs };
  }
}
