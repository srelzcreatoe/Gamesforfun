import { useState, useEffect } from 'preact/hooks';
import { Btn, Icon, Card, Row, TextInput, Select, NumInput, Empty, confirmDialog } from '../common.jsx';
import { state, commit, go, openModal, closeModal, toast, render } from '../store.js';
import { PRESETS, entityFromPreset } from '../../core/presets.js';
import { TARGETS, duplicateEntity } from '../../core/model.js';
import { slug } from '../../core/util.js';
import { renderFrontSprite } from '../textures.js';
import { exportAddon, exportBackup, issues } from '../exporting.js';
import { pickFile, readAsDataURL } from '../native.js';
import { IssueList } from './issues.jsx';

export function Thumb({ entity, size = 56 }) {
  const [url, setUrl] = useState(null);
  const key = JSON.stringify([entity.model.bones, entity.textures?.[0]?.data?.length, entity.textures?.[0]?.data?.slice(-40), entity.egg, entity.autoPaint]);
  useEffect(() => {
    let alive = true;
    renderFrontSprite(entity, 96).then((u) => alive && setUrl(u)).catch(() => {});
    return () => { alive = false; };
  }, [key]);
  return <span class="thumb" style={{ width: size, height: size }}>{url && <img src={url} alt="" />}</span>;
}

export function newEntityDialog() {
  function Body() {
    const [preset, setPreset] = useState('animal');
    const [name, setName] = useState('');
    const p = state.project;
    const id = slug(name || PRESETS.find((x) => x.id === preset).label, { fallback: 'mob' });
    let unique = id, i = 2;
    while (p.entities.some((e) => e.name === unique)) unique = `${id}_${i++}`;
    const create = () => {
      const e = entityFromPreset(p, preset, unique, name.trim() || undefined);
      commit((pp) => { pp.entities.push(e); });
      closeModal();
      go({ screen: 'entity', entityUid: e.uid });
    };
    return (
      <div class="new-entity">
        <label class="field"><span>Name</span><input class="txt" placeholder="e.g. Ember Fox" value={name} autoFocus onInput={(e) => setName(e.currentTarget.value)} /></label>
        <p class="hint">Id: <code>{p.namespace}:{unique}</code></p>
        <div class="preset-grid">
          {PRESETS.map((pr) => (
            <button type="button" class={`preset ${preset === pr.id ? 'on' : ''}`} onClick={() => setPreset(pr.id)}>
              <span class="preset-i">{pr.icon}</span>
              <strong>{pr.label}</strong>
              <span class="hint">{pr.blurb}</span>
            </button>
          ))}
        </div>
        <div class="actions sticky"><Btn kind="ghost" onClick={closeModal}>Cancel</Btn><Btn kind="primary" icon="plus" onClick={create}>Create</Btn></div>
      </div>
    );
  }
  openModal({ title: 'New entity', body: Body, wide: true });
}

export function exportDialog() {
  function Body() {
    const p = state.project;
    const list = issues(p);
    const errs = list.filter((x) => x.level === 'error');
    return (
      <div class="export">
        {errs.length ? (
          <div class="banner error"><Icon name="warn" /> {errs.length} problem{errs.length > 1 ? 's' : ''} will break the add-on. Fix them first, or export anyway.</div>
        ) : (
          <div class="banner ok"><Icon name="check" /> Ready: {p.entities.length} entit{p.entities.length === 1 ? 'y' : 'ies'}, no errors.</div>
        )}
        <div class="export-btns">
          <Btn kind="primary" icon="game" onClick={() => exportAddon(p, 'game')}>Open in Minecraft</Btn>
          <Btn icon="save" onClick={() => exportAddon(p, 'save')}>Save .mcaddon</Btn>
          <Btn icon="share" onClick={() => exportAddon(p, 'share')}>Share…</Btn>
        </div>
        <details class="more-exp">
          <summary>More export options</summary>
          <div class="export-btns">
            <Btn small onClick={() => exportAddon(p, 'bp')}>Behavior pack (.mcpack)</Btn>
            <Btn small onClick={() => exportAddon(p, 'rp')}>Resource pack (.mcpack)</Btn>
            <Btn small icon="save" onClick={() => exportBackup(p)}>Project backup (.json)</Btn>
          </div>
        </details>
        <p class="hint">After importing, open a world's settings → Behavior Packs, activate “{p.name} (Behavior)” (the resource pack is added automatically), then play. Spawn eggs are in the creative inventory.</p>
        {list.length > 0 && <IssueList list={list} />}
      </div>
    );
  }
  openModal({ title: 'Export add-on', body: Body, wide: true });
}

export function ProjectScreen() {
  const p = state.project;
  if (!p) return <Empty title="No project open" />;
  const set = (k, key) => (v) => commit((pp) => { pp[k] = v; }, key || `p:${k}`);
  const list = issues(p);
  const errs = list.filter((x) => x.level === 'error').length;
  const warns = list.filter((x) => x.level === 'warn').length;
  return (
    <div class="screen project">
      <Card title="Entities" sub="Custom mobs in this add-on" right={<Btn small icon="plus" kind="primary" onClick={newEntityDialog}>New</Btn>}>
        {!p.entities.length && <Empty icon="🐣" title="No entities yet">Tap New and pick a starting point: animal, pet, monster, village dweller, guard, boss…</Empty>}
        <div class="ent-list">
          {p.entities.map((e) => (
            <div class="ent">
              <button type="button" class="ent-main" onClick={() => go({ screen: 'entity', entityUid: e.uid })}>
                <Thumb entity={e} />
                <span class="ent-text">
                  <strong>{e.displayName || e.name}</strong>
                  <code>{p.namespace}:{e.name}</code>
                  <span class="hint">{Object.keys(e.components).length} components · {e.groups.length} groups · {e.events.length} events{e.components['minecraft:dweller'] ? ' · dweller' : ''}</span>
                </span>
              </button>
              <div class="ent-act">
                <Btn small kind="ghost" icon="copy" aria-label="Duplicate" onClick={() => { commit((pp) => { pp.entities.push(duplicateEntity(e, pp)); }); toast('Duplicated'); }} />
                <Btn small kind="ghost" icon="trash" aria-label="Delete" onClick={() => confirmDialog('Delete entity?', `Delete ${e.displayName || e.name}? You can undo right after.`, 'Delete', () => commit((pp) => { pp.entities = pp.entities.filter((x) => x.uid !== e.uid); }))} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Export" sub={errs ? `${errs} error${errs > 1 ? 's' : ''}, ${warns} warning${warns === 1 ? '' : 's'}` : warns ? `${warns} warning${warns > 1 ? 's' : ''}, no errors` : 'Everything checks out'}>
        <div class="export-btns">
          <Btn kind="primary" icon="game" onClick={exportDialog}>Export / open in Minecraft</Btn>
          <Btn icon="save" kind="ghost" onClick={() => exportBackup(p)}>Backup</Btn>
        </div>
      </Card>

      <Card title="Add-on settings">
        <Row label="Name"><TextInput value={p.name} onChange={set('name')} /></Row>
        <Row label="Namespace" hint="Prefix for every id (yourname:mob). Avoid changing after release.">
          <TextInput value={p.namespace} mono onChange={(v) => commit((pp) => { pp.namespace = slug(v, { fallback: '' }); }, 'p:ns')} />
        </Row>
        <Row label="Description"><TextInput value={p.description} onChange={set('description')} /></Row>
        <Row label="Author"><TextInput value={p.author} onChange={set('author')} placeholder="optional" /></Row>
        <Row label="Version" hint="Raise it when you publish an update.">
          <div class="vec">
            {[0, 1, 2].map((i) => <label><span>{['major', 'minor', 'patch'][i]}</span><NumInput int min={0} value={p.version[i]} onChange={(v) => commit((pp) => { pp.version[i] = v; }, 'p:ver')} /></label>)}
          </div>
        </Row>
        <Row label="Game version"><Select value={p.target} options={Object.entries(TARGETS).map(([k, t]) => [k, t.label])} onChange={set('target')} /></Row>
        <Row label="Pack icon" hint="Default: a sprite of your first mob.">
          <div class="inline">
            {p.icon && <img class="icon-prev" src={p.icon} alt="Pack icon" />}
            <Btn small icon="upload" onClick={async () => { const f = await pickFile('image/png'); if (f) { const d = await readAsDataURL(f); commit((pp) => { pp.icon = d; }); } }}>Choose PNG</Btn>
            {p.icon && <Btn small kind="ghost" onClick={() => commit((pp) => { pp.icon = null; })}>Use default</Btn>}
          </div>
        </Row>
      </Card>
      {list.length > 0 && <Card title="Checks" sub="Found by the validator before export"><IssueList list={list} /></Card>}
    </div>
  );
}
