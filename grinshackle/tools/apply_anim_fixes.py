"""Apply minimal corrective edits to the supplied animation JSON (never re-animates). Every edit is listed in FIXLOG for the report."""
import sys, json, copy, math, os
sys.path.insert(0, os.path.dirname(__file__))
import anim_tools as T, numpy as np
P = 'animation.grinshackle_chainreaver.'
FIXLOG = []
def log(clip, what): FIXLOG.append((clip, what)); print(f'  [{clip}] {what}')

def keys_sorted(ch): return sorted(((float(k), k) for k in ch.keys()), key=lambda kv: kv[0])
def resample(ch, t):
    """linear sample of a dict channel at time t (with wrap handled by caller)"""
    ks = keys_sorted(ch); times = [k[0] for k in ks]; vals = [np.array(ch[k[1]], dtype=float) for k in ks]
    if t <= times[0]: return vals[0]
    if t >= times[-1]: return vals[-1]
    import bisect; i = bisect.bisect_right(times, t); t0, t1 = times[i-1], times[i]
    return vals[i-1] + (vals[i]-vals[i-1]) * ((t-t0)/(t1-t0) if t1 > t0 else 0)
def fmt(v): return [round(float(x), 5) for x in v]

def set_loop_hold(anims):
    for s in ['alert','twitch','lunge','chain_whip','roar','emerge','hurt','chain_snap','attack','slam','attack_crawl']:
        a = anims[P+s]
        if a.get('loop') != 'hold_on_last_frame':
            a['loop'] = 'hold_on_last_frame'; log(s, 'loop -> hold_on_last_frame (one-shot no longer snaps to the bind pose when it ends; the controller blends out on the property change)')

def fix_run(anims):
    a = anims[P+'run']; b = a['bones']
    b['hand_r']['rotation'] = [52.25, 34.7058, 26.25]
    log('run', 'hand_r static rotation [232.2, -29.7, 206.2] -> blend-safe small-angle triple [52.25, 34.71, 26.25] (the blocky hand is near-symmetric; prevents a 232-degree Euler spin during controller blends)')
    L_old = a['animation_length']; a['animation_length'] = 0.6
    log('run', f'animation_length {L_old} -> 0.6 (18 keys on a 1/30 s grid; removes the 0.015 s held frame at the seam)')
    for bone, bd in b.items():
        for chan in ('rotation','position','scale'):
            ch = bd.get(chan)
            if isinstance(ch, dict) and '0.6' not in ch:
                first = ch[keys_sorted(ch)[0][1]]; ch['0.6'] = list(first)
    log('run', 'added key 0.6 = key 0.0 on every keyed channel (seamless wrap)')
    # right leg resampled from the left leg with an exact half-cycle phase shift
    for r, l in (('thigh_r','thigh_l'),('shin_r','shin_l'),('foot_r','foot_l')):
        src = b[l]['rotation']; dst = b[r]['rotation']
        for tf, k in keys_sorted(dst):
            v = resample(src, (tf + 0.3) % 0.6); dst[k] = fmt([v[0], -v[1], -v[2]])
    log('run', 'thigh_r/shin_r/foot_r resampled from the left leg shifted by exactly 0.3 s (fixes the 24.7-degree landing pop caused by a 9-frame bake offset)')
    a['anim_time_update'] = 'query.anim_time + query.delta_time * math.clamp(query.ground_speed / 1.8, 0.75, 3.0)'
    log('run', 'anim_time_update scales playback with query.ground_speed (native stride 1.8 blocks/s) so planted feet stop skating')

def fix_walk(anims):
    a = anims[P+'walk']; b = a['bones']; L = a['animation_length']
    for l, r in (('thigh_l','thigh_r'),('shin_l','shin_r'),('foot_l','foot_r')):
        src = b[r]['rotation']; dst = b[l]['rotation']
        for tf, k in keys_sorted(dst):
            v = resample(src, (tf + L/2) % L); dst[k] = fmt([v[0], -v[1], -v[2]])
    log('walk', 'thigh_l/shin_l/foot_l resampled from the right leg shifted by exactly L/2 = 0.546 s (fixes the 16.7-degree landing pop from a 0.533 s bake offset)')
    a['anim_time_update'] = 'query.anim_time + query.delta_time * math.clamp(query.ground_speed / 0.45, 0.5, 3.0)'
    log('walk', 'anim_time_update scales playback with ground speed (native stride 0.45 blocks/s)')

def fix_stalk(anims):
    a = anims[P+'stalk']
    a['anim_time_update'] = 'query.anim_time + query.delta_time * math.clamp(query.ground_speed / 0.18, 1.0, 4.0)'
    log('stalk', 'anim_time_update scales playback with ground speed (native stride 0.18 blocks/s)')

def fix_crawl(anims):
    a = anims[P+'crawl']; b = a['bones']; L = a['animation_length']
    for k in list(b['root']['position'].keys()):
        v = b['root']['position'][k]; b['root']['position'][k] = fmt([v[0], v[1] - 0.4976, v[2]])
    log('crawl', 'root.position.y -0.4976 on every key (1.7576 -> 1.26: hands/feet no longer hover 0.11 block above the floor; knees stay above -0.5 u)')
    for arm in ('arm_r','arm_l'):
        for k in list(b[arm]['rotation'].keys()):
            v = b[arm]['rotation'][k]; b[arm]['rotation'][k] = fmt([v[0] + 4.5, v[1], v[2]])
    log('crawl', 'arm_r/arm_l rotation.x +4.5 deg on every key so the fingertips reach the floor at the bottom of each pump')
    n = 0
    for bone, bd in b.items():
        if '_chain_' not in bone: continue
        ch = bd.get('rotation')
        if not isinstance(ch, dict): continue
        first = np.array(ch[keys_sorted(ch)[0][1]], dtype=float)
        for tf, k in keys_sorted(ch):
            if 0.9 < tf <= L:
                f = (tf - 0.9) / (L - 0.9); v = np.array(ch[k], dtype=float); ch[k] = fmt(v + (first - v) * f); n += 1
    log('crawl', f'chain bones cross-faded to their first key over 0.9..1.1 s ({n} keys; loop seam 4.2 -> 0 deg)')
    a['anim_time_update'] = 'query.anim_time + query.delta_time * math.clamp(query.ground_speed / 0.41, 1.0, 3.0)'
    log('crawl', 'anim_time_update scales playback with ground speed (native 0.41 blocks/s)')

def fix_alert_twitch(anims):
    a = anims[P+'alert']; ch = a['bones']['head']['rotation']
    for tf, k in keys_sorted(ch):
        if 0.3 <= tf <= 1.4: v = ch[k]; ch[k] = fmt([v[0], v[1], v[2] * 0.6])
    log('alert', 'head roll (z) x0.6 between 0.3 and 1.4 s (jaw no longer sinks 2.5 u into the collar/shoulder during the stare hold)')
    a = anims[P+'twitch']; ch = a['bones']['head']['rotation']
    for tf, k in keys_sorted(ch):
        if 0.2 <= tf <= 0.267: v = ch[k]; ch[k] = fmt([v[0]*0.7, v[1]*0.7, v[2]*0.7])
    log('twitch', 'head spike x0.7 at 0.2-0.267 s (reduces jaw burial in the collar; the jerk stays visible)')


def envelope(points):
    """piecewise-linear w(t) from [(t, w), ...]"""
    def w(t):
        if t <= points[0][0]: return points[0][1]
        if t >= points[-1][0]: return points[-1][1]
        for (t0, w0), (t1, w1) in zip(points, points[1:]):
            if t0 <= t <= t1: return w0 + (w1 - w0) * ((t - t0) / (t1 - t0) if t1 > t0 else 0)
        return points[-1][1]
    return w

def add_offset(anim, bone, chan, offset, points=None):
    """Add offset*w(t) to a channel; creates the channel when missing; inserts keys at envelope breakpoints."""
    L = float(anim['animation_length']); b = anim['bones'].setdefault(bone, {})
    w = envelope(points) if points else (lambda t: 1.0)
    ch = b.get(chan)
    base_static = None
    if ch is None: base_static = np.zeros(3) if chan != 'scale' else np.ones(3)
    elif isinstance(ch, list): base_static = np.array(ch, dtype=float)
    if base_static is not None:
        if points is None: b[chan] = fmt(base_static + np.array(offset)); return
        ch = {}
        for t in sorted({0.0, L} | {pt[0] for pt in points}): ch[str(round(t, 4))] = fmt(base_static)
        b[chan] = ch
    # ensure keys at breakpoints
    if points:
        for t, _ in points:
            if 0 <= t <= L and not any(abs(float(k) - t) < 1e-6 for k in ch): ch[str(round(t, 4))] = fmt(resample(ch, t))
    for tf, k in keys_sorted(ch):
        v = np.array(ch[k], dtype=float); ch[k] = fmt(v + np.array(offset) * w(tf))

def zero_root_z(anim, clip):
    ch = anim['bones'].get('root', {}).get('position')
    if isinstance(ch, dict):
        for k in ch: v = ch[k]; ch[k] = fmt([v[0], v[1], 0.0])
    log(clip, 'root.position.z -> 0 on every key (removes the 1.17 u planted-foot skate during the strike; the torso lean carries the lunge)')

REST_LEGS = [('thigh_r','rotation',[-12.7,0,0]),('shin_r','rotation',[22.8,0,0]),('foot_r','rotation',[-10.1,0,0]),('thigh_l','rotation',[-10.3,0,0]),('shin_l','rotation',[22.9,0,0]),('foot_l','rotation',[-12.6,0,0]),('hips','position',[0,-1.47,0]),
             ('hand_r','rotation',[18,6,0]),('hand_l','rotation',[18,-6,0]),('chest','rotation',[9,0,0]),('neck','rotation',[-10,0,0]),('head','rotation',[-3,0,3])]

def fix_attack(anims):
    a = anims[P+'attack']; env = [(0.0,1),(0.35,0),(0.90,0),(1.35,1)]
    for bone, chan, off in REST_LEGS + [('arm_r','rotation',[-5,-8,-18]),('arm_l','rotation',[0,8,18]),('forearm_r','rotation',[-14,0,0]),('forearm_l','rotation',[-2,0,0])]:
        add_offset(a, bone, chan, off, env)
    log('attack', 'rest-pose ramp: first/last 0.35-0.45 s eased onto the battle_idle stance (legs, hips, arms, wrists, spine) so the 0.59-block fingertip pop at both blends disappears; the wind-up (0.42 s) and strike (0.60 s) are untouched')
    jaw = [(0.40,0),(0.50,1),(1.00,1),(1.20,0)]
    add_offset(a, 'neck', 'position', [0,1.0,0], jaw); add_offset(a, 'jaw', 'rotation', [-8,0,0], jaw)
    log('attack', 'neck.position.y +1.0 and jaw x -8 over 0.4-1.2 s (the open jaw no longer sinks into the chest during the 36-degree lean)')
    zero_root_z(a, 'attack')

def fix_slam(anims):
    a = anims[P+'slam']; env = [(0.0,1),(0.40,0),(1.30,0),(1.75,1)]
    for bone, chan, off in REST_LEGS + [('arm_r','rotation',[-5,-8,-18]),('arm_l','rotation',[-5,8,18]),('forearm_r','rotation',[-12,0,0]),('forearm_l','rotation',[-12,0,0])]:
        add_offset(a, bone, chan, off, env)
    log('slam', 'rest-pose ramp: first 0.40 s / last 0.45 s eased onto the battle_idle stance (removes the 0.59-block blend pop at both ends)')
    spread = [(0.30,0),(0.45,1),(0.72,1),(0.85,0)]
    add_offset(a, 'arm_r', 'rotation', [0,0,16], spread); add_offset(a, 'arm_l', 'rotation', [0,0,-16], spread)
    log('slam', 'arm_r z +16 / arm_l z -16 over 0.30-0.85 s (the raised hands pass outside the skull and horns instead of through them)')
    jaw = [(0.70,0),(0.80,1),(1.30,1),(1.50,0)]
    add_offset(a, 'neck', 'position', [0,1.0,0], jaw); add_offset(a, 'jaw', 'rotation', [-8,0,0], jaw)
    log('slam', 'neck.position.y +1.0 and jaw x -8 over 0.7-1.5 s (jaw stays out of the chest during the lean)')
    zero_root_z(a, 'slam')

def fix_crawl_pair(anims):
    for s in ('crawl','attack_crawl'):
        add_offset(anims[P+s], 'neck', 'position', [0,2.5,0])
        log(s, 'neck.position.y +2.5 (constant): head and jaw lifted out of the pitched chest in the crawl posture (applied identically to crawl and attack_crawl so their shared rest pose still matches)')
    a = anims[P+'attack_crawl']
    ch = a['bones']['root']['position']
    for k in ch: v = ch[k]; ch[k] = fmt([v[0], v[1] - 0.4976, 0.0])
    log('attack_crawl', 'root.position.y -0.4976 (matches the crawl fix so the crawl<->attack_crawl blend stays seamless) and root.position.z -> 0 (no shin skate)')
    for arm in ('arm_r','arm_l'): add_offset(a, arm, 'rotation', [4.5,0,0])
    log('attack_crawl', 'arm_r/arm_l rotation.x +4.5 (matches the crawl fix)')

EXTRA = [fix_attack, fix_slam, fix_crawl_pair]

def apply(src, dst):
    anims = json.load(open(src))
    print('applying fixes')
    set_loop_hold(anims['animations']); fix_run(anims['animations']); fix_walk(anims['animations']); fix_stalk(anims['animations']); fix_crawl(anims['animations']); fix_alert_twitch(anims['animations'])
    for fn in EXTRA: fn(anims['animations'])
    json.dump(anims, open(dst, 'w'), separators=(',', ':'))
    return anims

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    apply(src, dst)
    json.dump(FIXLOG, open(os.path.join(os.path.dirname(dst), 'fixlog.json'), 'w'), indent=1)
