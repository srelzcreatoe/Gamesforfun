#!/usr/bin/env python3
"""Single source of truth for Tailwail v2's server<->client contract.

Generates, from the tables below:
  packs/TailwailRP/entity/tall_wail.entity.json            client entity (Molang, animation map)
  packs/TailwailRP/entity/tailwail_echo.entity.json        hallucination client entity
  packs/TailwailRP/animation_controllers/tall_wail.animation_controllers.json
  packs/TailwailBP/scripts/core/ids.js                      numeric ids shared with the scripts
  (property block of) packs/TailwailBP/entities/tall_wail.json / tailwail_echo.json

Design rules that keep the client robust:
  * every synced property is an INT (no string comparisons anywhere);
  * the body controller is a hub: each state exits on nothing but `pose != N`, so the
    server alone decides durations and nothing waits for "animation finished";
  * always-on overlay controllers (breath, tremor, look, jaw, tail, mimic, hurt) have a
    single state each, so they cannot get stuck either.

  python3 -I tools/gen_client_v2.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "packs", "TailwailRP")
BP = os.path.join(ROOT, "packs", "TailwailBP")
A = "animation.tall_wail."

# ------------------------------------------------------------------ id tables
POSES = [
    # id, name, clips (str or {clip: weight-molang}), blend seconds
    (0, "loco", None, 0.3),
    (1, "watch_low", ["tw2_watch_low"], 0.35),
    (2, "tilt", ["tw2_tilt"], 0.3),
    (3, "owl", ["tw2_owl"], 0.15),
    (4, "neck", ["tw2_neck"], 0.3),
    (5, "unhinge", ["tw2_unhinge"], 0.2),
    (6, "statue_reach", ["tw2_statue_reach"], 0.12),
    (7, "statue_arms_up", ["tw2_statue_arms_up"], 0.12),
    (8, "statue_cover", ["tw2_statue_cover"], 0.12),
    (9, "statue_bow", ["tw2_statue_bow"], 0.12),
    (10, "statue_sideways", ["tw2_statue_sideways"], 0.12),
    (11, "peek_r", ["tw2_peek_r"], 0.25),
    (12, "peek_l", ["tw2_peek_l"], 0.25),
    (13, "unfold", ["reveal", {"tw_unfold_full": "q.property('tailwail:headroom') >= 7"},
                    {"tw_unfold_mid": "q.property('tailwail:headroom') < 7"}], 0.3),
    (14, "unfold_low", ["planted", "gfix_planted", "tw_unfold_low"], 0.3),
    (15, "windup", ["windup", "gfix_windup"], 0.25),
    (16, "windup_c", ["windup_c", "gfix_windup_c"], 0.25),
    (17, "scream", ["tw2_scream"], 0.15),
    (18, "strike", ["tw_strike", "gfix_tw_strike"], 0.12),
    (19, "grab", ["tw2_grab"], 0.1),
    (20, "hold", ["tw2_hold"], 0.15),
    (21, "throw", ["tw2_throw"], 0.1),
    (22, "sniff", ["tw2_sniff"], 0.35),
    (23, "frustrated", ["tw2_frustrated"], 0.2),
    (24, "behind", ["tw2_behind"], 0.08),
    (25, "stuck", ["stuck", "gfix_stuck"], 0.25),
    (26, "death", ["death", "gfix_death"], 0.2),
    (27, "death_low", ["death_low", "gfix_death_low"], 0.2),
]
POSTURES = {"tall": 0, "hunch": 1, "crawl": 2}
TAILS = {"drag": 0, "twitch": 1, "rigid": 2, "free": 3, "curl": 4}
BREATH = {"none": 0, "calm": 1, "heavy": 2, "frantic": 3}
MIMICS = {"none": 0, "crouch": 1, "tilt": 2, "step": 3, "shrug": 4}
ECHO_POSES = ["statue_reach", "statue_arms_up", "statue_cover", "statue_bow", "statue_sideways", "behind", "watch_low",
              "neck", "peek_l", "peek_r"]

PROPS = {
    "tailwail:pose": {"type": "int", "range": [0, 40], "default": 0, "client_sync": True},
    "tailwail:posture": {"type": "int", "range": [0, 2], "default": 0, "client_sync": True},
    "tailwail:tail": {"type": "int", "range": [0, 4], "default": 0, "client_sync": True},
    "tailwail:breath": {"type": "int", "range": [0, 3], "default": 1, "client_sync": True},
    "tailwail:tremor": {"type": "int", "range": [0, 3], "default": 0, "client_sync": True},
    "tailwail:jaw": {"type": "int", "range": [0, 60], "default": 2, "client_sync": True},
    "tailwail:look_yaw": {"type": "int", "range": [-180, 180], "default": 0, "client_sync": True},
    "tailwail:look_pitch": {"type": "int", "range": [-60, 60], "default": 0, "client_sync": True},
    "tailwail:mimic": {"type": "int", "range": [0, 4], "default": 0, "client_sync": True},
    "tailwail:mimic_amt": {"type": "float", "range": [0.0, 2.0], "default": 0.0, "client_sync": True},
    "tailwail:mimic_pitch": {"type": "int", "range": [-60, 60], "default": 0, "client_sync": True},
    "tailwail:headroom": {"type": "int", "range": [0, 8], "default": 8, "client_sync": True},
    "tailwail:fx": {"type": "int", "range": [0, 2], "default": 2, "client_sync": True},
    "tailwail:managed": {"type": "bool", "default": False, "client_sync": False},
}
ECHO_PROPS = {
    "tailwail:echo_pose": {"type": "int", "range": [0, 10], "default": 0, "client_sync": True},
}

Q = lambda p: "q.property('%s')" % p  # noqa: E731
POSE = Q("tailwail:pose")


def st(anims, trans, blend):
    d = {"animations": anims, "transitions": [{k: v} for k, v in trans]}
    if blend is not None:
        d["blend_transition"] = blend
    return d


# ------------------------------------------------------------------ client entity
def client_entity():
    pre = [
        "v.dt = math.clamp(q.delta_time, 0.0, 0.1);",
        "v.k6 = math.clamp(v.dt * 6.0, 0.0, 1.0); v.k4 = math.clamp(v.dt * 4.0, 0.0, 1.0); v.k2 = math.clamp(v.dt * 2.2, 0.0, 1.0);",
        # gait drivers (units derived from the supplied clips: v.walk degrees per stride, v.crawl 0..1 anim time)
        "v.inc = math.clamp(q.modified_distance_moved - v.last_dist, 0.0, 1.0); v.last_dist = q.modified_distance_moved;",
        "v.move = v.move + (math.clamp(q.ground_speed / 1.6, 0.0, 1.0) - v.move) * v.k6;",
        "v.fast = v.fast + (math.clamp((q.ground_speed - 2.0) / 1.2, 0.0, 1.0) - v.fast) * v.k4;",
        "v.walk = math.mod(v.walk + v.inc * 360.0 / math.lerp(2.17, 2.89, v.fast), 360.0);",
        "v.crawl = math.mod(v.crawl + v.inc / 1.62, 1.0);",
        "v.climb_t = 0.0;",
        # posture cross-fade weights (sum stays 1)
        "v.pt = %s;" % Q("tailwail:posture"),
        "v.w_t = v.w_t + ((v.pt == 0 ? 1.0 : 0.0) - v.w_t) * v.k4;",
        "v.w_h = v.w_h + ((v.pt == 1 ? 1.0 : 0.0) - v.w_h) * v.k4;",
        "v.w_c = v.w_c + ((v.pt == 2 ? 1.0 : 0.0) - v.w_c) * v.k4;",
        # head tracking (owl-wide yaw), smoothed
        "v.look_y = v.look_y + (math.clamp(%s, -178.0, 178.0) - v.look_y) * math.clamp(v.dt * 5.0, 0.0, 1.0);" % Q("tailwail:look_yaw"),
        "v.look_x = v.look_x + (math.clamp(%s, -50.0, 50.0) - v.look_x) * math.clamp(v.dt * 5.0, 0.0, 1.0);" % Q("tailwail:look_pitch"),
        # breathing: amplitude (deg) and phase rate (deg/s) per breath level
        "v.br = %s;" % Q("tailwail:breath"),
        "v.br_amp = v.br_amp + ((v.br == 1 ? 3.5 : (v.br == 2 ? 6.0 : (v.br == 3 ? 7.5 : 0.0))) - v.br_amp) * v.k2;",
        "v.br_ph = math.mod(v.br_ph + (v.br == 1 ? 90.0 : (v.br == 2 ? 210.0 : (v.br == 3 ? 430.0 : 0.0))) * v.dt, 360.0);",
        "v.tremor = v.tremor + ((%s / 3.0) - v.tremor) * v.k4;" % Q("tailwail:tremor"),
        # jaw target in degrees from the server, with a wet chatter when wide open
        "v.jaw_t = math.clamp(%s, 0.0, 60.0);" % Q("tailwail:jaw"),
        "v.jaw = v.jaw + (v.jaw_t + (v.jaw_t > 30.0 ? 3.0 * math.sin(q.life_time * 900.0) : 0.0) - v.jaw) * math.clamp(v.dt * 9.0, 0.0, 1.0);",
        # imitation overlays, only during locomotion pose and upright
        "v.m = %s; v.m_amt = math.clamp(%s, 0.0, 2.0) * (%s == 0 ? 1.0 : 0.0);" % (Q("tailwail:mimic"), Q("tailwail:mimic_amt"), POSE),
        "v.mimic_crouch = v.mimic_crouch + ((v.m == 1 ? math.min(v.m_amt, 1.6) : 0.0) - v.mimic_crouch) * v.k2;",
        "v.mimic_step = v.mimic_step + ((v.m == 3 ? 0.5 * math.min(v.m_amt, 1.0) : 0.0) - v.mimic_step) * v.k2;",
        "v.mimic_shrug = v.mimic_shrug + ((v.m == 4 ? math.min(v.m_amt, 1.5) : 0.0) - v.mimic_shrug) * v.k2;",
        "v.mimic_roll = v.mimic_roll + ((v.m == 2 ? 26.0 * v.m_amt : 0.0) - v.mimic_roll) * v.k2;",
        "v.mimic_pitch = v.mimic_pitch + ((v.m == 2 ? math.clamp(%s, -45.0, 45.0) * math.min(v.m_amt, 1.4) : 0.0) - v.mimic_pitch) * v.k2;" % Q("tailwail:mimic_pitch"),
        "v.alive = (%s < 26) ? 1.0 : 0.0;" % POSE,
    ]
    init = [
        "v.walk = 0.0; v.move = 0.0; v.fast = 0.0; v.crawl = 0.0; v.climb_t = 0.0; v.last_dist = q.modified_distance_moved;",
        "v.w_t = 1.0; v.w_h = 0.0; v.w_c = 0.0; v.look_x = 0.0; v.look_y = 0.0; v.jaw = 0.0; v.jaw_t = 0.0;",
        "v.br_amp = 0.0; v.br_ph = 0.0; v.tremor = 0.0;",
        "v.mimic_crouch = 0.0; v.mimic_step = 0.0; v.mimic_shrug = 0.0; v.mimic_roll = 0.0; v.mimic_pitch = 0.0;",
    ]
    clips = set()
    for _, _, cl, _ in POSES:
        for c in cl or []:
            clips.add(c if isinstance(c, str) else list(c)[0])
    clips |= {"tw2_idle_up", "walk_nt", "pace_nt", "tw2_creep", "tw2_idle_low", "crawl", "gfix_crawl", "planted",
              "tw_tunnel_still", "tw_tunnel_move", "tw2_breath", "tw2_tremor", "tw2_look", "jaw", "tw_tail_drag",
              "tw_tail_drag_low", "tw_tail_twitch", "tw_tail_rigid", "tw2_tail_curl", "tw_mimic_crouch", "tw_mimic_step",
              "tw_mimic_shrug", "tw2_mimic_tilt", "hurt", "tw2_gfix_tunnel_move", "tw2_gfix_tunnel_still",
              "tw2_tail_tunnel_still", "tw2_tail_tunnel_move"}
    anims = {c: A + c for c in sorted(clips)}
    ctrls = ["body", "tail", "overlay", "mimic", "hurt"]
    for c in ctrls:
        anims["ctrl_" + c] = "controller.animation.tall_wail.v2_" + c
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
                "scripts": {"scale": "1.5", "initialize": init, "pre_animation": pre,
                            "animate": ["ctrl_" + c for c in ctrls]},
                "animations": anims,
            }
        },
    }


def body_controller():
    ids = [p[0] for p in POSES]
    states = {}
    for pid, name, clips, blend in POSES:
        if pid == 0:
            anims = [
                {"tw2_idle_up": "v.w_t * (1.0 - v.move)"},
                {"walk_nt": "v.w_t * v.move * v.fast"},
                {"pace_nt": "v.w_t * v.move * (1.0 - v.fast)"},
                {"tw2_creep": "v.w_t * v.move * (1.0 - v.fast)"},
                {"tw2_idle_low": "v.w_h * (1.0 - v.move)"},
                {"crawl": "(v.w_h + v.w_c) * v.move"},
                {"gfix_crawl": "v.w_h * v.move"},
                {"tw_tunnel_move": "v.w_c * v.move"},
                {"planted": "v.w_c * (1.0 - v.move)"},
                {"tw_tunnel_still": "v.w_c * (1.0 - v.move)"},
                {"tw2_gfix_tunnel_move": "v.w_c * v.move"},
                {"tw2_gfix_tunnel_still": "v.w_c * (1.0 - v.move)"},
            ]
        else:
            anims = list(clips)
        trans = [("p%d" % o, "%s == %d" % (POSE, o)) for o in ids if o != pid]
        states["p%d" % pid] = st(anims, trans, blend)
    return {"initial_state": "p0", "states": states}


def tail_controller():
    T = Q("tailwail:tail")
    states = {}
    # in the tunnel crawl every tail state hands over to the floor-solved tunnel tail (it would
    # otherwise sink ~1 block into the floor or poke through a 2-high ceiling)
    up = "1.0 - v.w_c"
    defs = {
        "drag": [{"tw_tail_drag": "v.w_t"}, {"tw_tail_drag_low": "v.w_h"}],
        "twitch": [{"tw_tail_twitch": up}],
        "rigid": [{"tw_tail_rigid": up}],
        "free": [],
        "curl": [{"tw2_tail_curl": up}],
    }
    tunnel = [{"tw2_tail_tunnel_still": "v.w_c * (1.0 - v.move)"}, {"tw2_tail_tunnel_move": "v.w_c * v.move"}]
    for name, tid in TAILS.items():
        trans = [(o, "%s == %d" % (T, oid)) for o, oid in TAILS.items() if o != name]
        states[name] = st(defs[name] + tunnel, trans, 0.15 if name == "rigid" else 0.35)
    return {"initial_state": "drag", "states": states}


def overlay_controller():
    # always-on layers in one single-state controller (cannot get stuck)
    return {"initial_state": "on", "states": {"on": {"animations": [
        {"tw2_breath": "v.alive"}, {"tw2_tremor": "v.alive"}, {"tw2_look": "v.alive"}, "jaw"]}}}


def mimic_controller():
    up = "v.w_t"
    return {"initial_state": "on", "states": {"on": {"animations": [
        {"tw_mimic_crouch": "%s * (1.0 - v.move)" % up}, {"tw_mimic_step": "%s * (1.0 - v.move)" % up},
        {"tw_mimic_shrug": "1.0 - v.move"}, "tw2_mimic_tilt"]}}}


def hurt_controller():
    return {"initial_state": "default", "states": {
        "default": st([], [("hurt", "q.hurt_time > 0 && v.alive > 0.5")], None),
        "hurt": st(["hurt"], [("default", "q.all_animations_finished && q.hurt_time <= 0")], 0.1)}}


def echo_entity():
    E = Q("tailwail:echo_pose")
    states = {}
    for i, name in enumerate(ECHO_POSES):
        trans = [("e%d" % j, "%s == %d" % (E, j)) for j in range(len(ECHO_POSES)) if j != i]
        states["e%d" % i] = st(["tw2_" + name], trans, 0.0)
    ctrl = {"initial_state": "e0", "states": states}
    anims = {"tw2_" + n: A + "tw2_" + n for n in ECHO_POSES}
    anims.update({"tw2_tremor": A + "tw2_tremor", "jaw": A + "jaw", "tw_tail_drag": A + "tw_tail_drag",
                  "ctrl_echo": "controller.animation.tall_wail.v2_echo"})
    ce = {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": "tailwail:echo",
        "materials": {"default": "entity_alphatest"},
        "textures": {"default": "textures/entity/tall_wail/tall_wail"},
        "geometry": {"default": "geometry.tall_wail"},
        "render_controllers": ["controller.render.tall_wail"],
        "scripts": {"scale": "1.5",
                    "initialize": ["v.tremor = 0.8; v.jaw = 18.0; v.look_x = 0.0; v.look_y = 0.0;"],
                    "pre_animation": ["v.jaw = 18.0 + 4.0 * math.sin(q.life_time * 120.0);"],
                    "animate": ["ctrl_echo", "tw2_tremor", "jaw", "tw_tail_drag"]},
        "animations": anims}}}
    return ce, ctrl


def ids_js():
    lines = ["// GENERATED by tools/gen_client_v2.py - shared numeric ids for synced entity properties.", ""]
    lines.append("export const POSE = Object.freeze({")
    for pid, name, _, _ in POSES:
        lines.append("  %s: %d," % (name, pid))
    lines.append("});")
    for title, table in (("POSTURE", POSTURES), ("TAIL", TAILS), ("BREATH", BREATH), ("MIMIC", MIMICS)):
        lines.append("export const %s = Object.freeze({ %s });" % (title, ", ".join("%s: %d" % kv for kv in table.items())))
    lines.append("export const ECHO_POSE = Object.freeze({ %s });" % ", ".join("%s: %d" % (n, i) for i, n in enumerate(ECHO_POSES)))
    lines.append("export const STATUE_POSES = Object.freeze([%s]);" % ", ".join(str(p[0]) for p in POSES if p[1].startswith("statue_")))
    return "\n".join(lines) + "\n"


def patch_props(path, props):
    d = json.load(open(path))
    d["minecraft:entity"]["description"]["properties"] = props
    json.dump(d, open(path, "w"), indent=2)


def main():
    ce = client_entity()
    json.dump(ce, open(os.path.join(RP, "entity", "tall_wail.entity.json"), "w"), indent=1)
    ctrls = {
        "controller.animation.tall_wail.v2_body": body_controller(),
        "controller.animation.tall_wail.v2_tail": tail_controller(),
        "controller.animation.tall_wail.v2_overlay": overlay_controller(),
        "controller.animation.tall_wail.v2_mimic": mimic_controller(),
        "controller.animation.tall_wail.v2_hurt": hurt_controller(),
    }
    eco, ectrl = echo_entity()
    ctrls["controller.animation.tall_wail.v2_echo"] = ectrl
    json.dump({"format_version": "1.10.0", "animation_controllers": ctrls},
              open(os.path.join(RP, "animation_controllers", "tall_wail.animation_controllers.json"), "w"), indent=1)
    json.dump(eco, open(os.path.join(RP, "entity", "tailwail_echo.entity.json"), "w"), indent=1)
    open(os.path.join(BP, "scripts", "core", "ids.js"), "w").write(ids_js())
    patch_props(os.path.join(BP, "entities", "tall_wail.json"), PROPS)
    if os.path.exists(os.path.join(BP, "entities", "tailwail_echo.json")):
        patch_props(os.path.join(BP, "entities", "tailwail_echo.json"), ECHO_PROPS)
    print("client v2 written: %d poses, %d controllers" % (len(POSES), len(ctrls)))


if __name__ == "__main__":
    main()
