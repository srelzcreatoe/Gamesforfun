#!/usr/bin/env python3
"""Load the add-on in a real Bedrock Dedicated Server and look at what the server says.

    python3 tools/bds/smoke.py <directory holding an unpacked bedrock-server>

What it can show (no player is connected, so no encounter runs):
  * both packs are accepted and applied to a fresh world, with no experiment enabled;
  * the entity, item and script files load without errors in the server log / content log;
  * the script starts against the server's own @minecraft/server module and keeps ticking;
  * a summoned Basiliskra (and a summoned hit volume) is removed by the script.

It copies the packs into the server's development pack folders, creates worlds/basiliskra_smoke, runs the
server for about a minute, feeds it console commands, and writes build/bds_smoke.log and build/bds_smoke.json.
"""
import json, os, re, shutil, subprocess, sys, threading, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def strip_comments(text):
    return re.sub(r"^\s*//.*$", "", text, flags=re.M)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    bds = os.path.abspath(sys.argv[1])
    exe = os.path.join(bds, "bedrock_server")
    if not os.path.isfile(exe):
        sys.exit(f"no bedrock_server in {bds}")
    bp = json.loads(strip_comments(open(os.path.join(ROOT, "packs/BP/manifest.json")).read()))
    rp = json.loads(strip_comments(open(os.path.join(ROOT, "packs/RP/manifest.json")).read()))
    for kind, src in (("development_behavior_packs", "packs/BP"), ("development_resource_packs", "packs/RP")):
        dst = os.path.join(bds, kind, "Basiliskra")
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(os.path.join(ROOT, src), dst)
    world = os.path.join(bds, "worlds", "basiliskra_smoke")
    shutil.rmtree(world, ignore_errors=True)
    os.makedirs(world)
    json.dump([{"pack_id": bp["header"]["uuid"], "version": bp["header"]["version"]}], open(os.path.join(world, "world_behavior_packs.json"), "w"))
    json.dump([{"pack_id": rp["header"]["uuid"], "version": rp["header"]["version"]}], open(os.path.join(world, "world_resource_packs.json"), "w"))
    props_path = os.path.join(bds, "server.properties")
    props = open(props_path).read()

    def setp(key, value):
        nonlocal props
        if re.search(rf"^{re.escape(key)}=.*$", props, flags=re.M):
            props = re.sub(rf"^{re.escape(key)}=.*$", f"{key}={value}", props, flags=re.M)
        else:
            props += f"\n{key}={value}\n"

    for k, v in (("level-name", "basiliskra_smoke"), ("online-mode", "false"), ("allow-cheats", "true"), ("server-port", "39132"),
                 ("server-portv6", "39133"), ("enable-lan-visibility", "false"), ("content-log-file-enabled", "true"),
                 ("content-log-console-output-enabled", "true"), ("level-seed", "basiliskra"), ("gamemode", "survival"), ("difficulty", "normal")):
        setp(k, v)
    open(props_path, "w").write(props)

    env = dict(os.environ, LD_LIBRARY_PATH=bds)
    proc = subprocess.Popen([exe], cwd=bds, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    lines, started = [], threading.Event()

    def reader():
        for line in proc.stdout:
            lines.append(line.rstrip("\n"))
            if "Server started" in line:
                started.set()

    threading.Thread(target=reader, daemon=True).start()

    def say(cmd, wait=2.0):
        lines.append(f">>> {cmd}")
        try:
            proc.stdin.write(cmd + "\n"); proc.stdin.flush()
        except BrokenPipeError:
            pass
        time.sleep(wait)

    ok = started.wait(120)
    if ok:
        time.sleep(3)
        say("tickingarea add circle 0 64 0 2 smoke", 4)
        say("testfor @e[type=basiliskra:basiliskra]")
        say("summon basiliskra:basiliskra 0 120 0", 3)                  # the script must remove it
        say("testfor @e[type=basiliskra:basiliskra]")
        say("summon basiliskra:hitbox 0 120 0", 3)                      # and a stray hit volume
        say("testfor @e[type=basiliskra:hitbox]")
        say("give @a basiliskra:shed_fin", 1)                           # (nobody is on: only checks the id parses)
        time.sleep(20)                                                   # let the script tick for a while
        say("testfor @e[type=basiliskra:basiliskra]")
        say("stop", 6)
    try:
        proc.wait(20)
    except subprocess.TimeoutExpired:
        proc.kill()
    logs = []
    for base, _, files in os.walk(bds):
        for f in files:
            if f.lower().startswith("contentlog"):
                logs.append(os.path.join(base, f))
    content = []
    for p in logs:
        content += [f"[{os.path.basename(p)}] {l.rstrip()}" for l in open(p, errors="replace")]
    text = lines + content
    bad = [l for l in text if re.search(r"\b(ERROR|Error|error)\b|\[Scripting\].*(rror|xception)|Unhandled|failed to|Failed to", l)
           and not re.search(r"telemetry|Realms|NetherNet|IPv6|authentication|Xbox", l, flags=re.I)]
    ours = [l for l in text if re.search(r"asiliskra", l)]
    after = text[max(i for i, l in enumerate(text) if l.startswith(">>> summon basiliskra:basiliskra")) if any(l.startswith(">>> summon basiliskra:basiliskra") for l in text) else 0:]
    version = next((l for l in lines if re.search(r"Version[: ]+\d+\.\d+", l)), "")
    report = {"started": ok, "version_line": version, "error_lines": bad, "lines_naming_the_addon": ours[:60], "console": [l for l in lines if l.startswith(">>>") or "target" in l.lower() or "summon" in l.lower() or "Pack" in l][:80]}
    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    open(os.path.join(ROOT, "build", "bds_smoke.log"), "w").write("\n".join(text) + "\n")
    json.dump(report, open(os.path.join(ROOT, "build", "bds_smoke.json"), "w"), indent=1)
    print(json.dumps(report, indent=1)[:6000])
    print(f"\nserver started: {ok}; {len(bad)} line(s) that look like errors; full log in build/bds_smoke.log")


if __name__ == "__main__":
    main()
