"""Anatomy audit for every Brinesleeper animation.

Flags the things that read as 'broken' on screen:
  * a limb's centreline passing through the torso, neck, head, or another limb
  * elbows / knees bending the wrong way, or the elbow pointing into the body
  * wrists folded or twisted too far, fingers bent backwards
  * spine twists and neck kinks beyond a plausible range
Usage: python3 audit.py [anim names...]
"""
import math
import sys
from collections import defaultdict

import numpy as np

import anim
from anim import fk, ANIMS, REST, PIV, RIG, SIDES, FINGERS

CUBES = {c.name: c for c in RIG.all_cubes()}
BODY = ['pelvis', 'waist', 'ribs_low', 'ribs_mid', 'ribs_top', 'neck_lower', 'neck_mid', 'neck_upper', 'cranium', 'jaw']
LEGS = {s: [f'{s}_thigh', f'{s}_shin', f'{s}_knee', f'{s}_foot'] for s, _ in SIDES}
ARMS = {s: [f'{s}_upperarm', f'{s}_forearm', f'{s}_elbow', f'{s}_palm'] for s, _ in SIDES}


def inside(W, cube, p, margin=0.5):
    R, tr = W[cube.bone.name]
    q = R.T @ (p - tr)
    return bool(np.all(q > cube.lo + margin) and np.all(q < cube.hi - margin))


def seg_points(a, b, skip=0.0, step=1.0):
    d = b - a
    L = np.linalg.norm(d)
    n = max(2, int(L / step))
    return [a + d * (i / n) for i in range(n + 1) if (i / n) * L >= skip]


def tip_of(W, bone):
    """world position of the far end of a hanging bone's first cube"""
    c = RIG.by_name[bone].cubes[0]
    p = np.array([(c.lo[0] + c.hi[0]) / 2, c.lo[1], (c.lo[2] + c.hi[2]) / 2])
    R, tr = W[bone]
    return R @ p + tr


def local_total(pose, bone):
    return REST[bone] + np.asarray(pose.get(bone, {}).get('rotation', (0, 0, 0)), dtype=float)


def audit_frame(pose):
    W = fk(pose)
    wp = lambda b: W[b][0] @ PIV[b] + W[b][1]
    issues = []
    for side, s in SIDES:
        S, E, Wr = wp(f'{side}_arm'), wp(f'{side}_forearm'), wp(f'{side}_hand')
        F = tip_of(W, f'{side}_finger2_tip')
        segs = [('upper arm', S, E, 2.5), ('forearm', E, Wr, 0.0), ('hand', Wr, F, 0.0)]
        others = BODY + LEGS['right'] + LEGS['left'] + ARMS['left' if side == 'right' else 'right']
        for name, a, b, skip in segs:
            for p in seg_points(a, b, skip):
                hit = next((cn for cn in others if inside(W, CUBES[cn], p)), None)
                if hit:
                    issues.append(f'{side} {name} inside {hit}')
                    break
        # elbow hinge: must flex forward, never hyper-extend or swing sideways
        fx = local_total(pose, f'{side}_forearm')
        if fx[0] > 8:
            issues.append(f'{side} elbow hyper-extended ({fx[0]:.0f})')
        if abs(fx[1]) > 12 or abs(fx[2]) > 12:
            issues.append(f'{side} elbow twisted ({fx[1]:.0f},{fx[2]:.0f})')
        # elbow pointing into the torso (measured in the chest frame)
        Rc = W['chest'][0]
        mid = S + np.dot(E - S, nrm(Wr - S)) * nrm(Wr - S)
        e = Rc.T @ (E - mid)
        bend = 180 - math.degrees(math.acos(max(-1, min(1, float(np.dot(nrm(S - E), nrm(Wr - E)))))))
        if bend > 35 and np.linalg.norm(e) > 1e-3 and (e[0] * s) / np.linalg.norm(e) < -0.55:
            issues.append(f'{side} elbow points into body')
        # wrist
        hx = local_total(pose, f'{side}_hand')
        if hx[0] < -80 or hx[0] > 85 or abs(hx[2]) > 50:
            issues.append(f'{side} wrist extreme ({hx[0]:.0f},{hx[2]:.0f})')
        # fingers
        for f in FINGERS:
            a1, a2 = local_total(pose, f'{side}_{f}'), local_total(pose, f'{side}_{f}_tip')
            if a1[0] < -30 or a2[0] < -20 or a1[0] > 115 or a2[0] > 120 or abs(a1[2]) > (65 if f == 'thumb' else 40):
                issues.append(f'{side} finger bent wrong ({f}: {a1[0]:.0f}/{a2[0]:.0f})')
                break
        # knees
        sx = local_total(pose, f'{side}_shin')
        if sx[0] < -5:
            issues.append(f'{side} knee hyper-extended ({sx[0]:.0f})')
        if abs(sx[1]) > 12 or abs(sx[2]) > 12:
            issues.append(f'{side} knee twisted')
        H, K, A = wp(f'{side}_leg'), wp(f'{side}_shin'), wp(f'{side}_foot')
        other = 'left' if side == 'right' else 'right'
        for name, a, b, skip in (('thigh', H, K, 3.0), ('shin', K, A, 0.0)):
            for p in seg_points(a, b, skip):
                hit = next((cn for cn in BODY[:5] + LEGS[other] if inside(W, CUBES[cn], p)), None)
                if hit:
                    issues.append(f'{side} {name} inside {hit}')
                    break
        # knee pointing backwards (in the body frame)
        Rb = W['body'][0]
        midk = H + np.dot(K - H, nrm(A - H)) * nrm(A - H)
        k = Rb.T @ (K - midk)
        kb = 180 - math.degrees(math.acos(max(-1, min(1, float(np.dot(nrm(H - K), nrm(A - K)))))))
        if kb > 30 and np.linalg.norm(k) > 1e-3 and k[2] / np.linalg.norm(k) > 0.6:
            issues.append(f'{side} knee points backwards')
    for b in ('pelvis', 'waist', 'chest'):
        r = local_total(pose, b) - REST[b]
        if abs(r[1]) > 26:
            issues.append(f'{b} twisted ({r[1]:.0f})')
    for b in ('neck_lower', 'neck_mid', 'neck_upper'):
        r = local_total(pose, b)
        if np.linalg.norm(r) > 62:
            issues.append(f'{b} kinked ({np.linalg.norm(r):.0f})')
    return issues


def nrm(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def audit(name, hz=20):
    fn, L, loop = ANIMS[name]
    n = max(2, int(L * hz))
    counts = defaultdict(int)
    first = {}
    for i in range(n + 1):
        t = L * i / n
        for iss in audit_frame(fn(t)):
            key = iss.split(' (')[0]
            counts[key] += 1
            first.setdefault(key, (t, iss))
    return n + 1, counts, first


if __name__ == '__main__':
    names = sys.argv[1:] or list(ANIMS)
    total_bad = 0
    for nm in names:
        n, counts, first = audit(nm)
        if not counts:
            print(f'{nm:18s} ok')
            continue
        total_bad += 1
        print(f'{nm:18s} ' + '; '.join(f'{k} {100 * c // n}% (t={first[k][0]:.2f} {first[k][1].split(" (")[1][:-1] if " (" in first[k][1] else ""})'
                                       for k, c in sorted(counts.items(), key=lambda kv: -kv[1])))
    print('animations with issues:', total_bad, '/', len(names))
