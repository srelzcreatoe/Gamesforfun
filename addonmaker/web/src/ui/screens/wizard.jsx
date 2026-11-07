// Step-by-step dweller creator: look → where → stalking style → when it shows up → name & strength.
import { useState, useEffect } from 'preact/hooks';
import { Btn, Toggle } from '../common.jsx';
import { state, commit, go, openModal, closeModal, toast } from '../store.js';
import { DWELLER_PRESETS, dwellerFromPreset, applyDwellerPreset } from '../../core/dwellers.js';
import { ARCHETYPES, DWELLER_TYPES, DWELLER_TIMES, RARITY } from '../../core/horror.js';
import { DWELLER_BODIES } from '../../core/geo.js';
import { baseEntity } from '../../core/model.js';
import { slug } from '../../core/util.js';
import { renderFrontSprite } from '../textures.js';

const STEPS = ['Look', 'Where', 'Style', 'Timing', 'Finish'];

function Sprite({ make, k }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { let a = true; make().then((u) => a && setUrl(u)).catch(() => {}); return () => { a = false; }; }, [k]);
  return url ? <img src={url} alt="" /> : <span />;
}

export function Slider({ label, value, min, max, step = 1, unit = '', onChange, hint }) {
  return (
    <div class="slide">
      <div class="slide-h"><span>{label}</span><strong>{value}{unit}</strong></div>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onInput={(ev) => onChange(Number(ev.currentTarget.value))} />
      {hint && <span class="hint">{hint}</span>}
    </div>
  );
}

export function appearSummary(ap, type, time) {
  if (!ap.director && !ap.natural) return 'Only appears from its spawn egg or /summon.';
  const where = type === 'underground' ? 'underground' : type === 'surface' ? (time === 'night' ? 'on the surface at night' : 'on the surface') : time === 'night' ? 'in caves, or outside at night' : 'anywhere';
  const parts = [];
  if (ap.director) parts.push(`shows up ${where} about ${ap.firstAfter} min after you join, then every ${ap.every[0]}–${ap.every[1]} min (${ap.chance}% chance each time)`);
  if (ap.natural) parts.push(`${ap.director ? 'also ' : ''}spawns naturally (${ap.rarity})`);
  if (ap.leaveAfter > 0) parts.push(`leaves after ~${ap.leaveAfter} min if it doesn't catch you`);
  return parts.join('; ') + '.';
}

export function AppearanceEditor({ ap, type, time, set }) {
  return (
    <div class="stack">
      <Toggle label="Appearance timer" hint="Guaranteed visits: it comes to find you" value={ap.director} onChange={(v) => set({ director: v })} />
      {ap.director && <>
        <Slider label="First shows up after" unit=" min" value={ap.firstAfter} min={1} max={30} onChange={(v) => set({ firstAfter: v })} />
        <Slider label="Then every (shortest)" unit=" min" value={ap.every[0]} min={1} max={60} onChange={(v) => set({ every: [v, Math.max(v, ap.every[1])] })} />
        <Slider label="Then every (longest)" unit=" min" value={ap.every[1]} min={ap.every[0]} max={90} onChange={(v) => set({ every: [ap.every[0], v] })} />
        <Slider label="Chance each time" unit="%" value={ap.chance} min={5} max={100} step={5} onChange={(v) => set({ chance: v })} />
        <div class="inline wrap">
          <span class="hint">Appears</span>
          {[['near', 'Close by'], ['medium', 'Medium'], ['far', 'Far away']].map(([k, l]) => <button type="button" class={`cchip ${ap.distance === k ? 'on' : ''}`} onClick={() => set({ distance: k })}>{l}</button>)}
        </div>
        <Toggle label="Only one at a time" value={ap.oneAtATime !== false} onChange={(v) => set({ oneAtATime: v })} />
      </>}
      <Slider label="Leaves if it hasn't caught you after" unit={ap.leaveAfter ? ' min' : ' (never)'} value={ap.leaveAfter} min={0} max={20} onChange={(v) => set({ leaveAfter: v })} />
      <Toggle label="Also spawn naturally" hint="Like normal mobs, in the dark" value={ap.natural} onChange={(v) => set({ natural: v })} />
      {ap.natural && (
        <div class="inline wrap">{Object.keys(RARITY).map((r) => <button type="button" class={`cchip ${ap.rarity === r ? 'on' : ''}`} onClick={() => set({ rarity: r })}>{r}</button>)}</div>
      )}
      <p class="summary">📅 {appearSummary(ap, type, time)}</p>
    </div>
  );
}

export function openDwellerWizard() {
  function Wizard() {
    const [step, setStep] = useState(0);
    const [look, setLook] = useState({ kind: 'preset', id: 'night_grinner' });
    const preset = look.kind === 'preset' ? DWELLER_PRESETS.find((d) => d.id === look.id) : null;
    const [type, setType] = useState('both');
    const [time, setTime] = useState('night');
    const [style, setStyle] = useState('stalker');
    const [ap, setAp] = useState({ director: true, firstAfter: 3, every: [6, 12], chance: 70, oneAtATime: true, leaveAfter: 5, distance: 'medium', natural: true, rarity: 'uncommon' });
    const [name, setName] = useState('');
    const [stats, setStats] = useState([45, 8, 0.33]);
    const pickLook = (l) => {
      setLook(l);
      const p = l.kind === 'preset' ? DWELLER_PRESETS.find((d) => d.id === l.id) : null;
      if (p) { setType(p.type); setTime(p.time); setStyle(p.style); setAp((a) => ({ ...a, ...p.appear })); setStats(p.stats); if (!name) setName(''); }
    };
    const create = () => {
      const pr = state.project;
      const label = name.trim() || preset?.label || `${DWELLER_BODIES[look.body]?.label || 'Dweller'}`;
      let id = slug(label, { fallback: 'dweller' }), i = 2, base = id;
      while (pr.entities.some((e) => e.name === id)) id = `${base}_${i++}`;
      let e;
      if (preset) e = dwellerFromPreset(pr, preset.id, id, label);
      else {
        e = baseEntity(id, 'humanoid');
        e.displayName = label;
        applyDwellerPreset(e, {
          id: 'custom', body: look.body, spec: {}, colors: {}, patterns: { body: ['grime', '#0a0808'] },
          paint: { eyeStyle: 'glow', eyeColor: '#ff3a2a', mouth: 'grin' }, style, type, time, appear: ap, stats,
          sounds: [{ ambient: 'mob.warden.idle', hurt: 'mob.warden.hurt', death: 'mob.warden.death', step: 'mob.warden.step' }, [0.6, 0.8]],
          loot: [{ rolls: 1, entries: [{ type: 'item', name: 'minecraft:bone', weight: 1 }] }],
        }, pr.namespace);
      }
      if (e.horror.archetype !== style) { e.horror.archetype = style; ARCHETYPES[style].apply(e.horror); }
      e.horror.type = type; e.horror.time = time;
      if (time === 'always') e.horror.weakness.sunlight = 'none';
      e.horror.appear = { ...e.horror.appear, ...ap };
      e.components['minecraft:health'] = { value: stats[0], max: stats[0] };
      e.horror.hunt.damage = stats[1];
      e.components['minecraft:movement'] = { value: stats[2] };
      commit((pp) => { pp.entities.push(e); });
      closeModal();
      go({ screen: 'entity', entityUid: e.uid, tab: 'dweller' });
      toast(`${label} is ready. Export it, or fine-tune it on the node board.`, 'ok', 5000);
    };
    return (
      <div class="wizard">
        <div class="wiz-steps">{STEPS.map((s, i) => <button type="button" class={`wiz-step ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`} onClick={() => setStep(i)}>{i + 1}. {s}</button>)}</div>
        {step === 0 && <>
          <h3>Pick a look</h3>
          <div class="pgrid">
            {DWELLER_PRESETS.map((d) => (
              <div class={`pcard ${look.id === d.id ? 'sel' : ''} ${d.signature ? 'sig' : ''}`} role="button" tabIndex={0} onClick={() => pickLook({ kind: 'preset', id: d.id })}>
                <div class="pcard-label">{d.label}</div>
                <div class="pcard-art"><Sprite k={d.id} make={() => renderFrontSprite(dwellerFromPreset({ namespace: 'x' }, d.id), 96)} /></div>
              </div>
            ))}
          </div>
          <h3>…or start from a blank body</h3>
          <div class="inline wrap">{Object.entries(DWELLER_BODIES).map(([k, b]) => <button type="button" class={`cchip ${look.body === k ? 'on' : ''}`} onClick={() => pickLook({ kind: 'body', body: k })}>{b.label}</button>)}</div>
        </>}
        {step === 1 && <>
          <h3>Where does it live?</h3>
          <div class="roles">{DWELLER_TYPES.map(([k, l, d, ic]) => <button type="button" class={`role ${type === k ? 'on' : ''}`} onClick={() => setType(k)}><span class="role-i">{ic}</span><strong>{l}</strong><span class="hint">{d}</span></button>)}</div>
          {type !== 'underground' && <div class="inline wrap">{DWELLER_TIMES.map(([k, l]) => <button type="button" class={`cchip ${time === k ? 'on' : ''}`} onClick={() => setTime(k)}>{l}</button>)}</div>}
        </>}
        {step === 2 && <>
          <h3>How does it stalk you?</h3>
          <div class="roles">{Object.entries(ARCHETYPES).map(([k, a]) => <button type="button" class={`role ${style === k ? 'on' : ''}`} onClick={() => setStyle(k)}><span class="role-i">{a.icon}</span><strong>{a.label}</strong><span class="hint">{a.blurb}</span></button>)}</div>
        </>}
        {step === 3 && <>
          <h3>When does it show up?</h3>
          <AppearanceEditor ap={ap} type={type} time={time} set={(o) => setAp((a) => ({ ...a, ...o }))} />
        </>}
        {step === 4 && <>
          <h3>Name & strength</h3>
          <label class="field"><span>Name</span><input class="txt" placeholder={preset?.label || 'My Dweller'} value={name} onInput={(ev) => setName(ev.currentTarget.value)} /></label>
          <Slider label="Health" unit=" ♥/2" value={stats[0]} min={10} max={200} step={5} onChange={(v) => setStats([v, stats[1], stats[2]])} />
          <Slider label="Damage per hit" value={stats[1]} min={1} max={30} onChange={(v) => setStats([stats[0], v, stats[2]])} />
          <Slider label="Walk speed" value={stats[2]} min={0.15} max={0.6} step={0.01} onChange={(v) => setStats([stats[0], stats[1], v])} />
          <p class="summary">👁 {ARCHETYPES[style].label}: {ARCHETYPES[style].blurb}<br />📅 {appearSummary(ap, type, time)}</p>
        </>}
        <div class="actions sticky">
          {step > 0 && <Btn kind="ghost" onClick={() => setStep(step - 1)}>Back</Btn>}
          {step < STEPS.length - 1 ? <Btn kind="primary" onClick={() => setStep(step + 1)}>Next</Btn> : <Btn kind="primary" icon="check" onClick={create}>Create dweller</Btn>}
        </div>
      </div>
    );
  }
  openModal({ title: 'Create a dweller', body: Wizard, wide: true });
}
