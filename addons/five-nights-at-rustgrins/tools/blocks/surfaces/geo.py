"""Tiny Bedrock block-geometry builder with an automatic UV atlas packer.

A model is a list of bones; each cube lists the faces to render with a
"style" (what to paint) and optionally a material instance name. The packer
gives every distinct (style, w, h, kind) face its own atlas region (identical
faces share one), so the painter can draw pixel-exact 1 texel = 1 model px art.
"""
import json
import os

from pixlib import ROOT

MODELS_DIR = os.path.join(ROOT, 'packs', 'RP', 'models', 'blocks')
FACES = ('north', 'south', 'east', 'west', 'up', 'down')


def face_size(size, face):
    sx, sy, sz = size
    return {'north': (sx, sy), 'south': (sx, sy), 'east': (sz, sy), 'west': (sz, sy),
            'up': (sx, sz), 'down': (sx, sz)}[face]


def kind_of(face):
    return {'north': 'front', 'south': 'back', 'east': 'side', 'west': 'side', 'up': 'top', 'down': 'bottom'}[face]


class Model:
    def __init__(self, name, tex_w=32, tex_h=32):
        self.name = name
        self.tw, self.th = tex_w, tex_h
        self.bones = []
        self.regions = {}  # key -> (u, v, w, h)
        self._shelf = [0, 0, 0]  # x, y, row height
        self.fixed = {}

    def bone(self, name, pivot=(0, 0, 0), rotation=None, parent=None):
        b = {'name': name, 'pivot': list(pivot), 'cubes': []}
        if rotation:
            b['rotation'] = list(rotation)
        if parent:
            b['parent'] = parent
        self.bones.append(b)
        return b

    def region(self, key, w, h):
        if key in self.regions:
            return self.regions[key]
        if key in self.fixed:
            self.regions[key] = self.fixed[key]
            return self.fixed[key]
        x, y, rh = self._shelf
        if x + w > self.tw:
            x, y, rh = 0, y + rh, 0
        if y + h > self.th:
            raise ValueError(f'{self.name}: atlas full placing {key}')
        self.regions[key] = (x, y, w, h)
        self._shelf = [x + w, y, max(rh, h)]
        return self.regions[key]

    def cube(self, bone, origin, size, faces, inflate=None):
        """faces: {face: style or (style, material_instance)}; '*' sets all six."""
        if '*' in faces:
            default = faces['*']
            faces = {**{f: default for f in FACES}, **{k: v for k, v in faces.items() if k != '*'}}
        uv = {}
        for f in FACES:
            spec = faces.get(f)
            if spec is None:
                continue
            style, inst = (spec if isinstance(spec, tuple) else (spec, None))
            w, h = face_size(size, f)
            w, h = max(1, int(round(w))), max(1, int(round(h)))
            u, v, _, _ = self.region((style, w, h), w, h)
            e = {'uv': [u, v], 'uv_size': [w, h]}
            if inst:
                e['material_instance'] = inst
            uv[f] = e
        c = {'origin': list(origin), 'size': list(size), 'uv': uv}
        if inflate:
            c['inflate'] = inflate
        bone['cubes'].append(c)
        return c

    def to_json(self):
        return {
            'format_version': '1.12.0',
            'minecraft:geometry': [{
                'description': {
                    'identifier': f'geometry.fnar.{self.name}',
                    'texture_width': self.tw, 'texture_height': self.th,
                    'visible_bounds_width': 2, 'visible_bounds_height': 2, 'visible_bounds_offset': [0, 0.5, 0],
                },
                'bones': self.bones,
            }],
        }

    def save(self):
        os.makedirs(MODELS_DIR, exist_ok=True)
        p = os.path.join(MODELS_DIR, f'{self.name}.geo.json')
        with open(p, 'w') as f:
            json.dump(self.to_json(), f, indent=2)
            f.write('\n')
        return p
