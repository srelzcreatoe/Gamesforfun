import { useEffect, useMemo } from 'preact/hooks';
import { useStore, back, undo, redo, canUndo, canRedo, state, go, saveNow } from './store.js';
import { Btn, Modal, Toasts } from './common.jsx';
import { Home } from './screens/home.jsx';
import { ProjectScreen, exportDialog } from './screens/project.jsx';
import { EntityScreen } from './screens/entity.jsx';
import { vanilla, catalog } from './meta.js';
import { activityGroup } from '../core/packgen.js';
import { BUILTIN_EVENTS } from '../core/validate.js';

function Datalists() {
  const p = state.project;
  const e = p?.entities.find((x) => x.uid === state.entityUid);
  const statics = useMemo(() => (
    <>
      <datalist id="dl-items">{vanilla.items.map((v) => <option value={v} />)}</datalist>
      <datalist id="dl-blocks">{vanilla.blocks.map((v) => <option value={v} />)}</datalist>
      <datalist id="dl-vanilla-entities">{vanilla.entities.map((v) => <option value={v} />)}</datalist>
      <datalist id="dl-families">{vanilla.families.map((v) => <option value={v} />)}</datalist>
      <datalist id="dl-effects">{vanilla.effects.map((v) => <option value={v} />)}</datalist>
      <datalist id="dl-sounds">{vanilla.sounds.map((v) => <option value={v} />)}</datalist>
      <datalist id="dl-biomes">{vanilla.biomes.map((v) => <option value={v.replace('minecraft:', '')} />)}</datalist>
      <datalist id="dl-biometags">{vanilla.biomeTags.map((v) => <option value={v} />)}</datalist>
      <datalist id="dl-causes">{vanilla.causes.map((v) => <option value={v} />)}</datalist>
      <datalist id="dl-components">{Object.keys(catalog.components).map((v) => <option value={v} />)}</datalist>
    </>
  ), []);
  const ents = p ? [...p.entities.map((x) => `${p.namespace}:${x.name}`), ...vanilla.entities] : vanilla.entities;
  const events = e ? [...e.events.map((x) => x.name), ...(e.schedule?.enabled ? e.schedule.activities.map((a) => `${p.namespace}:schedule_${a.name}`) : []), ...BUILTIN_EVENTS.filter((b) => !e.events.some((x) => x.name === b))] : BUILTIN_EVENTS;
  const groups = e ? [...e.groups.map((g) => g.name), ...(e.schedule?.enabled ? e.schedule.activities.map((a) => activityGroup(p, a.name)) : [])] : [];
  const fams = e ? (e.components['minecraft:type_family']?.family || []) : [];
  return (
    <div hidden>
      {statics}
      <datalist id="dl-entities">{ents.map((v) => <option value={v} />)}</datalist>
      <datalist id="dl-events">{events.map((v) => <option value={v} />)}</datalist>
      <datalist id="dl-groups">{groups.map((v) => <option value={v} />)}</datalist>
      <datalist id="dl-props">{(e?.properties || []).map((v) => <option value={v.name} />)}</datalist>
      <datalist id="dl-myfamilies">{fams.map((v) => <option value={v} />)}</datalist>
    </div>
  );
}

function TopBar() {
  const r = state.route;
  const p = state.project;
  const e = p?.entities.find((x) => x.uid === state.entityUid);
  const title = r.screen === 'home' ? 'Mobsmith' : r.screen === 'project' ? p?.name : e?.displayName || e?.name;
  const sub = r.screen === 'entity' && p && e ? `${p.namespace}:${e.name}` : r.screen === 'project' && p ? `${p.namespace} · ${p.entities.length} entities` : 'Bedrock add-on studio';
  return (
    <header class="top">
      {r.screen !== 'home' ? <Btn icon="back" kind="ghost" aria-label="Back" onClick={() => back()} /> : <span class="top-logo">⛏</span>}
      <div class="top-t"><strong>{title}</strong><span>{sub}</span></div>
      {r.screen !== 'home' && <>
        <Btn icon="undo" kind="ghost" aria-label="Undo" disabled={!canUndo()} onClick={undo} />
        <Btn icon="redo" kind="ghost" aria-label="Redo" disabled={!canRedo()} onClick={redo} />
        <Btn icon="export" kind="primary" aria-label="Export" onClick={exportDialog} />
      </>}
    </header>
  );
}

export function App() {
  useStore();
  useEffect(() => {
    window.mobsmithBack = () => (back() ? 'handled' : 'exit');
    const onHide = () => saveNow();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    window.mobsmithPause = onHide;
    const onKey = (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z' && !ev.target.closest?.('input,textarea')) { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('keydown', onKey); };
  }, []);
  const r = state.route;
  return (
    <div class="app">
      <TopBar />
      <main>
        {r.screen === 'home' && <Home />}
        {r.screen === 'project' && <ProjectScreen />}
        {r.screen === 'entity' && <EntityScreen />}
      </main>
      <Modal />
      <Toasts />
      <Datalists />
    </div>
  );
}
