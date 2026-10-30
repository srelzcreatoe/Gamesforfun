#!/usr/bin/env python3
"""Single source of truth for Tailwail v3's server<->client contract.

Generates, from the tables below and the clips baked by tools/anim_v3.py:
  packs/TailwailRP/entity/tall_wail.entity.json            client entity
  packs/TailwailRP/entity/tailwail_echo.entity.json        hallucination client entity
  packs/TailwailRP/animation_controllers/tall_wail.animation_controllers.json
  packs/TailwailBP/scripts/core/ids.js                      ids, one-shot table, version check key
  (property block of) packs/TailwailBP/entities/tall_wail.json / tailwail_echo.json

Robustness rules (v3, after "his animations don't work" twice):
  * the body controller's DEFAULT state ("loco") needs no entity property at all: it picks
    idle / walk / gallop from q.ground_speed, so the creature breathes, twitches and runs
    even if property sync or the pre-animation script were to fail;
  * every variable is read with a `??` fallback and nothing is set in `initialize`, so a
    failed pre_animation degrades to sensible values instead of zero weights;
  * body states change on nothing but `act != N` (the server alone decides durations);
  * one-shots (attacks, scream...) are played by the script with Entity.playAnimation,
    a separate channel that needs no client-side logic at all;
  * overlays (breath, tremor, look, jaw, tail, mimic) are plain weighted animate entries.

  python3 -I tools/gen_client_v3.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("TAILWAIL_ROOT") or os.path.dirname(HERE)
sys.path.insert(0, HERE)
RP = os.path.join(ROOT, "packs", "TailwailRP")
BP = os.path.join(ROOT, "packs", "TailwailBP")
ANIM = os.path.join(RP, "animations", "tall_wail.v3.animation.json")
A = "animation.tall_wail.v3."
VERSION = "3.0.0"
# Raw text players see if the v3 resource pack is NOT active (the lang file translates it when it is).
RP_CHECK = "TAILWAIL_RESOURCE_PACK_3.0.0_IS_NOT_ACTIVE-re-apply_TAILWAIL_Resources_to_this_world"

Q = lambda p: "q.property('%s')" % p  # noqa: E731
ACT_Q = Q("tailwail:act")
SPD = "math.clamp(q.ground_speed / 1.2, 0.0, 1.0)"
RUN = "math.clamp((q.ground_speed - 3.6) / 1.6, 0.0, 1.0)"
W_IDLE = "v.w_idle ?? (1.0 - %s)" % SPD
W_WALK = "v.w_walk ?? (%s * (1.0 - %s))" % (SPD, RUN)
W_RUN = "v.w_run ?? (%s * %s)" % (SPD, RUN)
W_MOVE = "v.mv ?? %s" % SPD
W_STILL = "1.0 - (v.mv ?? %s)" % SPD

# ------------------------------------------------------------------ id tables
ACTS = [
    # id, name, animations (name or {name: weight}), blend-out seconds
    (0, "loco", [{"gallop": W_RUN}, {"walk": W_WALK}, {"idle": W_IDLE}], 0.1),
    (1, "loco_low", [{"gallop": W_RUN}, {"creep": W_WALK}, {"idle_low": W_IDLE}], 0.1),
    (2, "loco_tunnel", [{"tunnel_move": W_MOVE}, {"tunnel_idle": W_STILL}], 0.12),
    (3, "watch", ["watch"], 0.1),
    (4, "watch_low", ["watch_low"], 0.1),
    (5, "tall", ["tall"], 0.1),
    (6, "peek_l", ["peek_l"], 0.1),
    (7, "peek_r", ["peek_r"], 0.1),
    (8, "cling", ["cling"], 0.1),
    (9, "climb", ["climb"], 0.1),
    (10, "hold", ["hold"], 0.1),
    (11, "sniff", ["sniff"], 0.1),
    (12, "listen", ["listen"], 0.1),
    (13, "stunned", ["stunned"], 0.1),
    (14, "savor", ["savor"], 0.1),
    (15, "huddle", ["huddle"], 0.1),
    (16, "bash", ["bash"], 0.1),
    (17, "reach_in", ["reach_in"], 0.1),
    (18, "death", ["death"], 0.2),
    (19, "shot", [], 0.12),
    (20, "behind", ["behind"], 0.1),
    (21, "neck", ["neck"], 0.1),
    (22, "reach", ["reach"], 0.1),
]
ACT_ID = {n: i for i, n, _, _ in ACTS}
TAILS = {"free": 0, "lash": 1, "curl": 2, "rigid": 3, "tunnel": 4}
BREATH = {"none": 0, "calm": 1, "heavy": 2, "frantic": 3}
MIMICS = {"none": 0, "crouch": 1, "tilt": 2, "step": 3, "shrug": 4}
ECHO_POSES = ["reach", "watch", "watch_low", "tall", "peek_l", "peek_r", "behind", "neck", "cling", "huddle", "gallop"]
# echo poses whose clip differs from the pose name (the echo is teleported, so its gallop runs on time)
ECHO_CLIP = {"gallop": "gallop_t"}
OVERLAYS = ["breath", "tremor", "look", "look_inv", "jaw", "mimic_crouch", "mimic_tilt", "mimic_shrug", "hurt",
            "tail_free", "tail_lash", "tail_curl", "tail_rigid", "tail_tunnel"]

PROPS = {
    "tailwail:act": {"type": "int", "range": [0, 40], "default": 0, "client_sync": True},
    "tailwail:tail": {"type": "int", "range": [0, 4], "default": 0, "client_sync": True},
    "tailwail:breath": {"type": "int", "range": [0, 3], "default": 1, "client_sync": True},
    "tailwail:tremor": {"type": "int", "range": [0, 3], "default": 0, "client_sync": True},
    "tailwail:jaw": {"type": "int", "range": [0, 60], "default": 4, "client_sync": True},
    "tailwail:look_yaw": {"type": "int", "range": [-180, 180], "default": 0, "client_sync": True},
    "tailwail:look_pitch": {"type": "int", "range": [-60, 60], "default": 0, "client_sync": True},
    "tailwail:mimic": {"type": "int", "range": [0, 4], "default": 0, "client_sync": True},
    "tailwail:mimic_amt": {"type": "float", "range": [0.0, 2.0], "default": 0.0, "client_sync": True},
    "tailwail:mimic_pitch": {"type": "int", "range": [-60, 60], "default": 0, "client_sync": True},
    "tailwail:managed": {"type": "bool", "default": False, "client_sync": False},
}
ECHO_PROPS = {
    "tailwail:echo_pose": {"type": "int", "range": [0, 15], "default": 0, "client_sync": True},
}


def st(anims, trans, blend):
    d = {}
    if anims:
        d["animations"] = anims
    d["transitions"] = [{k: v} for k, v in trans]
    if blend is not None:
        d["blend_transition"] = blend
    return d


# ------------------------------------------------------------------ client entity
def pre_animation():
    death, cling, tunnel, reach_in = ACT_ID["death"], ACT_ID["cling"], ACT_ID["loco_tunnel"], ACT_ID["reach_in"]
    mim = "(v.act == %d || v.act == %d || v.act == %d)" % (ACT_ID["loco"], ACT_ID["watch"], ACT_ID["tall"])

    def smooth(var, target, k, default="0.0"):
        return "v.%s = (v.%s ?? %s) + ((%s) - (v.%s ?? %s)) * %s;" % (var, var, default, target, var, default, k)

    pre = [
        "v.dt = math.clamp(q.delta_time, 0.0, 0.1);",
        "v.k2 = math.clamp(v.dt * 2.2, 0.0, 1.0); v.k4 = math.clamp(v.dt * 4.0, 0.0, 1.0); v.k6 = math.clamp(v.dt * 6.0, 0.0, 1.0); v.k9 = math.clamp(v.dt * 9.0, 0.0, 1.0);",
        "v.act = %s;" % ACT_Q,
        # locomotion weights from the smoothed ground speed (m/s)
        smooth("gs", "math.clamp(q.ground_speed, 0.0, 14.0)", "v.k6"),
        "v.mv = math.clamp(v.gs / 1.2, 0.0, 1.0); v.run = math.clamp((v.gs - 3.6) / 1.6, 0.0, 1.0);",
        "v.w_idle = 1.0 - v.mv; v.w_walk = v.mv * (1.0 - v.run); v.w_run = v.mv * v.run; v.spd = math.clamp(v.gs / 7.0, 0.0, 1.0);",
        # overlay gates
        "v.ov = (v.act == %d) ? 0.0 : 1.0; v.inv = (v.act == %d) ? 1.0 : 0.0; v.mim = %s ? 1.0 : 0.0;" % (death, cling, mim),
        # head tracking (owl-wide yaw), smoothed
        smooth("look_y", "math.clamp(%s, -178.0, 178.0)" % Q("tailwail:look_yaw"), "math.clamp(v.dt * 7.0, 0.0, 1.0)"),
        smooth("look_x", "math.clamp(%s, -55.0, 55.0)" % Q("tailwail:look_pitch"), "math.clamp(v.dt * 7.0, 0.0, 1.0)"),
        # breathing amplitude (deg) and phase (deg) per breath level
        "v.br = %s;" % Q("tailwail:breath"),
        smooth("br_amp", "v.br == 1 ? 3.0 : (v.br == 2 ? 6.0 : (v.br == 3 ? 8.0 : 0.0))", "v.k2"),
        "v.br_ph = math.mod((v.br_ph ?? 0.0) + (v.br == 1 ? 110.0 : (v.br == 2 ? 230.0 : (v.br == 3 ? 470.0 : 60.0))) * v.dt, 360.0);",
        smooth("tremor", "%s / 3.0" % Q("tailwail:tremor"), "v.k4"),
        # jaw: target plus a wet quiver when wide open
        "v.jaw_t = math.clamp(%s, 0.0, 60.0);" % Q("tailwail:jaw"),
        smooth("jaw", "v.jaw_t + (v.jaw_t > 30.0 ? 3.0 * math.sin(q.life_time * 900.0) : 0.0)", "v.k9", "4.0"),
        # tail mode cross-fade (tunnel crawl and reach-in force the floor-solved tail)
        "v.tm = (v.act == %d || v.act == %d) ? 4 : %s;" % (tunnel, reach_in, Q("tailwail:tail")),
    ]
    for i in range(5):
        pre.append(smooth("tw%d" % i, "v.tm == %d ? 1.0 : 0.0" % i, "v.k4", "1.0" if i == 0 else "0.0"))
    pre += [
        # mimicry: copies the player's crouch / head tilt / step / shrug a second late
        "v.m = %s; v.m_amt = math.clamp(%s, 0.0, 2.0);" % (Q("tailwail:mimic"), Q("tailwail:mimic_amt")),
        smooth("mimic_crouch", "v.m == 1 ? math.min(v.m_amt, 1.6) : 0.0", "v.k2"),
        smooth("mimic_shrug", "v.m == 4 ? math.min(v.m_amt, 1.5) : 0.0", "v.k2"),
        smooth("mimic_roll", "v.m == 2 ? 26.0 * v.m_amt : 0.0", "v.k2"),
        smooth("mimic_pitch", "v.m == 2 ? math.clamp(%s, -45.0, 45.0) * math.min(v.m_amt, 1.4) : 0.0" % Q("tailwail:mimic_pitch"), "v.k2"),
    ]
    return pre


def animate_list():
    return [
        "ctrl_body",
        {"breath": "v.ov ?? 1.0"},
        {"tremor": "v.ov ?? 1.0"},
        {"look": "(v.ov ?? 1.0) * (1.0 - (v.inv ?? 0.0))"},
        {"look_inv": "v.inv ?? 0.0"},
        {"jaw": "v.ov ?? 1.0"},
        {"tail_free": "v.tw0 ?? 1.0"},
        {"tail_lash": "v.tw1 ?? 0.0"},
        {"tail_curl": "v.tw2 ?? 0.0"},
        {"tail_rigid": "v.tw3 ?? 0.0"},
        {"tail_tunnel": "v.tw4 ?? 0.0"},
        {"mimic_crouch": "v.mim ?? 0.0"},
        {"mimic_tilt": "v.mim ?? 0.0"},
        {"mimic_shrug": "v.mim ?? 0.0"},
        "ctrl_hurt",
    ]


def body_clips():
    names = set()
    for _, _, anims, _ in ACTS:
        for a in anims:
            names.add(a if isinstance(a, str) else next(iter(a)))
    return names


def client_entity(shots):
    anims = {c: A + c for c in sorted(body_clips() | set(OVERLAYS))}
    for s in shots:
        anims[s] = A + s  # not referenced by controllers; mapped so tools can resolve them by short name
    anims["ctrl_body"] = "controller.animation.tall_wail.v3_body"
    anims["ctrl_hurt"] = "controller.animation.tall_wail.v3_hurt"
    return {
        "format_version": "1.10.0",
        "minecraft:client_entity": {
            "description": {
                "identifier": "tailwail:tall_wail",
                "materials": {"default": "entity_alphatest"},
                "textures": {"default": "textures/entity/tall_wail/tall_wail"},
                "geometry": {"default": "geometry.tall_wail"},
                "render_controllers": ["controller.render.tall_wail"],
                "spawn_egg": {"texture": "tailwail_spawn_egg", "texture_index": 0},
                "scripts": {"scale": "1.5", "pre_animation": pre_animation(), "animate": animate_list()},
                "animations": anims,
            }
        },
    }


def body_controller():
    states = {}
    for aid, name, anims, blend in ACTS:
        trans = [("a%d" % o, "%s == %d" % (ACT_Q, o)) for o, _, _, _ in ACTS if o != aid]
        states["a%d" % aid] = st(list(anims), trans, blend)
    return {"initial_state": "a0", "states": states}


def hurt_controller():
    return {"initial_state": "default", "states": {
        "default": st([], [("hurt", "q.hurt_time > 0 && (v.ov ?? 1.0) > 0.5")], None),
        "hurt": st(["hurt"], [("default", "q.all_animations_finished && q.hurt_time <= 0")], 0.1)}}


def echo_entity():
    E = Q("tailwail:echo_pose")
    states = {}
    for i, name in enumerate(ECHO_POSES):
        trans = [("e%d" % j, "%s == %d" % (E, j)) for j in range(len(ECHO_POSES)) if j != i]
        states["e%d" % i] = st([ECHO_CLIP.get(name, name)], trans, 0.0)
    ctrl = {"initial_state": "e0", "states": states}
    anims = {ECHO_CLIP.get(n, n): A + ECHO_CLIP.get(n, n) for n in ECHO_POSES}
    anims.update({"tremor": A + "tremor", "jaw": A + "jaw", "tail_free": A + "tail_free",
                  "ctrl_echo": "controller.animation.tall_wail.v3_echo"})
    ce = {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": "tailwail:echo",
        "materials": {"default": "entity_alphatest"},
        "textures": {"default": "textures/entity/tall_wail/tall_wail"},
        "geometry": {"default": "geometry.tall_wail"},
        "render_controllers": ["controller.render.tall_wail"],
        "scripts": {"scale": "1.5",
                    "pre_animation": ["v.tremor = 0.8; v.spd = 0.0; v.jaw = 18.0 + 4.0 * math.sin(q.life_time * 120.0);"],
                    "animate": ["ctrl_echo", "tremor", "jaw", "tail_free"]},
        "animations": anims}}}
    return ce, ctrl


def shot_table(clips):
    import anim_v3
    out = {}
    for name in anim_v3.SHOTS:
        c = clips[A + name]
        meta = dict(anim_v3.SHOT_META.get(name, {}))
        out[name] = {"anim": A + name, "len": c["animation_length"], "partial": name in anim_v3.PARTIAL_SHOTS, **meta}
    return out


def ids_js(shots):
    import anim_v3
    lines = ["// GENERATED by tools/gen_client_v3.py - shared ids for synced entity properties and one-shot clips.", ""]
    lines.append('export const ADDON_RP_VERSION = "%s";' % VERSION)
    lines.append("// Shown raw (untranslated) when the v3 resource pack is missing; the RP lang file translates it.")
    lines.append('export const RP_CHECK_KEY = "%s";' % RP_CHECK)
    lines.append("export const ACT = Object.freeze({")
    for aid, name, _, _ in ACTS:
        lines.append("  %s: %d," % (name, aid))
    lines.append("});")
    for title, table in (("TAIL", TAILS), ("BREATH", BREATH), ("MIMIC", MIMICS)):
        lines.append("export const %s = Object.freeze({ %s });" % (title, ", ".join("%s: %d" % kv for kv in table.items())))
    lines.append("export const ECHO_POSE = Object.freeze({ %s });" % ", ".join("%s: %d" % (n, i) for i, n in enumerate(ECHO_POSES)))
    lines.append("/** Blocks between the entity origin and the ceiling while it clings upside down. */")
    lines.append("export const CLING_HEIGHT = %.2f;" % (anim_v3.CLING_H * anim_v3.PX))
    lines.append("/** One-shot clips played with Entity.playAnimation (times in seconds). */")
    lines.append("export const SHOT = Object.freeze({")
    for name, d in shots.items():
        lines.append("  %s: Object.freeze(%s)," % (name, json.dumps(d, sort_keys=True)))
    lines.append("});")
    return "\n".join(lines) + "\n"


def patch_props(path, props):
    d = json.load(open(path))
    d["minecraft:entity"]["description"]["properties"] = props
    with open(path, "w") as fh:
        json.dump(d, fh, indent=2)
        fh.write("\n")


def main():
    clips = json.load(open(ANIM))["animations"]
    shots = shot_table(clips)
    missing = [c for c in body_clips() | set(OVERLAYS) | {ECHO_CLIP.get(n, n) for n in ECHO_POSES} if A + c not in clips]
    if missing:
        raise SystemExit("clips missing from %s: %s (run tools/anim_v3.py first)" % (ANIM, missing))
    ce = client_entity(shots)
    with open(os.path.join(RP, "entity", "tall_wail.entity.json"), "w") as fh:
        json.dump(ce, fh, indent=1)
    ctrls = {
        "controller.animation.tall_wail.v3_body": body_controller(),
        "controller.animation.tall_wail.v3_hurt": hurt_controller(),
    }
    eco, ectrl = echo_entity()
    ctrls["controller.animation.tall_wail.v3_echo"] = ectrl
    with open(os.path.join(RP, "animation_controllers", "tall_wail.animation_controllers.json"), "w") as fh:
        json.dump({"format_version": "1.10.0", "animation_controllers": ctrls}, fh, indent=1)
    with open(os.path.join(RP, "entity", "tailwail_echo.entity.json"), "w") as fh:
        json.dump(eco, fh, indent=1)
    with open(os.path.join(BP, "scripts", "core", "ids.js"), "w") as fh:
        fh.write(ids_js(shots))
    patch_props(os.path.join(BP, "entities", "tall_wail.json"), PROPS)
    patch_props(os.path.join(BP, "entities", "tailwail_echo.json"), ECHO_PROPS)
    print("client v3 written: %d acts, %d one-shots, %d controllers" % (len(ACTS), len(shots), len(ctrls)))


if __name__ == "__main__":
    main()
