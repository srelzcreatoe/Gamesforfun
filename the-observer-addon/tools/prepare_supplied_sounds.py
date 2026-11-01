"""Prepare the user-supplied Observer sounds (1.1.2, from observer.zip): trim, fade, mono for positional sounds, loudness-normalise, loop the
drone seamlessly, encode to Ogg Vorbis 44.1 kHz. Usage: python3 -I tools/prepare_supplied_sounds.py <dir with the WAVs, names made filesystem-safe> packs/TheObserver_RP/sounds/observer
The raw recordings are not kept in the repository; the prepared files are."""
import json, subprocess, sys
import numpy as np

SR = 44100

def decode(path, ch):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", str(ch), "-ar", str(SR), "-"],
                         check=True, capture_output=True, stdin=subprocess.DEVNULL).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, ch).copy()

def lufs(x, ch):
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-f", "f32le", "-ac", str(ch), "-ar", str(SR), "-i", "-",
                        "-af", "ebur128=peak=true", "-f", "null", "-"], input=x.astype(np.float32).tobytes(), capture_output=True)
    out = p.stderr.decode()
    i = float(out.split("Integrated loudness:")[1].split("I:")[1].split("LUFS")[0])
    pk = float(out.split("True peak:")[1].split("Peak:")[1].split("dBFS")[0])
    return i, pk

def fade(x, a_in, a_out):
    n = len(x)
    if a_in > 0:
        k = int(a_in * SR)
        x[:k] *= np.linspace(0, 1, k)[:, None]
    if a_out > 0:
        k = int(a_out * SR)
        x[n - k:] *= (np.cos(np.linspace(0, np.pi / 2, k)) ** 2)[:, None]
    return x

def loop_xfade(x, xf):
    k = int(xf * SR)
    head, tail, mid = x[:k], x[-k:], x[k:-k]
    t = np.linspace(0, np.pi / 2, k)[:, None]
    return np.concatenate([mid, tail * np.cos(t) + head * np.sin(t)])

def normalise(x, ch, target, ceiling=-1.0):
    i, _ = lufs(x, ch)
    y = x * 10 ** ((target - i) / 20)
    # soft ceiling: scale down peaks above it (simple, transparent for these material)
    lim = 10 ** (ceiling / 20)
    pk = np.max(np.abs(y))
    if pk > lim:
        y = np.tanh(y / lim) * lim if pk > lim * 1.6 else y * (lim / pk)
    return y

def encode(x, ch, path, q):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ac", str(ch), "-ar", str(SR), "-i", "-",
                    "-c:a", "libvorbis", "-q:a", str(q), path], input=x.astype(np.float32).tobytes(), check=True)

# name: (source, channels, start, end, fade_in, fade_out, target LUFS, loop crossfade, quality)
PLAN = {
    "presence":       ("observer_grunt_or_teleporting.wav", 1, 0.0, 3.0, 0.0, 0.35, -17.0, 0, 4),
    "shriek":         ("observer_scream.wav",               1, 0.0, 5.3, 0.0, 0.5, -12.0, 0, 4),
    "spotted":        ("observer_spotted.wav",              2, 0.0, 5.6, 0.0, 0.6, -17.0, 0, 4),
    "vanish":         ("observer_vanishes.wav",             1, 0.0, 3.6, 0.0, 0.5, -19.0, 0, 4),
    "whisper":        ("observer_nearby_or_whisper_.wav",   1, 0.0, 7.7, 0.0, 0.8, -19.0, 0, 4),
    "theme_around":   ("dweller_thr_observer_is_around_.wav", 2, 0.0, 47.6, 0.0, 1.2, -21.0, 0, 4),
    "theme_lurking":  ("observer_lurking.wav",              2, 0.0, 52.0, 0.0, 0.0, -23.0, 3.0, 4),
}

def main():
    src, dst = sys.argv[1], sys.argv[2]
    report = {}
    for name, (f, ch, a, b, fi, fo, tgt, xf, q) in PLAN.items():
        x = decode(f"{src}/{f}", ch)[int(a * SR):int(b * SR)]
        x = fade(x, fi, fo)
        if xf:
            x = loop_xfade(x, xf)
        x = normalise(x, ch, tgt)
        encode(x, ch, f"{dst}/{name}.ogg", q)
        i, pk = lufs(x, ch)
        report[name] = {"seconds": round(len(x) / SR, 2), "channels": ch, "lufs": round(i, 1), "peak": round(pk, 1)}
    print(json.dumps(report, indent=1))

main()
