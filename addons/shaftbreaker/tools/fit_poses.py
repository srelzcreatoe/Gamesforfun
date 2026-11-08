import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from optpose import *

TORSO = ['body', 'waist', 'chest', 'neck', 'head', 'jaw', 'mane_front', 'mane_back', 'mane_left', 'mane_right']
FEET = ['foot_right', 'foot_left']
FWD = np.array([0, 0, -1.0])


def miny(wp, bones):
    return min(wp[b][:, 1].min() for b in bones if b in wp)


def common(p):
    wp = rig.world_points(p)
    mats = rig.world_mats(p)
    H = max(v[:, 1].max() for v in wp.values())
    return wp, mats, H


def obj_crawl(p):
    wp, mats, H = common(p)
    f = 12 * max(0, H - 25) ** 2
    f += 6 * (miny(wp, HAND_R) ** 2 + miny(wp, HAND_L) ** 2)
    f += 6 * (miny(wp, FEET[:1]) ** 2 + miny(wp, FEET[1:]) ** 2)
    f += 4 * max(0, 3 - miny(wp, TORSO)) ** 2
    up = bone_axis(mats, 'chest', (0, 1, 0))
    f += 120 * (1 - float(up @ np.array([0, 0.15, -0.99])))
    hf = bone_axis(mats, 'head', (0, 0, -1))
    f += 300 * (1 - float(hf @ np.array([0, 0.1, -0.995])))
    sh = mats['arm_right_upper'][0][:3, 3]; hp = mats['leg_right_upper'][0][:3, 3]
    hz = wp['hand_right'][:, 2].mean(); fz = wp['foot_right'][:, 2].mean()
    f += 2 * max(0, hz - (sh[2] - 6)) ** 2 + 2 * max(0, (hp[2] + 4) - fz) ** 2
    f += 1 * max(0, abs(wp['hand_right'][:, 0].mean()) - 28) ** 2 + 1 * max(0, abs(wp['foot_right'][:, 0].mean()) - 24) ** 2
    return f


def obj_crouch(p):
    wp, mats, H = common(p)
    f = 12 * max(0, H - 52) ** 2
    hipy = mats['leg_right_upper'][0][1, 3]
    f += 3 * max(0, 24 - hipy) ** 2
    f += 0.05 * max(0, p.get('leg_right_lower', {}).get('r', [0])[0] - 115) ** 2
    f += 8 * (miny(wp, FEET[:1]) ** 2 + miny(wp, FEET[1:]) ** 2)
    for fb in FEET:
        d = bone_axis(mats, fb, (0, -1, 0))
        f += 60 * (1 - float(d @ np.array([0, -1, 0])))
    hmin = min(miny(wp, HAND_R), miny(wp, HAND_L))
    f += 4 * max(0, 2 - hmin) ** 2 + 2 * max(0, hmin - 9) ** 2
    up = bone_axis(mats, 'chest', (0, 1, 0))
    f += 80 * (1 - float(up @ np.array([0, 0.62, -0.78])))
    hf = bone_axis(mats, 'head', (0, 0, -1))
    f += 300 * (1 - float(hf @ np.array([0, 0.05, -0.998])))
    # balance: torso centre over feet
    tz = np.vstack([wp[b] for b in ['chest', 'waist']])[:, 2].mean()
    fz = np.vstack([wp[b] for b in FEET])[:, 2].mean()
    f += 1.5 * max(0, abs(tz - fz) - 5) ** 2
    f += 3 * max(0, 4 - miny(wp, ['leg_right_lower', 'leg_left_lower'])) ** 2
    sh = mats['arm_right_upper'][0][:3, 3]
    f += 2 * max(0, wp['hand_right'][:, 2].mean() - (sh[2] - 8)) ** 2
    return f


def obj_prone(p):
    wp, mats, H = common(p)
    f = 12 * max(0, H - 21) ** 2
    up = bone_axis(mats, 'chest', (0, 1, 0))
    f += 100 * (1 - float(up @ np.array([0, 0.1, -0.995])))
    hf = bone_axis(mats, 'head', (0, 0, -1))
    f += 300 * (1 - float(hf @ np.array([0, 0.2, -0.98])))
    sh = mats['arm_right_upper'][0][:3, 3]
    hz = wp['hand_right'][:, 2].mean()
    f += 2 * max(0, hz - (sh[2] - 10)) ** 2
    f += 4 * (miny(wp, HAND_R) ** 2)
    f += 1 * max(0, abs(wp['hand_right'][:, 0].mean()) - 26) ** 2
    return f


SPEC_CRAWL = [
    ('body', 'r', 0, 40, 100, 85), ('waist', 'r', 0, -20, 30, 0), ('chest', 'r', 0, -20, 30, 0),
    ('neck', 'r', 0, -110, 10, -60), ('head', 'r', 0, -60, 30, -20),
    ('arm_right_upper', 'r', 0, -180, 60, -40), ('arm_right_upper', 'r', 1, -60, 60, 0), ('arm_right_upper', 'r', 2, 0, 110, 50),
    ('arm_right_lower', 'r', 0, -150, 0, -60), ('hand_right', 'r', 0, -60, 100, 30),
    ('leg_right_upper', 'r', 0, -140, 20, -50), ('leg_right_upper', 'r', 1, -40, 40, 0), ('leg_right_upper', 'r', 2, 0, 80, 20),
    ('leg_right_lower', 'r', 0, 0, 150, 60), ('foot_right', 'r', 0, -90, 100, 0),
]
SPEC_CROUCH = [
    ('body', 'r', 0, -10, 60, 10), ('waist', 'r', 0, -10, 45, 20), ('chest', 'r', 0, -10, 45, 20),
    ('neck', 'r', 0, -90, 20, -40), ('head', 'r', 0, -60, 30, -20),
    ('arm_right_upper', 'r', 0, -120, -10, -40), ('arm_right_upper', 'r', 2, 0, 60, 20),
    ('arm_right_lower', 'r', 0, -120, 0, -40), ('hand_right', 'r', 0, -40, 80, 20),
    ('leg_right_upper', 'r', 0, -140, 10, -70), ('leg_right_upper', 'r', 2, 0, 40, 8),
    ('leg_right_lower', 'r', 0, 0, 150, 90), ('foot_right', 'r', 0, -90, 60, -30),
]
SPEC_PRONE = [
    ('body', 'r', 0, 60, 100, 88), ('waist', 'r', 0, -20, 20, 0), ('chest', 'r', 0, -30, 20, 0),
    ('neck', 'r', 0, -110, 10, -70), ('head', 'r', 0, -60, 30, -20),
    ('arm_right_upper', 'r', 0, -180, 40, -120), ('arm_right_upper', 'r', 2, 0, 90, 30),
    ('arm_right_lower', 'r', 0, -150, 0, -20), ('hand_right', 'r', 0, -60, 100, 20),
    ('leg_right_upper', 'r', 0, -60, 40, 0), ('leg_right_upper', 'r', 2, 0, 40, 10),
    ('leg_right_lower', 'r', 0, 0, 120, 10), ('foot_right', 'r', 0, -90, 100, 40),
]

import sys as _s
WHICH = _s.argv[1].split(',') if len(_s.argv) > 1 else ['crawl', 'crouch', 'prone']
try:
    out = json.load(open(os.path.join(S, 'src_assets/model/fitted_poses.json')))
except Exception:
    out = {}
for name, spec, obj, it in [(n, sp, ob, i) for n, sp, ob, i in [('crawl', SPEC_CRAWL, obj_crawl, 3500), ('crouch', SPEC_CROUCH, obj_crouch, 3500), ('prone', SPEC_PRONE, obj_prone, 2500)] if n in WHICH]:
    best = None
    for seed in (1, 2, 3):
        p, f, x = optimize(spec, obj, iters=it, seed=seed)
        if best is None or f < best[1]:
            best = (p, f, x)
    p, f, x = best
    mn, mx = rig.extent(p)
    print(name, 'score', round(f, 2), 'H', round(mx[1], 1), 'blocks', round(mx[1] * 0.58 / 16, 2))
    print('   ', [(s[0], s[2], round(v, 1)) for s, v in zip(spec, x)])
    out[name] = p
json.dump(out, open(os.path.join(S, 'src_assets/model/fitted_poses.json'), 'w'))


# ---------------- asymmetric poses (sym=False)
def obj_listen(p):
    wp, mats, H = common(p)
    f = 0
    f += 10 * max(0, miny(wp, ['head']) - 3) ** 2                       # head near the stone
    side = bone_axis(mats, 'head', (0, 1, 0))
    f += 120 * (1 - abs(float(side @ np.array([1.0, 0, 0]))))           # head rolled onto its side
    f += 8 * miny(wp, ['leg_right_lower']) ** 2                         # right knee down
    f += 8 * miny(wp, ['foot_left']) ** 2                               # left foot planted
    d = bone_axis(mats, 'foot_left', (0, -1, 0)); f += 40 * (1 - float(d @ np.array([0, -1, 0])))
    f += 6 * miny(wp, HAND_R) ** 2 + 3 * miny(wp, HAND_L) ** 2
    hx = wp['head'][:, 2].mean(); hip = mats['leg_right_upper'][0][:3, 3]
    f += 1.5 * max(0, hx - (hip[2] - 14)) ** 2                          # head forward of hips
    return f


def obj_kneel(p):
    wp, mats, H = common(p)
    f = 8 * (miny(wp, ['leg_right_lower']) ** 2 + miny(wp, ['leg_left_lower']) ** 2)
    f += 6 * (miny(wp, HAND_R) ** 2 + miny(wp, HAND_L) ** 2)
    up = bone_axis(mats, 'chest', (0, 1, 0)); f += 80 * (1 - float(up @ np.array([0, 0.75, -0.66])))
    hf = bone_axis(mats, 'head', (0, 0, -1)); f += 100 * (1 - float(hf @ np.array([0, -0.45, -0.89])))
    f += 4 * max(0, 3 - miny(wp, TORSO)) ** 2
    sh = mats['arm_right_upper'][0][:3, 3]; f += 2 * max(0, wp['hand_right'][:, 2].mean() - (sh[2] - 6)) ** 2
    return f


def obj_fallen(p):
    wp, mats, H = common(p)
    f = 12 * max(0, H - 20) ** 2
    up = bone_axis(mats, 'chest', (0, 1, 0)); f += 100 * (1 - float(up @ np.array([0, 0, -1.0])))
    side = bone_axis(mats, 'head', (0, 1, 0)); f += 80 * (1 - abs(float(side @ np.array([1.0, 0, 0]))))
    f += 2 * miny(wp, ['head']) ** 2
    return f


SPEC_LISTEN = [('body', 'r', 0, 0, 90, 40), ('waist', 'r', 0, -10, 40, 10), ('chest', 'r', 0, -10, 40, 10), ('chest', 'r', 2, -30, 30, 0),
               ('neck', 'r', 0, -60, 40, 0), ('neck', 'r', 2, -40, 40, 10), ('head', 'r', 0, -40, 40, 0), ('head', 'r', 2, -90, 90, 60),
               ('arm_right_upper', 'r', 0, -150, 20, -60), ('arm_right_upper', 'r', 2, -20, 60, 10), ('arm_right_lower', 'r', 0, -120, 0, -20),
               ('arm_left_upper', 'r', 0, -150, 20, -40), ('arm_left_upper', 'r', 2, -60, 20, -10), ('arm_left_lower', 'r', 0, -120, 0, -30),
               ('leg_right_upper', 'r', 0, -150, 30, -40), ('leg_right_lower', 'r', 0, 0, 150, 100), ('foot_right', 'r', 0, -60, 90, 30),
               ('leg_left_upper', 'r', 0, -150, 30, -90), ('leg_left_lower', 'r', 0, 0, 150, 90), ('foot_left', 'r', 0, -90, 60, 0)]
SPEC_KNEEL = [('body', 'r', 0, -30, 60, 0), ('waist', 'r', 0, -10, 40, 15), ('chest', 'r', 0, -10, 40, 15),
              ('neck', 'r', 0, -60, 40, 0), ('head', 'r', 0, -40, 50, 10),
              ('arm_right_upper', 'r', 0, -120, 20, -40), ('arm_right_upper', 'r', 2, 0, 50, 10), ('arm_right_lower', 'r', 0, -120, 0, -20),
              ('leg_right_upper', 'r', 0, -90, 40, -10), ('leg_right_upper', 'r', 2, 0, 30, 5), ('leg_right_lower', 'r', 0, 0, 160, 120), ('foot_right', 'r', 0, -40, 90, 30)]
SPEC_FALLEN = [('body', 'r', 0, 50, 100, 85), ('chest', 'r', 0, -20, 20, 0), ('chest', 'r', 2, -20, 20, 5), ('neck', 'r', 0, -60, 30, -10),
               ('head', 'r', 2, -90, 90, 60), ('head', 'r', 1, -40, 40, 10),
               ('arm_right_upper', 'r', 0, -180, 30, -150), ('arm_right_upper', 'r', 2, -10, 80, 30), ('arm_right_lower', 'r', 0, -90, 0, -10),
               ('arm_left_upper', 'r', 0, -60, 60, 10), ('arm_left_upper', 'r', 2, -80, 10, -20),
               ('leg_right_upper', 'r', 0, -40, 30, 0), ('leg_right_upper', 'r', 2, 0, 30, 10), ('leg_right_lower', 'r', 0, 0, 90, 20),
               ('leg_left_upper', 'r', 0, -40, 30, -10), ('leg_left_upper', 'r', 2, -30, 0, -10), ('leg_left_lower', 'r', 0, 0, 90, 50)]
for name, spec, obj, sym in [('listen', SPEC_LISTEN, obj_listen, False), ('kneel', SPEC_KNEEL, obj_kneel, True), ('fallen', SPEC_FALLEN, obj_fallen, False)]:
    if name not in WHICH:
        continue
    best = None
    for seed in (1, 2):
        p, f, x = optimize(spec, obj, iters=3000, seed=seed, sym=sym)
        if best is None or f < best[1]:
            best = (p, f, x)
    p, f, x = best
    mn, mx = rig.extent(p)
    print(name, 'score', round(f, 2), 'H', round(mx[1], 1))
    out[name] = p
json.dump(out, open(os.path.join(S, 'src_assets/model/fitted_poses.json'), 'w'))
