#!/usr/bin/env python3
"""Animated previews of The Observer's clips (offline forward kinematics, not a game render).

For each clip, renders frames from three cameras (front, three-quarter, side) side by side and
writes an animated GIF, plus one still contact sheet of all clips. Used to review new clips before
they are seen in a client.

Usage: preview_anims.py OUT_DIR CLIP [CLIP ...] [--frames N] [--stoop] [--raise BLOCKS] [--video NAME.mp4 [--seconds S]]
  CLIP = an animation short name from the supplemental file (e.g. float_drift) or supplied:NAME; layers are
         joined with "+" and play together as the client layers them (e.g. supplied:attack+float_hang: the
         strike in mid-air); the first layer sets the length
  --raise draws the figure that many blocks higher (the hang: its origin is in mid-air under a cave ceiling, its
          arms dangle below it)
  --video also writes one MP4 (30 fps, H.264) with every clip looped for S seconds, back to back (needs ffmpeg)
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_model as rm  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "packs", "TheObserver_RP")
GEO = os.path.join(RP, "models", "entity", "the_observer.geo.json")
TEX = os.path.join(RP, "textures", "entity", "observer", "the_observer.png")
SUPP = os.path.join(RP, "animations", "the_observer_supplemental.animation.json")
SUPPLIED = os.path.join(RP, "animations", "the_observer.animation.json")
VIEWS = ("front", "three_quarter", "side")
SIZE, SCALE = (300, 560), 5.0


def load(name):
    if name.startswith("supplied:"):
        return json.load(open(SUPPLIED))["animations"][f"animation.observer.{name.split(':', 1)[1]}"]
    return json.load(open(SUPP))["animations"][f"animation.observer.{name}"]


def layers(name):
    """[(animation, length)] for a CLIP, one per "+" layer."""
    return [(a, float(a.get("animation_length", 1.0))) for a in (load(n) for n in name.split("+"))]


RAISE = {"bones": {"root": {"position": [0, 0, 0]}}}


def at(lay, t):
    """Each layer at time t: looping layers wrap, the others hold their last frame."""
    return [(a, t % ln if a.get("loop") is True else min(t, ln)) for a, ln in lay] + [(RAISE, 0.0)]


def fname(name):
    return name.replace("supplied:", "").replace("+", "_with_")


def frame(model, anims, title):
    panels = [rm.render(model, anims, None, view=v, size=SIZE, scale=SCALE, label=v.replace("_", "-")) for v in VIEWS]
    img = Image.new("RGB", (SIZE[0] * len(panels), SIZE[1] + 28), (245, 245, 245))
    for i, p in enumerate(panels):
        img.paste(p, (i * SIZE[0], 28))
    ImageDraw.Draw(img).text((10, 8), title, fill=(10, 10, 10))
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("clips", nargs="+")
    ap.add_argument("--frames", type=int, default=24)
    ap.add_argument("--stoop", action="store_true")
    ap.add_argument("--video")
    ap.add_argument("--seconds", type=float, default=4.0)
    ap.add_argument("--raise", dest="raise_", type=float, default=0.0)
    a = ap.parse_args()
    RAISE["bones"]["root"]["position"] = [0, 16 * a.raise_, 0]
    os.makedirs(a.out, exist_ok=True)
    rm.MOLANG_VARS["q.property('observer:stoop')"] = 1.0 if a.stoop else 0.0
    model = rm.Model(GEO, TEX)
    stills = []
    for name in a.clips:
        lay = layers(name)
        length = lay[0][1]
        frames = []
        for i in range(a.frames):
            t = length * i / a.frames
            frames.append(frame(model, at(lay, t), f"{name}   t = {t:.2f} s / {length:.2f} s   (offline preview; floor line = ground)"))
        out = os.path.join(a.out, f"{fname(name)}.gif")
        frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(1000 * length / a.frames), loop=0)
        stills.append(frames[a.frames // 4])
        print(out, os.path.getsize(out), "bytes")
    sheet = Image.new("RGB", (stills[0].width, sum(s.height for s in stills)), (255, 255, 255))
    y = 0
    for s in stills:
        sheet.paste(s, (0, y))
        y += s.height
    out = os.path.join(a.out, "sheet.png")
    sheet.save(out)
    print(out)
    if a.video:
        video(model, a.clips, os.path.join(a.out, a.video), a.seconds)


def video(model, clips, out, seconds, fps=30):
    """Every clip looped for `seconds` at `fps`, one after another, encoded with ffmpeg (H.264, yuv420p)."""
    tmp = tempfile.mkdtemp(prefix="observer_preview_")
    try:
        n = 0
        for name in clips:
            lay = layers(name)
            length = lay[0][1]
            for i in range(int(seconds * fps)):
                t = (i / fps) % length
                img = frame(model, at(lay, t), f"{name}   (offline preview of the in-game keyframes; floor line = ground, red marks = blocks)")
                img.save(os.path.join(tmp, f"f{n:05d}.png"))
                n += 1
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", os.path.join(tmp, "f%05d.png"),
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", out], check=True)
        print(out, os.path.getsize(out), "bytes", n, "frames")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
