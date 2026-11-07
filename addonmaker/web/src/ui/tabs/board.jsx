// Drag-and-drop node board for dwellers. Blocks are settings (Health, Damage,
// Appearance timer…), triggers ("When you look at it") and actions ("Freeze").
// Drag from a block's ● port to another block to connect them, or tap the port
// and then tap the target. Tap a block to edit it, tap a wire to remove it.
import { useState, useRef, useEffect } from 'preact/hooks';
import { Btn, Toggle, Empty } from '../common.jsx';
import { ecommit } from '../screens/entity.jsx';
import { NODE_TYPES, KIND_INFO, ALLOWED, linkProblem, addLink, graphFromConfig, applyGraph, graphHints, typeOf } from '../../core/graph.js';
import { defaultHorror } from '../../core/horror.js';
import { setTab, toast, openModal, closeModal, state } from '../store.js';
import { Slider } from '../screens/wizard.jsx';
import { SoundPicker } from '../audio.jsx';
import { clone, uid } from '../../core/util.js';

const W = 176, PY = 19;
const kindOf = (id) => NODE_TYPES[typeOf(id)]?.kind;
const isPart = (id) => ['stat', 'spawn', 'trait'].includes(kindOf(id));
const outPt = (n) => (isPart(n.id) ? [n.x, n.y + PY] : [n.x + W, n.y + PY]);
const inPt = (n) => (typeOf(n.id) === 'core' ? [n.x + W, n.y + PY] : [n.x, n.y + PY]);
const hasOut = (id) => !!NODE_TYPES[typeOf(id)]?.out;
const hasIn = (id) => !!NODE_TYPES[typeOf(id)]?.ins;
// Always-present stat blocks: their wire can't be removed, only their values changed.
const FIXED = new Set(['health', 'damage', 'speed', 'senses', 'where']);
const REMOVABLE = (id) => kindOf(id) === 'scare' || ['flee', 'freeze', 'vanish', 'blink', 'stare', 'rest'].includes(typeOf(id));
const MOMENTS = [['notice', 'Notices you'], ['seen', 'You look at it'], ['hunt', 'Hunt starts']];

function wire(a, b, outLeft, inRight) {
  const dx = Math.max(40, Math.abs(b[0] - a[0]) / 2);
  const c1 = a[0] + (outLeft ? -dx : dx), c2 = b[0] + (inRight ? dx : -dx);
  return `M${a[0]} ${a[1]} C${c1} ${a[1]} ${c2} ${b[1]} ${b[0]} ${b[1]}`;
}

function valueText(spec, v) {
  if (spec.t === 'bool') return v ? 'yes' : 'no';
  if (v === undefined || v === null || v === '') return '—';
  if (spec.t === 'text') return `“${String(v).slice(0, 18)}${String(v).length > 18 ? '…' : ''}”`;
  return String(v);
}

let refData = null;
function defaultsFor(type) {
  if (!refData) {
    refData = {};
    for (const n of graphFromConfig({ horror: { ...defaultHorror(), enabled: true }, components: {} }).nodes) refData[typeOf(n.id)] ||= n.data;
  }
  return clone(refData[type] || {});
}

/** Commit a board change: mutate the graph, write it into the settings, then redraw from the settings. */
function saveGraph(e, mut, key) {
  ecommit(e, (en) => {
    const g = clone(graphFromConfig(en, en.horror.graph));
    mut(g);
    en.horror.graph = g;
    applyGraph(en);
    en.horror.graph = graphFromConfig(en, g);
  }, key);
}

/** Connects two blocks (with friendly errors). Scare blocks get the id of the moment they play at. */
function connect(e, g, from, to) {
  const why = linkProblem(g, from, to);
  if (why) { toast(why, 'error', 4000); return false; }
  saveGraph(e, (gg) => {
    let src = from;
    if (kindOf(from) === 'scare') {
      const want = `${typeOf(from)}#${typeOf(to)}`;
      if (want !== from) {
        const n = gg.nodes.find((x) => x.id === from);
        gg.links = gg.links.filter((l) => l.from !== from);
        if (gg.nodes.some((x) => x.id === want)) gg.nodes = gg.nodes.filter((x) => x.id !== from);
        else if (n) n.id = want;
        src = want;
      }
    }
    if (!gg.nodes.some((x) => x.id === to)) gg.nodes.push({ id: to, x: 0, y: 0, data: defaultsFor(typeOf(to)) });
    addLink(gg, src, to);
  });
  return true;
}

function FieldEdit({ name, label, spec, value, onChange }) {
  if (spec.t === 'num') return <Slider label={label} value={Number(value ?? spec.min)} min={spec.min} max={spec.max} step={spec.step} onChange={onChange} />;
  if (spec.t === 'bool') return <Toggle label={label} value={!!value} onChange={onChange} />;
  if (spec.t === 'pick') {
    return (
      <div class="field"><span>{label}</span>
        <div class="inline wrap">{spec.o.map((o) => <button type="button" class={`cchip ${value === o ? 'on' : ''}`} onClick={() => onChange(o)}>{o}</button>)}</div>
      </div>
    );
  }
  if (spec.t === 'sound') return <div class="field"><span>{label}</span><SoundPicker value={value} onChange={onChange} k={name} /></div>;
  if (spec.t === 'color') return <div class="field"><span>{label}</span><input type="color" value={value || '#000000'} aria-label={label} onInput={(ev) => onChange(ev.currentTarget.value)} /></div>;
  return <label class="field"><span>{label}</span><input class="txt" value={value || ''} onInput={(ev) => onChange(ev.currentTarget.value)} /></label>;
}

function openNodeSheet(e, id) {
  const type = typeOf(id), T = NODE_TYPES[type];
  function Sheet() {
    const en = state.project.entities.find((x) => x.uid === e.uid) || e;
    const g = graphFromConfig(en, en.horror.graph);
    const n = g.nodes.find((x) => x.id === id);
    if (!n) return <p class="hint">This block was removed.</p>;
    const linkTo = g.links.find((l) => l.from === n.id)?.to;
    const setData = (k, v) => saveGraph(e, (gg) => { const m = gg.nodes.find((x) => x.id === n.id); if (m) m.data = { ...m.data, [k]: v }; }, `nb:${n.id}:${k}`);
    const fields = Object.entries(T.fields || {});
    const targets = T.out === 'flow' ? ALLOWED[type] || [] : [];
    return (
      <div class="stack">
        <p class="hint">{T.desc || KIND_INFO[T.kind]?.[0]}</p>
        {fields.map(([k, [label, spec]]) => <FieldEdit name={k} label={label} spec={spec} value={n.data?.[k]} onChange={(v) => setData(k, v)} />)}
        {T.out === 'part' && !FIXED.has(type) && (
          <Toggle label="Plugged into the Dweller" hint="Unplug to switch it off" value={linkTo === 'core'} onChange={(v) => saveGraph(e, (gg) => { gg.links = gg.links.filter((l) => l.from !== n.id); if (v) gg.links.push({ from: n.id, to: 'core' }); })} />
        )}
        {targets.length > 0 && (
          <div class="field"><span>Then it…</span>
            <div class="inline wrap">
              {targets.map((t) => <button type="button" class={`cchip ${linkTo === t ? 'on' : ''}`} onClick={() => connect(e, g, n.id, t)}>{NODE_TYPES[t].icon} {NODE_TYPES[t].label}</button>)}
              {type !== 'ends' && <button type="button" class={`cchip ${!linkTo ? 'on' : ''}`} onClick={() => saveGraph(e, (gg) => { gg.links = gg.links.filter((l) => l.from !== n.id); })}>Nothing</button>}
            </div>
          </div>
        )}
        {T.kind === 'scare' && (
          <div class="field"><span>Plays when…</span>
            <div class="inline wrap">
              {MOMENTS.map(([m, l]) => <button type="button" class={`cchip ${linkTo === m ? 'on' : ''}`} onClick={() => { closeModal(); connect(e, g, n.id, m); }}>{l}</button>)}
            </div>
          </div>
        )}
        <div class="actions">
          {REMOVABLE(n.id) && <Btn kind="danger" icon="trash" onClick={() => { closeModal(); saveGraph(e, (gg) => { gg.nodes = gg.nodes.filter((x) => x.id !== n.id); gg.links = gg.links.filter((l) => l.from !== n.id && l.to !== n.id); }); }}>Remove block</Btn>}
          <Btn kind="primary" onClick={closeModal}>Done</Btn>
        </div>
      </div>
    );
  }
  openModal({ title: `${T.icon} ${T.label}`, body: Sheet });
}

function openPalette(e, at) {
  function Body() {
    const en = state.project.entities.find((x) => x.uid === e.uid) || e;
    const g = graphFromConfig(en, en.horror.graph);
    const present = new Set(g.nodes.map((n) => n.id));
    const groups = ['do', 'scare', 'when', 'stat', 'spawn', 'trait'];
    return (
      <div class="stack">
        <p class="hint">Tap a block to put it on the board, then connect its ● port. Grey blocks are already on the board.</p>
        {groups.map((k) => (
          <div class="nb-pal">
            <h4 style={{ color: KIND_INFO[k][1] }}>{KIND_INFO[k][0]}</h4>
            <div class="inline wrap">
              {Object.entries(NODE_TYPES).filter(([, t]) => t.kind === k).map(([type, t]) => {
                const has = !t.multi && present.has(type);
                return (
                  <button type="button" class={`cchip nb-chip ${has ? 'dim' : ''}`} style={{ borderColor: KIND_INFO[k][1] }} disabled={has} title={t.desc} onClick={() => {
                    closeModal();
                    const id = t.multi ? `${type}#n${uid().slice(0, 6)}` : type;
                    saveGraph(e, (gg) => { gg.nodes.push({ id, x: Math.round(at[0]), y: Math.round(at[1]), data: defaultsFor(type) }); });
                    toast(`Added “${t.label}”. Drag its ● port to connect it.`, 'ok');
                  }}>{t.icon} {t.label}</button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }
  openModal({ title: 'Add a block', body: Body });
}

export function BoardTab({ e }) {
  if (!e.horror?.enabled) {
    return (
      <Empty icon="🧩" title="The node board is for dwellers">
        Turn this mob into a dweller first.
        <div class="actions" style={{ justifyContent: 'center' }}><Btn kind="primary" onClick={() => setTab('dweller')}>Open Dweller tab</Btn></div>
      </Empty>
    );
  }
  return <Board e={e} />;
}

function Board({ e }) {
  const g = graphFromConfig(e, e.horror.graph);
  const box = useRef(null);
  const [view, setView] = useState(null);
  const [drag, setDrag] = useState(null); // live node position while dragging
  const [line, setLine] = useState(null); // wire being drawn [from, x, y]
  const [pending, setPending] = useState(null); // tapped port waiting for a target
  const ptrs = useRef(new Map());
  const ges = useRef(null);
  const v = view || { x: 12, y: 12, s: 0.5 };

  const fit = () => {
    const el = box.current;
    if (!el) return;
    const xs = g.nodes.map((n) => n.x), ys = g.nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs) + W, minY = Math.min(...ys), maxY = Math.max(...ys) + 90;
    const s = Math.max(0.25, Math.min(1, (el.clientWidth - 24) / (maxX - minX), (el.clientHeight - 24) / (maxY - minY)));
    setView({ s, x: 12 - minX * s, y: 12 - minY * s });
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Start zoomed so the When → Then columns are readable on a phone.
    const s = Math.max(0.42, Math.min(1, el.clientWidth / 760));
    setView({ s, x: 12, y: 12 });
  }, []);

  const world = (cx, cy) => {
    const r = box.current.getBoundingClientRect();
    return [(cx - r.left - v.x) / v.s, (cy - r.top - v.y) / v.s];
  };
  const nodeAt = (cx, cy) => document.elementFromPoint(cx, cy)?.closest?.('[data-node]')?.dataset.node;

  const down = (ev) => {
    const el = box.current;
    try { el.setPointerCapture(ev.pointerId); } catch { /* ok */ }
    ptrs.current.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      ges.current = { type: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]), v0: v, w: world(...mid) };
      setLine(null); setDrag(null);
      return;
    }
    const t = ev.target;
    const port = t.closest?.('[data-port]'), node = t.closest?.('[data-node]'), wireEl = t.closest?.('[data-wire]');
    const base = { sx: ev.clientX, sy: ev.clientY, moved: false };
    if (port) ges.current = { ...base, type: 'wire', from: port.dataset.port };
    else if (node) { const n = g.nodes.find((x) => x.id === node.dataset.node); ges.current = { ...base, type: 'node', id: n.id, start: [n.x, n.y] }; }
    else if (wireEl) ges.current = { ...base, type: 'wiretap', i: Number(wireEl.dataset.wire) };
    else ges.current = { ...base, type: 'pan', v0: v };
  };
  const move = (ev) => {
    if (!ptrs.current.has(ev.pointerId)) return;
    ptrs.current.set(ev.pointerId, [ev.clientX, ev.clientY]);
    const G = ges.current;
    if (!G) return;
    if (G.type === 'pinch') {
      if (ptrs.current.size < 2) return;
      const [a, b] = [...ptrs.current.values()];
      const s = Math.max(0.2, Math.min(1.6, G.v0.s * (Math.hypot(a[0] - b[0], a[1] - b[1]) / G.d0)));
      const r = box.current.getBoundingClientRect();
      const mid = [(a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top];
      setView({ s, x: mid[0] - G.w[0] * s, y: mid[1] - G.w[1] * s });
      return;
    }
    const dx = ev.clientX - G.sx, dy = ev.clientY - G.sy;
    if (!G.moved && Math.hypot(dx, dy) < 6) return;
    G.moved = true;
    if (G.type === 'pan') setView({ ...G.v0, x: G.v0.x + dx, y: G.v0.y + dy });
    else if (G.type === 'node') setDrag({ id: G.id, x: Math.round(G.start[0] + dx / v.s), y: Math.round(G.start[1] + dy / v.s) });
    else if (G.type === 'wire') { const [x, y] = world(ev.clientX, ev.clientY); setLine([G.from, x, y]); }
  };
  const up = (ev) => {
    ptrs.current.delete(ev.pointerId);
    const G = ges.current;
    if (!G) return;
    if (G.type === 'pinch') { if (ptrs.current.size === 0) ges.current = null; return; }
    ges.current = null;
    if (G.type === 'node') {
      if (G.moved && drag) { const d = drag; saveGraph(e, (gg) => { const n = gg.nodes.find((x) => x.id === d.id); if (n) { n.x = d.x; n.y = d.y; } }, 'nb:move'); setDrag(null); }
      else if (!G.moved) {
        if (pending) { if (pending !== G.id && hasIn(G.id)) connect(e, g, pending, G.id); else if (pending !== G.id) toast(`“${NODE_TYPES[typeOf(G.id)].label}” has no input`, 'error'); setPending(null); }
        else openNodeSheet(e, G.id);
      }
      setDrag(null);
    } else if (G.type === 'wire') {
      setLine(null);
      if (G.moved) {
        const target = nodeAt(ev.clientX, ev.clientY);
        if (target && target !== G.from) connect(e, g, G.from, target);
      } else setPending(pending === G.from ? null : G.from);
    } else if (G.type === 'wiretap' && !G.moved) {
      const l = g.links[G.i];
      if (!l) return;
      if (FIXED.has(l.from)) toast(`${NODE_TYPES[l.from].label} is always connected. Tap the block to change it.`, 'info', 3500);
      else if (l.from === 'ends') toast('When the hunt ends it has to do something. Drag a new wire from “Hunt ends” instead.', 'info', 4000);
      else { saveGraph(e, (gg) => { gg.links = gg.links.filter((x) => !(x.from === l.from && x.to === l.to)); }); toast('Wire removed (undo to bring it back)'); }
    } else if (G.type === 'pan' && !G.moved && pending) setPending(null);
  };
  const wheel = (ev) => {
    ev.preventDefault();
    const s = Math.max(0.2, Math.min(1.6, v.s * (ev.deltaY < 0 ? 1.1 : 0.9)));
    const [wx, wy] = world(ev.clientX, ev.clientY);
    const r = box.current.getBoundingClientRect();
    setView({ s, x: ev.clientX - r.left - wx * s, y: ev.clientY - r.top - wy * s });
  };
  const zoom = (f) => {
    const el = box.current;
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    const wx = (cx - v.x) / v.s, wy = (cy - v.y) / v.s;
    const s = Math.max(0.2, Math.min(1.6, v.s * f));
    setView({ s, x: cx - wx * s, y: cy - wy * s });
  };
  const center = () => { const el = box.current; return el ? [(el.clientWidth / 2 - v.x) / v.s - W / 2, (el.clientHeight / 2 - v.y) / v.s - 30] : [0, 0]; };

  const nodes = g.nodes.map((n) => (drag && drag.id === n.id ? { ...n, x: drag.x, y: drag.y } : n));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const hints = graphHints(g);
  const pendingOk = pending ? new Set(nodes.filter((n) => !linkProblem(g, pending, n.id)).map((n) => n.id)) : null;
  return (
    <div class="nb-wrap">
      <div class="nb-bar">
        <Btn small kind="primary" icon="plus" onClick={() => openPalette(e, center())}>Add block</Btn>
        <Btn small kind="ghost" aria-label="Zoom out" onClick={() => zoom(0.8)}>−</Btn>
        <Btn small kind="ghost" aria-label="Zoom in" onClick={() => zoom(1.25)}>+</Btn>
        <Btn small kind="ghost" onClick={fit}>Fit</Btn>
        <Btn small kind="ghost" onClick={() => ecommit(e, (en) => { en.horror.graph = graphFromConfig(en); })}>Tidy</Btn>
        <span class="nb-legend">{Object.entries(KIND_INFO).filter(([k]) => k !== 'core').map(([k, [l, c]]) => <span><i style={{ background: c }} />{l}</span>)}</span>
      </div>
      {pending && <div class="nb-tip">Now tap the block to connect “{NODE_TYPES[typeOf(pending)].label}” to (glowing ones fit). Tap empty space to cancel.</div>}
      <div class={`nb ${pending ? 'connecting' : ''}`} ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
        <div class="nb-world" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})` }}>
          <svg class="nb-wires" width="1" height="1" style={{ overflow: 'visible' }}>
            {g.links.map((l, i) => {
              const a = byId[l.from], b = byId[l.to];
              if (!a || !b) return null;
              const d = wire(outPt(a), inPt(b), isPart(a.id), typeOf(b.id) === 'core');
              const col = KIND_INFO[kindOf(a.id)]?.[1] || '#aaa';
              return (
                <g data-wire={i} class="nb-wire">
                  <path d={d} class="hit" />
                  <path d={d} stroke={col} class="ln" />
                </g>
              );
            })}
            {line && byId[line[0]] && <path class="nb-draft" d={wire(outPt(byId[line[0]]), [line[1], line[2]], isPart(line[0]), false)} />}
          </svg>
          {nodes.map((n) => {
            const T = NODE_TYPES[typeOf(n.id)];
            if (!T) return null;
            const col = KIND_INFO[T.kind][1];
            const wired = g.links.some((l) => l.from === n.id || l.to === n.id);
            const fields = Object.entries(T.fields || {}).slice(0, 3);
            return (
              <div data-node={n.id} class={`nb-node k-${T.kind} ${wired ? '' : 'loose'} ${pending === n.id ? 'src' : ''} ${pendingOk ? (pendingOk.has(n.id) ? 'can' : 'cant') : ''}`} style={{ left: `${n.x}px`, top: `${n.y}px`, width: `${W}px`, '--k': col }}>
                <div class="nb-node-h"><span>{T.icon}</span>{T.kind === 'core' ? (e.displayName || e.name) : T.label}</div>
                {T.kind === 'core'
                  ? <div class="nb-node-b"><span class="hint">Plug stats, spawning and traits in here</span></div>
                  : fields.length > 0 && <div class="nb-node-b">{fields.map(([k, [label, spec]]) => <div class="nb-f"><span>{label}</span><b>{valueText(spec, n.data?.[k])}</b></div>)}</div>}
                {hasIn(n.id) && <span class={`nb-port in ${typeOf(n.id) === 'core' ? 'right' : ''}`} />}
                {hasOut(n.id) && <span data-port={n.id} class={`nb-port out ${isPart(n.id) ? 'left' : ''}`} aria-label={`Connect ${T.label}`} />}
              </div>
            );
          })}
        </div>
      </div>
      {hints.length > 0 && <div class="nb-hints">{hints.map((t) => <p>⚠ {t}</p>)}</div>}
      <p class="hint">Drag the ● on a block onto another block to connect them, or tap ● and then the target. Tap a block to edit its values. Tap a wire to remove it. Pinch or use − / + to zoom. Changes here also update the Dweller tab.</p>
    </div>
  );
}
