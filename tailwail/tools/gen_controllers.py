#!/usr/bin/env python3
"""Generates the resource-pack animation controllers, render controllers and the lure
client files.  The state -> clip mapping lives here so it can be reviewed in one place
(see docs/ANIMATION_MAP.md).

  python3 -I tools/gen_controllers.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "packs", "TailwailRP")

S = lambda x: "q.property('tailwail:state') == '%s'" % x  # noqa: E731
PO = lambda x: "q.property('tailwail:posture') == '%s'" % x  # noqa: E731
A = lambda x: "q.property('tailwail:action') == '%s'" % x  # noqa: E731
T = lambda x: "q.property('tailwail:tail') == '%s'" % x  # noqa: E731
V = lambda x: "q.property('tailwail:voice') == '%s'" % x  # noqa: E731


def st(anims, trans, blend=0.3):
    d = {"animations": anims, "transitions": [{k: v} for k, v in trans]}
    if blend is not None:
        d["blend_transition"] = blend
    return d


def body():
    return {
        "initial_state": "upright",
        "states": {
            # stalk / stand-off / search / retreat while standing: breathing idle + gait blend
            "upright": st(["idle_nt", {"walk_nt": "v.move * v.fast"}, {"pace_nt": "v.move * (1.0 - v.fast)"},
                           {"watch_nt": "(%s || %s) * (1.0 - v.move)" % (S("stalk"), S("standoff"))},
                           {"menace_nt": "v.menace_w * (1.0 - v.move)"}, {"withdraw": S("retreat")}],
                          [("death", S("death")), ("unfold", S("unfold")), ("windup", S("windup")),
                           ("peek_l", A("peek_l")), ("peek_r", A("peek_r")),
                           ("drop", "!(%s) || %s" % (PO("tall"), S("chase")))]),
            "drop": st(["drop", "gfix_drop"], [("death_low", S("death")), ("low", "q.all_animations_finished")], 0.15),
            # hunched / pursuit: planted stance cross-fading into the knuckle gallop by ground speed
            "low": st([{"planted": "1.0 - v.move"}, {"gfix_planted": "1.0 - v.move"}, {"crawl": "v.move"}, {"gfix_crawl": "v.move"}],
                      [("death_low", S("death")), ("unfold_low", S("unfold")), ("windup_c", S("windup")), ("strike", A("strike")),
                       ("ambush", A("ambush")), ("stuck", A("stuck")), ("tunnel", PO("crawl")),
                       ("rise", "%s && !(%s) && !(%s) && !(%s)" % (PO("tall"), S("chase"), S("windup"), S("unfold")))]),
            "rise": st(["rise", "gfix_rise"], [("death", S("death")), ("upright", "q.all_animations_finished")], 0.15),
            # 2-block passages: flattened body over the same gait
            "tunnel": st([{"planted": "1.0 - v.move"}, {"tw_tunnel_still": "1.0 - v.move"}, {"crawl": "v.move"}, {"tw_tunnel_move": "v.move"}],
                         [("death_low", S("death")), ("strike", A("strike")), ("low", "!(%s)" % PO("crawl"))], 0.4),
            "unfold": st(["reveal", {"tw_unfold_full": "q.property('tailwail:headroom') >= 7"}, {"tw_unfold_mid": "q.property('tailwail:headroom') < 7"}],
                         [("death", S("death")), ("windup", S("windup")), ("drop", S("chase")),
                          ("upright", "!(%s) && !(%s) && !(%s)" % (S("unfold"), S("windup"), S("chase")))], 0.3),
            "unfold_low": st(["planted", "gfix_planted", "tw_unfold_low"],
                             [("death_low", S("death")), ("windup_c", S("windup")), ("low", "!(%s) && !(%s)" % (S("unfold"), S("windup")))], 0.3),
            "windup": st(["windup", "gfix_windup"], [("death_low", S("death")), ("low", "!(%s)" % S("windup"))], 0.25),
            "windup_c": st(["windup_c", "gfix_windup_c"], [("death_low", S("death")), ("low", "!(%s)" % S("windup"))], 0.25),
            "strike": st(["tw_strike", "gfix_tw_strike"],
                         [("death_low", S("death")), ("tunnel", "(!(%s) || q.all_animations_finished) && %s" % (A("strike"), PO("crawl"))),
                          ("low", "(!(%s) || q.all_animations_finished) && !(%s)" % (A("strike"), PO("crawl")))], 0.2),
            "ambush": st(["ambush", "gfix_ambush"], [("death_low", S("death")), ("low", "!(%s)" % A("ambush"))], 0.25),
            "stuck": st(["stuck", "gfix_stuck"], [("death_low", S("death")), ("low", "!(%s)" % A("stuck"))], 0.25),
            "peek_l": st(["peek_left", "gfix_peek_left"], [("death", S("death")), ("upright", "!(%s)" % A("peek_l"))], 0.35),
            "peek_r": st(["peek_right", "gfix_peek_right"], [("death", S("death")), ("upright", "!(%s)" % A("peek_r"))], 0.35),
            "death": st(["death", "gfix_death"], [], 0.2),
            "death_low": st(["death_low", "gfix_death_low"], [], 0.2),
        },
    }


def tail():
    tails = ["drag", "twitch", "rigid", "free"]
    upright = "q.property('tailwail:posture') == 'tall'"
    # the drag pose is solved separately for the upright and hunched bodies so the tip trails on the floor
    anims = {"drag": [{"tw_tail_drag": upright}, {"tw_tail_drag_low": "!(%s)" % upright}], "twitch": ["tw_tail_twitch"],
             "rigid": ["tw_tail_rigid"], "free": []}
    return {"initial_state": "drag",
            "states": {t: st(anims[t], [(o, T(o)) for o in tails if o != t], 0.15 if t == "rigid" else 0.35) for t in tails}}


def face():
    return {"initial_state": "base", "states": {
        "base": st(["look", "jaw"], [("click", V("click")), ("wail", V("wail")), ("inhale", V("inhale")), ("listen", A("listen"))], 0.2),
        "click": st(["look", "jaw", "echo"], [("base", "!(%s)" % V("click"))], 0.2),
        # viewers who turned optional effects off see a gentler head shake (per-player property override)
        "wail": st(["look", "jaw", {"scream_nt": "q.property('tailwail:fx') >= 1 ? 1.0 : 0.35"}], [("base", "!(%s)" % V("wail"))], 0.3),
        "inhale": st(["look", "jaw", "tw_inhale"], [("wail", V("wail")), ("base", "!(%s)" % V("inhale"))], 0.25),
        "listen": st(["look", "jaw", "listen"], [("click", V("click")), ("base", "!(%s)" % A("listen"))], 0.4)}}


def mimic():
    return {"initial_state": "off", "states": {
        "off": st([], [("on", "v.m_on")], None),
        "on": st([{"tw_mimic_crouch": "(1.0 - v.move) * (%s)" % PO("tall")}, {"tw_mimic_step": "(1.0 - v.move) * (%s)" % PO("tall")},
                  {"tw_mimic_shrug": "1.0 - v.move"}, "tw_mimic_tilt"],
                 [("off", "!v.m_on && v.mimic_crouch < 0.02 && v.mimic_step < 0.02 && v.mimic_shrug < 0.02 && "
                          "math.abs(v.mimic_roll) < 0.5 && math.abs(v.mimic_pitch) < 0.5")], None)}}


def agitation():
    return {"initial_state": "calm", "states": {
        "calm": st([], [("twitchy", "q.property('tailwail:agit') == 2 && v.m_on")], None),
        "twitchy": st(["twitch"], [("calm", "q.property('tailwail:agit') != 2 || !v.m_on")], 0.5)}}


def hurt():
    return {"initial_state": "default", "states": {
        "default": st([], [("hurt", "q.hurt_time > 0 && !(%s)" % S("death"))], None),
        "hurt": st(["hurt"], [("default", "q.all_animations_finished && q.hurt_time <= 0")], 0.1)}}


def main():
    doc = {"format_version": "1.10.0", "animation_controllers": {
        "controller.animation.tall_wail.body": body(), "controller.animation.tall_wail.tail": tail(),
        "controller.animation.tall_wail.face": face(), "controller.animation.tall_wail.mimic": mimic(),
        "controller.animation.tall_wail.agitation": agitation(), "controller.animation.tall_wail.hurt": hurt()}}
    json.dump(doc, open(os.path.join(RP, "animation_controllers", "tall_wail.animation_controllers.json"), "w"), indent=1)
    rc = {"format_version": "1.8.0", "render_controllers": {
        "controller.render.tall_wail": {"geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"]},
        "controller.render.tailwail_lure": {"geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"]}}}
    json.dump(rc, open(os.path.join(RP, "render_controllers", "tall_wail.render_controllers.json"), "w"), indent=1)
    lure = {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": "tailwail:lure", "materials": {"default": "entity_alphatest"},
        "textures": {"default": "textures/entity/tall_wail/tall_wail"}, "geometry": {"default": "geometry.tailwail_lure"},
        "render_controllers": ["controller.render.tailwail_lure"]}}}
    json.dump(lure, open(os.path.join(RP, "entity", "tailwail_lure.entity.json"), "w"), indent=1)
    geo = {"format_version": "1.12.0", "minecraft:geometry": [{"description": {
        "identifier": "geometry.tailwail_lure", "texture_width": 512, "texture_height": 128,
        "visible_bounds_width": 0.1, "visible_bounds_height": 0.1, "visible_bounds_offset": [0, 0, 0]},
        "bones": [{"name": "root", "pivot": [0, 0, 0]}]}]}
    json.dump(geo, open(os.path.join(RP, "models", "entity", "tailwail_lure.geo.json"), "w"), indent=1)
    print("controllers written")


if __name__ == "__main__":
    main()
