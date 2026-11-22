#!/usr/bin/env python3
"""
analyze.py -- decode the rendered themes with ffmpeg and measure them.

For every .ogg: duration, sample peak and 4x-oversampled true peak, RMS of the
whole file and of its loudest 10 s, DC offset, L/R correlation, energy split
over four bands, leading silence, level at the loop point, and a spectrogram
PNG (log frequency, section markers, level strip) in tools/music/out/.

    python3 analyze.py            # all three
    python3 analyze.py wrath      # one
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
MUSIC = os.path.normpath(os.path.join(HERE, '..', '..', 'packs', 'RP', 'sounds', 'basiliskra', 'music'))
OUT = os.path.join(HERE, 'out')


def db(x):
    return 20.0 * np.log10(max(float(x), 1e-12))


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), 'pipe:1'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.astype(np.float64)


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
                          'stream=codec_name,sample_rate,channels:format=duration,size,bit_rate',
                          '-of', 'json', path], check=True, capture_output=True).stdout
    return json.loads(out)


def true_peak(x, k=4):
    pk = 0.0
    step = 1 << 19
    for ch in x:
        for s in range(0, len(ch), step):
            seg = ch[max(0, s - 256):s + step + 256]
            n = len(seg)
            X = np.fft.rfft(seg)
            Y = np.zeros(n * k // 2 + 1, dtype=np.complex128)
            Y[:len(X)] = X
            pk = max(pk, float(np.max(np.abs(np.fft.irfft(Y, n * k) * k))))
    return pk


def hf_spikes(x, top=8):
    """Possible clicks: 6 ms frames whose energy above 14 kHz jumps far over the
    local median.  The orchestra has almost nothing up there, so a discontinuity
    stands out; cymbal and stick attacks are the legitimate sources."""
    mono = x.mean(axis=0)
    nfft, hop = 256, 128
    nfr = 1 + (len(mono) - nfft) // hop
    win = np.hanning(nfft)
    k0 = int(14000 / (SR / nfft))
    e = np.empty(nfr)
    for s in range(0, nfr, 8192):
        idx = np.arange(nfft)[None, :] + hop * np.arange(s, min(nfr, s + 8192))[:, None]
        S = np.abs(np.fft.rfft(mono[idx] * win, axis=1)[:, k0:]) ** 2
        e[s:s + S.shape[0]] = S.sum(axis=1)
    lev = 10 * np.log10(e / (win.sum() / 2) ** 2 + 1e-16)
    k = 64
    pad = np.pad(lev, k, mode='edge')
    med = np.array([np.median(pad[i:i + 2 * k + 1]) for i in range(0, nfr, 16)])
    med = np.repeat(med, 16)[:nfr]
    jump = lev - med
    out = []
    order = np.argsort(-jump)
    for i in order:
        if jump[i] < 25 or lev[i] < -75:
            break
        t = i * hop / SR
        if all(abs(t - u[0]) > 0.2 for u in out):
            out.append((round(float(t), 2), round(float(lev[i]), 1), round(float(jump[i]), 1)))
        if len(out) >= top:
            break
    return sorted(out)


def measure(x):
    n = x.shape[1]
    p = (x[0] ** 2 + x[1] ** 2) * 0.5
    c = np.cumsum(np.concatenate([[0.0], p]))
    w = 10 * SR
    loud = c[w:] - c[:-w]
    i_loud = int(np.argmax(loud))
    spec = np.abs(np.fft.rfft(x[0])) ** 2 + np.abs(np.fft.rfft(x[1])) ** 2
    f = np.fft.rfftfreq(n, 1.0 / SR)
    tot = spec.sum()
    bands = [float(spec[(f >= lo) & (f < hi)].sum() / tot) for lo, hi in ((0, 60), (60, 250), (250, 2000), (2000, 1e9))]
    thr = 10 ** (-60 / 20.0)
    above = np.nonzero(np.maximum(np.abs(x[0]), np.abs(x[1])) > thr)[0]
    win = int(0.4 * SR)
    sec = [float(10 * np.log10((c[min(n, (i + 1) * w)] - c[i * w]) / (min(n, (i + 1) * w) - i * w) + 1e-12))
           for i in range(int(np.ceil(n / w)))]
    return dict(
        duration_s=round(n / SR, 2),
        peak_dbfs=round(db(np.max(np.abs(x))), 2),
        true_peak_dbtp=round(db(true_peak(x)), 2),
        rms_dbfs=round(10 * np.log10(p.mean()), 2),
        rms_loudest_10s_dbfs=round(10 * np.log10(loud.max() / w), 2),
        loudest_10s_starts_at_s=round(i_loud / SR, 1),
        rms_quietest_10s_dbfs=round(10 * np.log10(loud[:max(1, n - w - 6 * SR)].min() / w + 1e-12), 2),
        dc_offset=[float('%.2e' % x[0].mean()), float('%.2e' % x[1].mean())],
        lr_correlation=round(float(np.corrcoef(x[0], x[1])[0, 1]), 3),
        energy_below_60hz=round(bands[0], 4), energy_60_250hz=round(bands[1], 4),
        energy_250_2000hz=round(bands[2], 4), energy_above_2khz=round(bands[3], 4),
        leading_silence_s=round(float(above[0]) / SR if len(above) else n / SR, 3),
        first_0p4s_rms_dbfs=round(10 * np.log10(p[:win].mean() + 1e-12), 1),
        last_0p4s_rms_dbfs=round(10 * np.log10(p[-win:].mean() + 1e-12), 1),
        clipped_samples=int(np.sum(np.abs(x) >= 0.999)),
        rms_per_10s_dbfs=[round(v, 1) for v in sec],
        hf_spikes_time_level_jump=hf_spikes(x),
    )


# colour ramp: black - indigo - magenta - orange - pale yellow
RAMP = np.array([[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21],
                 [250, 193, 39], [252, 255, 164]], dtype=np.float64)


def colour(v):
    v = np.clip(v, 0.0, 1.0) * (len(RAMP) - 1)
    i = np.minimum(v.astype(int), len(RAMP) - 2)
    fr = (v - i)[..., None]
    return (RAMP[i] * (1 - fr) + RAMP[i + 1] * fr).astype(np.uint8)


def spectrogram(x, path, title, sections):
    W, H, ML, MT, MB, STRIP = 1500, 620, 62, 40, 30, 110
    mono = x.mean(axis=0)
    nfft, hop = 8192, 1024
    win = np.hanning(nfft)
    nfr = 1 + (len(mono) - nfft) // hop
    idx = np.arange(nfft)[None, :] + hop * np.arange(nfr)[:, None]
    f = np.fft.rfftfreq(nfft, 1.0 / SR)
    fmin, fmax = 20.0, 20000.0
    edges = np.geomspace(fmin, fmax, H + 1)
    img = np.zeros((H, W))
    cols = np.minimum((np.arange(nfr) * W) // nfr, W - 1)
    acc = np.zeros((H, W))
    cnt = np.zeros(W)
    lo = np.searchsorted(f, edges[:-1])
    hi = np.maximum(np.searchsorted(f, edges[1:]), lo + 1)
    for s in range(0, nfr, 256):
        S = np.abs(np.fft.rfft(mono[idx[s:s + 256]] * win, axis=1)) ** 2
        cs = np.concatenate([np.zeros((S.shape[0], 1)), np.cumsum(S, axis=1)], axis=1)
        rows = ((cs[:, hi] - cs[:, lo]) / (hi - lo)).T          # (H, frames) mean power per row
        for j in range(rows.shape[1]):
            c = cols[s + j]
            acc[:, c] = np.maximum(acc[:, c], rows[:, j])
            cnt[c] += 1
    ref = (win.sum() / 2) ** 2
    img = 10 * np.log10(acc / ref + 1e-14)
    top, rng = -12.0, 84.0
    rgb = colour((img - (top - rng)) / rng)[::-1]
    canvas = Image.new('RGB', (ML + W + 12, MT + H + MB + STRIP + 26), (16, 16, 20))
    canvas.paste(Image.fromarray(rgb), (ML, MT))
    d = ImageDraw.Draw(canvas)
    dur = len(mono) / SR
    d.text((ML, 4), '%s   (%.1f s, log frequency 20 Hz - 20 kHz, %d dB range, max-hold per column)' % (title, dur, rng),
           fill=(235, 235, 235))
    for fr in (30, 60, 125, 250, 500, 1000, 2000, 4000, 8000, 16000):
        y = MT + H - int(np.log(fr / fmin) / np.log(fmax / fmin) * H)
        d.line([(ML - 5, y), (ML, y)], fill=(200, 200, 200))
        d.line([(ML, y), (ML + W, y)], fill=(70, 70, 80))
        d.text((6, y - 6), ('%dk' % (fr // 1000)) if fr >= 1000 else str(fr), fill=(200, 200, 200))
    for t in range(0, int(dur) + 1, 10):
        xx = ML + int(t / dur * W)
        d.line([(xx, MT + H), (xx, MT + H + 5)], fill=(200, 200, 200))
        d.text((xx - 8, MT + H + 8), '%d:%02d' % (t // 60, t % 60), fill=(200, 200, 200))
    for sec in sections:
        xx = ML + int(sec['time'] / dur * W)
        d.line([(xx, MT - 14), (xx, MT + H)], fill=(120, 255, 190))
        d.text((xx + 3, MT - 14), sec['label'].split()[0], fill=(120, 255, 190))
    # level strip: 0.5 s RMS in dBFS
    y0 = MT + H + MB
    d.rectangle([ML, y0, ML + W, y0 + STRIP], outline=(90, 90, 100))
    p = (x[0] ** 2 + x[1] ** 2) * 0.5
    blk = int(0.5 * SR)
    nb = len(p) // blk
    lev = 10 * np.log10(p[:nb * blk].reshape(nb, blk).mean(axis=1) + 1e-12)
    for g in (-10, -20, -30, -40, -50):
        yy = y0 + int((-g) / 60.0 * STRIP)
        d.line([(ML, yy), (ML + W, yy)], fill=(60, 60, 70))
        d.text((6, yy - 6), '%d dB' % g, fill=(200, 200, 200))
    pts = [(ML + int((i + 0.5) * blk / len(p) * W), y0 + int(np.clip(-lev[i], 0, 60) / 60.0 * STRIP)) for i in range(nb)]
    d.line(pts, fill=(255, 200, 80), width=2)
    d.text((ML, y0 + STRIP + 6), '0.5 s RMS level (dBFS)', fill=(200, 200, 200))
    canvas.save(path)


def main():
    names = [a for a in sys.argv[1:] if not a.startswith('-')] or ['dread', 'wrath', 'last']
    info = {}
    ipath = os.path.join(OUT, 'render_info.json')
    if os.path.exists(ipath):
        with open(ipath) as fh:
            info = json.load(fh)
    apath = os.path.join(OUT, 'analysis.json')
    res = {}
    if os.path.exists(apath):
        with open(apath) as fh:
            res = json.load(fh)
    for nm in names:
        key = 'theme_' + nm
        path = os.path.join(MUSIC, key + '.ogg')
        x = decode(path)
        m = measure(x)
        pr = probe(path)
        m['file_bytes'] = os.path.getsize(path)
        m['codec'] = pr['streams'][0]['codec_name']
        m['sample_rate'] = int(pr['streams'][0]['sample_rate'])
        m['channels'] = int(pr['streams'][0]['channels'])
        m['container_duration_s'] = round(float(pr['format']['duration']), 2)
        res[key] = m
        spectrogram(x, os.path.join(OUT, key + '_spectrogram.png'), key, info.get(key, {}).get('sections', []))
        print(key)
        for k, v in m.items():
            print('    %-26s %s' % (k, v))
    with open(apath, 'w') as fh:
        json.dump(res, fh, indent=2)
        fh.write('\n')


if __name__ == '__main__':
    main()
