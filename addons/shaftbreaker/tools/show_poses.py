import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from animkit import *
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
poses = json.load(open(sys.argv[1]))
names = sys.argv[3].split(',') if len(sys.argv) > 3 else list(poses)
anims = {f'animation.p.{n}': build_anim([(0, poses[n])], 1, True, 'linear') for n in names}
json.dump({'format_version': '1.8.0', 'animations': anims}, open(S + '/poses_tmp.animation.json', 'w'))
frames = []
for n in names:
    for yaw in (0, 70, 140):
        frames.append({"label": f"{n} yaw{yaw}", "anims": [{"name": f'animation.p.{n}', "time": 0}], "camera": {"yaw": yaw, "pitch": 12, "dist": 200, "target": [0, 25, 0]}})
job = {"geo": S + "/src_assets/model/shaftbreaker.geo.json", "texture": S + "/src_assets/model/shaftbreaker.png", "animations": [S + '/poses_tmp.animation.json'],
       "out": sys.argv[2], "cols": 3, "cellW": 320, "cellH": 260, "frames": frames}
json.dump(job, open(S + '/job_poses.json', 'w'))
