#!/usr/bin/env python3
"""Generate every sound of Five Nights at Rustgrin's (docs/SOUNDS.md).

All audio is synthesised here from scratch (numpy/scipy DSP), written as a
float WAV and encoded to Ogg Vorbis with ffmpeg (-c:a libvorbis -q:a 4).
Fixed seeds: re-running produces the same files.

    python3 tools/sounds/gen_sounds.py               # everything
    python3 tools/sounds/gen_sounds.py 'js.*' amb.fan  # only matching events
    options:  -j N   worker processes (default: CPU count)
              --wav DIR   also keep the mastered WAVs in DIR
              --list      print the event table and exit

Outputs
    packs/RP/sounds/fnar/<group>/<name>[N].ogg
    packs/RP/sounds/sound_definitions.json   (fnar.* keys rewritten, others kept)
    tools/sounds/sound_manifest.json         (durations/channels/loop flags,
                                              used by check_sounds.py)
Requires: python3, numpy, scipy, ffmpeg with libvorbis.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from fnar_dsp import (N, SR, ampdb, bq, dbamp, dc_block, eq, fade_edges, fit, limiter,  # noqa: E402
                      norm_peak, norm_rms, rng)
import recipes_anim as ra  # noqa: E402
import recipes_music as rm  # noqa: E402
import recipes_office as ro  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SOUNDS_DIR = os.path.join(ROOT, 'packs', 'RP', 'sounds')
FNAR_DIR = os.path.join(SOUNDS_DIR, 'fnar')
DEFS_PATH = os.path.join(SOUNDS_DIR, 'sound_definitions.json')
MANIFEST_PATH = os.path.join(HERE, 'sound_manifest.json')
FFMPEG = shutil.which('ffmpeg') or '/usr/bin/ffmpeg'

CEILING_DB = -1.5        # limiter ceiling before encoding
MAX_PEAK_DB = -1.0       # hard rule, checked on the decoded Ogg
LOOP_FADE = 0.005        # 5 ms edge fades on loops (the loop itself is circular)


class Ev:
    """One sound event. fn(v, r, n) renders variant v (0-based) with rng r into n samples."""

    def __init__(self, key, fn, dur, variants=1, stereo=False, loop=False, cat='block', dist=None,
                 level=('peak', -1.5), fin=0.005, fout=0.02, stream=False, low_mem=False, note=''):
        self.key, self.fn, self.dur, self.variants = key, fn, dur, variants
        self.stereo, self.loop, self.cat, self.dist = stereo, loop, cat, dist
        self.level, self.fin, self.fout = level, fin, fout
        self.stream, self.low_mem, self.note = stream, low_mem, note
        self.group, self.name = key.split('.', 1)

    def files(self):
        if self.variants == 1:
            return [self.name]
        return [f'{self.name}{i + 1}' for i in range(self.variants)]


# Positional sounds carry min/max distance (blocks) and must be mono.
# level: ('peak', dBFS) | ('lufs', approx. integrated K-weighted level) | ('rms', dBFS)
EVENTS = [
    # --- ambience / office ---------------------------------------------------
    Ev('amb.office', ro.amb_office, 10.0, loop=True, cat='ambient', dist=(1, 12), level=('lufs', -31)),
    Ev('amb.fan', ro.amb_fan, 4.0, loop=True, cat='ambient', dist=(1, 8), level=('lufs', -29)),
    Ev('amb.building', ro.amb_building, 24.0, stereo=True, loop=True, cat='ambient', level=('lufs', -33)),
    Ev('amb.duct', ro.amb_duct, 6.0, loop=True, cat='ambient', dist=(1, 12), level=('lufs', -31)),
    Ev('amb.light_buzz', ro.amb_light_buzz, 2.0, loop=True, cat='ambient', dist=(1, 12), level=('lufs', -27)),
    # --- office devices --------------------------------------------------------
    Ev('door.close', ro.door_close, 1.2, cat='block', dist=(2, 16), level=('peak', -1.5)),
    Ev('door.open', ro.door_open, 1.4, cat='block', dist=(2, 16), level=('peak', -2.5), fout=0.12),
    Ev('door.error', ro.door_error, 0.5, cat='block', dist=(1, 12), level=('peak', -4.0)),
    Ev('light.on', ro.light_on, 0.3, cat='block', dist=(1, 10), level=('peak', -4.0)),
    Ev('light.off', ro.light_off, 0.2, cat='block', dist=(1, 10), level=('peak', -5.0)),
    Ev('button.press', ro.button_press, 0.15, variants=2, cat='block', dist=(1, 8), level=('peak', -6.0)),
    Ev('vent.close', ro.vent_close, 0.9, cat='block', dist=(2, 16), level=('peak', -2.0)),
    Ev('vent.open', ro.vent_open, 0.7, cat='block', dist=(2, 16), level=('peak', -4.0)),
    Ev('cam.up', ro.cam_up, 0.5, stereo=True, cat='ui', level=('peak', -4.0)),
    Ev('cam.down', ro.cam_down, 0.4, stereo=True, cat='ui', level=('peak', -5.0)),
    Ev('cam.switch', ro.cam_switch, 0.3, variants=3, stereo=True, cat='ui', level=('peak', -5.0)),
    Ev('cam.static', ro.cam_static, 1.5, stereo=True, cat='ui', level=('lufs', -21)),
    Ev('cam.hum', ro.cam_hum, 10.0, stereo=True, loop=True, cat='ui', level=('lufs', -36)),
    Ev('cam.glitch', ro.cam_glitch, 0.6, stereo=True, cat='ui', level=('peak', -3.0)),
    Ev('power.out', ro.power_out, 3.0, stereo=True, cat='block', level=('peak', -2.0)),
    Ev('clock.chime', ro.clock_chime, 1.5, stereo=True, cat='ui', level=('peak', -5.0)),
    Ev('clock.6am', ro.clock_6am, 6.0, stereo=True, cat='ui', level=('peak', -2.0)),
    Ev('phone.ring', ro.phone_ring, 4.0, cat='block', dist=(2, 16), level=('peak', -2.5)),
    Ev('phone.pickup', ro.phone_pickup, 0.4, cat='block', dist=(1, 12), level=('peak', -5.0)),
    Ev('phone.voice', ro.phone_voice, 2.0, variants=4, cat='block', dist=(2, 16), level=('lufs', -22)),
    Ev('phone.hangup', ro.phone_hangup, 0.5, cat='block', dist=(1, 12), level=('peak', -5.0)),
    # --- animatronics (mono, positional) ----------------------------------------
    Ev('step.heavy', ra.step_heavy, 0.35, variants=4, cat='hostile', dist=(2, 24), level=('peak', -1.5)),
    Ev('step.light', ra.step_light, 0.25, variants=4, cat='hostile', dist=(2, 24), level=('peak', -3.0)),
    Ev('step.scurry', ra.step_scurry, 0.6, variants=3, cat='hostile', dist=(2, 20), level=('peak', -3.0)),
    Ev('servo.move', ra.servo_move, 0.8, variants=3, cat='hostile', dist=(2, 16), level=('peak', -3.0), fout=0.06),
    Ev('servo.head', ra.servo_head, 0.4, variants=2, cat='hostile', dist=(1, 12), level=('peak', -4.0)),
    Ev('mirehop.strum', ra.mirehop_strum, 2.0, variants=3, cat='hostile', dist=(2, 24), level=('peak', -1.5)),
    Ev('noxbriar.hum', ra.noxbriar_hum, 5.0, variants=2, cat='hostile', dist=(2, 16), level=('lufs', -20)),
    Ev('rustgrin.feedback', ra.rustgrin_feedback, 1.5, variants=2, cat='hostile', dist=(4, 32), level=('peak', -1.5),
       fout=0.06),
    Ev('rustgrin.laugh', ra.rustgrin_laugh, 1.6, variants=2, cat='hostile', dist=(2, 20), level=('peak', -1.5)),
    Ev('rustgrin.song', rm.rustgrin_song, 20.0, cat='hostile', dist=(2, 24), level=('lufs', -17), stream=True),
    Ev('cat.bell', ra.cat_bell, 1.0, variants=2, cat='hostile', dist=(2, 24), level=('peak', -3.0)),
    Ev('cat.run', ra.cat_run, 2.0, cat='hostile', dist=(4, 32), level=('peak', -1.5)),
    Ev('cat.bang', ra.cat_bang, 1.5, variants=3, cat='hostile', dist=(4, 24), level=('peak', -1.5)),
    Ev('cat.growl', ra.cat_growl, 1.2, cat='hostile', dist=(1, 12), level=('peak', -2.0)),
    Ev('rat.maracas', ra.rat_maracas, 1.5, variants=3, cat='hostile', dist=(2, 24), level=('peak', -2.0), fout=0.06),
    Ev('rat.squeak', ra.rat_squeak, 0.4, variants=2, cat='hostile', dist=(1, 12), level=('peak', -4.0), fout=0.05),
    Ev('rat.crawl', ra.rat_crawl, 1.0, variants=3, cat='hostile', dist=(2, 16), level=('peak', -2.0)),
    Ev('rat.bang', ra.rat_bang, 0.8, cat='hostile', dist=(2, 16), level=('peak', -1.5)),
    Ev('tophat.cane', ra.tophat_cane, 1.2, cat='hostile', dist=(2, 24), level=('peak', -2.0)),
    Ev('tophat.fanfare', rm.tophat_fanfare, 3.0, cat='hostile', dist=(4, 32), level=('peak', -1.5)),
    Ev('tophat.show', rm.tophat_show, 16.0, loop=True, cat='hostile', dist=(4, 24), level=('lufs', -18)),
    Ev('tophat.show_slow', rm.tophat_show_slow, rm.SHOW_SLOW_DUR, loop=True, cat='hostile', dist=(4, 24),
       level=('lufs', -19), note='full tune at 70 % speed -> 22.857 s (16 s / 0.7)'),
    Ev('tophat.rewind', rm.tophat_rewind, 1.0, cat='hostile', dist=(2, 16), level=('peak', -3.0)),
    Ev('tophat.tape_out', rm.tophat_tape_out, 2.5, cat='hostile', dist=(2, 16), level=('peak', -2.0), fin=0.03),
    Ev('tophat.laugh', ra.tophat_laugh, 2.0, cat='hostile', dist=(2, 24), level=('peak', -1.5)),
    # --- jumpscares (stereo, non-positional) ------------------------------------
    Ev('js.rustgrin', ra.js_rustgrin, 1.6, stereo=True, cat='hostile', level=('rms', -9.0), low_mem=True, fout=0.03),
    Ev('js.mirehop', ra.js_mirehop, 1.6, stereo=True, cat='hostile', level=('rms', -9.0), low_mem=True, fout=0.03),
    Ev('js.noxbriar', ra.js_noxbriar, 1.6, stereo=True, cat='hostile', level=('rms', -9.0), low_mem=True, fout=0.03),
    Ev('js.purple_rat', ra.js_purple_rat, 1.6, stereo=True, cat='hostile', level=('rms', -9.5), low_mem=True, fout=0.03),
    Ev('js.cat', ra.js_cat, 1.6, stereo=True, cat='hostile', level=('rms', -9.0), low_mem=True, fout=0.03),
    Ev('js.top_hat_rat', ra.js_top_hat_rat, 1.6, stereo=True, cat='hostile', level=('rms', -9.0), low_mem=True, fout=0.03),
    # --- hallucinations / UI / music ---------------------------------------------
    Ev('hall.whisper', ro.hall_whisper, 2.0, stereo=True, cat='hostile', level=('peak', -4.0)),
    Ev('hall.sting', ro.hall_sting, 1.5, stereo=True, cat='hostile', level=('peak', -1.5), fout=0.15),
    Ev('ui.click', ro.ui_click, 0.1, stereo=True, cat='ui', level=('peak', -6.0), fin=0.002, fout=0.01),
    Ev('ui.star', ro.ui_star, 2.0, stereo=True, cat='ui', level=('peak', -3.0)),
    Ev('music.title', rm.music_title, 40.0, stereo=True, loop=True, cat='music', level=('lufs', -20), stream=True),
    Ev('music.showtime', rm.music_showtime, 48.0, stereo=True, loop=True, cat='music', level=('lufs', -17),
       stream=True),
    Ev('music.ending', rm.music_ending, 12.0, stereo=True, cat='music', level=('lufs', -19), stream=True, fout=0.05),
]


# -----------------------------------------------------------------------------
# finishing
# -----------------------------------------------------------------------------
def loudness(x):
    """approximate BS.1770 loudness (K-weighting, no gating) in LUFS"""
    xs = x if x.ndim == 2 else x[None]
    k = eq(xs, ('hs', 1681.0, 0.7071, 4.0))
    k = bq(k, 'hp', 38.0, 0.5)
    ms = float(np.sum(np.mean(k ** 2, axis=-1)))
    return -0.691 + 10 * np.log10(max(ms, 1e-20))


def finish(ev, x):
    n = N(ev.dur)
    x = fit(np.asarray(x, float), n)
    if ev.stereo and x.ndim == 1:
        x = np.stack([x, x])
    if not ev.stereo and x.ndim == 2:
        raise RuntimeError(f'{ev.key}: positional/mono event rendered in stereo')
    x = dc_block(x, 18.0, circular=ev.loop)
    kind, db = ev.level
    if kind == 'peak':
        x = norm_peak(x, db)
    elif kind == 'rms':
        x = norm_rms(x, db)
    elif kind == 'lufs':
        x = x * dbamp(db - loudness(x))
    pre_peak = float(np.max(np.abs(x)))
    x = limiter(x, CEILING_DB, circular=ev.loop)
    gr = max(0.0, float(ampdb(pre_peak)) - CEILING_DB)
    seam = seam_continuity(x) if ev.loop else None
    if ev.loop:
        x = fade_edges(x, LOOP_FADE, LOOP_FADE)
    else:
        x = fade_edges(x, ev.fin, ev.fout)
    return x, gr, seam


def seam_continuity(x):
    """Loop seam test on the finished loop *before* its 5 ms edge fades:
    wrap the end onto the start and compare the jump across the wrap point
    and the high-frequency energy around it with the rest of the file.
    step:  |x[0] - x[-1]| / median |x[n+1] - x[n]|  (~1 = as smooth as anywhere)
    hf:    HF energy in the 8 ms around the seam / median of all 8 ms windows"""
    m = x if x.ndim == 1 else x.mean(axis=0)
    d = np.abs(np.diff(m))
    w = N(0.004)
    seam = np.concatenate([m[-w:], m[:w]])
    k = 2 * w
    hf = np.sqrt(np.mean(np.diff(m[:len(m) // k * k].reshape(-1, k), axis=1) ** 2, axis=1))
    return dict(step=round(float(abs(m[0] - m[-1]) / (np.median(d) + 1e-12)), 3),
                hf=round(float(np.sqrt(np.mean(np.diff(seam) ** 2)) / (np.median(hf) + 1e-12)), 3),
                hf_p99=round(float(np.percentile(hf, 99) / (np.median(hf) + 1e-12)), 3))


def write_wav(path, x):
    """32-bit float WAV"""
    x = np.asarray(x, np.float32)
    ch = 1 if x.ndim == 1 else x.shape[0]
    data = (x if x.ndim == 1 else x.T.reshape(-1)).astype('<f4').tobytes()
    n = len(data) // (4 * ch)
    fmt = struct.pack('<HHIIHHH', 3, ch, SR, SR * ch * 4, ch * 4, 32, 0)
    with open(path, 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 4 + (8 + len(fmt)) + 12 + (8 + len(data))) + b'WAVE')
        f.write(b'fmt ' + struct.pack('<I', len(fmt)) + fmt)
        f.write(b'fact' + struct.pack('<II', 4, n))
        f.write(b'data' + struct.pack('<I', len(data)) + data)


def encode(wav, ogg):
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-map_metadata', '-1',
                    '-fflags', '+bitexact', '-flags:a', '+bitexact', '-c:a', 'libvorbis', '-q:a', '4',
                    '-ar', str(SR), ogg], check=True)


def decode(ogg, ch):
    """decode for verification; libsndfile (exact length) if installed, else ffmpeg
    (ffmpeg's vorbis decoder drops the last 128 samples of single-page streams)"""
    try:
        import soundfile
        y, _sr = soundfile.read(ogg, always_2d=True)
        return y.T
    except ImportError:
        pass
    p = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-i', ogg, '-f', 'f32le', '-acodec',
                        'pcm_f32le', '-ac', str(ch), '-ar', str(SR), '-'], check=True, capture_output=True)
    y = np.frombuffer(p.stdout, '<f4').astype(float)
    return y.reshape(-1, ch).T


def render_file(ev, v, wav_dir=None):
    """render + master + encode one variant; returns stats dict"""
    t0 = time.time()
    r = rng(ev.key, v)
    raw = ev.fn(v, r, N(ev.dur))
    x, gr, seam = finish(ev, raw)
    fname = ev.files()[v]
    out_dir = os.path.join(FNAR_DIR, ev.group)
    os.makedirs(out_dir, exist_ok=True)
    ogg = os.path.join(out_dir, fname + '.ogg')
    ch = 2 if ev.stereo else 1
    with tempfile.TemporaryDirectory() as td:
        wav = os.path.join(td, 'a.wav')
        gain = 1.0
        for _attempt in range(8):
            write_wav(wav, x * gain)
            encode(wav, ogg)
            y = decode(ogg, ch)
            pk = float(np.max(np.abs(y)))
            if pk <= dbamp(MAX_PEAK_DB - 0.02):
                break
            gain *= float(dbamp(MAX_PEAK_DB - 0.15)) / pk
        else:
            raise RuntimeError(f'{ev.key}{v}: could not get Ogg peak under {MAX_PEAK_DB} dBFS')
        if wav_dir:
            os.makedirs(os.path.join(wav_dir, ev.group), exist_ok=True)
            write_wav(os.path.join(wav_dir, ev.group, fname + '.wav'), x * gain)
    return dict(key=ev.key, file=f'{ev.group}/{fname}.ogg', samples=int(y.shape[-1]),
                expected=N(ev.dur), peak_db=round(float(ampdb(pk)), 2),
                rms_db=round(float(ampdb(np.sqrt(np.mean(y ** 2)))), 2), limiter_db=round(gr, 2),
                trim_db=round(float(ampdb(gain)), 2), secs=round(time.time() - t0, 1),
                size=os.path.getsize(ogg), seam=seam)


def _job(args):
    key, v, wav_dir = args
    ev = next(e for e in EVENTS if e.key == key)
    return render_file(ev, v, wav_dir)


# -----------------------------------------------------------------------------
# definitions / manifest
# -----------------------------------------------------------------------------
def write_definitions():
    defs = {'format_version': '1.20.20', 'sound_definitions': {}}
    if os.path.exists(DEFS_PATH):
        with open(DEFS_PATH, encoding='utf-8') as f:
            old = json.load(f)
        ours = {'fnar.' + e.key for e in EVENTS}
        for k, val in old.get('sound_definitions', {}).items():
            if k not in ours and not k.startswith('fnar.'):
                defs['sound_definitions'][k] = val
    for ev in EVENTS:
        entry = {'category': ev.cat}
        if ev.dist:
            entry['min_distance'] = float(ev.dist[0])
            entry['max_distance'] = float(ev.dist[1])
        sounds = []
        for fname in ev.files():
            s = {'name': f'sounds/fnar/{ev.group}/{fname}'}
            if ev.stream:
                s['stream'] = True
            if ev.low_mem:
                s['load_on_low_memory'] = True
            sounds.append(s)
        entry['sounds'] = sounds
        defs['sound_definitions']['fnar.' + ev.key] = entry
    with open(DEFS_PATH, 'w', encoding='utf-8') as f:
        json.dump(defs, f, indent=2)
        f.write('\n')


def write_manifest(stats):
    man = {}
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH, encoding='utf-8') as f:
            man = json.load(f).get('events', {})
    by_key = {}
    for s in stats:
        by_key.setdefault(s['key'], []).append(s)
    out = {}
    for ev in EVENTS:
        prev = man.get('fnar.' + ev.key, {})
        out['fnar.' + ev.key] = {
            'files': [f'sounds/fnar/{ev.group}/{f}.ogg' for f in ev.files()],
            'duration': round(N(ev.dur) / SR, 4),
            'channels': 2 if ev.stereo else 1,
            'loop': ev.loop,
            'positional': ev.dist is not None,
            'category': ev.cat,
            'max_distance': ev.dist[1] if ev.dist else None,
            'note': ev.note,
            'peaks_db': [s['peak_db'] for s in sorted(by_key[ev.key], key=lambda s: s['file'])]
            if ev.key in by_key else prev.get('peaks_db'),
        }
        if ev.loop:
            out['fnar.' + ev.key]['seam_prefade'] = (by_key[ev.key][0]['seam'] if ev.key in by_key
                                                     else prev.get('seam_prefade'))
    with open(MANIFEST_PATH, 'w', encoding='utf-8') as f:
        json.dump({'sample_rate': SR, 'events': out}, f, indent=1)
        f.write('\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('patterns', nargs='*', help="event keys / globs without the 'fnar.' prefix")
    ap.add_argument('-j', type=int, default=os.cpu_count() or 2)
    ap.add_argument('--wav', default=None, help='also keep mastered WAVs here')
    ap.add_argument('--list', action='store_true')
    a = ap.parse_args()
    if a.list:
        for ev in EVENTS:
            print(f'fnar.{ev.key:24s} {ev.dur:7.3f}s x{ev.variants} {"stereo" if ev.stereo else "mono  "} '
                  f'{"loop" if ev.loop else "    "} {ev.cat:8s} {ev.dist or ""}')
        return
    pats = [p[5:] if p.startswith('fnar.') else p for p in a.patterns] or ['*']
    sel = [ev for ev in EVENTS if any(fnmatch.fnmatch(ev.key, p) for p in pats)]
    if not sel:
        sys.exit('no events match ' + ' '.join(pats))
    if pats == ['*'] and os.path.isdir(FNAR_DIR):
        shutil.rmtree(FNAR_DIR)          # full rebuild: no stale files
    jobs = [(ev.key, v, a.wav) for ev in sel for v in range(ev.variants)]
    # longest first for better packing
    jobs.sort(key=lambda j: -next(e.dur for e in EVENTS if e.key == j[0]))
    t0 = time.time()
    stats = []
    if a.j > 1:
        with ProcessPoolExecutor(a.j) as ex:
            for s in ex.map(_job, jobs):
                stats.append(s)
                _report(s)
    else:
        for j in jobs:
            s = _job(j)
            stats.append(s)
            _report(s)
    write_definitions()
    write_manifest(stats)
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(FNAR_DIR) for f in fs)
    print(f'{len(stats)} files in {time.time() - t0:.0f}s; sound folder {total / 1e6:.2f} MB')


def _report(s):
    flag = '' if s['samples'] == s['expected'] else f'  LENGTH {s["samples"]}!={s["expected"]}'
    if s.get('seam'):
        flag += f'  seam step x{s["seam"]["step"]:.2f} hf x{s["seam"]["hf"]:.2f}'
    print(f'{s["file"]:34s} peak {s["peak_db"]:6.2f}  rms {s["rms_db"]:6.1f}  lim {s["limiter_db"]:4.1f}dB  '
          f'trim {s["trim_db"]:5.2f}  {s["size"] / 1024:6.1f}KB  {s["secs"]:5.1f}s{flag}', flush=True)


if __name__ == '__main__':
    main()
