#!/usr/bin/env python3
"""Runs the BDS runtime scenarios against a test copy of the behavior pack.

  python3 tools/bds_scenarios.py --server /path/to/bedrock-server [--only gaze,commit] [--log out.log]

Builds build/harness/TailwailBP = packs/TailwailBP + devtests/harness/devharness.js
(entry swapped to scripts/dev_main.js), starts BDS on a fresh flat world with no
experiments, triggers each scenario with /scriptevent twh:<name>, and prints the
[TWDEV] and [Tailwail] lines.  The shipped pack is never modified.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCENARIOS = {  # name -> seconds to wait
    "gaze": 6, "commit": 16, "wallstrike": 14, "escape": 55, "tunnel": 22, "stalk": 20, "imitate": 16,
    "calm": 26, "death": 8, "spawnsite": 8, "perf": 14,
}


def build_test_pack():
    dst = os.path.join(ROOT, "build", "harness", "TailwailBP")
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(os.path.join(ROOT, "packs", "TailwailBP"), dst)
    shutil.copy(os.path.join(ROOT, "devtests", "harness", "devharness.js"), os.path.join(dst, "scripts"))
    open(os.path.join(dst, "scripts", "dev_main.js"), "w").write('import "./main.js";\nimport "./devharness.js";\n')
    man = json.load(open(os.path.join(dst, "manifest.json")))
    for m in man["modules"]:
        if m["type"] == "script":
            m["entry"] = "scripts/dev_main.js"
    json.dump(man, open(os.path.join(dst, "manifest.json"), "w"), indent=2)
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--log", default=os.path.join(ROOT, "build", "bds_scenarios.log"))
    a = ap.parse_args()
    names = [n for n in (a.only.split(",") if a.only else SCENARIOS)]
    bp = build_test_pack()
    script = os.path.join(ROOT, "build", "harness", "commands.txt")
    with open(script, "w") as f:
        f.write("wait 3\ntickingarea add -16 -64 -16 90 0 50 twarena\nwait 4\n")
        for n in names:
            f.write("scriptevent twh:%s\nwait %d\n" % (n, SCENARIOS[n]))
    os.makedirs(os.path.dirname(a.log), exist_ok=True)
    cmd = [sys.executable, os.path.join(HERE, "bds_run.py"), "--server", a.server, "--bp", bp,
           "--rp", os.path.join(ROOT, "packs", "TailwailRP"), "--world", "twscenarios", "--fresh", "--flat",
           "--script", script, "--log", a.log, "--quiet"]
    subprocess.run(cmd, check=False)


if __name__ == "__main__":
    main()
