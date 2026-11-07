// Behavior (base components), component groups, events and properties.
import { useState } from 'preact/hooks';
import { Card, Btn, Collapse, TextInput, Select, NumInput, Toggle, Chips, Row, Empty, promptDialog, confirmDialog, Icon } from '../common.jsx';
import { ComponentList, FilterEditor, JsonEditor } from '../fields.jsx';
import { ecommit } from '../screens/entity.jsx';
import { newGroup, newEvent, newProperty } from '../../core/model.js';
import { BUILTIN_EVENTS } from '../../core/validate.js';
import { activityGroup } from '../../core/packgen.js';
import { clone, isObj, slug } from '../../core/util.js';
import { toast } from '../store.js';
import { TARGET_SUBJECTS } from '../meta.js';

function containerCommit(e, pick) {
  return (fn, key) => ecommit(e, (en) => fn(pick(en)), key);
}

function moveTargetsFor(e, from) {
  const targets = [];
  if (from !== 'base') targets.push({ label: 'Base components', pick: (en) => en.components });
  for (const g of e.groups) if (g.uid !== from) targets.push({ label: `Group ${g.name}`, pick: (en) => en.groups.find((x) => x.uid === g.uid)?.components });
  const pickFrom = from === 'base' ? (en) => en.components : (en) => en.groups.find((x) => x.uid === from)?.components;
  return targets.map((t) => ({
    label: t.label,
    move: (id, value) => ecommit(e, (en) => {
      const src = pickFrom(en), dst = t.pick(en);
      if (!src || !dst) return;
      dst[id] = clone(value);
      delete src[id];
      toast(`Moved to ${t.label}`);
    }),
  }));
}

export function ComponentsTab({ e }) {
  return (
    <div>
      <p class="hint pad">Base components are always active. Put state-dependent ones (baby, tamed, angry…) in Groups and switch them with Events.</p>
      <ComponentList get={() => e.components} commitFn={containerCommit(e, (en) => en.components)} moveTargets={moveTargetsFor(e, 'base')} keyPrefix={`b:${e.uid}`} />
    </div>
  );
}

function usedBy(e, gname) {
  const out = [];
  const walk = (a, ev) => {
    if (!isObj(a)) return;
    for (const k of ['add', 'remove']) if (a[k]?.component_groups?.includes(gname)) out.push(`${ev} (${k})`);
    for (const k of ['randomize', 'sequence']) (a[k] || []).forEach((x) => walk(x, ev));
  };
  for (const ev of e.events) walk(ev.action, ev.name);
  return out;
}

export function GroupsTab({ e, p }) {
  const addGroup = () => promptDialog('New component group', `${p.namespace}:`, (name) => {
    const n = name.includes(':') ? name : `${p.namespace}:${slug(name)}`;
    if (e.groups.some((g) => g.name === n)) { toast('That group already exists', 'error'); return; }
    ecommit(e, (en) => { en.groups.push(newGroup(n)); });
  }, { label: 'Group name', hint: 'Groups are sets of components that events add or remove, e.g. “baby”, “tamed”, “angry”.' });
  return (
    <div>
      <p class="hint pad">A component group switches a whole set of components on or off at once. Events add and remove groups.</p>
      {!e.groups.length && <Empty icon="🧩" title="No groups yet">Example: a “tamed” group with follow_owner and sittable, added by an on_tame event.</Empty>}
      {e.groups.map((g) => {
        const users = usedBy(e, g.name);
        return (
          <Collapse key={g.uid} title={g.name} badge={String(Object.keys(g.components).length)} sub={users.length ? `Used by: ${users.join(', ')}` : 'Not used by any event yet'}
            right={<Btn small kind="ghost" icon="trash" aria-label="Delete group" onClick={() => confirmDialog('Delete group?', `Delete ${g.name} and its components?`, 'Delete', () => ecommit(e, (en) => { en.groups = en.groups.filter((x) => x.uid !== g.uid); }))} />}>
            <Row label="Name"><TextInput value={g.name} mono onChange={(v) => ecommit(e, (en) => {
              const gg = en.groups.find((x) => x.uid === g.uid);
              const old = gg.name;
              gg.name = v;
              const ren = (a) => {
                if (!isObj(a)) return;
                for (const k of ['add', 'remove']) if (a[k]?.component_groups) a[k].component_groups = a[k].component_groups.map((x) => (x === old ? v : x));
                for (const k of ['randomize', 'sequence']) (a[k] || []).forEach(ren);
              };
              en.events.forEach((ev) => ren(ev.action));
            }, `g:${g.uid}:name`)} /></Row>
            <ComponentList get={() => g.components} commitFn={containerCommit(e, (en) => en.groups.find((x) => x.uid === g.uid).components)} moveTargets={moveTargetsFor(e, g.uid)} keyPrefix={`g:${g.uid}`} emptyText="Empty group. Add the components this state should have." />
            <div class="inline">
              <Btn small onClick={() => ecommit(e, (en) => { en.events.push(newEvent(`${g.name.split(':')[0]}:add_${g.name.split(':').pop()}`, { add: { component_groups: [g.name] } })); toast('Event created'); })}>+ event that adds it</Btn>
              <Btn small onClick={() => ecommit(e, (en) => { en.events.push(newEvent(`${g.name.split(':')[0]}:remove_${g.name.split(':').pop()}`, { remove: { component_groups: [g.name] } })); toast('Event created'); })}>+ event that removes it</Btn>
            </div>
          </Collapse>
        );
      })}
      <Btn icon="plus" kind="primary" onClick={addGroup}>Add group</Btn>
    </div>
  );
}

const ACTION_KEYS = [
  ['add', 'Add component groups'],
  ['remove', 'Remove component groups'],
  ['set_property', 'Set properties'],
  ['trigger', 'Trigger another event'],
  ['queue_command', 'Run commands'],
  ['randomize', 'Pick one at random'],
  ['sequence', 'Run steps in order (with conditions)'],
];

function GroupChips({ value, set, groups }) {
  const list = value?.component_groups || [];
  return (
    <div class="stack">
      <Chips values={list} list="dl-groups" onChange={(v) => set({ component_groups: v })} />
      <Select value="" options={[['', '+ pick group…'], ...groups.filter((g) => !list.includes(g)).map((g) => [g, g])]} onChange={(g) => g && set({ component_groups: [...list, g] })} />
    </div>
  );
}

export function ActionEditor({ value, set, ctx, depth = 0, allowFilters = false, allowWeight = false }) {
  const v = isObj(value) ? value : {};
  const upd = (k, nv) => { const c = { ...v }; if (nv === undefined) delete c[k]; else c[k] = nv; set(c); };
  const present = ACTION_KEYS.filter(([k]) => k in v);
  const missing = ACTION_KEYS.filter(([k]) => !(k in v) && !(depth >= 3 && (k === 'randomize' || k === 'sequence')));
  return (
    <div class={`action d${depth % 3}`}>
      {allowWeight && <Row label="Weight" hint="Chance relative to the others"><NumInput min={0} value={v.weight ?? 1} onChange={(w) => upd('weight', w)} /></Row>}
      {allowFilters && (
        <div class="act-row">
          <div class="act-h"><strong>Only if</strong>{v.filters && <Btn small kind="ghost" icon="x" onClick={() => upd('filters', undefined)} />}</div>
          <FilterEditor value={v.filters} set={(f) => upd('filters', f)} />
        </div>
      )}
      {present.map(([k, l]) => (
        <div class="act-row">
          <div class="act-h"><strong>{l}</strong><Btn small kind="ghost" icon="x" aria-label={`Remove ${l}`} onClick={() => upd(k, undefined)} /></div>
          {(k === 'add' || k === 'remove') && <GroupChips value={v[k]} set={(nv) => upd(k, nv)} groups={ctx.groups} />}
          {k === 'set_property' && (
            <div class="stack">
              {Object.entries(v.set_property || {}).map(([pn, pv]) => (
                <div class="map-row">
                  <code>{pn}</code>
                  <TextInput value={typeof pv === 'string' ? pv : JSON.stringify(pv)} mono onChange={(t) => {
                    let val = t;
                    if (t === 'true' || t === 'false') val = t === 'true';
                    else if (/^-?\d+(\.\d+)?$/.test(t.trim())) val = Number(t);
                    upd('set_property', { ...v.set_property, [pn]: val });
                  }} />
                  <Btn small kind="ghost" icon="trash" onClick={() => { const c = { ...v.set_property }; delete c[pn]; upd('set_property', c); }} />
                </div>
              ))}
              <Select value="" options={[['', '+ property…'], ...ctx.props.filter((pp) => !(pp.name in (v.set_property || {}))).map((pp) => [pp.name, `${pp.name} (${pp.type})`])]}
                onChange={(pn) => { if (!pn) return; const pp = ctx.props.find((x) => x.name === pn); upd('set_property', { ...(v.set_property || {}), [pn]: pp.type === 'enum' ? `'${pp.values?.[0] || ''}'` : pp.type === 'bool' ? true : 0 }); }} />
              <p class="hint">Values are Molang. Enum text needs quotes: 'angry'. You can also use expressions like query.property('{ctx.ns}:level') + 1.</p>
            </div>
          )}
          {k === 'trigger' && (() => {
            const t = typeof v.trigger === 'string' ? { event: v.trigger } : v.trigger || {};
            return (
              <div class="inline">
                <TextInput value={t.event} mono list="dl-events" onChange={(ev) => upd('trigger', t.target && t.target !== 'self' ? { event: ev, target: t.target } : ev)} />
                <Select value={t.target || 'self'} options={TARGET_SUBJECTS} onChange={(tg) => upd('trigger', tg === 'self' ? t.event || '' : { event: t.event || '', target: tg })} />
              </div>
            );
          })()}
          {k === 'queue_command' && (() => {
            const q = v.queue_command || {};
            const cmds = Array.isArray(q.command) ? q.command : q.command ? [q.command] : [];
            return (
              <div class="stack">
                <textarea class="mono" rows={Math.max(2, cmds.length + 1)} value={cmds.join('\n')} placeholder="say Hello!&#10;effect @s speed 10" onInput={(ev) => upd('queue_command', { ...q, command: ev.currentTarget.value.split('\n').filter((x) => x.trim()) })} />
                <Row label="Run as"><Select value={q.target || 'self'} options={TARGET_SUBJECTS} onChange={(tg) => { const c = { ...q }; if (tg === 'self') delete c.target; else c.target = tg; upd('queue_command', c); }} /></Row>
              </div>
            );
          })()}
          {(k === 'randomize' || k === 'sequence') && (
            <div class="stack">
              {(v[k] || []).map((node, i) => (
                <div class="act-node">
                  <div class="act-h"><span class="hint">{k === 'sequence' ? `Step ${i + 1}` : `Option ${i + 1}`}</span><Btn small kind="ghost" icon="trash" onClick={() => upd(k, v[k].filter((_, j) => j !== i))} /></div>
                  <ActionEditor value={node} set={(nv) => { const c = [...v[k]]; c[i] = nv; upd(k, c); }} ctx={ctx} depth={depth + 1} allowFilters={k === 'sequence'} allowWeight={k === 'randomize'} />
                </div>
              ))}
              <Btn small icon="plus" onClick={() => upd(k, [...(v[k] || []), k === 'randomize' ? { weight: 1, add: { component_groups: [] } } : { add: { component_groups: [] } }])}>{k === 'sequence' ? 'Add step' : 'Add option'}</Btn>
            </div>
          )}
        </div>
      ))}
      {missing.length > 0 && (
        <Select value="" options={[['', present.length ? '+ Add another response…' : '+ What should this event do?'], ...missing.map(([k, l]) => [k, l])]} onChange={(k) => {
          if (!k) return;
          const init = { add: { component_groups: [] }, remove: { component_groups: [] }, set_property: {}, trigger: '', queue_command: { command: ['say Hello from ' + ctx.name] }, randomize: [{ weight: 1, add: { component_groups: [] } }], sequence: [{ add: { component_groups: [] } }] }[k];
          upd(k, init);
        }} />
      )}
    </div>
  );
}

export function EventsTab({ e, p }) {
  const groups = [...e.groups.map((g) => g.name), ...(e.schedule?.enabled ? e.schedule.activities.map((a) => activityGroup(p, a.name)) : [])];
  const ctx = { groups, props: e.properties, ns: p.namespace, name: e.displayName };
  const add = (name, action = {}) => {
    if (e.events.some((x) => x.name === name)) { toast('That event already exists', 'error'); return; }
    ecommit(e, (en) => { en.events.push(newEvent(name, action)); });
  };
  const builtinsLeft = BUILTIN_EVENTS.filter((b) => !e.events.some((x) => x.name === b));
  return (
    <div>
      <p class="hint pad">Events change the entity: add/remove groups, set properties, run commands, pick randomly or run steps. Components (timers, sensors, taming…) fire them.</p>
      {e.schedule?.enabled && e.schedule.activities.length > 0 && (
        <div class="banner info-b"><span>🕒 The daily schedule adds {e.schedule.activities.map((a) => `${p.namespace}:schedule_${a.name}`).join(', ')} on export (one per activity). You can trigger them from your own events too.</span></div>
      )}
      {!e.events.length && <Empty icon="⚡" title="No events yet">Start with minecraft:entity_spawned to set things up when the mob appears.</Empty>}
      {e.events.map((ev) => (
        <Collapse key={ev.uid} title={ev.name} sub={summarize(ev.action)}
          right={<>
            <Btn small kind="ghost" icon="copy" aria-label="Duplicate event" onClick={() => ecommit(e, (en) => { const c = newEvent(ev.name + '_copy', clone(ev.action)); en.events.push(c); })} />
            <Btn small kind="ghost" icon="trash" aria-label="Delete event" onClick={() => ecommit(e, (en) => { en.events = en.events.filter((x) => x.uid !== ev.uid); })} />
          </>}>
          <Row label="Event name" hint={BUILTIN_EVENTS.includes(ev.name) ? 'Built-in: the game fires this one' : 'Fire it from components, commands (/event) or other events'}>
            <TextInput value={ev.name} mono onChange={(v) => ecommit(e, (en) => { en.events.find((x) => x.uid === ev.uid).name = v; }, `ev:${ev.uid}:n`)} />
          </Row>
          <ActionEditor value={ev.action} ctx={ctx} set={(nv) => ecommit(e, (en) => { en.events.find((x) => x.uid === ev.uid).action = nv; }, `ev:${ev.uid}`)} />
          <details class="more-exp"><summary>JSON</summary><JsonEditor value={ev.action} set={(nv) => ecommit(e, (en) => { en.events.find((x) => x.uid === ev.uid).action = nv; })} small /></details>
        </Collapse>
      ))}
      <div class="inline wrap">
        <Btn icon="plus" kind="primary" onClick={() => promptDialog('New event', `${p.namespace}:`, (n) => add(n.includes(':') ? n : `${p.namespace}:${slug(n)}`), { label: 'Event name' })}>Add event</Btn>
        {builtinsLeft.map((b) => <Btn small onClick={() => add(b)}>+ {b.replace('minecraft:', '')}</Btn>)}
      </div>
    </div>
  );
}

function summarize(a) {
  if (!isObj(a)) return '';
  const parts = [];
  if (a.add?.component_groups?.length) parts.push(`+${a.add.component_groups.join(', +')}`);
  if (a.remove?.component_groups?.length) parts.push(`−${a.remove.component_groups.join(', −')}`);
  if (a.set_property) parts.push(`set ${Object.keys(a.set_property).join(', ')}`);
  if (a.trigger) parts.push(`→ ${typeof a.trigger === 'string' ? a.trigger : a.trigger.event}`);
  if (a.queue_command) parts.push('commands');
  if (a.randomize) parts.push(`random ×${a.randomize.length}`);
  if (a.sequence) parts.push(`${a.sequence.length} steps`);
  return parts.join(' · ').slice(0, 120) || 'does nothing yet';
}

export function PropertiesTab({ e, p }) {
  const upd = (pr, fn, key) => ecommit(e, (en) => fn(en.properties.find((x) => x.uid === pr.uid)), key);
  return (
    <div>
      <p class="hint pad">Properties are saved values (numbers, flags, choices) that events change and that filters, animations and Molang can read: query.property('{p.namespace}:name').</p>
      {!e.properties.length && <Empty icon="🔢" title="No properties">E.g. a “mood” choice (calm/angry) or a “level” number for upgrades.</Empty>}
      {e.properties.map((pr) => (
        <Card title={pr.name} right={<Btn small kind="ghost" icon="trash" aria-label="Delete property" onClick={() => ecommit(e, (en) => { en.properties = en.properties.filter((x) => x.uid !== pr.uid); })} />}>
          <Row label="Name"><TextInput value={pr.name} mono onChange={(v) => upd(pr, (x) => { x.name = v; }, `pr:${pr.uid}:n`)} /></Row>
          <Row label="Type"><Select value={pr.type} options={[['bool', 'Yes/no (bool)'], ['int', 'Whole number (int)'], ['float', 'Decimal (float)'], ['enum', 'Choice (enum)']]} onChange={(t) => upd(pr, (x) => { x.type = t; x.def = t === 'bool' ? false : t === 'enum' ? x.values?.[0] || 'a' : 0; })} /></Row>
          {pr.type === 'enum' && <Row label="Values" wide><Chips values={pr.values} onChange={(v) => upd(pr, (x) => { x.values = v.map((s) => slug(s, { fallback: 'v' })); })} /></Row>}
          {(pr.type === 'int' || pr.type === 'float') && (
            <Row label="Range"><div class="vec">
              <label><span>min</span><NumInput int={pr.type === 'int'} value={pr.range[0]} onChange={(v) => upd(pr, (x) => { x.range[0] = v; }, `pr:${pr.uid}:r`)} /></label>
              <label><span>max</span><NumInput int={pr.type === 'int'} value={pr.range[1]} onChange={(v) => upd(pr, (x) => { x.range[1] = v; }, `pr:${pr.uid}:r`)} /></label>
            </div></Row>
          )}
          <Row label="Default">
            {pr.type === 'bool' ? <Toggle value={pr.def === true || pr.def === 'true'} onChange={(v) => upd(pr, (x) => { x.def = v; })} />
              : pr.type === 'enum' ? <Select value={pr.def} options={pr.values} onChange={(v) => upd(pr, (x) => { x.def = v; })} />
                : <NumInput int={pr.type === 'int'} value={typeof pr.def === 'number' ? pr.def : 0} onChange={(v) => upd(pr, (x) => { x.def = v; }, `pr:${pr.uid}:d`)} />}
          </Row>
          <Toggle label="Sync to client" hint="Needed if animations or the render controller read it" value={pr.clientSync} onChange={(v) => upd(pr, (x) => { x.clientSync = v; })} />
        </Card>
      ))}
      <Btn icon="plus" kind="primary" onClick={() => promptDialog('New property', `${p.namespace}:`, (n) => {
        const name = n.includes(':') ? n : `${p.namespace}:${slug(n)}`;
        ecommit(e, (en) => { en.properties.push(newProperty(name, 'int')); });
      }, { label: 'Property name' })}>Add property</Btn>
    </div>
  );
}
