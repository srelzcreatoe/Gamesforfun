#!/usr/bin/env python3
"""Generate The Observer's client entity, render controller and animation controllers.

State -> animation mapping (q.property('observer:state') is set by the behaviour scripts):

  watch   idle (supplied)      + look_at_target      standing observation
  stare   staring (supplied)   + look_at_target      rigid gaze, abrupt head turns (contact)
  tilt    pose (supplied)                            crooked head-tilt hold (acknowledgement)
  walk    stalk_walk (new)     + look_at_target      slow approach / repositioning / retreat
  run     running (supplied)                         pursuit
  attack  attack (supplied, once)                    telegraphed overhead strike
  peek    idle (supplied)      + peek (new)          leaning out from cover; side = q.property('observer:side')
  recoil  recoil (new, once)                         flinch when witnessed / struck
  hidden  (no parts rendered)                        momentary vanish without despawning

observer:stoop (bool) layers the additive stoop crouch on top of any state so the
4-block figure fits 3-block spaces.
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
}
STATE_SOUNDS = {"attack": [{"effect": "windup"}], "recoil": [{"effect": "recoil"}]}
BLEND = {"attack": 0.1, "recoil": 0.05, "hidden": 0.0, "run": 0.2}


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


def stoop_controller():
    return {"initial_state": "default", "states": {
        "default": {"transitions": [{"stooped": "q.property('observer:stoop')"}], "blend_transition": 0.4},
        "stooped": {"animations": ["stoop"], "transitions": [{"default": "!q.property('observer:stoop')"}],
                    "blend_transition": 0.4},
    }}


def main():
    ac = {"format_version": "1.10.0", "animation_controllers": {
        "controller.animation.observer.state": state_controller(),
        "controller.animation.observer.stoop": stoop_controller(),
    }}
    client = {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": "observer:the_observer",
        "materials": {"default": "entity_alphatest"},
        "textures": {"default": "textures/entity/observer/the_observer"},
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
            "ctrl_state": "controller.animation.observer.state",
            "ctrl_stoop": "controller.animation.observer.stoop",
        },
        "scripts": {"animate": ["ctrl_state", "ctrl_stoop"]},
        # short name -> sound event, as plain strings (the client rejects {"effect": ...} objects here)
        "sound_effects": {"windup": "observer.windup", "recoil": "observer.fabric"},
        "render_controllers": ["controller.render.observer.the_observer"],
        "spawn_egg": {"base_color": "#0e0e10", "overlay_color": "#d8d4cf"},
    }}}
    rc = {"format_version": "1.8.0", "render_controllers": {"controller.render.observer.the_observer": {
        "geometry": "Geometry.default",
        "materials": [{"*": "Material.default"}],
        "textures": ["Texture.default"],
        "part_visibility": [{"*": "q.property('observer:state') != 'hidden'"}],
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
