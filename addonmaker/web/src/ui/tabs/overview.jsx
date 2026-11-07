import { useState } from 'preact/hooks';
import { Card, Row, TextInput, Toggle, NumInput, Select, Chips, Btn } from '../common.jsx';
import { Preview3D, PREVIEW_MODES } from '../preview3d.jsx';
import { ecommit } from '../screens/entity.jsx';
import { slug } from '../../core/util.js';
import { setTab, toast } from '../store.js';
import { vanilla } from '../meta.js';

export const SPAWN_CATEGORIES = [['', '(not set)'], 'creature', 'monster', 'ambient', 'water_creature', 'water_ambient', 'underground_water_creature', 'axolotls', 'misc'];

export function ModeChips({ mode, setMode, extra = [] }) {
  return (
    <div class="mode-chips">
      {[...PREVIEW_MODES, ...extra].map(([k, l]) => <button type="button" class={`cchip ${mode === k ? 'on' : ''}`} onClick={() => setMode(k)}>{l}</button>)}
    </div>
  );
}

export function OverviewTab({ e, p }) {
  const [mode, setMode] = useState(e.anims?.fly?.on ? 'fly' : e.anims?.swim?.on ? 'swim' : 'walk');
  const c = e.components;
  const stat = (id, key, def) => (c[id] ? c[id][key] : undefined) ?? def;
  const setStat = (id, key, v, extra = {}) => ecommit(e, (en) => { en.components[id] = { ...(en.components[id] || extra), [key]: v }; }, `ov:${id}:${key}`);
  const fam = c['minecraft:type_family']?.family || [];
  return (
    <div class="tab-overview">
      <div class="preview-wrap">
        <Preview3D entity={e} mode={mode} height={280} />
        <ModeChips mode={mode} setMode={setMode} />
      </div>

      {e.horror?.enabled && (
        <button type="button" class="horror-banner" onClick={() => setTab('dweller')}>
          <span>👁</span><span><strong>Horror dweller: {e.horror.archetype}</strong><span class="hint">Reacts when seen: {e.horror.senses.seen} · hunts at {e.horror.hunt.speed}× speed · tap to tune</span></span>
        </button>
      )}
      <Card title="Identity">
        <Row label="Display name"><TextInput value={e.displayName} onChange={(v) => ecommit(e, (en) => { en.displayName = v; }, 'ov:dn')} /></Row>
        <Row label="Id" hint={`${p.namespace}:${e.name}`}>
          <TextInput value={e.name} mono onChange={(v) => ecommit(e, (en) => { en.name = slug(v, { fallback: '' }); }, 'ov:id')} />
        </Row>
        <Toggle label="Spawn egg & /summon list" hint="is_spawnable: adds a spawn egg in the creative inventory" value={e.spawnable} onChange={(v) => ecommit(e, (en) => { en.spawnable = v; })} />
        <Toggle label="Allow /summon" value={e.summonable} onChange={(v) => ecommit(e, (en) => { en.summonable = v; })} />
        <Toggle label="Experimental" hint="Only appears with experimental toggles on" value={e.experimental} onChange={(v) => ecommit(e, (en) => { en.experimental = v; })} />
        <Row label="Spawn category"><Select value={e.spawnCategory || ''} options={SPAWN_CATEGORIES} onChange={(v) => ecommit(e, (en) => { en.spawnCategory = v; })} /></Row>
      </Card>

      <Card title="Quick stats" sub="Shortcuts into the base components">
        <Row label="Health" hint="2 = one heart">
          <NumInput int min={1} value={typeof stat('minecraft:health', 'value', 20) === 'number' ? stat('minecraft:health', 'value', 20) : 20} onChange={(v) => ecommit(e, (en) => { en.components['minecraft:health'] = { ...(en.components['minecraft:health'] || {}), value: v, max: v }; }, 'ov:hp')} />
        </Row>
        <Row label="Walk speed" hint="0.25 is normal">
          <NumInput min={0} value={stat('minecraft:movement', 'value', 0.25)} onChange={(v) => setStat('minecraft:movement', 'value', v)} />
        </Row>
        <Row label="Melee damage">
          <NumInput min={0} value={typeof stat('minecraft:attack', 'damage', 0) === 'number' ? stat('minecraft:attack', 'damage', 0) : undefined} placeholder="range set" onChange={(v) => setStat('minecraft:attack', 'damage', v)} />
        </Row>
        <Row label="Hitbox (blocks)">
          <div class="vec">
            <label><span>width</span><NumInput min={0} value={stat('minecraft:collision_box', 'width', 0.6)} onChange={(v) => setStat('minecraft:collision_box', 'width', v, { width: 0.6, height: 1.8 })} /></label>
            <label><span>height</span><NumInput min={0} value={stat('minecraft:collision_box', 'height', 1.8)} onChange={(v) => setStat('minecraft:collision_box', 'height', v, { width: 0.6, height: 1.8 })} /></label>
          </div>
        </Row>
        <Row label="Size scale"><NumInput min={0.01} value={stat('minecraft:scale', 'value', 1)} onChange={(v) => setStat('minecraft:scale', 'value', v)} /></Row>
        <Row label="Families" hint="Used by filters, e.g. is_family monster" wide>
          <Chips values={fam} list="dl-families" onChange={(v) => ecommit(e, (en) => { en.components['minecraft:type_family'] = { family: v }; })} />
        </Row>
      </Card>

      <Card title="Spawn egg">
        <Toggle label="Has a spawn egg" value={e.egg?.enabled !== false} onChange={(v) => ecommit(e, (en) => { en.egg.enabled = v; })} />
        <Row label="Colours">
          <div class="inline">
            <input type="color" value={e.egg?.base || '#3f6fb5'} aria-label="Egg base colour" onInput={(ev) => { const v = ev.currentTarget.value; ecommit(e, (en) => { en.egg.base = v; }, 'ov:egg1'); }} />
            <input type="color" value={e.egg?.overlay || '#f2c14e'} aria-label="Egg spot colour" onInput={(ev) => { const v = ev.currentTarget.value; ecommit(e, (en) => { en.egg.overlay = v; }, 'ov:egg2'); }} />
            <span class="egg" style={{ background: e.egg?.base, '--spot': e.egg?.overlay }} />
          </div>
        </Row>
      </Card>

      <Card title="Advanced">
        <Row label="Runtime identifier" hint="Borrow a vanilla mob's hard-coded engine behaviour (optional)">
          <TextInput value={e.runtimeId} list="dl-vanilla-entities" mono placeholder="e.g. minecraft:zombie" onChange={(v) => ecommit(e, (en) => { en.runtimeId = v; }, 'ov:rt')} />
        </Row>
        <div class="quick-links">
          <Btn small onClick={() => setTab('dweller')}>🏘 Village & dweller settings</Btn>
          <Btn small onClick={() => setTab('components')}>⚙ All components</Btn>
          <Btn small onClick={() => setTab('files')}>📄 Generated files</Btn>
        </div>
      </Card>
    </div>
  );
}
