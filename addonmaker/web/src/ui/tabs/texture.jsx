// Pixel painter for entity textures (with skin variants and a UV overlay).
import { useEffect, useRef, useState } from 'preact/hooks';
import { Card, Btn, Icon, Select, Toggle, Row, confirmDialog } from '../common.jsx';
import { Preview3D } from '../preview3d.jsx';
import { ecommit } from '../screens/entity.jsx';
import { autoTextureURL, loadImage } from '../textures.js';
import { faceRects } from '../../core/geo.js';
import { uid, hexToRgb, rgbToHex, base64ToBytes } from '../../core/util.js';
import { toast } from '../store.js';
import { pickFile, readAsDataURL, saveFile } from '../native.js';

const PALETTE = ['#000000', '#3b3b3b', '#7a7a7a', '#bdbdbd', '#ffffff', '#5c3a21', '#8a5a3c', '#c98f5e', '#f0d2b0', '#e0ac86',
  '#7f1d1d', '#dc2626', '#f97316', '#f59e0b', '#facc15', '#365314', '#65a30d', '#4ade80', '#0f766e', '#2dd4bf',
  '#1e3a8a', '#3b82f6', '#7dd3fc', '#4c1d95', '#a78bfa', '#be185d', '#f472b6'];
const TOOLS = [['pen', 'brush', 'Pencil'], ['erase', 'eraser', 'Eraser'], ['fill', 'fill', 'Fill'], ['pick', 'picker', 'Pick colour'], ['shade', 'sun', 'Shade (lighten/darken)']];

export function TextureTab({ e, p }) {
  const [idx, setIdx] = useState(0);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#dc2626');
  const [size, setSize] = useState(1);
  const [zoom, setZoom] = useState(() => Math.max(3, Math.floor(Math.min(window.innerWidth - 40, 720) / e.model.texW)));
  const [overlay, setOverlay] = useState(true);
  const [darken, setDarken] = useState(true);
  const cvs = useRef(null), ov = useRef(null);
  const hist = useRef({ undo: [], redo: [] });
  const drawing = useRef(false);
  const W = e.model.texW, H = e.model.texH;
  const painted = e.textures?.length > 0;
  const tex = e.textures?.[Math.min(idx, (e.textures?.length || 1) - 1)];
  const srcURL = tex ? tex.data : autoTextureURL(e);

  // Load the current texture into the canvas.
  useEffect(() => {
    const c = cvs.current;
    if (!c) return;
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    loadImage(srcURL).then((img) => { g.clearRect(0, 0, W, H); g.drawImage(img, 0, 0); }).catch(() => {});
  }, [srcURL, W, H]);

  // UV overlay.
  useEffect(() => {
    const o = ov.current;
    if (!o) return;
    o.width = W * zoom; o.height = H * zoom;
    const g = o.getContext('2d');
    g.clearRect(0, 0, o.width, o.height);
    if (!overlay) return;
    g.lineWidth = 1;
    const COL = { north: '#22d3ee', south: '#a78bfa', east: '#f59e0b', west: '#f59e0b', up: '#4ade80', down: '#f87171' };
    for (const b of e.model.bones) for (const cu of b.cubes) {
      for (const [face, r] of Object.entries(faceRects(cu))) {
        if (r.w <= 0 || r.h <= 0) continue;
        g.strokeStyle = COL[face];
        g.globalAlpha = 0.85;
        g.strokeRect(r.x * zoom + 0.5, r.y * zoom + 0.5, r.w * zoom - 1, r.h * zoom - 1);
        if (face === 'north' && r.w * zoom > 30) { g.fillStyle = COL[face]; g.font = `${Math.max(9, Math.min(12, zoom * 2))}px sans-serif`; g.fillText(`${b.name} front`, r.x * zoom + 3, r.y * zoom + 12); }
      }
    }
  }, [overlay, zoom, W, H, JSON.stringify(e.model.bones)]);

  const ensurePainted = () => {
    if (painted) return true;
    toast('Tap “Start painting” first', 'info');
    return false;
  };
  const commitCanvas = () => {
    const data = cvs.current.toDataURL('image/png');
    const i = Math.min(idx, (e.textures?.length || 1) - 1);
    ecommit(e, (en) => { if (en.textures[i]) en.textures[i].data = data; });
  };
  const pushHist = () => {
    const g = cvs.current.getContext('2d');
    hist.current.undo.push(g.getImageData(0, 0, W, H));
    if (hist.current.undo.length > 40) hist.current.undo.shift();
    hist.current.redo = [];
  };
  const pos = (ev) => {
    const r = cvs.current.getBoundingClientRect();
    return [Math.floor(((ev.clientX - r.left) / r.width) * W), Math.floor(((ev.clientY - r.top) / r.height) * H)];
  };
  const apply = (x, y) => {
    const g = cvs.current.getContext('2d');
    if (tool === 'pick') {
      const d = g.getImageData(x, y, 1, 1).data;
      if (d[3] > 0) setColor(rgbToHex(d[0], d[1], d[2]));
      setTool('pen');
      return;
    }
    if (tool === 'fill') return flood(g, x, y, hexToRgb(color));
    const half = Math.floor((size - 1) / 2);
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      const px = x - half + dx, py = y - half + dy;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      if (tool === 'erase') g.clearRect(px, py, 1, 1);
      else if (tool === 'shade') {
        const d = g.getImageData(px, py, 1, 1).data;
        if (!d[3]) continue;
        const f = darken ? 0.88 : 1.12;
        g.fillStyle = `rgba(${Math.min(255, d[0] * f)},${Math.min(255, d[1] * f)},${Math.min(255, d[2] * f)},${d[3] / 255})`;
        g.clearRect(px, py, 1, 1); g.fillRect(px, py, 1, 1);
      } else { g.fillStyle = color; g.fillRect(px, py, 1, 1); }
    }
  };
  const flood = (g, x, y, [r, gg, b]) => {
    const img = g.getImageData(0, 0, W, H), d = img.data;
    const i0 = (y * W + x) * 4;
    const t = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
    if (t[0] === r && t[1] === gg && t[2] === b && t[3] === 255) return;
    const st = [[x, y]];
    while (st.length) {
      const [cx, cy] = st.pop();
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const i = (cy * W + cx) * 4;
      if (d[i] !== t[0] || d[i + 1] !== t[1] || d[i + 2] !== t[2] || d[i + 3] !== t[3]) continue;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
      st.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    g.putImageData(img, 0, 0);
  };
  const lastPt = useRef(null);
  const onDown = (ev) => {
    if (!ensurePainted()) return;
    ev.preventDefault();
    cvs.current.setPointerCapture?.(ev.pointerId);
    pushHist();
    drawing.current = true;
    const [x, y] = pos(ev);
    lastPt.current = [x, y];
    apply(x, y);
    if (tool === 'fill' || tool === 'pick') { drawing.current = false; if (tool === 'fill') commitCanvas(); }
  };
  const onMove = (ev) => {
    if (!drawing.current) return;
    const [x, y] = pos(ev);
    const [lx, ly] = lastPt.current;
    const n = Math.max(Math.abs(x - lx), Math.abs(y - ly));
    for (let i = 1; i <= n; i++) apply(Math.round(lx + ((x - lx) * i) / n), Math.round(ly + ((y - ly) * i) / n));
    lastPt.current = [x, y];
  };
  const onUp = () => { if (drawing.current) { drawing.current = false; commitCanvas(); } };
  const undoPaint = () => {
    const h = hist.current; if (!h.undo.length) return;
    const g = cvs.current.getContext('2d');
    h.redo.push(g.getImageData(0, 0, W, H));
    g.putImageData(h.undo.pop(), 0, 0); commitCanvas();
  };
  const redoPaint = () => {
    const h = hist.current; if (!h.redo.length) return;
    const g = cvs.current.getContext('2d');
    h.undo.push(g.getImageData(0, 0, W, H));
    g.putImageData(h.redo.pop(), 0, 0); commitCanvas();
  };
  const startPainting = () => ecommit(e, (en) => { en.textures = [{ uid: uid(), name: 'default', data: autoTextureURL(en) }]; });
  const importPng = async () => {
    const f = await pickFile('image/png');
    if (!f) return;
    const data = await readAsDataURL(f);
    const img = await loadImage(data);
    if (img.width !== W || img.height !== H) toast(`Image is ${img.width}×${img.height}; the model expects ${W}×${H}. It will be stretched in game.`, 'info', 5000);
    ecommit(e, (en) => {
      if (!en.textures.length) en.textures.push({ uid: uid(), name: 'default', data });
      else en.textures[Math.min(idx, en.textures.length - 1)].data = data;
    });
  };
  return (
    <div class="tab-texture">
      {!painted ? (
        <Card title="Auto-painted texture" sub="Generated from the bone colours in the Model tab. Paint over it to make it yours.">
          <div class="inline wrap">
            <Btn kind="primary" icon="brush" onClick={startPainting}>Start painting</Btn>
            <Btn icon="upload" onClick={importPng}>Import PNG</Btn>
          </div>
        </Card>
      ) : (
        <Card title="Skins" sub={e.textures.length > 1 ? 'Variant skins: the game picks one using the selector below' : 'Add more skins to get random variants'}>
          <div class="inline wrap">
            {e.textures.map((t, i) => <button type="button" class={`cchip ${i === idx ? 'on' : ''}`} onClick={() => setIdx(i)}>{i === 0 ? 'Default' : `Skin ${i + 1}`}</button>)}
            <Btn small icon="plus" onClick={() => ecommit(e, (en) => { en.textures.push({ uid: uid(), name: `v${en.textures.length}`, data: cvs.current.toDataURL('image/png') }); setIdx(e.textures.length); })}>Add skin</Btn>
            {e.textures.length > 1 && <Btn small kind="ghost" icon="trash" onClick={() => ecommit(e, (en) => { en.textures.splice(idx, 1); setIdx(0); })}>Delete skin</Btn>}
          </div>
          {e.textures.length > 1 && (
            <Row label="Picked by" hint="Set this number with events (e.g. randomize on spawn)">
              <Select value={e.textureSelector || 'variant'} options={[['variant', 'minecraft:variant'], ['mark_variant', 'minecraft:mark_variant'], ['skin_id', 'minecraft:skin_id']]} onChange={(v) => ecommit(e, (en) => { en.textureSelector = v; })} />
            </Row>
          )}
          {e.textures.length > 1 && <Btn small onClick={() => ecommit(e, (en) => {
            const comp = `minecraft:${en.textureSelector || 'variant'}`;
            const groups = en.textures.map((_, i) => `${p.namespace}:skin_${i}`);
            for (const [i, gname] of groups.entries()) {
              const full = `${gname}`;
              if (!en.groups.some((g) => g.name === full)) en.groups.push({ uid: uid(), name: full, components: { [comp]: { value: i } } });
            }
            let sp = en.events.find((x) => x.name === 'minecraft:entity_spawned');
            if (!sp) { sp = { uid: uid(), name: 'minecraft:entity_spawned', action: {} }; en.events.push(sp); }
            const rnd = { randomize: groups.map((g) => ({ weight: 1, add: { component_groups: [g] } })) };
            if (Object.keys(sp.action).length) sp.action = { sequence: [sp.action, rnd] }; else sp.action = rnd;
            toast('Added skin groups and a random pick on spawn', 'ok');
          })}>Random skin on spawn (auto-setup)</Btn>}
        </Card>
      )}

      <div class="painter-tools">
        {TOOLS.map(([k, ic, l]) => <button type="button" class={`tool ${tool === k ? 'on' : ''}`} title={l} aria-label={l} onClick={() => setTool(k)}><Icon name={ic} /></button>)}
        <input type="color" value={color} aria-label="Colour" onInput={(ev) => setColor(ev.currentTarget.value)} />
        <Select value={String(size)} options={[['1', '1px'], ['2', '2px'], ['3', '3px'], ['4', '4px']]} onChange={(v) => setSize(Number(v))} />
        {tool === 'shade' && <button type="button" class="cchip on" onClick={() => setDarken(!darken)}>{darken ? 'Darken' : 'Lighten'}</button>}
        <span class="grow" />
        <Btn small kind="ghost" icon="undo" aria-label="Undo stroke" onClick={undoPaint} />
        <Btn small kind="ghost" icon="redo" aria-label="Redo stroke" onClick={redoPaint} />
      </div>
      <div class="palette">{PALETTE.map((c) => <button type="button" class={`sw ${c === color ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => { setColor(c); if (tool === 'erase' || tool === 'pick') setTool('pen'); }} />)}</div>
      <div class="canvas-wrap">
        <div class="canvas-stack" style={{ width: W * zoom, height: H * zoom }}>
          <canvas ref={cvs} class="paint" style={{ width: W * zoom, height: H * zoom }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
          <canvas ref={ov} class="uv-ov" style={{ width: W * zoom, height: H * zoom }} />
        </div>
      </div>
      <div class="inline wrap">
        <label class="inline"><span class="hint">Zoom</span><input type="range" min="2" max="24" value={zoom} onInput={(ev) => setZoom(Number(ev.currentTarget.value))} /></label>
        <Toggle label="UV guides" value={overlay} onChange={setOverlay} />
      </div>
      <div class="inline wrap">
        {painted && <Btn small icon="upload" onClick={importPng}>Import PNG</Btn>}
        <Btn small icon="save" onClick={() => saveFile(`${e.name}${idx ? `_v${idx}` : ''}.png`, base64ToBytes(cvs.current.toDataURL('image/png')), 'image/png')}>Export PNG</Btn>
        {painted && <Btn small kind="ghost" icon="wand" onClick={() => confirmDialog('Back to auto-paint?', 'Remove your painted skins and use the generated texture again?', 'Reset', () => ecommit(e, (en) => { en.textures = []; setIdx(0); }))}>Reset to auto-paint</Btn>}
      </div>
      <p class="hint">Guides: <span style={{ color: '#22d3ee' }}>front</span>, <span style={{ color: '#a78bfa' }}>back</span>, <span style={{ color: '#f59e0b' }}>sides</span>, <span style={{ color: '#4ade80' }}>top</span>, <span style={{ color: '#f87171' }}>bottom</span>.</p>
      <Preview3D entity={e} mode="idle" height={220} texIdx={idx} />
    </div>
  );
}
