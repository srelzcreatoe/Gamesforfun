"""Pose/animation authoring kit for the Shaftbreaker rig (Bedrock conventions).

Pose = {bone: {"r": [x, y, z], "p": [x, y, z]}}  (degrees / model pixels, Bedrock animation space)
"""
import json, math, copy
import numpy as np

D2R = math.pi / 180.0


def _rx(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]], float)


def _ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]], float)


def _rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], float)


def _t(x, y, z):
    m = np.eye(4); m[:3, 3] = [x, y, z]; return m


def euler_zyx(x, y, z):  # three.js 'ZYX' order -> Rz*Ry*Rx
    return _rz(z) @ _ry(y) @ _rx(x)


class Rig:
    def __init__(self, geo_path):
        g = json.load(open(geo_path))['minecraft:geometry'][0]
        self.bones = g['bones']
        self.byname = {b['name']: b for b in self.bones}
        self.order = [b['name'] for b in self.bones]
        self.children = {}
        for b in self.bones:
            self.children.setdefault(b.get('parent'), []).append(b['name'])
        # cube corner points per bone in BB space (x flipped), relative to world
        self.pts = {}
        for b in self.bones:
            arr = []
            for c in b.get('cubes', []):
                x1 = -(c['origin'][0] + c['size'][0]); x2 = -c['origin'][0]
                y1 = c['origin'][1]; y2 = y1 + c['size'][1]
                z1 = c['origin'][2]; z2 = z1 + c['size'][2]
                corners = [(x, y, z) for x in (x1, x2) for y in (y1, y2) for z in (z1, z2)]
                if c.get('rotation'):
                    cp = c.get('pivot', [0, 0, 0]); r = c['rotation']
                    m = _t(-cp[0], cp[1], cp[2]) @ euler_zyx(-r[0] * D2R, -r[1] * D2R, r[2] * D2R) @ _t(cp[0], -cp[1], -cp[2])
                    corners = [tuple((m @ np.array([*p, 1.0]))[:3]) for p in corners]
                arr.extend(corners)
            self.pts[b['name']] = np.array(arr, float).reshape(-1, 3) if arr else np.zeros((0, 3))

    def world_mats(self, pose):
        mats = {}
        def rec(name, parent_m):
            b = self.byname[name]
            p = b.get('pivot', [0, 0, 0]); pp = self.byname[b['parent']].get('pivot', [0, 0, 0]) if b.get('parent') else [0, 0, 0]
            a = pose.get(name, {})
            ar = a.get('r', [0, 0, 0]); ap = a.get('p', [0, 0, 0])
            rr = b.get('rotation', [0, 0, 0])
            local = _t(-p[0] + pp[0] - ap[0], p[1] - pp[1] + ap[1], p[2] - pp[2] + ap[2]) @ \
                euler_zyx((-rr[0] - ar[0]) * D2R, (-rr[1] - ar[1]) * D2R, (rr[2] + ar[2]) * D2R)
            m = parent_m @ local
            mats[name] = (m, p)
            for c in self.children.get(name, []):
                rec(c, m)
        for r in self.children.get(None, []):
            rec(r, np.eye(4))
        return mats

    def world_points(self, pose, bones=None):
        mats = self.world_mats(pose)
        out = {}
        for name, (m, p) in mats.items():
            if bones is not None and name not in bones:
                continue
            P = self.pts[name]
            if not len(P):
                continue
            loc = P - np.array([-p[0], p[1], p[2]])
            h = np.c_[loc, np.ones(len(loc))]
            out[name] = (m @ h.T).T[:, :3]
        return out

    def extent(self, pose, bones=None):
        wp = self.world_points(pose, bones)
        allp = np.vstack(list(wp.values()))
        return allp.min(axis=0), allp.max(axis=0)

    def ground(self, pose, contacts=('foot_right', 'foot_left'), target=0.0):
        """Shift root Y so lowest point of contact bones sits at target."""
        pose = copy.deepcopy(pose)
        pose.setdefault('root', {}).setdefault('p', [0, 0, 0])
        mn, _ = self.extent(pose, set(contacts))
        pose['root']['p'] = list(pose['root']['p'])
        pose['root']['p'][1] += target - mn[1]
        return pose


LEFT_RIGHT = [('right', 'left')]


def mirror_name(n):
    if 'right' in n:
        return n.replace('right', 'left')
    if 'left' in n:
        return n.replace('left', 'right')
    return n


def mirror(pose):
    out = {}
    for b, v in pose.items():
        r = v.get('r', [0, 0, 0]); p = v.get('p', [0, 0, 0])
        out[mirror_name(b)] = {'r': [r[0], -r[1], -r[2]], 'p': [-p[0], p[1], p[2]]}
    return out


def merge(*poses):
    """Add rotations/positions of several poses."""
    out = {}
    for ps in poses:
        for b, v in ps.items():
            o = out.setdefault(b, {'r': [0, 0, 0], 'p': [0, 0, 0]})
            for k in ('r', 'p'):
                if k in v:
                    o[k] = [o[k][i] + v[k][i] for i in range(3)]
    return out


def blend(a, b, t):
    out = {}
    for bn in set(a) | set(b):
        va = a.get(bn, {}); vb = b.get(bn, {})
        o = {}
        for k in ('r', 'p'):
            xa = va.get(k, [0, 0, 0]); xb = vb.get(k, [0, 0, 0])
            o[k] = [xa[i] + (xb[i] - xa[i]) * t for i in range(3)]
        out[bn] = o
    return out


def scale_pose(a, s):
    return {b: {k: [x * s for x in v[k]] for k in v} for b, v in a.items()}


def from_anim(anim_json, name, t=0.0):
    """Sample a provided animation (numeric keys only) into a Pose."""
    an = anim_json['animations'][name]['bones']
    pose = {}
    for b, ch in an.items():
        o = {}
        for chan, key in (('rotation', 'r'), ('position', 'p')):
            if chan not in ch:
                continue
            v = ch[chan]
            if isinstance(v, dict):
                ks = sorted(v.keys(), key=float)
                best = ks[0]
                for k in ks:
                    if float(k) <= t:
                        best = k
                v = v[best]
                if isinstance(v, dict):
                    v = v.get('post') or v.get('pre')
            if isinstance(v, list) and all(isinstance(x, (int, float)) for x in v):
                o[key] = list(v)
        if o:
            pose[b] = o
    return pose


def r3(v):
    return [round(float(x), 3) for x in v]


def build_anim(keys, length, loop=True, lerp='catmullrom', extra=None, bones=None, anim_time_update=None):
    """keys: list of (time, pose). Returns Bedrock animation dict."""
    allb = set()
    for _, p in keys:
        allb |= set(p.keys())
    if bones:
        allb &= set(bones)
    out_bones = {}
    for b in sorted(allb):
        rot = {}; pos = {}
        has_p = any('p' in p.get(b, {}) and any(abs(x) > 1e-6 for x in p[b]['p']) for _, p in keys)
        has_r = any('r' in p.get(b, {}) and any(abs(x) > 1e-6 for x in p[b]['r']) for _, p in keys)
        for t, p in keys:
            v = p.get(b, {})
            ts = f"{round(t, 4)}"
            if has_r:
                val = r3(v.get('r', [0, 0, 0]))
                rot[ts] = {'post': val, 'lerp_mode': 'catmullrom'} if lerp == 'catmullrom' else val
            if has_p:
                val = r3(v.get('p', [0, 0, 0]))
                pos[ts] = {'post': val, 'lerp_mode': 'catmullrom'} if lerp == 'catmullrom' else val
        ch = {}
        if has_r:
            ch['rotation'] = rot
        if has_p:
            ch['position'] = pos
        if ch:
            out_bones[b] = ch
    a = {'loop': loop, 'animation_length': round(length, 4), 'bones': out_bones}
    if anim_time_update:
        a['anim_time_update'] = anim_time_update
    if extra:
        a.update(extra)
    return a


def ease(t):
    return t * t * (3 - 2 * t)
