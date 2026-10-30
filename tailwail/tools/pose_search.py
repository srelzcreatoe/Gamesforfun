import sys, numpy as np, json, random
sys.path.insert(0,'tools')
import bedrock_model as bm
A=sys.argv[1]
geo=bm.Geometry(A+'/tall_wail.geo.json'); an=bm.load_animations(A+'/tall_wail.animation.json')
crawl=an['animation.tall_wail.crawl']
TAIL={'tail0','tail1','tail2','tail3','tail4'}
FEET=['foot_r','foot_l']+['toe_%s%d'%(s,i) for s in 'rl' for i in range(4)]
HANDS=['hand_r','hand_l']+['finger_%s%d%s'%(s,i,t) for s in 'rl' for i in range(4) for t in ('','_tip')]+['thumb_r','thumb_l','thumb_r_tip','thumb_l_tip']
LIMBS=FEET+HANDS
NONTAIL=[b for b in geo.order if b not in TAIL]
phases=[0,0.17,0.33,0.5,0.67,0.83]
bases=[bm.pose_from(an,[(crawl,1,0)],ph,{'v.crawl':ph,'q.life_time':0}) for ph in phases]
# parameter vector -> delta
names=['hips_px','hips_py','abd','chest','neck','head','leg_x','leg_z','shin','arm_x','arm_z','fore_x','fore_z','hand_x','mane_b','mane_h']
lo=np.array([-12,-10,-5,-5,-50,-40,-40,-10,0,-60,-60,-90,-60,-30,-10,-10.])
hi=np.array([4,4,40,45,10,20,20,50,90,60,45,60,55,30,30,30.])
def delta(v):
    d=dict(zip(names,v))
    return {'hips':{'position':[0,d['hips_py'],d['hips_px']],'rotation':[0,0,0]},
            'abdomen':{'rotation':[d['abd'],0,0]},'chest':{'rotation':[d['chest'],0,0]},
            'neck':{'rotation':[d['neck'],0,0]},'head':{'rotation':[d['head'],0,0]},
            'leg_r':{'rotation':[d['leg_x'],0,d['leg_z']],'position':[0,d['hips_py'],d['hips_px']]},'leg_l':{'rotation':[d['leg_x'],0,-d['leg_z']],'position':[0,d['hips_py'],d['hips_px']]},
            'shin_r':{'rotation':[d['shin'],0,0]},'shin_l':{'rotation':[d['shin'],0,0]},
            'arm_r':{'rotation':[d['arm_x'],0,d['arm_z']]},'arm_l':{'rotation':[d['arm_x'],0,-d['arm_z']]},
            'forearm_r':{'rotation':[d['fore_x'],0,d['fore_z']]},'forearm_l':{'rotation':[d['fore_x'],0,-d['fore_z']]},
            'hand_r':{'rotation':[d['hand_x'],0,0]},'hand_l':{'rotation':[d['hand_x'],0,0]},
            'mane_body':{'rotation':[d['mane_b'],0,0]},'mane_head':{'rotation':[d['mane_h'],0,0]}}
def apply(p,dl):
    q={k:{c:v.copy() for c,v in ch.items()} for k,ch in p.items()}
    for b,ch in dl.items():
        for c,v in ch.items():
            q.setdefault(b,{}); q[b][c]=q[b].get(c,np.zeros(3))+np.array(v,float)
    return q
def score(v):
    dl=delta(v); worst=0; pen=0
    for p in bases:
        q=apply(p,dl)
        pts=geo.bone_points(q,NONTAIL)
        top=max(a[:,1].max() for a in pts.values())
        minl=min(pts[b][:,1].min() for b in LIMBS if b in pts)
        # body must stay above limbs a little: chest/abdomen bottom above floor
        body_min=min(pts[b][:,1].min() for b in ['chest','abdomen','hips','head','jaw'])
        ext=top-minl
        allx=np.concatenate([a[:,0] for a in pts.values()])
        halfw=max(abs(allx.min()),abs(allx.max()))
        pen+=0.25*max(0,halfw-11)
        if ext>20.5: pen+=(ext-20.5)*4
        if body_min-minl<1.0: pen+= (1.0-(body_min-minl))*3
        worst=max(worst,ext)
    reg=0.002*np.sum((v/ (hi-lo))**2)*100
    return worst+pen+reg, worst
random.seed(3)
v=np.zeros(len(names)); best=score(v); print('start',best)
step=(hi-lo)/4
for it in range(60):
    improved=False
    for i in range(len(v)):
        for sgn in (1,-1):
            w=v.copy(); w[i]=np.clip(w[i]+sgn*step[i],lo[i],hi[i])
            s=score(w)
            if s[0]<best[0]: v,best=w,s; improved=True
    if not improved:
        step*=0.5
        if step.max()<0.3: break
pts=geo.bone_points(apply(bases[0],delta(v)),NONTAIL); allx=np.concatenate([a[:,0] for a in pts.values()]); print('halfwidth',round(max(abs(allx.min()),abs(allx.max())),1))
print('best extent px',round(best[1],2),'blocks@1.5',round(best[1]*1.5/16,3))
print(json.dumps({n:round(float(x),1) for n,x in zip(names,v)}))
from PIL import Image, ImageDraw
sys.path.insert(0,'tools')
from render_preview import render
tex=Image.open(A+'/tall_wail.png').convert('RGBA')
cells=[]
for view in ['side','front','three']:
    for p in bases[::2]:
        q=apply(p,delta(v))
        pts=geo.bone_points(q,LIMBS); minl=min(a[:,1].min() for a in pts.values())
        q=apply(q,{'root':{'position':[0,-minl,0]}})
        im=render(geo,tex,q,view,size=(200,150),ppu=3.6,origin_y=140)
        d=ImageDraw.Draw(im); d.line([(0,140-32*3.6/1.5),(200,140-32*3.6/1.5)],fill=(80,200,80))
        cells.append(im)
sheet=Image.new('RGB',(600,450))
for i,im in enumerate(cells): sheet.paste(im,((i%3)*200,(i//3)*150))
sheet.save(sys.argv[2])
