# Authors the extra animations the night needs on top of the supplied set:
#   crawl   (Purple Rat in the ducts: on all fours, under 1.1 blocks tall, a slow crawl cycle)
#   peek    (the Cat leaning out between the Cabaret curtains)
#   look    (additive head turn driven by variables, for "staring at the camera")
#   slump   alias handled by pose_2 in the controller
# Output: dict of animation name -> bedrock animation JSON (used by build_entities.py).
import math

def cyc(times, values):
    return {f"{t:.2f}": v for t, v in zip(times, values)}

def crawl_anim(lean=80, hip_drop=-11.25, arm_fwd=14, length=1.2):
    T = [0, length * 0.25, length * 0.5, length * 0.75, length]
    sw = 16  # leg swing
    aw = 20  # arm swing
    def legs(phase):
        vals = []
        for i, t in enumerate(T):
            s = math.sin((t / length) * 2 * math.pi + phase)
            vals.append([round(-lean + s * sw, 2), 0, 0])
        return cyc(T, vals)
    def shins(phase):
        return cyc(T, [[round(88 + 8 * math.sin((t / length) * 2 * math.pi + phase), 2), 0, 0] for t in T])
    def arms(phase):
        return cyc(T, [[round(-lean - arm_fwd + aw * math.sin((t / length) * 2 * math.pi + phase), 2), 0, 0] for t in T])
    def forearms(phase):
        return cyc(T, [[round(-12 + 10 * math.sin((t / length) * 2 * math.pi + phase), 2), 0, 0] for t in T])
    bob = cyc(T, [[0, hip_drop + 0.4 * math.sin((t / length) * 4 * math.pi), 0] for t in T])
    return {
        "loop": True, "animation_length": length,
        "bones": {
            "root": {"position": bob},
            "waist": {"rotation": cyc(T, [[lean, 3 * math.sin((t / length) * 2 * math.pi), 0] for t in T])},
            "head": {"rotation": cyc(T, [[-lean + 12 + 4 * math.sin((t / length) * 4 * math.pi), 0, 0] for t in T])},
            "right_leg": {"rotation": legs(0)}, "left_leg": {"rotation": legs(math.pi)},
            "right_shin": {"rotation": shins(0)}, "left_shin": {"rotation": shins(math.pi)},
            "right_arm": {"rotation": arms(math.pi)}, "left_arm": {"rotation": arms(0)},
            "right_forearm": {"rotation": forearms(math.pi)}, "left_forearm": {"rotation": forearms(0)},
            "tail_1": {"rotation": [-72, 0, 0]},
            "right_maraca": {"scale": 0}, "left_maraca": {"scale": 0},
        },
    }

def peek_anim():
    T = [0, 1.0, 2.0, 3.0, 4.0]
    return {
        "loop": True, "animation_length": 4.0,
        "bones": {
            "waist": {"rotation": cyc(T, [[0, -25, -6], [0, -28, -7], [0, -25, -6], [0, -22, -5], [0, -25, -6]])},
            "torso": {"rotation": cyc(T, [[6, -10, -10], [6, -12, -12], [6, -10, -10], [6, -8, -9], [6, -10, -10]])},
            "head": {"rotation": cyc(T, [[8, 25, -22], [6, 30, -26], [8, 25, -22], [10, 18, -18], [8, 25, -22]])},
            "right_arm": {"rotation": cyc(T, [[-70, 0, 25], [-72, 0, 25], [-70, 0, 25], [-68, 0, 25], [-70, 0, 25]])},
            "right_forearm": {"rotation": cyc(T, [[-30, 0, 0]] * 5)},
        },
    }

def look_anim():
    # additive head turn; the client smooths the property values into variables
    return {
        "loop": True,
        "bones": {
            "head": {"rotation": ["-variable.fnar_lp", "variable.fnar_ly", 0]},
        },
    }

EXTRA = {"crawl": crawl_anim, "peek": peek_anim, "look": look_anim}
