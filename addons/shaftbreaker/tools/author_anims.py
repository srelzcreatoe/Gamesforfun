"""Authors the extended Shaftbreaker animation set from code.
Outputs: out/shaftbreaker.acts.animation.json
"""
import sys, os, json, math, copy
sys.path.insert(0, os.path.dirname(__file__))
from animkit import *

S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rig = Rig(os.path.join(S, 'src_assets/model/shaftbreaker.geo.json'))
A = lambda f: json.load(open(os.path.join(S, f'src_assets/model/shaftbreaker.{f}.animation.json')))
DORM = from_anim(A('dormant'), 'animation.shaftbreaker.dormant', 0)
STALK = from_anim(A('stalking'), 'animation.shaftbreaker.stalk_idle', 0)
FIDLE = from_anim(A('frenzy'), 'animation.shaftbreaker.frenzy_idle', 0)
WATCH = from_anim(A('watching'), 'animation.shaftbreaker.watch', 0)
STALK_WALK_SRC = A('stalking')['animations']['animation.shaftbreaker.stalk_walk']

FEET = ('foot_right', 'foot_left')
HANDS = ('hand_right', 'hand_left', 'finger_right_1_b', 'finger_right_2_b', 'finger_right_3_b', 'finger_right_4_b',
         'finger_left_1_b', 'finger_left_2_b', 'finger_left_3_b', 'finger_left_4_b')
KNEES = ('leg_right_lower', 'leg_left_lower')
ALL4 = FEET + HANDS
OUT = {}
TAU = 2 * math.pi


def P(**kw):
    """P(body=(r), body_p=(p) ...) shorthand"""
    out = {}
    for k, v in kw.items():
        if k.endswith('_p'):
            out.setdefault(k[:-2], {})['p'] = list(v)
        else:
            out.setdefault(k, {})['r'] = list(v)
    return out


def fingers(side, curl_a, curl_b, spread=0.0, thumb=None):
    p = {}
    for i in range(1, 5):
        sp = (i - 2.5) * spread * (1 if side == 'right' else -1)
        p[f'finger_{side}_{i}_a'] = {'r': [curl_a, 0, sp]}
        p[f'finger_{side}_{i}_b'] = {'r': [curl_b, 0, 0]}
    t = thumb if thumb is not None else (curl_a * 0.8, curl_b * 0.8)
    p[f'thumb_{side}_a'] = {'r': [t[0], 0, -6 if side == 'right' else 6]}
    p[f'thumb_{side}_b'] = {'r': [t[1], 0, 0]}
    return p


def claws(c_a=-18, c_b=-26, spread=4):
    return merge(fingers('right', c_a, c_b, spread), fingers('left', c_a, c_b, spread))


def add(name, keys, length, loop=True, ground=None, contacts=FEET, lerp='catmullrom', extra=None, atu=None):
    ks = []
    for t, p in keys:
        if ground is not None:
            p = rig.ground(p, contacts, ground)
        ks.append((t, p))
    OUT[f'animation.shaftbreaker.{name}'] = build_anim(ks, length, loop, lerp, extra, anim_time_update=atu)


def height(p):
    return rig.extent(p)[1][1]


def cyc(n, fn, length):
    """sample a cyclic function into n keys (first==last)"""
    return [(length * i / n, fn(i / n)) for i in range(n + 1)]


# ---------------------------------------------------------------- stance: crouch (fitted, <=1.9 blocks)
FIT = json.load(open(os.path.join(S, 'src_assets/model/fitted_poses.json')))
def strip_root(p):
    p = copy.deepcopy(p); p.pop('root', None); return p
CROUCH = strip_root(FIT['crouch']); CRAWL = strip_root(FIT['crawl']); PRONE = strip_root(FIT['prone'])


def crouch_pose(ph=0.0, walk=0.0):
    s = math.sin(ph * TAU)
    lift_r = max(0.0, math.sin(ph * TAU + 0.6)) * walk
    lift_l = max(0.0, math.sin(ph * TAU + math.pi + 0.6)) * walk
    return merge(CROUCH, P(waist=(1.5 * math.sin(ph * TAU * 2) * walk, 4 * s * walk, 0), head=(0, -3 * s * walk, 0),
                           arm_right_upper=(-22 * s * walk, 0, 0), arm_left_upper=(22 * s * walk, 0, 0),
                           leg_right_upper=(16 * s * walk - 10 * lift_r, 0, 0), leg_right_lower=(14 * lift_r, 0, 0),
                           leg_left_upper=(-16 * s * walk - 10 * lift_l, 0, 0), leg_left_lower=(14 * lift_l, 0, 0)), claws(-14, -22, 3))


add('crouch_idle', cyc(8, lambda u: merge(crouch_pose(0, 0), P(chest=(1.5 * math.sin(u * TAU), 0, 0), head=(-1.2 * math.sin(u * TAU), 0, 0))), 4.0),
    4.0, ground=0)
add('crouch_walk', cyc(12, lambda u: crouch_pose(u, 1.0), 1.6), 1.6, ground=0, atu='query.modified_distance_moved')


# ---------------------------------------------------------------- stance: crawl (fitted spider crawl, ~0.9 blocks)
def crawl_pose(ph=0.0, walk=0.0):
    s = math.sin(ph * TAU); c = math.cos(ph * TAU)
    lr = max(0.0, c) * walk; ll = max(0.0, -c) * walk
    return merge(CRAWL, P(chest=(0, 5 * s * walk, 0), head=(0, -5 * s * walk, 0),
                          arm_right_upper=(0, 18 * s * walk, -14 * lr), arm_left_upper=(0, 18 * s * walk, 14 * ll),
                          leg_right_upper=(0, 12 * s * walk, 8 * ll), leg_left_upper=(0, 12 * s * walk, -8 * lr)), claws(-6, -10, 6))


add('crawl_idle', cyc(8, lambda u: merge(crawl_pose(0, 0), P(chest=(1.2 * math.sin(u * TAU), 0, 0))), 3.0), 3.0, ground=0, contacts=ALL4 + KNEES)
add('crawl_walk', cyc(12, lambda u: crawl_pose(u, 1.0), 1.8), 1.8, ground=0, contacts=ALL4 + KNEES, atu='query.modified_distance_moved')

# ---------------------------------------------------------------- peeks
peek_left = merge(STALK, P(waist=(0, 0, 18), chest=(0, -10, 22), neck=(0, 0, 10), head=(6, -14, 18),
                           arm_left_upper=(-70, -10, -40), arm_left_lower=(-60, 0, 0),
                           arm_right_upper=(20, 0, -10), leg_left_upper=(0, 0, -10)), claws(-26, -34))
add('peek_left', [(0, peek_left), (0.6, peek_left), (2.0, merge(peek_left, P(head=(0, 0, 4)))), (3.4, peek_left)], 3.4, ground=0)
add('peek_right', [(0, mirror(peek_left)), (0.6, mirror(peek_left)), (2.0, merge(mirror(peek_left), P(head=(0, 0, -4)))), (3.4, mirror(peek_left))], 3.4, ground=0)

# peek from below: deep squat rising so head clears a ledge
squat = merge(crouch_pose(0, 0), P(body=(-10, 0, 0), waist=(-8, 0, 0), leg_right_upper=(-24, 0, 0), leg_left_upper=(-24, 0, 0),
                                    leg_right_lower=(24, 0, 0), leg_left_lower=(24, 0, 0), neck=(20, 0, 0),
                                    arm_right_upper=(-60, 0, 10), arm_left_upper=(-60, 0, -10)))
rise = merge(STALK, P(neck=(10, 0, 0), head=(6, 0, 0)))
add('peek_below', [(0, squat), (1.4, squat), (3.2, rise), (4.0, merge(rise, P(head=(0, 8, 4))))], 4.0, loop='hold_on_last_frame', ground=0)

# failed concealment: half crouch, side-on, claws gripping the cover edge at head height
fh = merge(crouch_pose(0, 0), P(root=(0, 35, 0), chest=(-20, 10, 0), neck=(20, -20, 0), head=(4, -24, 10),
                                arm_right_upper=(-120, 0, 30), arm_right_lower=(-40, 0, 0), hand_right=(-10, -30, 0),
                                arm_left_upper=(-130, 0, -20), arm_left_lower=(-50, 0, 0), hand_left=(-10, 30, 0)), claws(-40, -50, 2))
add('failed_hide', cyc(6, lambda u: merge(fh, P(finger_right_2_a=(6 * math.sin(u * TAU), 0, 0), chest=(0.8 * math.sin(u * TAU), 0, 0))), 3.0), 3.0, ground=0)

# ---------------------------------------------------------------- listening (head to stone)
listen = merge(CROUCH, P(waist=(44, 0, 0), chest=(18, 0, 6), neck=(40, 0, 10), head=(14, 0, 64), jaw=(2, 0, 0),
                          arm_right_upper=(-20, 0, 10), arm_left_upper=(10, 0, -16)), claws(-4, -6, 8))
add('listen', [(0, rig.ground(CROUCH)), (1.1, listen), (2.6, merge(listen, P(head=(4, 4, 74)))), (4.0, listen)], 4.0, loop='hold_on_last_frame', ground=0, contacts=ALL4 + KNEES)

# ---------------------------------------------------------------- prone drop
prone = merge(PRONE, claws(-10, -14, 8))
add('prone_drop', [(0, {}), (0.18, merge(crouch_pose(0, 0), P(neck=(10, 0, 0)))), (0.42, prone), (0.6, merge(prone, P(head=(4, 0, 0)))), (1.6, prone)],
    1.6, loop='hold_on_last_frame', ground=0, contacts=ALL4 + KNEES)

# ---------------------------------------------------------------- frozen mid-step (N01)
freeze = merge(STALK, P(root=(0, 14, 0), chest=(0, 16, -6), head=(0, -20, 12),
                        leg_right_upper=(-40, 0, 0), leg_right_lower=(48, 0, 0), foot_right=(-20, 0, 0),
                        arm_left_upper=(-30, 0, 0), arm_right_upper=(20, 0, 0)), claws(-30, -40))
add('freeze_step', [(0, {}), (0.4, freeze), (6.0, freeze)], 6.0, loop='hold_on_last_frame', ground=0, contacts=('foot_left',))
add('finish_step', [(0, freeze), (0.25, merge(freeze, P(finger_right_1_a=(18, 0, 0)))), (1.2, STALK), (1.6, {})], 1.6, loop=False, ground=0)


# ---------------------------------------------------------------- backward walk (N02): reversed stalk walk
def reversed_anim(src):
    out = copy.deepcopy(src)
    L = src['animation_length']
    for b, ch in out['bones'].items():
        for chan, v in list(ch.items()):
            if isinstance(v, dict):
                ch[chan] = {f"{round(L - float(t), 4)}": kv for t, kv in v.items()}
                ch[chan] = dict(sorted(ch[chan].items(), key=lambda kv: float(kv[0])))
    out.pop('sound_effects', None); out.pop('particle_effects', None)
    return out


OUT['animation.shaftbreaker.backward_walk'] = reversed_anim(STALK_WALK_SRC)


# ---------------------------------------------------------------- limp (N05)
def limp_pose(u):
    s = math.sin(u * TAU)
    stiff = max(0, s)
    p = merge(STALK, P(waist=(0, 0, 10 * s), chest=(4 * stiff, 0, 6 * s), head=(0, 0, -8 * s),
                       leg_right_upper=(-8 + 22 * s, 0, 4), leg_right_lower=(4, 0, 0),          # stiff dragging leg
                       leg_left_upper=(-30 - 26 * s, 0, 0), leg_left_lower=(40 + 34 * max(0, -s), 0, 0),
                       arm_right_upper=(30, 0, -26), arm_right_lower=(10, 0, 0),                 # limp hanging arm
                       arm_left_upper=(-30 + 20 * s, 0, 0)))
    return p


add('limp', cyc(12, limp_pose, 2.0), 2.0, ground=0, atu='query.modified_distance_moved')

# ---------------------------------------------------------------- kneel (N16) + shove
kneel = merge(strip_root(FIT['kneel']), claws(-8, -10, 6))
add('kneel', [(0, {}), (0.7, merge(kneel, P(body=(-6, 0, 0)))), (1.2, kneel), (3.0, merge(kneel, P(chest=(3, 0, 0))))], 3.0,
    loop='hold_on_last_frame', ground=0, contacts=KNEES + FEET + HANDS)
shove_wind = merge(kneel, P(body=(-20, 0, 0), chest=(-16, 0, 0), arm_right_upper=(40, 0, 20), arm_left_upper=(40, 0, -20), head=(-30, 0, 0), jaw=(30, 0, 0)))
shove_hit = merge(STALK, P(body=(10, 0, 0), chest=(16, 0, 0), arm_right_upper=(-90, 0, 4), arm_right_lower=(0, 0, 0),
                           arm_left_upper=(-90, 0, -4), arm_left_lower=(0, 0, 0), jaw=(28, 0, 0)), claws(10, 4, 10))
add('shove', [(0, kneel), (0.6, shove_wind), (0.75, shove_hit), (1.1, shove_hit), (1.6, STALK)], 1.6, loop=False, ground=0, contacts=KNEES + FEET)

# ---------------------------------------------------------------- brace (corner lunge wind-up)
brace = merge(FIDLE, P(chest=(10, 0, 0), neck=(-10, 0, 0), jaw=(-30, 0, 0),
                       arm_right_upper=(-10, 0, 5), arm_left_upper=(-10, 0, -5), arm_right_lower=(-20, 0, 0), arm_left_lower=(-20, 0, 0)), claws(-30, -40, 8))
add('brace', [(0, {}), (0.35, brace), (0.75, merge(brace, P(body_p=(0, -3, 2), chest=(6, 0, 0)))), (1.0, merge(brace, P(body_p=(0, -4, 3), chest=(8, 0, 0))))],
    1.0, loop='hold_on_last_frame', ground=0)

# ---------------------------------------------------------------- claws (delayed attack: 0.9s, hit at ~0.5)
base_atk = merge(FIDLE, P(jaw=(-20, 0, 0)))
wind_r = merge(base_atk, P(chest=(-6, 28, 0), arm_right_upper=(40, 30, 60), arm_right_lower=(-40, 0, 0)), claws(10, 10, 12))
hit_r = merge(base_atk, P(chest=(10, -30, 0), arm_right_upper=(-110, -40, 20), arm_right_lower=(-10, 0, 0)), claws(-40, -50, 6))
add('claw_right', [(0, base_atk), (0.4, wind_r), (0.52, hit_r), (0.7, hit_r), (0.9, base_atk)], 0.9, loop=False, ground=0,
    extra={'sound_effects': {'0.42': {'effect': 'swing'}}})
add('claw_left', [(t, mirror(p)) for t, p in [(0, base_atk), (0.4, wind_r), (0.52, hit_r), (0.7, hit_r), (0.9, base_atk)]], 0.9, loop=False, ground=0,
    extra={'sound_effects': {'0.42': {'effect': 'swing'}}})
wind_w = merge(base_atk, P(chest=(-14, 0, 0), arm_right_upper=(20, 50, 80), arm_left_upper=(20, -50, -80), jaw=(30, 0, 0)), claws(14, 10, 14))
hit_w = merge(base_atk, P(chest=(14, 0, 0), arm_right_upper=(-80, -60, 10), arm_left_upper=(-80, 60, -10), jaw=(36, 0, 0)), claws(-40, -50, 4))
add('claw_wide', [(0, base_atk), (0.42, wind_w), (0.55, hit_w), (0.72, hit_w), (0.9, base_atk)], 0.9, loop=False, ground=0,
    extra={'sound_effects': {'0.44': {'effect': 'swing'}}})

# ---------------------------------------------------------------- ground rupture
rup_up = merge(STALK, P(body=(-10, 0, 0), chest=(-20, 0, 0), neck=(20, 0, 0), jaw=(40, 0, 0),
                        arm_right_upper=(-170, 0, 10), arm_left_upper=(-170, 0, -10), arm_right_lower=(-20, 0, 0), arm_left_lower=(-20, 0, 0)), claws(-30, -40, 10))
rup_down = merge(FIDLE, P(body=(30, 0, 0), chest=(20, 0, 0), arm_right_upper=(-60, 0, 10), arm_left_upper=(-60, 0, -10),
                          arm_right_lower=(-10, 0, 0), arm_left_lower=(-10, 0, 0), jaw=(30, 0, 0)), claws(-50, -60, 4))
add('rupture', [(0, {}), (0.6, rup_up), (0.85, rup_up), (0.98, rup_down), (1.25, rup_down), (1.6, FIDLE)], 1.6, loop=False, ground=0,
    extra={'sound_effects': {'0.1': {'effect': 'growl'}, '0.98': {'effect': 'smash'}}, 'particle_effects': {'0.98': {'effect': 'debris', 'locator': 'claw_right'}}})

# ---------------------------------------------------------------- heavy strike (long wind-up)
hv_w = merge(FIDLE, P(chest=(-18, 46, 0), waist=(0, 18, 0), arm_right_upper=(60, 40, 100), arm_right_lower=(-60, 0, 0), jaw=(-30, 0, 0), head=(0, -20, 0)), claws(10, 10, 14))
hv_h = merge(FIDLE, P(chest=(20, -40, 0), waist=(10, -10, 0), arm_right_upper=(-150, -20, 10), arm_right_lower=(0, 0, 0), jaw=(40, 0, 0)), claws(-50, -60, 2))
add('heavy', [(0, FIDLE), (0.9, hv_w), (1.0, hv_w), (1.12, hv_h), (1.4, hv_h), (1.8, FIDLE)], 1.8, loop=False, ground=0,
    extra={'sound_effects': {'0.05': {'effect': 'growl'}, '1.05': {'effect': 'swing'}}})

# ---------------------------------------------------------------- ceiling hang (root flipped, feet against ceiling)
# entity origin sits 2.0 blocks under the ceiling; model scale 0.58 -> 2.0 blocks = 55.2px
CEIL = 55.2
hang = merge(P(root=(180, 0, 0), root_p=(0, CEIL, 0),
               body=(-10, 0, 0), waist=(10, 0, 0), chest=(16, 0, 0), neck=(30, 0, 0), head=(40, 0, 0), jaw=(4, 0, 0),
               leg_right_upper=(-100, 0, 20), leg_right_lower=(120, 0, 0), foot_right=(70, 0, 0),
               leg_left_upper=(-100, 0, -20), leg_left_lower=(120, 0, 0), foot_left=(70, 0, 0),
               arm_right_upper=(-30, 0, 30), arm_right_lower=(-20, 0, 0), arm_left_upper=(-30, 0, -30), arm_left_lower=(-20, 0, 0)), claws(-30, -40, 6))
def ceil_attach(pose, top=CEIL):
    pose = copy.deepcopy(pose)
    _, mx = rig.extent(pose, {'foot_right', 'foot_left'})
    pose.setdefault('root', {}).setdefault('p', [0, 0, 0])
    pose['root']['p'] = list(pose['root']['p']); pose['root']['p'][1] += top - mx[1]
    return pose


hang = ceil_attach(hang)
add('ceiling_hang', cyc(8, lambda u: merge(hang, P(root=(3 * math.sin(u * TAU), 0, 4 * math.sin(u * TAU * 0.5 + 1)), arm_right_upper=(3 * math.sin(u * TAU + 1), 0, 0),
                                                   head=(0, 6 * math.sin(u * TAU), 0))), 6.0), 6.0)
reach = merge(hang, P(arm_right_upper=(-140, 0, 0), arm_right_lower=(30, 0, 0), chest=(0, -10, 0), jaw=(10, 0, 0)), claws(20, 10, 14))
add('ceiling_reach', [(0, hang), (1.8, reach), (3.0, merge(reach, P(finger_right_2_a=(-20, 0, 0))))], 3.0, loop='hold_on_last_frame')
land = rig.ground(FIDLE)
add('ceiling_drop', [(0, reach), (0.25, merge(hang, P(root=(-90, 0, 0), root_p=(0, -CEIL * 0.5, 0)))), (0.55, land), (0.9, merge(land, P(body_p=(0, -4, 0))))],
    0.9, loop='hold_on_last_frame', extra={'particle_effects': {'0.55': {'effect': 'step_dust', 'locator': 'foot_left'}},
                                           'sound_effects': {'0.55': {'effect': 'smash'}}})


# ---------------------------------------------------------------- wall climb
def climb_pose(u):
    s = math.sin(u * TAU)
    return merge(P(body=(-8, 0, 0), chest=(-6, 4 * s, 0), neck=(20, 0, 0), head=(-10, 0, 0),
                   arm_right_upper=(-150 + 30 * s, 0, 20), arm_right_lower=(-40 - 20 * max(0, -s), 0, 0), hand_right=(-20, 0, 0),
                   arm_left_upper=(-150 - 30 * s, 0, -20), arm_left_lower=(-40 - 20 * max(0, s), 0, 0), hand_left=(-20, 0, 0),
                   leg_right_upper=(-60 - 30 * s, 0, 14), leg_right_lower=(80 + 20 * max(0, s), 0, 0), foot_right=(-30, 0, 0),
                   leg_left_upper=(-60 + 30 * s, 0, -14), leg_left_lower=(80 + 20 * max(0, -s), 0, 0), foot_left=(-30, 0, 0)), claws(-40, -50, 6))


add('climb', cyc(12, climb_pose, 1.2), 1.2, ground=0)

# ---------------------------------------------------------------- squeeze through gap (N22)
sq = merge(STALK, P(chest=(0, 60, 0), waist=(0, 25, 0), neck=(0, -50, 0), arm_right_upper=(-20, 0, -8), arm_left_upper=(-80, 0, -30),
                    leg_right_upper=(-10, 20, 0)), claws(-30, -40, 4))
add('squeeze', [(0, STALK), (0.5, sq), (1.2, merge(sq, P(chest=(0, 10, 0)))), (1.6, STALK)], 1.6, loop=False, ground=0)

# ---------------------------------------------------------------- twisted recovery (N27)
down = merge(P(root=(0, 0, 80), body=(0, 20, 0), chest=(0, 0, 20), neck=(0, 0, 20), head=(0, -30, 20), jaw=(14, 0, 0),
               arm_right_upper=(-20, 0, 130), arm_right_lower=(-60, 0, 0), arm_left_upper=(-60, 0, -10),
               leg_right_upper=(-40, 0, 10), leg_right_lower=(60, 0, 0), leg_left_upper=(-20, 0, -20), leg_left_lower=(40, 0, 0)), claws(-20, -30, 10))
plant = merge(P(root=(0, 0, 40), body=(30, 0, 0), chest=(20, 0, -20), head=(-20, 0, -30),
                arm_right_upper=(-30, 0, 60), arm_right_lower=(-10, 0, 0), arm_left_upper=(-70, 0, -10),
                leg_right_upper=(-70, 0, 0), leg_right_lower=(110, 0, 0), leg_left_upper=(-50, 0, -10), leg_left_lower=(90, 0, 0)), claws(-10, -20, 10))
add('recover', [(0, down), (0.35, down), (0.75, plant), (1.15, rig.ground(FIDLE)), (1.4, {})], 1.4, loop=False, ground=0, contacts=ALL4 + KNEES)
add('recover_mirror', [(t, mirror(p)) for t, p in [(0, down), (0.35, down), (0.75, plant), (1.15, rig.ground(FIDLE)), (1.4, {})]], 1.4, loop=False, ground=0, contacts=ALL4 + KNEES)

# ---------------------------------------------------------------- failed leap (N26)
leap = merge(P(body=(40, 0, 0), chest=(10, 0, 0), arm_right_upper=(-150, 0, 20), arm_left_upper=(-150, 0, -20),
               leg_right_upper=(20, 0, 0), leg_left_upper=(-60, 0, 0), leg_left_lower=(60, 0, 0), jaw=(30, 0, 0)), claws(-10, -10, 12))
slip = merge(P(body=(70, 0, 10), chest=(10, 0, 0), arm_right_upper=(-80, 0, 30), arm_left_upper=(-50, 0, -40), arm_left_lower=(-30, 0, 0),
               leg_right_upper=(-120, 0, 10), leg_right_lower=(130, 0, 0), leg_left_upper=(-60, 0, -10), leg_left_lower=(140, 0, 0), head=(-30, 0, 0)), claws(-4, -8, 10))
add('failed_leap', [(0, FIDLE), (0.3, leap), (0.6, merge(leap, P(root_p=(0, 12, 0)))), (0.85, slip), (1.5, slip), (2.0, FIDLE)], 2.0, loop=False,
    ground=0, contacts=ALL4 + KNEES, extra={'sound_effects': {'0.85': {'effect': 'scrape'}}, 'particle_effects': {'0.85': {'effect': 'step_dust', 'locator': 'claw_left'}}})


# ---------------------------------------------------------------- desperate scramble (N30)
def scramble_pose(u):
    s = math.sin(u * TAU); c = math.cos(u * TAU)
    base = crawl_pose(u * 1.0, 1.0)
    return merge(base, P(body=(-22 + 6 * s, 0, 8 * c), chest=(0, 10 * s, 0), head=(10 * s, 18 * c, 10 * s), jaw=(18 + 10 * s, 0, 0),
                         arm_right_upper=(-30 * max(0, s), 0, 0)))


add('scramble', cyc(12, scramble_pose, 2.4), 2.4, ground=0, contacts=ALL4 + KNEES, atu='query.modified_distance_moved')

# ---------------------------------------------------------------- collapse / defeat (L88)
stag = merge(STALK, P(root=(0, 0, 10), chest=(0, 20, 10), head=(20, -20, 30), jaw=(26, 0, 0), arm_right_upper=(20, 0, 30), leg_right_lower=(30, 0, 0)))
knees = merge(kneel, P(head=(30, 0, 30), jaw=(30, 0, 0), arm_right_upper=(-10, 0, 40), arm_left_upper=(-60, 0, -14)))
fall = merge(strip_root(FIT['fallen']), P(jaw=(30, 0, 0)), claws(-10, -10, 16))
add('collapse', [(0, {}), (0.5, stag), (1.2, knees), (1.6, knees), (2.2, fall), (2.6, merge(fall, P(head=(-6, 0, 0)))), (3.2, fall)], 3.2,
    loop='hold_on_last_frame', ground=0, contacts=ALL4 + KNEES,
    extra={'sound_effects': {'0.1': {'effect': 'death'}, '2.2': {'effect': 'smash'}}, 'particle_effects': {'2.2': {'effect': 'debris', 'locator': 'lead'}}})

# ---------------------------------------------------------------- vanish (backs into the dark, folds down)
add('vanish', [(0, {}), (0.6, merge(STALK, P(body_p=(0, 0, 6)))), (1.3, merge(crouch_pose(0, 0), P(neck=(20, 0, 0), head=(20, 0, 0))))], 1.3,
    loop='hold_on_last_frame', ground=0)

# ---------------------------------------------------------------- break strike (breaker block smash)
bw = merge(FIDLE, P(chest=(-20, 20, 0), arm_right_upper=(-150, 20, 40), arm_right_lower=(-40, 0, 0), arm_left_upper=(-150, -20, -40), arm_left_lower=(-40, 0, 0), jaw=(20, 0, 0)), claws(-10, -20, 10))
bh = merge(FIDLE, P(chest=(20, -10, 0), arm_right_upper=(-80, -20, 10), arm_right_lower=(0, 0, 0), arm_left_upper=(-80, 20, -10), arm_left_lower=(0, 0, 0), jaw=(30, 0, 0)), claws(-50, -60, 4))
add('break_strike', [(0, FIDLE), (0.6, bw), (0.75, bh), (1.0, bh), (1.3, FIDLE)], 1.3, loop=False, ground=0,
    extra={'sound_effects': {'0.2': {'effect': 'scrape'}, '0.75': {'effect': 'smash'}},
           'particle_effects': {'0.3': {'effect': 'step_dust', 'locator': 'lead'}, '0.75': {'effect': 'debris', 'locator': 'claw_right'}}})


# ---------------------------------------------------------------- eat (meat distraction)
def eat_pose(u):
    s = math.sin(u * TAU * 2)
    return merge(crouch_pose(0, 0), P(neck=(20, 0, 0), head=(30, 0, 0), jaw=(14 + 12 * s, 0, 0),
                                      arm_right_upper=(-80, 0, -20), arm_right_lower=(-70 + 8 * s, 0, 0), arm_left_upper=(-80, 0, 20), arm_left_lower=(-70 - 8 * s, 0, 0)))


add('eat', cyc(8, eat_pose, 1.6), 1.6, ground=0, extra={'sound_effects': {'0.2': {'effect': 'chew'}, '1.0': {'effect': 'chew'}}})

# ---------------------------------------------------------------- frenzy halt
halt = merge(FIDLE, P(body=(-20, 0, 0), chest=(-10, 0, 0), arm_right_upper=(-20, 0, 50), arm_left_upper=(-20, 0, -50), jaw=(10, 0, 0)))
add('frenzy_halt', [(0, {}), (0.3, halt), (0.8, merge(halt, P(body=(10, 0, 0)))), (1.2, rig.ground(STALK))], 1.2, loop='hold_on_last_frame', ground=0,
    extra={'sound_effects': {'0.15': {'effect': 'scrape'}}, 'particle_effects': {'0.15': {'effect': 'step_dust', 'locator': 'foot_right'}}})

# ---------------------------------------------------------------- wall brace (L06)
wb = merge(WATCH, P(root=(0, 40, 0), waist=(0, 0, -10), chest=(0, 0, -12), arm_right_upper=(-20, 0, 120), arm_right_lower=(-40, 0, 0), hand_right=(0, 0, 40),
                    head=(0, 10, -10)), claws(-34, -44, 10))
add('wall_brace', cyc(6, lambda u: merge(wb, P(finger_right_3_a=(5 * math.sin(u * TAU), 0, 0))), 4.0), 4.0, ground=0)

# ---------------------------------------------------------------- roar (full body)
r1 = merge(STALK, P(neck=(40, 0, 0), head=(20, 0, 0), jaw=(10, 0, 0), arm_right_upper=(10, 0, 40), arm_left_upper=(10, 0, -40)))
r2 = merge(STALK, P(chest=(-14, 0, 0), neck=(-40, 0, 0), head=(-30, 0, 0), jaw=(46, 0, 0), arm_right_upper=(-20, 0, 70), arm_left_upper=(-20, 0, -70)), claws(10, 10, 16))
add('roar', [(0, {}), (0.4, r1), (0.75, r2), (1.6, merge(r2, P(head=(0, 6, 4)))), (2.1, r2), (2.6, STALK)], 2.6, loop=False, ground=0,
    extra={'sound_effects': {'0.6': {'effect': 'roar'}}})

# ================================================================ OVERLAYS (additive, small)
add('twitch', [(0, {}), (0.8, {}), (0.9, P(finger_right_2_a=(-26, 0, 0), finger_right_2_b=(-20, 0, 0))), (1.05, P(finger_right_2_a=(-8, 0, 0))),
               (1.2, P(finger_right_2_a=(-20, 0, 0), jaw=(3, 0, 0))), (1.6, {})], 1.6, loop=False, lerp='linear')
add('head_tilt', [(0, {}), (0.5, P(head=(0, 0, 26))), (1.0, P(head=(0, 0, 26), neck=(0, 0, -8))), (1.6, P(head=(4, 10, 30), neck=(0, 0, -8), arm_left_upper=(0, 0, -6))),
                  (2.5, P(head=(4, 10, 30), neck=(0, 0, -8), arm_left_upper=(0, 0, -6)))], 2.5, loop='hold_on_last_frame', lerp='linear')
add('scream_cut', [(0, {}), (0.35, P(jaw=(42, 0, 0), head=(-12, 0, 0), neck=(-6, 0, 0))), (1.0, P(jaw=(42, 0, 0), head=(-12, 0, 0), neck=(-6, 0, 0))),
                   (1.06, P(jaw=(2, 0, 0))), (1.8, {})], 1.8, loop=False, lerp='linear')
add('breath', cyc(6, lambda u: P(chest=(2.2 * math.sin(u * TAU), 0, 0), mane_front=(-3 * math.sin(u * TAU), 0, 0), mane_left=(0, 0, 3 * math.sin(u * TAU)),
                                 mane_right=(0, 0, -3 * math.sin(u * TAU)), jaw=(1.5 + 1.5 * math.sin(u * TAU), 0, 0)), 3.2), 3.2)
add('door_reach', [(0, {}), (0.5, P(arm_right_upper=(-80, 20, -10), arm_right_lower=(-20, 0, 0))), (0.8, P(arm_right_upper=(-70, 30, -6), arm_right_lower=(-40, 0, 0))),
                   (1.3, {})], 1.3, loop=False)
add('last_glance', [(0, {}), (0.8, P(neck=(0, 30, 0), head=(4, 50, 6))), (2.6, P(neck=(0, 34, 0), head=(4, 56, 8)))], 2.6, loop='hold_on_last_frame')
add('stare', cyc(4, lambda u: P(neck=(8, 0, 0), neck_p=(0, 0, -1.5), head=(6 + 0.4 * math.sin(u * TAU), 0, 0)), 8.0), 8.0)
add('crooked_gait', [(0, P(body=(0, 0, 12), chest=(0, 14, -6), head=(0, -10, -20), arm_left_upper=(10, 0, 10), arm_left_lower=(-20, 0, 0)))], 1.0)


def broken(u):
    s = max(0.0, math.sin(u * TAU))
    return P(leg_left_upper=(18 * s, -14 * s, 10 * s), leg_left_lower=(-40 * s, 0, 0), foot_left=(20 * s, 0, 0), body=(0, 0, -6 * s))


add('broken_gait', cyc(10, broken, 3.3), 3.3, atu='query.modified_distance_moved')

# ---------------------------------------------------------------- additive attack overlays (delta from frenzy idle, upper body only)
UPPER = [b for b in rig.order if b.startswith(('chest', 'neck', 'head', 'jaw', 'arm_', 'hand_', 'finger_', 'thumb_', 'mane_'))]


def delta(p, base=FIDLE):
    out = {}
    for b in UPPER:
        pv = p.get(b, {}); bv = base.get(b, {})
        r = [pv.get('r', [0, 0, 0])[i] - bv.get('r', [0, 0, 0])[i] for i in range(3)]
        if any(abs(x) > 0.01 for x in r):
            out[b] = {'r': r}
    return out


for nm, seq in [('claw_right_add', [(0, base_atk), (0.4, wind_r), (0.52, hit_r), (0.7, hit_r), (0.9, base_atk)]),
                ('claw_left_add', [(t, mirror(p)) for t, p in [(0, base_atk), (0.4, wind_r), (0.52, hit_r), (0.7, hit_r), (0.9, base_atk)]]),
                ('claw_wide_add', [(0, base_atk), (0.42, wind_w), (0.55, hit_w), (0.72, hit_w), (0.9, base_atk)])]:
    OUT[f'animation.shaftbreaker.{nm}'] = build_anim([(t, delta(p)) for t, p in seq], 0.9, False, 'catmullrom',
                                                     {'sound_effects': {'0.42': {'effect': 'swing'}}})

os.makedirs(os.path.join(S, 'build'), exist_ok=True)
json.dump({'format_version': '1.8.0', 'animations': OUT}, open(os.path.join(S, 'build/shaftbreaker.acts.animation.json'), 'w'), indent=None, separators=(',', ':'))
print('animations:', len(OUT))
for k, v in OUT.items():
    print(f"  {k:48s} len={v['animation_length']:5} loop={v['loop']}")
