// Village dweller settings: role, village AI, daily schedule and trading.
import { useState } from 'preact/hooks';
import { Card, Btn, Toggle, Row, TextInput, Select, Collapse, Icon, Empty } from '../common.jsx';
import { ObjFields, ComponentList } from '../fields.jsx';
import { ecommit } from '../screens/entity.jsx';
import { catalog, DESC, label, starterFor } from '../meta.js';
import { activityGroup, activityEvent } from '../../core/packgen.js';
import { clone, slug, uid, ticksToClock, clockToTicks } from '../../core/util.js';
import { setTab, toast } from '../store.js';
import { HorrorPanel } from './horror.jsx';

export const ROLES = [
  ['', 'Not a dweller', 'Ignores villages.', '🚫'],
  ['inhabitant', 'Inhabitant', 'Lives in the village like a villager: counts toward the population, claims beds and workstations, migrates between villages.', '🏠'],
  ['defender', 'Defender', 'Protects the village like an iron golem: patrols and attacks anything that threatens it.', '🛡'],
  ['passive', 'Village pet', 'Hangs around villages like a cat, without being a citizen.', '🐈'],
  ['hostile', 'Raider', 'Belongs to raids like a pillager and heads into villages to attack.', '🏴'],
];

const ROLE_DWELLER = {
  inhabitant: { dwelling_type: 'village', dweller_role: 'inhabitant', update_interval_base: 60, update_interval_variant: 40, can_find_poi: true, can_migrate: true, first_founding_reward: 0 },
  defender: { dwelling_type: 'village', dweller_role: 'defender', update_interval_base: 60, update_interval_variant: 40, can_find_poi: false, can_migrate: true, first_founding_reward: 0 },
  passive: { dwelling_type: 'village', dweller_role: 'passive', update_interval_base: 60, update_interval_variant: 40, can_find_poi: false, can_migrate: true, first_founding_reward: 0 },
  hostile: { dwelling_type: 'village', dweller_role: 'hostile', update_interval_base: 60, update_interval_variant: 40, can_find_poi: false, can_migrate: true, first_founding_reward: 0 },
};

const isFam = (value) => ({ test: 'is_family', subject: 'other', value });
const ROLE_KIT = {
  inhabitant: {
    families: ['villager'],
    nav: { can_open_doors: true, can_pass_doors: true, avoid_water: true },
    add: {
      'minecraft:annotation.open_door': {},
      'minecraft:behavior.move_towards_dwelling_restriction': { speed_multiplier: 0.6 },
      'minecraft:behavior.panic': { speed_multiplier: 0.6 },
      'minecraft:behavior.avoid_mob_type': { entity_types: [{ filters: { any_of: [isFam('zombie'), isFam('illager')] }, max_dist: 8, walk_speed_multiplier: 0.6, sprint_speed_multiplier: 0.6 }] },
    },
  },
  defender: {
    families: [],
    nav: { can_pass_doors: false },
    add: {
      'minecraft:behavior.defend_village_target': { must_reach: true, entity_types: [{ filters: { any_of: [isFam('mob'), isFam('player')] } }] },
      'minecraft:behavior.nearest_attackable_target': { within_radius: 20, reselect_targets: true, entity_types: [{ filters: { all_of: [isFam('monster'), { test: 'is_family', subject: 'other', operator: '!=', value: 'creeper' }] }, max_dist: 16 }] },
      'minecraft:behavior.melee_box_attack': {},
      'minecraft:attack': { damage: 8 },
      'minecraft:behavior.move_through_village': { speed_multiplier: 0.6, only_at_night: true },
      'minecraft:behavior.move_towards_dwelling_restriction': { speed_multiplier: 1 },
      'minecraft:persistent': {},
    },
  },
  passive: {
    families: [],
    add: { 'minecraft:behavior.move_towards_dwelling_restriction': { speed_multiplier: 0.8 } },
  },
  hostile: {
    families: ['illager', 'monster'],
    add: { 'minecraft:behavior.move_to_village': { speed_multiplier: 1, goal_radius: 2 }, 'minecraft:can_join_raid': {} },
  },
};

const LIFE = [
  ['Staying in the village', [
    'minecraft:behavior.move_towards_dwelling_restriction', 'minecraft:behavior.stroll_towards_village', 'minecraft:behavior.move_through_village',
    'minecraft:behavior.move_to_village', 'minecraft:behavior.explore_outskirts', 'minecraft:home', 'minecraft:behavior.go_home',
  ]],
  ['Doors & paths', ['minecraft:annotation.open_door', 'minecraft:behavior.open_door', 'minecraft:behavior.restrict_open_door', 'minecraft:preferred_path']],
  ['Social life', ['minecraft:behavior.mingle', 'minecraft:behavior.share_items', 'minecraft:behavior.pickup_items', 'minecraft:behavior.look_at_player', 'minecraft:behavior.offer_flower']],
  ['Trading', ['minecraft:behavior.trade_with_player', 'minecraft:behavior.look_at_trading_player', 'minecraft:behavior.trade_interest', 'minecraft:trade_resupply']],
  ['Defense & raids', ['minecraft:behavior.defend_village_target', 'minecraft:behavior.hide', 'minecraft:can_join_raid', 'minecraft:insomnia']],
];

const ACT_COLORS = ['#38bdf8', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#facc15', '#60a5fa', '#fb7185'];
const ACT_QUICK = [
  ['minecraft:behavior.random_stroll', 'Wander'], ['minecraft:behavior.sleep', 'Sleep in bed'], ['minecraft:behavior.mingle', 'Mingle'],
  ['minecraft:behavior.work', 'Work at job site'], ['minecraft:behavior.harvest_farm_block', 'Farm crops'], ['minecraft:behavior.explore_outskirts', 'Explore outskirts'],
  ['minecraft:behavior.move_through_village', 'Patrol'], ['minecraft:behavior.look_at_player', 'Watch players'], ['minecraft:behavior.go_home', 'Go home'],
];

function LifeToggle({ e, id }) {
  const has = !!e.components[id];
  const inGroups = e.groups.filter((g) => g.components[id]).map((g) => g.name);
  const inActs = e.schedule?.enabled ? e.schedule.activities.filter((a) => a.components[id]).map((a) => a.name) : [];
  const spec = catalog.components[id];
  const [open, setOpen] = useState(false);
  if (!spec) return null;
  const settable = spec.f.filter((f) => f.k !== 'priority').length > 0;
  return (
    <div class={`life ${has ? 'on' : ''}`}>
      <Toggle label={label(id)} hint={DESC[id] || id} value={has} onChange={(v) => ecommit(e, (en) => {
        if (v) en.components[id] = starterFor(id, en.components); else delete en.components[id];
      })} />
      {(inGroups.length > 0 || inActs.length > 0) && <div class="hint life-where">Also in {[...inGroups.map((g) => `group ${g}`), ...inActs.map((a) => `activity “${a}”`)].join(', ')}</div>}
      {has && settable && (
        <div class="life-set">
          <button type="button" class="link" onClick={() => setOpen(!open)}>{open ? 'Hide settings' : 'Settings…'}</button>
          {open && <ObjFields fields={spec.f} value={e.components[id]} set={(nv) => ecommit(e, (en) => { en.components[id] = nv; }, `dw:${id}`)} />}
        </div>
      )}
    </div>
  );
}

function Timeline({ schedule }) {
  const acts = schedule.activities.map((a) => a.name);
  const segs = [];
  for (const s of schedule.slots) {
    const color = ACT_COLORS[acts.indexOf(s.activity) % ACT_COLORS.length] || '#64748b';
    if (s.from <= s.to) segs.push([s.from, s.to, color, s.activity]);
    else { segs.push([s.from, 24000, color, s.activity]); segs.push([0, s.to, color, s.activity]); }
  }
  return (
    <div class="timeline" aria-label="Daily schedule timeline">
      <div class="tl-bar">
        <div class="tl-night" style={{ left: `${(12500 / 24000) * 100}%`, width: `${((23500 - 12500) / 24000) * 100}%` }} title="Night" />
        {segs.map(([a, b, c, n]) => <div class="tl-seg" style={{ left: `${(a / 24000) * 100}%`, width: `${((b - a) / 24000) * 100}%`, background: c }} title={`${n}: ${ticksToClock(a)}–${ticksToClock(b)}`} />)}
      </div>
      <div class="tl-labels"><span>6:00</span><span>12:00</span><span>18:00</span><span>0:00</span><span>6:00</span></div>
    </div>
  );
}

const SCHEDULE_PRESETS = {
  villager: { label: 'Villager day', acts: { wander: { 'minecraft:behavior.random_stroll': { priority: 8, speed_multiplier: 0.6 } }, gather: { 'minecraft:behavior.mingle': { priority: 7, speed_multiplier: 0.5, duration: 30, cooldown_time: 10, mingle_distance: 2 } }, sleep: { 'minecraft:behavior.sleep': { priority: 3, sleep_collider_height: 0.3, sleep_collider_width: 1, sleep_y_offset: 0.6, speed_multiplier: 0.6, timeout_cooldown: 10 } } }, slots: [[0, 8000, 'wander'], [8000, 10000, 'gather'], [10000, 12000, 'wander'], [12000, 24000, 'sleep']] },
  guard: { label: 'Night watch', acts: { rest: { 'minecraft:behavior.random_stroll': { priority: 8, speed_multiplier: 0.4, xz_dist: 6 } }, patrol: { 'minecraft:behavior.move_through_village': { priority: 4, speed_multiplier: 0.7, only_at_night: false } } }, slots: [[0, 12000, 'rest'], [12000, 24000, 'patrol']] },
  worker: { label: 'Work & rest', acts: { work: { 'minecraft:behavior.work': { priority: 7, active_time: 250, speed_multiplier: 0.5, goal_cooldown: 200 } }, wander: { 'minecraft:behavior.random_stroll': { priority: 8, speed_multiplier: 0.6 } }, sleep: { 'minecraft:behavior.sleep': { priority: 3, sleep_collider_height: 0.3, sleep_collider_width: 1, sleep_y_offset: 0.6, speed_multiplier: 0.6, timeout_cooldown: 10 } } }, slots: [[0, 2000, 'wander'], [2000, 9000, 'work'], [9000, 12000, 'wander'], [12000, 24000, 'sleep']] },
};

function ScheduleCard({ e, p }) {
  const s = e.schedule || { enabled: false, activities: [], slots: [] };
  const upd = (fn, key) => ecommit(e, (en) => { en.schedule ||= { enabled: false, activities: [], slots: [] }; fn(en.schedule); }, key);
  const acts = s.activities.map((a) => a.name);
  return (
    <Card title="Daily schedule" icon="🕒" sub="Different behaviour at different times of day, like villagers">
      <Toggle label="Use a daily schedule" value={s.enabled} onChange={(v) => upd((sc) => { sc.enabled = v; if (v && !sc.activities.length) applySchedulePreset(sc, 'villager'); })} />
      {s.enabled && (
        <>
          <Timeline schedule={s} />
          <div class="inline wrap">
            <span class="hint">Presets:</span>
            {Object.entries(SCHEDULE_PRESETS).map(([k, pr]) => <Btn small onClick={() => upd((sc) => applySchedulePreset(sc, k))}>{pr.label}</Btn>)}
          </div>
          <h4>Time slots</h4>
          {!s.slots.length && <p class="hint">No slots yet.</p>}
          {s.slots.map((sl, i) => (
            <div class="slot">
              <span class="dot" style={{ background: ACT_COLORS[acts.indexOf(sl.activity) % ACT_COLORS.length] }} />
              <input type="time" class="txt time" value={ticksToClock(sl.from)} aria-label="From" onChange={(ev) => upd((sc) => { sc.slots[i].from = clockToTicks(ev.currentTarget.value); })} />
              <span class="hint">to</span>
              <input type="time" class="txt time" value={ticksToClock(sl.to === 24000 ? 24000 : sl.to)} aria-label="To" onChange={(ev) => { let t = clockToTicks(ev.currentTarget.value); if (t === 0) t = 24000; upd((sc) => { sc.slots[i].to = t; }); }} />
              <Select value={sl.activity} options={acts} onChange={(v) => upd((sc) => { sc.slots[i].activity = v; })} />
              <Btn small kind="ghost" icon="trash" aria-label="Remove slot" onClick={() => upd((sc) => { sc.slots.splice(i, 1); })} />
            </div>
          ))}
          <Btn small icon="plus" onClick={() => upd((sc) => { const last = sc.slots[sc.slots.length - 1]; sc.slots.push({ from: last ? last.to % 24000 : 0, to: 24000, activity: acts[0] || '' }); })}>Add slot</Btn>

          <h4>Activities</h4>
          <p class="hint">Each activity is a set of AI goals that is only active during its time slots.</p>
          {s.activities.map((a, ai) => (
            <Collapse key={a.uid} title={a.name} badge={String(Object.keys(a.components).length)} sub={`Group ${activityGroup(p, a.name)} · event ${activityEvent(p, a.name)}`}
              right={<Btn small kind="ghost" icon="trash" aria-label="Delete activity" onClick={() => upd((sc) => { sc.activities.splice(ai, 1); sc.slots = sc.slots.filter((x) => x.activity !== a.name); })} />}>
              <Row label="Name"><TextInput value={a.name} mono onChange={(v) => upd((sc) => { const old = sc.activities[ai].name; const nn = slug(v, { fallback: '' }); sc.activities[ai].name = nn; sc.slots.forEach((x) => { if (x.activity === old) x.activity = nn; }); }, `act:${a.uid}`)} /></Row>
              <div class="inline wrap">
                {ACT_QUICK.filter(([id]) => !a.components[id] && catalog.components[id]).map(([id, l]) => (
                  <Btn small onClick={() => upd((sc) => { const comps = sc.activities[ai].components; comps[id] = starterFor(id, comps); })}>+ {l}</Btn>
                ))}
              </div>
              <ComponentList get={() => a.components} commitFn={(fn, key) => ecommit(e, (en) => fn(en.schedule.activities.find((x) => x.uid === a.uid).components), key)} keyPrefix={`act:${a.uid}`} emptyText="No goals yet. Use the quick buttons above." />
            </Collapse>
          ))}
          <Btn small icon="plus" onClick={() => upd((sc) => { let n = 'activity', i = 2; while (sc.activities.some((x) => x.name === n)) n = `activity_${i++}`; sc.activities.push({ uid: uid(), name: n, components: {} }); })}>Add activity</Btn>
          <p class="hint">On export, Mobsmith writes a minecraft:scheduler that checks the time (hourly_clock_time) and fires {p.namespace}:schedule_&lt;activity&gt;, which swaps the activity groups.</p>
        </>
      )}
    </Card>
  );
}

function applySchedulePreset(sc, key) {
  const pr = SCHEDULE_PRESETS[key];
  sc.activities = Object.entries(pr.acts).map(([name, comps]) => ({ uid: uid(), name, components: clone(comps) }));
  sc.slots = pr.slots.map(([from, to, activity]) => ({ from, to, activity }));
}

export function DwellerTab({ e, p }) {
  const mode = e.dwellerMode === 'horror' ? 'horror' : 'village';
  return (
    <div class="tab-dweller">
      <div class="seg" role="tablist" aria-label="Dweller type">
        <button type="button" role="tab" aria-selected={mode === 'village'} class={mode === 'village' ? 'on' : ''} onClick={() => ecommit(e, (en) => { en.dwellerMode = 'village'; })}>🏘 Village dweller</button>
        <button type="button" role="tab" aria-selected={mode === 'horror'} class={`horror ${mode === 'horror' ? 'on' : ''}`} onClick={() => ecommit(e, (en) => { en.dwellerMode = 'horror'; })}>👁 Horror dweller{e.horror?.enabled ? ' ●' : ''}</button>
      </div>
      {mode === 'horror' ? <HorrorPanel e={e} p={p} /> : <VillagePanel e={e} p={p} />}
    </div>
  );
}

function VillagePanel({ e, p }) {
  const d = e.components['minecraft:dweller'];
  const role = d?.dweller_role || '';
  const kit = ROLE_KIT[role];
  const tradeCount = (e.trades?.tiers || []).reduce((a, t) => a + (t.groups || []).reduce((b, g) => b + (g.trades || []).length, 0), 0);
  const setRole = (r) => ecommit(e, (en) => {
    if (!r) { delete en.components['minecraft:dweller']; return; }
    en.components['minecraft:dweller'] = { ...clone(ROLE_DWELLER[r]), ...(en.components['minecraft:dweller'] ? { preferred_profession: en.components['minecraft:dweller'].preferred_profession } : {}) };
    if (!en.components['minecraft:dweller'].preferred_profession) delete en.components['minecraft:dweller'].preferred_profession;
  });
  const applyKit = () => {
    const added = [];
    ecommit(e, (en) => {
      const c = en.components;
      for (const [id, v] of Object.entries(kit.add)) {
        if (id === 'minecraft:behavior.nearest_attackable_target' && Object.keys(c).some((k) => /nearest.*attackable_target/.test(k))) continue;
        if (id === 'minecraft:behavior.melee_box_attack' && Object.keys(c).some((k) => /melee/.test(k))) continue;
        if (!c[id]) { c[id] = id.includes('behavior.') ? { ...starterFor(id, c), ...clone(v) } : clone(v); added.push(label(id)); }
      }
      if (kit.nav) {
        const navId = Object.keys(c).find((k) => k.startsWith('minecraft:navigation.')) || 'minecraft:navigation.walk';
        c[navId] = { ...(c[navId] || {}), ...kit.nav };
        added.push('door/path navigation flags');
      }
      const fam = (c['minecraft:type_family'] ||= { family: [en.name, 'mob'] }).family;
      for (const f of kit.families) if (!fam.includes(f)) { fam.push(f); added.push(`family “${f}”`); }
    });
    toast(added.length ? `Added: ${added.join(', ')}` : 'Everything for this role is already there', 'ok', 5000);
  };
  return (
    <div class="tab-village">
      <Card title="Village dweller settings" icon="🏘" sub="How this mob relates to villages">
        <div class="roles">
          {ROLES.map(([k, l, desc, ic]) => (
            <button type="button" class={`role ${role === k ? 'on' : ''}`} onClick={() => setRole(k)} aria-pressed={role === k}>
              <span class="role-i">{ic}</span><strong>{l}</strong><span class="hint">{desc}</span>
            </button>
          ))}
        </div>
        {role && kit && (
          <div class="kit">
            <div>
              <strong>Recommended setup for {ROLES.find((r) => r[0] === role)[1].toLowerCase()}s</strong>
              <div class="hint">Adds what's missing: {Object.keys(kit.add).map(label).join(', ')}{kit.nav ? ', navigation flags' : ''}{kit.families.length ? `, families ${kit.families.join('/')}` : ''}.</div>
            </div>
            <Btn kind="primary" icon="wand" onClick={applyKit}>Apply</Btn>
          </div>
        )}
      </Card>

      {d && (
        <Card title="Dweller component" sub="minecraft:dweller">
          <ObjFields fields={catalog.components['minecraft:dweller'].f} value={d} set={(nv) => ecommit(e, (en) => { en.components['minecraft:dweller'] = nv; }, 'dw:dweller')} />
          <p class="hint">Inhabitants with “can find POI” claim beds and job sites. “First founding reward” adds reputation when it helps found a village. The update interval is how often (ticks) it re-checks its village.</p>
        </Card>
      )}

      <ScheduleCard e={e} p={p} />

      <Card title="Trading" icon="💰" sub={e.trades?.enabled ? `${tradeCount} trade${tradeCount === 1 ? '' : 's'} in ${e.trades.tiers.length} level${e.trades.tiers.length === 1 ? '' : 's'}` : 'Off'}>
        <Toggle label="This mob trades with players" hint="Economy trades with levels, like villagers" value={e.trades?.enabled} onChange={(v) => ecommit(e, (en) => {
          en.trades ||= { enabled: false, tiers: [] };
          en.trades.enabled = v;
          if (v && !en.trades.tiers.length) en.trades.tiers.push({ total_exp_required: 0, groups: [{ num_to_select: 2, trades: [{ wants: [{ item: 'minecraft:emerald', quantity: 1 }], gives: [{ item: 'minecraft:bread', quantity: 4 }], trader_exp: 1, max_uses: 12, reward_exp: true }] }] });
          if (v && !en.components['minecraft:behavior.trade_with_player']) en.components['minecraft:behavior.trade_with_player'] = { priority: 2 };
        })} />
        {e.trades?.enabled && <Btn icon="edit" onClick={() => setTab('trades')}>Edit trades</Btn>}
      </Card>

      <Card title="Village life" sub="Toggle the village AI goals and components this mob uses">
        {LIFE.map(([title, ids]) => (
          <div class="life-group">
            <h4>{title}</h4>
            {ids.map((id) => <LifeToggle e={e} id={id} />)}
          </div>
        ))}
      </Card>
    </div>
  );
}
