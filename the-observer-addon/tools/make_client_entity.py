#!/usr/bin/env python3
"""Generate The Observer's client entity, render controller and animation controllers.

State -> animation mapping (q.property('observer:state') is set by the behaviour scripts):

  watch   idle (supplied)      + look_at_target      standing observation
  stare   staring (supplied)   + look_at_target      rigid gaze, abrupt head turns (contact)
  tilt    pose (supplied)                            crooked head-tilt hold (acknowledgement)
  walk    stalk_walk (new)     + look_at_target      slow approach / repositioning / retreat
  run     running (supplied)                         unused since 1.0.8: every run, chase and attack floats
  attack  attack (supplied, once)                    telegraphed overhead strike
  peek    idle (supplied)      + peek (new)          leaning out from cover; side = q.property('observer:side')
  recoil  recoil (new, once)                         flinch when witnessed / struck
  hidden  (no parts rendered)                        momentary vanish without despawning
  float   float_drift (new)    + look_at_target      1.0.6 chase: hovering a block up, limp, while watched
  surge   float_surge (new)                          1.0.6 chase: rushing at you through the air
  climb   climb (new)                                1.0.6: up a wall or pillar after you, head turned back
  hang    hang (new)                                 1.0.9: stalking from a cave ceiling, upside down
  crawl   crawl (new)                                1.0.9: flat on its front through a gap a block high

observer:stoop (bool) layers the additive stoop crouch on top of any state so the
4-block figure fits 3-block spaces.

observer:afloat (bool, 1.0.8) is set while it floats (the chase, every attack, the lunge): any state that is
not itself a floating clip (attack, recoil, stare ...) gets float_hang layered on, so it strikes and flinches
in mid-air with its legs hanging instead of dropping to the ground.

Presence effects (client side, so they follow the body exactly):
  * aura   while it is shown: glowing wisps (supplied wisp sprites) around it from head to toe
  * eyes   a second render layer with only the two eye cubes, drawn at full brightness (ignore_lighting),
           and, while q.property('observer:dark') is set (night or light <= 7), a soft glow at the eye locators
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "packs", "TheObserver_RP")

STATES = {
    "watch": ["idle", "look_at_target"],
    "stare": ["staring", "look_at_target"],
    "tilt": ["pose"],
    "walk": ["stalk_walk", "look_at_target"],
    "run": ["running"],
    "attack": ["attack"],
    "peek": ["idle", "peek"],
    "recoil": ["recoil"],
    "hidden": [],
    "float": ["float_drift", "look_at_target"],
    "surge": ["float_surge"],
    "climb": ["climb"],
    "hang": ["hang"],
    "crawl": ["crawl"],
}
STATE_SOUNDS = {"attack": [{"effect": "windup"}], "recoil": [{"effect": "recoil"}]}
BLEND = {"attack": 0.1, "recoil": 0.05, "hidden": 0.0, "run": 0.2, "float": 0.35, "surge": 0.3, "climb": 0.15, "hang": 0.0, "crawl": 0.15}


def prop(s):
    return f"q.property('observer:state') == '{s}'"


def state_controller():
    states = {"default": {"transitions": [{s: prop(s)} for s in STATES]}}
    for s, anims in STATES.items():
        st = {"transitions": [{o: prop(o)} for o in STATES if o != s], "blend_transition": BLEND.get(s, 0.25)}
        if anims:  # the client rejects an empty "animations" list ("Required child not found")
            st = {"animations": anims, **st}
        if s in STATE_SOUNDS:
            st["sound_effects"] = STATE_SOUNDS[s]
        states[s] = st
    return {"initial_state": "default", "states": states}


FLOATING = ("float", "surge", "climb", "hidden", "hang", "crawl")
AFLOAT = "q.property('observer:afloat') && " + " && ".join(f"q.property('observer:state') != '{s}'" for s in FLOATING)


def afloat_controller():
    return {"initial_state": "default", "states": {
        "default": {"transitions": [{"hanging": AFLOAT}], "blend_transition": 0.25},
        "hanging": {"animations": ["float_hang"], "transitions": [{"default": f"!({AFLOAT})"}], "blend_transition": 0.25},
    }}


def stoop_controller():
    return {"initial_state": "default", "states": {
        "default": {"transitions": [{"stooped": "q.property('observer:stoop')"}], "blend_transition": 0.4},
        "stooped": {"animations": ["stoop"], "transitions": [{"default": "!q.property('observer:stoop')"}],
                    "blend_transition": 0.4},
    }}


SHOWN = "q.property('observer:state') != 'hidden'"
DARK = f"q.property('observer:dark') && {SHOWN}"


def aura_controller():
    return {"initial_state": "default", "states": {
        "default": {"transitions": [{"aura": SHOWN}]},
        "aura": {"particle_effects": [{"effect": "wisp"}], "transitions": [{"default": f"!({SHOWN})"}]},
    }}


def eyes_controller():
    return {"initial_state": "default", "states": {
        "default": {"transitions": [{"glow": DARK}]},
        "glow": {"particle_effects": [{"effect": "eye_glow", "locator": "eye_1"}, {"effect": "eye_glow", "locator": "eye_2"}],
                 "transitions": [{"default": f"!({DARK})"}]},
    }}


def main():
    ac = {"format_version": "1.10.0", "animation_controllers": {
        "controller.animation.observer.state": state_controller(),
        "controller.animation.observer.stoop": stoop_controller(),
        "controller.animation.observer.afloat": afloat_controller(),
        "controller.animation.observer.aura": aura_controller(),
        "controller.animation.observer.eyes": eyes_controller(),
    }}
    client = {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": "observer:the_observer",
        "materials": {"default": "entity_alphatest", "eyes": "entity_alphatest"},
        "textures": {"default": "textures/entity/observer/the_observer", "eyes": "textures/entity/observer/the_observer_eyes"},
        "geometry": {"default": "geometry.observer.the_observer"},
        "animations": {
            "idle": "animation.observer.idle",
            "pose": "animation.observer.pose",
            "staring": "animation.observer.staring",
            "running": "animation.observer.running",
            "attack": "animation.observer.attack",
            "stalk_walk": "animation.observer.stalk_walk",
            "peek": "animation.observer.peek",
            "recoil": "animation.observer.recoil",
            "stoop": "animation.observer.stoop",
            "look_at_target": "animation.observer.look_at_target",
            "float_drift": "animation.observer.float_drift",
            "float_surge": "animation.observer.float_surge",
            "climb": "animation.observer.climb",
            "float_hang": "animation.observer.float_hang",
            "hang": "animation.observer.hang",
            "crawl": "animation.observer.crawl",
            "ctrl_state": "controller.animation.observer.state",
            "ctrl_stoop": "controller.animation.observer.stoop",
            "ctrl_afloat": "controller.animation.observer.afloat",
            "ctrl_aura": "controller.animation.observer.aura",
            "ctrl_eyes": "controller.animation.observer.eyes",
        },
        "scripts": {"animate": ["ctrl_state", "ctrl_stoop", "ctrl_afloat", "ctrl_aura", "ctrl_eyes"]},
        "particle_effects": {"wisp": "observer:wisp", "eye_glow": "observer:eye_glow"},
        # short name -> sound event, as plain strings (the client rejects {"effect": ...} objects here)
        "sound_effects": {"windup": "observer.windup", "recoil": "observer.fabric", "crack": "observer.crack"},
        "render_controllers": ["controller.render.observer.the_observer", "controller.render.observer.eyes"],
        "spawn_egg": {"base_color": "#0e0e10", "overlay_color": "#d8d4cf"},
    }}}
    rc = {"format_version": "1.8.0", "render_controllers": {"controller.render.observer.the_observer": {
        "geometry": "Geometry.default",
        "materials": [{"*": "Material.default"}],
        "textures": ["Texture.default"],
        "part_visibility": [{"*": "q.property('observer:state') != 'hidden'"}],
    }, "controller.render.observer.eyes": {
        # only the eye cubes have pixels in this texture; drawn at full brightness so they glow in the dark
        "geometry": "Geometry.default",
        "materials": [{"*": "Material.eyes"}],
        "textures": ["Texture.eyes"],
        "ignore_lighting": True,
        "part_visibility": [{"*": False}, {"head": "q.property('observer:state') != 'hidden'"}],
    }}}
    out = {
        os.path.join(RP, "animation_controllers", "the_observer.animation_controllers.json"): ac,
        os.path.join(RP, "entity", "the_observer.entity.json"): client,
        os.path.join(RP, "render_controllers", "the_observer.render_controllers.json"): rc,
    }
    for p, d in out.items():
        os.makedirs(os.path.dirname(p), exist_ok=True)
        json.dump(d, open(p, "w"), indent=2)
        print("wrote", os.path.relpath(p, ROOT))


if __name__ == "__main__":
    main()
