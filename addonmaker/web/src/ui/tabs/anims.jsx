import { useState } from 'preact/hooks';
import { Card, Btn, Row, Toggle, Select, NumInput, TextInput, Collapse, Empty } from '../common.jsx';
import { Preview3D } from '../preview3d.jsx';
import { ModeChips } from './overview.jsx';
import { ecommit } from '../screens/entity.jsx';
import { ANIM_KINDS, WHEN_PRESETS, newCustomAnim } from '../../core/anim.js';
import { slug, uid } from '../../core/util.js';

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
  const a = e.anims || {};
  const set = (k, fn, key) => ecommit(e, (en) => { en.anims[k] ||= {}; fn(en.anims[k]); }, key);
  const bones = e.model.bones.map((b) => b.name);
  return (
    <div class="tab-anims">
      <div class="preview-wrap">
        <Preview3D entity={e} mode={custom ? 'idle' : mode} custom={custom} height={280} />
        <ModeChips mode={custom ? '' : mode} setMode={(m) => { setCustom(null); setMode(m); }} />
        {(a.custom || []).length > 0 && (
          <div class="mode-chips">{a.custom.map((c) => <button type="button" class={`cchip ${custom === c.name ? 'on' : ''}`} onClick={() => setCustom(c.name)}>▶ {c.name}</button>)}</div>
        )}
      </div>
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
