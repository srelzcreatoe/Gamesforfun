// Project-level custom sound library (audio stored in IndexedDB).
import { useState } from 'preact/hooks';
import { Card, Btn, TextInput, Select, NumInput, Empty } from '../common.jsx';
import { commit, toast } from '../store.js';
import { copyText } from '../native.js';
import { delBlob, soundKey } from '../idb.js';
import { slug } from '../../core/util.js';
import { importSound, togglePlay, player, openSoundEditor, stopSound } from '../audio.jsx';

const CATEGORIES = ['hostile', 'neutral', 'ambient', 'player', 'block', 'weather', 'music', 'record', 'ui'];

export function SoundLibrary({ p }) {
  const [busy, setBusy] = useState(false);
  const sounds = p.sounds || [];
  const add = async () => { setBusy(true); await importSound(p); setBusy(false); };
  const upd = (s, fn, key) => commit((pp) => fn(pp.sounds.find((x) => x.uid === s.uid)), key);
  return (
    <Card title="Custom sounds" sub="Your own .ogg/.wav files: screams, whispers, footsteps… Preview, edit and use them in any sound picker." right={<Btn small icon="upload" kind="primary" disabled={busy} onClick={add}>{busy ? 'Adding…' : 'Upload'}</Btn>}>
      {!sounds.length && <Empty icon="🔊" title="No custom sounds">Upload an .ogg or .wav. It becomes <code>{p.namespace}.name</code>, usable in Sounds tabs, dweller scares and /playsound.</Empty>}
      {sounds.map((s) => (
        <div class="csnd">
          <Btn small kind={player.uid === s.uid ? 'primary' : ''} icon={player.uid === s.uid ? 'pause' : 'play'} aria-label={`${player.uid === s.uid ? 'Pause' : 'Play'} ${s.name}`} onClick={() => togglePlay(p, s)} />
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
            <Btn small kind="ghost" icon="edit" aria-label={`Edit ${s.name}`} onClick={() => openSoundEditor(p, s)} />
            <Btn small kind="ghost" icon="copy" aria-label="Copy sound id" onClick={() => { copyText(`${p.namespace}.${s.name}`); toast('Copied sound id'); }} />
            <Btn small kind="ghost" icon="trash" aria-label={`Delete ${s.name}`} onClick={() => { if (player.uid === s.uid) stopSound(); commit((pp) => { pp.sounds = pp.sounds.filter((x) => x.uid !== s.uid); }); delBlob(soundKey(p.id, s.uid)).catch(() => {}); }} />
          </div>
        </div>
      ))}
      <p class="hint">Built-in game sounds (like <code>mob.warden.roar</code>) play in game but can't be previewed here: they belong to the game and aren't included in this app.</p>
    </Card>
  );
}
