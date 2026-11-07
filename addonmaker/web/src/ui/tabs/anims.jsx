import { useState } from 'preact/hooks';
import { Card, Btn, Row, Toggle, Select, NumInput, TextInput, Collapse, Empty } from '../common.jsx';
import { Preview3D } from '../preview3d.jsx';
import { ModeChips } from './overview.jsx';
import { ecommit } from '../screens/entity.jsx';
import { ANIM_KINDS, WHEN_PRESETS, newCustomAnim, ANIM_SLOTS, parseAnimationFile } from '../../core/anim.js';
import { slug, uid, parseLenientJSON } from '../../core/util.js';
import { toast, openModal, closeModal } from '../store.js';
import { pickFile, readAsText } from '../native.js';

// Preview mode that shows each slot playing.
const SLOT_MODE = { idle: 'idle', walk: 'walk', run: 'run', attack: 'attack', hunt: 'run', stalk: 'stalk', flee: 'flee', frozen: 'frozen' };
const SLOT_GUESS = { idle: /idle|stand|breath/, walk: /walk|move/, run: /run|sprint|chase/, attack: /attack|hit|swing|bite|slash/, hunt: /hunt|chase|charge/, stalk: /stalk|sneak|creep|crouch/, flee: /flee|escape|run_away|scared/, frozen: /frozen|freeze|still|pose/ };

/** Bones an animation moves that this model doesn't have. */
function missingBones(e, data) {
  const have = new Set(e.model.bones.map((b) => b.name));
  return Object.keys(data?.bones || {}).filter((b) => !have.has(b));
}

/** Picks an .animation.json, adds its animations, and optionally assigns one to a slot. */
async function importAnimations(e, slot) {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  let list;
  try { list = parseAnimationFile(parseLenientJSON(await readAsText(f))); } catch (err) { toast('Not an animation file: ' + err.message, 'error', 5000); return; }
  if (!list.length) { toast('That file has no animations in it', 'error'); return; }
  const assign = (a) => ecommit(e, (en) => {
    en.anims.imported ||= [];
    for (const x of list) if (!en.anims.imported.some((y) => y.source === x.source)) en.anims.imported.push(x);
    const keep = en.anims.imported.find((y) => y.source === a?.source);
    if (slot && keep) (en.anims.slots ||= {})[slot] = `imp:${keep.uid}`;
  });
  const done = (a) => {
    assign(a);
    const miss = a ? missingBones(e, a.data) : [];
    toast(miss.length ? `Imported. ${miss.length} bone(s) aren't in this model (${miss.slice(0, 3).join(', ')}), so those parts won't move.` : `Imported ${list.length} animation${list.length === 1 ? '' : 's'}${slot && a ? ` → ${slot}` : ''}`, miss.length ? 'info' : 'ok', 5000);
  };
  if (!slot || list.length === 1) { done(slot ? list[0] : null); return; }
  const guess = list.find((a) => SLOT_GUESS[slot]?.test(a.source.toLowerCase()));
  function Pick() {
    return (
      <div class="stack">
        <p class="hint">This file has {list.length} animations. Which one is “{slot}”? The others are kept so you can use them for other slots.</p>
        {list.map((a) => <Btn kind={a === guess ? 'primary' : ''} onClick={() => { closeModal(); done(a); }}>{a.source}</Btn>)}
      </div>
    );
  }
  openModal({ title: `Pick the ${slot} animation`, body: Pick });
}

function Slider({ value, min, max, step, onChange }) {
  return (
    <div class="inline slider">
      <input type="range" min={min} max={max} step={step} value={value} onInput={(e) => onChange(Number(e.currentTarget.value))} />
      <span class="mono">{value}</span>
    </div>
  );
}

export function AnimationsTab({ e }) {
  const [mode, setMode] = useState('walk');
  const [custom, setCustom] = useState(null);
  const [imp, setImp] = useState(null);
  const a = e.anims || {};
  const set = (k, fn, key) => ecommit(e, (en) => { en.anims[k] ||= {}; fn(en.anims[k]); }, key);
  const bones = e.model.bones.map((b) => b.name);
  return (
    <div class="tab-anims">
      <div class="preview-wrap">
        <Preview3D entity={e} mode={custom || imp ? 'still' : mode} custom={custom} imported={imp} height={280} />
        <ModeChips mode={custom || imp ? '' : mode} setMode={(m) => { setCustom(null); setImp(null); setMode(m); }} entity={e} />
        {(a.custom || []).length > 0 && (
          <div class="mode-chips">{a.custom.map((c) => <button type="button" class={`cchip ${custom === c.name ? 'on' : ''}`} onClick={() => { setImp(null); setCustom(c.name); }}>▶ {c.name}</button>)}</div>
        )}
      </div>
      <Card title="Animation slots" sub="Choose what plays for each action: the built-in motion, your own imported animation, or one you keyframe below">
        {ANIM_SLOTS.filter(([, , , dw]) => !dw || e.horror?.enabled).map(([slot, label, desc]) => {
          const val = a.slots?.[slot] || 'builtin';
          const opts = [['builtin', 'Built-in motion'], ['off', 'Nothing'],
            ...(a.imported || []).map((x) => [`imp:${x.uid}`, `⬆ ${x.name}`]),
            ...(a.custom || []).map((x) => [`cus:${x.uid}`, `🎬 ${x.name}`])];
          return (
            <div class="slot-row">
              <div class="slot-t"><strong>{label}</strong><span class="hint">{desc}</span></div>
              <Select value={val} options={opts} onChange={(v) => ecommit(e, (en) => { (en.anims.slots ||= {})[slot] = v; })} />
              <Btn small kind="ghost" icon="play" aria-label={`Preview ${label}`} onClick={() => { setCustom(null); setImp(null); setMode(SLOT_MODE[slot]); }} />
              <Btn small kind="ghost" icon="upload" aria-label={`Upload ${label} animation`} onClick={() => importAnimations(e, slot)} />
            </div>
          );
        })}
        <p class="hint">Upload a Bedrock <code>.animation.json</code> (for example from Blockbench). Bone names in it must match this model's bones (Model tab). {e.horror?.enabled ? 'Hunting, stalking, fleeing and frozen play while the dweller is in that state.' : ''}</p>
      </Card>

      <Card title="Imported animations" sub="Animations from your own files" right={<Btn small icon="upload" kind="primary" onClick={() => importAnimations(e, null)}>Import</Btn>}>
        {!(a.imported || []).length && <Empty icon="⬆" title="None yet">Import a .animation.json, then pick it in a slot above.</Empty>}
        {(a.imported || []).map((ia) => {
          const miss = missingBones(e, ia.data);
          const used = Object.entries(a.slots || {}).filter(([, v]) => v === `imp:${ia.uid}`).map(([k]) => k);
          return (
            <div class="csnd">
              <Btn small kind={imp === ia.uid ? 'primary' : ''} icon="play" aria-label={`Preview ${ia.name}`} onClick={() => { setCustom(null); setImp(imp === ia.uid ? null : ia.uid); }} />
              <div class="csnd-main">
                <TextInput value={ia.name} mono onChange={(v) => ecommit(e, (en) => { const x = en.anims.imported.find((y) => y.uid === ia.uid); if (x) x.name = slug(v, { fallback: 'anim' }); }, `ia:${ia.uid}`)} />
                <span class="hint">{ia.source} · {Object.keys(ia.data?.bones || {}).length} bones{used.length ? ` · used for ${used.join(', ')}` : ''}</span>
                {miss.length > 0 && <span class="hint warn-t">Not in this model: {miss.slice(0, 5).join(', ')}{miss.length > 5 ? '…' : ''}</span>}
              </div>
              <Btn small kind="ghost" icon="trash" aria-label={`Delete ${ia.name}`} onClick={() => ecommit(e, (en) => {
                en.anims.imported = en.anims.imported.filter((y) => y.uid !== ia.uid);
                for (const [k, v] of Object.entries(en.anims.slots || {})) if (v === `imp:${ia.uid}`) en.anims.slots[k] = 'builtin';
              })} />
            </div>
          );
        })}
      </Card>

      <Card title="Built-in motion" sub="Generated from bone roles (Model tab) and exported as Molang">
        {Object.entries(ANIM_KINDS).map(([k, info]) => (
          <div class="anim-row">
            <Toggle label={info.label} hint={info.help} value={a[k]?.on} onChange={(v) => set(k, (x) => { x.on = v; })} />
            {a[k]?.on && 'amp' in (a[k] || {}) && k === 'walk' && <Row label="Swing (°)"><Slider value={a.walk.amp} min={10} max={110} step={1} onChange={(v) => set('walk', (x) => { x.amp = v; }, 'an:wa')} /></Row>}
            {a[k]?.on && k !== 'walk' && k !== 'look' && <Row label="Strength"><Slider value={a[k].amp ?? 1} min={0.2} max={3} step={0.1} onChange={(v) => set(k, (x) => { x.amp = v; }, `an:${k}a`)} /></Row>}
            {a[k]?.on && (k === 'walk' || k === 'fly' || k === 'swim') && <Row label="Speed"><Slider value={a[k].speed ?? 1} min={0.2} max={3} step={0.05} onChange={(v) => set(k, (x) => { x.speed = v; }, `an:${k}s`)} /></Row>}
            {a[k]?.on && k === 'attack' && <Toggle label="Swing both arms" value={a.attack.both} onChange={(v) => set('attack', (x) => { x.both = v; })} />}
            {a[k]?.on && k === 'fly' && <Row label="Plays"><Select value={a.fly.when || 'always'} options={[['always', 'Always'], ['air', 'Only in the air']]} onChange={(v) => set('fly', (x) => { x.when = v; })} /></Row>}
            {a[k]?.on && k === 'swim' && <Row label="Plays"><Select value={a.swim.when || 'always'} options={[['always', 'Always'], ['water', 'Only in water']]} onChange={(v) => set('swim', (x) => { x.when = v; })} /></Row>}
          </div>
        ))}
      </Card>
      <Card title="Custom animations" sub="Keyframe animations for any bone (degrees for rotation, pixels for position)">
        {!(a.custom || []).length && <Empty icon="🎬" title="None yet">Make a dance, a wave or a sitting pose and choose when it plays.</Empty>}
        {(a.custom || []).map((ca, ci) => {
          const upd = (fn, key) => ecommit(e, (en) => fn(en.anims.custom.find((x) => x.uid === ca.uid)), key);
          return (
            <Collapse key={ca.uid} title={ca.name} sub={`${ca.length}s · ${WHEN_PRESETS.find((w) => w[0] === ca.when)?.[1] || ca.when} · ${ca.channels.length} track${ca.channels.length === 1 ? '' : 's'}`}
              right={<><Btn small kind="ghost" icon="play" aria-label="Preview" onClick={() => setCustom(ca.name)} /><Btn small kind="ghost" icon="trash" aria-label="Delete animation" onClick={() => ecommit(e, (en) => { en.anims.custom = en.anims.custom.filter((x) => x.uid !== ca.uid); })} /></>}>
              <Row label="Name"><TextInput value={ca.name} mono onChange={(v) => upd((x) => { x.name = slug(v, { fallback: '' }); }, `ca:${ca.uid}:n`)} /></Row>
              <Row label="Length (s)"><NumInput min={0.05} value={ca.length} onChange={(v) => upd((x) => { x.length = v; }, `ca:${ca.uid}:l`)} /></Row>
              <Row label="Looping"><Select value={ca.loop === 'hold' ? 'hold' : ca.loop ? 'loop' : 'once'} options={[['loop', 'Loop'], ['once', 'Play once'], ['hold', 'Hold last frame']]} onChange={(v) => upd((x) => { x.loop = v === 'loop' ? true : v === 'hold' ? 'hold' : false; })} /></Row>
              <Row label="Plays when"><Select value={ca.when} options={WHEN_PRESETS.map((w) => [w[0], w[1]])} onChange={(v) => upd((x) => { x.when = v; })} /></Row>
              {ca.when === 'custom' && <Row label="Molang"><TextInput value={ca.expr} mono placeholder="query.property('ns:mood') == 'happy'" onChange={(v) => upd((x) => { x.expr = v; }, `ca:${ca.uid}:x`)} /></Row>}
              {ca.channels.map((ch, chi) => (
                <div class="track">
                  <div class="inline">
                    <Select value={ch.bone} options={bones} onChange={(v) => upd((x) => { x.channels[chi].bone = v; })} />
                    <Select value={ch.prop || 'rotation'} options={[['rotation', 'Rotate'], ['position', 'Move'], ['scale', 'Scale']]} onChange={(v) => upd((x) => { x.channels[chi].prop = v; })} />
                    <span class="grow" />
                    <Btn small kind="ghost" icon="trash" aria-label="Delete track" onClick={() => upd((x) => { x.channels.splice(chi, 1); })} />
                  </div>
                  <table class="keys">
                    <thead><tr><th>time</th><th>x</th><th>y</th><th>z</th><th /></tr></thead>
                    <tbody>
                      {ch.keys.map((k, ki) => (
                        <tr>
                          <td><NumInput min={0} value={k.t} onChange={(v) => upd((x) => { x.channels[chi].keys[ki].t = v; }, `ca:${ca.uid}:${chi}:${ki}`)} /></td>
                          {[0, 1, 2].map((ai) => <td><NumInput value={k.v[ai]} onChange={(v) => upd((x) => { x.channels[chi].keys[ki].v[ai] = v; }, `ca:${ca.uid}:${chi}:${ki}`)} /></td>)}
                          <td><Btn small kind="ghost" icon="x" aria-label="Delete key" onClick={() => upd((x) => { x.channels[chi].keys.splice(ki, 1); })} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Btn small icon="plus" onClick={() => upd((x) => { const ks = x.channels[chi].keys; const last = ks[ks.length - 1]; ks.push({ t: Math.min(x.length, last ? Math.round((last.t + x.length / 4) * 100) / 100 : 0), v: last ? [...last.v] : (ch.prop === 'scale' ? [1, 1, 1] : [0, 0, 0]) }); })}>Key</Btn>
                </div>
              ))}
              <Btn small icon="plus" onClick={() => upd((x) => { x.channels.push({ bone: bones[0] || '', prop: 'rotation', keys: [{ t: 0, v: [0, 0, 0] }, { t: x.length / 2, v: [0, 0, 25] }, { t: x.length, v: [0, 0, 0] }] }); })}>Add bone track</Btn>
            </Collapse>
          );
        })}
        <Btn icon="plus" kind="primary" onClick={() => ecommit(e, (en) => {
          let n = 'dance', i = 2;
          while ((en.anims.custom || []).some((x) => x.name === n)) n = `dance${i++}`;
          const ca = newCustomAnim(n);
          const head = en.model.bones.find((b) => b.role === 'head') || en.model.bones[0];
          if (head) ca.channels.push({ bone: head.name, prop: 'rotation', keys: [{ t: 0, v: [0, 0, 0] }, { t: 0.25, v: [0, 0, 20] }, { t: 0.75, v: [0, 0, -20] }, { t: 1, v: [0, 0, 0] }] });
          (en.anims.custom ||= []).push(ca);
        })}>New animation</Btn>
      </Card>
    </div>
  );
}
