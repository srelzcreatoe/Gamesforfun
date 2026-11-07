import { useState } from 'preact/hooks';
import { Card, Btn, Row, TextInput, Select, NumInput, Toggle, Collapse, confirmDialog } from '../common.jsx';
import { Preview3D } from '../preview3d.jsx';
import { ModeChips } from './overview.jsx';
import { ecommit } from '../screens/entity.jsx';
import { TEMPLATES, makeModel, packUVs, modelFromGeometry, geometryJSON } from '../../core/geo.js';
import { defaultAnims } from '../../core/anim.js';
import { uid, clone, parseLenientJSON } from '../../core/util.js';
import { toast } from '../store.js';
import { pickFile, readAsText, readAsDataURL, saveFile } from '../native.js';
import { eyesGlow, EMISSIVE_MATERIAL } from '../../core/paint.js';

const EYE_STYLES = [['normal', 'Friendly'], ['glow', 'Glowing'], ['rect', 'Glowing slits + drips'], ['hollow', 'Hollow sockets'], ['sunken', 'Sunken + pinprick pupils'], ['many', 'Many eyes'], ['single', 'One big eye'], ['button', 'Buttons'], ['none', 'No eyes']];
const MOUTHS = [['none', 'None'], ['line', 'Thin line'], ['grin', 'Toothy grin'], ['bigGrin', 'Huge jagged grin'], ['stitched', 'Stitched shut'], ['gape', 'Gaping hole']];
import { geoId } from '../../core/packgen.js';

const ROLES = [['none', '—'], ['head', 'Head (looks at target)'], ['body', 'Body'], ['armR', 'Right arm'], ['armL', 'Left arm'], ['legR', 'Right leg'], ['legL', 'Left leg'],
  ['legFR', 'Front-right leg'], ['legFL', 'Front-left leg'], ['legBR', 'Back-right leg'], ['legBL', 'Back-left leg'], ['wingL', 'Left wing'], ['wingR', 'Right wing'], ['tail', 'Tail'], ['finL', 'Left fin'], ['finR', 'Right fin'], ['item', 'Held item anchor']];
const PATTERNS = [['none', 'Plain'], ['spots', 'Spots'], ['stripes', 'Stripes'], ['gradient', 'Gradient'], ['cracks', 'Cracks'], ['grime', 'Grime']];

function V3({ value, onChange, step }) {
  return (
    <div class="vec">
      {['x', 'y', 'z'].map((ax, i) => <label><span>{ax}</span><NumInput value={value[i]} onChange={(v) => { const c = [...value]; c[i] = v; onChange(c); }} /></label>)}
    </div>
  );
}

export function ModelTab({ e, p }) {
  const [mode, setMode] = useState('walk');
  const m = e.model;
  const bm = (bone, fn, key) => ecommit(e, (en) => fn(en.model.bones.find((b) => b.uid === bone.uid), en), key);
  const painted = e.textures?.length > 0;
  const changeTemplate = (t) => {
    const go = () => ecommit(e, (en) => {
      en.model = makeModel(t);
      en.textures = [];
      en.anims = { ...defaultAnims(t), custom: en.anims?.custom || [] };
      const col = TEMPLATES[t].collision;
      en.components['minecraft:collision_box'] = { width: col[0], height: col[1] };
    });
    confirmDialog('Replace the model?', `Switch to the ${TEMPLATES[t].label} template? Your current bones${painted ? ' and painted texture layout' : ''} will be replaced (you can undo).`, 'Replace', go, false);
  };
  /** Updates auto-paint options; glowing eyes switch the material to emissive. */
  const setPaint = (o, key) => ecommit(e, (en) => {
    en.autoPaint = { ...(en.autoPaint || {}), ...o };
    const glow = eyesGlow(en.autoPaint);
    if (glow) en.model.material = EMISSIVE_MATERIAL;
    else if (en.model.material === EMISSIVE_MATERIAL) en.model.material = 'entity_alphatest';
  }, key);
  const importOwn = async () => {
    const f = await pickFile('.json');
    if (!f) return;
    let model;
    try { model = modelFromGeometry(parseLenientJSON(await readAsText(f))); } catch (err) { toast('Could not read geometry: ' + err.message, 'error'); return; }
    ecommit(e, (en) => { en.model = model; en.textures = []; });
    confirmDialog('Add its texture?', `Model imported (${model.bones.length} bones). Pick the matching .png texture now? You can also do it later in the Texture tab.`, 'Pick PNG', async () => {
      const pf = await pickFile('image/png');
      if (!pf) return;
      const data = await readAsDataURL(pf);
      ecommit(e, (en) => { en.textures = [{ uid: uid(), name: 'default', data }]; });
      toast('Model and texture ready. Check each bone\'s Role below so the built-in animations move the right parts.', 'ok', 6000);
    }, false);
  };
  const importGeo = async () => {
    const f = await pickFile('.json');
    if (!f) return;
    try {
      const model = modelFromGeometry(parseLenientJSON(await readAsText(f)));
      ecommit(e, (en) => { en.model = model; });
      toast(`Imported ${model.bones.length} bones. Import the matching texture in the Texture tab.`, 'ok', 5000);
    } catch (err) { toast('Could not read geometry: ' + err.message, 'error'); }
  };
  return (
    <div class="tab-model">
      <div class="preview-wrap">
        <Preview3D entity={e} mode={mode} height={300} />
        <ModeChips mode={mode} setMode={setMode} entity={e} />
      </div>
      <Card title="Use your own model" icon="⬆" sub="From Blockbench or any Bedrock model maker">
        <p class="hint">Import a <code>.geo.json</code> and its <code>.png</code>. Then set each bone's Role (below) so walking, attacking and the dweller moves work, or upload your own animations in the Animations tab.</p>
        <Btn icon="upload" kind="primary" onClick={importOwn}>Import model + texture</Btn>
      </Card>
      <Card title="Body template">
        <div class="tpl-grid">
          {Object.entries(TEMPLATES).map(([k, t]) => (
            <button type="button" class={`tpl ${m.template === k ? 'on' : ''}`} onClick={() => k !== m.template && changeTemplate(k)}>
              <strong>{t.label}</strong><span class="hint">{t.hint}</span>
            </button>
          ))}
        </div>
        <div class="inline wrap">
          <Btn small icon="upload" onClick={importGeo}>Import .geo.json</Btn>
          <Btn small icon="save" onClick={() => saveFile(`${e.name}.geo.json`, new TextEncoder().encode(JSON.stringify(geometryJSON(m, geoId(p, e)), null, 2)), 'application/json')}>Export .geo.json</Btn>
        </div>
      </Card>
      <Card title="Texture layout & look">
        <Toggle label="Auto UV layout" hint="Packs every cube onto the texture automatically" value={m.autoUv} onChange={(v) => ecommit(e, (en) => { en.model.autoUv = v; if (v) packUVs(en.model); })} />
        <Row label="Texture size"><span class="mono">{m.texW} × {m.texH}</span></Row>
        {!m.autoUv && (
          <Row label="Set size"><div class="vec">
            <label><span>w</span><NumInput int min={8} value={m.texW} onChange={(v) => ecommit(e, (en) => { en.model.texW = v; }, 'm:tw')} /></label>
            <label><span>h</span><NumInput int min={8} value={m.texH} onChange={(v) => ecommit(e, (en) => { en.model.texH = v; }, 'm:th')} /></label>
          </div></Row>
        )}
        <Row label="Material"><Select value={m.material} options={[['entity_alphatest', 'Cut-out (transparent pixels)'], ['entity', 'Solid'], ['entity_alphablend', 'See-through (blended)'], ['entity_emissive', 'Glowing'], ['entity_emissive_alpha', 'Glowing + cut-out']]} onChange={(v) => ecommit(e, (en) => { en.model.material = v; })} /></Row>
        <Row label="Auto-paint noise"><input type="range" min="0" max="0.3" step="0.01" value={e.autoPaint?.noise ?? 0.07} onInput={(ev) => { const v = Number(ev.currentTarget.value); ecommit(e, (en) => { en.autoPaint = { ...(en.autoPaint || {}), noise: v }; }, 'm:noise'); }} /></Row>
        <Toggle label="Outlines on faces" value={e.autoPaint?.outline !== false} onChange={(v) => ecommit(e, (en) => { en.autoPaint = { ...(en.autoPaint || {}), outline: v }; })} />
        <Toggle label="Draw eyes on the head" value={e.autoPaint?.eyes !== false} onChange={(v) => ecommit(e, (en) => { en.autoPaint = { ...(en.autoPaint || {}), eyes: v }; })} />
        {e.autoPaint?.eyes !== false && <>
          <Row label="Eye style"><Select value={e.autoPaint?.eyeStyle || 'normal'} options={EYE_STYLES} onChange={(v) => setPaint({ eyeStyle: v })} /></Row>
          {(e.autoPaint?.eyeStyle || 'normal') !== 'normal' && <>
            <Row label="Eye colour"><input type="color" value={e.autoPaint?.eyeColor || '#ff2a2a'} aria-label="Eye colour" onInput={(ev) => setPaint({ eyeColor: ev.currentTarget.value }, 'm:eyec')} /></Row>
            <Row label="Mouth"><Select value={e.autoPaint?.mouth || 'line'} options={MOUTHS} onChange={(v) => setPaint({ mouth: v })} /></Row>
            {['bigGrin', 'grin'].includes(e.autoPaint?.mouth) && <Row label="Teeth colour"><input type="color" value={e.autoPaint?.toothColor || '#efe4bf'} aria-label="Teeth colour" onInput={(ev) => setPaint({ toothColor: ev.currentTarget.value }, 'm:tooth')} /></Row>}
            <Row label="Face colour" hint="Tints the face around the eyes and mouth">
              <div class="inline"><input type="color" value={e.autoPaint?.faceColor || '#5c0f12'} aria-label="Face colour" onInput={(ev) => setPaint({ faceColor: ev.currentTarget.value }, 'm:face')} />
                {e.autoPaint?.faceColor && <Btn small kind="ghost" onClick={() => setPaint({ faceColor: null })}>None</Btn>}</div>
            </Row>
            {eyesGlow({ ...e.autoPaint, eyeStyle: e.autoPaint?.eyeStyle, glowEyes: true }) && <Toggle label="Eyes glow in the dark" hint="Uses the game's emissive material, like enderman eyes" value={eyesGlow(e.autoPaint || {})} onChange={(v) => setPaint({ glowEyes: v })} />}
          </>}
        </>}
        {painted && <p class="hint">You painted a custom texture, so bone colours below only matter if you go back to auto-paint (Texture tab).</p>}
      </Card>
      <Card title={`Bones (${m.bones.length})`} sub="Bones are the moving parts. Cubes are the boxes inside them (units: pixels, 16 = one block).">
        {m.bones.map((b) => (
          <Collapse key={b.uid} title={b.name} sub={`${ROLES.find((r) => r[0] === b.role)?.[1] || b.role}${b.parent ? ` · in ${b.parent}` : ''} · ${b.cubes.length} cube${b.cubes.length === 1 ? '' : 's'}`}
            right={<><input type="color" value={b.color} aria-label={`${b.name} colour`} onInput={(ev) => { const v = ev.currentTarget.value; bm(b, (bb) => { bb.color = v; }, `m:c:${b.uid}`); }} />
              <Btn small kind="ghost" icon="trash" aria-label="Delete bone" onClick={() => ecommit(e, (en) => { en.model.bones = en.model.bones.filter((x) => x.uid !== b.uid); en.model.bones.forEach((x) => { if (x.parent === b.name) x.parent = b.parent; }); })} /></>}>
            <Row label="Name"><TextInput value={b.name} mono onChange={(v) => ecommit(e, (en) => {
              const bb = en.model.bones.find((x) => x.uid === b.uid);
              const old = bb.name; bb.name = v;
              en.model.bones.forEach((x) => { if (x.parent === old) x.parent = v; });
              for (const ca of en.anims?.custom || []) for (const ch of ca.channels || []) if (ch.bone === old) ch.bone = v;
            }, `m:n:${b.uid}`)} /></Row>
            <Row label="Role" hint="Drives the automatic animations"><Select value={b.role} options={ROLES} onChange={(v) => bm(b, (bb) => { bb.role = v; })} /></Row>
            <Row label="Parent"><Select value={b.parent || ''} options={[['', '(root)'], ...m.bones.filter((x) => x.uid !== b.uid).map((x) => [x.name, x.name])]} onChange={(v) => bm(b, (bb) => { bb.parent = v; })} /></Row>
            <Row label="Pivot" hint="Rotation point"><V3 value={b.pivot} onChange={(v) => bm(b, (bb) => { bb.pivot = v; }, `m:pv:${b.uid}`)} /></Row>
            <Row label="Rotation°"><V3 value={b.rotation || [0, 0, 0]} onChange={(v) => bm(b, (bb) => { bb.rotation = v; }, `m:rt:${b.uid}`)} /></Row>
            <Row label="Pattern"><div class="inline"><Select value={b.pattern || 'none'} options={PATTERNS} onChange={(v) => bm(b, (bb) => { bb.pattern = v; })} />
              {b.pattern && b.pattern !== 'none' && <input type="color" value={b.color2 || '#ffffff'} aria-label="Pattern colour" onInput={(ev) => { const v = ev.currentTarget.value; bm(b, (bb) => { bb.color2 = v; }, `m:c2:${b.uid}`); }} />}</div></Row>
            {b.cubes.map((c, ci) => (
              <div class="cube">
                <div class="cube-h"><strong>Cube {ci + 1}</strong><span class="grow" />
                  <Btn small kind="ghost" icon="copy" aria-label="Duplicate cube" onClick={() => bm(b, (bb) => { bb.cubes.splice(ci + 1, 0, { ...clone(c), uid: uid() }); })} />
                  <Btn small kind="ghost" icon="trash" aria-label="Delete cube" onClick={() => bm(b, (bb) => { bb.cubes.splice(ci, 1); })} /></div>
                <Row label="Origin" hint="Lowest corner"><V3 value={c.origin} onChange={(v) => bm(b, (bb) => { bb.cubes[ci].origin = v; }, `m:o:${c.uid}`)} /></Row>
                <Row label="Size"><V3 value={c.size} onChange={(v) => bm(b, (bb) => { bb.cubes[ci].size = v.map((x) => Math.max(0, x)); }, `m:s:${c.uid}`)} /></Row>
                <Row label="Inflate"><NumInput value={c.inflate || 0} onChange={(v) => bm(b, (bb) => { bb.cubes[ci].inflate = v; }, `m:i:${c.uid}`)} /></Row>
                <Toggle label="Mirror texture" value={c.mirror} onChange={(v) => bm(b, (bb) => { bb.cubes[ci].mirror = v; })} />
                {!m.autoUv && <Row label="UV offset"><div class="vec">
                  <label><span>u</span><NumInput value={c.uv[0]} onChange={(v) => bm(b, (bb) => { bb.cubes[ci].uv = [v, bb.cubes[ci].uv[1]]; }, `m:u:${c.uid}`)} /></label>
                  <label><span>v</span><NumInput value={c.uv[1]} onChange={(v) => bm(b, (bb) => { bb.cubes[ci].uv = [bb.cubes[ci].uv[0], v]; }, `m:u:${c.uid}`)} /></label>
                </div></Row>}
              </div>
            ))}
            <Btn small icon="plus" onClick={() => bm(b, (bb) => { const pv = bb.pivot; bb.cubes.push({ uid: uid(), origin: [pv[0] - 2, pv[1] - 2, pv[2] - 2], size: [4, 4, 4], uv: [0, 0], inflate: 0, mirror: false }); })}>Add cube</Btn>
          </Collapse>
        ))}
        <Btn icon="plus" kind="primary" onClick={() => ecommit(e, (en) => {
          let n = 'bone', i = 2;
          while (en.model.bones.some((x) => x.name === n)) n = `bone${i++}`;
          en.model.bones.push({ uid: uid(), name: n, role: 'none', parent: en.model.bones.find((x) => x.role === 'body')?.name || '', pivot: [0, 8, 0], rotation: [0, 0, 0], color: '#9ca3af', pattern: 'none', color2: '#ffffff', cubes: [{ uid: uid(), origin: [-2, 6, -2], size: [4, 4, 4], uv: [0, 0], inflate: 0, mirror: false }] });
        })}>Add bone</Btn>
      </Card>
    </div>
  );
}
