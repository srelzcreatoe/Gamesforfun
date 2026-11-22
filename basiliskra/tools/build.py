#!/usr/bin/env python3
"""Build the importable add-on.

    python3 tools/build.py            bundle the script, validate both packs, run the scenario suite, package
    python3 tools/build.py --assets   also regenerate models, textures, client files, particles and sounds first

Output: dist/Basiliskra-<version>.mcaddon  (one archive holding the behaviour pack and the resource pack)
"""
import hashlib, json, os, subprocess, sys, zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def run(*cmd):
    print("$", " ".join(cmd))
    subprocess.run(cmd, cwd=ROOT, check=True)


def add_tree(z, src, prefix):
    n = 0
    for base, dirs, files in os.walk(src):
        dirs.sort()
        for f in sorted(files):
            if f.startswith(".") or f.endswith((".map", ".ts")):
                continue
            full = os.path.join(base, f)
            arc = prefix + "/" + os.path.relpath(full, src).replace(os.sep, "/")
            info = zipfile.ZipInfo(arc, date_time=(2026, 1, 1, 0, 0, 0))       # fixed stamp: the same input gives the same archive
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(full, "rb") as fh:
                z.writestr(info, fh.read())
            n += 1
    return n


def main():
    if "--assets" in sys.argv:
        run("python3", "tools/kit/build_models.py")
        run("python3", "tools/kit/gen_client.py")
        run("python3", "tools/kit/build_models.py")          # second pass embeds the generated animations in the .bbmodel files
        run("python3", "tools/kit/gen_hitbox.py")
        run("python3", "tools/kit/gen_blocks.py")
        run("python3", "tools/kit/gen_particles.py")
        run("python3", "tools/sound/synth.py")
    run("npx", "tsc", "--noEmit", "-p", ".")
    run("node", "tools/bundle.mjs")
    run("python3", "tools/validate/validate.py")
    run("node", "test/run.mjs")
    bp = json.load(open(os.path.join(ROOT, "packs/BP/manifest.json")))
    version = ".".join(str(v) for v in bp["header"]["version"])
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    out = os.path.join(ROOT, "dist", f"Basiliskra-{version}.mcaddon")
    with zipfile.ZipFile(out, "w") as z:
        nb = add_tree(z, os.path.join(ROOT, "packs/BP"), "Basiliskra BP")
        nr = add_tree(z, os.path.join(ROOT, "packs/RP"), "Basiliskra RP")
    digest = hashlib.sha256(open(out, "rb").read()).hexdigest()
    with open(out + ".sha256", "w") as f:
        f.write(f"{digest}  {os.path.basename(out)}\n")
    print(f"{out}: {os.path.getsize(out) / 1e6:.1f} MB, {nb} behaviour-pack files, {nr} resource-pack files, sha256 {digest[:16]}...")


if __name__ == "__main__":
    main()
