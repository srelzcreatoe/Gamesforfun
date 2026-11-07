import { useState, useEffect, useRef } from 'preact/hooks';
import { state, closeModal, render } from './store.js';

const P = {
  back: 'M15 18l-6-6 6-6',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
  play: 'M7 4l13 8-13 8z',
  pause: 'M8 5v14M16 5v14',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z',
  nodes: 'M4 4h6v6H4zM14 14h6v6h-6zM10 7h4a3 3 0 013 3v4',
  check: 'M5 12l5 5 9-11',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  info: 'M12 22a10 10 0 110-20 10 10 0 010 20zM12 11v6M12 7h.01',
  x: 'M6 6l12 12M18 6L6 18',
  down: 'M6 9l6 6 6-6',
  right: 'M9 6l6 6-6 6',
  up: 'M6 15l6-6 6 6',
  export: 'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6',
  share: 'M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  game: 'M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7A4.7 4.7 0 002 9.7v.6l1 7.4A2.5 2.5 0 007.4 18L9 16h6l1.6 2a2.5 2.5 0 004.4-.3l1-7.4v-.6A4.7 4.7 0 0017.3 5z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  file: 'M6 2h9l5 5v15H6zM14 2v6h6',
  folder: 'M3 6h6l2 2h10v11H3z',
  search: 'M11 18a7 7 0 110-14 7 7 0 010 14zM21 21l-5-5',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  brush: 'M14 4l6 6-9 9H5v-6zM12 6l6 6',
  eraser: 'M8 20h12M5 15l9-9 5 5-9 9H7z',
  fill: 'M5 11l7-7 7 7-7 7zM19 15s2 2.5 2 4a2 2 0 01-4 0c0-1.5 2-4 2-4z',
  picker: 'M14 4l6 6M4 20l2-4 9-9 2 2-9 9z',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  wand: 'M15 4V2M15 10V8M11 6H9M21 6h-2M3 21l12-12',
  upload: 'M12 15V3M7 8l5-5 5 5M4 17v4h16v-4',
};
export function Icon({ name, size = 20, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {...rest}>
      <path d={P[name] || P.info} />
    </svg>
  );
}

export function Btn({ icon, children, kind = '', small, ...rest }) {
  return (
    <button type="button" class={`btn ${kind} ${small ? 'sm' : ''} ${!children ? 'icon-only' : ''}`} {...rest}>
      {icon && <Icon name={icon} size={small ? 16 : 18} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Toggle({ value, onChange, label, hint, disabled }) {
  return (
    <label class={`toggle ${disabled ? 'disabled' : ''}`}>
      <span class="toggle-text">
        {label && <span class="toggle-label">{label}</span>}
        {hint && <span class="hint">{hint}</span>}
      </span>
      <input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span class="switch" aria-hidden="true"><span /></span>
    </label>
  );
}

/** Number input that tolerates partial typing ("-", "0.") without fighting the user. */
export function NumInput({ value, onChange, int, min, max, step, placeholder, class: cls = '', ...rest }) {
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === undefined || value === null ? '' : String(value));
  }, [value]);
  return (
    <input
      class={`num ${cls}`}
      type="text"
      inputMode={int ? 'numeric' : 'decimal'}
      value={text}
      placeholder={placeholder}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setText(value === undefined || value === null ? '' : String(value)); }}
      onInput={(e) => {
        const t = e.currentTarget.value;
        setText(t);
        if (t.trim() === '' || t === '-' || t === '.' || t === '-.') return;
        let n = Number(t);
        if (!Number.isFinite(n)) return;
        if (int) n = Math.round(n);
        if (typeof min === 'number' && n < min) return;
        if (typeof max === 'number' && n > max) return;
        onChange(n);
      }}
      {...rest}
    />
  );
}

export function TextInput({ value, onChange, list, mono, placeholder, ...rest }) {
  return (
    <input class={`txt ${mono ? 'mono' : ''}`} type="text" value={value ?? ''} list={list || undefined} placeholder={placeholder}
      autocapitalize="off" autocomplete="off" spellcheck={false}
      onInput={(e) => onChange(e.currentTarget.value)} {...rest} />
  );
}

export function Select({ value, onChange, options, ...rest }) {
  const opts = options.map((o) => (Array.isArray(o) ? o : [o, o]));
  const has = opts.some(([v]) => String(v) === String(value));
  return (
    <select class="sel" value={value ?? ''} onChange={(e) => {
      const raw = e.currentTarget.value;
      const hit = opts.find(([v]) => String(v) === raw);
      onChange(hit ? hit[0] : raw);
    }} {...rest}>
      {!has && <option value={value ?? ''}>{value === undefined || value === '' ? '— choose —' : String(value)}</option>}
      {opts.map(([v, l]) => <option value={v}>{l}</option>)}
    </select>
  );
}

export function Card({ title, sub, right, children, class: cls = '', icon }) {
  return (
    <section class={`card ${cls}`}>
      {(title || right) && (
        <header class="card-h">
          <div class="card-title">
            {icon && <span class="card-icon">{icon}</span>}
            <div>
              <h3>{title}</h3>
              {sub && <p class="hint">{sub}</p>}
            </div>
          </div>
          {right && <div class="card-right">{right}</div>}
        </header>
      )}
      <div class="card-b">{children}</div>
    </section>
  );
}

export function Collapse({ title, sub, open: initial = false, children, right, badge }) {
  const [open, setOpen] = useState(initial);
  return (
    <div class={`collapse ${open ? 'open' : ''}`}>
      <div class="collapse-h" role="button" tabIndex={0} onClick={() => setOpen(!open)} onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)}>
        <Icon name={open ? 'down' : 'right'} size={16} />
        <div class="collapse-title">
          <strong>{title}</strong>{badge && <span class="badge">{badge}</span>}
          {sub && <div class="hint">{sub}</div>}
        </div>
        {right && <div class="collapse-right" onClick={(e) => e.stopPropagation()}>{right}</div>}
      </div>
      {open && <div class="collapse-b">{children}</div>}
    </div>
  );
}

export function Row({ label, hint, children, wide }) {
  return (
    <div class={`row ${wide ? 'wide' : ''}`}>
      <div class="row-l"><span>{label}</span>{hint && <span class="hint">{hint}</span>}</div>
      <div class="row-r">{children}</div>
    </div>
  );
}

export function Chips({ values = [], onChange, list, placeholder = 'Add…', render: renderChip }) {
  const [draft, setDraft] = useState('');
  const addDraft = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...(values || []), v]);
    setDraft('');
  };
  return (
    <div class="chips">
      {(values || []).map((v, i) => (
        <span class="chip">
          {renderChip ? renderChip(v) : String(v)}
          <button type="button" aria-label="Remove" onClick={() => onChange(values.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
        </span>
      ))}
      <span class="chip-add">
        <input class="txt" value={draft} list={list || undefined} placeholder={placeholder} autocapitalize="off" autocomplete="off" spellcheck={false}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addDraft(); } }}
          onChange={(e) => { if (list && e.currentTarget.value) { /* picked from datalist */ } }} />
        <button type="button" class="btn sm" onClick={addDraft} aria-label="Add"><Icon name="plus" size={14} /></button>
      </span>
    </div>
  );
}

export function Modal() {
  const m = state.modal;
  if (!m) return null;
  return (
    <div class="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div class={`modal ${m.wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={m.title}>
        <header class="modal-h">
          <h2>{m.title}</h2>
          <Btn icon="x" kind="ghost" onClick={closeModal} aria-label="Close" />
        </header>
        <div class="modal-b">{typeof m.body === 'function' ? <m.body /> : m.body}</div>
      </div>
    </div>
  );
}

export function confirmDialog(title, text, okLabel, onOk, danger = true) {
  state.modal = {
    title,
    body: () => (
      <div class="confirm">
        <p>{text}</p>
        <div class="actions">
          <Btn kind="ghost" onClick={closeModal}>Cancel</Btn>
          <Btn kind={danger ? 'danger' : 'primary'} onClick={() => { closeModal(); onOk(); }}>{okLabel}</Btn>
        </div>
      </div>
    ),
  };
  render();
}

export function promptDialog(title, initial, onOk, { label: lbl = 'Name', hint } = {}) {
  function Body() {
    const [v, setV] = useState(initial || '');
    return (
      <form class="confirm" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { closeModal(); onOk(v.trim()); } }}>
        <label class="field"><span>{lbl}</span><input class="txt" value={v} autoFocus onInput={(e) => setV(e.currentTarget.value)} /></label>
        {hint && <p class="hint">{hint}</p>}
        <div class="actions">
          <Btn kind="ghost" onClick={closeModal}>Cancel</Btn>
          <button class="btn primary" type="submit">OK</button>
        </div>
      </form>
    );
  }
  state.modal = { title, body: Body };
  render();
}

export function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {state.toasts.map((t) => <div class={`toast ${t.kind}`} key={t.id}>{t.msg}</div>)}
    </div>
  );
}

export function Empty({ icon = '✨', title, children }) {
  return (
    <div class="empty">
      <div class="empty-i">{icon}</div>
      <strong>{title}</strong>
      {children && <div class="hint">{children}</div>}
    </div>
  );
}
