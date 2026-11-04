"""Mix the preview video's soundtrack from the game's own synthesized audio (assets/audio).

Usage: python3 make_soundtrack.py <repo assets/audio dir> <out.wav> [duration]
Timeline matches viewer/shots.js: cave ambience throughout, the underground theme for the calm
shots, the danger theme under run/lunge/grasp, splashes on water impacts, and a muffled
low-pass while the camera is underwater.
"""
import sys
import wave
import numpy as np

AUD = sys.argv[1]
OUT = sys.argv[2]
DUR = float(sys.argv[3]) if len(sys.argv) > 3 else 68.0
SR = 44100


def load(name):
    with wave.open(f'{AUD}/{name}.wav') as w:
        sr, n, ch, sw = w.getframerate(), w.getnframes(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(n)
    a = np.frombuffer(raw, dtype={1: np.int8, 2: np.int16, 4: np.int32}[sw]).astype(np.float32)
    a /= float(2 ** (8 * sw - 1))
    if ch > 1:
        a = a.reshape(-1, ch).mean(1)
    t = np.arange(int(len(a) * SR / sr)) * sr / SR
    return np.interp(t, np.arange(len(a)), a).astype(np.float32)


def looped(a, n):
    reps = int(np.ceil(n / len(a)))
    return np.tile(a, reps)[:n]


def env(n, pts):
    """piecewise-linear gain envelope: [(time, gain), ...]"""
    t = np.arange(n) / SR
    return np.interp(t, [p[0] for p in pts], [p[1] for p in pts]).astype(np.float32)


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def main():
    n = int(DUR * SR)
    amb = looped(load('ambience_cave'), n)
    calm = looped(load('music_underground'), n)
    danger = looped(load('music_danger'), n)
    splash = load('splash')

    mix = amb * env(n, [(0, 0), (1.5, 0.55), (DUR - 3, 0.55), (DUR, 0)])
    mix += calm * env(n, [(0, 0), (2.5, 0.26), (36, 0.26), (38, 0.0), (49.5, 0.0), (52, 0.26), (DUR - 3.5, 0.26), (DUR, 0)])
    mix += danger * env(n, [(0, 0), (36, 0), (38, 0.30), (49, 0.30), (51.5, 0)])

    rng = np.random.default_rng(4)
    events = []
    for k in range(7):                          # run: every hand/foot landing in the shallows
        for ph in (0.06, 0.16, 0.62, 0.71):
            t = 37 + (k + ph) * 0.72
            if t < 41.4:
                events.append((t, 0.28, 0.9 + 0.25 * rng.random()))
    events += [(46.75, 0.7, 1.0), (47.35, 0.95, 0.85), (47.4, 0.6, 1.1)]                  # grasp
    events += [(50.05, 1.0, 0.8), (50.45, 0.7, 1.0), (50.55, 0.7, 0.95), (50.95, 0.9, 0.85)]  # emerge
    events += [(56.6, 0.55, 0.6)]                                                       # submerge gloop
    for t, g, pitch in events:
        s = np.interp(np.arange(0, len(splash) - 1, pitch), np.arange(len(splash)), splash)
        i = int(t * SR)
        j = min(n, i + len(s))
        mix[i:j] += s[:j - i] * g

    # underwater: muffle everything during the swim shot (57.5 - 63.5 s)
    a, b = int(57.3 * SR), int(63.7 * SR)
    seg = lowpass(mix[a:b].copy(), 650.0) * 1.25
    fade = np.ones(b - a, np.float32)
    r = int(0.25 * SR)
    fade[:r] = np.linspace(0, 1, r)
    fade[-r:] = np.linspace(1, 0, r)
    mix[a:b] = mix[a:b] * (1 - fade) + seg * fade

    peak = np.max(np.abs(mix)) or 1.0
    mix = np.clip(mix / peak * 0.89, -1, 1)
    pcm = (mix * 32767).astype(np.int16)
    with wave.open(OUT, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('soundtrack', OUT, f'{DUR:.1f}s', len(events), 'splashes')


if __name__ == '__main__':
    main()
