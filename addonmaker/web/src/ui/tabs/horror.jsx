// Dweller settings: simple cards for look, stalking style, where it lives,
// when it shows up and strength; everything else folds away. The node board
// edits the same settings with drag-and-drop blocks.
import { useState, useEffect } from 'preact/hooks';
import { Card, Btn, Toggle, Row, Select, TextInput, Collapse, confirmDialog } from '../common.jsx';
import { ecommit } from '../screens/entity.jsx';
import { ARCHETYPES, SEEN_REACTIONS, AFTER_HUNT, DWELLER_TYPES, DWELLER_TIMES, hEvent, hProp, directorObjective, dwellerSpawn } from '../../core/horror.js';
import { DWELLER_PRESETS, applyDwellerLook, dwellerFromPreset } from '../../core/dwellers.js';
import { setTab, toast, openModal, closeModal } from '../store.js';
import { copyText } from '../native.js';
import { Slider, AppearanceEditor, appearSummary } from '../screens/wizard.jsx';
import { SoundPicker } from '../audio.jsx';
import { renderFrontSprite } from '../textures.js';

const Slide = Slider;

const NODE = {
  dormant: [62, 70, 'Dormant', 'wanders'],
  stalking: [210, 70, 'Stalking', 'keeps its distance'],
  hunting: [358, 70, 'Hunting', 'chases & attacks'],
  gone: [62, 178, 'Gone', 'despawned'],
  fleeing: [210, 178, 'Fleeing', 'runs, then returns'],
  frozen: [358, 178, 'Frozen', 'while watched'],
};
const NW = 54, NH = 20;

function clip(cx, cy, tx, ty) {
  const dx = tx - cx, dy = ty - cy;
  const t = Math.min(dx ? NW / Math.abs(dx) : Infinity, dy ? NH / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

function StateDiagram({ h }) {
  const se = h.senses, st = h.stalk, hu = h.hunt;
  const on = new Set(['dormant', 'hunting']);
  if (st.on) on.add('stalking');
  if (se.seen === 'flee' || se.seen === 'teleport') on.add('fleeing');
  if (se.seen === 'freeze') on.add('frozen');
  if (se.seen === 'vanish' || hu.after === 'vanish' || h.weakness.sunlight === 'vanish') on.add('gone');
  const edges = [];
  const huntFrom = st.on ? 'stalking' : 'dormant';
  if (st.on) edges.push(['dormant', 'stalking', 'notices you', -1]);
  const why = [!st.on && 'notices you', hu.onClose && `≤${hu.close} blocks`, st.on && st.huntAfter > 0 && `~${st.huntAfter}s`, hu.onHurt && 'hurt', se.seen === 'charge' && 'seen'].filter(Boolean).join(' · ');
  edges.push([huntFrom, 'hunting', why, -1]);
  const back = hu.after === 'vanish' ? 'gone' : hu.after === 'dormant' || !st.on ? 'dormant' : 'stalking';
  edges.push(['hunting', back, `gives up (${hu.duration}s)`, 1]);
  if (se.seen === 'flee' || se.seen === 'teleport') { edges.push(['stalking', 'fleeing', se.seen === 'flee' ? 'seen' : 'seen → blinks', -1]); edges.push(['fleeing', 'stalking', 'regroups', 1]); }
  if (se.seen === 'freeze') { edges.push(['hunting', 'frozen', 'seen', -1]); edges.push(['frozen', 'hunting', 'unseen', 1]); }
  if (se.seen === 'vanish') edges.push([st.on ? 'stalking' : 'dormant', 'gone', 'seen', 0]);
  if (h.weakness.sunlight === 'vanish' && !(se.seen === 'vanish' && !st.on)) edges.push(['dormant', 'gone', 'sunlight', 0]);
  return (
    <svg class="diagram" viewBox="0 0 420 212" role="img" aria-label="Horror AI state diagram">
      <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" class="arr" /></marker></defs>
      {edges.map(([a, b, lbl, side]) => {
        const [x1, y1] = NODE[a], [x2, y2] = NODE[b];
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const sameRow = y1 === y2, vertical = x1 === x2;
        const span = Math.hypot(x2 - x1, y2 - y1);
        let cx = mx, cy = my;
        if (sameRow) cy = y1 + (side < 0 ? -1 : side > 0 ? 1 : 0) * (16 + span * 0.12);
        else if (vertical) cx = x1 + (side < 0 ? -24 : side > 0 ? 24 : 0);
        const [sx, sy] = clip(x1, y1, cx, cy), [ex, ey] = clip(x2, y2, cx, cy);
        const lx = (sx + 2 * cx + ex) / 4, ly = (sy + 2 * cy + ey) / 4;
        return (
          <g class="edge">
            <path d={`M${sx.toFixed(1)} ${sy.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`} marker-end="url(#arr)" />
            {lbl && <text x={vertical ? lx + (side < 0 ? -5 : 5) : lx} y={vertical ? ly + 3 : sameRow ? ly + (side > 0 ? 12 : -5) : ly - 5} text-anchor={vertical ? (side < 0 ? 'end' : 'start') : 'middle'}>{lbl}</text>}
          </g>
        );
      })}
      {Object.entries(NODE).filter(([k]) => on.has(k)).map(([k, [x, y, l, sub]]) => (
        <g class={`node ${k}`}>
          <rect x={x - NW} y={y - NH} width={NW * 2} height={NH * 2} rx="10" />
          <text x={x} y={y - 2} text-anchor="middle" class="nl">{l}</text>
          <text x={x} y={y + 12} text-anchor="middle" class="ns">{sub}</text>
        </g>
      ))}
    </svg>
  );
}


const sprites = new Map();
function PresetSprite({ id }) {
  const [url, setUrl] = useState(sprites.get(id) || null);
  useEffect(() => {
    if (sprites.has(id)) return undefined;
    let alive = true;
    renderFrontSprite(dwellerFromPreset({ namespace: 'x' }, id), 96).then((u) => { sprites.set(id, u); if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);
  return url ? <img src={url} alt="" /> : <span />;
}

function openLookPicker(e) {
  function Body() {
    return (
      <div class="stack">
        <p class="hint">Changes only how it looks (model, colours, face and body animations). Its behaviour, timing and sounds stay the same.</p>
        <div class="pgrid">
          {DWELLER_PRESETS.map((d) => (
            <div class={`pcard ${e.preset === d.id ? 'sel' : ''} ${d.signature ? 'sig' : ''}`} role="button" tabIndex={0} onClick={() => {
              closeModal();
              ecommit(e, (en) => { applyDwellerLook(en, d.id); en.preset = d.id; });
              toast(`Now looks like the ${d.label}`, 'ok');
            }}>
              <div class="pcard-label">{d.label}</div>
              <div class="pcard-art"><PresetSprite id={d.id} /></div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  openModal({ title: 'Change look', body: Body, wide: true });
}

export function HorrorPanel({ e, p }) {
  const h = e.horror;
  const set = (fn, key) => ecommit(e, (en) => fn(en.horror, en), key);
  const scare = (fn, key) => set((x) => { fn(x); x.moments = null; }, key);
  if (!h.enabled) {
    return (
      <Card title="Horror dweller" icon="👁" sub="A mob that stalks, watches and hunts players, and shows up on its own">
        <p>Turn this mob into a dweller to give it a stalking style, a home (underground, surface or both) and an appearance timer.</p>
        <div class="actions" style={{ justifyContent: 'flex-start' }}>
          <Btn kind="primary" icon="wand" onClick={() => set((x, en) => { x.enabled = true; en.spawnCategory = 'monster'; })}>Make it a dweller</Btn>
        </div>
      </Card>
    );
  }
  const se = h.senses, st = h.stalk, hu = h.hunt, sc = h.scares, tr = h.traits, wk = h.weakness, ap = h.appear;
  const A = ARCHETYPES[h.archetype] || ARCHETYPES.stalker;
  const id = `${p.namespace}:${e.name}`;
  const hp = Number(e.components['minecraft:health']?.value) || 20;
  const speed = Number(e.components['minecraft:movement']?.value) || 0.3;
  const cmds = [
    ['Summon one 6 blocks in front of you', `/summon ${id} ^ ^ ^6`],
    ['Test an arrival (like the timer does)', `/summon ${id} ^ ^ ^-16 ~ ~ ${hEvent(p.namespace, 'arrive')}`],
    ap.director && ['Roll the appearance timer now', `/scoreboard players set @s ${directorObjective(p.namespace, e.name)} 100000`],
    ['Make it hunt you now', `/event entity @e[type=${id}] ${hEvent(p.namespace, 'hunt')}`],
    ['Calm it down', `/event entity @e[type=${id}] ${hEvent(p.namespace, 'lose')}`],
    ['Make it night', '/time set midnight'],
    ['Remove them all', `/kill @e[type=${id}]`],
  ].filter(Boolean);
  return (
    <div class="tab-horror">
      <Card title={e.displayName || e.name} icon={A.icon} sub={`${A.label} · ${DWELLER_TYPES.find((t) => t[0] === h.type)?.[1]}${h.type !== 'underground' ? ` · ${h.time === 'night' ? 'night only' : 'day and night'}` : ''}`}>
        <p class="summary">📅 {appearSummary(ap, h.type, h.time, e.limit)}</p>
        <div class="actions wrap" style={{ justifyContent: 'flex-start' }}>
          <Btn kind="primary" icon="nodes" onClick={() => setTab('board')}>Node board</Btn>
          <Btn icon="brush" onClick={() => openLookPicker(e)}>Change look</Btn>
          <Btn kind="ghost" onClick={() => confirmDialog('Stop being a dweller?', 'It keeps its look but stops stalking and appearing on its own. You can turn it back on any time.', 'Turn off', () => set((x) => { x.enabled = false; }))}>Turn off</Btn>
        </div>
      </Card>

      <Card title="Stalking style" icon="🚶" sub="How it behaves around you">
        <div class="roles">
          {Object.entries(ARCHETYPES).map(([k, a]) => (
            <button type="button" class={`role ${h.archetype === k ? 'on' : ''}`} aria-pressed={h.archetype === k} onClick={() => set((x) => { x.archetype = k; ARCHETYPES[k].apply(x); x.moments = null; delete x.notice; if (x.time === 'always') x.weakness.sunlight = 'none'; })}>
              <span class="role-i">{a.icon}</span><strong>{a.label}</strong><span class="hint">{a.blurb}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Where it lives" icon="🌗">
        <div class="roles">
          {DWELLER_TYPES.map(([k, l, d, ic]) => (
            <button type="button" class={`role ${h.type === k ? 'on' : ''}`} aria-pressed={h.type === k} onClick={() => set((x, en) => { x.type = k; en.spawn = { ...(en.spawn || {}), conditions: dwellerSpawn(x) }; })}>
              <span class="role-i">{ic}</span><strong>{l}</strong><span class="hint">{d}</span>
            </button>
          ))}
        </div>
        {h.type !== 'underground' && (
          <div class="inline wrap">
            {DWELLER_TIMES.map(([k, l]) => <button type="button" class={`cchip ${h.time === k ? 'on' : ''}`} onClick={() => set((x) => { x.time = k; if (k === 'always' && x.weakness.sunlight === 'vanish') x.weakness.sunlight = 'none'; })}>{l}</button>)}
          </div>
        )}
      </Card>

      <Card title="When it shows up" icon="⏱" sub="The timer makes sure players actually meet it">
        <AppearanceEditor ap={ap} type={h.type} time={h.time} set={(o) => set((x) => { Object.assign(x.appear, o); }, `h:ap:${Object.keys(o).join()}`)}
          limit={e.limit} setLimit={(l) => ecommit(e, (en) => { en.limit = l; })} />
      </Card>

      <Card title="Strength" icon="❤">
        <Slide label="Health" value={hp} min={10} max={300} step={5} onChange={(v) => set((x, en) => { en.components['minecraft:health'] = { value: v, max: v }; }, 'h:hp')} />
        <Slide label="Damage per hit" value={hu.damage} min={1} max={40} onChange={(v) => set((x) => { x.hunt.damage = v; }, 'h:dmg')} />
        <Slide label="Walk speed" value={speed} min={0.1} max={0.7} step={0.01} onChange={(v) => set((x, en) => { en.components['minecraft:movement'] = { value: v }; }, 'h:spd')} />
        <Slide label="Chase speed" unit="×" step={0.05} value={hu.speed} min={0.8} max={3} onChange={(v) => set((x) => { x.hunt.speed = v; }, 'h:hs')} />
      </Card>

      <h2 class="sec">More settings</h2>
      <Collapse title="Senses & reactions" sub="How far it notices you and what it does when you look at it">
        <Slide label="Notices players within" unit=" blocks" value={se.detect} min={8} max={64} onChange={(v) => set((x) => { x.senses.detect = v; if (x.senses.lose < v + 8) x.senses.lose = v + 8; }, 'h:det')} />
        <Slide label="Loses track beyond" unit=" blocks" value={se.lose} min={se.detect + 8} max={160} onChange={(v) => set((x) => { x.senses.lose = v; }, 'h:lose')} />
        <Row label="When you look at it"><Select value={se.seen} options={SEEN_REACTIONS.map(([k, l]) => [k, l])} onChange={(v) => set((x) => { x.senses.seen = v; })} /></Row>
        <p class="hint">{SEEN_REACTIONS.find((r) => r[0] === se.seen)?.[2]}</p>
        {se.seen !== 'none' && <>
          <Slide label="Can tell you're looking from" unit=" blocks" value={se.seenRange} min={6} max={96} onChange={(v) => set((x) => { x.senses.seenRange = v; }, 'h:sr')} />
          <Slide label="Gaze cone" unit=" deg" hint="Smaller = you have to look right at it" value={se.fov} min={5} max={120} onChange={(v) => set((x) => { x.senses.fov = v; }, 'h:fov')} />
          <Slide label="Must be stared at for" unit="s" step={0.1} value={se.lookTime} min={0} max={3} onChange={(v) => set((x) => { x.senses.lookTime = v; }, 'h:lt')} />
          <Toggle label="Carved pumpkin hides you" hint="Players wearing one can look safely" value={se.pumpkinSafe} onChange={(v) => set((x) => { x.senses.pumpkinSafe = v; })} />
        </>}
      </Collapse>

      <Collapse title="Stalking & hunting" sub="Distance, triggers and how long it chases">
        <Toggle label="Stalks before it hunts" hint="Follows you at a distance and watches" value={st.on} onChange={(v) => set((x) => { x.stalk.on = v; delete x.notice; })} />
        {st.on && <>
          <Slide label="Keeps this far away" unit=" blocks" value={st.keep} min={3} max={40} onChange={(v) => set((x) => { x.stalk.keep = v; }, 'h:keep')} />
          <Slide label="Stalking speed" unit="×" step={0.05} value={st.speed} min={0.3} max={2} onChange={(v) => set((x) => { x.stalk.speed = v; }, 'h:ss')} />
          <Slide label="Starts hunting after about" unit={st.huntAfter ? 's' : ' (never)'} hint="0 = only the triggers below" value={st.huntAfter} min={0} max={300} step={5} onChange={(v) => set((x) => { x.stalk.huntAfter = v; }, 'h:ha')} />
        </>}
        <Toggle label="Hunts when you get too close" value={hu.onClose} onChange={(v) => set((x) => { x.hunt.onClose = v; })} />
        {hu.onClose && <Slide label="Too close means" unit=" blocks" value={hu.close} min={2} max={24} onChange={(v) => set((x) => { x.hunt.close = v; }, 'h:close')} />}
        <Toggle label="Hunts when you hit it" value={hu.onHurt} onChange={(v) => set((x) => { x.hunt.onHurt = v; })} />
        <Slide label="Gives up after" unit="s" value={hu.duration} min={5} max={120} onChange={(v) => set((x) => { x.hunt.duration = v; }, 'h:dur')} />
        <Row label="Then it…"><Select value={hu.after} options={AFTER_HUNT} onChange={(v) => set((x) => { x.hunt.after = v; })} /></Row>
        <Toggle label="Pounces" hint="Leaps at you" value={hu.leap} onChange={(v) => set((x) => { x.hunt.leap = v; })} />
      </Collapse>

      <Collapse title="Scares" sub="Sounds, messages and effects it plays to nearby players" badge={h.moments ? 'board' : null}>
        {h.moments && <p class="hint">These were wired on the node board. Changing a switch here goes back to the standard timing.</p>}
        <div class="checks">
          <Toggle label="Darkness pulse" value={sc.darkness} onChange={(v) => scare((x) => { x.scares.darkness = v; })} />
          <Toggle label="Heartbeat on notice" value={sc.heartbeat} onChange={(v) => scare((x) => { x.scares.heartbeat = v; })} />
          <Toggle label="Scream when hunting" value={sc.scream} onChange={(v) => scare((x) => { x.scares.scream = v; })} />
          <Toggle label="Camera shake" value={sc.shake} onChange={(v) => scare((x) => { x.scares.shake = v; })} />
          <Toggle label="Dread fog" value={sc.fog} onChange={(v) => scare((x) => { x.scares.fog = v; })} />
          <Toggle label="Particles" value={sc.particles} onChange={(v) => scare((x) => { x.scares.particles = v; })} />
          <Toggle label="On-screen messages" value={sc.messages} onChange={(v) => scare((x) => { x.scares.messages = v; })} />
        </div>
        {sc.scream && <Row label="Scream sound"><SoundPicker value={sc.screamSound} onChange={(v) => set((x) => { x.scares.screamSound = v; }, 'h:s1')} /></Row>}
        {sc.heartbeat && <Row label="Heartbeat sound"><SoundPicker value={sc.heartbeatSound} onChange={(v) => set((x) => { x.scares.heartbeatSound = v; }, 'h:s2')} /></Row>}
        {se.seen !== 'none' && <Row label="Sound when seen"><SoundPicker value={sc.seenSound} placeholder="none" onChange={(v) => scare((x) => { x.scares.seenSound = v; }, 'h:s3')} /></Row>}
        {sc.messages && <>
          <Row label="When it notices you"><TextInput value={sc.notice} placeholder="(nothing)" onChange={(v) => scare((x) => { x.scares.notice = v; }, 'h:m1')} /></Row>
          <Row label="When it hunts"><TextInput value={sc.huntMsg} placeholder="(nothing)" onChange={(v) => scare((x) => { x.scares.huntMsg = v; }, 'h:m2')} /></Row>
          {se.seen !== 'none' && <Row label="When you see it"><TextInput value={sc.seenMsg} placeholder="(nothing)" onChange={(v) => scare((x) => { x.scares.seenMsg = v; }, 'h:m3')} /></Row>}
        </>}
        {sc.fog && <>
          <Row label="Fog colour"><input type="color" value={sc.fogColor} aria-label="Fog colour" onInput={(ev) => { const v = ev.currentTarget.value; set((x) => { x.scares.fogColor = v; }, 'h:fc'); }} /></Row>
          <Slide label="You can see" unit=" blocks" value={sc.fogDistance} min={6} max={64} onChange={(v) => set((x) => { x.scares.fogDistance = v; }, 'h:fd')} />
        </>}
        <p class="hint">▶ previews your own uploaded sounds. Built-in game sounds play in game only.</p>
      </Collapse>

      <Collapse title="Traits & weaknesses">
        <Toggle label="Smashes torches & lanterns" hint="While hunting, light sources it touches break" value={tr.breakLights} onChange={(v) => set((x) => { x.traits.breakLights = v; })} />
        <Toggle label="Breaks down doors" value={tr.breakDoors} onChange={(v) => set((x) => { x.traits.breakDoors = v; })} />
        <Toggle label="Climbs walls" value={tr.climb} onChange={(v) => set((x) => { x.traits.climb = v; })} />
        <Toggle label="No fall damage" value={tr.noFall} onChange={(v) => set((x) => { x.traits.noFall = v; })} />
        <Row label="In sunlight it…"><Select value={wk.sunlight} options={[['none', 'Doesn\'t care'], ['vanish', 'Vanishes'], ['burn', 'Burns']]} onChange={(v) => set((x) => { x.weakness.sunlight = v; })} /></Row>
        <Toggle label="Weak to fire" hint="Takes 2.5× fire damage" value={wk.fire} onChange={(v) => set((x) => { x.weakness.fire = v; })} />
      </Collapse>

      <Card title="How it behaves" sub="Updates as you change the settings">
        <StateDiagram h={h} />
        <p class="hint">Its state is stored in the property <code>{hProp(p.namespace)}</code>, so your own animations, filters and events can react to it too.</p>
      </Card>

      <Card title="Test it in game" icon="🧪" sub="Copy into chat (turn cheats on in a test world)">
        {cmds.map(([l, c]) => (
          <div class="cmd">
            <div class="cmd-t"><span class="hint">{l}</span><code>{c}</code></div>
            <Btn small kind="ghost" icon="copy" aria-label={`Copy: ${l}`} onClick={() => { copyText(c); toast('Copied'); }} />
          </div>
        ))}
      </Card>
    </div>
  );
}
