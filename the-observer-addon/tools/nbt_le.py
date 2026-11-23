#!/usr/bin/env python3
"""Little-endian NBT (Bedrock .mcstructure) — a small reader and writer.

Tags are kept as (type, value) pairs so a file can be read and written back exactly:
  compound -> dict name -> (type, value); list -> (item_type, [values]); arrays -> list of ints.
Used by tools/make_structures.py to build the Weeping Mire's structures.
"""
import struct

END, BYTE, SHORT, INT, LONG, FLOAT, DOUBLE, BYTE_ARRAY, STRING, LIST, COMPOUND, INT_ARRAY, LONG_ARRAY = range(13)


class Reader:
    def __init__(self, data):
        self.d = data
        self.i = 0

    def take(self, fmt):
        v = struct.unpack_from("<" + fmt, self.d, self.i)
        self.i += struct.calcsize("<" + fmt)
        return v[0]

    def string(self):
        n = self.take("H")
        s = self.d[self.i:self.i + n].decode("utf-8")
        self.i += n
        return s

    def payload(self, t):
        if t == BYTE:
            return self.take("b")
        if t == SHORT:
            return self.take("h")
        if t == INT:
            return self.take("i")
        if t == LONG:
            return self.take("q")
        if t == FLOAT:
            return self.take("f")
        if t == DOUBLE:
            return self.take("d")
        if t == BYTE_ARRAY:
            n = self.take("i")
            return [self.take("b") for _ in range(n)]
        if t == STRING:
            return self.string()
        if t == LIST:
            it = self.take("b")
            n = self.take("i")
            return (it, [self.payload(it) for _ in range(n)])
        if t == COMPOUND:
            out = {}
            while True:
                tt = self.take("b")
                if tt == END:
                    return out
                name = self.string()
                out[name] = (tt, self.payload(tt))
        if t == INT_ARRAY:
            n = self.take("i")
            return [self.take("i") for _ in range(n)]
        if t == LONG_ARRAY:
            n = self.take("i")
            return [self.take("q") for _ in range(n)]
        raise ValueError(f"bad tag {t}")


def read(data):
    r = Reader(data)
    t = r.take("b")
    name = r.string()
    return name, (t, r.payload(t))


class Writer:
    def __init__(self):
        self.b = bytearray()

    def put(self, fmt, v):
        self.b += struct.pack("<" + fmt, v)

    def string(self, s):
        e = s.encode("utf-8")
        self.put("H", len(e))
        self.b += e

    def payload(self, t, v):
        if t == BYTE:
            self.put("b", v)
        elif t == SHORT:
            self.put("h", v)
        elif t == INT:
            self.put("i", v)
        elif t == LONG:
            self.put("q", v)
        elif t == FLOAT:
            self.put("f", v)
        elif t == DOUBLE:
            self.put("d", v)
        elif t == BYTE_ARRAY:
            self.put("i", len(v))
            for x in v:
                self.put("b", x)
        elif t == STRING:
            self.string(v)
        elif t == LIST:
            it, items = v
            self.put("b", it if items else (it or END))
            self.put("i", len(items))
            for x in items:
                self.payload(it, x)
        elif t == COMPOUND:
            for name, (tt, vv) in v.items():
                self.put("b", tt)
                self.string(name)
                self.payload(tt, vv)
            self.put("b", END)
        elif t == INT_ARRAY:
            self.put("i", len(v))
            for x in v:
                self.put("i", x)
        elif t == LONG_ARRAY:
            self.put("i", len(v))
            for x in v:
                self.put("q", x)
        else:
            raise ValueError(f"bad tag {t}")


def write(name, tag):
    w = Writer()
    t, v = tag
    w.put("b", t)
    w.string(name)
    w.payload(t, v)
    return bytes(w.b)


def plain(tag):
    """(type, value) tree -> plain Python values, for reading."""
    t, v = tag
    if t == COMPOUND:
        return {k: plain(x) for k, x in v.items()}
    if t == LIST:
        it, items = v
        return [plain((it, x)) for x in items]
    return v
