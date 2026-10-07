#!/usr/bin/env python3
"""Minimal Bedrock level.dat (little-endian NBT) reader/writer for the test harness.

Used only to prepare Bedrock Dedicated Server test worlds: enable the "Beta APIs"
experiment (needed by the separate GameTest test pack that spawns simulated
players), set cheats, and fix the seed. The shipped add-on does not need it.

  leveldat.py show  WORLD_DIR
  leveldat.py set   WORLD_DIR key=value[:type] ...   (type: byte,int,long,string)
  leveldat.py experiments WORLD_DIR name1 name2 ...  (sets experiments.<name>=1)
"""
import struct
import sys

TAG_END, TAG_BYTE, TAG_SHORT, TAG_INT, TAG_LONG, TAG_FLOAT, TAG_DOUBLE, TAG_BYTE_ARRAY, TAG_STRING, TAG_LIST, TAG_COMPOUND, TAG_INT_ARRAY, TAG_LONG_ARRAY = range(13)


class Reader:
    def __init__(self, b, off=0):
        self.b, self.o = b, off

    def take(self, fmt):
        v = struct.unpack_from("<" + fmt, self.b, self.o)
        self.o += struct.calcsize("<" + fmt)
        return v[0]

    def string(self):
        n = self.take("H")
        s = self.b[self.o:self.o + n].decode("utf-8", "replace")
        self.o += n
        return s

    def payload(self, t):
        if t == TAG_BYTE: return self.take("b")
        if t == TAG_SHORT: return self.take("h")
        if t == TAG_INT: return self.take("i")
        if t == TAG_LONG: return self.take("q")
        if t == TAG_FLOAT: return self.take("f")
        if t == TAG_DOUBLE: return self.take("d")
        if t == TAG_BYTE_ARRAY:
            n = self.take("i"); v = list(self.b[self.o:self.o + n]); self.o += n; return v
        if t == TAG_STRING: return self.string()
        if t == TAG_LIST:
            et = self.take("b"); n = self.take("i")
            return (et, [self.payload(et) for _ in range(n)])
        if t == TAG_COMPOUND:
            d = {}
            while True:
                ct = self.take("b")
                if ct == TAG_END:
                    return d
                name = self.string()
                d[name] = (ct, self.payload(ct))
        if t == TAG_INT_ARRAY:
            n = self.take("i"); return [self.take("i") for _ in range(n)]
        if t == TAG_LONG_ARRAY:
            n = self.take("i"); return [self.take("q") for _ in range(n)]
        raise ValueError(t)


def w_payload(out, t, v):
    if t == TAG_BYTE: out += struct.pack("<b", v)
    elif t == TAG_SHORT: out += struct.pack("<h", v)
    elif t == TAG_INT: out += struct.pack("<i", v)
    elif t == TAG_LONG: out += struct.pack("<q", v)
    elif t == TAG_FLOAT: out += struct.pack("<f", v)
    elif t == TAG_DOUBLE: out += struct.pack("<d", v)
    elif t == TAG_BYTE_ARRAY: out += struct.pack("<i", len(v)) + bytes(v)
    elif t == TAG_STRING:
        e = v.encode("utf-8"); out += struct.pack("<H", len(e)) + e
    elif t == TAG_LIST:
        et, items = v
        out += struct.pack("<bi", et, len(items))
        for it in items: w_payload(out, et, it)
    elif t == TAG_COMPOUND:
        for name, (ct, cv) in v.items():
            e = name.encode("utf-8")
            out += struct.pack("<bH", ct, len(e)) + e
            w_payload(out, ct, cv)
        out += struct.pack("<b", TAG_END)
    elif t == TAG_INT_ARRAY: out += struct.pack("<i", len(v)) + b"".join(struct.pack("<i", x) for x in v)
    elif t == TAG_LONG_ARRAY: out += struct.pack("<i", len(v)) + b"".join(struct.pack("<q", x) for x in v)
    else: raise ValueError(t)


def load(path):
    b = open(path, "rb").read()
    ver, ln = struct.unpack_from("<ii", b, 0)
    r = Reader(b, 8)
    t = r.take("b"); name = r.string()
    assert t == TAG_COMPOUND
    return ver, name, r.payload(TAG_COMPOUND)


def save(path, ver, name, root):
    body = bytearray()
    e = name.encode()
    body += struct.pack("<bH", TAG_COMPOUND, len(e)) + e
    w_payload(body, TAG_COMPOUND, root)
    open(path, "wb").write(struct.pack("<ii", ver, len(body)) + bytes(body))


TYPES = {"byte": TAG_BYTE, "int": TAG_INT, "long": TAG_LONG, "string": TAG_STRING}


def main():
    cmd, world = sys.argv[1], sys.argv[2]
    path = world.rstrip("/") + "/level.dat"
    ver, name, root = load(path)
    if cmd == "show":
        for k, (t, v) in sorted(root.items()):
            if t != TAG_COMPOUND:
                print(f"{k} = {v!r}")
            else:
                print(f"{k} = {{{', '.join(f'{a}:{b[1]!r}' for a, b in v.items())}}}")
        return
    if cmd == "set":
        for kv in sys.argv[3:]:
            k, v = kv.split("=", 1)
            typ = "int"
            if ":" in v:
                v, typ = v.rsplit(":", 1)
            t = TYPES[typ]
            root[k] = (t, v if t == TAG_STRING else int(v))
    elif cmd == "experiments":
        exp = root.get("experiments", (TAG_COMPOUND, {}))[1]
        for n in sys.argv[3:]:
            exp[n] = (TAG_BYTE, 1)
        exp["experiments_ever_used"] = (TAG_BYTE, 1)
        exp["saved_with_toggled_experiments"] = (TAG_BYTE, 1)
        root["experiments"] = (TAG_COMPOUND, exp)
    save(path, ver, name, root)
    print("updated", path)


if __name__ == "__main__":
    main()
