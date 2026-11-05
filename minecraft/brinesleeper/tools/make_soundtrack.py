"""Mix the preview video's soundtrack from the game's own synthesized audio (assets/audio).

Usage: python3 make_soundtrack.py <repo assets/audio dir> <out.wav> [duration]
Timeline matches viewer/shots.js: cave ambience throughout, the underground theme for the calm
shots, the danger theme under the run and the threat poses, splashes on water impacts, and
synthesized bone cracks on the head snaps.
"""
import sys
import wave
import numpy as np

AUD = sys.argv[1]
OUT = sys.argv[2]
DUR = float(sys.argv[3]) if len(sys.argv) > 3 else 95.5
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


def crack(rng, length=0.07):
    """a dry bone crack: a sharp noise burst with a short resonant knock"""
    n = int(length * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n).astype(np.float32)
    hp = noise - np.concatenate([[0], noise[:-1]])            # crude high-pass = brittle
    env1 = np.exp(-t / 0.006)
    knock = np.sin(2 * np.pi * rng.uniform(140, 220) * t) * np.exp(-t / 0.02)
    return (0.55 * hp * env1 + 0.6 * knock).astype(np.float32)


# shot starts in the v2 video (seconds), matching viewer/shots.js
T_EMERGE, T_RUN = 17.0, 21.0
POSE_START = {'submerged_watch': 24.6, 'corner_watch': 31.8, 'reflection_lurk': 44.6, 'head_tilt': 60.2, 'emerge_roar': 67.4,
              'water_rise': 71.1, 'behind_cover': 77.6, 'ledge_watch': 80.8, 'lunge': 84.0, 'retreat': 86.3}


def main():
    n = int(DUR * SR)
    amb = looped(load('ambience_cave'), n)
    calm = looped(load('music_underground'), n)
    danger = looped(load('music_danger'), n)
    splash = load('splash')

    mix = amb * env(n, [(0, 0), (1.5, 0.55), (DUR - 3, 0.55), (DUR, 0)])
    mix += calm * env(n, [(0, 0), (2.5, 0.26), (20.5, 0.26), (21.5, 0.0), (24.2, 0.0), (25.5, 0.24), (66.8, 0.24), (67.8, 0.0),
                          (86.0, 0.0), (87.5, 0.24), (DUR - 3.5, 0.24), (DUR, 0)])
    mix += danger * env(n, [(0, 0), (20.5, 0), (21.5, 0.30), (24.0, 0.30), (25.0, 0), (67.0, 0), (68.0, 0.30), (85.8, 0.30), (87.0, 0)])

    rng = np.random.default_rng(4)
    events = []
    for t in (0.55, 1.0, 1.05, 1.45, 1.48):                          # emerge: hands slam the bank
        events.append((T_EMERGE + t, 0.85, 0.85 + 0.2 * rng.random()))
    for k in range(6):                                                # run through the shallows
        for ph in (0.06, 0.16, 0.6, 0.69):
            t = T_RUN + (k + ph) * 0.72
            if t < T_RUN + 3.5:
                events.append((t, 0.26, 0.9 + 0.25 * rng.random()))
    for k in range(9):                                                # shoreline stalk + tunnel crawl paddling
        events.append((28.6 + 0.36 * k, 0.12, 1.1 + 0.2 * rng.random()))
        events.append((47.8 + 0.3 * k, 0.12, 1.1 + 0.2 * rng.random()))
    events += [(POSE_START['emerge_roar'] + 0.8, 0.8, 0.8)]
    for k in range(10):                                               # water pouring off as it stands
        events.append((POSE_START['water_rise'] + 0.4 + 0.27 * k, 0.22, 1.3 + 0.3 * rng.random()))
    for t in (1.0, 1.8, 2.6, 3.4, 4.1):                               # retreat: wading away
        events.append((POSE_START['retreat'] + t, 0.4, 0.85))
    for t, g, pitch in events:
        s = np.interp(np.arange(0, len(splash) - 1, pitch), np.arange(len(splash)), splash)
        i = int(t * SR)
        j = min(n, i + len(s))
        mix[i:j] += s[:j - i] * g

    # bone cracks on the scripted head snaps
    cracks = [2.1, 4.45, 12.0 + 1.9]
    cracks += [POSE_START['submerged_watch'] + 2.05, POSE_START['corner_watch'] + 2.78, POSE_START['reflection_lurk'] + 2.28,
               POSE_START['head_tilt'] + 2.1, POSE_START['head_tilt'] + 2.12,
               POSE_START['ledge_watch'] + 2.45, POSE_START['lunge'] + 0.55, POSE_START['emerge_roar'] + 1.1]
    for t in cracks:
        c = crack(rng)
        i = int(t * SR)
        j = min(n, i + len(c))
        mix[i:j] += c[:j - i] * 0.9

    peak = np.max(np.abs(mix)) or 1.0
    mix = np.clip(mix / peak * 0.89, -1, 1)
    pcm = (mix * 32767).astype(np.int16)
    with wave.open(OUT, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('soundtrack', OUT, f'{DUR:.1f}s', len(events), 'splashes', len(cracks), 'cracks')


if __name__ == '__main__':
    main()
