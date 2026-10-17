"""Blockbench (bedrock entity) model generator.

Parts are described in reference-image pixel coordinates (front view), converted to
Blockbench model space, textured by projecting the reference image onto every
front-facing texel that is visible in the rest pose, and procedurally elsewhere.

Blockbench conventions replicated here:
  * model faces north (-Z); character's right side is +X; Y up.
  * north face UV: u1 at +X, v1 at top.  south: u1 at -X.  east: u1 at +Z.  west: u1 at -Z.
    up: u1 at -X, v1 at -Z.  down: u1 at -X, v1 at +Z.
  * group/cube rotations use Euler order ZYX (three.js), degrees.
"""
import base64, io, json, math, random, uuid
import numpy as np
from PIL import Image

FACES = ['north', 'east', 'south', 'west', 'up', 'down']


def rot_matrix(rx, ry, rz):
    rx, ry, rz = map(math.radians, (rx, ry, rz))
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx  # three.js order 'ZYX'


def pivot_mat(p, r):
    M = np.eye(4)
    if any(abs(v) > 1e-9 for v in r):
        R = rot_matrix(*r)
        M[:3, :3] = R
        M[:3, 3] = np.array(p) - R @ np.array(p)
    return M


class Bone:
    def __init__(self, name, parent, pivot, rot):
        self.name, self.parent, self.pivot, self.rot = name, parent, pivot, rot
        self.cubes, self.children = [], []
        self.uuid = None


class Cube:
    def __init__(self, bone, name, frm, to, pal, rot=(0, 0, 0), origin=None, sample=True, tex=None, dens=None, face_pal=None):
        self.dens = dens
        self.face_pal = face_pal or {}
        self.bone, self.name, self.frm, self.to, self.pal = bone, name, list(frm), list(to), pal
        self.rot = list(rot)
        self.origin = list(origin) if origin is not None else [(a + b) / 2 for a, b in zip(frm, to)]
        self.sample = sample
        self.tex = tex  # optional callable(face, w, h) -> HxWx3 array override
        self.faces = {}  # face -> [u1,v1,u2,v2] or None (culled)
        self.uuid = None


class Model:
    def __init__(self, name, ref, cx, ground, ppu=40.0, density=2, seed=1):
        self.name, self.cx, self.ground, self.ppu, self.density = name, cx, ground, ppu, density
        self.ref = np.asarray(Image.open(ref).convert('RGB')).astype(np.float32)
        self.bones, self.order = {}, []
        self.cubes = []
        self.pal = {}
        self.rng = random.Random(seed)
        self.nrng = np.random.default_rng(seed)
        self.g = ppu / density  # image px per texel

    # ---------- coordinate helpers (image px -> model units, snapped to texel grid) ----------
    def snap(self, v):
        return round(v * self.density) / self.density

    def X(self, px):
        return self.snap((self.cx - px) / self.ppu)

    def Y(self, py):
        return self.snap((self.ground - py) / self.ppu)

    def Z(self, pz):
        return self.snap(pz / self.ppu)

    def mx(self, px):
        """mirror an image x across the model centre line"""
        return 2 * self.cx - px

    def palette(self, entries):
        """entries: key -> dict(region=(x0,y0,x1,y1) or list, c=[rgb..], n=noise, k=brightness).
        Regions are cut into texel-sized cells; procedural texels are drawn from those cell
        colours so the generated surfaces share the reference's colour distribution."""
        g = self.g
        for k, e in entries.items():
            cols = []
            if 'region' in e:
                regs = e['region'] if isinstance(e['region'][0], (list, tuple)) else [e['region']]
                for (x0, y0, x1, y1) in regs:
                    ys = np.arange(y0, max(y0 + 1, y1 - g / 2), g / 2)
                    xs = np.arange(x0, max(x0 + 1, x1 - g / 2), g / 2)
                    for y in ys:
                        for x in xs:
                            c = self.sample_ref(x + g / 4, y + g / 4, g / 2)
                            if c is not None:
                                cols.append(c)
            for c in e.get('c', []):
                cols.append(np.array(c, dtype=np.float32))
            cols = np.array(cols, dtype=np.float32) * e.get('k', 1.0)
            # trim extreme outliers (grout / highlights)
            lum = cols.mean(axis=1)
            lo, hi = np.percentile(lum, e.get('pct', (25, 92)))
            keep = cols[(lum >= lo) & (lum <= hi)] if len(cols) > 6 else cols
            mean = keep.mean(axis=0)
            keep = mean + e.get('contrast', 0.6) * (keep - mean)
            self.pal[k] = dict(cols=keep, n=e.get('n', 0.025), spot=e.get('spot'))

    # ---------- silhouette measurement ----------
    def fg_mask(self):
        if not hasattr(self, '_fg'):
            im = self.ref
            self._fg = ~((im.min(axis=2) > 225) & ((im.max(axis=2) - im.min(axis=2)) < 28))
        return self._fg

    def _extent(self, y, xmin, xmax, seed):
        row = self.fg_mask()[int(y), int(xmin):int(xmax)]
        idx = np.where(row)[0]
        if len(idx) == 0:
            return None
        if seed is None:  # outer extents inside the window
            return xmin + idx[0], xmin + idx[-1] + 1
        s = int(seed - xmin)
        s = min(max(s, 0), len(row) - 1)
        if not row[s]:
            j = idx[np.argmin(np.abs(idx - s))]
            s = j
        l = s
        while l > 0 and (row[l - 1] or (l > 2 and row[l - 3])):
            l -= 1
        r = s
        while r < len(row) - 1 and (row[r + 1] or (r < len(row) - 3 and row[r + 3])):
            r += 1
        return xmin + l, xmin + r + 1

    def rows(self, y0, y1, xmin, xmax, seed, sym='both'):
        """Measure the silhouette of one part per texel row. Window/seed are given for the
        viewer-left instance (or a centred part). Returns [(ytop, ybot, xl, xr)] in px for the
        viewer-left instance, symmetric about cx when the part is centred."""
        g = self.g
        out = []
        k0 = math.floor((self.ground - y1) / g + 0.5)
        k1 = math.floor((self.ground - y0) / g + 0.5)
        for k in range(k0, k1):
            yb = self.ground - k * g
            yt = yb - g
            ls, rs = [], []
            for y in np.linspace(yt + g * 0.2, yb - g * 0.2, 5):
                e1 = self._extent(y, xmin, xmax, seed)
                e2 = self._extent(y, self.mx(xmax), self.mx(xmin), None if seed is None else self.mx(seed))
                if sym == 'left':
                    e2 = None
                if sym == 'right':
                    e1 = None
                cand = []
                if e1:
                    cand.append(e1)
                if e2:
                    cand.append((self.mx(e2[1]), self.mx(e2[0])))
                if cand:
                    l_, r_ = np.mean([c[0] for c in cand]), np.mean([c[1] for c in cand])
                    if sym == 'left':
                        r_ = self.mx(l_)
                    elif sym == 'right':
                        l_ = self.mx(r_)
                    ls.append(l_)
                    rs.append(r_)
            if ls:
                out.append((yt, yb, float(np.median(ls)), float(np.median(rs))))
        return out

    def stack(self, bone, name, rows, z0, z1, pal, zfac=0.6, r=0, min_depth=None, centred=False, zfun=None, **kw):
        """Turn measured rows into stacked boxes; narrower rows are inset in depth (rounded volume)."""
        snapx = lambda px: self.cx - round((self.cx - px) / self.g) * self.g
        rr = []
        for yt, yb, xl, xr in rows:
            if centred:
                hw = max(self.cx - xl, xr - self.cx)
                hw = (self.cx - xl + xr - self.cx) / 2
                xl, xr = self.cx - hw, self.cx + hw
            rr.append([yt, yb, snapx(xl), snapx(xr)])
        merged = []
        for row in rr:
            if merged and abs(merged[-1][2] - row[2]) < 1 and abs(merged[-1][3] - row[3]) < 1:
                merged[-1][0] = min(merged[-1][0], row[0])
                merged[-1][1] = max(merged[-1][1], row[1])
            else:
                merged.append(list(row))
        if not merged:
            return []
        maxw = max(m[3] - m[2] for m in merged)
        out = []
        for i, (yt, yb, xl, xr) in enumerate(merged):
            if zfun is not None:
                a, b = zfun(yt, yb, xl, xr, maxw)
            else:
                ins = round(zfac * (maxw - (xr - xl)) / 2 / self.g) * self.g
                a, b = z0 + ins, z1 - ins
            if min_depth and b - a < min_depth:
                c = (a + b) / 2
                a, b = c - min_depth / 2, c + min_depth / 2
            out += self.box(bone, f'{name}{i}', xl, xr, yt, yb, a, b, pal, r=r, **kw)
        return out

    def unrot(self, bone, x, y, z=0):
        """world (rest pose) image px -> the same point in the un-rotated frame of `bone`"""
        P = np.array([(self.cx - x) / self.ppu, (self.ground - y) / self.ppu, z / self.ppu, 1.0])
        Q = np.linalg.inv(self.bone_world(bone)) @ P
        return self.cx - Q[0] * self.ppu, self.ground - Q[1] * self.ppu, Q[2] * self.ppu

    # ---------- construction ----------
    def bone(self, name, parent, pivot_px, rot=(0, 0, 0)):
        x, y, z = pivot_px
        b = Bone(name, parent, [self.X(x), self.Y(y), self.Z(z)], list(rot))
        self.bones[name] = b
        self.order.append(name)
        if parent:
            self.bones[parent].children.append(b)
        return b

    def box(self, bone, name, x0, x1, y0, y1, z0, z1, pal, r=0, rot=None, origin_px=None, sample=True, tex=None, dens=None, snap=True, face_pal=None):
        """Axis-aligned box in image px. r = bevel in texels (rounded voxel edges via 3 cubes)."""
        if snap:
            frm = [self.X(x1), self.Y(y1), self.Z(z0)]
            to = [self.X(x0), self.Y(y0), self.Z(z1)]
        else:
            q = lambda v: round(v * (dens or self.density)) / (dens or self.density)
            frm = [q((self.cx - x1) / self.ppu), q((self.ground - y1) / self.ppu), q(z0 / self.ppu)]
            to = [q((self.cx - x0) / self.ppu), q((self.ground - y0) / self.ppu), q(z1 / self.ppu)]
        for i in range(3):
            if to[i] - frm[i] < 1 / (dens or self.density):
                to[i] = frm[i] + 1 / (dens or self.density)
        origin = None
        if origin_px is not None:
            origin = [self.X(origin_px[0]), self.Y(origin_px[1]), self.Z(origin_px[2])]
        rot = rot or (0, 0, 0)
        d = r / self.density
        size = [to[i] - frm[i] for i in range(3)]
        out = []
        if r and min(size) > 2 * d + 1e-6:
            parts = [
                ('', [frm[0] + d, frm[1] + d, frm[2]], [to[0] - d, to[1] - d, to[2]]),  # full Z
                ('_x', [frm[0], frm[1] + d, frm[2] + d], [to[0], to[1] - d, to[2] - d]),  # full X
                ('_y', [frm[0] + d, frm[1], frm[2] + d], [to[0] - d, to[1], to[2] - d]),  # full Y
            ]
            for suf, f, t in parts:
                c = Cube(bone, name + suf, f, t, pal, rot, origin or [(a + b) / 2 for a, b in zip(frm, to)], sample, tex, dens, face_pal)
                self.cubes.append(c)
                out.append(c)
        else:
            c = Cube(bone, name, frm, to, pal, rot, origin, sample, tex, dens, face_pal)
            self.cubes.append(c)
            out.append(c)
        return out

    def mbox(self, bone_r, bone_l, name, x0, x1, y0, y1, z0, z1, pal, r=0, rot=None, origin_px=None, **kw):
        """Box on the viewer-left (character right, '_r') plus its mirror on the character left."""
        self.box(bone_r, name + '_r', x0, x1, y0, y1, z0, z1, pal, r, rot, origin_px, **kw)
        rot_l = None if rot is None else (rot[0], -rot[1], -rot[2])
        org_l = None if origin_px is None else (self.mx(origin_px[0]), origin_px[1], origin_px[2])
        self.box(bone_l, name + '_l', self.mx(x1), self.mx(x0), y0, y1, z0, z1, pal, r, rot_l, org_l, **kw)

    # ---------- transforms ----------
    def bone_world(self, name):
        b = self.bones[name]
        M = pivot_mat(b.pivot, b.rot)
        if b.parent:
            M = self.bone_world(b.parent) @ M
        return M

    def cube_world(self, c):
        return self.bone_world(c.bone) @ pivot_mat(c.origin, c.rot)

    # ---------- face geometry ----------
    @staticmethod
    def face_frame(c, face):
        """returns (corner at (u1,v1), u axis vector, v axis vector, normal) in cube-local absolute coords
        lengths of u/v vectors are the face extents"""
        f, t = c.frm, c.to
        if face == 'north':
            return np.array([t[0], t[1], f[2]]), np.array([f[0] - t[0], 0, 0]), np.array([0, f[1] - t[1], 0]), np.array([0, 0, -1])
        if face == 'south':
            return np.array([f[0], t[1], t[2]]), np.array([t[0] - f[0], 0, 0]), np.array([0, f[1] - t[1], 0]), np.array([0, 0, 1])
        if face == 'east':
            return np.array([t[0], t[1], t[2]]), np.array([0, 0, f[2] - t[2]]), np.array([0, f[1] - t[1], 0]), np.array([1, 0, 0])
        if face == 'west':
            return np.array([f[0], t[1], f[2]]), np.array([0, 0, t[2] - f[2]]), np.array([0, f[1] - t[1], 0]), np.array([-1, 0, 0])
        if face == 'up':
            return np.array([f[0], t[1], f[2]]), np.array([t[0] - f[0], 0, 0]), np.array([0, 0, t[2] - f[2]]), np.array([0, 1, 0])
        if face == 'down':
            return np.array([f[0], f[1], t[2]]), np.array([t[0] - f[0], 0, 0]), np.array([0, 0, f[2] - t[2]]), np.array([0, -1, 0])

    def face_texels(self, c, face):
        o, u, v, n = self.face_frame(c, face)
        d = c.dens or self.density
        W = max(1, int(round(np.linalg.norm(u) * d)))
        H = max(1, int(round(np.linalg.norm(v) * d)))
        return o, u, v, n, W, H

    # ---------- culling of faces buried inside another cube of the same bone ----------
    def cull(self):
        eps = 1e-6
        for c in self.cubes:
            for face in FACES:
                c.faces[face] = 'live'
            if any(abs(r) > 1e-9 for r in c.rot):
                continue
            for face in FACES:
                o, u, v, n = self.face_frame(c, face)
                lo = np.minimum(o, o + u + v)
                hi = np.maximum(o, o + u + v)
                axis = int(np.argmax(np.abs(n)))
                sgn = n[axis]
                for d in self.cubes:
                    if d is c or d.bone != c.bone or any(abs(r) > 1e-9 for r in d.rot):
                        continue
                    ok = True
                    for i in range(3):
                        if i == axis:
                            p = lo[i]
                            if sgn > 0:
                                ok &= d.frm[i] <= p + eps and d.to[i] > p + eps
                            else:
                                ok &= d.to[i] >= p - eps and d.frm[i] < p - eps
                        else:
                            ok &= d.frm[i] <= lo[i] + eps and d.to[i] >= hi[i] - eps
                    if ok:
                        c.faces[face] = None
                        break

    # ---------- front visibility ray cast ----------
    def _prepare_raycast(self):
        self._inv = []
        for c in self.cubes:
            M = self.cube_world(c)
            self._inv.append((np.linalg.inv(M), np.array(c.frm), np.array(c.to)))

    def front_depth(self, XY):
        """XY: (N,2) model coords. returns nearest world z hit by ray travelling +Z from the front."""
        N = len(XY)
        best = np.full(N, np.inf)
        o = np.c_[XY, np.full(N, -500.0), np.ones(N)]
        dvec = np.array([0, 0, 1.0, 0])
        for Minv, f, t in self._inv:
            lo_ = (Minv @ o.T).T[:, :3]
            dl = (Minv @ dvec)[:3]
            tmin = np.full(N, -np.inf)
            tmax = np.full(N, np.inf)
            for i in range(3):
                if abs(dl[i]) < 1e-12:
                    inside = (lo_[:, i] >= f[i] - 1e-9) & (lo_[:, i] <= t[i] + 1e-9)
                    tmin = np.where(inside, tmin, np.inf)
                else:
                    t1 = (f[i] - lo_[:, i]) / dl[i]
                    t2 = (t[i] - lo_[:, i]) / dl[i]
                    tmin = np.maximum(tmin, np.minimum(t1, t2))
                    tmax = np.minimum(tmax, np.maximum(t1, t2))
            hit = (tmin <= tmax) & (tmax > 0)
            best = np.where(hit & (tmin < best), tmin, best)
        return best - 500.0

    # ---------- texturing ----------
    def sample_ref(self, ix, iy, g=None):
        g = g or self.g
        h = max(1, int(g * 0.4))
        x, y = int(round(ix)), int(round(iy))
        H, W = self.ref.shape[:2]
        if x < 0 or y < 0 or x >= W or y >= H:
            return None
        patch = self.ref[max(0, y - h):y + h + 1, max(0, x - h):x + h + 1].reshape(-1, 3)
        white = (patch.min(axis=1) > 215) & ((patch.max(axis=1) - patch.min(axis=1)) < 30)
        if white.mean() > 0.3:
            return None  # background / anti-aliased silhouette edge
        patch = patch[~white]
        return np.median(patch, axis=0)

    def proc_color(self, pal, rng):
        p = self.pal[pal]
        cols = p['cols']
        c = cols[rng.integers(len(cols))] * (1.0 + rng.normal(0, p['n']))
        if p['spot'] is not None and rng.random() < p['spot'][1]:
            c = np.array(p['spot'][0], dtype=np.float32) * (0.85 + 0.3 * rng.random())
        return c

    def paint(self):
        self.cull()
        self._prepare_raycast()
        rng = self.nrng
        self.face_imgs = {}
        for ci, c in enumerate(self.cubes):
            Mw = self.cube_world(c)
            Rw = Mw[:3, :3]
            for face in FACES:
                if c.faces[face] is None:
                    continue
                o, u, v, n, W, H = self.face_texels(c, face)
                img = np.zeros((H, W, 3), np.float32)
                if c.tex is not None:
                    t = c.tex(face, W, H, self, rng)
                    if t is not None:
                        self.face_imgs[(ci, face)] = np.clip(t, 0, 255).astype(np.uint8)
                        continue
                fpal = c.face_pal.get(face, c.pal)
                for j in range(H):
                    for i in range(W):
                        img[j, i] = self.proc_color(fpal, rng)
                nw = Rw @ n
                if c.sample and nw[2] < -0.5:
                    jj, ii = np.mgrid[0:H, 0:W]
                    P = o[None, None, :] + ((ii + 0.5) / W)[..., None] * u + ((jj + 0.5) / H)[..., None] * v
                    P = P.reshape(-1, 3)
                    Pw = (Mw @ np.c_[P, np.ones(len(P))].T).T[:, :3]
                    zf = self.front_depth(Pw[:, :2])
                    vis = Pw[:, 2] <= zf + 0.6 / self.density
                    for k in range(len(P)):
                        if not vis[k]:
                            continue
                        col = self.sample_ref(self.cx - Pw[k, 0] * self.ppu, self.ground - Pw[k, 1] * self.ppu,
                                              self.ppu / (c.dens or self.density))
                        if col is not None:
                            img[k // W, k % W] = col
                self.face_imgs[(ci, face)] = np.clip(img, 0, 255).astype(np.uint8)
        self.pack()

    def pack(self):
        items = sorted(self.face_imgs.items(), key=lambda kv: (-kv[1].shape[0], -kv[1].shape[1]))
        area = sum(i.shape[0] * i.shape[1] for _, i in items)
        TW = 64
        while TW * TW < area * 1.35:
            TW *= 2
        while True:
            x = y = rowh = 0
            pos = {}
            ok = True
            for key, im in items:
                h, w = im.shape[:2]
                if x + w > TW:
                    x, y, rowh = 0, y + rowh, 0
                pos[key] = (x, y)
                x += w
                rowh = max(rowh, h)
            TH = y + rowh
            th = 16
            while th < TH:
                th *= 2
            if th <= TW * 2:
                break
            TW *= 2
        self.tw, self.th = TW, th
        atlas = np.zeros((th, TW, 4), np.uint8)
        for key, im in items:
            x, y = pos[key]
            h, w = im.shape[:2]
            atlas[y:y + h, x:x + w, :3] = im
            atlas[y:y + h, x:x + w, 3] = 255
            ci, face = key
            self.cubes[ci].faces[face] = [x, y, x + w, y + h]
        self.atlas = Image.fromarray(atlas, 'RGBA')

    # ---------- export ----------
    def _uuid(self):
        return str(uuid.UUID(int=self.rng.getrandbits(128), version=4))

    @staticmethod
    def r(v, n=4):
        v = round(v, n)
        return int(v) if abs(v - int(v)) < 1e-9 else v

    def texture_b64(self):
        buf = io.BytesIO()
        self.atlas.save(buf, 'PNG')
        return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()

    def to_bbmodel(self, animations):
        R = self.r
        for b in self.bones.values():
            b.uuid = self._uuid()
        elements = []
        for c in self.cubes:
            c.uuid = self._uuid()
            faces = {}
            for f in FACES:
                if c.faces[f] is None:
                    faces[f] = {"uv": [0, 0, 0, 0], "texture": None}
                else:
                    faces[f] = {"uv": [R(v) for v in c.faces[f]], "texture": 0}
            el = {
                "name": c.name, "box_uv": False, "rescale": False, "locked": False,
                "light_emission": 0, "render_order": "default", "allow_mirror_modeling": True,
                "from": [R(v) for v in c.frm], "to": [R(v) for v in c.to],
                "autouv": 0, "color": self.order.index(c.bone) % 8,
                "origin": [R(v) for v in c.origin],
                "faces": faces, "type": "cube", "uuid": c.uuid,
            }
            if any(abs(v) > 1e-9 for v in c.rot):
                el["rotation"] = [R(v) for v in c.rot]
            elements.append(el)

        def group(b):
            g = {
                "name": b.name, "origin": [R(v) for v in b.pivot], "color": 0, "uuid": b.uuid,
                "export": True, "mirror_uv": False, "isOpen": False, "locked": False,
                "visibility": True, "autouv": 0, "selected": False,
                "children": [c.uuid for c in self.cubes if c.bone == b.name] + [group(ch) for ch in b.children],
            }
            if any(abs(v) > 1e-9 for v in b.rot):
                g["rotation"] = [R(v) for v in b.rot]
            return g

        roots = [group(self.bones[n]) for n in self.order if self.bones[n].parent is None]
        tex = {
            "path": "", "name": f"{self.name}.png", "folder": "", "namespace": "", "id": "0", "group": "",
            "width": self.tw, "height": self.th, "uv_width": self.tw, "uv_height": self.th,
            "particle": False, "use_as_default": False, "layers_enabled": False, "sync_to_project": "",
            "render_mode": "default", "render_sides": "auto", "pbr_channel": "color",
            "frame_time": 1, "frame_order_type": "loop", "frame_order": "", "frame_interpolate": False,
            "visible": True, "internal": True, "saved": False, "uuid": self._uuid(),
            "relative_path": f"../textures/{self.name}.png", "source": self.texture_b64(),
        }
        anims = []
        for a in animations:
            animators = {}
            for bname, chans in a['bones'].items():
                if bname not in self.bones:
                    continue
                kfs = []
                for ch, keys in chans.items():
                    for (t, val, interp) in keys:
                        kfs.append({
                            "channel": ch,
                            "data_points": [{"x": fmt(val[0]), "y": fmt(val[1]), "z": fmt(val[2])}],
                            "uuid": self._uuid(), "time": R(t), "color": -1, "interpolation": interp,
                        })
                animators[self.bones[bname].uuid] = {"name": bname, "type": "bone", "keyframes": kfs}
            anims.append({
                "uuid": self._uuid(), "name": a['name'], "loop": a['loop'], "override": False,
                "length": a['length'], "snapping": 24, "selected": False, "anim_time_update": "",
                "blend_weight": "", "start_delay": "", "loop_delay": "", "animators": animators,
            })
        return {
            "meta": {"format_version": "4.10", "model_format": "bedrock", "box_uv": False},
            "name": self.name, "model_identifier": self.name,
            "visible_box": [4, 3, 1.25], "variable_placeholders": "", "variable_placeholder_buttons": [],
            "bedrock_animation_mode": "entity", "timeline_setups": [], "unhandled_root_fields": {},
            "resolution": {"width": self.tw, "height": self.th},
            "elements": elements, "outliner": roots, "textures": [tex], "animations": anims,
        }

    def to_geo(self):
        R = self.r
        bones = []
        for n in self.order:
            b = self.bones[n]
            jb = {"name": b.name}
            if b.parent:
                jb["parent"] = b.parent
            jb["pivot"] = [R(-b.pivot[0]), R(b.pivot[1]), R(b.pivot[2])]
            if any(abs(v) > 1e-9 for v in b.rot):
                jb["rotation"] = [R(-b.rot[0]), R(-b.rot[1]), R(b.rot[2])]
            cubes = []
            for c in self.cubes:
                if c.bone != n:
                    continue
                size = [c.to[i] - c.frm[i] for i in range(3)]
                jc = {"origin": [R(-c.to[0]), R(c.frm[1]), R(c.frm[2])], "size": [R(s) for s in size]}
                if any(abs(v) > 1e-9 for v in c.rot):
                    jc["pivot"] = [R(-c.origin[0]), R(c.origin[1]), R(c.origin[2])]
                    jc["rotation"] = [R(-c.rot[0]), R(-c.rot[1]), R(c.rot[2])]
                uv = {}
                for f in FACES:
                    if c.faces[f] is None:
                        continue
                    u1, v1, u2, v2 = c.faces[f]
                    p, s = [u1, v1], [u2 - u1, v2 - v1]
                    if f in ('up', 'down'):
                        p = [p[0] + s[0], p[1] + s[1]]
                        s = [-s[0], -s[1]]
                    uv[f] = {"uv": [R(p[0]), R(p[1])], "uv_size": [R(s[0]), R(s[1])]}
                jc["uv"] = uv
                cubes.append(jc)
            if cubes:
                jb["cubes"] = cubes
            bones.append(jb)
        return {
            "format_version": "1.12.0",
            "minecraft:geometry": [{
                "description": {
                    "identifier": f"geometry.{self.name}", "texture_width": self.tw, "texture_height": self.th,
                    "visible_bounds_width": 4, "visible_bounds_height": 3.5, "visible_bounds_offset": [0, 1.5, 0],
                },
                "bones": bones,
            }],
        }


def fmt(v):
    if isinstance(v, str):
        return v
    v = round(float(v), 4)
    return str(int(v)) if v == int(v) else str(v)


def anims_to_bedrock(animations):
    out = {}
    for a in animations:
        bones = {}
        for bname, chans in a['bones'].items():
            jb = {}
            for ch, keys in chans.items():
                kd = {}
                for (t, val, interp) in sorted(keys, key=lambda k: k[0]):
                    vec = [float(fmt(x)) if not isinstance(x, str) else x for x in val]
                    vec = [int(x) if isinstance(x, float) and x == int(x) else x for x in vec]
                    key = f"{round(t, 4)}"
                    kd[key] = {"post": vec, "lerp_mode": "catmullrom"} if interp == 'catmullrom' else vec
                jb[ch] = kd
            bones[bname] = jb
        entry = {}
        if a['loop'] == 'loop':
            entry['loop'] = True
        elif a['loop'] == 'hold':
            entry['loop'] = 'hold_on_last_frame'
        entry['animation_length'] = a['length']
        entry['bones'] = bones
        out[a['name']] = entry
    return {"format_version": "1.8.0", "animations": out}
