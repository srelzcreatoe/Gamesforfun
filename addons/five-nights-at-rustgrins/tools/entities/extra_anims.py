# Authors the extra animations the night needs on top of the supplied set:
#   crawl   (Purple Rat in the ducts: on knees and forearms, a slow diagonal crawl; fitted to each
#            skeleton so knees, forearms and hands rest on the floor and nothing sinks through it, and
#            low enough for the 2-block ducts at the 1.25 render scale)
#   peek    (the Cat leaning out between the Cabaret curtains)
#   look    (additive head turn driven by variables, for "staring at the camera")
#   slump   alias handled by pose_2 in the controller
# Output: dict of animation name -> bedrock animation JSON (used by build_entities.py).
import math

# props held in a hand / strapped on: hidden while the hands are busy (crawling, holding the curtain)
PROPS = ('right_maraca', 'left_maraca', 'right_cane', 'microphone', 'guitar')


def cyc(times, values):
    return {f"{t:.2f}": v for t, v in zip(times, values)}


def _r(v):
    return [round(x, 2) for x in v]


# ------------------------------------------------------------------ crawl
CRAWL_LENGTH = 1.2
CRAWL_MAX_HEIGHT = 19.0   # model px; x1.25 render scale = 1.48 blocks, inside the 2-block ducts
FLOOR_GAP = 0.15          # px between the resting knees / forearms and the floor


def _crawl_pose(skel, t, P):
    """Bone rotations/positions of the crawl at time t (P: solved parameters)."""
    L, hip_y, head_pitch, dz = P['lean'], P['hip_y'], P['head_pitch'], P['dz']
    p = 2 * math.pi * t / CRAWL_LENGTH
    leg_sw, arm_sw = 11.0, 13.0
    # diagonal gait: right arm with the left leg
    th = {'right': leg_sw * math.sin(p), 'left': leg_sw * math.sin(p + math.pi)}
    ph = {'right': arm_sw * math.sin(p + math.pi), 'left': arm_sw * math.sin(p)}
    # lift: the limb swinging forward is raised a little, the one pushing back stays down
    lift_leg = {s: max(0.0, math.cos(p if s == 'right' else p + math.pi)) * 6.0 for s in ('right', 'left')}
    lift_arm = {s: max(0.0, math.cos(p + math.pi if s == 'right' else p)) * 12.0 for s in ('right', 'left')}
    sway = 3.0 * math.sin(p)
    bob = 0.25 * math.sin(2 * p)
    pose = {
        'waist': {'rotation': [L, sway, 0.0], 'position': [0.0, hip_y - skel.bones['waist']['pivot'][1] + bob, dz]},
        'torso': {'rotation': [P['torso'], -sway * 0.6, 0.0]},
        'head': {'rotation': [-(L + P['torso']) + head_pitch + 3.0 * math.sin(2 * p), sway * 1.5, 0.0]},
    }
    for s in ('right', 'left'):
        # thigh hangs straight down in the world (minus the forward swing), shin rises behind the knee
        pose[f'{s}_leg'] = {'rotation': [-L - th[s] - lift_leg[s], 0.0, 0.0]}
        pose[f'{s}_shin'] = {'rotation': [90.0 + P['shin_rise'] + th[s] + lift_leg[s] * 2.0, 0.0, 0.0]}
        pose[f'{s}_foot'] = {'rotation': [55.0, 0.0, 0.0]}
        # upper arm straight down from the shoulder, forearm flat forward on the floor, paw ahead of it
        pose[f'{s}_arm'] = {'rotation': [-(L + P['torso']) - ph[s] - lift_arm[s], 0.0, 0.0]}
        # (while the paw is lifted the forearm tips up a little: world pitch -90 - 0.8 * lift)
        pose[f'{s}_forearm'] = {'rotation': [-90.0 + ph[s] + lift_arm[s] * 0.2, 0.0, 0.0]}
        pose[f'{s}_hand'] = {'rotation': [P['hand'], 0.0, 0.0]}
    if 'tail_1' in skel.bones:
        pose['tail_1'] = {'rotation': [P['tail'], 4.0 * math.sin(p), 0.0]}
    return pose


def _limb_bones(skel, side, part):
    roots = {'leg': f'{side}_leg', 'arm': f'{side}_arm'}
    return [b for b in skel.descendants(roots[part]) if b not in PROPS]


def solve_crawl(skel):
    """Hip height, torso pitch and head pitch so that, at rest in the cycle (t where both limbs of a
    pair are vertical), the knees and the forearms touch the floor and the body stays under the
    height limit. Returns the parameter dict for _crawl_pose."""
    P = {'lean': 85.0, 'hip_y': 8.0, 'head_pitch': 30.0, 'dz': 0.0, 'torso': 0.0, 'shin_rise': 18.0, 'hand': 0.0, 'tail': -50.0}
    legs = _limb_bones(skel, 'right', 'leg') + _limb_bones(skel, 'left', 'leg')
    arms = _limb_bones(skel, 'right', 'arm') + _limb_bones(skel, 'left', 'arm')
    body = [b for b in skel.bones if b not in PROPS]

    def world(t=0.0):
        pose = _crawl_pose(skel, t, P)
        return skel.world(pose)

    def lowest(bones, ts=(0.0, 0.3, 0.6, 0.9)):
        return min(skel.lowest(world(t), bones) for t in ts)

    for _ in range(6):
        # 1. hips: knees on the floor
        P['hip_y'] += FLOOR_GAP - lowest(legs)
        # 2. torso pitch: forearms on the floor (bisection on the lean)
        lo, hi = 55.0, 110.0
        for _ in range(30):
            P['lean'] = (lo + hi) / 2
            if lowest(arms) > FLOOR_GAP:
                lo = P['lean']   # arms in the air: pitch the chest further down
            else:
                hi = P['lean']
    # 3. head: look ahead and a little down, lowered further until the body fits under the limit
    P['head_pitch'] = 25.0
    while skel.highest(world(), body) > CRAWL_MAX_HEIGHT and P['head_pitch'] < 80:
        P['head_pitch'] += 2.5
    # 4. tail: trailing low behind, raised (tail_1 pitch up) just enough to clear the floor
    tail = [b for b in skel.bones if b.startswith('tail')]
    P['tail'] = -90.0
    if tail:
        while lowest(tail) < FLOOR_GAP + 0.5 and P['tail'] < 40:
            P['tail'] += 4.0
    # 5. centre the body over the entity's feet (it is long when crawling)
    W0 = world()
    zs = [z for b in body for z in skel.cube_corners(W0, b)[:, 2]]
    P['dz'] = round(-(float(min(zs)) + float(max(zs))) / 2, 2)
    return P


def crawl_anim(cid=None, skel=None):
    T = [round(k * 0.1, 2) for k in range(int(round(CRAWL_LENGTH / 0.1)) + 1)]
    bones = {}
    P = solve_crawl(skel)
    for t in T:
        for b, ch in _crawl_pose(skel, t, P).items():
            for c, v in ch.items():
                bones.setdefault(b, {}).setdefault(c, {})[f'{t:.2f}'] = _r(v)
    for b in PROPS:
        if b in skel.bones:
            bones[b] = {'scale': 0}
    return {'loop': True, 'animation_length': CRAWL_LENGTH, 'bones': bones}


# ------------------------------------------------------------------ peek
def peek_anim(cid=None, skel=None):
    """Leaning out sideways, the right paw holding the curtain edge. The head turns out with the body
    but no longer rolls towards the raised shoulder, and the arm is a little lower and wider (the
    head used to sink ~2 px into the shoulder)."""
    T = [0, 1.0, 2.0, 3.0, 4.0]
    bones = {
        "waist": {"rotation": cyc(T, [[0, -25, -6], [0, -28, -7], [0, -25, -6], [0, -22, -5], [0, -25, -6]])},
        "torso": {"rotation": cyc(T, [[6, -10, -10], [6, -12, -12], [6, -10, -10], [6, -8, -9], [6, -10, -10]])},
        "head": {"rotation": cyc(T, [[4, 25, 4], [2, 30, 2], [4, 25, 4], [6, 18, 6], [4, 25, 4]])},
        "right_arm": {"rotation": cyc(T, [[-58, 0, 42], [-60, 0, 42], [-58, 0, 42], [-56, 0, 42], [-58, 0, 42]])},
        "right_forearm": {"rotation": cyc(T, [[-34, 0, 0]] * 5)},
        "right_hand": {"rotation": cyc(T, [[0, 0, 0]] * 5)},
    }
    if skel is not None:
        for b in PROPS:
            if b in skel.bones:
                bones[b] = {"scale": 0}
    return {"loop": True, "animation_length": 4.0, "bones": bones}


def look_anim():
    # additive head turn; the client smooths the property values into variables
    return {
        "loop": True,
        "bones": {
            "head": {"rotation": ["-variable.fnar_lp", "variable.fnar_ly", 0]},
        },
    }


EXTRA = {"crawl": crawl_anim, "peek": peek_anim, "look": look_anim}
