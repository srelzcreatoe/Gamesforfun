#!/usr/bin/env python3
"""Offline verification of the Tailwail client (resource pack) wiring and behaviour.

Static checks
  * every animation / controller reference resolves, every controller state and transition
    target exists, every Molang string parses with the strict parser in molang.py;
  * every query used is a documented Bedrock query; every q.property is declared on the
    behavior entity, is client_sync, and is compared against values of the right type;
  * every Molang variable that is read is written by initialize / pre_animation;
  * every animated bone exists in the geometry; one-shot clips used by script-held states
    either loop or hold their last frame (a plain loop:false clip would snap to bind pose).

Dynamic checks (frame simulation at 60 fps, emulating controller semantics: one
transition per controller per frame, first true transition wins, animations restart on
state entry)
  * every body pose is reachable from every other pose within one frame and exits on the
    next property change; a 600-step random pose schedule never desynchronises;
  * all blend weights and variables stay finite and inside [0, 1.05];
  * the hurt flinch returns to its idle state;
  * composite poses (body + all overlays) are grounded: lowest point within tolerance of
    the floor for standing/hunched/crawling states, and peak heights are reported.

Usage: python3 -I tools/client_sim.py [--report docs/generated/client_sim_report.md] [--quick]
"""
import argparse
import glob
import json
import math
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import molang  # noqa: E402
import bedrock_model as bm  # noqa: E402

ROOT = os.path.dirname(HERE)
RP = os.path.join(ROOT, "packs", "TailwailRP")
BP = os.path.join(ROOT, "packs", "TailwailBP")

# Documented Bedrock queries this project is allowed to use on the client.
KNOWN_QUERIES = {
    "q.property", "q.has_property", "q.delta_time", "q.modified_distance_moved", "q.ground_speed", "q.life_time",
    "q.hurt_time", "q.anim_time", "q.all_animations_finished", "q.any_animation_finished", "q.is_on_ground",
    "q.modified_move_speed", "q.target_x_rotation", "q.target_y_rotation", "q.head_x_rotation",
    "q.head_y_rotation", "q.is_moving", "q.vertical_speed", "q.time_of_day", "q.is_alive", "q.body_y_rotation",
    "q.walk_distance", "q.is_in_water", "q.is_baby", "q.variant", "q.mark_variant", "q.is_sneaking",
    "q.time_stamp", "q.frame_alpha", "q.camera_distance_range_lerp", "q.distance_from_camera",
}

PROP_RE = re.compile(r"q(?:uery)?\.(?:property|has_property)\(\s*'([^']+)'\s*\)(?:\s*(==|!=)\s*('?[^)\s&|]+'?))?", re.I)

errors = []
warnings = []
notes = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def load(path):
    with open(path) as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------------------
class Pack:
    def __init__(self):
        self.anims = {}
        self.anim_file = {}
        for f in sorted(glob.glob(os.path.join(RP, "animations", "*.json"))):
            for k, v in load(f)["animations"].items():
                if k in self.anims:
                    err("animation %s defined twice (%s, %s)" % (k, self.anim_file[k], os.path.basename(f)))
                self.anims[k] = v
                self.anim_file[k] = os.path.basename(f)
        self.ctrls = {}
        for f in sorted(glob.glob(os.path.join(RP, "animation_controllers", "*.json"))):
            for k, v in load(f)["animation_controllers"].items():
                self.ctrls[k] = v
        self.clients = {}
        for f in sorted(glob.glob(os.path.join(RP, "entity", "*.json"))):
            d = load(f)["minecraft:client_entity"]["description"]
            self.clients[d["identifier"]] = d
        self.servers = {}
        for f in sorted(glob.glob(os.path.join(BP, "entities", "*.json"))):
            d = load(f)["minecraft:entity"]
            self.servers[d["description"]["identifier"]] = d
        self.geo = {}
        for f in sorted(glob.glob(os.path.join(RP, "models", "entity", "*.json"))):
            for g in load(f)["minecraft:geometry"]:
                self.geo[g["description"]["identifier"]] = (f, g)


def parse_or_err(src, where):
    if isinstance(src, (int, float)):
        return set()
    try:
        return molang.identifiers(src)
    except molang.MolangError as e:
        err("%s: Molang does not parse (%s): %r" % (where, e, src))
        return set()


def check_props_in(src, where, props):
    if not isinstance(src, str):
        return
    for m in PROP_RE.finditer(src):
        name, op, val = m.group(1), m.group(2), m.group(3)
        if name not in props:
            err("%s: q.property('%s') is not declared on the behavior entity" % (where, name))
            continue
        p = props[name]
        if not p.get("client_sync"):
            err("%s: q.property('%s') is read on the client but not client_sync" % (where, name))
        if op and val is not None:
            is_str = val.startswith("'")
            if p["type"] == "enum":
                if not is_str:
                    err("%s: enum property %s compared with a number" % (where, name))
                elif val.strip("'") not in p["values"]:
                    err("%s: %s compared with '%s', not one of its values" % (where, name, val.strip("'")))
            elif is_str:
                err("%s: %s property %s compared with a string" % (where, p["type"], name))
            elif p["type"] == "int":
                try:
                    n = float(val)
                    lo, hi = p.get("range", [-2 ** 31, 2 ** 31])
                    if not lo <= n <= hi:
                        err("%s: %s compared with %s outside its range %s" % (where, name, val, p.get("range")))
                except ValueError:
                    pass


def statements_writes(src):
    """Variables assigned by a statement list."""
    try:
        prog = molang.parse(src)
    except molang.MolangError:
        return set()
    return {st[1] for st in prog[1] if st[0] == "assign"}


def walk_controller(pack, cid, amap, where, used_anims, reads, props, seen):
    if cid in seen:
        return
    seen.add(cid)
    ctl = pack.ctrls[cid]
    states = ctl.get("states", {})
    init = ctl.get("initial_state", "default")
    if init not in states:
        err("%s: initial_state %s missing" % (cid, init))
    for sname, st in states.items():
        w = "%s/%s" % (cid, sname)
        for entry in st.get("animations", []):
            if isinstance(entry, str):
                name, expr = entry, None
            else:
                (name, expr), = entry.items()
            if name not in amap:
                err("%s: animation '%s' not in the client entity's animation map" % (w, name))
                continue
            if expr is not None:
                reads |= parse_or_err(expr, w + " weight " + name)
                check_props_in(expr, w, props)
            full = amap[name]
            if full in pack.ctrls:
                walk_controller(pack, full, amap, where, used_anims, reads, props, seen)
            else:
                used_anims.add(full)
        for tr in st.get("transitions", []):
            (target, expr), = tr.items()
            if target not in states:
                err("%s: transition to missing state %s" % (w, target))
            reads |= parse_or_err(expr, w + " -> " + target)
            check_props_in(expr, w, props)
        for key in ("on_entry", "on_exit"):
            for stmt in st.get(key, []):
                if isinstance(stmt, str) and not stmt.startswith("@") and not stmt.startswith("/"):
                    reads |= parse_or_err(stmt, w + " " + key)
        if "blend_transition" in st and not isinstance(st["blend_transition"], (int, float)):
            err("%s: blend_transition must be a number" % w)


def static_checks(pack):
    summary = {}
    for ident, d in pack.clients.items():
        where = ident
        server = pack.servers.get(ident)
        props = (server or {}).get("description", {}).get("properties", {}) if server else {}
        amap = d.get("animations", {})
        for short, full in amap.items():
            if full not in pack.anims and full not in pack.ctrls:
                err("%s: animation map %s -> %s does not exist" % (where, short, full))
        geo_id = d.get("geometry", {}).get("default")
        if geo_id not in pack.geo:
            err("%s: geometry %s missing" % (where, geo_id))
            bones = set()
        else:
            bones = {b["name"] for b in pack.geo[geo_id][1]["bones"]}
        scripts = d.get("scripts", {})
        writes = set()
        reads = set()
        for key in ("initialize", "pre_animation"):
            for line in scripts.get(key, []):
                reads |= parse_or_err(line, "%s scripts.%s" % (where, key))
                writes |= statements_writes(line)
                check_props_in(line, where + " scripts." + key, props)
        if "scale" in scripts:
            reads |= parse_or_err(scripts["scale"], where + " scale")
        used_anims = set()
        seen = set()
        for entry in scripts.get("animate", []):
            if isinstance(entry, str):
                name, expr = entry, None
            else:
                (name, expr), = entry.items()
                reads |= parse_or_err(expr, where + " animate " + name)
            if name not in amap:
                err("%s: scripts.animate %s is not in the animation map" % (where, name))
                continue
            full = amap[name]
            if full in pack.ctrls:
                walk_controller(pack, full, amap, where, used_anims, reads, props, seen)
            else:
                used_anims.add(full)
        anim_bones = set()
        for full in sorted(used_anims):
            a = pack.anims.get(full)
            if a is None:
                continue
            for key in ("anim_time_update", "blend_weight", "start_delay", "loop_delay"):
                if key in a:
                    reads |= parse_or_err(a[key], "%s %s" % (full, key))
            for bone, chans in a.get("bones", {}).items():
                anim_bones.add(bone)
                if bones and bone not in bones:
                    err("%s animates bone %s missing from %s" % (full, bone, geo_id))
                for ch, val in chans.items():
                    for expr in iter_channel_exprs(val):
                        reads |= parse_or_err(expr, "%s %s.%s" % (full, bone, ch))
            for t, stmts in a.get("timeline", {}).items():
                for s in stmts if isinstance(stmts, list) else [stmts]:
                    reads |= parse_or_err(s, "%s timeline %s" % (full, t))
                    writes |= statements_writes(s)
        unread_writes = writes - reads
        queries = {r for r in reads if r.startswith("q.")}
        for q in sorted(queries - KNOWN_QUERIES):
            err("%s: unknown or unvetted query %s" % (where, q))
        variables = {r for r in reads if r.startswith("v.")}
        missing = variables - writes
        for v in sorted(missing):
            err("%s: variable %s is read but never written (it would read as 0)" % (where, v))
        for v in sorted(unread_writes):
            if v.startswith("v."):
                warn("%s: variable %s is written but never read" % (where, v))
        summary[ident] = {
            "anim_refs": len(amap), "anims_used": len(used_anims), "controllers": len(seen),
            "variables": len(variables), "queries": sorted(queries), "bones_animated": len(anim_bones),
        }
    return summary


def iter_channel_exprs(val):
    if isinstance(val, (list, str, int, float)):
        for x in val if isinstance(val, list) else [val]:
            if isinstance(x, str):
                yield x
        return
    if isinstance(val, dict):
        for k, kv in val.items():
            if isinstance(kv, dict):
                for kk in ("pre", "post"):
                    if kk in kv:
                        yield from iter_channel_exprs(kv[kk])
            else:
                yield from iter_channel_exprs(kv)


def loop_policy(pack, body_ctrl, amap):
    """Clips in script-held body states must loop or hold their last frame."""
    ctl = pack.ctrls[body_ctrl]
    for sname, st in ctl["states"].items():
        for entry in st.get("animations", []):
            name = entry if isinstance(entry, str) else next(iter(entry))
            a = pack.anims.get(amap.get(name))
            if a is None:
                continue
            loop = a.get("loop", False)
            if loop is False and float(a.get("animation_length", 0)) > 0 and "anim_time_update" not in a:
                err("%s/%s: clip %s is loop:false; it stops after %.2fs and the bones snap to bind pose while the"
                    " script still holds the state" % (body_ctrl, sname, name, float(a["animation_length"])))


# ---------------------------------------------------------------------------------------
# Frame simulation
# ---------------------------------------------------------------------------------------
class ClientSim:
    def __init__(self, pack, ident, fps=60):
        self.pack = pack
        self.d = pack.clients[ident]
        self.amap = self.d["animations"]
        server = pack.servers[ident]
        self.props_decl = server["description"].get("properties", {})
        self.props = {k: p.get("default", 0) for k, p in self.props_decl.items()}
        for k, p in self.props_decl.items():
            if p["type"] == "enum" and isinstance(p.get("default"), str):
                self.props[k] = p["default"]
        self.dt = 1.0 / fps
        self.time = 0.0
        self.dist = 0.0
        self.speed = 0.0
        self.hurt_time = 0.0
        self.ctx = molang.Context(variables={}, queries=self.queries())
        self.ctrls = []
        for entry in self.d["scripts"].get("animate", []):
            name = entry if isinstance(entry, str) else next(iter(entry))
            full = self.amap[name]
            if full in pack.ctrls:
                c = pack.ctrls[full]
                self.ctrls.append({"name": name, "id": full, "c": c, "state": c.get("initial_state", "default"),
                                   "entered": 0.0, "prev": None, "prev_entered": 0.0, "changed_at": -99.0})
        for line in self.d["scripts"].get("initialize", []):
            molang.run(line, self.ctx)

    def queries(self):
        sim = self

        def prop(name):
            return sim.props[name]

        return {
            "q.property": prop,
            "q.has_property": lambda name: 1.0 if name in sim.props else 0.0,
            "q.delta_time": lambda: sim.dt,
            "q.modified_distance_moved": lambda: sim.dist,
            "q.ground_speed": lambda: sim.speed,
            "q.life_time": lambda: sim.time,
            "q.hurt_time": lambda: sim.hurt_time,
            "q.all_animations_finished": lambda: sim._finished(all),
            "q.any_animation_finished": lambda: sim._finished(any),
            "q.is_on_ground": 1.0,
            "q.is_alive": 1.0,
        }

    def _finished(self, agg):
        c = self._current
        st = c["c"]["states"][c["state"]]
        names = [e if isinstance(e, str) else next(iter(e)) for e in st.get("animations", [])]
        if not names:
            return 1.0
        res = []
        for n in names:
            a = self.pack.anims.get(self.amap[n])
            if a is None:
                res.append(True)
                continue
            if a.get("loop", False) is True:
                res.append(False)
            else:
                res.append(self.time - c["entered"] >= float(a.get("animation_length", 0)) - 1e-9)
        return 1.0 if agg(res) else 0.0

    def step(self):
        self.time += self.dt
        self.dist += self.speed * self.dt
        q = self.ctx.q
        self.ctx.q = self._frozen_queries()
        for line in self.d["scripts"].get("pre_animation", []):
            molang.run(line, self.ctx)
        for c in self.ctrls:
            self._current = c
            st = c["c"]["states"][c["state"]]
            for tr in st.get("transitions", []):
                (target, expr), = tr.items()
                if molang.num(molang.run(expr, self.ctx)):
                    c["prev"], c["prev_entered"] = c["state"], c["entered"]
                    c["state"], c["entered"], c["changed_at"] = target, self.time, self.time
                    break
        self.ctx.q = q
        for k, v in self.ctx.v.items():
            if isinstance(v, float) and not math.isfinite(v):
                err("variable %s became non-finite at t=%.2f" % (k, self.time))

    def _frozen_queries(self):
        base = self.queries()
        out = {}
        for k, v in base.items():
            if k in ("q.property", "q.has_property", "q.all_animations_finished", "q.any_animation_finished"):
                out[k] = v
            elif callable(v):
                out[k] = v()
            else:
                out[k] = v
        return out

    def weights(self):
        """[(controller, state, anim short name, weight)] for the active states."""
        out = []
        self.ctx.q = self._frozen_queries()
        for c in self.ctrls:
            self._current = c
            st = c["c"]["states"][c["state"]]
            for entry in st.get("animations", []):
                if isinstance(entry, str):
                    out.append((c["name"], c["state"], entry, 1.0))
                else:
                    (n, expr), = entry.items()
                    out.append((c["name"], c["state"], n, float(molang.num(molang.run(expr, self.ctx)))))
        return out

    def state(self, ctrl_name):
        for c in self.ctrls:
            if c["name"] == ctrl_name:
                return c["state"]
        raise KeyError(ctrl_name)

    def entered(self, ctrl_name):
        for c in self.ctrls:
            if c["name"] == ctrl_name:
                return c["entered"]
        raise KeyError(ctrl_name)

    def run(self, seconds):
        n = max(1, int(round(seconds / self.dt)))
        for _ in range(n):
            self.step()


def dynamic_checks(pack, quick=False):
    out = {}
    ident = "tailwail:tall_wail"
    sim = ClientSim(pack, ident)
    body = sim.ctrls[0]
    states = body["c"]["states"]
    pose_states = sorted((s for s in states if re.match(r"^p\d+$", s)), key=lambda s: int(s[1:]))
    rng = random.Random(7)
    # 1. every pose reachable from every pose in one frame
    hops = 0
    for a in pose_states:
        for b in pose_states:
            if a == b:
                continue
            sim.props["tailwail:pose"] = int(a[1:])
            sim.step()
            if sim.state("ctrl_body") != a:
                err("pose %s not entered within one frame" % a)
            sim.props["tailwail:pose"] = int(b[1:])
            sim.step()
            if sim.state("ctrl_body") != b:
                err("pose %s -> %s did not transition within one frame" % (a, b))
            hops += 1
    out["pose_hops_checked"] = hops
    # 2. random schedule with dwell times, ground speed and posture changes
    desync = 0
    lo, hi = sim.props_decl["tailwail:pose"].get("range", [0, 40])
    steps = 150 if quick else 600
    max_w = 0.0
    for i in range(steps):
        p = int(rng.choice(pose_states)[1:])
        sim.props["tailwail:pose"] = p
        sim.props["tailwail:posture"] = rng.choice([0, 0, 1, 2])
        sim.props["tailwail:tail"] = rng.randrange(0, 5)
        sim.props["tailwail:breath"] = rng.randrange(0, 4)
        sim.props["tailwail:tremor"] = rng.randrange(0, 4)
        sim.props["tailwail:jaw"] = rng.choice([0, 2, 12, 35, 60])
        sim.props["tailwail:look_yaw"] = rng.randrange(-180, 181)
        sim.props["tailwail:look_pitch"] = rng.randrange(-60, 61)
        sim.props["tailwail:mimic"] = rng.randrange(0, 5)
        sim.props["tailwail:mimic_amt"] = rng.random() * 2
        sim.props["tailwail:headroom"] = rng.randrange(0, 9)
        sim.speed = rng.choice([0.0, 0.0, 0.8, 1.6, 3.9, 6.9])
        dwell = rng.randrange(1, 40)
        for _ in range(dwell):
            sim.step()
            for ctl, st, n, w in sim.weights():
                if not math.isfinite(w) or w < -1e-6 or w > 1.05:
                    err("weight out of range: %s/%s %s = %.3f" % (ctl, st, n, w))
                max_w = max(max_w, w)
        if sim.state("ctrl_body") != "p%d" % p:
            desync += 1
        if sim.state("ctrl_tail") not in ("drag", "twitch", "rigid", "free", "curl"):
            err("tail controller in unexpected state %s" % sim.state("ctrl_tail"))
    if desync:
        err("body controller desynchronised from tailwail:pose %d times in the random schedule" % desync)
    out["random_steps"] = steps
    out["max_weight"] = round(max_w, 3)
    # posture weights sum to 1 in steady state
    sim.props["tailwail:pose"] = 0
    for pt in (0, 1, 2):
        sim.props["tailwail:posture"] = pt
        sim.run(3.0)
        s = sim.ctx.v["v.w_t"] + sim.ctx.v["v.w_h"] + sim.ctx.v["v.w_c"]
        if abs(s - 1.0) > 0.02:
            err("posture weights do not sum to 1 for posture %d (%.3f)" % (pt, s))
        dom = ["v.w_t", "v.w_h", "v.w_c"][pt]
        if sim.ctx.v[dom] < 0.97:
            err("posture %d weight only reaches %.2f after 3 s" % (pt, sim.ctx.v[dom]))
    # 3. hurt flinch returns
    sim.props["tailwail:pose"] = 0
    sim.hurt_time = 10
    sim.run(0.2)
    if sim.state("ctrl_hurt") != "hurt":
        err("hurt controller did not enter hurt")
    sim.hurt_time = 0
    sim.run(1.0)
    if sim.state("ctrl_hurt") != "default":
        err("hurt controller did not return to default after the flinch")
    # dead creatures do not flinch
    sim.props["tailwail:pose"] = 26
    sim.run(0.2)
    sim.hurt_time = 10
    sim.run(0.2)
    if sim.state("ctrl_hurt") == "hurt":
        err("hurt flinch plays during death")
    sim.hurt_time = 0
    sim.run(1.0)
    # 4. stride sync: v.walk advances 360 per stride length at gallop
    sim.props["tailwail:pose"] = 0
    sim.props["tailwail:posture"] = 0
    sim.speed = 6.9
    sim.run(2.0)
    w0 = sim.ctx.v["v.walk"]
    d0 = sim.dist
    acc = 0.0
    prev = w0
    for _ in range(120):
        sim.step()
        dw = (sim.ctx.v["v.walk"] - prev) % 360.0
        acc += dw
        prev = sim.ctx.v["v.walk"]
    stride = (sim.dist - d0) / (acc / 360.0) if acc else 0
    out["gallop_stride_blocks"] = round(stride, 2)
    if not 2.6 <= stride <= 3.2:
        err("gallop stride %.2f blocks, expected ~2.89" % stride)
    out["final_states"] = {c["name"]: c["state"] for c in sim.ctrls}
    return out


# ---------------------------------------------------------------------------------------
# Composite posing (body + overlays) and grounding
# ---------------------------------------------------------------------------------------
class _MolangShim:
    """Lets bedrock_model sample channels with the strict evaluator."""

    def __init__(self):
        self.cache = {}

    def compile(self, expr):
        if isinstance(expr, (int, float)):
            v = float(expr)
            return lambda env: v
        if expr not in self.cache:
            molang.parse(expr)

            def fn(env, expr=expr):
                ctx = molang.Context(variables={k: v for k, v in env.items() if k.startswith(("v.", "t."))},
                                     queries={k: v for k, v in env.items() if k.startswith("q.")})
                return float(molang.num(molang.run(expr, ctx)))

            self.cache[expr] = fn
        return self.cache[expr]


def composite(pack, sim, t_anim=None):
    """Samples every active clip (with its weight and its own anim time) into one pose."""
    shim = _MolangShim()
    old = bm.MOLANG
    bm.MOLANG = shim
    try:
        pose = {}
        env = dict(sim.ctx.v)
        sim.ctx.q = sim._frozen_queries()
        env.update({k: v for k, v in sim.ctx.q.items() if not callable(v)})
        for ctl, st, name, w in sim.weights():
            if w <= 1e-4:
                continue
            full = sim.amap[name]
            data = pack.anims[full]
            anim = _anim_cache(full, data)
            c = next(c for c in sim.ctrls if c["name"] == ctl)
            local = sim.time - c["entered"]
            if anim.anim_time_update:
                local = shim.compile(anim.anim_time_update)(dict(env, **{"q.anim_time": local}))
            if anim.loop is False and anim.length > 0 and local > anim.length and not anim.anim_time_update:
                continue
            env["q.anim_time"] = local
            sampled = anim.sample(local, env)
            for bone, chans in sampled.items():
                dst = pose.setdefault(bone, {})
                for ch, v in chans.items():
                    if ch == "scale":
                        dst[ch] = dst.get(ch, 1.0) * (1 + (v - 1) * w)
                    else:
                        dst[ch] = dst.get(ch, 0.0) + v * w
        return pose
    finally:
        bm.MOLANG = old


_ANIM = {}


def _anim_cache(full, data):
    if full not in _ANIM:
        shim = _MolangShim()
        old = bm.MOLANG
        bm.MOLANG = shim
        try:
            _ANIM[full] = bm.Animation(full, data)
        finally:
            bm.MOLANG = old
    return _ANIM[full]


def grounding(pack, quick=False):
    ident = "tailwail:tall_wail"
    d = pack.clients[ident]
    geo_path = pack.geo[d["geometry"]["default"]][0]
    geo = bm.Geometry(geo_path)
    scale = float(d["scripts"].get("scale", "1"))
    k = scale / 16.0
    import gen_client_v2 as g
    pose_names = {pid: name for pid, name, _, _ in g.POSES}
    rows = []
    cases = []
    for pid, name in sorted(pose_names.items()):
        if name == "loco":
            for pt, pname in ((0, "tall"), (1, "hunch"), (2, "crawl")):
                for spd, sname in ((0.0, "idle"), (1.2, "creep"), (6.9, "run")):
                    cases.append(("loco/%s/%s" % (pname, sname), 0, pt, spd))
        else:
            cases.append((name, pid, 0 if name not in ("unfold_low", "windup_c", "death_low") else 1, 0.0))
    if quick:
        cases = cases[::3]
    for label, pid, pt, spd in cases:
        sim = ClientSim(pack, ident, fps=30)
        sim.props["tailwail:posture"] = pt
        sim.props["tailwail:headroom"] = 8
        sim.speed = spd
        sim.run(3.0)
        sim.props["tailwail:pose"] = pid
        lows, highs = [], []
        for _ in range(8):
            sim.run(0.25)
            pose = composite(pack, sim)
            pts = geo.bone_points(pose)
            ys = [p[:, 1].min() for p in pts.values()]
            hs = [p[:, 1].max() for p in pts.values()]
            lows.append(min(ys) * k)
            highs.append(max(hs) * k)
        rows.append((label, min(lows), max(lows), max(highs)))
    return rows


def tail_sweep(pack, quick=False):
    """Every tail state in every posture: the tail never sinks into the floor, and in the
    tunnel crawl it stays under a 2-block ceiling."""
    ident = "tailwail:tall_wail"
    d = pack.clients[ident]
    geo = bm.Geometry(pack.geo[d["geometry"]["default"]][0])
    k = float(d["scripts"].get("scale", "1")) / 16.0
    tails = [b for b in geo.order if b.startswith("tail")]
    rows = []
    for pt in (0, 1, 2):
        for tail in range(5):
            for spd in ((0.0, 6.9) if not quick else (0.0,)):
                sim = ClientSim(pack, ident, fps=30)
                sim.props["tailwail:posture"] = pt
                sim.props["tailwail:tail"] = tail
                sim.speed = spd
                lo, hi = 9.0, -9.0
                for _ in range(8):
                    sim.run(0.5)
                    pts = geo.bone_points(composite(pack, sim), tails)
                    lo = min(lo, min(p[:, 1].min() for p in pts.values()) * k)
                    hi = max(hi, max(p[:, 1].max() for p in pts.values()) * k)
                rows.append((pt, tail, spd, lo, hi))
                if lo < -0.12:
                    err("tail sinks %.2f blocks into the floor (posture %d, tail %d, speed %.1f)" % (lo, pt, tail, spd))
                if pt == 2 and hi > 2.0:
                    err("tail reaches %.2f blocks in the tunnel crawl (posture 2, tail %d)" % (hi, tail))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", default=os.path.join(ROOT, "docs", "generated", "client_sim_report.md"))
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--no-ground", action="store_true")
    args = ap.parse_args()
    pack = Pack()
    summary = static_checks(pack)
    tw = pack.clients["tailwail:tall_wail"]
    body_short = tw["scripts"]["animate"][0]
    body_short = body_short if isinstance(body_short, str) else next(iter(body_short))
    loop_policy(pack, tw["animations"][body_short], tw["animations"])
    dyn = dynamic_checks(pack, quick=args.quick) if not errors else {}
    rows = grounding(pack, quick=args.quick) if not errors and not args.no_ground else []
    trows = tail_sweep(pack, quick=args.quick) if not errors and not args.no_ground else []
    for label, lo_min, lo_max, hi in rows:
        floating = lo_min > 0.2
        sinking = lo_max < -0.25
        dead = label.startswith("death")
        if (floating or sinking) and not dead:
            err("%s: lowest point %.2f..%.2f blocks (should touch y=0)" % (label, lo_min, lo_max))
    lines = ["# Client simulation report", "",
             "Generated by `tools/client_sim.py`. Static wiring checks, a 60 fps controller simulation and",
             "composite-pose grounding (body + every overlay, 1.5x scale, blocks).", ""]
    lines.append("## Static")
    for ident, s in summary.items():
        lines.append("* `%s`: %d animation refs, %d clips used, %d controllers, %d variables, %d bones animated;"
                     " queries: %s" % (ident, s["anim_refs"], s["anims_used"], s["controllers"], s["variables"],
                                       s["bones_animated"], ", ".join(s["queries"])))
    lines.append("")
    if dyn:
        lines.append("## Dynamic")
        for k2, v in dyn.items():
            lines.append("* %s: %s" % (k2, v))
        lines.append("")
    if rows:
        lines.append("## Grounding (lowest point min..max over 2 s, peak height)")
        lines.append("")
        lines.append("| state | lowest (blocks) | peak (blocks) |")
        lines.append("|---|---|---|")
        for label, lo_min, lo_max, hi in rows:
            lines.append("| %s | %.2f .. %.2f | %.2f |" % (label, lo_min, lo_max, hi))
        lines.append("")
    if trows:
        lines.append("## Tail (every tail state x posture: lowest / highest tail point, blocks)")
        lines.append("")
        lines.append("| posture | tail | speed | lowest | highest |")
        lines.append("|---|---|---|---|---|")
        for pt, tail, spd, lo, hi in trows:
            lines.append("| %d | %d | %.1f | %.2f | %.2f |" % (pt, tail, spd, lo, hi))
        lines.append("")
    lines.append("## Result")
    lines.append("")
    lines.append("%d errors, %d warnings" % (len(errors), len(warnings)))
    for e in errors:
        lines.append("* ERROR " + e)
    for w in warnings:
        lines.append("* warn " + w)
    os.makedirs(os.path.dirname(args.report), exist_ok=True)
    with open(args.report, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\n".join(lines[-(len(errors) + len(warnings) + 1):]) if errors or warnings else lines[-1])
    if rows:
        for label, lo_min, lo_max, hi in rows:
            print("  %-28s low %5.2f..%5.2f  peak %5.2f" % (label, lo_min, lo_max, hi))
    if dyn:
        print("  dynamic:", json.dumps(dyn))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
