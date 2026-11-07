import { useState, useEffect } from 'preact/hooks';
import { Btn, Icon, Empty, confirmDialog, promptDialog } from '../common.jsx';
import { listProjects, openProject, setProject, deleteProject, go, toast, render, state } from '../store.js';
import { newProject, migrateProject } from '../../core/model.js';
import { entityFromPreset } from '../../core/presets.js';
import { parseLenientJSON, uid, uuid } from '../../core/util.js';
import { pickFile, readAsText } from '../native.js';
import { catalog } from '../meta.js';
import { putBlob, delPrefix, soundKey } from '../idb.js';
import { base64ToBytes } from '../../core/util.js';

export function horrorExample() {
  const p = newProject('Night Terrors');
  p.description = 'Horror dwellers that stalk caves and dark forests. Made with Mobsmith.';
  p.namespace = 'nightterrors';
  p.entities.push(entityFromPreset(p, 'h_stalker', 'pale_watcher', 'Pale Watcher'));
  p.entities.push(entityFromPreset(p, 'h_statue', 'still_one', 'The Still One'));
  p.entities.push(entityFromPreset(p, 'h_shade', 'hollow_shade', 'Hollow Shade'));
  return p;
}

export function exampleProject() {
  const p = newProject('Village Life');
  p.description = 'A trader, a guard and a loyal pet for your villages. Made with Mobsmith.';
  p.namespace = 'villagelife';
  p.entities.push(entityFromPreset(p, 'villager', 'baker', 'Baker'));
  p.entities.push(entityFromPreset(p, 'guard', 'stone_warden', 'Stone Warden'));
  p.entities.push(entityFromPreset(p, 'pet', 'hearth_hound', 'Hearth Hound'));
  return p;
}

function fmtDate(t) {
  try { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

export function Home() {
  const projects = listProjects();
  const create = () => promptDialog('New add-on', 'My Add-on', (name) => {
    const p = newProject(name);
    setProject(p);
    go({ screen: 'project' });
  }, { label: 'Add-on name', hint: 'You can change it later. The namespace (used in ids like yourname:mob) is made from it.' });
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
      <div class="hero">
        <div class="logo">⛏</div>
        <div>
          <h1>Mobsmith</h1>
          <p>Add-on studio for Minecraft: Bedrock Edition. Build custom mobs with every mechanic: {Object.keys(catalog.components).length} components, village and horror dwellers, schedules, trades, custom sounds, models, textures and animations.</p>
        </div>
      </div>
      <div class="actions wrap">
        <Btn icon="plus" kind="primary" onClick={create}>New add-on</Btn>
        <Btn icon="wand" onClick={() => { const p = exampleProject(); setProject(p); go({ screen: 'project' }); toast('Example loaded: open an entity to explore', 'ok'); }}>Try the example</Btn>
        <Btn icon="wand" onClick={() => { const p = horrorExample(); setProject(p); go({ screen: 'project' }); toast('Horror example loaded. Open one and check its Dweller tab.', 'ok'); }}>👁 Horror example</Btn>
        <Btn icon="upload" kind="ghost" onClick={importBackup}>Import backup</Btn>
      </div>
      <h2 class="sec">Your add-ons</h2>
      {!projects.length && <Empty icon="📦" title="No add-ons yet">Create one, or load the example to see a village trader, a guard and a pet already set up.</Empty>}
      <div class="proj-list">
        {projects.map((p) => (
          <div class="proj">
            <button type="button" class="proj-main" onClick={() => openProject(p.id)}>
              <span class="proj-icon"><Icon name="folder" /></span>
              <span class="proj-text">
                <strong>{p.name}</strong>
                <span class="hint">{p.count} entit{p.count === 1 ? 'y' : 'ies'} · {p.ns} · {fmtDate(p.updated)}</span>
              </span>
            </button>
            <Btn small kind="ghost" icon="trash" aria-label={`Delete ${p.name}`} onClick={() => confirmDialog('Delete add-on?', `“${p.name}” will be removed from this device. Export a backup first if you want to keep it.`, 'Delete', () => { deleteProject(p.id); delPrefix(`${p.id}/`).catch(() => {}); toast('Deleted'); })} />
          </div>
        ))}
      </div>
      <p class="foot-note">Mobsmith is not affiliated with Mojang or Microsoft. It exports standard add-on files (.mcaddon) that the game imports.</p>
    </div>
  );
}
