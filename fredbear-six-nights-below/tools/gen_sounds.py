#!/usr/bin/env python3
"""Build every fb.* sound used by the map and write sound_definitions.json.

Most audio is synthesised here from scratch (oscillators, filtered noise and
envelopes). Melodies are original, except Freddy's music box, which plays the
opening of Bizet's "Toreador March" (1875, public domain).

The jumpscares, door and hatch, camera monitor, camera hum, laughter and the
night music use recordings supplied by the map owner (art/sounds_incoming,
credits in the README): see RECORDINGS and RECORDED_IDS below.

Output: packs/FredbearRP/sounds/fb/**.ogg (Ogg Vorbis via ffmpeg/libvorbis,
bit-exact flags so reruns are reproducible; synthesised sounds are mono
22.05 kHz, recordings 44.1 kHz, mono when positional) and
packs/FredbearRP/sounds/sound_definitions.json.
Requires: numpy, ffmpeg with libvorbis (and mp3 decoding).
"""
import json
import pathlib
import subprocess

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
RP = ROOT / "packs" / "FredbearRP"
SR = 22050


def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def env(n, attack=0.005, release=0.05, dur=None):
    a = max(1, int(SR * attack))
    r = max(1, int(SR * release))
    e = np.ones(n)
    e[:a] = np.linspace(0, 1, a)
    e[-r:] *= np.linspace(1, 0, r)
    return e


def decay(t, rate):
    return np.exp(-t * rate)


def noise(n, rng):
    return rng.uniform(-1, 1, n)


def lowpass(x, cutoff):
    """One-pole low-pass."""
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def bandpass(x, lo, hi):
    return lowpass(highpass(x, lo), hi)


def resonator(x, freq, q=30.0):
    """Two-pole resonant filter (metallic ring / formant)."""
    w = 2 * np.pi * freq / SR
    r = np.exp(-w / (2 * q))
    b1, b2 = 2 * r * np.cos(w), -r * r
    y = np.zeros_like(x)
    y1 = y2 = 0.0
    for i, v in enumerate(x):
        y0 = v * (1 - r) + b1 * y1 + b2 * y2
        y[i] = y0
        y2, y1 = y1, y0
    return y


def saw(t, f):
    ph = np.cumsum(np.broadcast_to(f, t.shape) / SR) if np.ndim(f) else t * f
    return 2 * (ph % 1.0) - 1


def sine(t, f):
    ph = np.cumsum(np.broadcast_to(f, t.shape) / SR) if np.ndim(f) else t * f
    return np.sin(2 * np.pi * ph)


def square(t, f):
    return np.sign(sine(t, f))


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[: len(p)] += p
    return out


def at(x, offset, total):
    out = np.zeros(int(SR * total))
    s = int(SR * offset)
    e = min(len(out), s + len(x))
    out[s:e] += x[: e - s]
    return out


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1.0
    return x / m * peak


def echo(x, delay=0.12, fb=0.35, taps=4):
    out = x.copy()
    d = int(SR * delay)
    out = np.concatenate([out, np.zeros(d * taps)])
    for k in range(1, taps + 1):
        out[d * k: d * k + len(x)] += x * (fb ** k)
    return out


def note_freq(name):
    names = {"C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4, "F#": -3, "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2}
    pitch, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[pitch] + 12 * (octave - 4)) / 12)


def music_box_note(freq, dur, rng=None):
    t = t_axis(dur)
    tone = sine(t, freq) + 0.45 * sine(t, freq * 2.756) * decay(t, 9) + 0.25 * sine(t, freq * 5.404) * decay(t, 16)
    return tone * decay(t, 3.2) * env(len(t), 0.002, 0.03)


def melody(notes, beat, voice=music_box_note, tail=1.2):
    total = sum(b for _, b in notes) * beat + tail
    out = np.zeros(int(SR * total))
    pos = 0.0
    for n, beats in notes:
        if n != "R":
            out += at(voice(note_freq(n), beats * beat + tail), pos, total)
        pos += beats * beat
    return out


def thud(dur, f0, f1, rate, rng, noise_amt=0.4):
    t = t_axis(dur)
    f = np.linspace(f0, f1, len(t))
    return (sine(t, f) + noise_amt * lowpass(noise(len(t), rng), 900)) * decay(t, rate)


def metal_hit(dur, freqs, rate, rng, q=40.0):
    t = t_axis(dur)
    burst = noise(len(t), rng) * decay(t, 60)
    out = np.zeros(len(t))
    for f in freqs:
        out += resonator(burst, f, q)
    return out * decay(t, rate)


# --------------------------------------------------------------------------- sounds
def build_sounds():
    rng = np.random.default_rng(1983)
    S = {}

    # ---- office devices
    S["door/bang"] = norm(mix(thud(0.5, 70, 35, 8, rng, 0.7), 0.7 * metal_hit(0.5, [190, 377, 640, 1010], 6, rng)))
    t = t_axis(1.0)
    grind = bandpass(noise(len(t), rng), 300, 2500) * (0.6 + 0.4 * sine(t, 13))
    squeal = 0.3 * sine(t, 1400 + 200 * sine(t, 3)) * np.linspace(0.2, 1, len(t))
    S["door/jam"] = norm((grind + squeal) * env(len(t), 0.02, 0.2))
    t = t_axis(1.0)
    buzz = sum(sine(t, 120 * k) / k for k in range(1, 8)) * (0.7 + 0.3 * square(t, 9))
    S["light/buzz"] = norm(buzz * env(len(t), 0.01, 0.15)) * 0.7
    t = t_axis(0.15)
    S["cam/switch"] = norm(mix(highpass(noise(len(t), rng), 3000) * decay(t, 25), at(thud(0.03, 2000, 1500, 80, rng), 0, 0.15)))
    t = t_axis(1.5)
    S["cam/static"] = norm(bandpass(noise(len(t), rng), 400, 7000) * (0.8 + 0.2 * noise(len(t), rng)) * env(len(t), 0.01, 0.05)) * 0.8
    t = t_axis(0.6)
    snap = highpass(noise(len(t), rng), 2500) * decay(t, 30)
    S["breaker/trip"] = norm(mix(snap, 0.5 * sine(t, 60) * decay(t, 5), 0.3 * square(t, 180) * decay(t, 12)))
    t = t_axis(0.8)
    S["breaker/reset"] = norm(mix(thud(0.2, 140, 80, 20, rng), 0.5 * sine(t, np.linspace(40, 120, len(t))) * env(len(t), 0.2, 0.2)))
    t = t_axis(0.8)
    whine = sine(t, np.linspace(800, 3200, len(t))) * np.linspace(0, 1, len(t)) ** 2
    pop = at(highpass(noise(int(SR * 0.15), rng), 1000) * decay(t_axis(0.15), 25), 0.6, 0.8)
    S["strobe/fire"] = norm(mix(0.5 * whine, pop))

    # ---- power
    t = t_axis(1.0)
    beeps = square(t, 880) * (np.floor(t * 6) % 2 == 0)
    S["power/alarm"] = norm(lowpass(beeps, 3000) * env(len(t), 0.005, 0.05)) * 0.8
    t = t_axis(1.5)
    S["power/down"] = norm(mix(sum(sine(t, np.linspace(120, 30, len(t)) * k) / k for k in (1, 2, 3)) * np.linspace(1, 0, len(t)),
                               at(thud(0.3, 90, 40, 12, rng), 1.2, 1.5)))
    t = t_axis(2.0)
    S["power/dark"] = norm(sum(sine(t, np.linspace(220, 20, len(t)) * k) / k for k in (1, 2, 4)) * np.linspace(1, 0, len(t)) ** 1.5)
    t = t_axis(1.2)
    S["power/reserve"] = norm(mix(thud(0.3, 100, 60, 12, rng), sum(sine(t, np.linspace(30, 140, len(t)) * k) / k for k in (1, 2, 3)) * env(len(t), 0.3, 0.2)))
    t = t_axis(2.0)
    S["power/whine"] = norm(sine(t, 2600 + 80 * sine(t, 5)) * env(len(t), 0.4, 0.4)) * 0.5

    # ---- clock and phone
    def bell(freq, dur, rate=1.8):
        t = t_axis(dur)
        parts = [(1, 1.0), (2.0, 0.6), (2.76, 0.4), (5.4, 0.25), (8.93, 0.12)]
        return sum(a * sine(t, freq * p) * decay(t, rate * (1 + p / 4)) for p, a in parts) * env(len(t), 0.002, 0.1)

    S["clock/hour"] = norm(bell(660, 0.9, 3.0)) * 0.7
    S["clock/chime"] = norm(bell(523.25, 1.6, 1.4))
    S["clock/cheer"] = norm(melody([("C5", 1), ("E5", 1), ("G5", 1), ("C6", 3)], 0.14,
                                   voice=lambda f, d: bell(f, d, 2.2), tail=1.2))
    t = t_axis(1.6)
    ring = (sine(t, 440) + sine(t, 480)) * (sine(t, 20) > 0) * ((t < 0.6) | ((t > 0.8) & (t < 1.4)))
    S["phone/ring"] = norm(lowpass(ring, 3500) * env(len(t), 0.005, 0.05)) * 0.8
    t = t_axis(2.5)
    drone = sum(saw(t, 55 * k) / k for k in (1, 1.5, 2)) * env(len(t), 1.5, 0.6)
    S["night/start"] = norm(mix(lowpass(drone, 500) * 0.6, at(bell(392, 1.2, 2.5), 1.2, 2.5)))

    # ---- ambience
    t = t_axis(1.2)
    S["amb/creak"] = norm(resonator(bandpass(noise(len(t), rng), 100, 1200) * (0.5 + 0.5 * sine(t, 7)), 210 + 0 * t[0], 12)
                          * env(len(t), 0.1, 0.3))
    pipes = np.zeros(int(SR * 1.5))
    for k, off in enumerate((0.0, 0.35, 0.8)):
        pipes += at(metal_hit(0.6, [140 + 20 * k, 287, 451], 7, rng, 60), off, 1.5)
    S["amb/pipes"] = norm(pipes)
    tune = [("G4", 1), ("E4", 1), ("C4", 1), ("E4", 1), ("G4", 2), ("A4", 1), ("G4", 1), ("F4", 1), ("D4", 1), ("E4", 2), ("C4", 2)]
    far = melody(tune, 0.32, voice=lambda f, d: (square(t_axis(d), f) * 0.4 + sine(t_axis(d), f)) * decay(t_axis(d), 2.5), tail=0.8)
    S["amb/distant_music"] = norm(echo(lowpass(far, 900), 0.18, 0.4, 4)) * 0.6
    t = t_axis(0.6)
    S["vent/clank"] = norm(mix(metal_hit(0.6, [260, 410, 590, 870], 8, rng, 25), 0.4 * thud(0.3, 110, 70, 15, rng)))

    # ---- animatronics
    t = t_axis(1.8)
    f = 70 + 8 * sine(t, 4)
    groan = (saw(t, f) + 0.6 * lowpass(noise(len(t), rng), 600)) * env(len(t), 0.2, 0.5)
    S["bonnie/groan"] = norm(resonator(groan, 350, 6) + 0.6 * resonator(groan, 900, 8))
    breath = np.zeros(int(SR * 1.5))
    for off in (0.0, 0.75):
        tt = t_axis(0.6)
        breath += at(bandpass(noise(len(tt), rng), 300, 2200) * np.sin(np.pi * tt / 0.6) ** 2, off, 1.5)
    S["chica/breath"] = norm(breath) * 0.8
    clatter = np.zeros(int(SR * 1.2))
    for k in range(7):
        off = float(rng.uniform(0, 0.8))
        clatter += at(metal_hit(0.4, list(rng.uniform(400, 3000, 3)), 10, rng, 50), off, 1.2)
    S["chica/clatter"] = norm(clatter)
    toreador = [("C5", 1), ("D5", 0.75), ("C5", 0.25), ("A4", 1), ("A4", 1), ("A4", 0.75), ("G4", 0.25), ("A4", 0.75), ("A#4", 0.25),
                ("A4", 2), ("A#4", 1), ("G4", 0.75), ("C5", 0.25), ("A4", 2), ("F4", 1), ("D4", 0.75), ("G4", 0.25), ("C4", 3)]
    # Power-out music lasts 5-20 s and is stopped by the script (SoundInstance.stop), so the clip runs ~25 s.
    S["freddy/musicbox"] = norm(melody(toreador * 3, 0.42))
    fb_tune = [("E5", 1), ("G5", 1), ("B4", 1), ("C5", 2), ("E5", 1), ("D#5", 1), ("B4", 1), ("A4", 3), ("G4", 1), ("A4", 1), ("B4", 1), ("E5", 3)]
    # Telegraph cue: stopped by the script when Fredbear is repelled or attacks; ~20 s covers the longest warning (17 s).
    S["fredbear/musicbox"] = norm(melody(fb_tune * 3, 0.36, voice=lambda f, d: music_box_note(f * (1 + 0.004 * np.sin(f)), d)))
    S["fredbear/chime"] = norm(melody([("E5", 1), ("B4", 2)], 0.3))
    t = t_axis(0.8)
    glitch = np.zeros(len(t))
    for k in range(10):
        s = int(rng.integers(0, len(t) - 800))
        L = int(rng.integers(200, 800))
        glitch[s:s + L] += np.round(noise(L, rng) * 3) / 3 * (1 if k % 2 else 0.6)
    glitch += 0.4 * square(t, 220) * (np.floor(t * 25) % 3 == 0)
    S["fredbear/glitch"] = norm(glitch)
    t = t_axis(1.5)
    roar_src = np.tanh(3 * (saw(t, np.linspace(110, 60, len(t))) + lowpass(noise(len(t), rng), 1500)))
    S["fredbear/roar"] = norm(mix(resonator(roar_src, 450, 4), 0.8 * resonator(roar_src, 1200, 5)) * env(len(t), 0.05, 0.4))
    t = t_axis(4.0)
    rumble = lowpass(noise(len(t), rng), 120) * env(len(t), 1.0, 1.0)
    detuned = melody([("E5", 1), ("G5", 1), ("B4", 1), ("C5", 2)], 0.45, voice=lambda f, d: music_box_note(f * 0.97, d) + music_box_note(f * 1.03, d), tail=1.0)
    S["fredbear/finale"] = norm(mix(2.0 * rumble, 0.6 * detuned))
    # Burn ending: crackling fire over a low roar (6 s, the script replays it per shot).
    t = t_axis(6.0)
    roar = lowpass(noise(len(t), rng), 300) * (0.6 + 0.4 * sine(t, 0.7))
    crackle = np.zeros(len(t))
    for _ in range(140):
        at_ = int(rng.integers(0, len(t) - 600))
        L = int(rng.integers(40, 400))
        burst = highpass(noise(L, rng), 2500) * np.exp(-np.arange(L) / SR * 60) * float(rng.uniform(0.3, 1.0))
        crackle[at_:at_ + L] += burst
    S["ending/fire"] = norm(mix(roar, 0.8 * crackle) * env(len(t), 0.4, 0.8))
    S["ending/theme"] = norm(melody(
        [("C5", 1), ("E5", 1), ("G5", 1), ("E5", 1), ("F5", 2), ("D5", 2), ("E5", 1), ("C5", 1), ("D5", 1), ("B4", 1), ("C5", 4),
         ("A4", 1), ("C5", 1), ("E5", 1), ("C5", 1), ("D5", 2), ("G4", 2), ("C5", 6)], 0.4, tail=2.0)) * 0.8

    def step(weight, pitch):
        tt = t_axis(0.35)
        clunk = thud(0.35, 90 * pitch, 50 * pitch, 14 / weight, rng, 0.5)
        servo = 0.25 * sine(tt, 900 * pitch) * decay(tt, 18)
        return norm(mix(clunk, servo, 0.35 * metal_hit(0.35, [300 * pitch, 520 * pitch], 12, rng)))

    S["step/freddy"] = step(1.3, 0.85)
    S["step/bonnie"] = step(1.0, 1.0)
    S["step/chica"] = step(1.0, 1.15)
    S["step/fredbear"] = step(1.5, 0.75)

    # ---- UI
    S["ui/accept"] = norm(mix(sine(t_axis(0.12), 880) * env(int(SR * 0.12)), at(sine(t_axis(0.16), 1320) * env(int(SR * 0.16)), 0.12, 0.3))) * 0.7
    S["ui/blip"] = norm(sine(t_axis(0.12), 1200) * decay(t_axis(0.12), 20)) * 0.6
    S["ui/deny"] = norm(lowpass(square(t_axis(0.35), 140), 1500) * env(int(SR * 0.35), 0.005, 0.05)) * 0.7
    return S


# --------------------------------------------------------------------------- definitions
# id -> (category, is3D, max_distance or None, volume)
META = {
    "door.close": ("block", True, 24, 1.0), "door.open": ("block", True, 24, 0.9), "door.bang": ("hostile", True, 32, 1.0),
    "door.jam": ("hostile", True, 32, 1.0), "light.buzz": ("block", True, 16, 0.6),
    "cam.up": ("ui", False, None, 0.6), "cam.down": ("ui", False, None, 0.6), "cam.switch": ("ui", False, None, 0.5),
    "cam.static": ("ui", False, None, 0.5), "cam.hum": ("ui", False, None, 0.5),
    "breaker.trip": ("block", True, 48, 1.0), "breaker.reset": ("block", True, 16, 0.8), "strobe.fire": ("block", True, 24, 1.0),
    "power.alarm": ("block", True, 32, 0.8), "power.down": ("block", True, 32, 1.0), "power.dark": ("block", True, 32, 1.0),
    "power.reserve": ("block", True, 32, 0.9), "power.whine": ("block", True, 24, 0.5),
    "clock.hour": ("block", True, 24, 0.7), "clock.chime": ("block", True, 48, 1.0), "clock.cheer": ("block", True, 48, 0.9),
    "phone.ring": ("block", True, 24, 0.9), "night.start": ("ambient", False, None, 0.8),
    "amb.creak": ("ambient", True, 32, 0.8), "amb.pipes": ("ambient", True, 64, 0.9), "amb.distant_music": ("ambient", True, 128, 0.6),
    "vent.clank": ("hostile", True, 40, 1.0),
    "bonnie.groan": ("hostile", True, 32, 1.0), "chica.breath": ("hostile", True, 20, 0.9), "chica.clatter": ("hostile", True, 64, 1.0),
    "freddy.laugh": ("hostile", True, 48, 1.0), "freddy.musicbox": ("hostile", True, 40, 1.0),
    "fredbear.musicbox": ("hostile", True, 48, 1.0), "fredbear.chime": ("hostile", True, 32, 0.9), "fredbear.glitch": ("hostile", False, None, 0.8),
    "fredbear.roar": ("hostile", True, 64, 1.0), "fredbear.laugh": ("hostile", False, None, 0.8), "fredbear.finale": ("hostile", False, None, 1.0), "ending.theme": ("music", False, None, 0.8),
    "ending.fire": ("ambient", False, None, 1.0), "night.bgm": ("music", False, None, 0.8),
    "step.freddy": ("hostile", True, 44, 1.0), "step.bonnie": ("hostile", True, 44, 1.0), "step.chica": ("hostile", True, 44, 1.0),
    "step.fredbear": ("hostile", True, 48, 1.0),
    "js.freddy": ("hostile", False, None, 1.0), "js.bonnie": ("hostile", False, None, 1.0), "js.chica": ("hostile", False, None, 1.0),
    "js.fredbear": ("hostile", False, None, 1.0),
    "ui.accept": ("ui", False, None, 0.7), "ui.blip": ("ui", False, None, 0.6), "ui.deny": ("ui", False, None, 0.7),
}


# --------------------------------------------------------------------------- recordings
CLIPS = ROOT / "art" / "sounds_incoming"
CLIP_SR = 44100
SLAM = "161190__volivieri__storm-door-slam-01.wav"
FREDDY_LAUGH = "Fnaf_Freddy_Laugh.mp3"
FREDBEAR_LAUGH = "Fredbear_laugh_Fnaf_4.mp3"
MUSIC = "PIZZA_DINNER_-_FNAF_1_REMAKE_OST.mp3"

# Output file -> (source in art/sounds_incoming, start s, end s or None, channels).
# Positional (is3D) sounds must be mono. The long laugh recordings hold several
# separate laughs; each one becomes a variant (Bedrock picks one at random).
RECORDINGS = {
    "js/animatronic": ("Jumpscare_animatronics.mp3", 0.0, None, 2),
    "js/fredbear": ("fredbearboi.mp3", 0.0, None, 2),
    "door/close": (SLAM, 0.0, 2.4, 1),
    "door/open": ("75826__analog-bleep-ten__metal-door.wav", 0.15, None, 1),
    "cam/up": ("camera_open.mp3", 0.0, None, 2),
    "cam/down": ("camera_close.mp3", 0.0, None, 2),
    "freddy/laugh_1": (FREDDY_LAUGH, 0.40, 6.00, 1),
    "freddy/laugh_2": (FREDDY_LAUGH, 6.00, 9.28, 1),
    "freddy/laugh_3": (FREDDY_LAUGH, 9.28, 13.82, 1),
    "freddy/laugh_4": (FREDDY_LAUGH, 13.82, 19.48, 1),
    "fredbear/laugh_1": (FREDBEAR_LAUGH, 0.20, 3.98, 2),
    "fredbear/laugh_2": (FREDBEAR_LAUGH, 6.45, 9.12, 2),
    "fredbear/laugh_3": (FREDBEAR_LAUGH, 9.12, 13.35, 2),
    "fredbear/laugh_4": (FREDBEAR_LAUGH, 13.35, 16.43, 2),
    # Night music (Player.playMusic with loop: true): the 50 ms of leading silence is cut so the loop is seamless.
    "night/bgm": (MUSIC, 0.05, None, 2),
}
# Camera-feed hum: the script restarts it every HUM_PERIOD seconds while the monitor is up
# (packs/FredbearBP/scripts/mc/game.js CAM_HUM_TICKS); the clip is HUM_FADE longer with
# equal-power fades at both ends, so consecutive copies cross-fade instead of clicking.
HUM = ("740223__fossarts__cctv-camera-system-in-op-2.wav", 2.0, 2)
HUM_PERIOD = 10.0
HUM_FADE = 0.5

# Sound id -> recorded files it plays.
RECORDED_IDS = {
    "js.freddy": ["js/animatronic"], "js.bonnie": ["js/animatronic"], "js.chica": ["js/animatronic"],
    "js.fredbear": ["js/fredbear"],
    "door.close": ["door/close"], "door.open": ["door/open"],
    "cam.up": ["cam/up"], "cam.down": ["cam/down"], "cam.hum": ["cam/hum"],
    "freddy.laugh": [f"freddy/laugh_{k}" for k in range(1, 5)],
    "fredbear.laugh": [f"fredbear/laugh_{k}" for k in range(1, 5)],
    "night.bgm": ["night/bgm"],
}


def decode(name, start, end, channels):
    """Decode part of a recording to float samples, shape (n, channels)."""
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{start:.3f}", "-i", str(CLIPS / name)]
    if end is not None:
        cmd += ["-t", f"{end - start:.3f}"]
    cmd += ["-f", "f32le", "-ar", str(CLIP_SR), "-ac", str(channels), "pipe:1"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, "<f4").astype(np.float64).reshape(-1, channels)


def fade(x, fade_in, fade_out, power=False):
    n = len(x)
    g = np.ones(n)
    a, b = min(n, int(CLIP_SR * fade_in)), min(n, int(CLIP_SR * fade_out))
    if a:
        g[:a] = np.linspace(0, 1, a)
    if b:
        g[n - b:] = np.minimum(g[n - b:], np.linspace(1, 0, b))
    if power:
        g = np.sin(g * np.pi / 2)
    return x * g[:, None]


def prepare(name, start, end, channels):
    x = decode(name, start, end, channels)
    level = np.abs(x).max(axis=1)
    loud = np.nonzero(level > 10 ** (-60 / 20))[0]
    if len(loud):
        x = x[: loud[-1] + int(CLIP_SR * 0.02)]  # drop trailing silence
    cut = end is not None and name != SLAM
    x = fade(x, 0.005, 0.25 if cut else 0.03)
    if name == SLAM:
        x = fade(x, 0, 0.9)  # shorten the slam's long reverb tail
    return x / np.abs(x).max() * 0.89


def build_recordings():
    R = {key: prepare(*spec) for key, spec in RECORDINGS.items()}
    name, start, channels = HUM
    hum = decode(name, start, start + HUM_PERIOD + HUM_FADE, channels)
    hum = fade(hum, HUM_FADE, HUM_FADE, power=True)
    R["cam/hum"] = hum / np.abs(hum).max() * 0.89
    return R


def encode(samples, path, sr=SR):
    path.parent.mkdir(parents=True, exist_ok=True)
    channels = 1 if samples.ndim == 1 else samples.shape[1]
    data = np.clip(samples, -1, 1).astype("<f4").tobytes()
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", str(channels), "-i", "pipe:0",
                    "-c:a", "libvorbis", "-q:a", "4" if sr == CLIP_SR else "3", "-fflags", "+bitexact", "-flags:a", "+bitexact",
                    "-map_metadata", "-1", "-serial_offset", "1983", str(path)], input=data, check=True)


def definition(sid, files):
    cat, is3d, maxd, vol = META[sid]
    stream = {"stream": True} if cat == "music" else {}  # long music files are streamed, as vanilla music is
    entry = {"category": cat, "sounds": [{"name": f"sounds/fb/{f}", "is3D": is3d, "volume": vol, **stream} for f in files]}
    if maxd is not None:
        entry["max_distance"] = float(maxd)
        entry["min_distance"] = 1.0
    return entry


def main():
    sounds = build_sounds()
    recordings = build_recordings()
    out_dir = RP / "sounds" / "fb"
    written = set()
    defs = {}
    for key, samples in sorted(sounds.items()):
        sid = key.replace("/", ".")
        if sid not in META:
            raise SystemExit(f"no metadata for fb.{sid}")
        if sid in RECORDED_IDS:
            raise SystemExit(f"fb.{sid} is both synthesised and recorded")
        encode(samples, out_dir / f"{key}.ogg")
        written.add(f"{key}.ogg")
        defs["fb." + sid] = definition(sid, [key])
    for key, samples in sorted(recordings.items()):
        encode(samples, out_dir / f"{key}.ogg", CLIP_SR)
        written.add(f"{key}.ogg")
    for sid, files in sorted(RECORDED_IDS.items()):
        missing = [f for f in files if f not in recordings]
        if missing or sid not in META:
            raise SystemExit(f"fb.{sid}: no recording {missing} or no metadata")
        if META[sid][1] and any(recordings[f].shape[1] != 1 for f in files):
            raise SystemExit(f"fb.{sid} is positional but a recording is not mono")
        defs["fb." + sid] = definition(sid, files)
    defs = dict(sorted(defs.items()))
    missing = sorted(set(META) - {d[3:] for d in defs})
    if missing:
        raise SystemExit(f"metadata without audio: {missing}")
    for stale in sorted(p for p in out_dir.rglob("*.ogg") if p.relative_to(out_dir).as_posix() not in written):
        stale.unlink()
        print(f"removed stale {stale.relative_to(ROOT)}")
    out = {"format_version": "1.26.50", "sound_definitions": defs}
    (RP / "sounds" / "sound_definitions.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    total = sum(len(s) for s in sounds.values()) / SR + sum(len(r) for r in recordings.values()) / CLIP_SR
    print(f"sounds: {len(defs)} ids, {len(written)} files, {total:.1f} s of audio ({len(recordings)} recorded files)")


if __name__ == "__main__":
    main()
