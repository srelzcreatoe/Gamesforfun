#!/usr/bin/env python3
"""Bedrock Dedicated Server test harness for The Observer.

Installs the add-on packs (and optionally the GameTest test kit) into a BDS
installation, prepares a test world, starts the server, feeds console commands
from a scenario file, and captures the console + content log.

Scenario file format (one step per line):
    wait <seconds>                 sleep
    cmd <console command>          send a console command (e.g. scriptevent ...)
    expect <regex> [timeout_s]     wait until a console line matches (fails on timeout)
    # comment

Usage:
    run_bds.py --bds DIR --scenario FILE [--world NAME] [--fresh] [--seed N]
               [--testkit] [--log OUT.txt] [--timeout 900]

Exit status 0 when every expect matched and no script/content errors were logged
(unless --allow-errors), 1 otherwise. A summary is printed at the end.
"""
import argparse
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ADDON = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import leveldat  # noqa: E402

PACKS = {
    "behavior": [os.path.join(ADDON, "packs", "TheObserver_BP")],
    "resource": [os.path.join(ADDON, "packs", "TheObserver_RP")],
}
TESTKIT = os.path.join(HERE, "testkit_BP")

ERROR_PATTERNS = [
    re.compile(r"\[Scripting\]\[error\]", re.I),
    re.compile(r"\bERROR\]", re.I),
    re.compile(r"\[(Json|Molang|Entity|Blocks|Item|Recipes|Actor|Animation|Geometry|Texture|Sounds|Particles)\]\[error\]", re.I),
]
IGNORE_ERRORS = [
    re.compile(r"NO LOG FILE"),
    re.compile(r"signaling", re.I),
]


def manifest(path):
    return json.load(open(os.path.join(path, "manifest.json")))


def install(bds, world, testkit, no_addon=False):
    entries = {"behavior": [], "resource": []}
    lists = dict(PACKS)
    if testkit:
        lists = {"behavior": PACKS["behavior"] + [TESTKIT], "resource": PACKS["resource"]}
    if no_addon:
        lists = {"behavior": [TESTKIT] if testkit else [], "resource": []}
    for kind, paths in lists.items():
        dest_root = os.path.join(bds, f"{kind}_packs")
        for p in paths:
            m = manifest(p)
            dest = os.path.join(dest_root, "observer_test_" + os.path.basename(p))
            if os.path.exists(dest):
                shutil.rmtree(dest)
            shutil.copytree(p, dest)
            if testkit and kind == "behavior" and p != TESTKIT:
                # test-only: let the add-on's script context bind GameTest simulated players.
                # The shipped manifest is untouched; only this installed copy is patched.
                mf = os.path.join(dest, "manifest.json")
                m2 = json.load(open(mf))
                m2["dependencies"].append({"module_name": "@minecraft/server-gametest", "version": "1.0.0-beta"})
                json.dump(m2, open(mf, "w"), indent=1)
                main = os.path.join(dest, "scripts", "main.js")
                src = open(main).read()
                open(main, "w").write('import "@minecraft/server-gametest";\n' + src)
            entries[kind].append({"pack_id": m["header"]["uuid"], "version": m["header"]["version"]})
    wdir = os.path.join(bds, "worlds", world)
    os.makedirs(wdir, exist_ok=True)
    json.dump(entries["behavior"], open(os.path.join(wdir, "world_behavior_packs.json"), "w"), indent=1)
    json.dump(entries["resource"], open(os.path.join(wdir, "world_resource_packs.json"), "w"), indent=1)
    return wdir


def set_props(bds, props):
    path = os.path.join(bds, "server.properties")
    lines = open(path).read().splitlines()
    seen = set()
    for i, line in enumerate(lines):
        if "=" in line and not line.startswith("#"):
            k = line.split("=", 1)[0]
            if k in props:
                lines[i] = f"{k}={props[k]}"
                seen.add(k)
    for k, v in props.items():
        if k not in seen:
            lines.append(f"{k}={v}")
    open(path, "w").write("\n".join(lines) + "\n")


class Server:
    def __init__(self, bds, log_path):
        self.q = queue.Queue()
        self.lines = []
        self.log = open(log_path, "a") if log_path else None
        env = dict(os.environ, LD_LIBRARY_PATH=bds)
        self.p = subprocess.Popen(["./bedrock_server"], cwd=bds, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, env=env, text=True, bufsize=1)
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        for line in self.p.stdout:
            line = line.rstrip("\n")
            self.lines.append(line)
            if self.log:
                self.log.write(line + "\n")
                self.log.flush()
            self.q.put(line)
        self.q.put(None)

    def send(self, cmd):
        self.p.stdin.write(cmd + "\n")
        self.p.stdin.flush()

    def expect(self, regex, timeout, start_index=0):
        rx = re.compile(regex)
        deadline = time.time() + timeout
        idx = start_index
        while time.time() < deadline:
            while idx < len(self.lines):
                if rx.search(self.lines[idx]):
                    return idx + 1, self.lines[idx]
                idx += 1
            if self.p.poll() is not None:
                return None, None
            time.sleep(0.05)
        return None, None

    def stop(self, timeout=60):
        if self.p.poll() is None:
            try:
                self.send("stop")
            except BrokenPipeError:
                pass
            try:
                self.p.wait(timeout)
            except subprocess.TimeoutExpired:
                self.p.kill()
        if self.log:
            self.log.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bds", required=True)
    ap.add_argument("--scenario", required=True)
    ap.add_argument("--world", default="observer_test")
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--seed", default="424242")
    ap.add_argument("--testkit", action="store_true")
    ap.add_argument("--log")
    ap.add_argument("--timeout", type=float, default=900)
    ap.add_argument("--allow-errors", action="store_true")
    ap.add_argument("--gamemode", default="survival")
    ap.add_argument("--difficulty", default="normal")
    ap.add_argument("--no-addon", action="store_true", help="baseline run with only the test kit")
    a = ap.parse_args()

    bds = os.path.abspath(a.bds)
    wdir = os.path.join(bds, "worlds", a.world)
    if a.fresh and os.path.exists(wdir):
        shutil.rmtree(wdir)
    if a.log and os.path.exists(a.log):
        os.remove(a.log)
    set_props(bds, {"level-name": a.world, "level-seed": a.seed, "allow-cheats": "true", "online-mode": "false",
                    "allow-list": "false", "content-log-file-enabled": "true",
                    "content-log-console-output-enabled": "true", "gamemode": a.gamemode,
                    "difficulty": a.difficulty, "enable-lan-visibility": "false", "content-log-level": "info",
                    "tick-distance": "6"})
    install(bds, a.world, a.testkit, a.no_addon)
    t0 = time.time()

    if not os.path.exists(os.path.join(wdir, "level.dat")):
        # first boot generates the world; then enable experiments for the test kit
        s = Server(bds, a.log)
        ok, _ = s.expect(r"Server started\.", 180)
        s.stop()
        if not ok:
            print("FAIL: server did not start for world generation")
            return 1
    ver, name, root = leveldat.load(os.path.join(wdir, "level.dat"))
    exp = root.get("experiments", (leveldat.TAG_COMPOUND, {}))[1]
    if a.testkit:
        exp["gametest"] = (leveldat.TAG_BYTE, 1)
        exp["experiments_ever_used"] = (leveldat.TAG_BYTE, 1)
        exp["saved_with_toggled_experiments"] = (leveldat.TAG_BYTE, 1)
    root["experiments"] = (leveldat.TAG_COMPOUND, exp)
    root["cheatsEnabled"] = (leveldat.TAG_BYTE, 1)
    root["commandsEnabled"] = (leveldat.TAG_BYTE, 1)
    leveldat.save(os.path.join(wdir, "level.dat"), ver, name, root)

    s = Server(bds, a.log)
    failures = []
    pos = 0
    ok, _ = s.expect(r"Server started\.", 180)
    if not ok:
        failures.append("server did not start")
    else:
        for raw in open(a.scenario):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if time.time() - t0 > a.timeout:
                failures.append("scenario timeout")
                break
            verb, _, rest = line.partition(" ")
            if verb == "wait":
                time.sleep(float(rest))
            elif verb == "cmd":
                s.send(rest)
            elif verb == "expect":
                m = re.match(r"(.*?)\s+(\d+(?:\.\d+)?)$", rest)
                regex, tmo = (m.group(1), float(m.group(2))) if m else (rest, 60.0)
                idx, matched = s.expect(regex, tmo, pos)
                if idx is None:
                    failures.append(f"expect timed out: {regex}")
                    print(f"[harness] EXPECT FAILED: {regex}")
                else:
                    pos = idx
                    print(f"[harness] expect ok: {matched.strip()[:160]}")
            else:
                failures.append(f"bad scenario line: {line}")
    s.stop()

    errors = []
    for line in s.lines:
        if any(p.search(line) for p in ERROR_PATTERNS) and not any(p.search(line) for p in IGNORE_ERRORS):
            errors.append(line)
    passes = [l for l in s.lines if "[OTEST] PASS" in l]
    fails = [l for l in s.lines if "[OTEST] FAIL" in l]
    print("\n===== SUMMARY =====")
    print(f"runtime: {time.time() - t0:.1f}s, console lines: {len(s.lines)}")
    print(f"OTEST pass: {len(passes)}, fail: {len(fails)}")
    for l in fails:
        print("  ", l)
    print(f"errors logged: {len(errors)}")
    for l in errors[:60]:
        print("  ", l)
    for f in failures:
        print("HARNESS FAILURE:", f)
    bad = failures or fails or (errors and not a.allow_errors)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
