"""
Basiliskra model kit.

One design file per form builds a `Model` (bones, cubes, locators).  From that single
description the kit produces, in one pass:

  * Bedrock geometry (`*.geo.json`, per-face UV)
  * the colour texture, a glow (emissive overlay) texture and MERS maps for
    Vibrant Visuals -- every texel is painted from its own 3D rest position, so
    patterns run unbroken across neighbouring cubes and contact shading is baked in
  * an editable Blockbench project (`*.bbmodel`) with the texture embedded
  * a rig table (`rig`) that the behaviour-pack script and the animation generator
    both read, so the server measures the mouth, gills, feet and club on the same
    skeleton the client draws

Coordinates are Bedrock *file space*: units are 1/16 block, +Y up, -Z is the front of
the animal, +X is the animal's LEFT.  Rotations are Bedrock degrees.

    v' = Rz(-rz) * Ry(ry) * Rx(-rx) * (v - pivot) + pivot        (right-handed matrices)

which is exactly what Blockbench draws after its (-x, -y, z) import flip in ZYX order.
"""
from __future__ import annotations

# Drawn size over modelled size, per form (the client entity's "scale"; the server rig uses the same numbers).
DRAW_SCALE = {"i": 1.0, "ii": 1.25, "iii": 1.7}

import base64
import hashlib
import io
import json
import math
import uuid as _uuid
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

FACES = ("north", "south", "east", "west", "up", "down")
PADDED_MATERIALS = ("fin", "web")


# ----------------------------------------------------------------------------- math
def rot_matrix(rx: float, ry: float, rz: float) -> np.ndarray:
    ax, ay, az = math.radians(-rx), math.radians(ry), math.radians(-rz)
    cx, sx = math.cos(ax), math.sin(ax)
    cy, sy = math.cos(ay), math.sin(ay)
    cz, sz = math.cos(az), math.sin(az)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], dtype=np.float64)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=np.float64)
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], dtype=np.float64)
    return Rz @ Ry @ Rx


def affine(R: np.ndarray, pivot) -> np.ndarray:
    """4x4 for: rotate by R about pivot."""
    p = np.asarray(pivot, dtype=np.float64)
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = p - R @ p
    return M


def apply(M: np.ndarray, pts: np.ndarray) -> np.ndarray:
    return pts @ M[:3, :3].T + M[:3, 3]


def stable_uuid(*parts) -> str:
    h = hashlib.md5("/".join(str(p) for p in parts).encode()).hexdigest()
    return str(_uuid.UUID(h))


def hash01(*ints, seed: int = 0) -> np.ndarray:
    """Vectorised integer hash -> [0,1). Accepts numpy int arrays."""
    h = np.uint64(seed * 0x9E3779B1 + 0x85EBCA6B)
    with np.errstate(over="ignore"):
        for a in ints:
            a = np.asarray(a).astype(np.int64).astype(np.uint64)
            h = (h ^ (a + np.uint64(0x9E3779B97F4A7C15) + (h << np.uint64(6)) + (h >> np.uint64(2))))
            h = h * np.uint64(0xBF58476D1CE4E5B9)
            h ^= h >> np.uint64(31)
        h = h * np.uint64(0x94D049BB133111EB)
        h ^= h >> np.uint64(29)
    return (h >> np.uint64(11)).astype(np.float64) / float(1 << 53)


def value_noise(p: np.ndarray, period: float, seed: int = 0) -> np.ndarray:
    """Smooth 3D value noise in [0,1]; p is (...,3)."""
    q = p / period
    i = np.floor(q).astype(np.int64)
    f = q - i
    f = f * f * (3 - 2 * f)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (
                    f[..., 2] if dz else 1 - f[..., 2])
                out = out + w * hash01(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz, seed=seed)
    return out


# ----------------------------------------------------------------------------- model
# Locators the engine otherwise derives from each geometry by itself (and then reports as conflicting
# between the three forms).  Declared identically, on the root bone, in every form.
SHARED_LOCATORS = {"armor_offset.default_neck": [0.0, 0.0, 0.0]}


@dataclass
class Cube:
    origin: tuple
    size: tuple
    mat: str = "skin"
    pivot: tuple | None = None
    rot: tuple | None = None
    inflate: float = 0.0
    p: dict = field(default_factory=dict)          # painter parameters
    skip: set = field(default_factory=set)         # faces never drawn
    bone: "Bone" = None
    rects: dict = field(default_factory=dict)      # face -> (u, v, w, h) texels
    hidden: set = field(default_factory=set)
    idx: int = 0

    def local_matrix(self) -> np.ndarray:
        if self.rot is None:
            return np.eye(4)
        return affine(rot_matrix(*self.rot), self.pivot if self.pivot is not None else (0, 0, 0))

    def world_matrix(self) -> np.ndarray:
        return self.bone.world @ self.local_matrix()

    def bounds(self):
        o = np.asarray(self.origin, dtype=np.float64) - self.inflate
        s = np.asarray(self.size, dtype=np.float64) + 2 * self.inflate
        return o, o + s

    def face_dims(self, face: str):
        w, h, d = self.size
        return {"north": (w, h), "south": (w, h), "east": (d, h), "west": (d, h), "up": (w, d), "down": (w, d)}[face]

    def face_points(self, face: str, S: np.ndarray, T: np.ndarray, out: float = 0.0) -> np.ndarray:
        """Local-space points of a face for texture coords S (u, 0..1) and T (v, 0..1 downwards)
        in the *rect* orientation the kit paints in (identical to a box-UV layout)."""
        (x0, y0, z0), (x1, y1, z1) = self.bounds()
        w, h, d = x1 - x0, y1 - y0, z1 - z0
        if face == "north":
            P = np.stack([x0 + S * w, y1 - T * h, np.full_like(S, z0 - out)], -1)
        elif face == "south":
            P = np.stack([x1 - S * w, y1 - T * h, np.full_like(S, z1 + out)], -1)
        elif face == "east":      # file min-X side == the animal's right
            P = np.stack([np.full_like(S, x0 - out), y1 - T * h, z1 - S * d], -1)
        elif face == "west":      # file max-X side == the animal's left
            P = np.stack([np.full_like(S, x1 + out), y1 - T * h, z0 + S * d], -1)
        elif face == "up":
            P = np.stack([x0 + S * w, np.full_like(S, y1 + out), z1 - T * d], -1)
        else:                      # down
            P = np.stack([x0 + S * w, np.full_like(S, y0 - out), z1 - T * d], -1)
        return P

    @staticmethod
    def face_normal(face: str) -> np.ndarray:
        return np.array({"north": (0, 0, -1), "south": (0, 0, 1), "east": (-1, 0, 0), "west": (1, 0, 0),
                         "up": (0, 1, 0), "down": (0, -1, 0)}[face], dtype=np.float64)


@dataclass
class Bone:
    name: str
    parent: "Bone | None"
    pivot: tuple
    rot: tuple = (0.0, 0.0, 0.0)
    zone: int | None = None                         # glow zone, tail(0) .. head(8)
    cubes: list = field(default_factory=list)
    locators: dict = field(default_factory=dict)
    world: np.ndarray = None
    model: "Model" = None

    def cube(self, origin, size, mat="skin", rot=None, pivot=None, inflate=0.0, skip=(), **p) -> Cube:
        c = Cube(tuple(float(v) for v in origin), tuple(float(v) for v in size), mat,
                 None if rot is None else tuple(pivot if pivot is not None else self.pivot),
                 None if rot is None else tuple(rot), float(inflate), dict(p), set(skip), self)
        c.idx = len(self.model.cubes)
        self.cubes.append(c)
        self.model.cubes.append(c)
        return c

    def box(self, cx, cy, cz, w, h, d, mat="skin", **kw) -> Cube:
        """Cube given by its centre."""
        return self.cube((cx - w / 2, cy - h / 2, cz - d / 2), (w, h, d), mat, **kw)

    def locator(self, name: str, pos):
        self.locators[name] = tuple(float(v) for v in pos)


class Model:
    def __init__(self, name: str, identifier: str, seed: int = 1):
        self.name = name
        self.identifier = identifier
        self.seed = seed
        self.bones: dict[str, Bone] = {}
        self.cubes: list[Cube] = []
        self.tex_w = self.tex_h = 0
        self.gutters: list = []
        self.meta: dict = {}

    def bone(self, name, parent=None, pivot=(0, 0, 0), rot=(0, 0, 0), zone=None) -> Bone:
        if name in self.bones:
            raise ValueError(f"duplicate bone {name}")
        par = self.bones[parent] if isinstance(parent, str) else parent
        if zone is None and par is not None:
            zone = par.zone
        b = Bone(name, par, tuple(float(v) for v in pivot), tuple(float(v) for v in rot), zone, model=self)
        self.bones[name] = b
        return b

    # ---- rest pose -----------------------------------------------------------
    def solve_rest(self):
        for b in self.bones.values():          # insertion order: parents first
            L = affine(rot_matrix(*b.rot), b.pivot)
            b.world = L if b.parent is None else b.parent.world @ L

    def locator_world(self, name: str):
        for b in self.bones.values():
            if name in b.locators:
                return apply(b.world, np.asarray(b.locators[name], dtype=np.float64))
        raise KeyError(name)

    def bounds(self):
        lo = np.full(3, 1e9)
        hi = np.full(3, -1e9)
        for c in self.cubes:
            a, b = c.bounds()
            corners = np.array([[x, y, z] for x in (a[0], b[0]) for y in (a[1], b[1]) for z in (a[2], b[2])])
            w = apply(c.world_matrix(), corners)
            lo = np.minimum(lo, w.min(0))
            hi = np.maximum(hi, w.max(0))
        return lo, hi

    # ---- hidden faces --------------------------------------------------------
    def cull_hidden(self, grid: int = 13):
        """Drop faces that sit wholly inside other cubes of the SAME bone (a rigid body, so no
        animation can ever uncover them).  Samples reach the very edge of each face: a coarse
        interior grid once threw away faces that still showed a thin strip."""
        lin = np.linspace(0.004, 0.996, grid)
        S, T = np.meshgrid(lin, lin)
        n_hidden = 0
        for b in self.bones.values():
            if len(b.cubes) < 2:
                continue
            inv = [np.linalg.inv(c.local_matrix()) for c in b.cubes]
            bnd = [c.bounds() for c in b.cubes]
            for ci, c in enumerate(b.cubes):
                Lc = c.local_matrix()
                for f in FACES:
                    if f in c.skip:
                        continue
                    pts = apply(Lc, c.face_points(f, S, T, out=0.12).reshape(-1, 3))
                    covered = np.zeros(len(pts), dtype=bool)
                    for oi, o in enumerate(b.cubes):
                        if oi == ci:
                            continue
                        q = apply(inv[oi], pts)
                        lo, hi = bnd[oi]
                        covered |= np.all((q > lo - 1e-6) & (q < hi + 1e-6), axis=1)
                        if covered.all():
                            break
                    if covered.all():
                        c.hidden.add(f)
                        n_hidden += 1
        return n_hidden

    # ---- atlas ---------------------------------------------------------------
    def pack(self, sizes=((512, 512), (1024, 512), (1024, 1024), (2048, 1024), (2048, 2048))):
        items = []
        for c in self.cubes:
            ts = c.p.get("tex_scale", 1.0)
            for f in FACES:
                if f in c.skip or f in c.hidden:
                    continue
                fw, fh = c.face_dims(f)
                if fw <= 0 or fh <= 0:
                    continue
                w = max(1, int(math.ceil(fw * ts - 1e-6)))
                h = max(1, int(math.ceil(fh * ts - 1e-6)))
                # cut-out faces get a one-texel gutter, later filled with their own edge, so a
                # neighbouring rectangle can never bleed a hairline onto a transparent edge
                pad = 1 if c.mat in PADDED_MATERIALS else 0
                items.append((h + 2 * pad, w + 2 * pad, c, f, pad))
        items.sort(key=lambda t: (-t[0], -t[1], t[2].idx, t[3]))
        for W, H in sizes:
            x = y = row_h = 0
            ok = True
            placed = []
            for h, w, c, f, pad in items:
                if w > W:
                    ok = False
                    break
                if x + w > W:
                    x = 0
                    y += row_h
                    row_h = 0
                if y + h > H:
                    ok = False
                    break
                placed.append((c, f, x + pad, y + pad, w - 2 * pad, h - 2 * pad, pad))
                x += w
                row_h = max(row_h, h)
            if ok:
                self.gutters = []
                for c, f, x, y, w, h, pad in placed:
                    c.rects[f] = (x, y, w, h)
                    if pad:
                        self.gutters.append((x, y, w, h))
                self.tex_w, self.tex_h = W, H
                used = sum((w + 2 * pad) * (h + 2 * pad) for *_, w, h, pad in placed)
                return used / (W * H)
        raise RuntimeError("model does not fit the largest atlas")

    # ---- exports -------------------------------------------------------------
    def geometry_json(self) -> dict:
        lo, hi = self.bounds()
        # the client draws forms II and III larger than they are modelled (client entity "scale"): so are the bounds
        k = DRAW_SCALE.get(self.identifier.rsplit(".", 1)[-1], 1.0)
        ext_xz = k * float(max(abs(lo[0]), abs(hi[0]), abs(lo[2]), abs(hi[2]))) / 16.0
        height = k * float(hi[1] - min(lo[1], 0)) / 16.0
        lo = [float(v) * k for v in lo]
        margin = self.meta.get("bounds_margin", 4.0) * k
        desc = {
            "identifier": self.identifier,
            "texture_width": self.tex_w,
            "texture_height": self.tex_h,
            # generous: covers every animated pose (curl, neck sweep, raised tail) so the
            # animal is not culled while part of him is still on screen
            "visible_bounds_width": round(2 * ext_xz + 2 * margin, 1),
            "visible_bounds_height": round(height + 2 * margin, 1),
            "visible_bounds_offset": [0, round(height / 2 + min(float(lo[1]), 0) / 16.0, 2), 0],
        }
        bones = []
        for b in self.bones.values():
            jb = {"name": b.name}
            if b.parent is not None:
                jb["parent"] = b.parent.name
            jb["pivot"] = [r4(v) for v in b.pivot]
            if any(abs(v) > 1e-9 for v in b.rot):
                jb["rotation"] = [r4(v) for v in b.rot]
            cubes = []
            for c in b.cubes:
                uv = {}
                for f, (u, v, w, h) in c.rects.items():
                    if f == "down":
                        uv[f] = {"uv": [u, v + h], "uv_size": [w, -h]}
                    else:
                        uv[f] = {"uv": [u, v], "uv_size": [w, h]}
                if not uv:
                    continue
                jc = {"origin": [r4(v) for v in c.origin], "size": [r4(v) for v in c.size]}
                if c.rot is not None:
                    jc["pivot"] = [r4(v) for v in c.pivot]
                    jc["rotation"] = [r4(v) for v in c.rot]
                if c.inflate:
                    jc["inflate"] = r4(c.inflate)
                jc["uv"] = uv
                cubes.append(jc)
            if cubes:
                jb["cubes"] = cubes
            locs = {self.geo_locator(k): [r4(x) for x in v] for k, v in b.locators.items()}
            if b.parent is None:
                locs.update(SHARED_LOCATORS)
            if locs:
                jb["locators"] = locs
            bones.append(jb)
        return {"format_version": "1.21.0", "minecraft:geometry": [{"description": desc, "bones": bones}]}

    def geo_locator(self, name: str) -> str:
        """The name a locator has in the game files.  The game merges the locators of every geometry an entity
        uses into one set and keeps only the first of any name, so each form's locators carry the form's tag
        (mouth_i, mouth_ii, mouth_iii).  The rig table for the script keeps the plain names."""
        return f"{name}_{self.name.rsplit('_', 1)[-1]}"

    def rig_json(self) -> dict:
        """Compact skeleton for the server script and the animation generator."""
        bones = {}
        for b in self.bones.values():
            bones[b.name] = {"parent": b.parent.name if b.parent else None, "pivot": [r4(v) for v in b.pivot],
                             "rot": [r4(v) for v in b.rot], "zone": b.zone}
        locs = {}
        for b in self.bones.values():
            for k, v in b.locators.items():
                locs[k] = {"bone": b.name, "pos": [r4(x) for x in v]}
        lo, hi = self.bounds()
        return {"identifier": self.identifier, "bones": bones, "locators": locs,
                "bounds": {"min": [r4(v) for v in lo], "max": [r4(v) for v in hi]}, "meta": self.meta}

    def glow_bones_by_zone(self, glow_rgba: np.ndarray) -> dict:
        """Zone -> bones whose painted glow area has any lit texel (so each glow pass draws
        only what it lights)."""
        out: dict[int, list] = {}
        for b in self.bones.values():
            if b.zone is None:
                continue
            lit = False
            for c in b.cubes:
                for (u, v, w, h) in c.rects.values():
                    if glow_rgba[v:v + h, u:u + w, 3].any():
                        lit = True
                        break
                if lit:
                    break
            if lit:
                out.setdefault(b.zone, []).append(b.name)
        return out

    def bbmodel_json(self, color_png: bytes, glow_png: bytes | None = None, animations: list | None = None) -> dict:
        n = self.name
        elements = []
        cube_uuid = {}
        for c in self.cubes:
            if not c.rects:
                continue
            x0, y0, z0 = c.origin
            w, h, d = c.size
            faces = {}
            for f in FACES:
                if f in c.rects:
                    u, v, tw, th = c.rects[f]
                    # Blockbench keeps up/down reversed relative to the Bedrock file
                    uvr = [u + tw, v + th, u, v] if f in ("up", "down") else [u, v, u + tw, v + th]
                    if f == "down":
                        uvr = [u + tw, v, u, v + th]
                    faces[f] = {"uv": uvr, "texture": 0}
                else:
                    faces[f] = {"uv": [0, 0, 0, 0], "texture": None}
            uid = stable_uuid(n, "cube", c.bone.name, c.idx)
            cube_uuid[c.idx] = uid
            piv = c.pivot if c.rot is not None else c.bone.pivot
            rot = c.rot if c.rot is not None else (0, 0, 0)
            elements.append({
                "name": f"{c.bone.name}_{c.mat}", "box_uv": False, "rescale": False, "locked": False,
                "render_order": "default", "allow_mirror_modeling": True,
                "from": [r4(-(x0 + w)), r4(y0), r4(z0)], "to": [r4(-x0), r4(y0 + h), r4(z0 + d)],
                "autouv": 0, "color": (c.bone.zone or 0) % 8, "inflate": r4(c.inflate),
                "origin": [r4(-piv[0]), r4(piv[1]), r4(piv[2])],
                "rotation": [r4(-rot[0]), r4(-rot[1]), r4(rot[2])],
                "faces": faces, "type": "cube", "uuid": uid})
        loc_uuid = {}
        for b in self.bones.values():
            items = [(self.geo_locator(k), v) for k, v in b.locators.items()]
            if b.parent is None:
                items += list(SHARED_LOCATORS.items())
            for k, v in items:
                uid = stable_uuid(n, "locator", k)
                loc_uuid[(b.name, k)] = uid
                elements.append({"name": k, "locked": False, "position": [r4(-v[0]), r4(v[1]), r4(v[2])],
                                 "rotation": [0, 0, 0], "type": "locator", "uuid": uid})

        def group(b: Bone):
            children = [cube_uuid[c.idx] for c in b.cubes if c.idx in cube_uuid]
            children += [loc_uuid[(b.name, self.geo_locator(k))] for k in b.locators]
            if b.parent is None:
                children += [loc_uuid[(b.name, k)] for k in SHARED_LOCATORS]
            children += [group(ch) for ch in self.bones.values() if ch.parent is b]
            return {"name": b.name, "origin": [r4(-b.pivot[0]), r4(b.pivot[1]), r4(b.pivot[2])],
                    "rotation": [r4(-b.rot[0]), r4(-b.rot[1]), r4(b.rot[2])], "bedrock_binding": "",
                    "color": (b.zone or 0) % 8, "uuid": stable_uuid(n, "bone", b.name), "export": True,
                    "mirror_uv": False, "isOpen": b.parent is None, "locked": False, "visibility": True,
                    "autouv": 0, "children": children}

        def tex(idx, name, data):
            return {"path": "", "name": name, "folder": "", "namespace": "", "id": str(idx),
                    "width": self.tex_w, "height": self.tex_h, "uv_width": self.tex_w, "uv_height": self.tex_h,
                    "particle": False, "layers_enabled": False, "sync_to_project": "", "render_mode": "default",
                    "render_sides": "auto", "frame_time": 1, "frame_order_type": "loop", "frame_order": "",
                    "frame_interpolate": False, "visible": True, "internal": True, "saved": False,
                    "uuid": stable_uuid(n, "texture", name),
                    "source": "data:image/png;base64," + base64.b64encode(data).decode()}

        textures = [tex(0, f"{n}.png", color_png)]
        if glow_png is not None:
            textures.append(tex(1, f"{n}_glow.png", glow_png))
        geo = self.geometry_json()["minecraft:geometry"][0]["description"]
        return {
            "meta": {"format_version": "4.10", "model_format": "bedrock", "box_uv": False},
            "name": n, "model_identifier": self.identifier.replace("geometry.", ""),
            "visible_box": [geo["visible_bounds_width"], geo["visible_bounds_height"], geo["visible_bounds_offset"][1]],
            "variable_placeholders": "", "variable_placeholder_buttons": [], "bedrock_animation_mode": "entity",
            "timeline_setups": [], "unhandled_root_fields": {},
            "resolution": {"width": self.tex_w, "height": self.tex_h},
            "elements": elements,
            "outliner": [group(b) for b in self.bones.values() if b.parent is None],
            "textures": textures,
            "animations": animations or [],
        }


def r4(v) -> float:
    v = round(float(v), 4)
    return int(v) if v == int(v) else v


def png_bytes(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr, "RGBA").save(buf, "PNG", optimize=True)
    return buf.getvalue()


def write_json(path, obj, compact=False):
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, separators=(",", ":"))
        else:
            json.dump(obj, f, indent=1)
        f.write("\n")


# ----------------------------------------------------------------------------- build helpers shared by designs
def barrel(b: Bone, z0, z1, cy, rw, rh, mat="skin", cx=0.0, belly=None, flat_belly=0.0, **p):
    """A rounded body slice from three overlapping boxes (octagonal cross-section).
    `rw`/`rh` are half width / half height.  `belly` paints the underside with another material."""
    out = []
    # wide + short, medium, narrow + tall; staggered in z so no two end caps are coplanar
    for k, (fw, fh, dz) in enumerate(((1.0, 0.56, 0.0), (0.84, 0.82, 0.5), (0.54, 1.0, 1.0))):
        w, h = 2 * rw * fw, 2 * rh * fh
        y0 = cy - h / 2
        if flat_belly and k > 0:
            # keep the underside flatter than the back (animals that rest on the ground)
            cut = min(h * flat_belly * (0.5 if k == 1 else 1.0), h - 1)
            y0 += cut
            h -= cut
        c = b.cube((cx - w / 2, y0, z0 - dz), (w, h, (z1 - z0) + 2 * dz), mat, **p)
        if belly:
            c.p["belly_mat"] = belly
        out.append(c)
    return out


def column(b: Bone, x, z, y0, y1, rx, rz, mat="skin", **p):
    """A rounded vertical limb slice (octagonal plan) from three boxes."""
    out = []
    for fx, fz, dy in ((1.0, 0.56, 0.0), (0.84, 0.84, 0.5), (0.54, 1.0, 1.0)):
        out.append(b.cube((x - rx * fx, y0 - dy, z - rz * fz), (2 * rx * fx, (y1 - y0) + 2 * dy, 2 * rz * fz), mat, **p))
    return out


def sym(fn):
    """Run fn(side) for the left (+1) and right (-1) of the animal."""
    return [fn(+1), fn(-1)]
