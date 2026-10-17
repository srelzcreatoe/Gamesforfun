"""Report coplanar overlapping visible faces (z-fighting) in the rest pose."""
import sys, importlib, numpy as np
from bbgen import FACES

def world_box(m, c):
    M = m.cube_world(c)
    R = M[:3, :3]
    if not np.allclose(np.abs(R), np.round(np.abs(R)), atol=1e-6):
        return None
    pts = np.array([[x, y, z, 1] for x in (c.frm[0], c.to[0]) for y in (c.frm[1], c.to[1]) for z in (c.frm[2], c.to[2])])
    W = (M @ pts.T).T[:, :3]
    return W.min(0), W.max(0)

def check(name):
    spec = importlib.import_module(f'spec2_{name}')
    m = spec.build(); m.cull()
    boxes = [(c, world_box(m, c)) for c in m.cubes]
    boxes = [(c, b) for c, b in boxes if b is not None]
    bad = []
    axes = {'east': (0, 1), 'west': (0, 0), 'up': (1, 1), 'down': (1, 0), 'south': (2, 1), 'north': (2, 0)}
    for i in range(len(boxes)):
        ci, (lo1, hi1) = boxes[i]
        for j in range(i + 1, len(boxes)):
            cj, (lo2, hi2) = boxes[j]
            for f, (ax, side) in axes.items():
                if ci.faces[f] is None or cj.faces[f] is None:
                    continue
                p1 = hi1[ax] if side else lo1[ax]
                p2 = hi2[ax] if side else lo2[ax]
                if abs(p1 - p2) > 1e-6:
                    continue
                o = [a for a in range(3) if a != ax]
                area = 1.0
                for a in o:
                    area *= max(0.0, min(hi1[a], hi2[a]) - max(lo1[a], lo2[a]))
                if area > 1e-6:
                    # visible only if some point of the overlap is not strictly inside a third cube
                    rng = [np.linspace(max(lo1[a], lo2[a]), min(hi1[a], hi2[a]), 7)[1:-1] for a in o]
                    vis = False
                    for u in rng[0]:
                        for v in rng[1]:
                            p = np.zeros(3); p[ax] = p1; p[o[0]] = u; p[o[1]] = v
                            inside = any(np.all(p > lo3 + 1e-6) and np.all(p < hi3 - 1e-6)
                                         for ck, (lo3, hi3) in boxes if ck is not ci and ck is not cj)
                            if not inside:
                                vis = True
                    if vis:
                        bad.append((ci.name, cj.name, f, round(area, 3)))
    print(name, 'coplanar overlaps:', len(bad))
    for b in bad: print('  ', b)

for n in sys.argv[1:]:
    check(n)
