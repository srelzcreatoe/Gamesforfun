// Sounds, natural spawning, loot & gear, trades.
import { useState } from 'preact/hooks';
import { Card, Btn, Row, Toggle, Select, NumInput, TextInput, Chips, Collapse, Empty, Icon } from '../common.jsx';
import { FilterEditor, JsonEditor } from '../fields.jsx';
import { ecommit } from '../screens/entity.jsx';
import { vanilla } from '../meta.js';
import { SoundPicker } from '../audio.jsx';
import { isObj, clone } from '../../core/util.js';

// ---------------- Sounds ----------------
const SOUND_EVENTS = ['ambient', 'hurt', 'death', 'step', 'attack', 'eat', 'jump', 'fall.big', 'fall.small', 'splash', 'swim', 'breathe', 'roar', 'haggle', 'haggle.yes', 'haggle.no', 'celebrate', 'mad', 'sleep'];
export function SoundsTab({ e }) {
  const s = e.sounds || { enabled: true, volume: 1, pitch: [0.8, 1.2], interval: 8, events: {} };
  const upd = (fn, key) => ecommit(e, (en) => { en.sounds ||= { enabled: true, volume: 1, pitch: [0.8, 1.2], interval: 8, events: {} }; fn(en.sounds); }, key);
  const evs = Object.entries(s.events || {});
  const [nk, setNk] = useState('ambient');
  return (
    <div>
      <Card title="Sounds" sub="Pick a game sound for each event, or upload your own (▶ previews your own sounds, ✎ edits them)">
        <Toggle label="Custom sounds for this mob" value={s.enabled} onChange={(v) => upd((x) => { x.enabled = v; })} />
        {s.enabled && <>
          <Row label="Volume"><NumInput min={0} value={s.volume} onChange={(v) => upd((x) => { x.volume = v; }, 'snd:v')} /></Row>
          <Row label="Pitch range"><div class="vec">
            <label><span>min</span><NumInput min={0} value={Array.isArray(s.pitch) ? s.pitch[0] : s.pitch} onChange={(v) => upd((x) => { x.pitch = [v, Array.isArray(x.pitch) ? x.pitch[1] : v]; }, 'snd:p')} /></label>
            <label><span>max</span><NumInput min={0} value={Array.isArray(s.pitch) ? s.pitch[1] : s.pitch} onChange={(v) => upd((x) => { x.pitch = [Array.isArray(x.pitch) ? x.pitch[0] : v, v]; }, 'snd:p')} /></label>
          </div></Row>
          <Row label="Ambient every (s)" hint="Average time between idle sounds"><NumInput min={1} value={s.interval} onChange={(v) => upd((x) => { x.interval = v; }, 'snd:i')} /></Row>
          {evs.map(([k, v]) => (
            <div class="snd">
              <code class="snd-k">{k}</code>
              <label class="mini"><span>vol</span><NumInput min={0} value={v.volume ?? 1} onChange={(n) => upd((x) => { x.events[k].volume = n; }, `snd:${k}:v`)} /></label>
              <label class="mini"><span>pitch</span><NumInput min={0} value={v.pitch ?? 1} onChange={(n) => upd((x) => { x.events[k].pitch = n; }, `snd:${k}:p`)} /></label>
              <Btn small kind="ghost" icon="trash" aria-label={`Remove ${k} sound`} onClick={() => upd((x) => { delete x.events[k]; })} />
              <SoundPicker value={v.sound} onChange={(t) => upd((x) => { x.events[k].sound = t; }, `snd:${k}`)} />
            </div>
          ))}
          <div class="inline">
            <Select value={nk} options={[...SOUND_EVENTS.filter((x) => !s.events?.[x]), ...vanilla.soundEvents.filter((x) => !SOUND_EVENTS.includes(x) && !s.events?.[x])]} onChange={setNk} />
            <Btn small icon="plus" onClick={() => upd((x) => { x.events ||= {}; x.events[nk] = { sound: '', volume: 1, pitch: 1 }; })}>Add sound</Btn>
          </div>
          <p class="hint">Hurt, death and step play automatically. Ambient needs an interval (added for you on export).</p>
        </>}
      </Card>
    </div>
  );
}

// ---------------- Spawning ----------------
const PLACE = [['minecraft:spawns_on_surface', 'On the surface'], ['minecraft:spawns_underground', 'Underground / caves'], ['minecraft:spawns_underwater', 'Underwater'], ['minecraft:spawns_lava', 'In lava']];
const DIFF = ['peaceful', 'easy', 'normal', 'hard'];
const COND_EXTRA = [
  ['minecraft:height_filter', 'Height (Y level)', { min: 0, max: 128 }],
  ['minecraft:density_limit', 'Max nearby (density)', { surface: 8, underground: 4 }],
  ['minecraft:delay_filter', 'Spawn delay', { min: 600, max: 660, identifier: '', spawn_chance: 50 }],
  ['minecraft:world_age_filter', 'Minimum world age', { min: 24000 }],
  ['minecraft:distance_filter', 'Distance from player', { min: 24, max: 128 }],
  ['minecraft:spawns_on_block_prevented_filter', 'Never on these blocks', ['minecraft:bedrock']],
  ['minecraft:disallow_spawns_in_bubble', 'Not in bubble columns', {}],
  ['minecraft:player_in_village_filter', 'Only near villages', { distance: 32, village_border_tolerance: 8 }],
  ['minecraft:permute_type', 'Sometimes spawn as another mob', [{ weight: 95 }, { weight: 5, entity_type: 'minecraft:zombie' }]],
];

function SpawnCondition({ c, set, onRemove, i }) {
  const u = (k, v) => { const n = { ...c }; if (v === undefined) delete n[k]; else n[k] = v; set(n); };
  const br = c['minecraft:brightness_filter'], df = c['minecraft:difficulty_filter'], herd = c['minecraft:herd'], w = c['minecraft:weight'];
  const onBlocks = c['minecraft:spawns_on_block_filter'];
  const blocks = Array.isArray(onBlocks) ? onBlocks : onBlocks ? [onBlocks] : [];
  const handled = new Set(['minecraft:brightness_filter', 'minecraft:difficulty_filter', 'minecraft:herd', 'minecraft:weight', 'minecraft:spawns_on_block_filter', 'minecraft:biome_filter', ...PLACE.map((x) => x[0])]);
  return (
    <Card title={`Condition ${i + 1}`} sub="All of these must be true" right={<Btn small kind="ghost" icon="trash" aria-label="Delete condition" onClick={onRemove} />}>
      <div class="checks">{PLACE.map(([k, l]) => <Toggle label={l} value={!!c[k]} onChange={(v) => u(k, v ? {} : undefined)} />)}</div>
      <Row label="Light level" hint="0 dark … 15 daylight"><div class="vec">
        <label><span>min</span><NumInput int min={0} max={15} value={br?.min ?? 0} onChange={(v) => u('minecraft:brightness_filter', Object.assign({ min: 0, max: 15, adjust_for_weather: true }, br, { min: v }))} /></label>
        <label><span>max</span><NumInput int min={0} max={15} value={br?.max ?? 15} onChange={(v) => u('minecraft:brightness_filter', Object.assign({ min: 0, max: 15, adjust_for_weather: true }, br, { max: v }))} /></label>
      </div></Row>
      <Row label="Difficulty"><div class="inline">
        <Select value={df?.min || 'easy'} options={DIFF} onChange={(v) => u('minecraft:difficulty_filter', { max: 'hard', ...(df || {}), min: v })} />
        <span class="hint">to</span>
        <Select value={df?.max || 'hard'} options={DIFF} onChange={(v) => u('minecraft:difficulty_filter', { min: 'easy', ...(df || {}), max: v })} />
        {df && <Btn small kind="ghost" icon="x" aria-label="Any difficulty" onClick={() => u('minecraft:difficulty_filter', undefined)} />}
      </div></Row>
      <Row label="Weight" hint="Higher = more common (zombie is 100)"><NumInput int min={1} value={w?.default ?? 10} onChange={(v) => u('minecraft:weight', { default: v })} /></Row>
      <Row label="Group size"><div class="vec">
        <label><span>min</span><NumInput int min={1} value={herd?.min_size ?? 1} onChange={(v) => u('minecraft:herd', Object.assign({ min_size: 1, max_size: 1 }, herd, { min_size: v }))} /></label>
        <label><span>max</span><NumInput int min={1} value={herd?.max_size ?? 1} onChange={(v) => u('minecraft:herd', Object.assign({ min_size: 1, max_size: 1 }, herd, { max_size: v }))} /></label>
      </div></Row>
      <Row label="Only on blocks" wide><Chips values={blocks} list="dl-blocks" placeholder="any block" onChange={(v) => u('minecraft:spawns_on_block_filter', v.length ? (v.length === 1 ? v[0] : v) : undefined)} /></Row>
      <div class="field-row block"><div class="field-l"><span class="field-name">Biomes</span><span class="hint">e.g. has_biome_tag forest. Combine tags with groups.</span></div>
        <div class="field-v"><FilterEditor value={c['minecraft:biome_filter']} set={(f) => u('minecraft:biome_filter', f)} /></div></div>
      {!c['minecraft:biome_filter'] && <div class="inline wrap"><span class="hint">Quick:</span>{['animal', 'monster', 'forest', 'plains', 'desert', 'taiga', 'jungle', 'ocean', 'swamp', 'mountain', 'nether'].map((t) => <Btn small onClick={() => u('minecraft:biome_filter', { test: 'has_biome_tag', operator: '==', value: t })}>{t}</Btn>)}</div>}
      {Object.keys(c).filter((k) => !handled.has(k)).map((k) => (
        <div class="field-row block"><div class="field-l"><span class="field-name">{COND_EXTRA.find((x) => x[0] === k)?.[1] || k}</span><code class="hint">{k}</code>
          <button type="button" class="field-x" aria-label="Remove" onClick={() => u(k, undefined)}><Icon name="x" size={14} /></button></div>
          <div class="field-v"><JsonEditor value={c[k]} set={(v) => u(k, v)} small /></div></div>
      ))}
      <Select value="" options={[['', '+ More conditions…'], ...COND_EXTRA.filter(([k]) => !(k in c)).map(([k, l]) => [k, l])]} onChange={(k) => { if (k) u(k, clone(COND_EXTRA.find((x) => x[0] === k)[2])); }} />
    </Card>
  );
}

export function SpawnTab({ e }) {
  const s = e.spawn;
  const upd = (fn, key) => ecommit(e, (en) => fn(en.spawn), key);
  return (
    <div>
      <Card title="Natural spawning" sub="Where and when this mob appears in the world by itself">
        <Toggle label="Spawns naturally" value={s.enabled} onChange={(v) => upd((x) => {
          x.enabled = v;
          if (v && !x.conditions.length) x.conditions.push({ 'minecraft:spawns_on_surface': {}, 'minecraft:brightness_filter': { min: 7, max: 15, adjust_for_weather: false }, 'minecraft:weight': { default: 8 }, 'minecraft:herd': { min_size: 1, max_size: 3 }, 'minecraft:biome_filter': { test: 'has_biome_tag', operator: '==', value: 'animal' } });
        })} />
        {s.enabled && <Row label="Population cap" hint="Which mob cap it counts against"><Select value={s.population} options={[['animal', 'Animal'], ['monster', 'Monster'], ['water_animal', 'Water animal'], ['ambient', 'Ambient (bats)'], ['cat', 'Cat'], ['pillager', 'Pillager']]} onChange={(v) => upd((x) => { x.population = v; })} /></Row>}
      </Card>
      {s.enabled && s.conditions.map((c, i) => (
        <SpawnCondition c={c} i={i} set={(nc) => upd((x) => { x.conditions[i] = nc; }, `sp:${i}`)} onRemove={() => upd((x) => { x.conditions.splice(i, 1); })} />
      ))}
      {s.enabled && <Btn icon="plus" onClick={() => upd((x) => { x.conditions.push({ 'minecraft:spawns_on_surface': {}, 'minecraft:weight': { default: 8 } }); })}>Add condition</Btn>}
      {s.enabled && <p class="hint pad">Each condition is a separate way it can spawn (e.g. forests by day and caves at night).</p>}
    </div>
  );
}

// ---------------- Loot & gear ----------------
const LOOT_CONDS = [
  ['killed_by_player', 'Killed by a player', {}],
  ['killed_by_player_or_pets', 'Killed by a player or their pet', {}],
  ['random_chance', 'Random chance', { chance: 0.5 }],
  ['random_chance_with_looting', 'Chance (better with Looting)', { chance: 0.05, looting_multiplier: 0.01 }],
];
function LootEntry({ en, set, onRemove }) {
  const fns = en.functions || [];
  const sc = fns.find((f) => f.function === 'set_count');
  const le = fns.find((f) => f.function === 'looting_enchant');
  const setFn = (name, val) => {
    const rest = fns.filter((f) => f.function !== name);
    set({ ...en, functions: val ? [...rest, { function: name, ...val }] : rest });
  };
  const other = fns.filter((f) => f.function !== 'set_count' && f.function !== 'looting_enchant');
  return (
    <div class="loot-entry">
      <div class="inline">
        <Select value={en.type || 'item'} options={[['item', 'Item'], ['empty', 'Nothing'], ['loot_table', 'Other loot table']]} onChange={(t) => set({ ...en, type: t })} />
        {en.type !== 'empty' && <TextInput value={en.name} list={en.type === 'loot_table' ? null : 'dl-items'} mono placeholder={en.type === 'loot_table' ? 'loot_tables/entities/zombie.json' : 'minecraft:diamond'} onChange={(v) => set({ ...en, name: v })} />}
        <Btn small kind="ghost" icon="trash" aria-label="Remove entry" onClick={onRemove} />
      </div>
      <div class="inline wrap">
        <label class="mini"><span>weight</span><NumInput int min={1} value={en.weight ?? 1} onChange={(v) => set({ ...en, weight: v })} /></label>
        {en.type !== 'empty' && en.type !== 'loot_table' && <>
          <label class="mini"><span>count</span><NumInput int min={0} value={sc?.count?.min ?? 1} onChange={(v) => setFn('set_count', { count: { min: v, max: Math.max(v, sc?.count?.max ?? v) } })} /></label>
          <label class="mini"><span>to</span><NumInput int min={0} value={sc?.count?.max ?? 1} onChange={(v) => setFn('set_count', { count: { min: Math.min(v, sc?.count?.min ?? v), max: v } })} /></label>
          <Toggle label="+ Looting bonus" value={!!le} onChange={(v) => setFn('looting_enchant', v ? { count: { min: 0, max: 1 } } : null)} />
        </>}
      </div>
      {other.length > 0 && <details><summary class="hint">{other.length} more function(s)</summary><JsonEditor value={other} set={(v) => set({ ...en, functions: [...fns.filter((f) => f.function === 'set_count' || f.function === 'looting_enchant'), ...(Array.isArray(v) ? v : [])] })} small /></details>}
    </div>
  );
}

export function LootTab({ e }) {
  const l = e.loot, g = e.gear;
  const upd = (fn, key) => ecommit(e, (en) => fn(en.loot), key);
  const updG = (fn, key) => ecommit(e, (en) => fn(en.gear), key);
  return (
    <div>
      <Card title="Drops on death">
        <Toggle label="Custom loot" value={l.enabled} onChange={(v) => upd((x) => { x.enabled = v; if (v && !x.pools.length) x.pools.push({ rolls: 1, entries: [{ type: 'item', name: 'minecraft:bone', weight: 1, functions: [{ function: 'set_count', count: { min: 0, max: 2 } }] }] }); })} />
      </Card>
      {l.enabled && l.pools.map((pool, pi) => {
        const setPool = (np, key) => upd((x) => { x.pools[pi] = np; }, key);
        const conds = pool.conditions || [];
        return (
          <Card title={`Pool ${pi + 1}`} sub="Rolls pick from the entries by weight" right={<Btn small kind="ghost" icon="trash" aria-label="Delete pool" onClick={() => upd((x) => { x.pools.splice(pi, 1); })} />}>
            <Row label="Rolls">
              {isObj(pool.rolls) ? (
                <div class="vec">
                  <label><span>min</span><NumInput int min={0} value={pool.rolls.min} onChange={(v) => setPool({ ...pool, rolls: { ...pool.rolls, min: v } }, `lp:${pi}`)} /></label>
                  <label><span>max</span><NumInput int min={0} value={pool.rolls.max} onChange={(v) => setPool({ ...pool, rolls: { ...pool.rolls, max: v } }, `lp:${pi}`)} /></label>
                </div>
              ) : <div class="inline"><NumInput int min={0} value={pool.rolls ?? 1} onChange={(v) => setPool({ ...pool, rolls: v }, `lp:${pi}`)} /><Btn small kind="ghost" onClick={() => setPool({ ...pool, rolls: { min: 1, max: 2 } })}>⇄ range</Btn></div>}
            </Row>
            <div class="stack">
              {conds.map((c, ci) => {
                const meta = LOOT_CONDS.find((x) => x[0] === c.condition);
                return (
                  <div class="inline wrap loot-cond">
                    <span class="tag">{meta?.[1] || c.condition}</span>
                    {'chance' in c && <label class="mini"><span>chance</span><NumInput min={0} max={1} value={c.chance} onChange={(v) => { const cc = [...conds]; cc[ci] = { ...c, chance: v }; setPool({ ...pool, conditions: cc }, `lc:${pi}:${ci}`); }} /></label>}
                    {'looting_multiplier' in c && <label class="mini"><span>+/level</span><NumInput min={0} value={c.looting_multiplier} onChange={(v) => { const cc = [...conds]; cc[ci] = { ...c, looting_multiplier: v }; setPool({ ...pool, conditions: cc }, `lc:${pi}:${ci}`); }} /></label>}
                    <Btn small kind="ghost" icon="x" aria-label="Remove condition" onClick={() => setPool({ ...pool, conditions: conds.filter((_, j) => j !== ci) })} />
                  </div>
                );
              })}
              <Select value="" options={[['', '+ Only drop if…'], ...LOOT_CONDS.filter(([k]) => !conds.some((c) => c.condition === k)).map(([k, l2]) => [k, l2])]} onChange={(k) => { if (!k) return; const m = LOOT_CONDS.find((x) => x[0] === k); setPool({ ...pool, conditions: [...conds, { condition: k, ...clone(m[2]) }] }); }} />
            </div>
            {(pool.entries || []).map((en, ei) => <LootEntry en={en} set={(ne) => { const es = [...pool.entries]; es[ei] = ne; setPool({ ...pool, entries: es }, `le:${pi}:${ei}`); }} onRemove={() => setPool({ ...pool, entries: pool.entries.filter((_, j) => j !== ei) })} />)}
            <Btn small icon="plus" onClick={() => setPool({ ...pool, entries: [...(pool.entries || []), { type: 'item', name: '', weight: 1 }] })}>Add entry</Btn>
          </Card>
        );
      })}
      {l.enabled && <Btn icon="plus" onClick={() => upd((x) => { x.pools.push({ rolls: 1, entries: [{ type: 'item', name: '', weight: 1 }] }); })}>Add pool</Btn>}

      <Card title="Gear" sub="Items it spawns holding or wearing (needs a model with a held-item anchor to show held items)">
        <Toggle label="Spawn with gear" value={g.enabled} onChange={(v) => updG((x) => { x.enabled = v; })} />
        {g.enabled && <>
          {[['mainhand', 'Main hand'], ['offhand', 'Off hand'], ['head', 'Helmet'], ['chest', 'Chestplate'], ['legs', 'Leggings'], ['feet', 'Boots']].map(([k, l2]) => (
            <Row label={l2}><TextInput value={g[k]} list="dl-items" mono placeholder="none" onChange={(v) => updG((x) => { x[k] = v; }, `gear:${k}`)} /></Row>
          ))}
          <Row label="Drop chance" hint="0–1 per item on death"><NumInput min={0} max={1} value={g.dropChance} onChange={(v) => updG((x) => { x.dropChance = v; }, 'gear:dc')} /></Row>
        </>}
      </Card>
    </div>
  );
}

// ---------------- Trades ----------------
function TradeItems({ items, set, label: lbl }) {
  return (
    <div class="titems">
      <span class="hint">{lbl}</span>
      {items.map((it, i) => {
        const q = it.quantity;
        return (
          <div class="titem">
            <TextInput value={it.item} list="dl-items" mono placeholder="minecraft:emerald" onChange={(v) => { const c = [...items]; c[i] = { ...it, item: v }; set(c); }} />
            {isObj(q) ? (
              <>
                <label class="mini"><span>min</span><NumInput int min={1} value={q.min} onChange={(v) => { const c = [...items]; c[i] = { ...it, quantity: { ...q, min: v } }; set(c); }} /></label>
                <label class="mini"><span>max</span><NumInput int min={1} value={q.max} onChange={(v) => { const c = [...items]; c[i] = { ...it, quantity: { ...q, max: v } }; set(c); }} /></label>
              </>
            ) : (
              <label class="mini"><span>×</span><NumInput int min={1} value={q ?? 1} onChange={(v) => { const c = [...items]; c[i] = { ...it, quantity: v }; set(c); }} /></label>
            )}
            {items.length > 1 && <Btn small kind="ghost" icon="x" aria-label="Remove item" onClick={() => set(items.filter((_, j) => j !== i))} />}
          </div>
        );
      })}
      {items.length < 2 && <Btn small kind="ghost" icon="plus" onClick={() => set([...items, { item: '', quantity: 1 }])}>second item</Btn>}
    </div>
  );
}

export function TradesTab({ e }) {
  const t = e.trades;
  const upd = (fn, key) => ecommit(e, (en) => fn(en.trades), key);
  const newTrade = () => ({ wants: [{ item: 'minecraft:emerald', quantity: 1 }], gives: [{ item: 'minecraft:apple', quantity: 4 }], trader_exp: 1, max_uses: 12, reward_exp: true });
  return (
    <div>
      <Card title="Trading" sub="Villager-style economy trades. Levels unlock as players trade (trader XP).">
        <Toggle label="Trades with players" value={t.enabled} onChange={(v) => upd((x) => { x.enabled = v; if (v && !x.tiers.length) x.tiers.push({ total_exp_required: 0, groups: [{ num_to_select: 2, trades: [newTrade()] }] }); })} />
      </Card>
      {t.enabled && t.tiers.map((tier, ti) => (
        <Card title={`Level ${ti + 1}`} sub={ti === 0 ? 'Available right away' : `Unlocks at ${tier.total_exp_required} trader XP`} right={<Btn small kind="ghost" icon="trash" aria-label="Delete level" onClick={() => upd((x) => { x.tiers.splice(ti, 1); })} />}>
          {ti > 0 && <Row label="XP needed"><NumInput int min={0} value={tier.total_exp_required} onChange={(v) => upd((x) => { x.tiers[ti].total_exp_required = v; }, `tr:${ti}`)} /></Row>}
          {tier.groups.map((g, gi) => (
            <div class="tgroup">
              <div class="inline"><span class="hint">Offer</span><NumInput int min={1} value={g.num_to_select} onChange={(v) => upd((x) => { x.tiers[ti].groups[gi].num_to_select = v; }, `tg:${ti}:${gi}`)} /><span class="hint">random trade(s) from:</span><span class="grow" />
                {tier.groups.length > 1 && <Btn small kind="ghost" icon="trash" aria-label="Delete group" onClick={() => upd((x) => { x.tiers[ti].groups.splice(gi, 1); })} />}</div>
              {g.trades.map((tr, ri) => {
                const setTr = (fn, key) => upd((x) => fn(x.tiers[ti].groups[gi].trades[ri]), key);
                return (
                  <div class="trade">
                    <TradeItems items={tr.wants} label="Player gives" set={(v) => setTr((x) => { x.wants = v; }, `tw:${ti}:${gi}:${ri}`)} />
                    <div class="arrow">→</div>
                    <TradeItems items={tr.gives} label="Mob gives" set={(v) => setTr((x) => { x.gives = v; }, `tv:${ti}:${gi}:${ri}`)} />
                    <div class="inline wrap">
                      <label class="mini"><span>uses</span><NumInput int min={1} value={tr.max_uses ?? 7} onChange={(v) => setTr((x) => { x.max_uses = v; }, `tu:${ti}:${gi}:${ri}`)} /></label>
                      <label class="mini"><span>trader XP</span><NumInput int min={0} value={tr.trader_exp ?? 1} onChange={(v) => setTr((x) => { x.trader_exp = v; }, `tx:${ti}:${gi}:${ri}`)} /></label>
                      <Toggle label="Player XP" value={tr.reward_exp !== false} onChange={(v) => setTr((x) => { x.reward_exp = v; })} />
                      <span class="grow" />
                      <Btn small kind="ghost" icon="trash" aria-label="Delete trade" onClick={() => upd((x) => { x.tiers[ti].groups[gi].trades.splice(ri, 1); })} />
                    </div>
                  </div>
                );
              })}
              <Btn small icon="plus" onClick={() => upd((x) => { x.tiers[ti].groups[gi].trades.push(newTrade()); })}>Add trade</Btn>
            </div>
          ))}
          <Btn small kind="ghost" icon="plus" onClick={() => upd((x) => { x.tiers[ti].groups.push({ num_to_select: 1, trades: [newTrade()] }); })}>Add trade group</Btn>
        </Card>
      ))}
      {t.enabled && <Btn icon="plus" onClick={() => upd((x) => { const last = x.tiers[x.tiers.length - 1]; x.tiers.push({ total_exp_required: last ? last.total_exp_required + 10 * x.tiers.length : 0, groups: [{ num_to_select: 2, trades: [newTrade()] }] }); })}>Add level</Btn>}
      {t.enabled && <p class="hint pad">On export Mobsmith adds minecraft:economy_trade_table pointing at this table, and minecraft:behavior.trade_with_player if it's missing.</p>}
    </div>
  );
}
