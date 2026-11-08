import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from animkit import *
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rig = Rig(S + '/src_assets/model/shaftbreaker.geo.json')
acts = json.load(open(S + '/build/shaftbreaker.acts.animation.json'))
names = sys.argv[1].split(',')
out = sys.argv[2]
yaw = float(sys.argv[3]) if len(sys.argv) > 3 else 60
frames = []
for n in names:
    full = 'animation.shaftbreaker.' + n
    a = acts['animations'][full]; L = a['animation_length']
    ts = [0, L * 0.33, L * 0.66, L] if L > 0.1 else [0]
    for t in ts:
        p = from_anim(acts, full, t)
        mn, mx = rig.extent(p)
        frames.append({"label": f"{n} t={t:.2f} y[{mn[1]:.0f},{mx[1]:.0f}] {mx[1]*0.58/16:.2f}b", "anims": [{"name": full, "time": t}], "camera": {"yaw": yaw}})
job = {"geo": S + "/src_assets/model/shaftbreaker.geo.json", "texture": S + "/src_assets/model/shaftbreaker.png", "animations": [S + '/build/shaftbreaker.acts.animation.json'],
       "out": out, "cols": 4, "cellW": 300, "cellH": 340, "frames": frames}
json.dump(job, open(S + '/job_review.json', 'w'))
