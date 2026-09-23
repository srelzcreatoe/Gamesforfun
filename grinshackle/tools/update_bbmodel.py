"""Write the corrected animation keyframes back into a copy of the supplied .bbmodel (geometry, texture, groups untouched)."""
import json, sys, uuid, hashlib
src_bb, fixed_anim, dst_bb = sys.argv[1], sys.argv[2], sys.argv[3]
bb = json.load(open(src_bb))
fixed = json.load(open(fixed_anim))['animations']
groups = {g['name']: g['uuid'] for g in bb['groups']}
def det_uuid(*parts):
    h = hashlib.sha1('|'.join(map(str, parts)).encode()).hexdigest()
    return str(uuid.UUID(h[:32]))
def fmtv(v): return str(round(float(v), 5)).rstrip('0').rstrip('.') if float(v) != int(float(v)) else str(int(float(v)))
changed = 0
for anim in bb['animations']:
    name = anim['name']
    if name not in fixed: print('WARN not in fixed json:', name); continue
    f = fixed[name]
    anim['length'] = f['animation_length']
    loop = f.get('loop')
    anim['loop'] = 'loop' if loop is True else 'hold' if loop == 'hold_on_last_frame' else 'once'
    if 'anim_time_update' in f: anim['anim_time_update'] = f['anim_time_update']
    by_name = {a['name']: (k, a) for k, a in anim['animators'].items()}
    for bone, channels in f['bones'].items():
        if bone in by_name: key, animator = by_name[bone]
        else:
            key = groups.get(bone)
            if not key: print('WARN unknown bone', bone); continue
            animator = {'name': bone, 'type': 'bone', 'keyframes': []}; anim['animators'][key] = animator; by_name[bone] = (key, animator)
        keep = [kf for kf in animator['keyframes'] if kf['channel'] not in channels]
        new = []
        for chan, data in channels.items():
            if isinstance(data, list): items = [(0.0, data)]
            elif isinstance(data, dict): items = sorted(((float(t), v) for t, v in data.items()), key=lambda x: x[0])
            else: continue
            for t, v in items:
                vals = v.get('post', v.get('pre')) if isinstance(v, dict) else v
                new.append({'channel': chan, 'data_points': [{'x': fmtv(vals[0]), 'y': fmtv(vals[1]), 'z': fmtv(vals[2])}], 'time': round(t, 5),
                            'uuid': det_uuid(name, bone, chan, t), 'interpolation': 'linear'})
        animator['keyframes'] = keep + new
        changed += len(new)
json.dump(bb, open(dst_bb, 'w'), separators=(',', ':'))
print('wrote', dst_bb, 'keyframes written', changed)
