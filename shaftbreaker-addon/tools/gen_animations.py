#!/usr/bin/env python3
"""Generates the extra Shaftbreaker animations + all client animation controllers.

The original animations (dormant, look_at, stalk_idle, stalk_walk, watch, breaker_smash,
breaker_walk, frenzy_idle, frenzy_run, frenzy_lunge) are copied untouched; everything here is
layered on top of the same rig, so the creature keeps one consistent anatomy in every phase.

Rotation convention (raw Bedrock values): +X pitches a bone forward (top toward the face),
thigh forward = -X, knee bend = +X, jaw open = +X, neck back = -X.
"""
import copy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src_assets')
OUT_ANIM = os.path.join(ROOT, 'RP', 'animations')
OUT_CTRL = os.path.join(ROOT, 'RP', 'animation_controllers')

A = {}
for f in ['shaftbreaker.dormant', 'shaftbreaker.stalking', 'shaftbreaker.watching', 'shaftbreaker.breaker',
          'shaftbreaker.frenzy']:
    A.update(json.load(open(os.path.join(SRC, f + '.animation.json')))['animations'])

N = 'animation.shaftbreaker.'


def r3(v):
    return [round(float(x), 3) for x in v]


def static(bones):
    """bones: name -> {'r': [..], 'p': [..], 's': [..]} -> additive looping pose"""
    out = {}
    for b, d in bones.items():
        e = {}
        if 'r' in d:
            e['rotation'] = r3(d['r'])
        if 'p' in d:
            e['position'] = r3(d['p'])
        if 's' in d:
            e['scale'] = r3(d['s'])
        out[b] = e
    return out


def keyed(frames, smooth=True):
    """frames: list of (time, {bone: {'r':..,'p':..,'s':..}}). Missing channels default to identity."""
    bones = {}
    chans = {}
    for t, pose in frames:
        for b, d in pose.items():
            for ch in d:
                chans.setdefault(b, set()).add(ch)
    for b, cs in chans.items():
        bones[b] = {}
        for ch in cs:
            name = {'r': 'rotation', 'p': 'position', 's': 'scale'}[ch]
            ident = [1, 1, 1] if ch == 's' else [0, 0, 0]
            kf = {}
            for t, pose in frames:
                v = pose.get(b, {}).get(ch, ident)
                key = '%.4g' % t
                if '.' not in key:
                    key += '.0'
                if smooth:
                    kf[key] = {'post': r3(v), 'lerp_mode': 'catmullrom'}
                else:
                    kf[key] = r3(v)
            bones[b][name] = kf
    return bones


def legs(th, sh, ft):
    return {'leg_right_upper': {'r': [th, 0, 0]}, 'leg_left_upper': {'r': [th, 0, 0]},
            'leg_right_lower': {'r': [sh, 0, 0]}, 'leg_left_lower': {'r': [sh, 0, 0]},
            'foot_right': {'r': [ft, 0, 0]}, 'foot_left': {'r': [ft, 0, 0]}}


def merged(*ds):
    out = {}
    for d in ds:
        for b, v in d.items():
            cur = out.setdefault(b, {})
            for ch, val in v.items():
                if ch in cur and ch != 's':
                    cur[ch] = [a + c for a, c in zip(cur[ch], val)]
                else:
                    cur[ch] = list(val)
    return out


anims = {}

# ---------------------------------------------------------------- crouch layers (2-block tunnels)
anims[N + 'crouch_full'] = {'loop': True, 'bones': static(merged(legs(-56, 112, -56), {
    'body': {'p': [0, -18, 0]}, 'waist': {'r': [18, 0, 0]}, 'chest': {'r': [24, 0, 0]},
    'neck': {'r': [-28, 0, 0]}, 'head': {'r': [-14, 0, 0]},
    'arm_right_upper': {'r': [-30, 0, 0]}, 'arm_left_upper': {'r': [-30, 0, 0]},
    'arm_right_lower': {'r': [-25, 0, 0]}, 'arm_left_lower': {'r': [-25, 0, 0]}}))}
anims[N + 'crouch_stalk'] = {'loop': True, 'bones': static(merged(legs(-50, 100, -50), {
    'body': {'p': [0, -12.5, 0]}, 'chest': {'r': [22, 0, 0]}, 'waist': {'r': [8, 0, 0]},
    'neck': {'r': [-22, 0, 0]}}))}
anims[N + 'crouch_run'] = {'loop': True, 'bones': static(merged(legs(-34, 68, -34), {
    'body': {'p': [0, -12.5, 0]}, 'chest': {'r': [20, 0, 0]}, 'neck': {'r': [-16, 0, 0]}}))}

# ---------------------------------------------------------------- crawl (1-block gaps): army crawl on its arms
CRAWL = {
    'body': {'r': [84, 0, 0], 'p': [0, -38, -6]}, 'mane_back': {'r': [38, 0, 0]}, 'mane_front': {'r': [30, 0, 0]},
    'mane_left': {'r': [0, 0, -30]}, 'mane_right': {'r': [0, 0, 30]},
    'waist': {'r': [-4, 0, 0]}, 'chest': {'r': [-6, 0, 0]},
    'neck': {'r': [-12, 0, 0]}, 'head': {'r': [-10, 0, 0]}, 'jaw': {'r': [12, 0, 0]},
    'arm_right_upper': {'r': [-140, 0, 16]}, 'arm_left_upper': {'r': [-124, 0, -16]},
    'arm_right_lower': {'r': [-30, 0, 0]}, 'arm_left_lower': {'r': [-40, 0, 0]},
    'hand_right': {'r': [40, 0, 0]}, 'hand_left': {'r': [30, 0, 0]},
    'leg_right_upper': {'r': [-6, 0, -8]}, 'leg_left_upper': {'r': [-14, 0, 8]},
    'leg_right_lower': {'r': [22, 0, 0]}, 'leg_left_lower': {'r': [34, 0, 0]},
    'foot_right': {'r': [-40, 0, 0]}, 'foot_left': {'r': [-40, 0, 0]},
}


def crawl_frame(phase):
    """phase 0..1 : alternating arm pulls, body sway, trailing leg twitch."""
    import math
    s = math.sin(phase * 2 * math.pi)
    c = math.cos(phase * 2 * math.pi)
    d = copy.deepcopy(CRAWL)
    d['arm_right_upper']['r'] = [-132 + 14 * s, 0, 16 + 4 * c]
    d['arm_left_upper']['r'] = [-132 - 14 * s, 0, -16 + 4 * c]
    d['arm_right_lower']['r'] = [-35 - 12 * c, 0, 0]
    d['arm_left_lower']['r'] = [-35 + 12 * c, 0, 0]
    d['body']['r'] = [84, 0, 5 * s]
    d['body']['p'] = [0, -38 + 0.8 * abs(s), -6]
    d['leg_right_upper']['r'] = [-6 - 6 * s, 0, -8]
    d['leg_left_upper']['r'] = [-14 + 6 * s, 0, 8]
    d['head']['r'] = [-10, 6 * s, -4 * s]
    return d


anims[N + 'crawl'] = {'loop': True, 'animation_length': 1.6, 'anim_time_update': 'query.modified_distance_moved * 0.9',
                      'bones': keyed([(1.6 * i / 8, crawl_frame(i / 8)) for i in range(9)])}

# ---------------------------------------------------------------- climb (wall climbing)


def climb_frame(phase):
    import math
    s = math.sin(phase * 2 * math.pi)
    return {
        'body': {'r': [-6, 0, 3 * s], 'p': [0, -4, 2]},
        'chest': {'r': [-8, 0, 0]}, 'neck': {'r': [-24, 0, 0]}, 'head': {'r': [-18, 0, 0]},
        'arm_right_upper': {'r': [-150 + 30 * s, 0, 10]}, 'arm_left_upper': {'r': [-150 - 30 * s, 0, -10]},
        'arm_right_lower': {'r': [-30 - 20 * s, 0, 0]}, 'arm_left_lower': {'r': [-30 + 20 * s, 0, 0]},
        'hand_right': {'r': [30, 0, 0]}, 'hand_left': {'r': [30, 0, 0]},
        'leg_right_upper': {'r': [-40 - 25 * s, 0, -6]}, 'leg_left_upper': {'r': [-40 + 25 * s, 0, 6]},
        'leg_right_lower': {'r': [60 + 20 * s, 0, 0]}, 'leg_left_lower': {'r': [60 - 20 * s, 0, 0]},
    }


anims[N + 'climb'] = {'loop': True, 'animation_length': 1.2, 'bones': keyed([(1.2 * i / 8, climb_frame(i / 8)) for i in range(9)])}

# ---------------------------------------------------------------- swim


def swim_frame(phase):
    import math
    s = math.sin(phase * 2 * math.pi)
    c = math.cos(phase * 2 * math.pi)
    return {
        'body': {'r': [70, 0, 4 * s], 'p': [0, -22, 0]},
        'neck': {'r': [-40, 0, 0]}, 'head': {'r': [-20, 0, 0]}, 'jaw': {'r': [10 + 6 * s, 0, 0]},
        'arm_right_upper': {'r': [-150 + 40 * c, 0, 20 + 30 * s]}, 'arm_left_upper': {'r': [-150 + 40 * c, 0, -20 - 30 * s]},
        'arm_right_lower': {'r': [-20, 0, 0]}, 'arm_left_lower': {'r': [-20, 0, 0]},
        'leg_right_upper': {'r': [-10 + 22 * s, 0, 0]}, 'leg_left_upper': {'r': [-10 - 22 * s, 0, 0]},
        'leg_right_lower': {'r': [20, 0, 0]}, 'leg_left_lower': {'r': [20, 0, 0]},
    }


anims[N + 'swim'] = {'loop': True, 'animation_length': 1.8, 'bones': keyed([(1.8 * i / 8, swim_frame(i / 8)) for i in range(9)])}

# ---------------------------------------------------------------- scream (additive over watch)
SCREAM_PEAK = {
    'chest': {'r': [-18, 0, 0]}, 'waist': {'r': [-6, 0, 0]}, 'neck': {'r': [-34, 0, 0]}, 'head': {'r': [-22, 0, 0]},
    'jaw': {'r': [58, 0, 0]},
    'arm_right_upper': {'r': [-35, 0, 55]}, 'arm_left_upper': {'r': [-35, 0, -55]},
    'arm_right_lower': {'r': [-30, 0, 0]}, 'arm_left_lower': {'r': [-30, 0, 0]},
    'mane_front': {'s': [1.25, 1.25, 1.25]}, 'mane_back': {'s': [1.25, 1.25, 1.25]},
    'mane_left': {'s': [1.25, 1.25, 1.25]}, 'mane_right': {'s': [1.25, 1.25, 1.25]},
}


def jitter(d, k):
    import random
    rnd = random.Random(k)
    out = copy.deepcopy(d)
    for b in ('head', 'neck', 'chest'):
        if b in out and 'r' in out[b]:
            out[b]['r'] = [v + rnd.uniform(-3, 3) for v in out[b]['r']]
    return out


ZERO = {b: {'r': [0, 0, 0]} for b in SCREAM_PEAK if 'r' in SCREAM_PEAK[b]}
ZERO.update({b: {'s': [1, 1, 1]} for b in SCREAM_PEAK if 's' in SCREAM_PEAK[b]})
frames = [(0.0, ZERO), (0.35, SCREAM_PEAK)]
for i, t in enumerate([0.55, 0.75, 0.95, 1.15, 1.35, 1.55, 1.75, 1.95]):
    frames.append((t, jitter(SCREAM_PEAK, i)))
frames += [(2.3, SCREAM_PEAK), (2.7, ZERO)]
anims[N + 'scream'] = {'loop': False, 'animation_length': 2.7, 'bones': keyed(frames)}

# ---------------------------------------------------------------- threat display (stand tall, mane flare) additive
anims[N + 'threat_rear'] = {'loop': True, 'animation_length': 3.0, 'bones': keyed([
    (0.0, {'chest': {'r': [-8, 0, 0]}, 'jaw': {'r': [24, 0, 0]}, 'body': {'p': [0, 1.5, 0]},
           'mane_front': {'s': [1.15, 1.15, 1.15]}, 'mane_back': {'s': [1.15, 1.15, 1.15]},
           'mane_left': {'s': [1.15, 1.15, 1.15]}, 'mane_right': {'s': [1.15, 1.15, 1.15]}}),
    (1.5, {'chest': {'r': [-12, 0, 0]}, 'jaw': {'r': [34, 0, 0]}, 'body': {'p': [0, 2.5, 0]},
           'mane_front': {'s': [1.25, 1.25, 1.25]}, 'mane_back': {'s': [1.25, 1.25, 1.25]},
           'mane_left': {'s': [1.25, 1.25, 1.25]}, 'mane_right': {'s': [1.25, 1.25, 1.25]}}),
    (3.0, {'chest': {'r': [-8, 0, 0]}, 'jaw': {'r': [24, 0, 0]}, 'body': {'p': [0, 1.5, 0]},
           'mane_front': {'s': [1.15, 1.15, 1.15]}, 'mane_back': {'s': [1.15, 1.15, 1.15]},
           'mane_left': {'s': [1.15, 1.15, 1.15]}, 'mane_right': {'s': [1.15, 1.15, 1.15]}}),
])}

# ---------------------------------------------------------------- corner peeks (additive, hold)
for side, sg in (('left', 1), ('right', -1)):
    peek = {'body': {'r': [0, 0, 24 * sg], 'p': [9 * sg, -6, 0]},
            'chest': {'r': [6, 0, 10 * sg]}, 'neck': {'r': [0, 0, -16 * sg]}, 'head': {'r': [0, 0, -18 * sg]},
            ('arm_left_upper' if sg > 0 else 'arm_right_upper'): {'r': [-70, 0, -30 * sg]},
            ('arm_left_lower' if sg > 0 else 'arm_right_lower'): {'r': [-40, 0, 0]}}
    zero = {b: {k: ([0, 0, 0]) for k in v} for b, v in peek.items()}
    anims[N + 'peek_' + side] = {'loop': 'hold_on_last_frame', 'animation_length': 1.4,
                                  'bones': keyed([(0.0, zero), (1.4, peek)])}

# ---------------------------------------------------------------- backward withdrawal: reversed stalk walk


def reverse_anim(an, length, new_update=None):
    out = copy.deepcopy(an)
    out.pop('sound_effects', None)
    out.pop('particle_effects', None)
    for b, chs in out['bones'].items():
        for ch, kf in list(chs.items()):
            if isinstance(kf, dict):
                nk = {}
                for k, v in kf.items():
                    t = round(length - float(k), 4)
                    key = ('%.4f' % t).rstrip('0')
                    if key.endswith('.'):
                        key += '0'
                    if isinstance(v, dict):
                        v = dict(v)
                        pre, post = v.get('pre'), v.get('post')
                        if pre is not None and post is not None:
                            v['pre'], v['post'] = post, pre
                    nk[key] = v
                chs[ch] = dict(sorted(nk.items(), key=lambda kv: float(kv[0])))
    if new_update:
        out['anim_time_update'] = new_update
    else:
        out.pop('anim_time_update', None)
    return out


sw = A[N + 'stalk_walk']
anims[N + 'stalk_walk_back'] = reverse_anim(sw, sw['animation_length'], 'query.anim_time + query.delta_time * 0.85')

# ---------------------------------------------------------------- vanish / appear (phase out & in)


def vanish_frames():
    import random
    rnd = random.Random(7)
    fr = [(0.0, {'root': {'s': [1, 1, 1]}, 'neck': {'r': [0, 0, 0]}, 'head': {'r': [0, 0, 0]}, 'chest': {'r': [0, 0, 0]}})]
    t = 0.08
    while t < 1.0:
        a = 1 + t * 2
        fr.append((t, {'root': {'s': [1, 1, 1]},
                       'neck': {'r': [rnd.uniform(-12, 12) * a, rnd.uniform(-25, 25) * a, rnd.uniform(-15, 15) * a]},
                       'head': {'r': [rnd.uniform(-15, 15) * a, rnd.uniform(-30, 30) * a, rnd.uniform(-35, 35) * a]},
                       'chest': {'r': [rnd.uniform(-6, 6) * a, rnd.uniform(-8, 8) * a, rnd.uniform(-6, 6) * a]}}))
        t += 0.07
    fr.append((1.15, {'root': {'s': [1.05, 1.1, 1.05]}, 'neck': {'r': [0, 0, 30]}, 'head': {'r': [10, 40, 60]}, 'chest': {'r': [0, 0, 0]}}))
    fr.append((1.5, {'root': {'s': [0.02, 0.02, 0.02]}, 'neck': {'r': [0, 0, 30]}, 'head': {'r': [10, 40, 60]}, 'chest': {'r': [0, 0, 0]}}))
    return fr


anims[N + 'vanish'] = {'loop': 'hold_on_last_frame', 'animation_length': 1.5, 'bones': keyed(vanish_frames(), smooth=False)}
anims[N + 'appear'] = {'loop': False, 'animation_length': 1.0, 'bones': keyed([
    (0.0, {'root': {'s': [0.02, 0.02, 0.02]}}), (0.7, {'root': {'s': [1.04, 1.04, 1.04]}}), (1.0, {'root': {'s': [1, 1, 1]}})])}

# ---------------------------------------------------------------- head tilt, jaw chatter, twitch (additive overlays)
anims[N + 'head_tilt'] = {'loop': 'hold_on_last_frame', 'animation_length': 2.2, 'bones': keyed([
    (0.0, {'head': {'r': [0, 0, 0]}, 'neck': {'r': [0, 0, 0]}}),
    (1.6, {'head': {'r': [-8, 6, 58]}, 'neck': {'r': [0, 0, 14]}}),
    (2.2, {'head': {'r': [-10, 8, 62]}, 'neck': {'r': [0, 0, 15]}})])}
anims[N + 'jaw_chatter'] = {'loop': True, 'animation_length': 0.5, 'bones': keyed([
    (0.0, {'jaw': {'r': [0, 0, 0]}}), (0.12, {'jaw': {'r': [16, 0, 0]}}), (0.25, {'jaw': {'r': [2, 0, 0]}}),
    (0.37, {'jaw': {'r': [12, 0, 0]}}), (0.5, {'jaw': {'r': [0, 0, 0]}})], smooth=False)}


def twitch_frames():
    import random
    rnd = random.Random(31)
    fr = []
    t = 0.0
    cur = {'head': [0, 0, 0], 'neck': [0, 0, 0]}
    while t < 7.0:
        fr.append((t, {'head': {'r': list(cur['head'])}, 'neck': {'r': list(cur['neck'])}}))
        hold = rnd.uniform(0.6, 1.8)
        fr.append((min(7.0, t + hold), {'head': {'r': list(cur['head'])}, 'neck': {'r': list(cur['neck'])}}))
        t += hold + 0.05
        if rnd.random() < 0.7:
            cur = {'head': [rnd.uniform(-10, 8), rnd.uniform(-35, 35), rnd.uniform(-40, 40)],
                   'neck': [rnd.uniform(-6, 6), rnd.uniform(-12, 12), rnd.uniform(-10, 10)]}
        else:
            cur = {'head': [0, 0, 0], 'neck': [0, 0, 0]}
    fr.append((7.0, {'head': {'r': [0, 0, 0]}, 'neck': {'r': [0, 0, 0]}}))
    # remove duplicate times
    seen, out = set(), []
    for t, p in fr:
        k = round(t, 3)
        if k in seen or k > 7.0:
            continue
        seen.add(k)
        out.append((k, p))
    return out


anims[N + 'twitch'] = {'loop': True, 'animation_length': 7.0, 'bones': keyed(twitch_frames(), smooth=False)}

# ---------------------------------------------------------------- stagger (additive), death (full)
anims[N + 'stagger'] = {'loop': False, 'animation_length': 0.8, 'bones': keyed([
    (0.0, {'chest': {'r': [0, 0, 0]}, 'neck': {'r': [0, 0, 0]}, 'body': {'p': [0, 0, 0]},
           'arm_right_upper': {'r': [0, 0, 0]}, 'arm_left_upper': {'r': [0, 0, 0]}}),
    (0.15, {'chest': {'r': [-28, 0, 6]}, 'neck': {'r': [-20, 0, 0]}, 'body': {'p': [0, 0, 5]},
            'arm_right_upper': {'r': [-40, 0, 40]}, 'arm_left_upper': {'r': [-30, 0, -45]}}),
    (0.8, {'chest': {'r': [0, 0, 0]}, 'neck': {'r': [0, 0, 0]}, 'body': {'p': [0, 0, 0]},
           'arm_right_upper': {'r': [0, 0, 0]}, 'arm_left_upper': {'r': [0, 0, 0]}})])}

KNEEL = merged(legs(-85, 125, -40), {'body': {'p': [0, -19, 0]}, 'chest': {'r': [20, 0, 0]}, 'neck': {'r': [20, 0, 0]},
                                     'arm_right_upper': {'r': [-10, 0, 20]}, 'arm_left_upper': {'r': [-10, 0, -20]}})
FALLEN = merged(legs(-90, 40, 0), {'body': {'r': [86, 0, 8], 'p': [0, -40, -10]}, 'neck': {'r': [10, 25, 0]},
                                   'head': {'r': [0, 30, 20]}, 'jaw': {'r': [40, 0, 0]},
                                   'arm_right_upper': {'r': [-150, 0, 40]}, 'arm_left_upper': {'r': [-120, 0, -60]}})
DZ = {b: {k: ([1, 1, 1] if k == 's' else [0, 0, 0]) for k in v} for b, v in merged(KNEEL, FALLEN).items()}
anims[N + 'death'] = {'loop': 'hold_on_last_frame', 'animation_length': 2.4, 'bones': keyed([
    (0.0, DZ), (0.7, merged(DZ, KNEEL)), (1.1, merged(DZ, KNEEL)), (1.7, merged(DZ, FALLEN)), (2.4, merged(DZ, FALLEN))])}

# ---------------------------------------------------------------- false lunge / heavy strike (derived)


def slice_anim(an, t0, t1, mirror_back=False):
    out = {'loop': False, 'bones': {}}
    L = (t1 - t0) * (2 if mirror_back else 1)
    out['animation_length'] = round(L, 3)
    for b, chs in an['bones'].items():
        nb = {}
        for ch, kf in chs.items():
            if not isinstance(kf, dict):
                nb[ch] = kf
                continue
            items = sorted(((float(k), v) for k, v in kf.items()), key=lambda kv: kv[0])
            sel = [(t - t0, v) for t, v in items if t0 <= t <= t1]
            if not sel:
                continue
            nk = {}
            for t, v in sel:
                nk['%.4f' % t] = v
            if mirror_back:
                for t, v in sel:
                    nk['%.4f' % (2 * (t1 - t0) - t)] = v
            nb[ch] = dict(sorted(nk.items(), key=lambda kv: float(kv[0])))
        if nb:
            out['bones'][b] = nb
    return out


fl = slice_anim(A[N + 'frenzy_lunge'], 0.0, 0.4, mirror_back=True)
anims[N + 'false_lunge'] = fl
hs = slice_anim(A[N + 'breaker_smash'], 0.0, 0.9)
hs['sound_effects'] = {'0.324': {'effect': 'scrape'}, '0.45': {'effect': 'smash'}}
hs['particle_effects'] = {'0.45': {'effect': 'debris', 'locator': 'claw_left'}}
anims[N + 'heavy_strike'] = hs

# ---------------------------------------------------------------- write animations
os.makedirs(OUT_ANIM, exist_ok=True)
json.dump({'format_version': '1.8.0', 'animations': anims}, open(os.path.join(OUT_ANIM, 'shaftbreaker.extra.animation.json'), 'w'),
          separators=(',', ':'))
# originals copied verbatim
for f in ['shaftbreaker.dormant', 'shaftbreaker.stalking', 'shaftbreaker.watching', 'shaftbreaker.breaker', 'shaftbreaker.frenzy']:
    d = json.load(open(os.path.join(SRC, f + '.animation.json')))
    json.dump(d, open(os.path.join(OUT_ANIM, f + '.animation.json'), 'w'), separators=(',', ':'))

# ================================================================ animation controllers
STATES = ['dormant', 'stalk', 'watch', 'threat', 'hunt', 'search', 'break', 'retreat', 'scream', 'vanish', 'climb',
          'swim', 'peek_l', 'peek_r', 'stagger', 'death']
MV = 'variable.move_blend'
AT = 'variable.attack_w'
STATE_ANIMS = {
    'dormant': [{'dormant': '1.0'}],
    'stalk': [{'stalk_idle': '1.0 - ' + MV}, {'stalk_walk': MV}, {'jaw_chatter': '0.35'}],
    'watch': [{'watch': '1.0'}, {'twitch': '1.0'}],
    'threat': [{'frenzy_idle': '(1.0 - %s) * (1.0 - %s)' % (MV, AT)}, {'breaker_walk': '%s * (1.0 - %s)' % (MV, AT)},
               {'threat_rear': '1.0 - ' + AT}],
    'hunt': [{'frenzy_idle': '(1.0 - %s) * (1.0 - %s)' % (MV, AT)}, {'frenzy_run': '%s * (1.0 - %s)' % (MV, AT)}],
    'search': [{'stalk_idle': '1.0 - ' + MV}, {'breaker_walk': MV}],
    'break': [{'breaker_smash': '1.0'}],
    'retreat': [{'stalk_walk_back': '1.0'}],
    'scream': [{'watch': '1.0'}, 'scream'],
    'vanish': [{'watch': '1.0'}, 'vanish'],
    'climb': ['climb'],
    'swim': ['swim'],
    'peek_l': [{'stalk_idle': '1.0'}, 'peek_left'],
    'peek_r': [{'stalk_idle': '1.0'}, 'peek_right'],
    'stagger': [{'frenzy_idle': '1.0 - ' + AT}, 'stagger'],
    'death': ['death'],
}
BLEND = {'vanish': 0.15, 'death': 0.3, 'stagger': 0.1, 'scream': 0.25, 'hunt': 0.3, 'climb': 0.25, 'swim': 0.4}
P_STATE = "query.property('shaftbreaker:state')"
P_POSE = "query.property('shaftbreaker:pose')"


def state_is(s):
    return "%s == '%s'" % (P_STATE, s)


main_states = {}
for s in STATES:
    trans = []
    if s not in ('death', 'vanish'):
        trans.append({'crawling': '%s == 2' % P_POSE})
    for o in STATES:
        if o != s:
            trans.append({o: state_is(o)})
    main_states[s] = {'animations': STATE_ANIMS[s], 'transitions': trans, 'blend_transition': BLEND.get(s, 0.45)}
crawl_trans = [{'death': state_is('death')}, {'vanish': state_is('vanish')}]
for o in STATES:
    if o not in ('death', 'vanish'):
        crawl_trans.append({o: '%s != 2 && %s' % (P_POSE, state_is(o))})
main_states['crawling'] = {'animations': ['crawl'], 'transitions': crawl_trans, 'blend_transition': 0.35}

controllers = {
    'controller.animation.shaftbreaker.main': {'initial_state': 'dormant', 'states': main_states},
    # crouch layer: which crouch adjustment fits the current base animation
    'controller.animation.shaftbreaker.crouch': {
        'initial_state': 'off',
        'states': {
            'off': {'transitions': [{'on': '%s == 1' % P_POSE}], 'blend_transition': 0.35},
            'on': {'animations': [
                {'crouch_stalk': "(%s || %s || %s || %s || %s) ? 1.0 : 0.0" % (
                    state_is('stalk'), state_is('search'), state_is('retreat'), state_is('peek_l'), state_is('peek_r'))},
                {'crouch_run': "(%s || %s || %s || %s) ? 1.0 : 0.0" % (
                    state_is('hunt'), state_is('threat'), state_is('stagger'), state_is('break'))},
                {'crouch_full': "(%s || %s || %s || %s) ? 1.0 : 0.0" % (
                    state_is('watch'), state_is('dormant'), state_is('scream'), state_is('vanish'))}],
                'transitions': [{'off': '%s != 1' % P_POSE}], 'blend_transition': 0.35}}},
    'controller.animation.shaftbreaker.attack': {
        'initial_state': 'default',
        'states': {
            'default': {'transitions': [
                {'lunge': "query.property('shaftbreaker:attack') == 1 || query.is_delayed_attacking"},
                {'heavy': "query.property('shaftbreaker:attack') == 2"},
                {'false_lunge': "query.property('shaftbreaker:attack') == 3"}], 'blend_transition': 0.15},
            'lunge': {'animations': ['frenzy_lunge'], 'on_entry': ['variable.attacking = 1.0;'],
                      'on_exit': ['variable.attacking = 0.0;'], 'transitions': [{'default': 'query.all_animations_finished'}],
                      'blend_transition': 0.2},
            'heavy': {'animations': ['heavy_strike'], 'on_entry': ['variable.attacking = 1.0;'],
                      'on_exit': ['variable.attacking = 0.0;'], 'transitions': [{'default': 'query.all_animations_finished'}],
                      'blend_transition': 0.2},
            'false_lunge': {'animations': ['false_lunge'], 'on_entry': ['variable.attacking = 1.0;'],
                            'on_exit': ['variable.attacking = 0.0;'], 'transitions': [{'default': 'query.all_animations_finished'}],
                            'blend_transition': 0.2}}},
    'controller.animation.shaftbreaker.look': {
        'initial_state': 'look',
        'states': {
            'look': {'animations': ['look_at'], 'transitions': [{'none': "%s || %s || %s" % (
                state_is('death'), state_is('vanish'), state_is('climb'))}], 'blend_transition': 0.3},
            'none': {'transitions': [{'look': "!(%s || %s || %s)" % (state_is('death'), state_is('vanish'), state_is('climb'))}],
                     'blend_transition': 0.3}}},
    'controller.animation.shaftbreaker.tilt': {
        'initial_state': 'off',
        'states': {
            'off': {'transitions': [{'on': "query.property('shaftbreaker:tilt')"}], 'blend_transition': 0.5},
            'on': {'animations': ['head_tilt'], 'transitions': [{'off': "!query.property('shaftbreaker:tilt')"}],
                   'blend_transition': 0.8}}},
    'controller.animation.shaftbreaker.appear': {
        'initial_state': 'check',
        'states': {
            'check': {'transitions': [{'appear': "query.property('shaftbreaker:materialize')"}, {'idle': 'query.life_time > 0.25'}]},
            'appear': {'animations': ['appear'], 'transitions': [{'idle': 'query.all_animations_finished'}]},
            'idle': {'transitions': [{'appear': "query.property('shaftbreaker:materialize') && query.life_time < 0.5"}]}}},
    # phantom (illusion) uses a reduced controller: it only ever watches, peeks or vanishes
    'controller.animation.shaftbreaker.phantom': {
        'initial_state': 'watch',
        'states': {
            'watch': {'animations': [{'watch': '1.0'}, {'twitch': '1.0'}], 'transitions': [
                {'stalk': state_is('stalk')}, {'vanish': state_is('vanish')}, {'peek_l': state_is('peek_l')},
                {'peek_r': state_is('peek_r')}], 'blend_transition': 0.3},
            'stalk': {'animations': ['stalk_idle', {'jaw_chatter': '0.35'}], 'transitions': [
                {'watch': state_is('watch')}, {'vanish': state_is('vanish')}, {'peek_l': state_is('peek_l')},
                {'peek_r': state_is('peek_r')}], 'blend_transition': 0.3},
            'peek_l': {'animations': ['stalk_idle', 'peek_left'], 'transitions': [
                {'watch': state_is('watch')}, {'vanish': state_is('vanish')}, {'stalk': state_is('stalk')}],
                'blend_transition': 0.3},
            'peek_r': {'animations': ['stalk_idle', 'peek_right'], 'transitions': [
                {'watch': state_is('watch')}, {'vanish': state_is('vanish')}, {'stalk': state_is('stalk')}],
                'blend_transition': 0.3},
            'vanish': {'animations': [{'watch': '1.0'}, 'vanish'], 'blend_transition': 0.1}}},
}
os.makedirs(OUT_CTRL, exist_ok=True)
json.dump({'format_version': '1.10.0', 'animation_controllers': controllers},
          open(os.path.join(OUT_CTRL, 'shaftbreaker.animation_controllers.json'), 'w'), indent=1)
print('animations:', len(anims), 'controllers:', len(controllers))
