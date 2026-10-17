"""Blockbench (Bedrock entity) model builder with hand-designed pixel-art textures.

Geometry is written directly in Blockbench units (X = character's right, Y up, -Z = front).
Every face is painted from a material palette (a few tones of one colour picked per pixel);
features such as eye sockets, whisker dots or suspender straps are decals: small functions that
recolour the pixels of a face at given model coordinates.  Nothing is projected from an image.
"""
import math
import random
import zlib
import numpy as np
from PIL import Image
import bbgen
from bbgen import FACES, Bone, Cube, pivot_mat


class Mat:
    """A material: base colour plus a pixel-level tone recipe."""

    def __init__(self, base, tones=(1.07, 1.0, 0.93, 0.86), weights=(0.24, 0.46, 0.22, 0.08),
                 accent=None, accent_p=0.0, spot=None, spot_p=0.0, jitter=0.015):
        self.base = np.array(base, np.float32)
        self.tones, self.weights = tones, np.array(weights) / sum(weights)
        self.accent, self.accent_p = (np.array(accent, np.float32) if accent is not None else None), accent_p
        self.spot, self.spot_p = (np.array(spot, np.float32) if spot is not None else None), spot_p
        self.jitter = jitter

    def color(self, rng):
        r = rng.random()
        if self.spot is not None and r < self.spot_p:
            c = self.spot
        elif self.accent is not None and r < self.spot_p + self.accent_p:
            c = self.accent
        else:
            c = self.base
        k = self.tones[rng.choice(len(self.tones), p=self.weights)]
        return c * k * (1 + rng.normal(0, self.jitter))

    def scaled(self, f):
        m = Mat(self.base * f, self.tones, self.weights, None if self.accent is None else self.accent * f,
                self.accent_p, self.spot, self.spot_p, self.jitter)
        return m


def flat(rgb):
    return Mat(rgb, tones=(1.0,), weights=(1.0,), jitter=0.0)


class Model2(bbgen.Model):
    def __init__(self, name, density=2, seed=1):
        self.name, self.density = name, density
        self.bones, self.order, self.cubes = {}, [], []
        self.rng = random.Random(seed)
        self.seed = seed
        self.cx, self.ground, self.ppu = 0, 0, 1

    # ------------------------------------------------------------------ construction
    def bone(self, name, parent, pivot, rot=(0, 0, 0)):
        b = Bone(name, parent, list(pivot), list(rot))
        self.bones[name] = b
        self.order.append(name)
        if parent:
            self.bones[parent].children.append(b)
        return b

    def box(self, bone, name, x0, x1, y0, y1, z0, z1, mat, r=0.0, faces=None, deco=None,
            rot=None, origin=None, bevel_axes='xyz'):
        """Axis-aligned cube (Blockbench units). r > 0 chamfers every edge by r using three cubes
        (classic 'rounded voxel' block).  faces: per-face material overrides.  deco: decal list."""
        frm, to = [min(x0, x1), min(y0, y1), min(z0, z1)], [max(x0, x1), max(y0, y1), max(z0, z1)]
        rot = list(rot or (0, 0, 0))
        org = list(origin) if origin else [(a + b) / 2 for a, b in zip(frm, to)]
        size = [to[i] - frm[i] for i in range(3)]
        out = []
        if r and min(size) > 2 * r + 1e-6:
            parts = [('', [r, r, 0]), ('_x', [0, r, r]), ('_y', [r, 0, r])]
            for suf, ins in parts:
                f = [frm[i] + ins[i] for i in range(3)]
                t = [to[i] - ins[i] for i in range(3)]
                out.append(self._cube(bone, name + suf, f, t, mat, rot, org, faces, deco))
        else:
            out.append(self._cube(bone, name, frm, to, mat, rot, org, faces, deco))
        return out

    def _cube(self, bone, name, f, t, mat, rot, org, faces, deco):
        c = Cube(bone, name, f, t, None, rot, org, sample=False)
        c.mat, c.face_mats, c.deco = mat, dict(faces or {}), list(deco or [])
        self.cubes.append(c)
        return c

    def mbox(self, bone_r, bone_l, name, x0, x1, *rest, rot=None, origin=None, **kw):
        """Cube on the character's right (+X) and its mirror image on the left."""
        self.box(bone_r, name + '_r', x0, x1, *rest, rot=rot, origin=origin, **kw)
        rl = None if rot is None else (rot[0], -rot[1], -rot[2])
        ol = None if origin is None else (-origin[0], origin[1], origin[2])
        self.box(bone_l, name + '_l', -x1, -x0, *rest, rot=rl, origin=ol, **kw)

    # ------------------------------------------------------------------ painting
    def paint(self):
        self.cull()
        self.face_imgs = {}
        for ci, c in enumerate(self.cubes):
            Mw = self.cube_world(c)
            for face in FACES:
                if c.faces[face] is None:
                    continue
                o, u, v, n, W, H = self.face_texels(c, face)
                rng = np.random.default_rng(zlib.crc32(f'{self.seed}:{c.name}:{face}'.encode()))
                mat = c.face_mats.get(face, c.mat)
                img = np.zeros((H, W, 3), np.float32)
                for j in range(H):
                    for i in range(W):
                        img[j, i] = mat.color(rng)
                if c.deco:
                    nw = Mw[:3, :3] @ n
                    fdir = face_dir(nw)
                    for j in range(H):
                        for i in range(W):
                            P = o + (i + 0.5) / W * u + (j + 0.5) / H * v
                            Pw = (Mw @ np.r_[P, 1.0])[:3]
                            for d in c.deco:
                                col = d(fdir, Pw, i, j, W, H)
                                if col is not None:
                                    img[j, i] = col.color(rng) if isinstance(col, Mat) else np.array(col, np.float32)
                self.face_imgs[(ci, face)] = np.clip(img, 0, 255).astype(np.uint8)
        self.pack()


def face_dir(nw):
    a = int(np.argmax(np.abs(nw)))
    s = nw[a] > 0
    return [('east', 'west'), ('up', 'down'), ('south', 'north')][a][0 if s else 1]


# ---------------------------------------------------------------------- decal helpers
def rect(x0, x1, y0, y1, col, faces=('north',), z0=-1e9, z1=1e9, absx=False):
    """recolour pixels whose centre lies in the box (model units, rest pose)"""
    def f(fd, P, i, j, W, H):
        x = abs(P[0]) if absx else P[0]
        if fd in faces and x0 <= x <= x1 and y0 <= P[1] <= y1 and z0 <= P[2] <= z1:
            return col
    return f


def pixels(points, col, faces=('north',), tol=0.26, absx=False):
    """recolour the pixels at given (x, y) centres"""
    def f(fd, P, i, j, W, H):
        if fd not in faces:
            return None
        x = abs(P[0]) if absx else P[0]
        for (px, py) in points:
            if abs(x - px) < tol and abs(P[1] - py) < tol:
                return col
    return f


def border(col, faces=('north',), sides='lrtb'):
    """recolour the outer ring of pixels of a face (for plates such as the belly)"""
    def f(fd, P, i, j, W, H):
        if fd in faces and (('l' in sides and i == 0) or ('r' in sides and i == W - 1) or
                            ('t' in sides and j == 0) or ('b' in sides and j == H - 1)):
            return col
    return f


def corners(col, faces=('north',)):
    def f(fd, P, i, j, W, H):
        if fd in faces and (i in (0, W - 1)) and (j in (0, H - 1)):
            return col
    return f
