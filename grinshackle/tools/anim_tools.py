"""Bedrock geometry/animation toolkit: forward kinematics, metrics, software renderer.

Conventions (documented in compatibility_report.md):
  * Model units: 16 units = 1 block. Y up. The face of this model (eyes, teeth, pupils) sits on the -Z side,
    so model-space FORWARD is -Z (Bedrock's standard: north face = front).
  * Bedrock/Blockbench Euler rotation, evaluated as Rz * Ry * Rx (X applied first) with the sign
    convention that positive X pitches the front DOWN.  We render the file coordinates un-mirrored,
    which is the mirror image of the Blockbench viewport; forward/back and up/down are identical.
  * Animation rotation keys ADD to the bone's base rotation (component-wise Euler), position keys translate
    the pivot in the parent's frame, scale keys scale about the pivot.  Keys are linearly interpolated.
"""
import json, math, bisect
import numpy as np

UNIT = 16.0

def load_geo(path):
    g = json.load(open(path))['minecraft:geometry'][0]
    bones = {}
    order = []
    for b in g['bones']:
        bones[b['name']] = b
        order.append(b['name'])
    return {'desc': g['description'], 'bones': bones, 'order': order}

def load_anims(path):
    return json.load(open(path))['animations']

def rot_matrix(x, y, z):
    """x,y,z in degrees, Bedrock file convention. Returns 3x3 for our un-mirrored frame."""
    ax, ay, az = math.radians(-x), math.radians(y), math.radians(-z)
    cx, sx = math.cos(ax), math.sin(ax); cy, sy = math.cos(ay), math.sin(ay); cz, sz = math.cos(az), math.sin(az)
    Rx = np.array([[1,0,0],[0,cx,-sx],[0,sx,cx]])
    Ry = np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]])
    Rz = np.array([[cz,-sz,0],[sz,cz,0],[0,0,1]])
    return Rz @ Ry @ Rx

def _sample_channel(ch, t):
    """ch: list (static) or dict time->value. Linear interpolation, clamped."""
    if ch is None: return None
    if isinstance(ch, list): return np.array(ch, dtype=float)
    if isinstance(ch, (int, float)): return np.array([ch, ch, ch], dtype=float)
    keys = ch.get('_sorted')
    if keys is None:
        ks = sorted((float(k), k) for k in ch.keys())
        keys = ch['_sorted'] = ([k[0] for k in ks], [ch[k[1]] for k in ks])
    times, vals = keys
    if t <= times[0]: return np.array(_val(vals[0]), dtype=float)
    if t >= times[-1]: return np.array(_val(vals[-1]), dtype=float)
    i = bisect.bisect_right(times, t)
    t0, t1 = times[i-1], times[i]
    v0, v1 = np.array(_val(vals[i-1]), dtype=float), np.array(_val(vals[i]), dtype=float)
    f = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
    return v0 + (v1 - v0) * f

def _val(v):
    if isinstance(v, dict):
        return v.get('post', v.get('pre'))
    if isinstance(v, (int, float)): return [v, v, v]
    return v

def anim_time(anim, t):
    L = float(anim.get('animation_length', 0) or 0)
    loop = anim.get('loop')
    if L <= 0: return t
    if loop is True and t > L: return t % L
    if loop == 'hold_on_last_frame' or loop is False or loop is None:
        return min(t, L)
    return t

def pose(geo, anims, anim_names, t, extra_rot=None):
    """Return dict bone -> (4x4 world matrix). anim_names: list of animation dicts or names layered additively."""
    layers = []
    for a in anim_names:
        anim = anims[a] if isinstance(a, str) else a
        layers.append((anim, anim_time(anim, t)))
    mats = {}
    for name in geo['order']:
        b = geo['bones'][name]
        piv = np.array(b.get('pivot', [0,0,0]), dtype=float)
        rot = np.array(b.get('rotation', [0,0,0]), dtype=float)
        pos = np.zeros(3); scale = np.ones(3)
        for anim, at in layers:
            bd = anim.get('bones', {}).get(name)
            if not bd: continue
            r = _sample_channel(bd.get('rotation'), at)
            if r is not None: rot = rot + r
            p = _sample_channel(bd.get('position'), at)
            if p is not None: pos = pos + p
            s = _sample_channel(bd.get('scale'), at)
            if s is not None: scale = scale * s
        if extra_rot and name in extra_rot:
            rot = rot + np.array(extra_rot[name], dtype=float)
        R = rot_matrix(*rot)
        M = np.eye(4)
        M[:3,:3] = R * scale[None, :]
        M[:3,3] = piv + pos - (R * scale[None, :]) @ piv
        parent = b.get('parent')
        mats[name] = (mats[parent] @ M) if parent in mats else M
    return mats

def cube_corners(cube):
    o = np.array(cube['origin'], dtype=float); s = np.array(cube['size'], dtype=float)
    inf = float(cube.get('inflate', 0) or 0)
    lo, hi = o - inf, o + s + inf
    corners = np.array([[x,y,z] for x in (lo[0],hi[0]) for y in (lo[1],hi[1]) for z in (lo[2],hi[2])])
    if cube.get('rotation'):
        p = np.array(cube.get('pivot', [0,0,0]), dtype=float)
        R = rot_matrix(*cube['rotation'])
        corners = (corners - p) @ R.T + p
    return corners

def world_cubes(geo, mats):
    """Yield (bone, cube, corners_world[8x3])."""
    for name in geo['order']:
        b = geo['bones'][name]
        M = mats[name]
        for c in b.get('cubes', []):
            cs = cube_corners(c)
            w = cs @ M[:3,:3].T + M[:3,3]
            yield name, c, w

def bounds(geo, mats, bones=None):
    lo = np.array([1e9]*3); hi = np.array([-1e9]*3)
    for name, c, w in world_cubes(geo, mats):
        if bones and name not in bones: continue
        lo = np.minimum(lo, w.min(axis=0)); hi = np.maximum(hi, w.max(axis=0))
    return lo, hi

def pivot_world(mats, bone, geo):
    piv = np.array(geo['bones'][bone].get('pivot',[0,0,0]), dtype=float)
    M = mats[bone]
    return M[:3,:3] @ piv + M[:3,3]

def descendants(geo, bone):
    out = []
    for n in geo['order']:
        p = n
        while p is not None:
            p = geo['bones'][p].get('parent')
            if p == bone: out.append(n); break
    return out

# ---------------- rendering -----------------
FACES = {  # face -> (corner indices in cube_corners order [x][y][z] -> idx = x*4+y*2+z), outward normal
    'north': ([0,2,6,4], (0,0,-1)),  # z lo: corners with z=lo: (x,y) combos
    'south': ([1,5,7,3], (0,0,1)),
    'west':  ([0,1,3,2], (-1,0,0)),
    'east':  ([4,6,7,5], (1,0,0)),
    'up':    ([2,3,7,6], (0,1,0)),
    'down':  ([0,4,5,1], (0,-1,0)),
}

def face_uv_rect(cube, face, tw, th):
    uv = cube.get('uv')
    s = cube['size']
    if isinstance(uv, dict):
        f = uv.get(face)
        if not f: return None
        u, v = f['uv']; us, vs = f.get('uv_size', [s[0], s[1]])
        return (u, v, us, vs)
    # box uv
    u0, v0 = uv if uv else (0, 0)
    w, h, d = s
    if face == 'up': return (u0+d, v0, w, d)
    if face == 'down': return (u0+d+w, v0, w, -d)
    if face == 'west': return (u0, v0+d, d, h)
    if face == 'north': return (u0+d, v0+d, w, h)
    if face == 'east': return (u0+d+w, v0+d, d, h)
    if face == 'south': return (u0+2*d+w, v0+d, w, h)
    return None

def face_color(tex, rect):
    """Average colour of a uv rect (numpy tex HxWx4)."""
    if rect is None: return (120,120,120,255)
    u, v, us, vs = rect
    x0, x1 = sorted((int(math.floor(u)), int(math.ceil(u+us))))
    y0, y1 = sorted((int(math.floor(v)), int(math.ceil(v+vs))))
    x0 = max(0, x0); y0 = max(0, y0); x1 = min(tex.shape[1], max(x1, x0+1)); y1 = min(tex.shape[0], max(y1, y0+1))
    patch = tex[y0:y1, x0:x1]
    if patch.size == 0: return (120,120,120,255)
    a = patch[..., 3]
    if a.max() == 0: return None
    m = a > 0
    c = patch[m][:, :3].mean(axis=0)
    return (int(c[0]), int(c[1]), int(c[2]), 255)

def render(geo, mats, tex, view='front', size=(400, 520), scale=None, floor=True, light=(0.4, 0.8, -0.5), bg=(28,30,36), texel_split=True):
    """Orthographic painter renderer. view: 'front' (camera at -Z looking +Z, sees face), 'side' (camera at +X), 'back', 'iso'."""
    from PIL import Image, ImageDraw
    if view == 'front':   cam = np.array([0, 0.25, -1.0])
    elif view == 'back':  cam = np.array([0, 0.25, 1.0])
    elif view == 'side':  cam = np.array([1.0, 0.25, 0])
    elif view == 'left':  cam = np.array([-1.0, 0.25, 0])
    elif view == 'iso':   cam = np.array([0.8, 0.55, -0.9])
    elif view == 'top':   cam = np.array([0.01, 1.0, -0.01])
    elif view == 'iso_back': cam = np.array([-0.8, 0.55, 0.9])
    else: cam = np.array(view, dtype=float)
    cam = cam / np.linalg.norm(cam)
    up = np.array([0,1,0.0])
    right = np.cross(up, cam); right /= np.linalg.norm(right)
    cup = np.cross(cam, right)
    W, H = size
    if scale is None: scale = H / 56.0
    img = Image.new('RGBA', size, bg + (255,))
    d = ImageDraw.Draw(img)
    cx, cy = W/2, H - 24
    def proj(p):
        return (cx + np.dot(p, right)*scale, cy - np.dot(p, cup)*scale)
    if floor:
        d.line([(0, cy), (W, cy)], fill=(50,52,60,255), width=1)
    quads = []
    L = np.array(light, dtype=float); L /= np.linalg.norm(L)
    tw, th = tex.shape[1], tex.shape[0]
    for bone, cube, w in world_cubes(geo, mats):
        M = None
        for face, (idx, nrm) in FACES.items():
            pts = w[idx]
            # normal in world
            e1, e2 = pts[1]-pts[0], pts[3]-pts[0]
            n = np.cross(e1, e2)
            ln = np.linalg.norm(n)
            if ln < 1e-9: continue
            n /= ln
            if np.dot(n, cam) <= 0.0: continue  # backface
            rect = face_uv_rect(cube, face, tw, th)
            shade = 0.55 + 0.45 * max(0.0, np.dot(n, L))
            depth = float(np.dot(pts.mean(axis=0), cam))
            if texel_split and rect is not None and abs(rect[2]) >= 1.5 and abs(rect[3]) >= 1.5:
                u, v, us, vs = rect
                nu = max(1, min(12, int(round(abs(us))))); nv = max(1, min(12, int(round(abs(vs)))))
                for i in range(nu):
                    for j in range(nv):
                        sub = (u + us*i/nu, v + vs*j/nv, us/nu, vs/nv)
                        col = face_color(tex, sub)
                        if col is None: continue
                        # bilinear corners of sub-quad in 3D: quad corners p0..p3 in uv order
                        # face corner order [idx]: we map (i,j) grid along e1 (u) and e2 (v)
                        a = i/nu; b = j/nv; a2 = (i+1)/nu; b2 = (j+1)/nv
                        P = lambda s_, t_: pts[0] + (pts[1]-pts[0])*s_ + (pts[3]-pts[0])*t_
                        q = [P(a,b), P(a2,b), P(a2,b2), P(a,b2)]
                        depth_q = float(np.dot(sum(q)/4, cam))
                        quads.append((depth_q, [proj(p) for p in q], tuple(int(c*shade) for c in col[:3])))
            else:
                col = face_color(tex, rect)
                if col is None: continue
                quads.append((depth, [proj(p) for p in pts], tuple(int(c*shade) for c in col[:3])))
    quads.sort(key=lambda q: q[0])
    for depth, poly, col in quads:
        d.polygon(poly, fill=col + (255,))
    return img

def load_texture(path):
    from PIL import Image
    im = Image.open(path).convert('RGBA')
    return np.array(im)

def contact_sheet(frames, labels=None, cols=None, pad=6, bg=(20,22,26)):
    from PIL import Image, ImageDraw
    n = len(frames)
    cols = cols or n
    rows = (n + cols - 1) // cols
    w, h = frames[0].size
    sheet = Image.new('RGBA', (cols*(w+pad)+pad, rows*(h+pad+16)+pad), bg+(255,))
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(frames):
        r, c = divmod(i, cols)
        x, y = pad + c*(w+pad), pad + r*(h+pad+16)
        sheet.paste(f, (x, y+16))
        if labels: d.text((x+4, y+2), labels[i], fill=(230,230,230,255))
    return sheet
