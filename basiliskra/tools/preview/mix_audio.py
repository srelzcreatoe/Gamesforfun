#!/usr/bin/env python3
"""Mix a preview's soundtrack from the pack's own sounds.

Every sound the behaviour script played to the observer during the recording (build/replays/<name>.json)
is placed at its time, with the pitch and volume the script asked for, attenuated between the sound
definition's min and max distance from the CAMERA (build/previews/<name>.cam.json) and panned by where it
is on screen.  The files are the .ogg files shipped in the resource pack.  A soft rain or water bed made
by this tool can be added underneath; nothing else is added.

    python3 mix_audio.py <name> [--bed rain|water|none]
"""
import json, math, os, subprocess, sys, zlib
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SR = 44100
_cache = {}


def decode(path):
    if path not in _cache:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                             check=True, capture_output=True).stdout
        _cache[path] = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    return _cache[path]


def repitch(x, pitch):
    if abs(pitch - 1) < 1e-3:
        return x
    n = max(1, int(len(x) / pitch))
    return np.interp(np.arange(n) * pitch, np.arange(len(x)), x)


def main():
    name = sys.argv[1]
    bed = sys.argv[sys.argv.index("--bed") + 1] if "--bed" in sys.argv else "none"
    replay = json.load(open(os.path.join(ROOT, "build", "replays", f"{name}.json")))
    cam = json.load(open(os.path.join(ROOT, "build", "previews", f"{name}.cam.json")))
    defs = json.load(open(os.path.join(ROOT, "packs", "RP", "sounds", "sound_definitions.json")))["sound_definitions"]
    dur = cam["frames"] / cam["fps"]
    out = np.zeros((int(dur * SR) + SR, 2))
    t0 = replay["frames"][0]["t"]
    cams = cam["cams"]
    used, skipped = {}, {}
    for i, s in enumerate(replay["sounds"]):
        d = defs.get(s["id"])
        t = (s["t"] - t0) / 20.0 - cam.get("from", 0)
        if d is None:                                 # a vanilla sound (an animal call): not ours to ship or to play here
            skipped[s["id"]] = skipped.get(s["id"], 0) + 1
            continue
        if t < 0 or t >= dur:
            continue
        variants = d["sounds"]
        v = variants[zlib.crc32(f"{s['id']}{i}".encode()) % len(variants)]
        path = os.path.join(ROOT, "packs", "RP", (v["name"] if isinstance(v, dict) else v) + ".ogg")
        x = repitch(decode(path), float(s.get("pitch", 1) or 1))
        c = cams[min(len(cams) - 1, max(0, int(t * cam["fps"])))]
        gain = float(s.get("volume", 1) or 1) * (v.get("volume", 1) if isinstance(v, dict) else 1)
        pan = 0.0
        if s.get("pos"):
            dx, dy, dz = (s["pos"][k] - c["pos"][k] for k in range(3))
            dist = math.sqrt(dx * dx + dy * dy + dz * dz)
            lo, hi = d.get("min_distance", 2.0), d.get("max_distance", 16.0)
            gain *= 1.0 if dist <= lo else max(0.0, 1 - (dist - lo) / max(1e-6, hi - lo))
            fx, fz = c["fwd"][0], c["fwd"][2]
            n = math.hypot(fx, fz) or 1.0
            # the camera's right on the ground plane is (-fz, fx): a sound there is on the right
            pan = max(-1.0, min(1.0, (dx * -fz + dz * fx) / n / max(dist, 1.0))) * 0.7
        if c.get("under"):
            gain *= 0.8
        if gain <= 0.001:
            continue
        a = int(t * SR)
        x = x[: len(out) - a]
        out[a:a + len(x), 0] += x * gain * math.sqrt((1 - pan) / 2)
        out[a:a + len(x), 1] += x * gain * math.sqrt((1 + pan) / 2)
        used[s["id"]] = used.get(s["id"], 0) + 1
    if bed != "none":
        # a quiet bed so silence is not digital silence: filtered noise made here, labelled as such in the notes
        rng = np.random.default_rng(7)
        n = rng.standard_normal(len(out))
        k = 0.02 if bed == "water" else 0.35
        y = np.zeros_like(n)
        acc = 0.0
        for j in range(len(n)):
            acc += k * (n[j] - acc)
            y[j] = acc
        if bed == "rain":
            y = n * 0.25 - y * 0.6
        y *= (0.012 if bed == "rain" else 0.05) / (np.abs(y).max() + 1e-9) * 6
        under = np.repeat(np.array([1.0 if c.get("under") else 0.0 for c in cams]), SR // int(cam["fps"]) + 1)[: len(out)]
        under = np.pad(under, (0, len(out) - len(under)), mode="edge")
        if bed == "water":
            y *= 0.35 + 0.65 * under
        out[:, 0] += y
        out[:, 1] += np.roll(y, 311)
    out = out[: int(dur * SR)]
    peak = np.abs(out).max()
    if peak > 0.95:
        out = np.tanh(out / peak * 1.6) / math.tanh(1.6) * 0.95
    wav = os.path.join(ROOT, "build", "previews", f"{name}.wav")
    pcm = (np.clip(out, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "-", wav], input=pcm, check=True)
    silent = os.path.join(ROOT, "build", "previews", f"{name}_silent.mp4")
    final = os.path.join(ROOT, "previews", f"{name}.mp4")
    os.makedirs(os.path.dirname(final), exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", silent, "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", final], check=True)
    print(f"{final}: {dur:.1f} s, sounds placed {used}" + (f", vanilla sounds left out {skipped}" if skipped else ""))


if __name__ == "__main__":
    main()
