// Minimal little-endian NBT (Bedrock) writer and reader.
// Values are tagged explicitly: { t: 'byte'|'short'|'int'|'long'|'float'|'string'|'list'|'compound', v, et? }.

const TAG = { end: 0, byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, string: 8, list: 9, compound: 10 };
const NAME = Object.fromEntries(Object.entries(TAG).map(([k, v]) => [v, k]));

export const byte = (v) => ({ t: 'byte', v });
export const short = (v) => ({ t: 'short', v });
export const int = (v) => ({ t: 'int', v });
export const long = (v) => ({ t: 'long', v: BigInt(v) });
export const float = (v) => ({ t: 'float', v });
export const str = (v) => ({ t: 'string', v });
export const list = (et, v) => ({ t: 'list', et, v });
export const comp = (v) => ({ t: 'compound', v });

class Writer {
  constructor() {
    this.buf = Buffer.alloc(1 << 16);
    this.n = 0;
  }

  ensure(k) {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + k) size *= 2;
    const b = Buffer.alloc(size);
    this.buf.copy(b, 0, 0, this.n);
    this.buf = b;
  }

  u8(v) { this.ensure(1); this.buf.writeUInt8(v, this.n); this.n += 1; }
  i8(v) { this.ensure(1); this.buf.writeInt8(v, this.n); this.n += 1; }
  i16(v) { this.ensure(2); this.buf.writeInt16LE(v, this.n); this.n += 2; }
  u16(v) { this.ensure(2); this.buf.writeUInt16LE(v, this.n); this.n += 2; }
  i32(v) { this.ensure(4); this.buf.writeInt32LE(v, this.n); this.n += 4; }
  i64(v) { this.ensure(8); this.buf.writeBigInt64LE(v, this.n); this.n += 8; }
  f32(v) { this.ensure(4); this.buf.writeFloatLE(v, this.n); this.n += 4; }
  f64(v) { this.ensure(8); this.buf.writeDoubleLE(v, this.n); this.n += 8; }
  s(v) {
    const b = Buffer.from(v, 'utf8');
    this.u16(b.length);
    this.ensure(b.length);
    b.copy(this.buf, this.n);
    this.n += b.length;
  }

  payload(tag) {
    switch (tag.t) {
      case 'byte': return this.i8(tag.v);
      case 'short': return this.i16(tag.v);
      case 'int': return this.i32(tag.v);
      case 'long': return this.i64(tag.v);
      case 'float': return this.f32(tag.v);
      case 'double': return this.f64(tag.v);
      case 'string': return this.s(tag.v);
      case 'list':
        this.u8(TAG[tag.et]);
        this.i32(tag.v.length);
        for (const item of tag.v) this.payload(typeof item === 'object' && item.t ? item : { t: tag.et, v: item });
        return undefined;
      case 'compound':
        for (const [k, child] of Object.entries(tag.v)) {
          this.u8(TAG[child.t]);
          this.s(k);
          this.payload(child);
        }
        this.u8(TAG.end);
        return undefined;
      default:
        throw new Error(`bad tag ${tag.t}`);
    }
  }
}

/** Serialise a root compound (Bedrock files use an empty root name). */
export function writeNbt(root, name = '') {
  const w = new Writer();
  w.u8(TAG.compound);
  w.s(name);
  w.payload(root);
  return w.buf.subarray(0, w.n);
}

/** Parse little-endian NBT back into plain JS (types kept as {t, v}). */
export function readNbt(buf) {
  let p = 0;
  const rd = {
    u8: () => buf.readUInt8(p++),
    i8: () => buf.readInt8(p++),
    i16: () => { const v = buf.readInt16LE(p); p += 2; return v; },
    u16: () => { const v = buf.readUInt16LE(p); p += 2; return v; },
    i32: () => { const v = buf.readInt32LE(p); p += 4; return v; },
    i64: () => { const v = buf.readBigInt64LE(p); p += 8; return v; },
    f32: () => { const v = buf.readFloatLE(p); p += 4; return v; },
    f64: () => { const v = buf.readDoubleLE(p); p += 8; return v; },
    s: () => { const n = buf.readUInt16LE(p); p += 2; const v = buf.toString('utf8', p, p + n); p += n; return v; },
  };
  const payload = (t) => {
    switch (t) {
      case 1: return { t: 'byte', v: rd.i8() };
      case 2: return { t: 'short', v: rd.i16() };
      case 3: return { t: 'int', v: rd.i32() };
      case 4: return { t: 'long', v: rd.i64() };
      case 5: return { t: 'float', v: rd.f32() };
      case 6: return { t: 'double', v: rd.f64() };
      case 8: return { t: 'string', v: rd.s() };
      case 9: {
        const et = rd.u8();
        const n = rd.i32();
        const v = [];
        for (let i = 0; i < n; i++) v.push(payload(et));
        return { t: 'list', et: NAME[et], v };
      }
      case 10: {
        const v = {};
        for (;;) {
          const tt = rd.u8();
          if (tt === 0) break;
          const k = rd.s();
          v[k] = payload(tt);
        }
        return { t: 'compound', v };
      }
      default:
        throw new Error(`bad tag id ${t} at ${p}`);
    }
  };
  const t = rd.u8();
  const name = rd.s();
  return { name, root: payload(t), bytes: p };
}

/** Convert a typed tree to plain values (for assertions). */
export function plain(tag) {
  if (tag.t === 'compound') return Object.fromEntries(Object.entries(tag.v).map(([k, v]) => [k, plain(v)]));
  if (tag.t === 'list') return tag.v.map(plain);
  return typeof tag.v === 'bigint' ? Number(tag.v) : tag.v;
}
