// Project-level custom sound library (audio stored in IndexedDB).
import { useState } from 'preact/hooks';
import { Card, Btn, TextInput, Select, NumInput, Empty, Icon } from '../common.jsx';
import { commit, toast } from '../store.js';
import { pickFile, readAsBytes, copyText } from '../native.js';
import { putBlob, getBlob, delBlob, soundKey } from '../idb.js';
import { uid, slug } from '../../core/util.js';

const CATEGORIES = ['hostile', 'neutral', 'ambient', 'player', 'block', 'weather', 'music', 'record', 'ui'];
let playing = null;

async function play(project, s) {
  try {
    const bytes = await getBlob(soundKey(project.id, s.uid));
    if (!bytes) { toast('Audio file missing on this device', 'error'); return; }
    if (playing) { playing.pause(); URL.revokeObjectURL(playing.src); }
    const a = new Audio(URL.createObjectURL(new Blob([bytes], { type: s.ext === 'wav' ? 'audio/wav' : 'audio/ogg' })));
    a.volume = Math.min(1, Number(s.volume) || 1);
    playing = a;
    await a.play();
  } catch (e) { toast('Can\'t play this file here: ' + e.message, 'error'); }
}

export function SoundLibrary({ p }) {
  const [busy, setBusy] = useState(false);
  const sounds = p.sounds || [];
  const importSound = async () => {
    const f = await pickFile('audio/ogg,audio/wav,audio/x-wav,.ogg,.wav');
    if (!f) return;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['ogg', 'wav'].includes(ext)) { toast('Use an .ogg or .wav file (Minecraft can\'t play other formats).', 'error', 5000); return; }
    if (f.size > 6 * 1024 * 1024) { toast('That file is over 6 MB. Shorten or compress it (OGG) first.', 'error', 5000); return; }
    setBusy(true);
    try {
      const bytes = await readAsBytes(f);
      const id = uid();
      let name = slug(f.name.replace(/\.[^.]+$/, ''), { fallback: 'sound' }).slice(0, 32), i = 2;
      while (sounds.some((x) => x.name === name)) name = `${name}_${i++}`;
      await putBlob(soundKey(p.id, id), bytes);
      commit((pp) => { (pp.sounds ||= []).push({ uid: id, name, ext, category: 'hostile', volume: 1, pitch: 1, size: bytes.length }); });
      toast(`Added ${p.namespace}.${name}`, 'ok');
    } catch (e) { toast('Import failed: ' + e.message, 'error'); }
    setBusy(false);
  };
  const upd = (s, fn, key) => commit((pp) => fn(pp.sounds.find((x) => x.uid === s.uid)), key);
  return (
    <Card title="Custom sounds" sub="Your own .ogg/.wav files: screams, whispers, footsteps… Use them in any sound picker or horror scare." right={<Btn small icon="upload" kind="primary" disabled={busy} onClick={importSound}>{busy ? 'Adding…' : 'Import'}</Btn>}>
      {!sounds.length && <Empty icon="🔊" title="No custom sounds">Import an .ogg or .wav. It becomes <code>{p.namespace}.name</code>, usable in Sounds tabs, horror scares and /playsound.</Empty>}
      {sounds.map((s) => (
        <div class="csnd">
          <Btn small kind="ghost" icon="play" aria-label={`Play ${s.name}`} onClick={() => play(p, s)} />
          <div class="csnd-main">
            <div class="inline">
              <span class="hint mono">{p.namespace}.</span>
              <TextInput value={s.name} mono onChange={(v) => upd(s, (x) => { x.name = slug(v, { fallback: '' }); }, `snd:${s.uid}`)} />
            </div>
            <div class="inline wrap">
              <Select value={s.category} options={CATEGORIES} onChange={(v) => upd(s, (x) => { x.category = v; })} />
              <label class="mini"><span>vol</span><NumInput min={0} value={s.volume} onChange={(v) => upd(s, (x) => { x.volume = v; }, `snd:${s.uid}:v`)} /></label>
              <label class="mini"><span>pitch</span><NumInput min={0.1} value={s.pitch} onChange={(v) => upd(s, (x) => { x.pitch = v; }, `snd:${s.uid}:p`)} /></label>
              <span class="hint">{s.ext} · {Math.round((s.size || 0) / 1024)} KB</span>
            </div>
          </div>
          <div class="stack">
            <Btn small kind="ghost" icon="copy" aria-label="Copy sound id" onClick={() => { copyText(`${p.namespace}.${s.name}`); toast('Copied sound id'); }} />
            <Btn small kind="ghost" icon="trash" aria-label={`Delete ${s.name}`} onClick={() => { commit((pp) => { pp.sounds = pp.sounds.filter((x) => x.uid !== s.uid); }); delBlob(soundKey(p.id, s.uid)).catch(() => {}); }} />
          </div>
        </div>
      ))}
    </Card>
  );
}
