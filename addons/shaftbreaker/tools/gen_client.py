"""Generates the Shaftbreaker client entity, animation controllers, render controllers and the
shared act table used by the scripts. One source of truth -> no drift between script and client."""
import json, os, shutil, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, 'Shaftbreaker_RP')
BP = os.path.join(ROOT, 'Shaftbreaker_BP')
MODEL = os.path.join(ROOT, 'src_assets/model')
BUILD = os.path.join(ROOT, 'build')

# id, key, animation(s), kind ('full'|'overlay'|'move'), look weight
# 'move' acts blend an idle and a moving clip by movement speed.
ACTS = [
    (1, 'TWITCH', 'twitch', 'overlay', 1.0),
    (2, 'HEAD_TILT', 'head_tilt', 'overlay', 0.6),
    (3, 'PEEK_LEFT', 'peek_left', 'full', 0.6),
    (4, 'PEEK_RIGHT', 'peek_right', 'full', 0.6),
    (5, 'PEEK_BELOW', 'peek_below', 'full', 1.0),
    (6, 'FAILED_HIDE', 'failed_hide', 'full', 0.4),
    (7, 'LISTEN', 'listen', 'full', 0.0),
    (8, 'PRONE', 'prone_drop', 'full', 0.8),
    (9, 'CRAWL', ('crawl_idle', 'crawl_walk'), 'move', 0.7),
    (10, 'FREEZE_STEP', 'freeze_step', 'full', 0.0),
    (11, 'FINISH_STEP', 'finish_step', 'full', 0.5),
    (12, 'BACKWARD', ('stalk_idle', 'backward_walk'), 'move', 1.0),
    (13, 'LIMP', ('stalk_idle', 'limp'), 'move', 1.0),
    (14, 'KNEEL', 'kneel', 'full', 0.4),
    (15, 'SHOVE', 'shove', 'full', 0.0),
    (16, 'BRACE', 'brace', 'full', 0.7),
    (17, 'LUNGE', 'frenzy_lunge', 'full', 0.0),
    (18, 'CLAW_WIDE', 'claw_wide', 'full', 0.3),
    (19, 'RUPTURE', 'rupture', 'full', 0.0),
    (20, 'HEAVY', 'heavy', 'full', 0.3),
    (21, 'CEILING_HANG', 'ceiling_hang', 'full', 0.0),
    (22, 'CEILING_REACH', 'ceiling_reach', 'full', 0.0),
    (23, 'CEILING_DROP', 'ceiling_drop', 'full', 0.0),
    (24, 'SQUEEZE', 'squeeze', 'full', 0.0),
    (25, 'RECOVER', 'recover', 'full', 0.0),
    (26, 'RECOVER_MIRROR', 'recover_mirror', 'full', 0.0),
    (27, 'FAILED_LEAP', 'failed_leap', 'full', 0.0),
    (28, 'SCRAMBLE', ('crawl_idle', 'scramble'), 'move', 0.3),
    (29, 'COLLAPSE', 'collapse', 'full', 0.0),
    (30, 'VANISH', 'vanish', 'full', 0.5),
    (31, 'BREAK_STRIKE', 'break_strike', 'full', 0.2),
    (32, 'EAT', 'eat', 'full', 0.0),
    (33, 'FRENZY_HALT', 'frenzy_halt', 'full', 0.6),
    (34, 'WALL_BRACE', 'wall_brace', 'full', 0.8),
    (35, 'ROAR', 'roar', 'full', 0.0),
    (36, 'SCREAM_CUT', 'scream_cut', 'overlay', 0.8),
    (37, 'BREATH', 'breath', 'overlay', 1.0),
    (38, 'DOOR_REACH', 'door_reach', 'overlay', 1.0),
    (39, 'LAST_GLANCE', 'last_glance', 'overlay', 0.0),
    (40, 'STARE', 'stare', 'overlay', 1.0),
    (41, 'DELAYED_TURN', None, 'overlay', -1),   # look weight ramps 0 -> 1 over 3.5 s
    (42, 'CLIMB', 'climb', 'full', 0.3),
    (43, 'CLAW_RIGHT', 'claw_right', 'full', 0.3),
    (44, 'CLAW_LEFT', 'claw_left', 'full', 0.3),
    (45, 'SHOVE_RECOVER', 'finish_step', 'full', 0.5),
]
FULLISH = [a for a in ACTS if a[3] in ('full', 'move')]

PROVIDED = ['dormant', 'stalking', 'watching', 'breaker', 'frenzy']


def anim_id(n):
    return f'animation.shaftbreaker.{n}'


def build():
    os.makedirs(os.path.join(RP, 'animations'), exist_ok=True)
    os.makedirs(os.path.join(RP, 'animation_controllers'), exist_ok=True)
    os.makedirs(os.path.join(RP, 'render_controllers'), exist_ok=True)
    os.makedirs(os.path.join(RP, 'entity'), exist_ok=True)
    os.makedirs(os.path.join(RP, 'models/entity'), exist_ok=True)
    for p in PROVIDED:
        shutil.copy(os.path.join(MODEL, f'shaftbreaker.{p}.animation.json'), os.path.join(RP, f'animations/shaftbreaker.{p}.animation.json'))
    shutil.copy(os.path.join(BUILD, 'shaftbreaker.acts.animation.json'), os.path.join(RP, 'animations/shaftbreaker.acts.animation.json'))
    shutil.copy(os.path.join(MODEL, 'shaftbreaker.geo.json'), os.path.join(RP, 'models/entity/shaftbreaker.geo.json'))

    # ---- post-process walking clips: footstep events + an anim clock that never freezes
    ROBUST_TIME = "query.anim_time + query.delta_time * math.max(query.ground_speed, query.property('shaftbreaker:moving') * 2.2)"
    STEPS = {
        'animation.shaftbreaker.stalk_walk': {'0.05': 'step_soft', '1.15': 'step_soft'},
        'animation.shaftbreaker.crouch_walk': {'0.1': 'step_soft', '0.9': 'step_soft'},
        'animation.shaftbreaker.crawl_walk': {'0.0': 'step_soft', '0.9': 'step_soft'},
        'animation.shaftbreaker.backward_walk': {'0.05': 'step_soft', '1.15': 'step_soft'},
        'animation.shaftbreaker.limp': {'0.2': 'step_soft', '0.7': 'scrape', '1.2': 'step_soft'},
        'animation.shaftbreaker.scramble': {'0.0': 'step_soft', '0.6': 'step_soft', '1.2': 'step_soft', '1.8': 'step_soft'},
    }
    for f in glob.glob(os.path.join(RP, 'animations/shaftbreaker.*.animation.json')):
        d = json.load(open(f))
        for name, a in d['animations'].items():
            if a.get('anim_time_update') == 'query.modified_distance_moved':
                a['anim_time_update'] = ROBUST_TIME
            if name in STEPS:
                a['sound_effects'] = {**a.get('sound_effects', {}), **{t: {'effect': e} for t, e in STEPS[name].items()}}
        json.dump(d, open(f, 'w'), separators=(',', ':'))

    all_anims = {}
    for f in glob.glob(os.path.join(RP, 'animations/shaftbreaker.*.animation.json')):
        all_anims.update(json.load(open(f))['animations'])
    short = {k.replace('animation.shaftbreaker.', ''): k for k in all_anims}

    # ------------------------------------------------------------- molang helpers
    full_expr = ' || '.join(f'v.act == {a[0]}' for a in FULLISH)
    look_terms = []
    for a in ACTS:
        if a[4] == 1.0:
            continue
        if a[4] == -1:
            look_terms.append(f'v.act == {a[0]} ? math.clamp((q.life_time - v.act_t0) / 3.5, 0, 1)')
        else:
            look_terms.append(f'v.act == {a[0]} ? {a[4]}')
    look_expr = '1.0'
    for term in reversed(look_terms):
        look_expr = f'({term} : {look_expr})'

    pre = [
        "v.act = q.property('shaftbreaker:act');",
        "v.stance = q.property('shaftbreaker:stance');",
        "v.gait = q.property('shaftbreaker:gait');",
        f"v.full = ({full_expr}) ? 1.0 : 0.0;",
        "v.k = math.min(1.0, q.delta_time * 7.0);",
        "v.actw = v.actw + (v.full - v.actw) * v.k;",
        "v.stw = v.stw + ((v.stance > 0 ? 1.0 : 0.0) - v.stw) * math.min(1.0, q.delta_time * 5.0);",
        "v.base_weight = (1.0 - v.actw) * (1.0 - v.stw);",
        "v.stance_weight = (1.0 - v.actw) * v.stw;",
        "v.move_blend = math.clamp(math.max(q.modified_move_speed * 2.2, q.property('shaftbreaker:moving')), 0.0, 1.0);",
        f"v.look_target = {look_expr};",
        "v.look_w = v.look_w + (v.look_target - v.look_w) * math.min(1.0, q.delta_time * 4.0);",
        "v.eyes = q.property('shaftbreaker:eyes');",
    ]

    # ------------------------------------------------------------- controllers
    ctrls = {}
    ph = {
        'dormant': [('dormant', 'v.base_weight * (1.0 - v.move_blend)'), ('stalk_walk', 'v.base_weight * v.move_blend')],
        'stalking': [('stalk_idle', 'v.base_weight * (1.0 - v.move_blend)'), ('stalk_walk', 'v.base_weight * v.move_blend')],
        'watching': [('watch', 'v.base_weight * (1.0 - v.move_blend)'), ('stalk_walk', 'v.base_weight * v.move_blend')],
        'breaker': [('frenzy_idle', 'v.base_weight * (1.0 - v.move_blend)'), ('breaker_walk', 'v.base_weight * v.move_blend')],
        'frenzy': [('frenzy_idle', 'v.base_weight * (1.0 - v.move_blend)'), ('frenzy_run', 'v.base_weight * v.move_blend'),
                   ('crooked_gait', 'v.base_weight * v.move_blend * (v.gait == 1 ? 1.0 : 0.0)'),
                   ('broken_gait', 'v.base_weight * v.move_blend * (v.gait == 2 ? 1.0 : 0.0)')],
    }
    blend = {'dormant': 0.6, 'stalking': 0.4, 'watching': 0.7, 'breaker': 0.35, 'frenzy': 0.4}
    states = {}
    for st, anims in ph.items():
        states[st] = {
            'animations': [{a: w} for a, w in anims],
            'transitions': [{o: f"q.property('shaftbreaker:phase') == '{o}'"} for o in ph if o != st],
            'blend_transition': blend[st],
        }
    ctrls['controller.animation.shaftbreaker.phase'] = {'initial_state': 'dormant', 'states': states}

    ctrls['controller.animation.shaftbreaker.stance'] = {
        'initial_state': 'stand',
        'states': {
            'stand': {'transitions': [{'crouch': 'v.stance == 1'}, {'crawl': 'v.stance == 2'}], 'blend_transition': 0.3},
            'crouch': {'animations': [{'crouch_idle': 'v.stance_weight * (1.0 - v.move_blend)'}, {'crouch_walk': 'v.stance_weight * v.move_blend'}],
                       'transitions': [{'stand': 'v.stance == 0'}, {'crawl': 'v.stance == 2'}], 'blend_transition': 0.3},
            'crawl': {'animations': [{'crawl_idle': 'v.stance_weight * (1.0 - v.move_blend)'}, {'crawl_walk': 'v.stance_weight * v.move_blend'}],
                      'transitions': [{'stand': 'v.stance == 0'}, {'crouch': 'v.stance == 1'}], 'blend_transition': 0.35},
        }}

    act_states = {'none': {'transitions': [{f'a{a[0]}': f'v.act == {a[0]}'} for a in ACTS], 'blend_transition': 0.3}}
    for a in ACTS:
        aid, key, an, kind, _ = a
        if kind == 'move':
            anims = [{an[0]: 'v.actw * (1.0 - v.move_blend)'}, {an[1]: 'v.actw * v.move_blend'}]
        elif kind == 'full':
            anims = [{an: 'v.actw'}]
        else:
            anims = [an] if an else []
        st = {'on_entry': ['v.act_t0 = q.life_time;'], 'transitions': [{'none': f'v.act != {aid}'}], 'blend_transition': 0.25 if kind != 'overlay' else 0.2}
        if anims:
            st['animations'] = anims
        act_states[f'a{aid}'] = st
    ctrls['controller.animation.shaftbreaker.act'] = {'initial_state': 'none', 'states': act_states}

    ctrls['controller.animation.shaftbreaker.attack'] = {
        'initial_state': 'default',
        'states': {
            'default': {'transitions': [{'swing': 'q.is_delayed_attacking'}], 'blend_transition': 0.15},
            'swing': {
                'on_entry': ['v.swing = math.random_integer(0, 2);'],
                'animations': [{'claw_right_add': '(1.0 - v.actw) * (v.swing == 0 ? 1.0 : 0.0)'},
                               {'claw_left_add': '(1.0 - v.actw) * (v.swing == 1 ? 1.0 : 0.0)'},
                               {'claw_wide_add': '(1.0 - v.actw) * (v.swing == 2 ? 1.0 : 0.0)'}],
                'transitions': [{'default': 'q.all_animations_finished'}],
                'blend_transition': 0.15},
        }}

    json.dump({'format_version': '1.10.0', 'animation_controllers': ctrls},
              open(os.path.join(RP, 'animation_controllers/shaftbreaker.animation_controllers.json'), 'w'), indent=2)

    # ------------------------------------------------------------- client entity
    used = set()
    for st in states.values():
        for a in st['animations']:
            used |= set(a)
    for st in ctrls['controller.animation.shaftbreaker.stance']['states'].values():
        for a in st.get('animations', []):
            used |= set(a)
    for st in act_states.values():
        for a in st.get('animations', []):
            used |= set(a) if isinstance(a, dict) else {a}
    used |= {'claw_right_add', 'claw_left_add', 'claw_wide_add', 'look_at'}
    missing = [u for u in used if u not in short]
    assert not missing, missing
    animations = {u: short[u] for u in sorted(used)}
    animations.update({
        'ctrl_phase': 'controller.animation.shaftbreaker.phase',
        'ctrl_stance': 'controller.animation.shaftbreaker.stance',
        'ctrl_act': 'controller.animation.shaftbreaker.act',
        'ctrl_attack': 'controller.animation.shaftbreaker.attack',
    })
    client = {
        'format_version': '1.10.0',
        'minecraft:client_entity': {
            'description': {
                'identifier': 'shaftbreaker:shaftbreaker',
                'materials': {'default': 'entity_alphatest', 'spectral': 'entity_alphablend', 'eyes': 'entity_alphablend'},
                'textures': {
                    'default': 'textures/entity/shaftbreaker/shaftbreaker',
                    'spectral': 'textures/entity/shaftbreaker/shaftbreaker_spectral',
                    'eyes': 'textures/entity/shaftbreaker/shaftbreaker_eyes',
                },
                'geometry': {'default': 'geometry.shaftbreaker'},
                'scripts': {
                    'scale': '0.58',
                    'initialize': ['v.actw = 0.0;', 'v.stw = 0.0;', 'v.look_w = 1.0;', 'v.act_t0 = 0.0;', 'v.swing = 0.0;'],
                    'pre_animation': pre,
                    'animate': ['ctrl_phase', 'ctrl_stance', 'ctrl_act', 'ctrl_attack', {'look_at': 'v.look_w'}],
                    'should_update_bones_and_effects_offscreen': '1.0',
                },
                'animations': animations,
                'render_controllers': ['controller.render.shaftbreaker', 'controller.render.shaftbreaker_eyes'],
                'spawn_egg': {'base_color': '#3b3230', 'overlay_color': '#e8d7b0'},
                'sound_effects': {
                    'step': 'shaftbreaker.step', 'step_soft': 'shaftbreaker.step_soft', 'scrape': 'shaftbreaker.scrape', 'smash': 'shaftbreaker.smash',
                    'screech': 'shaftbreaker.screech', 'swing': 'shaftbreaker.swing', 'growl': 'shaftbreaker.growl',
                    'death': 'shaftbreaker.collapse', 'chew': 'shaftbreaker.chew', 'roar': 'shaftbreaker.roar',
                },
                'particle_effects': {'debris': 'shaftbreaker:debris', 'step_dust': 'shaftbreaker:step_dust'},
                'enable_attachables': False,
            }
        }
    }
    json.dump(client, open(os.path.join(RP, 'entity/shaftbreaker.entity.json'), 'w'), indent=2)

    rc = {
        'format_version': '1.10.0',
        'render_controllers': {
            'controller.render.shaftbreaker': {
                'arrays': {
                    'textures': {'Array.skins': ['Texture.default', 'Texture.spectral']},
                    'materials': {'Array.mats': ['Material.default', 'Material.spectral']},
                },
                'geometry': 'Geometry.default',
                'textures': ["Array.skins[q.property('shaftbreaker:spectral') ? 1 : 0]"],
                'materials': [{'*': "Array.mats[q.property('shaftbreaker:spectral') ? 1 : 0]"}],
                'part_visibility': [{'*': '!q.is_invisible'}],
            },
            'controller.render.shaftbreaker_eyes': {
                'geometry': 'Geometry.default',
                'textures': ['Texture.eyes'],
                'materials': [{'*': 'Material.eyes'}],
                'ignore_lighting': True,
                'color': {'r': 1.0, 'g': 1.0, 'b': 1.0, 'a': "math.clamp(q.property('shaftbreaker:eyes') * (q.property('shaftbreaker:spectral') ? 0.6 : 1.0), 0.0, 1.0)"},
                'part_visibility': [{'*': False}, {'head': True}],
            },
        }
    }
    json.dump(rc, open(os.path.join(RP, 'render_controllers/shaftbreaker.render_controllers.json'), 'w'), indent=2)

    # ------------------------------------------------------------- shared act table for scripts
    os.makedirs(os.path.join(BP, 'scripts/generated'), exist_ok=True)
    lines = ['// AUTO-GENERATED by tools/gen_client.py - do not edit by hand.', 'export const ACT = Object.freeze({', '  NONE: 0,']
    for a in ACTS:
        lines.append(f'  {a[1]}: {a[0]},')
    lines.append('});')
    durations = {}
    for a in ACTS:
        an = a[2]
        if isinstance(an, str) and an in short:
            L = all_anims[short[an]].get('animation_length', 0)
            if all_anims[short[an]].get('loop') is not True:
                durations[a[1]] = round(L, 3)
    lines.append('/** one-shot act durations in seconds (looping acts omitted) */')
    lines.append('export const ACT_SECONDS = Object.freeze(' + json.dumps(durations) + ');')
    open(os.path.join(BP, 'scripts/generated/acts.js'), 'w').write('\n'.join(lines) + '\n')
    print('client entity written; animations:', len(animations), 'act states:', len(act_states))


if __name__ == '__main__':
    build()
