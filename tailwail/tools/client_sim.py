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

  * v3 robustness rule: outside pre_animation every variable read has a `??` fallback, so a
    failed pre-animation script degrades to sensible values instead of zero weights.

Dynamic checks (frame simulation at 60 fps, emulating controller semantics: one
transition per controller per frame, first true transition wins, animations restart on
state entry; weighted `animate` entries are evaluated every frame)
  * every body act is reachable from every other act within one frame and exits on the
    next property change; a 600-step random schedule never desynchronises;
  * all blend weights and variables stay finite and inside [0, 1.05]; the gait and tail
    weights sum to 1 and pick idle / walk / gallop by speed;
  * FAILURE MODES: with pre_animation not running at all, and with no property ever set,
    the default state still idles, walks and gallops (so the creature is never frozen);
  * the hurt flinch returns to its idle state and never plays during death;
  * gaits are distance-driven: the clip phase wraps exactly once per measured stride;
  * composite poses (body + all overlays, and every one-shot over the neutral state) are
    grounded: lowest point within tolerance of the floor, tunnel poses under 2 blocks.

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
        for expr in non_pre_exprs(pack, d, used_anims):
            for m in re.finditer(r"\bv(?:ariable)?\.([a-z_0-9]+)", expr):
                tail = expr[m.end():]
                if not re.match(r"\s*\?\?", tail):
                    err("%s: variable v.%s is read without a ?? fallback in %r" % (where, m.group(1), expr[:80]))
                    break
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


def non_pre_exprs(pack, d, used_anims):
    """Every Molang string evaluated outside pre_animation: animate weights, controller
    weights and transitions, animation channels and anim_time_update."""
    out = []
    amap = d.get("animations", {})
    for entry in d.get("scripts", {}).get("animate", []):
        if isinstance(entry, dict):
            out.append(next(iter(entry.values())))
    for full in set(amap.values()):
        ctl = pack.ctrls.get(full)
        if not ctl:
            continue
        for st in ctl.get("states", {}).values():
            for entry in st.get("animations", []):
                if isinstance(entry, dict):
                    out.append(next(iter(entry.values())))
            for tr in st.get("transitions", []):
                out.append(next(iter(tr.values())))
    for full in used_anims:
        a = pack.anims.get(full, {})
        if "anim_time_update" in a:
            out.append(a["anim_time_update"])
        for chans in a.get("bones", {}).values():
            for val in chans.values():
                out.extend(iter_channel_exprs(val))
    return [e for e in out if isinstance(e, str)]


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
    def __init__(self, pack, ident, fps=60, skip_pre=False):
        self.pack = pack
        self.skip_pre = skip_pre
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
        self.direct = []  # weighted animate entries that are plain clips: (name, weight expr or None)
        for entry in self.d["scripts"].get("animate", []):
            name = entry if isinstance(entry, str) else next(iter(entry))
            full = self.amap[name]
            if full in pack.ctrls:
                c = pack.ctrls[full]
                self.ctrls.append({"name": name, "id": full, "c": c, "state": c.get("initial_state", "default"),
                                   "entered": 0.0, "prev": None, "prev_entered": 0.0, "changed_at": -99.0})
            else:
                self.direct.append((name, None if isinstance(entry, str) else entry[name]))
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
        if not self.skip_pre:
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
        for n, expr in self.direct:
            out.append(("animate", "-", n, 1.0 if expr is None else float(molang.num(molang.run(expr, self.ctx)))))
        return out

    def weight_of(self, name):
        return sum(w for _, _, n, w in self.weights() if n == name)

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


def _acts():
    import gen_client_v3 as g
    return g


def dynamic_checks(pack, quick=False):
    g = _acts()
    out = {}
    ident = "tailwail:tall_wail"
    sim = ClientSim(pack, ident)
    acts = [a[0] for a in g.ACTS]
    ACT = "tailwail:act"
    rng = random.Random(7)
    # 1. every act reachable from every act in one frame
    hops = 0
    for a in acts:
        for b in acts:
            if a == b:
                continue
            sim.props[ACT] = a
            sim.step()
            if sim.state("ctrl_body") != "a%d" % a:
                err("act %d not entered within one frame" % a)
            sim.props[ACT] = b
            sim.step()
            if sim.state("ctrl_body") != "a%d" % b:
                err("act %d -> %d did not transition within one frame" % (a, b))
            hops += 1
    out["act_hops_checked"] = hops
    # 2. random schedule
    desync = 0
    steps = 150 if quick else 600
    max_w = 0.0
    for i in range(steps):
        a = rng.choice(acts)
        sim.props[ACT] = a
        sim.props["tailwail:tail"] = rng.randrange(0, 5)
        sim.props["tailwail:breath"] = rng.randrange(0, 4)
        sim.props["tailwail:tremor"] = rng.randrange(0, 4)
        sim.props["tailwail:jaw"] = rng.choice([0, 4, 12, 35, 60])
        sim.props["tailwail:look_yaw"] = rng.randrange(-180, 181)
        sim.props["tailwail:look_pitch"] = rng.randrange(-60, 61)
        sim.props["tailwail:mimic"] = rng.randrange(0, 5)
        sim.props["tailwail:mimic_amt"] = rng.random() * 2
        sim.speed = rng.choice([0.0, 0.0, 1.6, 2.6, 3.9, 6.9, 7.8, 10.0])
        dwell = rng.randrange(1, 40)
        for _ in range(dwell):
            sim.step()
            for ctl, st, n, w in sim.weights():
                if not math.isfinite(w) or w < -1e-6 or w > 1.05:
                    err("weight out of range: %s/%s %s = %.3f" % (ctl, st, n, w))
                max_w = max(max_w, w)
        if sim.state("ctrl_body") != "a%d" % a:
            desync += 1
    if desync:
        err("body controller desynchronised from tailwail:act %d times in the random schedule" % desync)
    out["random_steps"] = steps
    out["max_weight"] = round(max_w, 3)
    # 3. gait selection and sums (default act, settled speed)
    gaits = {}
    for spd, want in ((0.0, "idle"), (2.6, "walk"), (7.8, "gallop")):
        for skip in (False, True):
            s2 = ClientSim(pack, ident, skip_pre=skip)
            s2.speed = spd
            s2.run(2.0)
            ws = {n: s2.weight_of(n) for n in ("idle", "walk", "gallop")}
            tot = sum(ws.values())
            if abs(tot - 1.0) > 0.02:
                err("loco weights sum to %.3f at %.1f m/s (pre_animation %s)" % (tot, spd, "skipped" if skip else "on"))
            if ws[want] < 0.97:
                err("at %.1f m/s %s weighs only %.2f (pre_animation %s)" % (spd, want, ws[want], "skipped" if skip else "on"))
            gaits["%s%s" % (want, "/no-pre" if skip else "")] = round(ws[want], 3)
    out["gait_weights"] = gaits
    # 4. failure mode: no pre_animation at all -> overlays still on, nothing reads as zero weight
    s3 = ClientSim(pack, ident, skip_pre=True)
    s3.run(1.0)
    for n in ("breath", "tremor", "look", "jaw", "tail_free"):
        if s3.weight_of(n) < 0.99:
            err("with pre_animation failing, overlay %s weighs %.2f" % (n, s3.weight_of(n)))
    out["failure_mode_overlays"] = "ok"
    # 5. tail weights follow the tail property; the tunnel crawl forces the floor-solved tail
    for tail in range(5):
        sim.props[ACT] = g.ACT_ID["loco"]
        sim.props["tailwail:tail"] = tail
        sim.run(2.0)
        tw = [sim.weight_of(n) for n in ("tail_free", "tail_lash", "tail_curl", "tail_rigid", "tail_tunnel")]
        if abs(sum(tw) - 1.0) > 0.02 or tw[tail] < 0.97:
            err("tail weights %s for tail mode %d" % ([round(x, 2) for x in tw], tail))
    sim.props[ACT] = g.ACT_ID["loco_tunnel"]
    sim.props["tailwail:tail"] = 1
    sim.run(2.0)
    if sim.weight_of("tail_tunnel") < 0.97:
        err("tunnel crawl does not hand the tail to tail_tunnel")
    # 6. hurt flinch returns; no flinch while dead
    sim.props[ACT] = g.ACT_ID["loco"]
    sim.hurt_time = 10
    sim.run(0.2)
    if sim.state("ctrl_hurt") != "hurt":
        err("hurt controller did not enter hurt")
    sim.hurt_time = 0
    sim.run(1.0)
    if sim.state("ctrl_hurt") != "default":
        err("hurt controller did not return to default after the flinch")
    sim.props[ACT] = g.ACT_ID["death"]
    sim.run(0.2)
    sim.hurt_time = 10
    sim.run(0.2)
    if sim.state("ctrl_hurt") == "hurt":
        err("hurt flinch plays during death")
    sim.hurt_time = 0
    sim.run(1.0)
    # 7. distance-driven gaits: phase wraps once per stride
    strides = {}
    for gname in ("gallop", "walk", "creep", "tunnel_move", "squeeze"):
        a = pack.anims[sim.amap[gname]]
        expr = a.get("anim_time_update", "")
        m = re.search(r"math\.mod\(q\.modified_distance_moved, ([0-9.]+)\)", expr)
        if not m:
            err("gait %s is not distance-driven (anim_time_update %r)" % (gname, expr))
            continue
        stride = float(m.group(1))
        wraps, prev = 0, None
        for i in range(400):
            dist = stride * 3.0 * i / 400.0
            ctx = molang.Context(variables={}, queries={"q.modified_distance_moved": dist})
            ph = float(molang.num(molang.run(expr, ctx)))
            if not 0.0 <= ph <= 1.0:
                err("gait %s phase %.3f out of [0, 1]" % (gname, ph))
            if prev is not None and ph < prev - 0.5:
                wraps += 1
            prev = ph
        if wraps not in (2, 3):
            err("gait %s phase wrapped %d times over 3 strides" % (gname, wraps))
        strides[gname] = stride
    out["strides_blocks"] = strides
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
            if ctl == "animate":
                local = sim.time
            else:
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


# acts that are not standing on the floor by design
AIRBORNE = {"cling", "climb", "death"}
TUNNEL = {"loco_tunnel", "reach_in"}
SQUEEZE = {"loco_squeeze"}  # through a 1-high gap
SQUEEZE_MAX = 1.15  # blocks, every overlay on (the collision box is 0.9)


def grounding(pack, quick=False):
    g = _acts()
    ident = "tailwail:tall_wail"
    d = pack.clients[ident]
    geo = bm.Geometry(pack.geo[d["geometry"]["default"]][0])
    k = float(d["scripts"].get("scale", "1")) / 16.0
    rows = []
    cases = []
    for aid, name, _, _ in g.ACTS:
        if name in ("loco", "loco_low", "loco_tunnel"):
            for spd, sname in ((0.0, "still"), (2.6, "walk"), (7.8, "run")):
                if name == "loco_tunnel" and spd > 3:
                    continue
                cases.append(("%s/%s" % (name, sname), aid, spd))
        elif name == "loco_squeeze":
            for spd, sname in ((0.0, "still"), (1.7, "crawl")):
                cases.append(("%s/%s" % (name, sname), aid, spd))
        elif name != "shot":
            cases.append((name, aid, 0.0))
    if quick:
        cases = cases[::3]
    for label, aid, spd in cases:
        sim = ClientSim(pack, ident, fps=30)
        sim.speed = spd
        sim.props["tailwail:act"] = aid
        sim.props["tailwail:look_yaw"] = 40
        sim.props["tailwail:breath"] = 3
        sim.props["tailwail:tremor"] = 3
        sim.props["tailwail:jaw"] = 30
        sim.run(1.0)
        lows, highs = [], []
        for _ in range(8):
            sim.run(0.37)
            pose = composite(pack, sim)
            pts = geo.bone_points(pose)
            lows.append(min(p[:, 1].min() for b, p in pts.items() if not b.startswith("tail")) * k)
            highs.append(max(p[:, 1].max() for b, p in pts.items() if not b.startswith("tail")) * k)
        rows.append((label, min(lows), max(lows), max(highs)))
        base = label.split("/")[0]
        if base not in AIRBORNE:
            if max(lows) < -0.3:
                err("%s sinks %.2f blocks into the floor" % (label, max(lows)))
            if min(lows) > 0.25:
                err("%s floats %.2f blocks above the floor" % (label, min(lows)))
        if base in TUNNEL and max(highs) > 2.0:
            err("%s reaches %.2f blocks: does not fit a 2-high tunnel" % (label, max(highs)))
        if base in SQUEEZE and max(highs) > SQUEEZE_MAX:
            err("%s reaches %.2f blocks: does not fit a 1-high gap" % (label, max(highs)))
    return rows


def shots_grounding(pack, quick=False):
    """Each one-shot as the script plays it: over the neutral 'shot' state (full clips) or over
    the galloping default state (partial clips), with every overlay on."""
    g = _acts()
    import anim_v3
    ident = "tailwail:tall_wail"
    d = pack.clients[ident]
    geo = bm.Geometry(pack.geo[d["geometry"]["default"]][0])
    k = float(d["scripts"].get("scale", "1")) / 16.0
    rows = []
    for name in anim_v3.SHOTS:
        full = anim_v3.V3 + name
        if full not in pack.anims:
            err("one-shot %s missing from the animation files" % full)
            continue
        data = pack.anims[full]
        if data.get("loop", False) is not False:
            err("one-shot %s must be loop:false (playAnimation ends it on finish)" % name)
        partial = name in anim_v3.PARTIAL_SHOTS
        sim = ClientSim(pack, ident, fps=30)
        sim.props["tailwail:act"] = g.ACT_ID["loco"] if partial else g.ACT_ID["shot"]
        sim.speed = 0.0
        sim.run(1.0)
        anim = _anim_cache(full, data)
        lows, highs = [], []
        n = 6 if quick else 12
        for i in range(n + 1):
            t = anim.length * i / n
            base = composite(pack, sim)
            shim = _MolangShim()
            old = bm.MOLANG
            bm.MOLANG = shim
            try:
                extra = anim.sample(t, {"q.life_time": t})
            finally:
                bm.MOLANG = old
            for bone, chans in extra.items():
                dst = base.setdefault(bone, {})
                for ch, v in chans.items():
                    dst[ch] = dst.get(ch, 0.0) + v
            pts = geo.bone_points(base)
            lows.append(min(p[:, 1].min() for b, p in pts.items() if not b.startswith("tail")) * k)
            highs.append(max(p[:, 1].max() for b, p in pts.items() if not b.startswith("tail")) * k)
        rows.append(("shot:" + name, min(lows), max(lows), max(highs)))
        if name != "drop" and min(lows) < -0.35:
            err("one-shot %s sinks %.2f blocks into the floor" % (name, min(lows)))
    return rows


def tail_sweep(pack, quick=False):
    """Every tail mode in every locomotion state: the tail never sinks into the floor, and in
    the tunnel crawl it stays under a 2-block ceiling."""
    g = _acts()
    ident = "tailwail:tall_wail"
    d = pack.clients[ident]
    geo = bm.Geometry(pack.geo[d["geometry"]["default"]][0])
    k = float(d["scripts"].get("scale", "1")) / 16.0
    tails = [b for b in geo.order if b.startswith("tail")]
    rows = []
    for act in ("loco", "loco_low", "loco_tunnel", "loco_squeeze"):
        for tail in range(5):
            for spd in ((0.0, 2.6, 7.8) if not quick else (0.0,)):
                if act in ("loco_tunnel", "loco_squeeze") and spd > 3:
                    continue
                sim = ClientSim(pack, ident, fps=30)
                sim.props["tailwail:act"] = g.ACT_ID[act]
                sim.props["tailwail:tail"] = tail
                sim.speed = spd
                lo, hi = 9.0, -9.0
                for _ in range(8):
                    sim.run(0.5)
                    pts = geo.bone_points(composite(pack, sim), tails)
                    lo = min(lo, min(p[:, 1].min() for p in pts.values()) * k)
                    hi = max(hi, max(p[:, 1].max() for p in pts.values()) * k)
                rows.append((act, tail, spd, lo, hi))
                if lo < -0.12:
                    err("tail sinks %.2f blocks into the floor (%s, tail %d, speed %.1f)" % (lo, act, tail, spd))
                if act == "loco_tunnel" and hi > 2.0:
                    err("tail reaches %.2f blocks in the tunnel crawl (tail %d)" % (hi, tail))
                if act == "loco_squeeze" and hi > SQUEEZE_MAX:
                    err("tail reaches %.2f blocks in the squeeze (tail %d)" % (hi, tail))
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
    rows += shots_grounding(pack, quick=args.quick) if not errors and not args.no_ground else []
    trows = tail_sweep(pack, quick=args.quick) if not errors and not args.no_ground else []
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
        lines.append("## Tail (every tail mode x locomotion state: lowest / highest tail point, blocks)")
        lines.append("")
        lines.append("| state | tail | speed | lowest | highest |")
        lines.append("|---|---|---|---|---|")
        for act, tail, spd, lo, hi in trows:
            lines.append("| %s | %d | %.1f | %.2f | %.2f |" % (act, tail, spd, lo, hi))
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
