#!/usr/bin/env python3
"""The Shaftbreaker's roar and yells, deeper (1.7.1). Its own recordings (from the user's Shaftbreaker archive), pitched
down — the roar to 55 % (about ten semitones), the screech to 60 %, the jumpscare to 62 %, the growl and the distant
scream to 75 % — played a little faster again so they do not drag, with more weight in the low end and the hiss above
taken off. Written to RP sounds/shaftbreaker_deep/; tools/merge_dwellers.py points the sound ids at them.

Requires ffmpeg with libvorbis. Usage: python3 tools/deepen_shaftbreaker.py
"""
import os
import shutil
import subprocess
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVE = os.path.join(ROOT, "source_assets", "supplied_dwellers", "Shaftbreaker.mcaddon")
OUT = os.path.join(ROOT, "packs", "TheObserver_RP", "sounds", "shaftbreaker_deep")
# name: (pitch, tempo, bass dB at 90 Hz, low-pass Hz)
DEEPER = {
    "roar": (0.55, 1.35, 6, 3200), "roar_cut": (0.55, 1.3, 6, 3200), "screech": (0.6, 1.25, 4, 4500),
    "jumpscare": (0.62, 1.2, 5, 4200), "growl": (0.75, 1.1, 4, 3500), "distant_scream": (0.75, 1.1, 3, 3000),
}
FILES = {"roar": 3, "roar_cut": 2, "screech": 3, "jumpscare": 2, "growl": 3, "distant_scream": 2}


def main():
    os.makedirs(OUT, exist_ok=True)
    work = tempfile.mkdtemp(prefix="sbdeep_")
    try:
        with zipfile.ZipFile(ARCHIVE) as z:
            names = {os.path.basename(n): n for n in z.namelist() if "/sounds/shaftbreaker/" in n and n.endswith(".ogg")}
            for kind, n in FILES.items():
                pitch, tempo, bass, lp = DEEPER[kind]
                for i in range(1, n + 1):
                    src_name = f"{kind}_{i}.ogg"
                    src = os.path.join(work, src_name)
                    with open(src, "wb") as f:
                        f.write(z.read(names[src_name]))
                    dst = os.path.join(OUT, src_name)
                    af = (f"aresample=44100,asetrate={44100 * pitch:.0f},aresample=44100,atempo={tempo},"
                          f"bass=g={bass}:f=90,lowpass=f={lp},alimiter=limit=0.89:level=disabled,volume=0.85")
                    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", af, "-c:a", "libvorbis", "-q:a", "4", dst], check=True)
                    print(os.path.relpath(dst, ROOT))
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
