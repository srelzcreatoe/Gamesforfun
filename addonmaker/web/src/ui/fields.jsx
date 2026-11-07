// Generic editors driven by the component catalog's field specs, plus the
// filter builder, trigger editor, raw-JSON editor and component cards.
import { useState, useEffect, useMemo } from 'preact/hooks';
import { Btn, Icon, Toggle, NumInput, TextInput, Select, Chips } from './common.jsx';
import { catalog, vanilla, DESC, CATEGORIES, label, docsUrl, starterFor, isBehavior, suggestList, fieldHelp, allComponents, TARGET_SUBJECTS, categoryOf } from './meta.js';
import { titleCase, clone, isObj, parseLenientJSON } from '../core/util.js';
import { state, openModal, closeModal, render, toast } from './store.js';
import { openUrl, copyText } from './native.js';

const resolveOpts = (o) => (o === '@causes' ? vanilla.causes : o === '@soundEvents' ? vanilla.soundEvents : o === '@effects' ? vanilla.effects : o || []);

export function defaultFor(spec) {
  if (!spec) return '';
  if (spec.d !== undefined) return clone(spec.d);
  switch (spec.t) {
    case 'b': return false;
    case 'i': case 'n': return spec.min > 0 ? spec.min : 0;
    case 'e': return resolveOpts(spec.o)[0] ?? '';
    case 's': case 'm': case 'item': case 'block': return '';
    case 'ar': case 'v2': return [0, 0];
    case 'v3': return [0, 0, 0];
    case 'fr': case 'ir': return { min: 0, max: 0 };
    case 'l': case 'ol': return [];
    case 'o': return Object.fromEntries((spec.f || []).filter((f) => f.req).map((f) => [f.k, defaultFor(f)]));
    case 'tr': return { event: '', target: 'self' };
    case 'f': return { test: 'is_family', subject: 'other', value: 'player' };
    case 'alt': return defaultFor(spec.a[0]);
    case 'map': return {};
    default: return {};
  }
}

function matches(spec, v) {
  switch (spec.t) {
    case 'b': return typeof v === 'boolean';
    case 'i': case 'n': return typeof v === 'number';
    case 's': case 'm': case 'e': case 'item': case 'block': return typeof v === 'string';
    case 'ar': case 'v2': case 'v3': case 'l': return Array.isArray(v) && v.every((x) => typeof x !== 'object');
    case 'ol': return Array.isArray(v) && v.every((x) => isObj(x));
    case 'fr': case 'ir': return isObj(v) && ('min' in v || 'max' in v);
    case 'o': case 'tr': case 'map': return isObj(v);
    case 'f': return isObj(v) || Array.isArray(v);
    default: return true;
  }
}

/** Renders the right widget for a value given its spec. */
export function ValueEditor({ spec, value, set, k, ctx }) {
  if (!spec) return <JsonEditor value={value} set={set} />;
  switch (spec.t) {
    case 'b':
      return <Toggle value={value} onChange={set} />;
    case 'i': case 'n':
      if (typeof value !== 'number' && value !== undefined) return <JsonEditor value={value} set={set} small />;
      return <NumInput value={value} onChange={set} int={spec.t === 'i'} min={spec.min > -1e6 ? spec.min : undefined} max={spec.max < 1e6 ? spec.max : undefined} />;
    case 'e': {
      const opts = resolveOpts(spec.o);
      if (typeof value !== 'string' && typeof value !== 'number' && value !== undefined) return <JsonEditor value={value} set={set} small />;
      return <Select value={value} onChange={set} options={opts} />;
    }
    case 'm':
      return <TextInput value={typeof value === 'number' ? String(value) : value} onChange={(v) => set(/^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v)} mono placeholder="Molang, e.g. query.is_baby ? 1 : 0" />;
    case 's': case 'item': case 'block':
      if (typeof value !== 'string' && value !== undefined) return <JsonEditor value={value} set={set} small />;
      return <TextInput value={value} onChange={set} list={suggestList(k, spec)} />;
    case 'ar': case 'v2': case 'v3': {
      const n = spec.t === 'v3' ? 3 : 2;
      if (typeof value === 'number') return <div class="inline"><NumInput value={value} onChange={set} /><Btn small kind="ghost" onClick={() => set([value, value].slice(0, n))}>⇄ range</Btn></div>;
      const arr = Array.isArray(value) ? value : isObj(value) ? [value.x ?? value.min ?? 0, value.y ?? value.max ?? 0, value.z ?? 0].slice(0, n) : Array(n).fill(0);
      const labels = n === 3 ? ['x', 'y', 'z'] : ['min', 'max'];
      return (
        <div class="vec">
          {Array.from({ length: n }, (_, i) => (
            <label><span>{labels[i]}</span><NumInput value={arr[i]} onChange={(x) => { const c = [...arr]; c[i] = x; set(c); }} /></label>
          ))}
        </div>
      );
    }
    case 'fr': case 'ir': {
      if (typeof value === 'number') return <div class="inline"><NumInput value={value} onChange={set} int={spec.t === 'ir'} /><Btn small kind="ghost" onClick={() => set({ min: value, max: value })}>⇄ range</Btn></div>;
      if (Array.isArray(value)) return <ValueEditor spec={{ t: 'ar' }} value={value} set={set} />;
      const v = isObj(value) ? value : { min: 0, max: 0 };
      return (
        <div class="vec">
          <label><span>min</span><NumInput value={v.min} int={spec.t === 'ir'} onChange={(x) => set({ ...v, min: x })} /></label>
          <label><span>max</span><NumInput value={v.max} int={spec.t === 'ir'} onChange={(x) => set({ ...v, max: x })} /></label>
        </div>
      );
    }
    case 'l': {
      const it = spec.it || { t: 's' };
      if (!Array.isArray(value)) {
        if (typeof value === 'string') return <div class="inline"><TextInput value={value} onChange={set} list={suggestList(k, it)} /><Btn small kind="ghost" onClick={() => set(value ? [value] : [])}>⇄ list</Btn></div>;
        return <JsonEditor value={value} set={set} small />;
      }
      if (it.t === 'e') {
        const opts = resolveOpts(it.o);
        return (
          <div class="stack">
            <Chips values={value} onChange={set} list={null} placeholder="" />
            <Select value="" options={[['', '+ add…'], ...opts.filter((o) => !value.includes(o)).map((o) => [o, o])]} onChange={(v) => v && set([...value, v])} />
          </div>
        );
      }
      if (['s', 'item', 'block', 'm'].includes(it.t)) return <Chips values={value.map(String)} onChange={set} list={suggestList(k, it)} />;
      return <JsonEditor value={value} set={set} small />;
    }
    case 'ol': {
      if (!Array.isArray(value)) {
        if (isObj(value)) return <div class="stack"><ObjFields fields={spec.f} value={value} set={set} ctx={ctx} /><Btn small kind="ghost" onClick={() => set([value])}>⇄ make it a list</Btn></div>;
        return <JsonEditor value={value} set={set} small />;
      }
      return <ObjList fields={spec.f} value={value} set={set} ctx={ctx} k={k} />;
    }
    case 'o':
      if (!isObj(value)) return <JsonEditor value={value} set={set} small />;
      return <ObjFields fields={spec.f} value={value} set={set} ctx={ctx} />;
    case 'map':
      return <MapEditor spec={spec.v} value={value} set={set} ctx={ctx} />;
    case 'tr':
      return <TriggerEditor value={value} set={set} />;
    case 'f':
      return <FilterEditor value={value} set={set} />;
    case 'alt': {
      const idx = Math.max(0, spec.a.findIndex((a) => matches(a, value)));
      const cur = spec.a[idx];
      const next = spec.a[(idx + 1) % spec.a.length];
      return (
        <div class="alt">
          <ValueEditor spec={cur} value={value} set={set} k={k} ctx={ctx} />
          <button type="button" class="alt-sw" title={`Switch to ${typeName(next)}`} onClick={() => set(defaultFor(next))}>⇄ {typeName(next)}</button>
        </div>
      );
    }
    default:
      return <JsonEditor value={value} set={set} small />;
  }
}
const typeName = (s) => ({ b: 'yes/no', i: 'number', n: 'number', s: 'text', e: 'choice', m: 'Molang', ar: 'range', v3: 'xyz', v2: 'pair', fr: 'range', ir: 'range', l: 'list', ol: 'list', o: 'object', tr: 'event', f: 'filter', item: 'item', block: 'block' }[s.t] || 'JSON');

const PREFILL = {
  breeds_with: ['mate_type', 'baby_type', 'breed_event'],
  triggers: ['filters', 'event', 'cause', 'deals_damage'],
  interactions: ['on_interact', 'interact_text', 'swing'],
  entity_types: ['filters', 'max_dist'],
  scheduled_events: ['filters', 'event'],
  subsensors: ['event', 'range', 'minimum_count', 'event_filters'],
  seats: ['position'],
  items: ['item', 'heal_amount'],
  damage_conditions: ['filters', 'cause', 'damage_per_tick'],
  add_effects: ['effect', 'duration', 'amplifier'],
  feed_items: ['item', 'temper_mod'],
};
function newListItem(fields, k) {
  const keys = PREFILL[k] || fields.slice(0, 2).map((f) => f.k);
  const o = {};
  for (const f of fields) if (keys.includes(f.k) || f.req) o[f.k] = defaultFor(f);
  return o;
}

function ObjList({ fields, value, set, ctx, k }) {
  return (
    <div class="olist">
      {value.map((item, i) => (
        <div class="olist-item">
          <div class="olist-h">
            <span class="hint">#{i + 1}</span>
            <span class="grow" />
            {i > 0 && <Btn small kind="ghost" icon="up" aria-label="Move up" onClick={() => { const c = [...value]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; set(c); }} />}
            <Btn small kind="ghost" icon="copy" aria-label="Duplicate" onClick={() => { const c = [...value]; c.splice(i + 1, 0, clone(item)); set(c); }} />
            <Btn small kind="ghost" icon="trash" aria-label="Remove" onClick={() => set(value.filter((_, j) => j !== i))} />
          </div>
          {isObj(item) ? <ObjFields fields={fields} value={item} set={(nv) => { const c = [...value]; c[i] = nv; set(c); }} ctx={ctx} /> : <JsonEditor value={item} set={(nv) => { const c = [...value]; c[i] = nv; set(c); }} small />}
        </div>
      ))}
      <Btn small icon="plus" onClick={() => set([...value, newListItem(fields || [], k)])}>Add entry</Btn>
    </div>
  );
}

function MapEditor({ spec, value, set, ctx }) {
  const v = isObj(value) ? value : {};
  const [nk, setNk] = useState('');
  return (
    <div class="stack">
      {Object.entries(v).map(([key, val]) => (
        <div class="map-row">
          <code>{key}</code>
          <ValueEditor spec={spec} value={val} set={(nv) => set({ ...v, [key]: nv })} ctx={ctx} k={key} />
          <Btn small kind="ghost" icon="trash" onClick={() => { const c = { ...v }; delete c[key]; set(c); }} />
        </div>
      ))}
      <div class="inline"><TextInput value={nk} onChange={setNk} placeholder="key" /><Btn small icon="plus" onClick={() => { if (nk) { set({ ...v, [nk]: defaultFor(spec) }); setNk(''); } }}>Add</Btn></div>
    </div>
  );
}

/** Object editor: shows the keys that are present, lets you add known ones. */
export function ObjFields({ fields = [], value, set, ctx, hideKeys = [] }) {
  const known = new Map(fields.map((f) => [f.k, f]));
  const present = Object.keys(value).filter((k) => !hideKeys.includes(k));
  const missing = fields.filter((f) => !(f.k in value) && !hideKeys.includes(f.k));
  const [custom, setCustom] = useState('');
  const order = [...fields.map((f) => f.k).filter((k) => present.includes(k)), ...present.filter((k) => !known.has(k))];
  return (
    <div class="fields">
      {order.map((k) => {
        const spec = known.get(k);
        const block = spec && ['o', 'ol', 'f', 'tr', 'map', 'j'].includes(spec.t) || (spec?.t === 'alt' && spec.a.some((a) => ['o', 'ol', 'f'].includes(a.t))) || !spec;
        return (
          <div class={`field-row ${block ? 'block' : ''}`}>
            <div class="field-l">
              <span class="field-name" title={k}>{titleCase(k)}</span>
              {!spec && <span class="tag">custom</span>}
              {fieldHelp(k) && <span class="hint">{fieldHelp(k)}</span>}
              <button type="button" class="field-x" aria-label={`Remove ${k}`} title="Remove setting (use game default)" onClick={() => { const c = { ...value }; delete c[k]; set(c); }}><Icon name="x" size={14} /></button>
            </div>
            <div class="field-v">
              <ValueEditor spec={spec} value={value[k]} set={(nv) => set({ ...value, [k]: nv })} k={k} ctx={ctx} />
            </div>
          </div>
        );
      })}
      {(missing.length > 0 || !fields.length) && (
        <div class="add-field">
          {missing.length > 0 && (
            <Select value="" options={[['', `+ Add setting (${missing.length} more)`], ...missing.map((f) => [f.k, `${titleCase(f.k)}${f.d !== undefined && typeof f.d !== 'object' ? `  (default ${f.d})` : ''}`])]}
              onChange={(k) => { if (!k) return; const f = known.get(k); set({ ...value, [k]: defaultFor(f) }); }} />
          )}
          {!fields.length && (
            <div class="inline">
              <TextInput value={custom} onChange={setCustom} placeholder="custom key" />
              <Btn small icon="plus" onClick={() => { if (custom) { set({ ...value, [custom]: '' }); setCustom(''); } }}>Add</Btn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function JsonEditor({ value, set, small, rows }) {
  const text = useMemo(() => JSON.stringify(value === undefined ? null : value, null, 2), [value]);
  const [draft, setDraft] = useState(text);
  const [err, setErr] = useState('');
  useEffect(() => { setDraft(text); setErr(''); }, [text]);
  return (
    <div class="json-ed">
      <textarea class="mono" rows={rows || (small ? Math.min(8, text.split('\n').length + 1) : 12)} value={draft} spellcheck={false} autocapitalize="off"
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          if (draft === text) return;
          try { const v = parseLenientJSON(draft); setErr(''); set(v); } catch (e) { setErr(e.message); }
        }} />
      {err && <div class="err">JSON error: {err}</div>}
    </div>
  );
}

// ---------------- Filters ----------------
const GROUP_KEYS = ['all_of', 'any_of', 'none_of'];
const GROUP_LABEL = { all_of: 'ALL of these', any_of: 'ANY of these', none_of: 'NONE of these' };
const OPS = [['==', 'is (==)'], ['!=', 'is not (!=)'], ['<', '<'], ['<=', '≤'], ['>', '>'], ['>=', '≥']];
const TEST_VALUE_LIST = {
  is_family: 'dl-families', has_component: 'dl-components', is_biome: 'dl-biomes', has_biome_tag: 'dl-biometags',
  has_mob_effect: 'dl-effects', has_equipment: 'dl-items', is_block: 'dl-blocks', in_block: 'dl-blocks', has_damage: 'dl-causes',
  is_vehicle_family: 'dl-families', is_controlling_passenger_family: 'dl-families', was_last_hurt_by: 'dl-entities',
};
const TESTS = Object.keys(catalog.filters).sort();

function newTest(name, prev = {}) {
  const ps = catalog.filters[name] || {};
  const o = { test: name };
  if (ps.subject && prev.subject && prev.subject !== 'self') o.subject = prev.subject;
  if (ps.domain && ps.domain.t !== 'e') o.domain = '';
  if (ps.value) {
    const vs = ps.value;
    o.value = vs.d !== undefined ? vs.d : vs.t === 'b' ? true : vs.t === 'i' || vs.t === 'n' ? 0 : vs.t === 'e' ? (vs.o || [])[0] : '';
  }
  return o;
}

export function FilterEditor({ value, set, compact }) {
  if (value === undefined || value === null || (isObj(value) && !Object.keys(value).length)) {
    return <Btn small icon="plus" onClick={() => set({ test: 'is_family', subject: 'other', value: 'player' })}>Add condition</Btn>;
  }
  return <div class="filter-root"><FilterNode value={value} set={set} depth={0} onRemove={() => set(undefined)} /></div>;
}

function FilterNode({ value, set, depth, onRemove }) {
  if (Array.isArray(value)) return <FilterNode value={{ all_of: value }} set={set} depth={depth} onRemove={onRemove} />;
  const gk = isObj(value) && GROUP_KEYS.find((k) => Array.isArray(value[k]));
  if (gk) {
    const kids = value[gk];
    const setKids = (nk) => set({ [gk]: nk });
    return (
      <div class={`fgroup d${depth % 3}`}>
        <div class="fgroup-h">
          <Select value={gk} options={GROUP_KEYS.map((k) => [k, GROUP_LABEL[k]])} onChange={(nk) => set({ [nk]: kids })} />
          <span class="grow" />
          {kids.length === 1 && <Btn small kind="ghost" onClick={() => set(kids[0])} title="Unwrap">unwrap</Btn>}
          <Btn small kind="ghost" icon="trash" aria-label="Remove group" onClick={onRemove} />
        </div>
        {kids.map((c, i) => (
          <FilterNode value={c} depth={depth + 1} set={(nv) => { const k2 = [...kids]; k2[i] = nv; setKids(k2); }} onRemove={() => setKids(kids.filter((_, j) => j !== i))} />
        ))}
        <div class="inline">
          <Btn small icon="plus" onClick={() => setKids([...kids, { test: 'is_daytime', value: true }])}>Test</Btn>
          {depth < 4 && <Btn small icon="plus" onClick={() => setKids([...kids, { any_of: [{ test: 'is_family', subject: 'other', value: 'player' }] }])}>Group</Btn>}
        </div>
      </div>
    );
  }
  if (!isObj(value) || typeof value.test !== 'string') {
    return <div class="ftest"><JsonEditor value={value} set={set} small /><Btn small kind="ghost" icon="trash" onClick={onRemove} /></div>;
  }
  return <FilterTest value={value} set={set} onRemove={onRemove} canWrap={depth === 0} />;
}

function FilterTest({ value, set, onRemove, canWrap }) {
  const ps = catalog.filters[value.test] || {};
  const known = !!catalog.filters[value.test];
  const vs = ps.value;
  const upd = (k, v) => {
    const c = { ...value };
    if (v === undefined || v === '' && k !== 'value') delete c[k]; else c[k] = v;
    set(c);
  };
  let valueEd = null;
  if (vs || 'value' in value) {
    const t = vs?.t || (typeof value.value === 'boolean' ? 'b' : typeof value.value === 'number' ? 'n' : 's');
    if (t === 'b') valueEd = <Toggle value={value.value !== false} onChange={(v) => upd('value', v)} />;
    else if (t === 'i' || t === 'n') valueEd = <NumInput value={typeof value.value === 'number' ? value.value : Number(value.value) || 0} int={t === 'i'} onChange={(v) => upd('value', v)} />;
    else if (t === 'e') valueEd = <Select value={value.value} options={vs.o} onChange={(v) => upd('value', v)} />;
    else valueEd = <TextInput value={value.value} onChange={(v) => upd('value', v)} list={TEST_VALUE_LIST[value.test]} />;
  }
  return (
    <div class="ftest">
      <div class="ftest-main">
        <select class="sel test-sel" value={value.test} onChange={(e) => set(newTest(e.currentTarget.value, value))}>
          {!known && <option value={value.test}>{value.test} (unknown)</option>}
          {TESTS.map((t) => <option value={t}>{t}</option>)}
        </select>
        {ps.subject && (
          <Select value={value.subject || 'self'} options={TARGET_SUBJECTS.map((s) => [s, s === 'self' ? 'self' : s])} onChange={(v) => upd('subject', v === 'self' ? undefined : v)} />
        )}
        {ps.domain && (ps.domain.t === 'e'
          ? <Select value={value.domain ?? ps.domain.d ?? ''} options={ps.domain.o} onChange={(v) => upd('domain', v)} />
          : <TextInput value={value.domain} onChange={(v) => upd('domain', v)} list={/property/.test(value.test) ? 'dl-props' : null} placeholder="domain" />)}
        {ps.operator && <Select value={normOp(value.operator)} options={OPS} onChange={(v) => upd('operator', v === '==' ? undefined : v)} />}
        {valueEd}
      </div>
      <div class="ftest-act">
        {canWrap && <Btn small kind="ghost" onClick={() => set({ all_of: [value] })} title="Combine with more tests">+ more</Btn>}
        <Btn small kind="ghost" icon="trash" aria-label="Remove test" onClick={onRemove} />
      </div>
    </div>
  );
}
const normOp = (o) => (o === undefined || o === 'equals' || o === '=' ? '==' : o === 'not' || o === '<>' ? '!=' : o);

// ---------------- Triggers ----------------
export function TriggerEditor({ value, set }) {
  const v = typeof value === 'string' ? { event: value } : isObj(value) ? value : { event: '', target: 'self' };
  const hasFilter = v.filters !== undefined && !(isObj(v.filters) && !Object.keys(v.filters).length);
  return (
    <div class="trigger">
      <div class="inline">
        <span class="hint">run</span>
        <TextInput value={v.event} onChange={(e) => set({ ...v, event: e })} list="dl-events" placeholder="event name" mono />
        <span class="hint">on</span>
        <Select value={v.target || 'self'} options={TARGET_SUBJECTS} onChange={(t) => set({ ...v, target: t })} />
      </div>
      {hasFilter
        ? <div class="trigger-f"><span class="hint">only if</span><FilterEditor value={v.filters} set={(f) => { const c = { ...v }; if (f === undefined) delete c.filters; else c.filters = f; set(c); }} /></div>
        : <Btn small kind="ghost" icon="plus" onClick={() => set({ ...v, filters: { test: 'is_family', subject: 'other', value: 'player' } })}>Only if…</Btn>}
    </div>
  );
}

// ---------------- Components ----------------
export function ComponentCard({ id, value, set, onRemove, extraMenu, open: initialOpen = false }) {
  const spec = catalog.components[id];
  const [open, setOpen] = useState(initialOpen);
  const [raw, setRaw] = useState(false);
  const isB = isBehavior(id);
  const n = isObj(value) ? Object.keys(value).filter((k) => k !== 'priority').length : 0;
  return (
    <div class={`comp ${open ? 'open' : ''} ${spec ? '' : 'unknown'}`}>
      <div class="comp-h" role="button" tabIndex={0} onClick={() => setOpen(!open)} onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)}>
        <Icon name={open ? 'down' : 'right'} size={16} />
        <div class="comp-title">
          <div class="comp-name">{label(id)}{isB && isObj(value) && typeof value.priority === 'number' && <span class="prio" title="Priority (lower runs first)">P{value.priority}</span>}</div>
          <div class="comp-id">{id}{!spec && ' · unknown'}{spec?.m ? ' · flag' : n ? ` · ${n} setting${n > 1 ? 's' : ''}` : ''}</div>
        </div>
        <div class="comp-act" onClick={(e) => e.stopPropagation()}>
          <Btn small kind="ghost" icon="trash" aria-label={`Remove ${id}`} onClick={onRemove} />
        </div>
      </div>
      {open && (
        <div class="comp-b">
          {DESC[id] && <p class="hint">{DESC[id]}</p>}
          {isB && isObj(value) && (
            <div class="field-row"><div class="field-l"><span class="field-name">Priority</span><span class="hint">Lower runs first</span></div>
              <div class="field-v"><NumInput value={value.priority} int min={0} onChange={(p) => set({ ...value, priority: p })} /></div></div>
          )}
          {raw || !spec || !isObj(value)
            ? <JsonEditor value={value} set={set} />
            : spec.m && !Object.keys(value).length
              ? <p class="hint">No settings: adding it switches the behaviour on.</p>
              : <ObjFields fields={spec.f.filter((f) => f.k !== 'priority')} value={value} set={set} hideKeys={isB ? ['priority'] : []} />}
          <div class="comp-foot">
            <Btn small kind="ghost" onClick={() => setRaw(!raw)}>{raw ? 'Form view' : 'JSON view'}</Btn>
            <Btn small kind="ghost" icon="copy" onClick={() => { copyText(JSON.stringify({ [id]: value }, null, 2)); toast('Copied JSON'); }}>Copy</Btn>
            <Btn small kind="ghost" icon="link" onClick={() => openUrl(docsUrl(id))}>Docs</Btn>
            {extraMenu}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Editable list of components for one container (base components, a group or an activity).
 * `get()` must return the live container object; `commitFn(mutator)` applies changes.
 */
export function ComponentList({ get, commitFn, emptyText, moveTargets = [], keyPrefix = 'c', filter }) {
  const comps = get();
  const ids = Object.keys(comps).filter((id) => !filter || filter(id));
  const order = { core: 0, move: 1, combat: 2, social: 3, village: 4, logic: 5, items: 6, look: 7, misc: 8, special: 9, ai: 10 };
  const sorted = ids.sort((a, b) => {
    const ba = isBehavior(a), bb = isBehavior(b);
    if (ba !== bb) return ba ? 1 : -1;
    if (ba) return (comps[a]?.priority ?? 99) - (comps[b]?.priority ?? 99) || a.localeCompare(b);
    return (order[categoryOf(a)] ?? 9) - (order[categoryOf(b)] ?? 9) || a.localeCompare(b);
  });
  const firstB = sorted.findIndex(isBehavior);
  return (
    <div class="comp-list">
      {!sorted.length && <p class="hint empty-line">{emptyText || 'No components yet.'}</p>}
      {sorted.map((id, i) => (
        <>
          {i === firstB && <div class="list-sep">AI goals (by priority)</div>}
          <ComponentCard key={id} id={id} value={comps[id]}
            set={(nv) => commitFn((c) => { c[id] = nv; }, `${keyPrefix}:${id}`)}
            onRemove={() => commitFn((c) => { delete c[id]; })}
            extraMenu={moveTargets.length > 0 && (
              <Select value="" options={[['', 'Move to…'], ...moveTargets.map((t, j) => [String(j), t.label])]} onChange={(j) => {
                if (j === '') return;
                const t = moveTargets[Number(j)];
                t.move(id, comps[id]);
              }} />
            )} />
        </>
      ))}
      <Btn icon="plus" kind="primary" onClick={() => pickComponent(get, commitFn)}>Add component</Btn>
    </div>
  );
}

export function pickComponent(get, commitFn, { cat: initialCat = '', title = 'Add a component' } = {}) {
  function Picker() {
    const [q, setQ] = useState('');
    const [cat, setCat] = useState(initialCat);
    const all = useMemo(() => allComponents(), []);
    const comps = get();
    const ql = q.trim().toLowerCase();
    const list = all.filter((c) => (!cat || c.cat === cat) && (!ql || c.id.includes(ql) || c.label.toLowerCase().includes(ql) || c.desc.toLowerCase().includes(ql)));
    const shown = list.slice(0, 120);
    return (
      <div class="picker">
        <div class="search"><Icon name="search" size={16} /><input class="txt" placeholder={`Search ${all.length} components…`} value={q} autoFocus onInput={(e) => setQ(e.currentTarget.value)} /></div>
        <div class="cat-chips">
          <button type="button" class={`cchip ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>All</button>
          {CATEGORIES.map(([k, l, ic]) => <button type="button" class={`cchip ${cat === k ? 'on' : ''}`} onClick={() => setCat(k)}>{ic} {l}</button>)}
        </div>
        <div class="pick-list">
          {shown.map((c) => {
            const has = !!comps[c.id];
            return (
              <button type="button" class={`pick ${has ? 'has' : ''}`} disabled={has} onClick={() => {
                commitFn((cc) => { cc[c.id] = starterFor(c.id, cc); });
                closeModal();
                toast(`Added ${c.label}`);
              }}>
                <div class="pick-t"><strong>{c.label}</strong>{has && <span class="tag">added</span>}{catalog.components[c.id]?.m ? <span class="tag">flag</span> : null}</div>
                <code>{c.id}</code>
                {c.desc && <span class="hint">{c.desc}</span>}
              </button>
            );
          })}
          {list.length > shown.length && <p class="hint">…and {list.length - shown.length} more. Refine your search.</p>}
          {!list.length && <p class="hint">Nothing matches. You can still type any id below to add it as raw JSON.</p>}
          {ql.startsWith('minecraft:') && !catalog.components[ql] && (
            <Btn onClick={() => { commitFn((cc) => { cc[ql] = {}; }); closeModal(); }}>Add “{ql}” as custom</Btn>
          )}
        </div>
      </div>
    );
  }
  openModal({ title, body: Picker, wide: true });
}
