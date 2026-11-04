"""Box-UV packing + hand-tuned procedural pixel painting for the Brinesleeper.

Every texel is painted knowing which cube/face it lands on and where that texel
sits on the creature in its rest pose, so mottling flows continuously across
cube edges while the face, ribs, spine, knuckles and claws are placed by hand.
"""
import math
import numpy as np
from PIL import Image

from rig import H, ZO, world_matrices, xform

TEX_W, TEX_H = 128, 64

# ------------------------------------------------------------------ palettes
FACE = [(58, 48, 54), (86, 73, 81), (113, 99, 107), (138, 124, 131), (160, 146, 152),
        (180, 167, 173), (198, 186, 190), (214, 205, 208)]
HEADSKIN = [(66, 56, 62), (92, 80, 87), (118, 105, 112), (142, 129, 135), (164, 151, 157), (183, 171, 176)]
SKIN = [(33, 28, 32), (46, 40, 45), (60, 52, 58), (75, 66, 72), (91, 81, 88), (108, 98, 104), (127, 117, 123)]
TORSO = [(30, 25, 28), (42, 36, 39), (56, 48, 51), (70, 61, 64), (86, 75, 79), (103, 92, 96), (121, 110, 114)]
HAND = [(56, 48, 54), (74, 65, 71), (93, 83, 90), (113, 103, 109), (133, 123, 129), (153, 143, 148),
        (174, 165, 169), (196, 188, 191)]
DRIP = [(10, 7, 9), (19, 14, 17), (29, 22, 26), (42, 33, 38), (60, 49, 55)]
MOUTH = [(22, 8, 11), (38, 14, 19), (58, 24, 31), (84, 40, 48)]
EYE = (6, 4, 5)


def ramp(pal, v):
    i = int(round(v))
    return pal[max(0, min(len(pal) - 1, i))]


# ------------------------------------------------------------------ noise
def _hash3(ix, iy, iz, seed):
    h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 144665) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def vnoise(p, scale, seed):
    x, y, z = p[0] / scale, p[1] / scale, p[2] / scale
    ix, iy, iz = math.floor(x), math.floor(y), math.floor(z)
    fx, fy, fz = x - ix, y - iy, z - iz
    sx, sy, sz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
    acc = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (sx if dx else 1 - sx) * (sy if dy else 1 - sy) * (sz if dz else 1 - sz)
                acc += w * _hash3(ix + dx, iy + dy, iz + dz, seed)
    return acc * 2 - 1  # [-1, 1]


def cell(i, j, seed):
    return _hash3(i, j, seed, 77) * 2 - 1


# ------------------------------------------------------------------ packing
FACES = ('east', 'north', 'west', 'south', 'up', 'down')


def face_regions(c):
    """Box-UV rectangles (u, v, w, h) per face, relative to the cube's uv."""
    w, h, d = c.size
    U, V = c.uv
    return {
        'east': (U, V + d, d, h),            # model's right side (-X)
        'north': (U + d, V + d, w, h),       # front (-Z)
        'west': (U + d + w, V + d, d, h),    # model's left side (+X)
        'south': (U + 2 * d + w, V + d, w, h),  # back (+Z)
        'up': (U + d, V, w, d),
        'down': (U + d + w, V, w, d),
    }


def texel_point(c, face, i, j):
    """Bind-space point at the centre of texel (i=column, j=row) on a face, and the face normal."""
    x0, y0, z0 = c.lo
    x1, y1, z1 = c.hi
    if face == 'north':
        return (x0 + i + .5, y1 - j - .5, z0), (0, 0, -1)
    if face == 'south':
        return (x1 - i - .5, y1 - j - .5, z1), (0, 0, 1)
    if face == 'east':
        return (x0, y1 - j - .5, z1 - i - .5), (-1, 0, 0)
    if face == 'west':
        return (x1, y1 - j - .5, z0 + i + .5), (1, 0, 0)
    if face == 'up':
        return (x0 + i + .5, y1, z1 - j - .5), (0, 1, 0)
    if face == 'down':
        return (x0 + i + .5, y0, z1 - j - .5), (0, -1, 0)


def pack(cubes):
    """Skyline bottom-left packing of box-UV islands into TEX_W x TEX_H."""
    items = sorted(cubes, key=lambda c: (-(c.size[2] + c.size[1]), -(2 * (c.size[0] + c.size[2]))))
    sky = [0] * TEX_W
    for c in items:
        w, h, d = c.size
        iw, ih = 2 * (w + d), d + h
        best = None
        for x in range(0, TEX_W - iw + 1):
            y = max(sky[x:x + iw])
            if y + ih <= TEX_H and (best is None or y < best[1] or (y == best[1] and x < best[0])):
                best = (x, y)
        if best is None:
            raise RuntimeError(f'texture full packing {c.name}')
        x, y = best
        c.uv = [x, y]
        for k in range(x, x + iw):
            sky[k] = y + ih
    return max(sky)


# ------------------------------------------------------------------ painting
class Painter:
    def __init__(self, rig):
        self.rig = rig
        self.W = world_matrices(rig)
        self.img = np.zeros((TEX_H, TEX_W, 4), dtype=np.uint8)

    def world(self, c, p, n):
        m = self.W[c.bone.name]
        wp = xform(m, p)
        wn = m[:3, :3] @ np.array(n, dtype=float)
        return wp, wn / (np.linalg.norm(wn) + 1e-9)

    def paint(self):
        for c in self.rig.all_cubes():
            regs = face_regions(c)
            for face in FACES:
                u0, v0, fw, fh = regs[face]
                for j in range(fh):
                    for i in range(fw):
                        p, n = texel_point(c, face, i, j)
                        wp, wn = self.world(c, p, n)
                        col = self.shade(c, face, i, j, fw, fh, np.array(p), wp, wn)
                        self.img[v0 + j, u0 + i] = (*col, 255)
        return Image.fromarray(self.img, 'RGBA')

    # mottled wet-skin value (continuous across cubes)
    def mottle(self, wp, amp=1.0, seed=1):
        return amp * (0.85 * vnoise(wp, 2.6, seed) + 0.55 * vnoise(wp, 1.1, seed + 9))

    def sheen(self, wp, prob=0.035, seed=5):
        return _hash3(int(math.floor(wp[0] * 3)), int(math.floor(wp[1] * 3)), int(math.floor(wp[2] * 3)), seed) < prob

    def light(self, wn):
        # very mild baked form shading: top-lit, a hint from the front
        return 0.55 * wn[1] + 0.2 * (-wn[2])

    def shade(self, c, face, i, j, fw, fh, p, wp, wn):
        part = c.tags.get('part')
        fn = getattr(self, 'shade_' + c.mat)
        return fn(c, part, face, i, j, fw, fh, p, wp, wn)

    # ---------------------------------------------------------------- face / head
    def shade_face(self, c, part, face, i, j, fw, fh, p, wp, wn):
        rnd = cell(int(p[0] * 2 + 50), int(p[1] * 2 + 50) + int(p[2] * 7 + 50) * 3, 3)
        if part == 'cranium':
            if face == 'north':
                return self.face_front(i, j, rnd)
            if face == 'down':
                # the part covered by the jaw is the roof of the mouth (seen when it opens)
                x, z = p[0], p[2] - ZO
                if -3 < x < 3 and z < 0.5:
                    if z < -4.5:
                        return FACE[6] if (int(x + 10) % 2 == 0) else MOUTH[1]   # upper fangs
                    return ramp(MOUTH, 1.2 + 0.8 * rnd)
                return ramp(HEADSKIN, 1.0 + 0.5 * rnd)
            if face in ('east', 'west'):
                # i runs back->front on east, front->back on west
                front = i / (fw - 1) if face == 'east' else 1 - i / (fw - 1)   # 1 = front edge
                v = 2.0 + 2.2 * front ** 1.5 - 0.08 * j + 0.7 * rnd
                if j <= 1:
                    v -= 0.4
                return ramp(HEADSKIN, v)
            if face == 'up':
                # j=0 at the back, j=fh-1 at the front edge
                v = 2.3 + 1.4 * (j / (fh - 1)) + 0.8 * rnd
                return ramp(HEADSKIN, v)
            if face == 'south':
                v = 2.6 + 0.7 * rnd - 0.12 * j
                if 2 <= i <= 5 and j <= 4:
                    v -= 0.8
                return ramp(HEADSKIN, v)
        if part == 'jaw':
            if face == 'north':
                return self.jaw_front(i, j, rnd)
            if face == 'up':
                z = p[2] - ZO
                if z < -4.5:
                    return FACE[6] if (int(p[0] + 10) % 2 == 1) else MOUTH[0]   # lower fangs
                if -2 < p[0] < 2 and -3.5 < z < -0.5:
                    return ramp(MOUTH, 2.3 + 0.6 * rnd)  # tongue
                return ramp(MOUTH, 0.8 + 0.6 * rnd)
            if face == 'down':
                front = j / (fh - 1)
                return ramp(HEADSKIN, 0.6 + 1.6 * front + 0.5 * rnd)
            if face in ('east', 'west'):
                front = (i / (fw - 1)) if face == 'east' else (1 - i / (fw - 1))
                v = 1.0 + 2.4 * front ** 1.4 - 0.3 * j + 0.6 * rnd
                return ramp(HEADSKIN, v)
            if face == 'south':
                return ramp(HEADSKIN, 0.4 + 0.5 * rnd)
        return ramp(HEADSKIN, 2)

    FACE_MAP = [
        "22333322",
        "23344332",
        "33444433",
        "34455443",
        "34556543",
        "45566554",
        "4E5665E4",
        "4T6666T4",
        "3T5665T3",
    ]
    JAW_MAP = [
        "T5665T",
        "T4554T",
        "T3mm3T",
    ]

    def face_front(self, i, j, rnd):
        ch = self.FACE_MAP[j][i]
        if ch == 'E':
            return EYE
        if ch == 'T':
            return DRIP[3] if j == 7 else DRIP[2]
        v = int(ch)
        # subtle pixel variation, never touching the eye row
        if j not in (6,) and abs(rnd) > 0.55:
            v += 1 if rnd > 0 else -1
        # faint tear tracks one column inside the streaks
        if j >= 7 and i in (2, 5) and rnd < 0.1:
            v -= 1
        return ramp(FACE, v)

    def jaw_front(self, i, j, rnd):
        ch = self.JAW_MAP[j][i]
        if ch == 'T':
            return DRIP[2] if j < 2 else DRIP[1]
        if ch == 'm':
            return FACE[2]
        v = int(ch)
        if abs(rnd) > 0.6:
            v += 1 if rnd > 0 else -1
        return ramp(FACE, v)

    # ---------------------------------------------------------------- drips
    def shade_drip(self, c, part, face, i, j, fw, fh, p, wp, wn):
        if face == 'down':
            return DRIP[3]
        if face == 'up':
            return DRIP[1]
        v = 1.6 if face == 'north' else 1.0
        if j == fh - 1:
            v += 1.4      # bead of fluid at the tip
        elif j == 0 and face == 'north':
            v += 0.6
        if face == 'north' and j == 1 and fh >= 4:
            v += 1.0      # wet glint
        return ramp(DRIP, v)

    # ---------------------------------------------------------------- neck
    def shade_neck(self, c, part, face, i, j, fw, fh, p, wp, wn):
        v = 3.1 + self.mottle(wp, 1.1, 11) + self.light(wn)
        if face == 'south':          # dorsal ridge (faces up in the hunched pose)
            v += 0.7
            if i in (1, 2) and int(p[1]) % 2 == 0:
                v += 1.2             # vertebra knuckles along the arch
        elif face == 'north':        # throat
            v -= 1.0
            if i in (1, 2) and int(p[1]) % 3 == 0:
                v -= 0.6
        if self.sheen(wp, 0.03):
            v += 1.6
        return ramp(SKIN, v)

    # ---------------------------------------------------------------- torso
    def shade_torso(self, c, part, face, i, j, fw, fh, p, wp, wn):
        rnd = self.mottle(wp, 0.8, 21)
        v = 3.2 + rnd + 0.6 * self.light(wn)
        x = p[0]
        yrel = p[1] - H
        if part in ('ribs_top', 'ribs_mid', 'ribs_low'):
            if face in ('north', 'east', 'west'):
                rib = (int(math.floor(yrel)) % 2 == 0)
                if face == 'north':
                    sternum = abs(x) < 1.0
                    if sternum:
                        v = 2.6 + 0.5 * rnd + (0.6 if rib else 0)
                    else:
                        # ribs dip toward the sternum: offset row by distance from centre
                        r2 = (int(math.floor(yrel + (0.5 if abs(x) < 3 else 0))) % 2 == 0)
                        v += 0.9 if r2 else -0.55
                    if part == 'ribs_top' and j == 0:
                        v += 0.8   # collarbone ridge
                else:
                    v += 0.7 if rib else -0.5
                    if part == 'ribs_low' and j >= fh - 1:
                        v -= 0.4
            elif face == 'south':
                spine = abs(x) < 1.0
                if spine:
                    v = 3.2 + (1.0 if int(math.floor(yrel)) % 2 == 0 else -0.6)
                elif part == 'ribs_top' and 1.5 < abs(x) < 6.0 and j <= 3:
                    # shoulder blades
                    v += 1.4 if (j <= 2 and 2.0 < abs(x) < 5.0) else 0.5
                else:
                    v += 0.15 * self.mottle(wp, 1.0, 23)
            elif face == 'up':
                v += 0.6
                if part != 'ribs_top':
                    v -= 1.2    # ledges under the wider rib tier above
            elif face == 'down':
                v -= 1.2
        elif part == 'waist':
            if face == 'north':
                v -= 0.7
                if abs(x) < 0.6 or (abs(x) > 2.0 and j % 3 == 1):
                    v -= 0.7
            elif face == 'south':
                if abs(x) < 1.0:
                    v = 3.0 + (1.0 if int(math.floor(yrel)) % 2 == 0 else -0.5)
            else:
                v -= 0.3 + (0.5 if j % 2 else 0)
        elif part == 'pelvis':
            if face == 'north':
                if abs(x) < 1.6:
                    v -= 1.0
                elif 2.5 < abs(x) < 4.5 and j <= 1:
                    v += 1.6     # hip bones
            elif face == 'south':
                if abs(x) < 1.5:
                    v += 1.0 if j < 2 else 0.2
                elif 2 < abs(x) < 4.5 and j <= 1:
                    v += 1.0
            elif face == 'up':
                v += 0.4
            elif face == 'down':
                v -= 1.3
            else:
                v += 0.8 if j == 0 else 0
        if self.sheen(wp, 0.025, 7):
            v += 1.5
        return ramp(TORSO, v)

    # ---------------------------------------------------------------- bony knobs
    def shade_bone(self, c, part, face, i, j, fw, fh, p, wp, wn):
        rnd = self.mottle(wp, 0.7, 31)
        if part == 'vertebra':
            return ramp(TORSO, 4.0 + 0.6 * rnd + (0.8 if face == 'up' else 0) - (1.2 if face == 'down' else 0))
        v = 3.9 + rnd + 0.8 * self.light(wn)
        if face == 'down':
            v -= 1.0
        if part == 'shoulder' and face == 'up':
            v += 0.6
        if self.sheen(wp, 0.05, 9):
            v += 1.3
        return ramp(SKIN, v)

    # ---------------------------------------------------------------- limbs
    def shade_limb(self, c, part, face, i, j, fw, fh, p, wp, wn):
        s = c.tags.get('side', 1)
        rnd = self.mottle(wp, 1.15, 41)
        v = 2.9 + rnd + 0.7 * self.light(wn)
        # outer side of the limb slightly lighter, inner side darker
        if face in ('east', 'west'):
            outer = (face == 'east' and s < 0) or (face == 'west' and s > 0)
            v += 0.35 if outer else -0.45
        t = j / max(1, fh - 1)        # 0 at the top of the segment, 1 at the bottom
        if part == 'forearm':
            v += 1.1 * t              # paler toward the hand
        elif part == 'upperarm':
            v -= 0.4 * (1 - t) * (1 - t)
        elif part == 'thigh':
            v -= 0.3 * (1 - t)
        elif part == 'shin':
            v -= 0.9 * t              # darker, wetter toward the feet
        if face == 'up':
            v += 0.3
        if face == 'down':
            v -= 0.8
        if self.sheen(wp, 0.035, 13):
            v += 1.7
        return ramp(SKIN, v)

    # ---------------------------------------------------------------- hands
    def shade_hand(self, c, part, face, i, j, fw, fh, p, wp, wn):
        rnd = self.mottle(wp, 0.7, 51)
        v = 2.5 + rnd + 0.6 * self.light(wn)
        if part == 'palm':
            if face == 'north':          # back of the hand
                if j == fh - 1:
                    v += 0.9 if i % 1 == 0 else 0   # knuckle row
                if j < fh - 1 and i in (1, 3) and j >= 1:
                    v += 0.5                         # tendons
            elif face == 'south':        # palm
                v -= 1.1
            elif face == 'down':
                v -= 0.6
            elif face == 'up':
                v -= 0.4
        elif part == 'finger':
            if face == 'south':
                v -= 0.8
            if j == 0:
                v += 0.6
            if j == fh - 1 and face in ('north', 'east', 'west'):
                v += 0.9                             # middle knuckle
        elif part == 'fingertip':
            if face == 'south':
                v -= 0.6
            if j >= fh - 1 or face == 'down':
                return HAND[5] if face != 'south' else HAND[4]   # pale claw
            if j == fh - 2:
                v += 0.9
        if self.sheen(wp, 0.04, 15):
            v += 1.2
        return ramp(HAND, v)

    # ---------------------------------------------------------------- feet
    def shade_foot(self, c, part, face, i, j, fw, fh, p, wp, wn):
        rnd = self.mottle(wp, 0.7, 61)
        v = 2.0 + rnd + 0.6 * self.light(wn)
        if part == 'toe':
            v += 0.5
            front_end = (face == 'up' and j == fh - 1) or (face == 'down' and j == fh - 1) or \
                        (face in ('east', 'west') and ((face == 'east' and i == fw - 1) or (face == 'west' and i == 0))) or \
                        face == 'north'
            if front_end:
                return HAND[5] if face != 'down' else HAND[4]   # claw
        else:
            if face == 'down':
                v -= 1.2
            if face == 'up':
                v += 0.4
                if j >= fh - 2:
                    v += 0.5   # toe knuckles
        return ramp(HAND, v)
