import { useState, useEffect } from 'preact/hooks';
import { Btn, Icon, Empty, confirmDialog, promptDialog, Toggle, Row } from '../common.jsx';
import { listProjects, openProject, setProject, deleteProject, go, toast, render, state, commit, openModal, closeModal } from '../store.js';
import { newProject, migrateProject } from '../../core/model.js';
import { entityFromPreset } from '../../core/presets.js';
import { DWELLER_PRESETS, dwellerFromPreset } from '../../core/dwellers.js';
import { ARCHETYPES, DWELLER_TYPES } from '../../core/horror.js';
import { parseLenientJSON, uid, uuid, base64ToBytes } from '../../core/util.js';
import { pickFile, readAsText } from '../native.js';
import { catalog } from '../meta.js';
import { putBlob, delPrefix, soundKey } from '../idb.js';
import { renderFrontSprite } from '../textures.js';
import { settings, setSetting, TRACKS, music, play, pause, toggle } from '../settings.js';
import { openDwellerWizard } from './wizard.jsx';

export function exampleProject() {
  const p = newProject('Village Life');
  p.description = 'A trader, a guard and a loyal pet for your villages. Made with Mobsmith.';
  p.namespace = 'villagelife';
  p.entities.push(entityFromPreset(p, 'villager', 'baker', 'Baker'));
  p.entities.push(entityFromPreset(p, 'guard', 'stone_warden', 'Stone Warden'));
  p.entities.push(entityFromPreset(p, 'pet', 'hearth_hound', 'Hearth Hound'));
  return p;
}
export function horrorExample() {
  const p = newProject('Night Terrors');
  p.description = 'Dwellers that stalk caves and dark forests. Made with Mobsmith.';
  p.namespace = 'nightterrors';
  for (const id of ['night_grinner', 'hollow_grinner', 'still_one']) p.entities.push(dwellerFromPreset(p, id));
  return p;
}

const spriteCache = new Map();
function useSprite(key, make) {
  const [url, setUrl] = useState(spriteCache.get(key) || null);
  useEffect(() => {
    if (spriteCache.has(key)) { setUrl(spriteCache.get(key)); return; }
    let alive = true;
    make().then((u) => { spriteCache.set(key, u); if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [key]);
  return url;
}

function ProjectCard({ p }) {
  const full = (() => { try { return JSON.parse(localStorage.getItem(`mobsmith.p.${p.id}`)); } catch { return null; } })();
  const e = full?.entities?.[0];
  const url = useSprite(`proj:${p.id}:${p.updated}`, () => (e ? renderFrontSprite(migrateProject(full).entities[0], 96) : Promise.resolve(null)));
  return (
    <div class="pcard" role="button" tabIndex={0} onClick={() => openProject(p.id)} onKeyDown={(ev) => ev.key === 'Enter' && openProject(p.id)}>
      <div class="pcard-label">{p.name}</div>
      <div class="pcard-art">{url ? <img src={url} alt="" /> : <Icon name="folder" size={30} />}</div>
      <div class="pcard-sub">{p.count} mob{p.count === 1 ? '' : 's'}</div>
      <button type="button" class="pcard-x" aria-label={`Delete ${p.name}`} onClick={(ev) => {
        ev.stopPropagation();
        confirmDialog('Delete add-on?', `“${p.name}” will be removed from this device. Export a backup first if you want to keep it.`, 'Delete', () => { deleteProject(p.id); delPrefix(`${p.id}/`).catch(() => {}); toast('Deleted'); });
      }}>×</button>
    </div>
  );
}

function DwellerCard({ d, onPick }) {
  const url = useSprite(`dw:${d.id}`, () => renderFrontSprite(dwellerFromPreset({ namespace: 'x' }, d.id), 128));
  return (
    <div class={`pcard ${d.signature ? 'sig' : ''}`} role="button" tabIndex={0} onClick={() => onPick(d)} onKeyDown={(ev) => ev.key === 'Enter' && onPick(d)}>
      <div class="pcard-label">{d.label}</div>
      <div class="pcard-art">{url ? <img src={url} alt="" /> : <span>{d.icon}</span>}</div>
      <div class="pcard-sub">{ARCHETYPES[d.style]?.label} · {DWELLER_TYPES.find((t) => t[0] === d.type)?.[1]}</div>
      {d.signature && <span class="badge-sig">★</span>}
    </div>
  );
}

/** Ask which add-on a new mob goes into, then call cb(project). */
export function chooseProject(title, cb) {
  const list = listProjects();
  const toNew = () => promptDialog('New add-on', 'Horror Dwellers', (name) => { const p = newProject(name); setProject(p); cb(); });
  if (state.project) { cb(); return; }
  if (!list.length) { toNew(); return; }
  function Body() {
    return (
      <div class="stack">
        <p class="hint">Pick the add-on it goes into.</p>
        {list.map((p) => <Btn onClick={() => { closeModal(); if (openProject(p.id)) cb(); }}>{p.name}</Btn>)}
        <Btn kind="primary" icon="plus" onClick={() => { closeModal(); toNew(); }}>New add-on</Btn>
      </div>
    );
  }
  openModal({ title, body: Body });
}

function addDweller(d) {
  chooseProject(`Add ${d.label}`, () => {
    const p = state.project;
    let name = d.id, i = 2;
    while (p.entities.some((e) => e.name === name)) name = `${d.id}_${i++}`;
    const e = dwellerFromPreset(p, d.id, name);
    commit((pp) => { pp.entities.push(e); });
    go({ screen: 'entity', entityUid: e.uid, tab: 'dweller' });
    toast(`${d.label} added. Tweak it or export it straight away.`, 'ok', 4000);
  });
}

function MusicCard() {
  const s = settings();
  return (
    <div class="stack">
      <div class="mini-player">
        <Btn icon={music.playing ? 'x' : 'play'} kind="primary" aria-label={music.playing ? 'Pause music' : 'Play music'} onClick={toggle} />
        <span class="np">{music.playing ? '♪ ' : ''}{TRACKS[music.track].title}</span>
        {music.playing && <span class="eq"><i /><i /><i /></span>}
      </div>
      <div class="tracklist">
        {TRACKS.map((t, i) => (
          <button type="button" class={`trk ${music.track === i ? 'on' : ''}`} onClick={() => { if (music.track === i && music.playing) pause(); else { if (!s.music) setSetting('music', true); play(i); } }}>
            <span class="trk-i">{t.icon}</span>
            <span class="trk-t"><strong>{t.title}</strong><span class="hint">{t.mood} · {t.len}</span></span>
            {music.track === i && music.playing ? <span class="eq"><i /><i /><i /></span> : <Icon name="play" size={16} />}
          </button>
        ))}
      </div>
      <Toggle label="Background music" hint="Starts when you tap the app" value={s.music} onChange={(v) => setSetting('music', v)} />
      <Toggle label="Shuffle" value={s.shuffle} onChange={(v) => setSetting('shuffle', v)} />
      <Row label="Volume"><input type="range" min="0" max="1" step="0.05" value={s.volume} aria-label="Music volume" onInput={(ev) => setSetting('volume', Number(ev.currentTarget.value))} /></Row>
    </div>
  );
}

export function Home() {
  const [tab, setTab] = useState(() => sessionStorage.getItem('mobsmith.hometab') || 'creator');
  const pick = (t) => { setTab(t); try { sessionStorage.setItem('mobsmith.hometab', t); } catch { /* ignore */ } };
  const projects = listProjects();
  const s = settings();
  const create = () => promptDialog('New add-on', 'My Add-on', (name) => {
    const p = newProject(name);
    setProject(p);
    go({ screen: 'project' });
  }, { label: 'Add-on name', hint: 'You can change it later.' });
  const importBackup = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try {
      const data = parseLenientJSON(await readAsText(f));
      const p = migrateProject(data.project || data);
      p.id = uid();
      if (listProjects().some((x) => x.ns === p.namespace)) p.uuids = { bp: uuid(), bpModule: uuid(), rp: uuid(), rpModule: uuid() };
      for (const [suid, b64] of Object.entries(data.soundData || {})) await putBlob(soundKey(p.id, suid), base64ToBytes(b64));
      setProject(p);
      go({ screen: 'project' });
      toast(`Imported “${p.name}”`, 'ok');
    } catch (e) { toast('Not a Mobsmith backup: ' + e.message, 'error', 5000); }
  };
  return (
    <div class="screen home">
      <div class="home-tabs" role="tablist">
        {[['creator', 'Creator'], ['dwellers', 'Dwellers'], ['settings', 'Settings']].map(([k, l]) => (
          <button type="button" role="tab" aria-selected={tab === k} class={tab === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>
        ))}
      </div>

      {tab === 'creator' && <>
        <div class="pgrid">
          <div class="pcard" role="button" tabIndex={0} onClick={create} onKeyDown={(ev) => ev.key === 'Enter' && create()}>
            <div class="pcard-label">New</div>
            <div class="pcard-art"><span class="plus">+</span></div>
            <div class="pcard-sub">add-on</div>
          </div>
          {projects.map((p) => <ProjectCard p={p} key={p.id} />)}
        </div>
        {!projects.length && <p class="hint">Tap NEW to start, open the Dwellers tab for ready-made horror mobs, or load an example below.</p>}
        <h2 class="sec">Examples</h2>
        <div class="actions wrap" style={{ justifyContent: 'flex-start' }}>
          <Btn icon="wand" onClick={() => { const p = horrorExample(); setProject(p); go({ screen: 'project' }); toast('Night Terrors loaded', 'ok'); }}>Night Terrors</Btn>
          <Btn icon="wand" onClick={() => { const p = exampleProject(); setProject(p); go({ screen: 'project' }); toast('Village Life loaded', 'ok'); }}>Village Life</Btn>
          <Btn icon="upload" kind="ghost" onClick={importBackup}>Import backup</Btn>
        </div>
      </>}

      {tab === 'dwellers' && <>
        <div class="hero">
          <div class="logo">👁</div>
          <div>
            <h1>Dwellers</h1>
            <p>Horror mobs that stalk, watch and hunt. They show up on their own on a schedule you choose. Tap one to add it, or build your own.</p>
          </div>
        </div>
        <Btn kind="primary" icon="plus" onClick={() => chooseProject('Create a dweller', () => openDwellerWizard())}>Create your own dweller</Btn>
        <div class="pgrid">
          {DWELLER_PRESETS.map((d) => <DwellerCard d={d} key={d.id} onPick={addDweller} />)}
        </div>
      </>}

      {tab === 'settings' && <>
        <section class="card"><header class="card-h"><div class="card-title"><span class="card-icon">♪</span><div><h3>Music</h3><p class="hint">Five original tracks</p></div></div></header><div class="card-b"><MusicCard /></div></section>
        <section class="card"><header class="card-h"><div class="card-title"><span class="card-icon">⚙</span><div><h3>Editor mode</h3></div></div></header><div class="card-b">
          <div class="seg">
            <button type="button" class={s.mode === 'simple' ? 'on' : ''} onClick={() => setSetting('mode', 'simple')}>Simple</button>
            <button type="button" class={s.mode === 'advanced' ? 'on' : ''} onClick={() => setSetting('mode', 'advanced')}>Advanced</button>
          </div>
          <p class="hint">Simple shows the essentials. Advanced adds every component ({Object.keys(catalog.components).length}), groups, events, properties and the generated files.</p>
        </div></section>
        <section class="card"><header class="card-h"><div class="card-title"><span class="card-icon">💾</span><div><h3>Backups</h3></div></div></header><div class="card-b">
          <Btn icon="upload" onClick={importBackup}>Import backup (.json)</Btn>
        </div></section>
        <p class="foot-note">Mobsmith is not affiliated with Mojang or Microsoft. It exports standard add-on files (.mcaddon) that the game imports. Font: Silkscreen (SIL OFL).</p>
      </>}
    </div>
  );
}
