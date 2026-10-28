#!/usr/bin/env python3
"""Self-check for the Rustgrin's sound pack.

    python3 tools/sounds/check_sounds.py                 # table + rule checks
    python3 tools/sounds/check_sounds.py --spectro       # + spectrogram PNGs of key sounds
    python3 tools/sounds/check_sounds.py --spectro js.cat amb.office   # specific events
    options: --out DIR  (PNG folder, default tools/sounds/_check)

For every file referenced by packs/RP/sounds/sound_definitions.json it prints
duration, channels, sample peak, RMS, DC offset and edge levels, and flags:
  ERROR  positional event (has max_distance) that is not mono
  ERROR  channel count / length differs from tools/sounds/sound_manifest.json
  ERROR  peak above -1 dBFS (decoded Ogg)
  ERROR  one-shot whose first/last sample is above -54 dBFS and -40 dB re its peak
  ERROR  loop whose content is discontinuous across the wrap point before the
         5 ms edge fades (measured by gen_sounds.py, stored in the manifest):
         step > 6x the median sample-to-sample change, or seam HF burst
  ERROR  loop seam with a click (HF burst above the file's 99th percentile, >4x
         median) or a level jump > 3 dB that is also larger than the file's own
         99th-percentile jump between adjacent 54 ms windows
  ERROR  sound folder over 8 MB, missing files
  WARN   DC offset, unreferenced files, ambience louder than -24 dBFS RMS,
         jumpscare quieter than -12 dBFS RMS
Needs numpy and ffmpeg; uses soundfile (exact Vorbis lengths) and Pillow if
installed (Pillow is needed for --spectro).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RP = os.path.join(ROOT, 'packs', 'RP')
DEFS = os.path.join(RP, 'sounds', 'sound_definitions.json')
MANIFEST = os.path.join(HERE, 'sound_manifest.json')
FNAR = os.path.join(RP, 'sounds', 'fnar')
SR = 44100

KEY_SOUNDS = ['amb.office', 'amb.building', 'door.close', 'cam.static', 'phone.voice', 'mirehop.strum',
              'noxbriar.hum', 'rustgrin.song', 'tophat.show', 'tophat.show_slow', 'js.rustgrin', 'js.cat',
              'js.mirehop', 'js.top_hat_rat', 'music.title', 'music.showtime', 'music.ending', 'hall.sting']


def decode(path):
    try:
        import soundfile
        y, sr = soundfile.read(path, always_2d=True)
        return y.T.astype(float), sr
    except ImportError:
        pass
    pr = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=channels,sample_rate,duration_ts',
                         '-of', 'json', path], capture_output=True, check=True)
    st = json.loads(pr.stdout)['streams'][0]
    ch = int(st['channels'])
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-acodec', 'pcm_f32le', '-'],
                       capture_output=True, check=True)
    y = np.frombuffer(p.stdout, '<f4').astype(float).reshape(-1, ch).T
    n = int(st.get('duration_ts') or y.shape[1])
    if y.shape[1] < n:   # ffmpeg drops the last 128 samples of short streams
        y = np.pad(y, ((0, 0), (0, n - y.shape[1])))
    return y, int(st['sample_rate'])


def db(v):
    return 20 * np.log10(max(float(v), 1e-12))


def seam_metrics(y):
    """loop seam: wrap the end onto the start and look for a click / level jump."""
    m = y.mean(axis=0)
    n = m.shape[0]
    w = int(0.004 * SR)
    seam = np.concatenate([m[-w:], m[:w]])
    d = np.abs(np.diff(m))
    hf_seam = float(np.sqrt(np.mean(np.diff(seam) ** 2)))
    # typical HF energy in 8 ms windows across the file
    k = 2 * w
    idx = np.arange(0, n - k, k)
    hf = np.sqrt(np.array([np.mean(np.diff(m[i:i + k]) ** 2) for i in idx]))
    hf_med = float(np.median(hf)) + 1e-12
    a = int(0.006 * SR)          # skip the 5 ms edge fades
    b = int(0.06 * SR)
    pre = m[n - b:n - a]
    post = m[a:b]
    jump = abs(db(np.sqrt(np.mean(pre ** 2))) - db(np.sqrt(np.mean(post ** 2))))
    # the same measure for every pair of adjacent 54 ms windows inside the file
    w2 = b - a
    lv = np.array([db(np.sqrt(np.mean(m[i:i + w2] ** 2))) for i in range(0, n - w2, w2)])
    jumps = np.abs(np.diff(lv))
    typical = float(np.median(d)) + 1e-12
    return dict(seam_hf_ratio=hf_seam / hf_med, seam_level_jump_db=jump,
                jump_p99_db=float(np.percentile(jumps, 99)) if len(jumps) else 0.0,
                seam_step=float(abs(m[0] - m[-1])) / typical,
                hf_p99_ratio=float(np.percentile(hf, 99)) / hf_med)


def analyse(path):
    y, sr = decode(path)
    ch, n = y.shape
    pk = float(np.max(np.abs(y)))
    rms = float(np.sqrt(np.mean(y ** 2)))
    dc = float(np.max(np.abs(y.mean(axis=1))))
    e = int(0.002 * sr)
    return y, dict(channels=ch, samples=n, sr=sr, dur=n / sr, peak_db=db(pk), rms_db=db(rms), dc=dc,
                   first=float(np.max(np.abs(y[:, 0]))), last=float(np.max(np.abs(y[:, -1]))),
                   head_db=db(np.max(np.abs(y[:, :e]))), tail_db=db(np.max(np.abs(y[:, -e:]))))


# ----------------------------------------------------------------------------
# spectrograms (numpy + Pillow)
# ----------------------------------------------------------------------------
_CMAP = np.array([[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21],
                  [250, 193, 39], [252, 255, 164]], float)


def cmap(v):
    v = np.clip(v, 0, 1) * (len(_CMAP) - 1)
    i = np.minimum(np.floor(v).astype(int), len(_CMAP) - 2)
    f = (v - i)[..., None]
    return (_CMAP[i] * (1 - f) + _CMAP[i + 1] * f).astype(np.uint8)


def spectrogram_png(y, sr, title, out, width=1100, height=360, wave_h=110, fmin=20.0, top_db=90):
    from PIL import Image, ImageDraw
    m = y.mean(axis=0)
    nfft = 4096
    hop = max(64, len(m) // width)
    win = np.hanning(nfft)
    pad = np.concatenate([np.zeros(nfft // 2), m, np.zeros(nfft)])
    frames = np.arange(0, len(m), hop)
    S = np.empty((len(frames), nfft // 2 + 1))
    for j, i in enumerate(frames):
        S[j] = np.abs(np.fft.rfft(pad[i:i + nfft] * win))
    S = 20 * np.log10(S / (np.sum(win) / 2) + 1e-10)
    freqs = np.fft.rfftfreq(nfft, 1 / sr)
    # log-frequency rows: max over the FFT bins each row covers (narrow lines stay visible)
    edges = np.geomspace(fmin, sr / 2, height + 1)
    lo = np.searchsorted(freqs, edges[:-1])
    hi = np.maximum(np.searchsorted(freqs, edges[1:]), lo + 1)
    Sl = np.empty((height, len(frames)))
    centers = np.sqrt(edges[:-1] * edges[1:])
    for j in range(len(frames)):
        row = np.array([S[j, a_:b_].max() for a_, b_ in zip(lo, hi)])
        narrow = (hi - lo) <= 1
        row[narrow] = np.interp(centers[narrow], freqs, S[j])
        Sl[:, j] = row[::-1]
    vmax = 0.0
    img = cmap((Sl - (vmax - top_db)) / top_db)
    spec = Image.fromarray(img).resize((width, height), Image.BILINEAR)
    canvas = Image.new('RGB', (width + 60, height + wave_h + 50), (16, 16, 20))
    canvas.paste(spec, (50, wave_h + 30))
    d = ImageDraw.Draw(canvas)
    # waveform (min/max per column, all channels overlaid)
    cols = np.array_split(np.arange(len(m)), width)
    for c in range(y.shape[0]):
        col = (120, 200, 255) if c == 0 else (255, 160, 120)
        for x, ix in enumerate(cols):
            if len(ix) == 0:
                continue
            seg = y[c, ix]
            y0 = 20 + wave_h / 2 - seg.max() * wave_h / 2
            y1 = 20 + wave_h / 2 - seg.min() * wave_h / 2
            d.line([(50 + x, y0), (50 + x, y1)], fill=col)
    lvl = 10 ** (-1 / 20)
    for s in (1, -1):
        yy = 20 + wave_h / 2 - s * lvl * wave_h / 2
        d.line([(50, yy), (50 + width, yy)], fill=(200, 60, 60))
    d.rectangle([50, 20, 50 + width, 20 + wave_h], outline=(90, 90, 90))
    for f in (50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000):
        yy = wave_h + 30 + (np.log(sr / 2) - np.log(f)) / (np.log(sr / 2) - np.log(fmin)) * height
        d.line([(44, yy), (50, yy)], fill=(200, 200, 200))
        d.text((2, yy - 6), f'{f / 1000:g}k' if f >= 1000 else str(f), fill=(200, 200, 200))
    dur = len(m) / sr
    step = 0.1 if dur <= 1.5 else (0.5 if dur <= 6 else (2 if dur <= 24 else 5))
    tt = 0.0
    while tt <= dur:
        x = 50 + tt / dur * width
        d.line([(x, height + wave_h + 30), (x, height + wave_h + 36)], fill=(200, 200, 200))
        d.text((x - 8, height + wave_h + 37), f'{tt:g}', fill=(200, 200, 200))
        tt += step
    d.text((50, 3), title, fill=(255, 255, 255))
    canvas.save(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--spectro', nargs='*', default=None, help='render spectrograms (default: key sounds)')
    ap.add_argument('--out', default=os.path.join(HERE, '_check'))
    ap.add_argument('--quiet', action='store_true', help='only print problems and the summary')
    a = ap.parse_args()
    with open(DEFS, encoding='utf-8') as f:
        defs = json.load(f)['sound_definitions']
    man = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding='utf-8') as f:
            man = json.load(f)['events']
    errors, warns = [], []
    referenced = set()
    total = 0
    rows = []
    cache = {}
    for key, ev in defs.items():
        if not key.startswith('fnar.'):
            continue
        positional = 'max_distance' in ev
        info = man.get(key, {})
        for s in ev['sounds']:
            name = s['name'] if isinstance(s, dict) else s
            path = os.path.join(RP, name + '.ogg')
            referenced.add(os.path.normpath(path))
            if not os.path.exists(path):
                errors.append(f'{key}: missing {name}.ogg')
                continue
            y, st = analyse(path)
            cache.setdefault(key, []).append((name, y, st))
            size = os.path.getsize(path)
            flags = []
            if positional and st['channels'] != 1:
                errors.append(f'{name}: positional event but {st["channels"]} channels')
                flags.append('STEREO-POS')
            if info and st['channels'] != info['channels']:
                errors.append(f'{name}: {st["channels"]} channels, manifest says {info["channels"]}')
            if info and abs(st['dur'] - info['duration']) > 0.002:
                errors.append(f'{name}: {st["dur"]:.3f}s, manifest says {info["duration"]}s')
            if st['peak_db'] > -1.0:
                errors.append(f'{name}: peak {st["peak_db"]:.2f} dBFS > -1 dBFS')
                flags.append('PEAK')
            if st['dc'] > 2e-3:
                warns.append(f'{name}: DC offset {st["dc"]:.4f}')
                flags.append('DC')
            loop = bool(info.get('loop'))
            seam = None
            if loop:
                seam = seam_metrics(y)
                if seam['seam_hf_ratio'] > max(4.0, seam['hf_p99_ratio']):
                    errors.append(f'{name}: loop seam click (HF x{seam["seam_hf_ratio"]:.1f} of median)')
                    flags.append('SEAM-CLICK')
                if seam['seam_level_jump_db'] > max(3.0, seam['jump_p99_db'] + 0.5):
                    errors.append(f'{name}: loop seam level jump {seam["seam_level_jump_db"]:.1f} dB '
                                  f'(file p99 {seam["jump_p99_db"]:.1f} dB)')
                    flags.append('SEAM-JUMP')
            edge_thr = max(2e-3, 0.01 * 10 ** (st['peak_db'] / 20))   # -54 dBFS or -40 dB re peak
            pre = info.get('seam_prefade') if loop else None
            if pre and (pre['step'] > 6.0 or pre['hf'] > max(4.0, pre['hf_p99'])):
                errors.append(f'{name}: loop content discontinuous at the wrap point before fades '
                              f'(step x{pre["step"]}, hf x{pre["hf"]})')
                flags.append('SEAM-PREFADE')
            if seam is not None and pre:
                seam['pre_step'], seam['pre_hf'] = pre['step'], pre['hf']
            if not loop and (st['first'] > edge_thr or st['last'] > edge_thr):
                errors.append(f'{name}: non-zero edge sample (first {st["first"]:.4f}, last {st["last"]:.4f})')
                flags.append('EDGE')
            if ev.get('category') == 'ambient' and st['rms_db'] > -24:
                warns.append(f'{name}: ambience louder than expected (RMS {st["rms_db"]:.1f})')
            if key.startswith('fnar.js.') and st['rms_db'] < -12:
                warns.append(f'{name}: jumpscare RMS only {st["rms_db"]:.1f} dBFS')
            total += size
            rows.append((name.replace('sounds/fnar/', ''), st, size, loop, seam, positional, flags))
    for dp, _, fs in os.walk(FNAR):
        for fn in fs:
            p = os.path.normpath(os.path.join(dp, fn))
            if p not in referenced:
                warns.append(f'unreferenced file {os.path.relpath(p, RP)}')
    if total > 8e6:
        errors.append(f'sound folder {total / 1e6:.2f} MB > 8 MB')
    if not a.quiet:
        print(f'{"file":30s} {"dur":>7s} {"ch":>2s} {"peak":>7s} {"rms":>6s} {"dc":>7s} {"head":>6s} {"tail":>6s}'
              f' {"KB":>6s}  notes')
        for name, st, size, loop, seam, pos, flags in rows:
            note = ('pos ' if pos else '    ') + ('loop ' if loop else '')
            if seam:
                note += (f'seamHF x{seam["seam_hf_ratio"]:.2f} jump {seam["seam_level_jump_db"]:.1f}dB'
                         f' (p99 {seam["jump_p99_db"]:.1f}) ')
                if 'pre_step' in seam:
                    note += f'pre-fade step x{seam["pre_step"]:.2f} hf x{seam["pre_hf"]:.2f} '
            note += ' '.join(flags)
            print(f'{name:30s} {st["dur"]:7.3f} {st["channels"]:2d} {st["peak_db"]:7.2f} {st["rms_db"]:6.1f}'
                  f' {st["dc"]:7.5f} {st["head_db"]:6.0f} {st["tail_db"]:6.0f} {size / 1024:6.1f}  {note}')
    print(f'\n{len(rows)} files, {total / 1e6:.2f} MB, {len(errors)} errors, {len(warns)} warnings')
    for e in errors:
        print('ERROR', e)
    for w in warns:
        print('WARN ', w)
    if a.spectro is not None:
        os.makedirs(a.out, exist_ok=True)
        keys = a.spectro or KEY_SOUNDS
        for k in keys:
            k = k if k.startswith('fnar.') else 'fnar.' + k
            for name, y, st in cache.get(k, [])[:2]:
                out = os.path.join(a.out, name.replace('sounds/fnar/', '').replace('/', '_') + '.png')
                spectrogram_png(y, st['sr'], f'{name}  {st["dur"]:.2f}s  {st["channels"]}ch  peak {st["peak_db"]:.1f}'
                                f' dBFS  rms {st["rms_db"]:.1f} dBFS', out)
                print('wrote', os.path.relpath(out, ROOT))
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
