// Custom sound playback, import, a picker used everywhere a sound id is typed,
// and a small editor (trim, volume, fades, pitch, reverse, normalize).
import { useState, useEffect, useRef } from 'preact/hooks';
import { Btn, Toggle } from './common.jsx';
import { state, commit, toast, render, openModal, closeModal } from './store.js';
import { pickFile, readAsBytes } from './native.js';
import { putBlob, getBlob, soundKey } from './idb.js';
import { duck } from './settings.js';
import { uid, slug } from '../core/util.js';
import { processAudio, fitWav, MAX_BYTES } from '../core/audio.js';

export const player = { uid: null };
let current = null;

export function stopSound() {
  if (current) { try { current.stop(); } catch { /* already stopped */ } current = null; }
  if (player.uid) { player.uid = null; duck(false); render(); }
}

let ctx = null;
function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Audio is not supported on this device');
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

async function decode(bytes) {
  const c = audioCtx();
  return c.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** Plays an AudioBuffer; returns a handle with stop(). */
function playBuffer(buf, { volume = 1, offset = 0, onEnd, rate = 1 } = {}) {
  const c = audioCtx();
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = c.createGain();
  g.gain.value = Math.min(2, volume);
  src.connect(g).connect(c.destination);
  src.onended = () => onEnd?.();
  src.start(0, Math.max(0, Math.min(offset, buf.duration - 0.01)));
  return { stop: () => src.stop(), startedAt: c.currentTime - offset, ctx: c };
}

export const soundById = (p, id) => (p?.sounds || []).find((s) => `${p.namespace}.${s.name}` === id) || null;

/** Plays or pauses one of the project's custom sounds. */
export async function togglePlay(p, s) {
  if (player.uid === s.uid) { stopSound(); return; }
  stopSound();
  try {
    const bytes = await getBlob(soundKey(p.id, s.uid));
    if (!bytes) { toast('Audio file missing on this device', 'error'); return; }
    const buf = await decode(bytes);
    player.uid = s.uid;
    duck(true);
    const pitch = Number(s.pitch) || 1;
    const h = playBuffer(buf, { volume: Number(s.volume) || 1, rate: pitch, onEnd: () => { if (current === h) { current = null; player.uid = null; duck(false); render(); } } });
    current = h;
    render();
  } catch (e) { toast('Can\'t play this file: ' + e.message, 'error'); stopSound(); }
}

export function vanillaNote() {
  toast('Built-in game sounds can\'t be previewed here: they belong to the game and aren\'t included in this app. They play in game. Upload your own file to hear it here.', 'info', 6000);
}

/** Lets the user pick an .ogg/.wav and adds it to the project. Resolves to the new sound or null. */
export async function importSound(p, { category = 'hostile' } = {}) {
  const f = await pickFile('audio/ogg,audio/wav,audio/x-wav,.ogg,.wav');
  if (!f) return null;
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (!['ogg', 'wav'].includes(ext)) { toast('Use an .ogg or .wav file (the game can\'t play other formats).', 'error', 5000); return null; }
  if (f.size > MAX_BYTES) { toast('That file is over 6 MB. Trim it in the editor or compress it to OGG first.', 'error', 5000); return null; }
  try {
    const bytes = await readAsBytes(f);
    const id = uid();
    const sounds = state.project.sounds || [];
    let name = slug(f.name.replace(/\.[^.]+$/, ''), { fallback: 'sound' }).slice(0, 32), base = name, i = 2;
    while (sounds.some((x) => x.name === name)) name = `${base}_${i++}`;
    await putBlob(soundKey(p.id, id), bytes);
    const rec = { uid: id, name, ext, category, volume: 1, pitch: 1, size: bytes.length };
    commit((pp) => { (pp.sounds ||= []).push(rec); });
    toast(`Added ${p.namespace}.${name}`, 'ok');
    return rec;
  } catch (e) { toast('Import failed: ' + e.message, 'error'); return null; }
}

/**
 * Text box for a sound id with play/pause, upload and edit buttons.
 * Custom sounds (namespace.name) can be previewed and edited; vanilla ones play in game.
 */
export function SoundPicker({ value, onChange, p = state.project, placeholder = 'mob.zombie.say', k }) {
  const custom = soundById(p, value);
  const playing = custom && player.uid === custom.uid;
  return (
    <div class="spick">
      <input class="txt mono" value={value || ''} list="dl-sounds" placeholder={placeholder} aria-label="Sound" onInput={(ev) => onChange(ev.currentTarget.value, k)} />
      <Btn small kind={custom ? '' : 'ghost'} icon={playing ? 'pause' : 'play'} aria-label={playing ? 'Pause' : 'Preview sound'} onClick={() => (custom ? togglePlay(p, custom) : vanillaNote())} />
      <Btn small kind="ghost" icon="upload" aria-label="Upload your own sound" onClick={async () => { const s = await importSound(p); if (s) onChange(`${p.namespace}.${s.name}`); }} />
      {custom && <Btn small kind="ghost" icon="edit" aria-label="Edit sound" onClick={() => openSoundEditor(p, custom, (ns) => ns && onChange(`${p.namespace}.${ns.name}`))} />}
    </div>
  );
}

function drawWave(canvas, chs, dur, o, playhead) {
  const c = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#1a120d'; c.fillRect(0, 0, W, H);
  const data = chs[0], step = Math.max(1, Math.floor(data.length / W));
  const x0 = (o.start / dur) * W, x1 = (o.end / dur) * W;
  c.fillStyle = 'rgba(233,165,92,0.12)'; c.fillRect(x0, 0, x1 - x0, H);
  for (let x = 0; x < W; x++) {
    let mn = 1, mx = -1;
    for (let i = x * step, e = Math.min(data.length, i + step); i < e; i++) { const s = data[i]; if (s < mn) mn = s; if (s > mx) mx = s; }
    const inside = x >= x0 && x <= x1;
    c.fillStyle = inside ? '#e9a55c' : '#5e4837';
    c.fillRect(x, (1 - mx) * H / 2, 1, Math.max(1, (mx - mn) * H / 2));
  }
  c.fillStyle = '#fff3'; c.fillRect(x0, 0, 2, H); c.fillRect(x1 - 2, 0, 2, H);
  if (playhead != null) { c.fillStyle = '#fff'; c.fillRect(playhead * W, 0, 2, H); }
}

const fmt = (s) => `${s.toFixed(2)}s`;

export function openSoundEditor(p, s, onSaved) {
  stopSound();
  function Editor() {
    const [buf, setBuf] = useState(null);
    const [err, setErr] = useState('');
    const [o, setO] = useState({ start: 0, end: 0, gain: 0, fadeIn: 0, fadeOut: 0, pitch: 0, reverse: false, normalize: false });
    const [busy, setBusy] = useState(false);
    const [play, setPlay] = useState(null);
    const [head, setHead] = useState(null);
    const cv = useRef(null);
    useEffect(() => {
      (async () => {
        try {
          const bytes = await getBlob(soundKey(p.id, s.uid));
          if (!bytes) throw new Error('Audio file missing on this device');
          const b = await decode(bytes);
          setBuf(b);
          setO((x) => ({ ...x, end: b.duration }));
        } catch (e) { setErr(e.message); }
      })();
      return () => { current?.stop?.(); current = null; duck(false); };
    }, []);
    const chs = buf ? Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)) : null;
    useEffect(() => { if (buf && cv.current) drawWave(cv.current, chs, buf.duration, o, head); }, [buf, o, head]);
    useEffect(() => {
      if (!play) return undefined;
      let raf;
      const tick = () => {
        const t = play.ctx.currentTime - play.startedAt;
        const len = play.len;
        if (t >= len) { setHead(null); return; }
        setHead((o.start + (t / len) * (o.end - o.start)) / buf.duration);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [play]);
    const set = (k, v) => { stop(); setO((x) => ({ ...x, [k]: v })); };
    const render = () => {
      const out = processAudio(chs, buf.sampleRate, o);
      const c = audioCtx();
      const b = c.createBuffer(out.length, out[0].length, buf.sampleRate);
      out.forEach((d, i) => b.copyToChannel(d, i));
      return { out, b };
    };
    const stop = () => { if (current) { try { current.stop(); } catch { /* ok */ } current = null; } setPlay(null); setHead(null); duck(false); };
    const toggle = () => {
      if (play) { stop(); return; }
      const { b } = render();
      duck(true);
      const h = playBuffer(b, { volume: Number(s.volume) || 1, onEnd: () => { if (current === h) { current = null; setPlay(null); setHead(null); duck(false); } } });
      h.len = b.duration;
      current = h;
      setPlay(h);
    };
    const save = async (asCopy) => {
      setBusy(true);
      try {
        stop();
        const { out } = render();
        const { bytes, rate, channels } = fitWav(out, buf.sampleRate);
        if (bytes.length > MAX_BYTES) throw new Error('Still over 6 MB: trim it shorter');
        let rec;
        if (asCopy) {
          const sounds = state.project.sounds || [];
          let name = `${s.name}_edit`.slice(0, 32), base = name, i = 2;
          while (sounds.some((x) => x.name === name)) name = `${base}_${i++}`;
          rec = { ...s, uid: uid(), name, ext: 'wav', size: bytes.length };
          await putBlob(soundKey(p.id, rec.uid), bytes);
          commit((pp) => { pp.sounds.push(rec); });
        } else {
          await putBlob(soundKey(p.id, s.uid), bytes);
          rec = { ...s, ext: 'wav', size: bytes.length };
          commit((pp) => { Object.assign(pp.sounds.find((x) => x.uid === s.uid), { ext: 'wav', size: bytes.length }); });
        }
        closeModal();
        toast(`Saved ${p.namespace}.${rec.name} (${channels === 1 ? 'mono' : 'stereo'}, ${Math.round(rate / 100) / 10} kHz, ${Math.round(bytes.length / 1024)} KB)`, 'ok', 4000);
        onSaved?.(rec);
      } catch (e) { toast('Save failed: ' + e.message, 'error'); }
      setBusy(false);
    };
    if (err) return <p class="hint">{err}</p>;
    if (!buf) return <p class="hint">Loading…</p>;
    const dur = buf.duration;
    const outLen = Math.max(0.01, (o.end - o.start) / Math.pow(2, o.pitch / 12));
    const range = (label, k, min, max, step, unit = '') => (
      <div class="slide">
        <div class="slide-h"><span>{label}</span><strong>{typeof o[k] === 'number' ? (step < 1 ? o[k].toFixed(2) : o[k]) : o[k]}{unit}</strong></div>
        <input type="range" min={min} max={max} step={step} value={o[k]} aria-label={label} onInput={(ev) => set(k, Number(ev.currentTarget.value))} />
      </div>
    );
    return (
      <div class="sedit">
        <canvas ref={cv} width="640" height="120" class="wave" aria-label="Waveform" />
        <div class="inline">
          <Btn kind="primary" icon={play ? 'pause' : 'play'} onClick={toggle}>{play ? 'Pause' : 'Preview'}</Btn>
          <span class="hint">{fmt(dur)} → {fmt(outLen)} · {buf.numberOfChannels === 1 ? 'mono' : 'stereo'} · {Math.round(buf.sampleRate / 100) / 10} kHz</span>
        </div>
        {range('Start', 'start', 0, Math.max(0, o.end - 0.05), 0.01, 's')}
        {range('End', 'end', Math.min(dur, o.start + 0.05), dur, 0.01, 's')}
        {range('Volume', 'gain', -24, 12, 1, ' dB')}
        {range('Fade in', 'fadeIn', 0, Math.min(5, outLen / 2), 0.05, 's')}
        {range('Fade out', 'fadeOut', 0, Math.min(5, outLen / 2), 0.05, 's')}
        {range('Pitch (also changes speed)', 'pitch', -12, 12, 1, ' st')}
        <div class="checks">
          <Toggle label="Reverse" value={o.reverse} onChange={(v) => set('reverse', v)} />
          <Toggle label="Normalize" hint="Make it as loud as possible without clipping" value={o.normalize} onChange={(v) => set('normalize', v)} />
        </div>
        <p class="hint">Saved as WAV. Long sounds are made mono or lower quality to stay under 6 MB.</p>
        <div class="actions">
          <Btn kind="ghost" disabled={busy} onClick={() => save(true)}>Save as copy</Btn>
          <Btn kind="primary" icon="save" disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save'}</Btn>
        </div>
      </div>
    );
  }
  openModal({ title: `Edit ${p.namespace}.${s.name}`, body: Editor, wide: true });
}
