"""Validate the generated packs against Mojang's official JSON schemas (github.com/Mojang/bedrock-schemas).

Usage: python3 schema_check.py <path to a bedrock-schemas checkout> <pack root with resource_pack/ and behavior_pack/>

The schemas are draft-07 with relative $refs; every schema file is given its own file URI as $id so the
references resolve on disk. Each pack file is matched to a schema by its folder, the way the schema
catalog does, except that resource-pack biome files use the client-biome schema.
"""
import glob
import json
import os
import sys

import jsonschema
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT7

SCHEMAS, ROOT = sys.argv[1], sys.argv[2]


def load_schema(path):
    with open(path) as f:
        d = json.load(f)
    d['$id'] = 'file://' + os.path.abspath(path)
    return d


def retrieve(uri):
    return Resource.from_contents(load_schema(uri[len('file://'):]), default_specification=DRAFT7)


REGISTRY = Registry(retrieve=retrieve)
S = lambda rel: os.path.join(SCHEMAS, 'schemas', rel)
TARGETS = [
    ('behavior_pack/biomes', S('bp/biomes/index.schema.json')),
    ('behavior_pack/blocks', S('bp/blocks/index.schema.json')),
    ('behavior_pack/features', S('bp/features/index.schema.json')),
    ('behavior_pack/feature_rules', S('bp/feature_rules/index.schema.json')),
    ('behavior_pack/spawn_rules', S('bp/spawn_rules/index.schema.json')),
    ('behavior_pack/entities', S('bp/entities/index.schema.json')),
    ('resource_pack/biomes', S('rp/biomes_client/index.schema.json')),
    ('resource_pack/fogs', S('rp/fogs/index.schema.json')),
    ('resource_pack/sounds', S('rp/sounds/index.schema.json')),
    ('resource_pack/textures/terrain_texture.json', S('rp/textures/terrain_texture.schema.json')),
    ('resource_pack/entity', S('rp/entity/index.schema.json')),
    ('resource_pack/render_controllers', S('rp/render_controllers/index.schema.json')),
    ('resource_pack/models', S('rp/models/index.schema.json')),
    ('resource_pack/particles', S('rp/particles/index.schema.json')),
    ('resource_pack/animation_controllers', S('rp/animation_controllers/index.schema.json')),
    ('resource_pack/animations', S('rp/animations/index.schema.json')),
]

total, bad = 0, 0
for rel, schema_path in TARGETS:
    base = os.path.join(ROOT, rel)
    files = [base] if base.endswith('.json') else sorted(glob.glob(os.path.join(base, '**', '*.json'), recursive=True))
    if not files or not os.path.exists(schema_path):
        continue
    validator = jsonschema.Draft7Validator(load_schema(schema_path), registry=REGISTRY)
    for f in files:
        total += 1
        with open(f) as fh:
            inst = json.load(fh)
        errs = sorted(validator.iter_errors(inst), key=lambda e: list(e.absolute_path))
        if errs:
            bad += 1
            print(f'{os.path.relpath(f, ROOT)}:')
            for e in errs[:8]:
                where = '/'.join(str(p) for p in e.absolute_path) or '(root)'
                print(f'    {where}: {e.message[:220]}')
print(f'{total} files checked against Mojang schemas, {bad} with problems')
sys.exit(1 if bad else 0)
