"""Minimal forward kinematics for Bedrock entity geometry (model pixels, Bedrock axes: +y up, the model's
front is -z). Same conventions as Blockbench / tools/render/bedrock_model.js: a bone turns about its pivot
by its rest rotation plus the animation rotation, R = Rz(-z) . Ry(y) . Rx(-x); animation positions add to
the bone's offset from its parent. Used by the generator to fit procedural poses to each skeleton
(e.g. knees and forearms resting on the floor in the crawl)."""
import math
import numpy as np


def rot(r):
    """Rz(-z) . Ry(y) . Rx(-x), multiplied out."""
    x, y, z = (math.radians(v) for v in r)
    cx, sx = math.cos(-x), math.sin(-x)
    cy, sy = math.cos(y), math.sin(y)
    cz, sz = math.cos(-z), math.sin(-z)
    return np.array([[cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
                     [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
                     [-sy, cy * sx, cy * cx]])


class Skeleton:
    def __init__(self, geo):
        g = geo['minecraft:geometry'][0] if 'minecraft:geometry' in geo else geo
        self.bones = {b['name']: b for b in g['bones']}

    def _chain(self):
        """Per bone, parents first (cached): name, parent, pivot, offset from the parent's pivot, rest rotation
        and its matrix."""
        if '_chain_' not in self.__dict__:
            order, seen = [], set()

            def visit(name):
                if name in seen:
                    return
                b = self.bones[name]
                if b.get('parent'):
                    visit(b['parent'])
                seen.add(name)
                piv = np.array(b.get('pivot', [0, 0, 0]), float)
                ppiv = np.array(self.bones[b['parent']].get('pivot', [0, 0, 0]), float) if b.get('parent') else np.zeros(3)
                rest = [float(v) for v in b.get('rotation', [0, 0, 0])]
                order.append((name, b.get('parent'), piv, piv - ppiv, rest, rot(rest)))
            for n in self.bones:
                visit(n)
            self.__dict__['_chain_'] = order
        return self.__dict__['_chain_']

    def world(self, pose):
        """pose: {bone: {'rotation': [x,y,z], 'position': [x,y,z]}} -> {bone: (R, origin)} (origin = pivot)."""
        out = {}
        for name, parent, piv, d, rest, Rrest in self._chain():
            p = pose.get(name)
            r = p.get('rotation') if p else None
            off = p.get('position') if p else None
            Rl = Rrest if r is None else rot((rest[0] + r[0], rest[1] + r[1], rest[2] + r[2]))
            if off is not None:
                d = d + np.asarray(off, float)
            if parent:
                PR, PO = out[parent]
                out[name] = (PR @ Rl, PO + PR @ d)
            else:
                out[name] = (Rl, piv + (np.asarray(off, float) if off is not None else 0.0))
        return out

    def point(self, W, bone, p):
        """World position of a model-space point p (rest-pose coordinates) attached to bone."""
        R, O = W[bone]
        piv = np.array(self.bones[bone].get('pivot', [0, 0, 0]), float)
        return O + R @ (np.asarray(p, float) - piv)

    def _local_corners(self, bone):
        """Rest-pose corners of a bone's cubes relative to its pivot (cached), shape (n, 3)."""
        cache = self.__dict__.setdefault('_corners', {})
        if bone not in cache:
            b = self.bones[bone]
            piv = np.array(b.get('pivot', [0, 0, 0]), float)
            pts = []
            for c in b.get('cubes', []):
                o = np.array(c['origin'], float)
                s = np.array(c['size'], float)
                inf = c.get('inflate', 0)
                corners = [o - inf + (s + 2 * inf) * np.array([i, j, k]) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
                if c.get('rotation'):
                    cp = np.array(c.get('pivot', [0, 0, 0]), float)
                    cr = rot(c['rotation'])
                    corners = [cp + cr @ (q - cp) for q in corners]
                pts += [q - piv for q in corners]
            cache[bone] = np.array(pts, float).reshape(-1, 3)
        return cache[bone]

    def cube_corners(self, W, bone):
        """World corners of every cube of a bone (cube-level rotations included), shape (n, 3)."""
        R, O = W[bone]
        return O + self._local_corners(bone) @ R.T

    def descendants(self, bone):
        kids = [n for n, b in self.bones.items() if b.get('parent') == bone]
        out = [bone]
        for k in kids:
            out += self.descendants(k)
        return out

    def lowest(self, W, bones):
        ys = [self.cube_corners(W, b)[:, 1].min() for b in bones if len(self._local_corners(b))]
        return float(min(ys)) if ys else 0.0

    def highest(self, W, bones):
        ys = [self.cube_corners(W, b)[:, 1].max() for b in bones if len(self._local_corners(b))]
        return float(max(ys)) if ys else 0.0
