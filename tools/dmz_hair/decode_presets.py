#!/usr/bin/env python3
"""Decode DragonMineZ's own hair presets out of the mod and dump them as JSON.

The mod stores each preset as a "hair code" string in
`com.dragonminez.common.hair.HairManager.initializeDefaultPresets()`:

    DMZ1:<base62>    a single CustomHair
    DMZF1:<base62>   a full set: base | SSJ | SSJ2 | SSJ3
    DMZ4:/DMZF4:/DMZ5:/DMZF5:  the same with the base64url alphabet

Decoding is exactly what HairManager.fromCode does (verified against its
bytecode with `javap -c -p`):

    decodeBigInt(code, alphabet)  -> BigInteger in that base, then toByteArray()
    decompressOptimized(bytes)    -> raw DEFLATE (new Inflater(true))
    NbtIo.read(DataInput)         -> uncompressed big endian NBT
    CustomHair.load(CompoundTag)  -> strands per face

Usage: decode_presets.py <extracted-jar-dir> <out.json>
"""
import json
import re
import struct
import subprocess
import sys
import zlib

BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
ALPHABETS = {"DMZ1:": BASE62, "DMZF1:": BASE62, "DMZ4:": BASE64URL,
             "DMZF4:": BASE64URL, "DMZ5:": BASE64URL, "DMZF5:": BASE64URL}
FACES = {"F": "FRONT", "B": "BACK", "L": "LEFT", "R": "RIGHT", "T": "TOP"}
# CustomHair$HairFace maxStrands: FRONT is a single row of 4, the rest are 4x4
FACE_SLOTS = {"FRONT": 4, "BACK": 16, "LEFT": 16, "RIGHT": 16, "TOP": 16}
# HairStrand's own constructor defaults
STRAND_DEFAULTS = {
    "length": 0, "lengthScale": 1.0, "rotationX": 0.0, "rotationY": 0.0, "rotationZ": 0.0,
    "scaleX": 1.0, "scaleY": 1.0, "scaleZ": 1.0, "cubeWidth": 2.0, "cubeHeight": 2.0,
    "cubeDepth": 2.0, "curveX": 0.0, "curveY": 0.0, "curveZ": 0.0, "color": "", "id": 0,
}
# CompoundTag key -> (field, short key, long key, kind)
STRAND_KEYS = [
    ("id", "i", "Id", "int"), ("length", "l", "Length", "int"),
    ("lengthScale", "ls", "LengthScale", "float"),
    ("rotationX", "rx", "RotX", "float"), ("rotationY", "ry", "RotY", "float"),
    ("rotationZ", "rz", "RotZ", "float"),
    ("scaleX", "sx", "ScaleX", "float"), ("scaleY", "sy", "ScaleY", "float"),
    ("scaleZ", "sz", "ScaleZ", "float"),
    ("cubeWidth", "cw", "CubeW", "float"), ("cubeHeight", "ch", "CubeH", "float"),
    ("cubeDepth", "cd", "CubeD", "float"),
    ("curveX", "cx", "CurveX", "float"), ("curveY", "cy", "CurveY", "float"),
    ("curveZ", "cz", "CurveZ", "float"), ("color", "c", "Color", "str"),
]

# --- NBT ----------------------------------------------------------------------

class Reader:
    def __init__(self, b):
        self.b = b
        self.i = 0

    def take(self, n):
        v = self.b[self.i:self.i + n]
        if len(v) != n:
            raise EOFError("nbt truncated")
        self.i += n
        return v

    def u1(self): return self.take(1)[0]
    def i1(self): return struct.unpack(">b", self.take(1))[0]
    def i2(self): return struct.unpack(">h", self.take(2))[0]
    def u2(self): return struct.unpack(">H", self.take(2))[0]
    def i4(self): return struct.unpack(">i", self.take(4))[0]
    def i8(self): return struct.unpack(">q", self.take(8))[0]
    def f4(self): return struct.unpack(">f", self.take(4))[0]
    def f8(self): return struct.unpack(">d", self.take(8))[0]
    def string(self): return self.take(self.u2()).decode("utf-8", "replace")

    def payload(self, tag):
        if tag == 1: return self.i1()
        if tag == 2: return self.i2()
        if tag == 3: return self.i4()
        if tag == 4: return self.i8()
        if tag == 5: return self.f4()
        if tag == 6: return self.f8()
        if tag == 7: return list(self.take(self.i4()))
        if tag == 8: return self.string()
        if tag == 9:
            sub, n = self.u1(), self.i4()
            return [self.payload(sub) for _ in range(max(0, n))]
        if tag == 10:
            out = {}
            while True:
                t = self.u1()
                if t == 0:
                    return out
                # the name must be read BEFORE the payload (Python evaluates the
                # right hand side of a subscript assignment first)
                name = self.string()
                out[name] = self.payload(t)
        if tag == 11: return [self.i4() for _ in range(self.i4())]
        if tag == 12: return [self.i8() for _ in range(self.i4())]
        raise ValueError("unknown nbt tag %d" % tag)


def nbt_read(data):
    r = Reader(data)
    tag = r.u1()
    if tag != 10:
        raise ValueError("root is not a compound (tag %d)" % tag)
    r.string()                                  # root name
    return r.payload(10)

# --- hair codes ---------------------------------------------------------------

def decode_big_int(text, alphabet):
    """HairManager.decodeBigInt: base-N BigInteger, then toByteArray()."""
    base = len(alphabet)
    value = 0
    for ch in text:
        d = alphabet.find(ch)
        if d < 0:
            raise ValueError("bad character %r for base %d" % (ch, base))
        value = value * base + d
    if value == 0:
        return b"\x00"
    n = (value.bit_length() + 8) // 8          # Java keeps the sign byte
    raw = value.to_bytes(n, "big")
    return raw.lstrip(b"\x00") or b"\x00"      # ... and fromCode strips it again


def decode_code(code):
    for prefix, alphabet in ALPHABETS.items():
        if code.startswith(prefix):
            raw = decode_big_int(code[len(prefix):], alphabet)
            return nbt_read(zlib.decompressobj(-15).decompress(raw)), prefix
    raise ValueError("unknown hair code prefix: %r" % code[:8])


def strand_from_tag(tag):
    out = dict(STRAND_DEFAULTS)
    for field, short, long, kind in STRAND_KEYS:
        for key in (short, long):
            if key in tag:
                v = tag[key]
                out[field] = int(v) if kind == "int" else (float(v) if kind == "float" else str(v))
                break
    return out


# field -> the short key used in the dumped JSON (HairStrand's own NBT names)
SHORT = {"length": "l", "lengthScale": "ls", "rotationX": "rx", "rotationY": "ry",
         "rotationZ": "rz", "scaleX": "sx", "scaleY": "sy", "scaleZ": "sz",
         "cubeWidth": "cw", "cubeHeight": "ch", "cubeDepth": "cd",
         "curveX": "cx", "curveY": "cy", "curveZ": "cz", "color": "c"}


def compact(strand):
    """Only the slot plus the fields that differ from HairStrand's defaults."""
    out = {"s": strand["slot"], "l": strand["length"]}
    for field, key in SHORT.items():
        if field in ("length",):
            continue
        v = strand[field]
        if v == STRAND_DEFAULTS[field]:
            continue
        out[key] = round(v, 4) if isinstance(v, float) else v
    return out


def hair_from_tag(tag):
    hair = {
        "name": str(tag.get("n", tag.get("Name", ""))),
        "global_color": str(tag.get("gc", tag.get("GlobalColor", "#000000"))),
        "version": int(tag.get("v", tag.get("Version", 0))),
        "strands": {},
    }
    for fi, (key, face) in enumerate(FACES.items()):
        entries = tag.get(key) or tag.get(face) or []
        strands = []
        for slot, e in enumerate(entries):
            if not isinstance(e, dict):
                continue
            st = strand_from_tag(e)
            if st["length"] <= 0:              # HairStrand.isVisible()
                continue
            # CustomHair.load() places a strand at array index (id - face*100) for
            # version >= 2, and the renderer takes the base position from that index.
            idx = st["id"] - fi * 100
            if hair["version"] < 2 or idx < 0 or idx >= FACE_SLOTS[face]:
                idx = slot
            st["slot"] = idx
            strands.append(st)
        if strands:
            hair["strands"][face] = [compact(x) for x in strands]
    hair["visible_strands"] = sum(len(v) for v in hair["strands"].values())
    hair["cube_count"] = sum(s["l"] for v in hair["strands"].values() for s in v)
    return hair


def hairs_from_code(code):
    """A single code -> {"base": hair}; a full set -> base/ssj/ssj2/ssj3."""
    tag, prefix = decode_code(code)
    if "F" in prefix:                          # DMZF1/DMZF4/DMZF5 = full set
        # the short keys are B / S / S2 / T ("third"), per fromFullSetCode
        slots = [("base", "B", "Base"), ("ssj", "S", "SSJ"),
                 ("ssj2", "S2", "SSJ2"), ("ssj3", "T", "SSJ3")]
        out = {}
        for name, short, long in slots:
            sub = tag.get(short, tag.get(long))
            if isinstance(sub, dict):
                out[name] = hair_from_tag(sub)
        return out
    return {"base": hair_from_tag(tag)}

# --- preset table -------------------------------------------------------------

def preset_codes(jar_dir, javap):
    """The PRESET_CODES map, read out of initializeDefaultPresets()'s bytecode."""
    dump = subprocess.run(
        [javap, "-c", "-p", "-constants", "com/dragonminez/common/hair/HairManager.class"],
        cwd=jar_dir, capture_output=True, text=True, check=True).stdout
    start = dump.index("private static void initializeDefaultPresets();")
    end = dump.index("private static byte[] compressOptimized", start)
    block = dump[start:end]
    # push the preset index, push its code, call registerPreset - in that order
    ops = re.findall(
        r"\d+: (iconst_\d|bipush\s+\d+|sipush\s+\d+|ldc\w*\s+#\d+\s+// String (DMZF?\d:\S+)"
        r"|invokestatic\s+#\d+\s+// Method registerPreset)", block)
    out, idx = [], None
    for op, text in ops:
        if op.startswith("iconst_"):
            idx = int(op[-1])
        elif op.startswith(("bipush", "sipush")):
            idx = int(op.split()[-1])
        elif text:
            out.append((idx, text))
    return out


def encode_big_int(data, alphabet):
    """Inverse of decode_big_int (HairManager.encodeBigInt), for the round trip."""
    base = len(alphabet)
    value = int.from_bytes(data, "big")
    if value == 0:
        return alphabet[0]
    out = []
    while value:
        value, d = divmod(value, base)
        out.append(alphabet[d])
    return "".join(reversed(out))


def round_trip(code):
    """Decode a code, re-encode the raw payload and decode again: the strand tree
    has to come back identical. (Byte identical re-encoding is not expected: the
    payload is DEFLATE and Java's Deflater output is not reproducible here.)"""
    for prefix, alphabet in ALPHABETS.items():
        if code.startswith(prefix):
            raw = decode_big_int(code[len(prefix):], alphabet)
            again = decode_big_int(encode_big_int(raw, alphabet), alphabet)
            if again != raw:
                return False, "base%d re-encode differs" % len(alphabet)
            a = hairs_from_code(code)
            b = hairs_from_code(prefix + encode_big_int(raw, alphabet))
            return (a == b), ("tree identical" if a == b else "tree differs")
    return False, "unknown prefix"


def forced_codes(game_dir):
    """forms.json `forcedHairCode` entries (SSJ4 uses one)."""
    path = game_dir + "/data/forms.json"
    try:
        doc = json.load(open(path))
    except OSError:
        return {}
    forms = doc.get("forms", doc) if isinstance(doc, dict) else doc
    items = forms if isinstance(forms, list) else [dict(v, id=k) for k, v in forms.items()]
    out = {}
    for f in items:
        code = str(f.get("forcedHairCode", "") or "")
        if code:
            out[str(f.get("id"))] = code
    return out


def main():
    jar_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    out_path = sys.argv[2] if len(sys.argv) > 2 else "dmz_hair_presets.json"
    javap = "/usr/lib/jvm/java-21-openjdk-amd64/bin/javap"
    presets = {}
    for idx, code in preset_codes(jar_dir, javap):
        try:
            hairs = hairs_from_code(code)
        except Exception as exc:                # noqa: BLE001 - report and continue
            print("preset %s FAILED: %s" % (idx, exc), file=sys.stderr)
            continue
        base = hairs.get("base", {})
        presets[str(idx)] = {
            "index": idx,
            "name": base.get("name", "") or ("Preset %d" % idx),
            "code_prefix": code.split(":")[0] + ":",
            "full_set": len(hairs) > 1,
            "variants": hairs,
        }
        print("preset %2s %-22s %s strands=%d cubes=%d variants=%s" % (
            idx, base.get("name", "?"), base.get("global_color", ""),
            base.get("visible_strands", 0), base.get("cube_count", 0),
            ",".join(hairs.keys())))
    forced = {}
    for form_id, code in forced_codes("/home/user/Gamesforfun/game").items():
        ok, why = round_trip(code)
        print("forcedHairCode %-28s round trip: %s" % (form_id, why))
        try:
            forced[form_id] = {"code": code, "code_prefix": code.split(":")[0] + ":",
                               "variants": hairs_from_code(code)}
        except Exception as exc:                # noqa: BLE001
            print("  decode failed: %s" % exc, file=sys.stderr)
    # and a round trip over every preset, so a bad decode cannot pass silently
    bad = [i for i, c in preset_codes(jar_dir, javap) if not round_trip(c)[0]]
    print("preset round trip failures: %s" % (bad or "none"))
    doc = {
        "_comment": ("DragonMineZ's own hair presets, decoded from the mod's hair codes "
                     "(HairManager.initializeDefaultPresets) by tools/dmz_hair/decode_presets.py. "
                     "Positions are head-local model units, rotations degrees. Do not hand edit."),
        "slots": {
            "col_offsets": [-3.0, -1.0, 1.0, 3.0],
            "row_drops": [0.0, -1.5, -3.0, -4.5],
            "faces": {"FRONT": {"rows": 1, "cols": 4}, "BACK": {"rows": 4, "cols": 4},
                      "LEFT": {"rows": 4, "cols": 4}, "RIGHT": {"rows": 4, "cols": 4},
                      "TOP": {"rows": 4, "cols": 4}},
        },
        "presets": presets,
        "order": sorted(presets.keys(), key=int),
        "forced": forced,
    }
    with open(out_path, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"), sort_keys=False)
    print("wrote %s with %d presets" % (out_path, len(presets)))


if __name__ == "__main__":
    main()
