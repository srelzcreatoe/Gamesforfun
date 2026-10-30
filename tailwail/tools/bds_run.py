#!/usr/bin/env python3
"""Run a Bedrock Dedicated Server headlessly with Tailwail packs for runtime checks.

  python3 tools/bds_run.py --server /path/to/bedrock-server \
      --bp packs/TailwailBP --rp packs/TailwailRP --bp devtests/TailwailDevBP \
      --world twtest --fresh --flat --script cmds.txt --log out.log

The script file holds console commands, one per line; "wait N" sleeps N
seconds and "waitfor TEXT" blocks until TEXT appears in the output (60 s
timeout).  The server is stopped at the end.  Every content-log line and every
line containing [TWDEV] or [Tailwail] is echoed.

This tool edits server.properties and the worlds/ folder of the given server
directory; point it at a scratch copy of BDS, never a production server.
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

PROPS = {
    "allow-cheats": "true",
    "content-log-console-output-enabled": "true",
    "content-log-file-enabled": "true",
    "content-log-level": "verbose",
    "online-mode": "false",
    "allow-list": "false",
    "enable-lan-visibility": "false",
    "difficulty": "normal",
    "gamemode": "survival",
}


def set_props(server, extra):
    path = os.path.join(server, "server.properties")
    lines = open(path).read().splitlines()
    want = dict(PROPS)
    want.update(extra)
    seen = set()
    out = []
    for ln in lines:
        m = re.match(r"^([a-z0-9-]+)=(.*)$", ln)
        if m and m.group(1) in want:
            out.append("%s=%s" % (m.group(1), want[m.group(1)]))
            seen.add(m.group(1))
        else:
            out.append(ln)
    for k, v in want.items():
        if k not in seen:
            out.append("%s=%s" % (k, v))
    open(path, "w").write("\n".join(out) + "\n")


def pack_ref(pack_dir):
    m = json.load(open(os.path.join(pack_dir, "manifest.json")))
    return {"pack_id": m["header"]["uuid"], "version": m["header"]["version"]}


def install(server, world, bps, rps, fresh):
    wdir = os.path.join(server, "worlds", world)
    if fresh and os.path.isdir(wdir):
        shutil.rmtree(wdir)
    os.makedirs(wdir, exist_ok=True)
    refs = {"behavior": [], "resource": []}
    for kind, packs, folder in (("behavior", bps, "behavior_packs"), ("resource", rps, "resource_packs")):
        for p in packs:
            name = "tw_" + os.path.basename(os.path.normpath(p))
            dst = os.path.join(server, folder, name)
            if os.path.isdir(dst):
                shutil.rmtree(dst)
            shutil.copytree(p, dst)
            refs[kind].append(pack_ref(p))
    json.dump(refs["behavior"], open(os.path.join(wdir, "world_behavior_packs.json"), "w"), indent=1)
    json.dump(refs["resource"], open(os.path.join(wdir, "world_resource_packs.json"), "w"), indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", required=True)
    ap.add_argument("--bp", action="append", default=[])
    ap.add_argument("--rp", action="append", default=[])
    ap.add_argument("--world", default="twtest")
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--flat", action="store_true")
    ap.add_argument("--seed", default="")
    ap.add_argument("--script", required=True)
    ap.add_argument("--log", default="bds_out.log")
    ap.add_argument("--quiet", action="store_true", help="only echo TW lines and errors")
    a = ap.parse_args()
    extra = {"level-name": a.world, "level-type": "FLAT" if a.flat else "DEFAULT"}
    if a.seed:
        extra["level-seed"] = a.seed
    set_props(a.server, extra)
    install(a.server, a.world, a.bp, a.rp, a.fresh)
    proc = subprocess.Popen(["./bedrock_server"], cwd=a.server, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, bufsize=1,
                            env=dict(os.environ, LD_LIBRARY_PATH="."))
    lines = queue.Queue()
    logf = open(a.log, "w")
    seen = []

    def reader():
        for ln in proc.stdout:
            logf.write(ln)
            logf.flush()
            seen.append(ln)
            lines.put(ln)
            interesting = ("[TWDEV]" in ln or "[Tailwail]" in ln or "ERROR" in ln or "error" in ln.lower()
                           or "WARN" in ln and ("Scripting" in ln or "Pack" in ln or "json" in ln.lower()))
            if not a.quiet or interesting:
                sys.stdout.write(ln)
                sys.stdout.flush()

    th = threading.Thread(target=reader, daemon=True)
    th.start()

    def waitfor(text, timeout=90):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if any(text in s for s in seen):
                return True
            time.sleep(0.2)
        print("!! timeout waiting for", text)
        return False

    waitfor("Server started.")
    for raw in open(a.script).read().splitlines():
        cmd = raw.strip()
        if not cmd or cmd.startswith("#"):
            continue
        if cmd.startswith("wait "):
            time.sleep(float(cmd.split()[1]))
            continue
        if cmd.startswith("waitfor "):
            waitfor(cmd[len("waitfor "):])
            continue
        proc.stdin.write(cmd + "\n")
        proc.stdin.flush()
    proc.stdin.write("stop\n")
    proc.stdin.flush()
    try:
        proc.wait(timeout=60)
    except subprocess.TimeoutExpired:
        proc.kill()
    th.join(timeout=5)
    logf.close()


if __name__ == "__main__":
    main()
