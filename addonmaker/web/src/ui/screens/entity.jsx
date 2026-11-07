import { state, setTab, commit, currentEntity } from '../store.js';
import { Empty } from '../common.jsx';
import { OverviewTab } from '../tabs/overview.jsx';
import { DwellerTab } from '../tabs/dweller.jsx';
import { ComponentsTab, GroupsTab, EventsTab, PropertiesTab } from '../tabs/logic.jsx';
import { ModelTab } from '../tabs/model.jsx';
import { TextureTab } from '../tabs/texture.jsx';
import { AnimationsTab } from '../tabs/anims.jsx';
import { SoundsTab, SpawnTab, LootTab, TradesTab } from '../tabs/world.jsx';
import { FilesTab } from '../tabs/files.jsx';
import { BoardTab } from '../tabs/board.jsx';
import { isAdvanced, setSetting } from '../settings.js';

export const TABS = [
  ['overview', 'Overview', OverviewTab],
  ['dweller', 'Dweller', DwellerTab],
  ['board', 'Node board', BoardTab],
  ['components', 'Behavior', ComponentsTab],
  ['groups', 'Groups', GroupsTab],
  ['events', 'Events', EventsTab],
  ['properties', 'Properties', PropertiesTab],
  ['model', 'Model', ModelTab],
  ['texture', 'Texture', TextureTab],
  ['animations', 'Animations', AnimationsTab],
  ['sounds', 'Sounds', SoundsTab],
  ['spawn', 'Spawning', SpawnTab],
  ['loot', 'Loot & gear', LootTab],
  ['trades', 'Trades', TradesTab],
  ['files', 'Files', FilesTab],
];

/** Commit a change to one entity (looked up fresh so undo stays safe). */
export function ecommit(e, fn, key) {
  const id = e.uid;
  commit((p) => { const ent = p.entities.find((x) => x.uid === id); if (ent) fn(ent, p); }, key);
}

// Simple mode hides the raw JSON-level tabs; Advanced shows everything.
const ADVANCED_ONLY = new Set(['components', 'groups', 'events', 'properties', 'files']);
export function visibleTabs(e) {
  const adv = isAdvanced();
  return TABS.filter(([k]) => {
    if (!adv && ADVANCED_ONLY.has(k)) return false;
    if (k === 'board') return !!e.horror?.enabled;
    if (k === 'trades' && !adv) return !e.horror?.enabled || !!e.trades?.enabled;
    return true;
  });
}

export function EntityScreen() {
  const e = currentEntity();
  if (!e) return <Empty title="Entity not found" />;
  const tabs = visibleTabs(e);
  const tab = TABS.find((t) => t[0] === state.tab) || TABS[0];
  const Comp = tab[2];
  const counts = {
    components: Object.keys(e.components).length,
    groups: e.groups.length,
    events: e.events.length,
    properties: e.properties.length,
  };
  return (
    <div class="screen entity">
      <nav class="tabs" role="tablist">
        {tabs.map(([k, l]) => (
          <button type="button" role="tab" aria-selected={k === tab[0]} class={`tab ${k === tab[0] ? 'on' : ''} ${k === 'dweller' ? 'feature' : ''}`} onClick={() => setTab(k)}>
            {l}{counts[k] ? <span class="tab-n">{counts[k]}</span> : null}
          </button>
        ))}
        <button type="button" class="tab mode-tab" title="Switch between Simple and Advanced" onClick={() => setSetting('mode', isAdvanced() ? 'simple' : 'advanced')}>{isAdvanced() ? 'Simple' : 'Advanced ›'}</button>
      </nav>
      <div class="tab-body" key={tab[0]}>
        <Comp e={e} p={state.project} />
      </div>
    </div>
  );
}
