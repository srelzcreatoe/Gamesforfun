// Runs the real behavior-pack scripts against the strict mock API through a
// scripted play session: setup + build, lobby, night 1 with a fuzzing guard,
// 6 AM, night 2 lost on purpose, retry, free roam, the Golden Dog's shifts, custom night (showstopper).
//   node --import ./tools/mock/register.mjs tools/mock/run_game.mjs [--seed=1] [--quick]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock, driver, world, system, BlockPermutation, missingSounds } from './mc_server_mock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
let seed = Number(args.seed ?? 1);
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// capture the scripts' console
const origErr = console.error, origWarn = console.warn, origLog = console.log;
console.error = (...a) => { mock.errors.push(a.join(' ')); };
console.warn = (...a) => { mock.warnings.push(a.join(' ')); };
console.log = (...a) => { if (args.verbose) origLog(...a); };
const say = (...a) => origLog(...a);

const main = await import(path.join(ROOT, 'packs/BP/scripts/main.js'));
const commands = {};
const components = {};
system.beforeEvents.startup.fire({
  customCommandRegistry: { registerCommand(def, cb) { commands[def.name] = { def, cb }; }, registerEnum() {} },
  blockComponentRegistry: { registerCustomComponent(name, comp) { components[name] = comp; } },
  itemComponentRegistry: { registerCustomComponent() {} },
});
world.afterEvents.worldLoad.fire({});
const game = () => main.currentGame();
const P = driver.addPlayer('Tester', { x: 0.5, y: -60, z: 0.5 });
const flush = () => new Promise((r) => setImmediate(r));
const steps = async (n, each) => { for (let i = 0; i < n; i++) { driver.step(); each?.(i); await flush(); } };
const waitFor = async (cond, max, label) => { for (let i = 0; i < max; i++) { if (cond()) return i; driver.step(); await flush(); } throw new Error(`timeout waiting for ${label} (state ${game()?.state})`); };
const debug = (action, a1, a2) => commands['fnar:debug'].cb({ sourceEntity: P }, action, a1, a2);
const W = (x, y, z) => { const o = game() ? { x: 0, y: 0, z: 0 } : null; return o; };

// form answers --------------------------------------------------------------
let answers = [];
mock.formPolicy = async (form) => {
  const t = form._title;
  const next = answers.find((a) => a.match(form));
  if (next) {
    answers = answers.filter((a) => a !== next || next.sticky);
    return next.reply(form);
  }
  if (t.startsWith('§k§r§k§r§m')) { // camera map: random camera, sometimes PLAY SHOW, sometimes LOWER
    const r = rand();
    if (r < 0.12) return { canceled: false, selection: form.buttons.length - 2 };
    if (r < 0.3) return { canceled: false, selection: form.buttons.length - 1 };
    return { canceled: false, selection: Math.floor(rand() * (form.buttons.length - 2)) };
  }
  if (form.kind === 'modal') return { canceled: false, formValues: form.controls.map((c) => c[2]) };
  return { canceled: true, cancelationReason: 'UserClosed' };
};
const answer = (match, reply, sticky = false) => answers.push({ match, reply, sticky });
const titleHas = (s) => (f) => f._title.includes(s);

// 1. first join -> build ------------------------------------------------------
answer(titleHas("FIVE NIGHTS AT RUSTGRIN"), () => ({ canceled: false, selection: 1 }));
world.afterEvents.playerSpawn.fire({ player: P, initialSpawn: true });
const tBuild = await waitFor(() => game()?.state === 'LOBBY', 20000, 'build + lobby');
say(`build: ${tBuild} ticks, ${mock.fills} fills, ${mock.blocks.size} blocks set, state ${game().state}`);
const origin = { ...(await import(path.join(ROOT, 'packs/BP/scripts/mc/world_io.js'))).origin };
const Wl = (x, y, z) => ({ x: x + origin.x, y: y + origin.y, z: z + origin.z });
const blockAt = (x, y, z) => world.getDimension('overworld').getBlock(Wl(x, y, z));

// ================================================================================================
// THE GOLDEN DOG, part 1 of 2: he is switched off for every other section of this session. They script their
// own nights, and his shifts are not theirs to answer. His own section (part 2, before the Custom Night's)
// switches him on for the nights it starts.
// ================================================================================================
const golden = { on: false };
{
  const g0 = game();
  const start0 = g0.startNight.bind(g0);
  g0.startNight = (...a) => {
    const r = start0(...a);
    if (!golden.on) g0.session?.golden.setLevel(0);
    return r;
  };
}
// ---- end of part 1

// ================================================================================================
// THE CELLAR (data/cellar.js, data/cellar_plan.js): what the build really put under the pizzeria.
// (The Golden Dog himself has his own section; this one is the map's.)
// ================================================================================================
const CEL = await import(path.join(ROOT, 'packs/BP/scripts/data/cellar.js'));
const CELP = await import(path.join(ROOT, 'packs/BP/scripts/data/cellar_plan.js'));
const cellarLamps = () => game().builder.plan.meta.hanging.filter((h) => h.group === 'cellar');
const litAt = (c) => blockAt(c.x, c.y, c.z).permutation.getState('fnar:lit');
{
  const { CELLAR, CELLAR_BUILT } = CEL;
  const { CELLAR_PLAN } = CELP;
  const { OFFICE: OFF } = await import(path.join(ROOT, 'packs/BP/scripts/data/layout.js'));
  const { CAMERA_BY_ID } = await import(path.join(ROOT, 'packs/BP/scripts/data/cameras.js'));
  const { PALETTE } = await import(path.join(ROOT, 'packs/BP/scripts/data/palette.js'));
  const ck = (ok, what) => { if (!ok) mock.errors.push(`check failed: ${what}`); };
  const type = (x, y, z) => blockAt(x, y, z).typeId;
  const isAir = (t) => t === 'minecraft:air' || t.startsWith('minecraft:light_block');
  ck(CELLAR_BUILT, 'CELLAR_BUILT is set');
  ck((await import(path.join(ROOT, 'packs/BP/scripts/mc/builder.js'))).BUILD_VERSION >= 13, 'the map version was bumped for the cellar (existing worlds rebuild)');
  // ---- the Other Office against the real office: the same room, cell for cell, 7 blocks lower
  const o = CELLAR.otherOffice.offset;
  const [x1, z1, x2, z2] = OFF.box;
  const gap = CELLAR.openings.desk_gap;
  const inGap = (x, y, z) => x >= gap[0] && x <= gap[3] && y >= gap[1] && y <= gap[4] && z >= gap[2] && z <= gap[5];
  const shape = (t) => (isAir(t) ? 'air' : /glass_pane/.test(t) ? 'window' : 'solid');
  const diffs = [];
  let cells = 0;
  for (let x = x1 - 1; x <= x2 + 1; x++) for (let z = z1 - 1; z <= z2 + 1; z++) for (let y = -1; y <= 5; y++) {
    const X = x + o.x, Y = y + o.y, Z = z + o.z;
    if (inGap(X, Y, Z)) continue;
    cells++;
    const real = type(x, y, z), other = type(X, Y, Z);
    const ring = x < x1 || x > x2 || z < z1 || z > z2 || y < 0 || y > 4;
    if (ring ? shape(real) !== shape(other) : isAir(real) && !isAir(other)) diffs.push(`${X},${Y},${Z}: ${other} (the office: ${real})`);
  }
  ck(diffs.length === 0, `the Other Office has the real office's shape, ${cells} cells compared (${diffs.slice(0, 4).join('; ')})`);
  for (const side of ['L', 'R']) {
    const d = OFF.doors[side], w = OFF.windows[side];
    ck(isAir(type(d.x, d.y1 + o.y, d.z1)) && isAir(type(d.x, d.y2 + o.y, d.z2)), `the Other Office's ${side} door stands open`);
    ck(/glass_pane/.test(type(w.x, w.y1 + o.y, w.z1)), `the Other Office has its ${side} window`);
  }
  // the desk phone is the real block in its own cell; nothing else down there is one of the guard's controls
  const ph = CELLAR.otherOffice.phone;
  ck(type(ph.x, ph.y, ph.z) === 'fnar:desk_phone' && blockAt(ph.x, ph.y, ph.z).permutation.getState('fnar:ringing') === false, `the Other Office's phone is a real fnar:desk_phone, not ringing (${type(ph.x, ph.y, ph.z)})`);
  ck(ph.x === OFF.phone.x + o.x && ph.y === OFF.phone.y + o.y && ph.z === OFF.phone.z + o.z, 'it stands in the phone\'s own cell, moved by the offset');
  const controls = [];
  for (let x = x1 - 1; x <= x2 + 1; x++) for (let z = z1 - 1; z <= z2 + 1; z++) for (let y = -1; y <= 5; y++) {
    const t = type(x + o.x, y + o.y, z + o.z);
    if (/^fnar:(door_button|light_button|crt_monitor)$/.test(t)) controls.push(t);
  }
  ck(controls.length === 0, `none of the Other Office's buttons or monitors is a control block (${controls.join(', ')})`);
  for (const b of Object.values(OFF.buttons)) ck(type(b.x + o.x, b.y + o.y, b.z + o.z) === 'fnar:dead_button', `a dead button hangs where the ${b.kind} at ${b.x},${b.y},${b.z} is upstairs (${type(b.x + o.x, b.y + o.y, b.z + o.z)})`);
  ck(type(OFF.monitor.x + o.x, OFF.monitor.y + o.y, OFF.monitor.z + o.z) === 'fnar:dead_monitor', 'the wreck of the monitor lies in the monitor\'s cell');
  ck(type(OFF.lamp.x + o.x, OFF.lamp.y + o.y, OFF.lamp.z + o.z) === 'fnar:ceiling_lamp' && litAt({ x: OFF.lamp.x + o.x, y: OFF.lamp.y + o.y, z: OFF.lamp.z + o.z }) === false, 'the Other Office\'s lamp is dead');
  const seat = CELLAR.otherOffice.spawn;
  ck(isAir(type(Math.floor(seat.x), seat.y, Math.floor(seat.z))) && isAir(type(Math.floor(seat.x), seat.y + 1, Math.floor(seat.z))) && !isAir(type(Math.floor(seat.x), seat.y - 1, Math.floor(seat.z))), 'the Other Office\'s seat is free, on a floor');
  // ---- the two openings and the aisle: empty from the stage to the desk, floor to ceiling
  for (const [id, [ax, ay, az, bx, by, bz]] of Object.entries(CELLAR.openings)) {
    let open = true;
    for (let x = ax; x <= bx; x++) for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) open &&= isAir(type(x, y, z));
    ck(open, `the opening ${id} is open`);
  }
  const A = CELLAR.aisle;
  const inAisle = [];
  for (let x = A.x1; x <= A.x2; x++) for (let z = A.z1; z <= A.z2; z++) {
    if (isAir(type(x, CELLAR.floorY, z))) inAisle.push(`no floor at ${x},${z}`);
    for (let y = CELLAR.standY; y < CELLAR.ceilY; y++) if (!isAir(type(x, y, z))) inAisle.push(`${type(x, y, z)} at ${x},${y},${z}`);
  }
  ck(inAisle.length === 0, `the aisle is empty from the stage to the desk (${inAisle.slice(0, 3).join('; ')})`);
  const { NODES: N } = await import(path.join(ROOT, 'packs/BP/scripts/data/nodes.js'));
  for (const id of CELLAR.walk) {
    const n = N[id];
    let clear = !isAir(type(Math.floor(n.x), n.y - 1, Math.floor(n.z)));
    for (let x = Math.floor(n.x) - 1; x <= Math.floor(n.x) + 1; x++) for (let y = n.y; y < n.y + 4; y++) clear &&= isAir(type(x, y, Math.floor(n.z)));
    ck(clear, `${id} stands on a floor with room for him (3 wide, 4 tall)`);
  }
  // ---- the stairs from Parts & Service
  const S = CELLAR_PLAN.stairs;
  ck(isAir(type(S.head, 0, S.z)) && !isAir(type(S.head, -1, S.z)), 'the head of the stairs is on the Parts & Service floor');
  let steps = 0;
  for (let x = S.x2, y = -1; x >= S.x1; x--, y--) {
    const ok = /stairs$/.test(type(x, y, S.z)) && isAir(type(x, y + 1, S.z)) && isAir(type(x, y + 2, S.z)) && !isAir(type(x, y - 1, S.z));
    if (ok) steps++;
    for (const z of [S.z - 1, S.z + 1]) ck(type(x, 0, z) === 'minecraft:iron_bars' && !isAir(type(x, -1, z)), `the stairwell has its railing at ${x},0,${z}`);
  }
  ck(steps === S.x2 - S.x1 + 1 && S.x2 - S.x1 + 1 === CELLAR.standY * -1, `the stairs: ${steps} steps, one for each block down to y ${CELLAR.standY}`);
  ck(isAir(type(S.x1 - 1, CELLAR.standY, S.z)) && isAir(type(S.x1 - 1, CELLAR.standY + 1, S.z)) && !isAir(type(S.x1 - 1, CELLAR.floorY, S.z)), 'the stairs end on the landing');
  ck(type(57, 0, 66) === 'fnar:endo_parts' && type(70, 0, 66) === 'fnar:endo_parts', 'Parts & Service keeps both stands in line');
  // ---- the stage: the ghost light burns, CAM 11 has its prop, the club's sign hangs over the stage
  const lamp = CELLAR_PLAN.stageLamp;
  ck(type(lamp.x, lamp.y, lamp.z) === 'fnar:ghost_light' && litAt(lamp) === true, 'the ghost light on the stage is lit as built');
  const m = CAMERA_BY_ID[CELLAR.cam].mount;
  ck(!!m && type(m[0], m[1], m[2]) === 'fnar:security_camera', 'CAM 11 has its camera prop');
  ck(type(36, CELLAR.ceilY - 1, CELLAR.rooms.GOLD_ROOM[1]) === 'fnar:sign_golden_dog', 'THE GOLDEN DOG SUPPER CLUB hangs over the stage');
  // ---- the gilding: every key is a palette key; pictures replace pictures, paw prints lie on empty floor
  for (const g of CELLAR.gild) {
    const b = PALETTE[g.key];
    const now = type(g.x, g.y, g.z);
    ck(!!b && (b.name === 'fnar:floor_decal_paws' ? isAir(now) && !isAir(type(g.x, g.y - 1, g.z)) : /^fnar:(poster_|drawing)/.test(now)), `gild cell ${g.x},${g.y},${g.z}: ${g.key} over ${now}`);
  }
  ck(cellarLamps().length >= 8, `the cellar has day lamps (${cellarLamps().length})`);
  say(`cellar: the Other Office matches the office (${cells} cells), the aisle is clear, ${steps} steps, ${cellarLamps().length} day lamps, ${CELLAR.gild.length} gild cells`);
}
// ================================================================================================

// 2. lobby -> NEW GAME button ------------------------------------------------------
const { LOBBY_BUTTONS } = await import(path.join(ROOT, 'packs/BP/scripts/data/lobby.js'));
const push = (id) => { const b = LOBBY_BUTTONS.find((x) => x.id === id); world.afterEvents.buttonPush.fire({ source: P, block: blockAt(b.x, 1, b.z), dimension: world.getDimension('overworld') }); };
const check = (ok, what) => { if (!ok) mock.errors.push(`check failed: ${what}`); };
// the tablet outside a shift explains itself
world.afterEvents.itemUse.fire({ source: P, itemStack: { typeId: 'fnar:tablet' } });
check(/only run during a shift/.test(P.actionBar ?? ''), 'tablet in the lobby explains that cameras need a shift');
push('new_game');
await waitFor(() => game().state === 'NIGHT', 200, 'night 1 start');
say(`night 1 started (guard mode ${P.gameMode})`);
// THE CELLAR at night: only the ghost light on the stage still burns
check(litAt(CELP.CELLAR_PLAN.stageLamp) === true && cellarLamps().every((c) => litAt(c) === false), 'at night the cellar is dark but for the ghost light on the stage');

// In game a custom block is only clickable when it has a custom component (fnar:control),
// and only within reach (about 5 blocks in survival / adventure). A click reaches the scripts
// twice: the interact attempt (a read-only before event) and the component's onPlayerInteract.
const { OFFICE } = await import(path.join(ROOT, 'packs/BP/scripts/data/layout.js'));
const GAME_REACH = 5.0;
const CLICKABLE = new Set(fs.readdirSync(path.join(ROOT, 'packs/BP/blocks')).map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packs/BP/blocks', f), 'utf8'))['minecraft:block'])
  .filter((b) => b.components?.['fnar:control'] || (b.permutations ?? []).some((p) => p.components?.['fnar:control'])).map((b) => b.description.identifier));
/** strict: a click the test relies on (an unreachable or dead block is an error); fuzz clicks just miss. */
const click = (x, y, z, strict = true) => {
  const b = blockAt(x, y, z);
  const eye = P.getHeadLocation();
  const c = { x: b.location.x + 0.5, y: b.location.y + 0.5, z: b.location.z + 0.5 };
  const d = Math.hypot(eye.x - c.x, eye.y - c.y, eye.z - c.z);
  if (d > GAME_REACH) { if (strict) mock.errors.push(`clicked ${b.typeId} at ${x},${y},${z} from ${d.toFixed(1)} blocks: out of reach in game`); return; }
  world.beforeEvents.playerInteractWithBlock.fire({ player: P, block: b, isFirstEvent: true, cancel: false });
  if (!CLICKABLE.has(b.typeId)) { mock.errors.push(`clicked ${b.typeId} at ${x},${y},${z}: not clickable in game (no fnar:control)`); return; }
  components['fnar:control'].onPlayerInteract({ player: P, block: b });
};
const clickMonitor = (strict = true) => click(OFFICE.monitor.x, OFFICE.monitor.y, OFFICE.monitor.z, strict);
// the dead CRTs on the wall above the desk are scenery: clicking one must not raise the cameras
const clickDeadCrt = () => click(OFFICE.monitor.x, OFFICE.monitor.y + 1, OFFICE.monitor.z, false);

// 3a. the cameras, the way a player first uses them ----------------------------------
const { CAMERAS } = await import(path.join(ROOT, 'packs/BP/scripts/data/cameras.js'));
const MAP_MARK = '§k§r§k§r§m';
let camScript = null; // replies for the camera map form while this section runs
let held = null; // resolves the camera map the "player" is looking at
answer((f) => camScript !== null && f._title.startsWith(MAP_MARK), () => {
  const next = camScript.shift() ?? 'hold';
  if (next === 'busy') return { canceled: true, cancelationReason: 'UserBusy' };
  return new Promise((res) => { held = res; });
}, true);
const cams = () => game().session.devices.cams;
await steps(5);
check(P.selectedSlotIndex === 4 && P.inventory[4]?.typeId === 'fnar:tablet', 'the guard starts holding the Camera Tablet');
// every office control can be clicked from the seat
for (const [action, b] of Object.entries(OFFICE.buttons)) {
  const w = Wl(b.x + 0.5, b.y + 0.5, b.z + 0.5);
  const d = Math.hypot(P.getHeadLocation().x - w.x, P.getHeadLocation().y - w.y, P.getHeadLocation().z - w.z);
  check(d <= GAME_REACH, `${action} button within reach of the seat (${d.toFixed(1)} blocks)`);
}
clickDeadCrt();
await steps(4);
check(!game().session.devices.cams.open, 'a dead CRT on the wall does not raise the cameras');
camScript = ['busy', 'busy'];
clickMonitor();
await steps(6);
check(cams().open && P.cameraState === 'free', 'clicking the CRT monitor raises the cameras');
check(P.effects.has('night_vision'), 'the camera feed has night vision');
{
  const { NODES } = await import(path.join(ROOT, 'packs/BP/scripts/data/nodes.js'));
  const lit = ['ST_R', 'ST_M', 'ST_N'].filter((id) => /light_block/.test(blockAt(Math.floor(NODES[id].x), NODES[id].y + 3, Math.floor(NODES[id].z)).typeId));
  check(lit.length === 3, `CAM 1A lights the band on the stage (${lit.length}/3 lit)`);
}
check(cams().cam === '1A', `the monitor opens on CAM 1A (got ${cams().cam}; the hotbar reset must not count as a scroll)`);
{
  const band = ['rustgrin', 'mirehop', 'noxbriar'].map((id) => [...mock.entities.values()].find((e) => e.typeId === `fnar:${id}`));
  check(band.every((e) => e?.props['fnar:hollow'] === true && e.props['fnar:look_pitch'] < 0), 'the first look of the night: the band is already staring up into the lens, eyes empty');
}
await steps(40);
check(cams().open, 'a busy player (UserBusy) does not lower the monitor');
{
  // watched on CAM 1A (up under the ceiling), the band turn their heads UP to the lens, eyes on it
  const { HEAD_AIM } = await import(path.join(ROOT, 'packs/BP/scripts/data/head_aim.js'));
  const { CAMERA_BY_ID } = await import(path.join(ROOT, 'packs/BP/scripts/data/cameras.js'));
  const r = [...mock.entities.values()].find((e) => e.typeId === 'fnar:rustgrin');
  const lp = r?.props['fnar:look_pitch'];
  const [, p0, , up, fwd] = HEAD_AIM.rustgrin[r?.props['fnar:anim'] ?? 'pose'];
  const cam = CAMERA_BY_ID['1A'].loc;
  const n = (await import(path.join(ROOT, 'packs/BP/scripts/data/nodes.js'))).NODES.ST_R;
  // the true pitch from his eyes to the lens (Minecraft pitch: negative = up); he faces south, +z
  const want = (-Math.atan2(cam[1] - (n.y + up), Math.hypot(cam[0] - n.x, cam[2] - (n.z + fwd))) * 180) / Math.PI;
  check(typeof lp === 'number' && lp < -5, `stared at from a camera above, Rustgrin looks up, not down (look_pitch ${lp})`);
  check(Math.abs(p0 + lp - want) < 2.5, `and his eyes are on the lens: pose ${p0} + look ${lp} = ${(p0 + lp).toFixed(1)}, the lens is at ${want.toFixed(1)}`);
}
check(!!held, 'the camera map is shown again after UserBusy');
world.afterEvents.playerHotbarSelectedSlotChange.fire({ player: P, previousSlotSelected: 4, newSlotSelected: 5 });
await steps(6);
check(cams().cam === '1B' && P.selectedSlotIndex === 4, `one hotbar scroll = one camera (got ${cams().cam}, slot ${P.selectedSlotIndex})`);
const camLoc = { ...P.cameraLoc };
held?.({ canceled: false, selection: CAMERAS.findIndex((c) => c.id === '2A') });
held = null;
await steps(6);
check(cams().cam === '2A' && P.cameraLoc.z !== camLoc.z, `clicking CAM 2A on the map switches the feed (got ${cams().cam})`);
check(!!held, 'the camera map comes back after a switch');
{
  // the power, the usage and the status lines change underneath: the open map must stay put, or the
  // guard sees it blink and loses the click being made
  const closed0 = mock.closed ?? 0;
  const held0 = held;
  await steps(300);
  check((mock.closed ?? 0) === closed0 && held === held0, `the open camera map is not closed and re-shown for status changes (closed ${(mock.closed ?? 0) - closed0}x)`);
}
held?.({ canceled: false, selection: CAMERAS.length }); // LOWER
held = null;
if (cams().open) world.afterEvents.playerButtonInput.fire({ player: P, button: 'Sneak', newButtonState: 'Pressed' }); // (only when LOWER was not reachable)
await steps(8);
check(!cams().open && P.cameraState === 'default', 'LOWER puts the monitor down and restores the view');
check(!P.effects.has('night_vision'), 'night vision ends with the camera view');
world.afterEvents.itemUse.fire({ source: P, itemStack: { typeId: 'fnar:tablet' } });
await steps(10);
check(cams().open && P.cameraState === 'free', 'the Camera Tablet raises the cameras');
const closedBefore = mock.closed ?? 0;
world.afterEvents.playerButtonInput.fire({ player: P, button: 'Sneak', newButtonState: 'Pressed' });
await steps(10);
check(!cams().open && P.cameraState === 'default', 'sneaking lowers the monitor');
check((mock.closed ?? 0) > closedBefore && game().camForm === null, 'lowering the monitor closes the camera map');
camScript = null;
debug('status');
await steps(2);
check(/animatronics: (?!none)/.test(P.lastMessage ?? ''), `status lists the animatronics (got: ${P.lastMessage})`);
say(`cameras ok (camera map shown ${mock.forms.filter((f) => f.title.startsWith(MAP_MARK)).length}x)`);

// 3. a fuzzing guard -------------------------------------------------------------
const buttons = Object.values(OFFICE.buttons);
const fuzz = (i) => {
  const s = game().session;
  if (!s || game().state !== 'NIGHT') return;
  const r = rand();
  if (i % 37 === 0) world.afterEvents.itemUse.fire({ source: P, itemStack: { typeId: 'fnar:tablet' } });
  if (i % 53 === 0 && s.devices.cams.open) world.afterEvents.playerButtonInput.fire({ player: P, button: 'Sneak', newButtonState: 'Pressed' });
  if (i % 41 === 0 && s.devices.cams.open) world.afterEvents.playerHotbarSelectedSlotChange.fire({ player: P, previousSlotSelected: 4, newSlotSelected: r < 0.5 ? 5 : 3 });
  if (i % 23 === 0) { const b = buttons[Math.floor(rand() * buttons.length)]; click(b.x, b.y, b.z, false); }
  if (i % 97 === 0) clickMonitor(false);
  if (i % 131 === 0) click(OFFICE.phone.x, OFFICE.phone.y, OFFICE.phone.z, false);
  if (i % 211 === 0) { answer(titleHas('OFFICE REMOTE'), (f) => ({ canceled: false, selection: Math.floor(rand() * f.buttons.length) })); world.afterEvents.itemUse.fire({ source: P, itemStack: { typeId: 'fnar:remote' } }); }
  if (i % 300 === 0) P.teleport(Wl(10, 0, 10)); // try to leave the office
};
await steps(3000, fuzz);
say(`night 1 after 3000 ticks: state ${game().state}, power ${game().session?.snapshot().powerPct}%, ${game().session?.debugLine()}`);
// 4. fast-forward to 6 AM ---------------------------------------------------------------
if (game().state === 'NIGHT') {
  answer(titleHas('COMPLETE'), (f) => ({ canceled: false, selection: 0 })); // continue to night 2
  debug('win');
  await waitFor(() => game().state === 'NIGHT' && game().nightOpts.n === 2, 800, 'night 2 via continue');
  say(`night 1 won -> night 2 started; save beaten ${JSON.stringify(game().save.beaten)}`);
} else {
  // the fuzzing guard died: retry once then move on
  say('night 1 lost while fuzzing (fine)');
  await waitFor(() => game().state === 'NIGHT' || game().state === 'LOBBY', 1200, 'after night 1');
}
// 5. night 2: do nothing and get caught -----------------------------------------------------
if (game().state !== 'NIGHT') { debug('night', '2'); await steps(5); }
debug('ai', 'mirehop', '20');
debug('hour', '4');
answer(titleHas('GAME OVER'), () => ({ canceled: false, selection: 1 })); // lobby (no next on loss: retry=0, lobby=1)
await waitFor(() => game().state === 'JUMPSCARE', 6000, 'a jumpscare');
say(`jumpscare by ${game().session?.killer ?? '?'}`);
await steps(2);
check(P.hudHidden === 'all' && mock.titles.at(-1)?.[0] === '§k§r§k§r§o', `the jumpscare clears the screen: HUD hidden (${P.hudHidden}), title code for the pack to hide the action bar (${JSON.stringify(mock.titles.at(-1)?.[0])})`);
await waitFor(() => game().state === 'LOBBY', 600, 'back to the lobby');
say('back in the lobby after a loss');
check(P.hudHidden === null, 'the HUD comes back after the jumpscare');
{
  const over = mock.forms.filter((f) => f.title.includes('GAME OVER')).at(-1);
  check(/LEFT door/.test(over?.body ?? ''), `the game-over screen explains how Mirehop got in (got: ${over?.body})`);
}
// 5a. the cast remembers the guard from one night of the week to the next (core/ai/memory.js, mc/tricks.js)
{
  const { MEMORY_CALLS, CALLS } = await import(path.join(ROOT, 'packs/BP/scripts/data/story.js'));
  const m = game().save.memory;
  check(m?.death?.who === 'mirehop' && m.death.way === 'L' && m.deaths === 1 && JSON.stringify(m).length < 300, `the save remembers how the guard was caught, in a few bytes (${JSON.stringify(m)})`);
  debug('night', '2');
  await steps(5);
  const s = game().session;
  check(s.beliefs?.encore?.who === 'mirehop' && s.chars.mirehop.grudge === 'L' && s.director.ease === 1, `the retry starts from that memory: Mirehop comes back the same way first, and the director eases off (${JSON.stringify(s.beliefs)})`);
  const lines = game().phoneSeq?.lines ?? [];
  const hint = lines.findIndex((l) => MEMORY_CALLS.encore.mirehop.includes(l));
  check(hint >= 1 && lines[hint - 1] === CALLS[2][0], `the Ringmaster hints at it in his call, right after the greeting (got: ${lines.slice(0, 3).join(' / ')})`);
  const mem = JSON.stringify(game().save.memory);
  debug('lobby');
  await steps(3);
  check(JSON.stringify(game().save.memory) === mem, 'a night that was abandoned is not remembered');
  // a catch a trick was part of: the game-over screen explains the trick (after a trade, the killer's
  // usual tip would name the wrong door)
  debug('night', '2');
  await steps(5);
  answer(titleHas('GAME OVER'), () => ({ canceled: false, selection: 1 }));
  game().render({ fx: 'jumpscare', who: 'noxbriar', way: 'L', note: 'traded' }, P);
  await waitFor(() => game().state === 'LOBBY', 600, 'back to the lobby after a catch by a trade');
  const over = mock.forms.filter((f) => f.title.includes('GAME OVER')).at(-1);
  check(/traded halls/.test(over?.body ?? '') && !/RIGHT side/.test(over?.body ?? ''), `after a trade the game-over screen explains the trade, not the usual door (got: ${over?.body})`);
  game().save.memory = JSON.parse(mem); // (the rest of the session goes on from the memory checked above)
}
// 6. free roam ------------------------------------------------------------------------------
// The daytime guests are watched through the whole of Free Roam and closing time: every tick, nobody who is
// walking or standing may be inside a block of the built map (tables, chairs, walls, glass, ropes).
const GD = await import(path.join(ROOT, 'packs/BP/scripts/data/guests.js'));
const guestWatch = { ticks: 0, samples: 0, inBlock: [], max: 0, hold: 0, lookBack: 0, anims: new Set(), outside: 0 };
{
  const { buildVoxels } = await import('../map/export_voxels.mjs');
  const { grid } = buildVoxels();
  for (const [x, y, z] of GD.DAY_OPEN) grid.data[(x - grid.x0) + grid.sx * ((z - grid.z0) + grid.sz * (y - grid.y0))] = 0; // the front doors by day
  const PASS = /^(minecraft:(air|light_block_\d+|short_grass|.*_carpet|.*wall_sign|.*_button)|fnar:(floor_decal|poster_.*|drawing|sign_.*|wall_writing|lot_tag|neon_sign.*|menu_board|height_chart|token_prices|bunting|light_button|door_button))$/;
  const solid = (x, y, z) => {
    const ix = Math.floor(x) - grid.x0, iy = y - grid.y0, iz = Math.floor(z) - grid.z0;
    return ix >= 0 && iz >= 0 && ix < grid.sx && iz < grid.sz && !PASS.test(grid.palette[grid.data[ix + grid.sx * (iz + grid.sz * iy)]].name);
  };
  const step0 = driver.step;
  driver.step = () => {
    step0.call(driver);
    const g = game();
    if (g?.state !== 'FREE_ROAM' && g?.state !== 'CLOSING') return;
    guestWatch.ticks++;
    guestWatch.max = Math.max(guestWatch.max, g.guests.list.length);
    for (const q of g.guests.list) {
      guestWatch.samples++;
      guestWatch.anims.add(q.props['fnar:anim']);
      if (q.props['fnar:hold']) guestWatch.hold++;
      if (q.lookBack && mock.tick < q.blockUntil) guestWatch.lookBack++;
      if (q.x > GD.DOOR.x) guestWatch.outside++;
      if (q.seated || q.slide) continue; // on a chair, or getting on or off it
      for (const [dx, dz] of [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]]) {
        if (solid(q.x + dx, 0, q.z + dz) || solid(q.x + dx, 1, q.z + dz)) { guestWatch.inBlock.push(`${q.x.toFixed(2)},${q.z.toFixed(2)}`); break; }
      }
    }
  };
}
const guestEnts = () => [...mock.entities.values()].filter((e) => e.typeId === 'fnar:guest');
push('free_roam');
await waitFor(() => game().state === 'FREE_ROAM', 50, 'free roam');
check(P.inventory[4]?.typeId === 'fnar:time_card', 'Free Roam hands out the Time Card');
// THE CELLAR by day: its few lamps are lit, so a player can find the way down there
check(cellarLamps().every((c) => litAt(c) === true) && litAt(CELP.CELLAR_PLAN.stageLamp) === true, 'by day the cellar\'s lamps are lit');
{
  // open for business: people at the tables and the games already, a family on its way in from the lot
  const gs = game().guests;
  await steps(2);
  check(gs.count() >= 9 && gs.count() <= GD.CROWD.max, `by day there are guests in the pizzeria at once (${gs.count()})`);
  check(guestEnts().length === gs.count() && guestEnts().every((e) => e.tags.has('fnar_guest')), 'every guest is a tagged fnar:guest entity');
  check(gs.list.filter((q) => q.seated).length >= 3 && gs.list.some((q) => q.kind === 'child') && gs.list.some((q) => q.kind === 'adult'), 'some of them sit at the tables; there are grown-ups and children');
  check(gs.list.some((q) => q.x > GD.DOOR.x && q.walk), 'a group is crossing the lot towards the front doors');
  check(new Set(gs.list.map((q) => q.skin)).size === gs.count(), 'no two guests wear the same skin');
  check(blockAt(100, 0, 35).typeId === 'minecraft:air' && blockAt(100, 0, 36).typeId === 'minecraft:air', 'by day the two open door leaves are open down to the floor');
  // the mob sweep leaves them alone, whatever families they have
  guestEnts()[0].families = ['mob'];
  game().sweepMobs();
  check(guestEnts().length === gs.count() && guestEnts().every((e) => e.isValid), 'the mob sweep does not remove guests');
  // nobody stands inside anybody
  let close = 0;
  for (const a of gs.list) for (const b of gs.list) if (a.n < b.n && Math.hypot(a.x - b.x, a.z - b.z) < 0.4) close++;
  check(close === 0, `no two guests start in the same spot (${close} pairs)`);
}
{
  // a live show: announced, performed with music, a bow, then every head turns to the guest
  const r = game().roam;
  const gs = game().guests;
  r.nextShow = mock.tick + 30;
  await waitFor(() => game().roam.phase === 'show', 60, 'the show to start');
  await steps(40);
  check(mock.sounds.includes('fnar.music.showtime'), 'the show plays the band music');
  {
    // everyone in the Dining Hall watches the stage: the seated ones turn on their chairs, heads towards the band
    const watchers = gs.list.filter((q) => gs.watching(q));
    const facing = watchers.filter((q) => {
      const want = (Math.atan2(-(GD.STAGE_FOCUS.x - q.x), GD.STAGE_FOCUS.z - q.z) * 180) / Math.PI;
      const head = q.yaw + (q.props['fnar:look_yaw'] ?? 0);
      return Math.abs(((((want - head) % 360) + 540) % 360) - 180) < 50;
    });
    check(watchers.length >= 3 && facing.length >= watchers.length - 1, `the guests in the Dining Hall watch the stage (${facing.length} of ${watchers.length} look at it)`);
    check(!watchers.some((q) => !q.seated && q.x > 35.5 && q.x < 41.5), 'nobody stands in the middle aisle the band looks down');
  }
  await steps(200);
  check(gs.list.some((q) => /clap|cheer/.test(q.props['fnar:anim'])) || guestWatch.anims.has('sit_clap') || guestWatch.anims.has('clap'), 'they clap along during the show');
  const cheers = mock.sounds.filter((x) => x === 'fnar.day.cheer').length;
  r.at = mock.tick + 5;
  await waitFor(() => game().roam.phase === 'bow', 30, 'the bow');
  await steps(4);
  {
    const watchers = gs.list.filter((q) => gs.watching(q));
    const clapping = watchers.filter((q) => /clap|cheer/.test(q.props['fnar:anim']));
    check(watchers.length >= 3 && clapping.length === watchers.length, `at the bow the whole audience claps and cheers (${clapping.length} of ${watchers.length})`);
    check(mock.sounds.filter((x) => x === 'fnar.day.cheer').length > cheers, 'and the hall is heard cheering');
  }
  await waitFor(() => game().roam.phase === 'stare', 200, 'the curtain call');
  await waitFor(() => game().roam.phase === 'idle', 200, 'the show to end');
  check(game().audio.loops.has('crowd_dining') && mock.sounds.includes('fnar.day.crowd'), 'the room murmurs while there are guests in it');
  {
    // between shows one of the band steps off the stage, walks among the tables, waves to a child and goes back
    const { NODES } = await import(path.join(ROOT, 'packs/BP/scripts/data/nodes.js'));
    const local = (e) => ({ x: e.location.x - origin.x, y: e.location.y - origin.y, z: e.location.z - origin.z });
    check(game().roam.strollAt > mock.tick + 200 && game().roam.strollAt < mock.tick + 700, 'after a show one of the band is due for a walk among the tables');
    {
      // (a group sits by the middle aisle for this, wherever the day happened to put it: a family with a child if there is one)
      const still = gs.groups.filter((grp) => !grp.leaving && grp.members.every((q) => q.place && !q.walk && !q.slide));
      const fam = still.find((grp) => grp.members.some((q) => q.kind === 'child')) ?? still[0];
      const seats = gs.places.filter((pl) => pl.kind === 'seat' && (pl.bx === 34 || pl.bx === 43) && !pl.by);
      check(!!fam && seats.length >= (fam?.members.length ?? 99), `there is a group to seat by the middle aisle, and room for it (${seats.length} free seats)`);
      if (fam && seats.length >= fam.members.length) {
        fam.members.forEach((q, i) => { gs.take(q, seats[i]); gs.settleAt(q, mock.tick); });
        fam.leaveAt = fam.until = mock.tick + 4000;
        fam.phase = 'stay';
        fam.stops = [{ kind: 'seats' }];
        fam.at = 0;
      }
    }
    game().roam.strollAt = mock.tick + 5;
    await waitFor(() => !!game().roam.stroll, 40, 'a band member to step off the stage');
    const who = game().roam.stroll.id;
    const ent = [...mock.entities.values()].find((e) => e.typeId === `fnar:${who}`);
    const mark = { ST_R: 'rustgrin', ST_M: 'mirehop', ST_N: 'noxbriar' };
    const home = NODES[Object.keys(mark).find((k) => mark[k] === who)];
    check(ent.props['fnar:anim'] === 'walk', `${who} walks off the stage`);
    let watched = 0;
    await waitFor(() => { watched = Math.max(watched, gs.list.filter((q) => mock.tick < q.glanceUntil).length); return game().roam.stroll?.phase === 'greet'; }, 600, 'it to stop among the tables');
    await steps(2);
    const at = local(ent);
    check(at.y < 0.1 && at.z > 18 && Math.abs(at.x - 38.5) < 2, `it stands in the middle aisle among the tables (${at.x.toFixed(1)}, ${at.y.toFixed(1)}, ${at.z.toFixed(1)})`);
    check(ent.props['fnar:anim'] === 'wave', 'and waves');
    check(gs.list.some((q) => /wave/.test(q.props['fnar:anim'] ?? '')), 'a guest waves back');
    check(watched > 0, `guests near it turn to watch (${watched} at once)`);
    await waitFor(() => !game().roam.stroll, 700, 'it to go back to the stage');
    const back = local(ent);
    check(Math.hypot(back.x - home.x, back.z - home.z) < 0.01 && Math.abs(back.y - home.y) < 0.01 && ent.props['fnar:anim'] === 'pose', `${who} is back on its mark`);
    check(mock.tick < game().roam.nextShow - 400, 'before the next show is announced');
  }
  // walk up to Rustgrin and look at him: he talks
  const rg = [...mock.entities.values()].find((e) => e.typeId === 'fnar:rustgrin');
  P.teleport({ x: rg.location.x, y: rg.location.y, z: rg.location.z + 3 }, { rotation: { x: -20, y: 180 } });
  await steps(20);
  check(/Rustgrin§7: /.test(P.actionBar ?? ''), `walking up to Rustgrin, he talks (${(P.actionBar ?? '').split('\n')[0]})`);
}
{
  // the guests and the player: a guest glances at someone who walks up, and sooner or later waves
  const gs = game().guests;
  const seat = gs.list.find((q) => q.seated && !q.walk && !q.grp.leaving);
  check(!!seat, 'someone is sitting at a table after the show');
  if (seat) {
    seat.grp.leaveAt = seat.grp.until = mock.tick + 4000; // (they stay for this)
    P.teleport(Wl(seat.place.ax, 0, seat.place.az), { rotation: { x: 0, y: 0 } });
    let looked = false, waved = false;
    await waitFor(() => {
      for (const q of gs.list) {
        if (Math.hypot(q.x - seat.place.ax, q.z - seat.place.az) > 4) continue;
        looked ||= mock.tick < q.glanceUntil;
        waved ||= /wave/.test(q.props['fnar:anim'] ?? '');
      }
      return looked && waved;
    }, 1500, 'a guest to look at the player and wave').catch(() => {});
    check(looked, 'a guest glances at a player who walks up');
    check(waved, 'and one of them waves');
    check(guestEnts().every((e) => e.isValid), 'standing among the guests breaks nothing');
  }
  // groups go home: two of them are sent off now, walk out through the front doors to the street and are gone
  P.teleport(Wl(40, 0, 20), { rotation: { x: 0, y: 0 } });
  const sent = [...gs.groups].filter((grp) => !grp.leaving && grp !== seat?.grp && grp.members.every((q) => q.x < GD.DOOR.x)).slice(0, 2);
  for (const grp of sent) grp.leaveAt = mock.tick;
  const sentIds = new Set(sent.flatMap((grp) => grp.members.map((q) => q.n)));
  const outside0 = guestWatch.outside;
  await waitFor(() => !gs.list.some((q) => sentIds.has(q.n)), 3000, 'the groups that were sent home to leave');
  check(sentIds.size > 0 && guestWatch.outside > outside0 && guestEnts().length === gs.count(), 'guests leave over time (they walk out to the street, where their entities are removed)');
  // and new ones come in from the street: the bell over the doors rings as the group walks in
  const chimes = mock.sounds.filter((x) => x === 'fnar.day.door_chime').length;
  while (gs.count() > GD.CROWD.max - 5) { // (room for a party of any size)
    gs.dropGroup(gs.groups.find((grp) => grp !== seat?.grp));
    await steps(2);
  }
  const known = new Set(gs.list.map((q) => q.n));
  gs.nextArrival = mock.tick + 5;
  await waitFor(() => gs.list.some((q) => !known.has(q.n)), 60, 'a new group to arrive');
  const fresh = gs.list.filter((q) => !known.has(q.n));
  check(fresh.every((q) => q.x > GD.DOOR.x), `new guests appear outside, at the street (x ${fresh.map((q) => q.x.toFixed(0))})`);
  await waitFor(() => mock.sounds.filter((x) => x === 'fnar.day.door_chime').length > chimes, 1500, 'the door chime as the new group comes in');
  await waitFor(() => fresh.every((q) => q.gone || (!q.walk && !q.slide && q.place)), 2500, 'the new group to reach its first stop');
  check(fresh.some((q) => !q.gone && q.place), 'the new group walks in and takes its places');
  check(gs.count() >= 3 && guestWatch.max <= GD.CROWD.max, `the crowd stays within its size (now ${gs.count()}, at most ${guestWatch.max} at once)`);
  for (const a of ['walk', 'sit', 'eat']) check(guestWatch.anims.has(a), `guests ${a}`);
}
answer(titleHas('TIME CARD'), (f) => ({ canceled: false, selection: f.buttons.findIndex((b) => /time clock/.test(b)) }));
world.afterEvents.itemUse.fire({ source: P, itemStack: { typeId: 'fnar:time_card' } });
await waitFor(() => game().state === 'LOBBY', 100, 'lobby after free roam');
await steps(2);
check(guestEnts().length === 0 && game().guests.count() === 0, 'there are no guests in the lobby');
check(blockAt(100, 0, 35).typeId === 'minecraft:air' && blockAt(100, 0, 34).typeId === 'minecraft:glass_pane', 'and the front doorway is as built: open down to the floor between the two glass leaves, no sill');
{
  // guests left behind by a script reload (no record of them) are cleaned up by type and tag
  const stray = world.getDimension('overworld').spawnEntity('fnar:guest', Wl(40, 0, 33));
  stray.addTag('fnar_guest');
  game().enterLobby();
  await steps(2);
  check(!stray.isValid && guestEnts().length === 0, 'a guest left over from before a reload is removed');
}
say(`free roam ok: a live show, a talking animatronic, the Time Card; guests: up to ${guestWatch.max} at once, ${guestWatch.samples} samples`);

// 6a. closing time: from Free Roam, the Time Card clocks in for the night
push('free_roam');
await waitFor(() => game().state === 'FREE_ROAM', 50, 'free roam again');
await steps(60);
const closingFrom = game().guests.count();
guestWatch.hold = 0;
answer(titleHas('TIME CARD'), () => ({ canceled: false, selection: 0 }));
world.afterEvents.itemUse.fire({ source: P, itemStack: { typeId: 'fnar:time_card' } });
await waitFor(() => game().state === 'CLOSING', 40, 'closing time');
{
  // everyone stops and looks at the stage, then they all get up and file out, the children by the hand
  const gs = game().guests;
  await steps(3);
  check(closingFrom >= 8 && gs.list.every((q) => !q.walk) && !game().audio.loops.has('crowd_dining'), `closing time: every guest stops (${closingFrom} of them) and the murmur dies with the music`);
  const tClose = mock.tick;
  let insideAtDark = -1;
  await waitFor(() => {
    if (insideAtDark < 0 && game().guests.pace > 2) insideAtDark = gs.inside();
    return game().state === 'NIGHT';
  }, 1400, 'the night after closing time');
  check(guestWatch.hold > 0, 'parents take the children by the hand on the way out');
  check(guestWatch.lookBack > 20, `the last child stops in the doorway and looks back (${guestWatch.lookBack} ticks)`);
  check(insideAtDark > 0, `guests are still hurrying out when the lights start going (${insideAtDark} inside)`);
  check(guestEnts().length === 0 && gs.count() === 0, 'no guest is left when the night starts');
  check(blockAt(100, 0, 35).typeId === 'minecraft:air', 'the front doorway is as built for the night (no sill to jump)');
  check(guestWatch.inBlock.length === 0, `no guest ever walked or stood inside a block (${guestWatch.inBlock.length} of ${guestWatch.samples} samples: ${guestWatch.inBlock.slice(0, 4).join(' | ')})`);
  say(`closing time: ${closingFrom} guests out in ${mock.tick - tClose} ticks`);
}
check(mock.sounds.includes('fnar.tophat.tape_out'), 'closing time cuts the music');
say(`closing time -> ${game().nightLabel}`);
await steps(40);
check(guestEnts().length === 0, 'there are no guests during a night');
debug('lobby');
await steps(5);

// 6b. nothing lives in the pizzeria but the cast --------------------------------------------------
{
  while (mock.tick % 200 > 190) await steps(1); // (not while a sweep is due: the third mob below is to outlive these two ticks)
  const inside = driver.spawnMob('minecraft:zombie', Wl(36.5, 0, 30.5));
  const outside = driver.spawnMob('minecraft:zombie', Wl(400, 0, 400));
  const already = driver.spawnMob('minecraft:creeper', Wl(60.5, 0, 40.5), { silent: true }); // there before the build
  await steps(2);
  check(!inside.isValid, 'a mob that spawns inside the lot is removed');
  check(outside.isValid, 'a mob outside the lot is left alone');
  check(already.isValid, '(test setup) a silent mob stays until the next sweep');
  outside.remove();
  check(world.gameRules.doMobSpawning === false, 'natural mob spawning is off');
  globalThis.__alreadyMob = already;
}

// 6c. night 1 again: the Ringmaster's call, the background music and its switch --------------------
answer(titleHas('NEW GAME'), () => ({ canceled: false, selection: 1 }));
push('new_game');
await waitFor(() => game().state === 'NIGHT' && game().nightOpts.n === 1, 100, 'night 1 (new game)');
await steps(3);
check(game().save.memory === null && game().session.beliefs === null, 'a New Game starts blank: on night 1 the cast does not know the guard');
check(!globalThis.__alreadyMob.isValid, 'a mob that was in the lot is swept when a night starts');
check(P.music === 'fnar.music.bgm', `the background music plays during a shift (got ${P.music})`);
await waitFor(() => /Ringmaster/.test(P.actionBar ?? '') && /Tester/.test(P.actionBar ?? ''), 500, 'the Ringmaster calling the guard by name');
say('night 1: the Ringmaster calls the guard by name');
click(OFFICE.phone.x, OFFICE.phone.y, OFFICE.phone.z);
await steps(3);
check(game().save.hungUp === true && game().phoneSeq === null, 'the desk phone hangs up on him');
answer(titleHas('SHIFT GUIDE'), (f) => ({ canceled: false, selection: 0 }));
world.afterEvents.itemUse.fire({ source: P, itemStack: { typeId: 'fnar:guide' } });
await steps(4);
check(P.music === null && game().save.settings.bgm === false, 'the Shift Guide switches the music off');
answer(titleHas('SHIFT GUIDE'), (f) => ({ canceled: false, selection: 0 }));
world.afterEvents.itemUse.fire({ source: P, itemStack: { typeId: 'fnar:guide' } });
await steps(4);
check(P.music === 'fnar.music.bgm' && game().save.settings.bgm === true, 'and back on');
{
  const { HUNG_UP } = await import(path.join(ROOT, 'packs/BP/scripts/data/story.js'));
  debug('night', '2');
  await steps(5);
  check(HUNG_UP.includes(game().phoneSeq?.lines[0]), 'after a hang-up, the next call starts by mentioning it');
  const ent = (id) => [...mock.entities.values()].find((e) => e.typeId === `fnar:${id}`);
  check(ent('cat')?.props['fnar:anim'] === 'perform' && ent('purple_rat')?.props['fnar:anim'] === 'perform', 'night 2: the troupe dances on the Midway ring');
  check(ent('top_hat_rat')?.props['fnar:anim'] === 'pose', 'the Ringmaster stands posed in his booth');
  // night dread: the midnight sting and the drone, honest tells at the doors, hollow eyes, the empty building
  {
    const dr = game().dread;
    const now = () => system.currentTick;
    check(mock.sounds.includes('fnar.night.midnight') && game().audio.loops.has('dread_drone'), 'the night shift starts with the midnight sting and the drone under it');
    // the opening of this night (night 2, started 5 ticks ago): black, the doors lock, the lamp is dead; then
    // the breakers, the clock, a red line under 12 AM, the lamp catching, the hall lights by themselves
    {
      const lampLit = () => blockAt(OFFICE.lamp.x, OFFICE.lamp.y, OFFICE.lamp.z).permutation.getState('fnar:lit');
      const hallLamp = (side) => { const h = OFFICE.hallLights[side].lamp; return blockAt(h.x, h.y, h.z).permutation.getState('fnar:lit'); };
      check(lampLit() === false, 'the shift opens in the dark: the office lamp is dead');
      const n0 = mock.sounds.length - 8;
      const t0 = mock.titles.length;
      await steps(60);
      const heard = mock.sounds.slice(Math.max(0, n0));
      check(heard.includes('fnar.light.off') && heard.includes('fnar.night.midnight'), 'in the dark: the breakers go, then the clock and the bell');
      check(mock.titles.slice(t0).some(([t]) => /YOU CAME BACK/.test(t)), 'night 2: for a blink, YOU CAME BACK under 12 AM');
      await steps(45);
      check(lampLit() === true, 'then the office lamp catches');
      let selfLit = false;
      await steps(40, () => { selfLit ||= hallLamp('L') === true; });
      check(selfLit && hallLamp('L') === false && game().session.devices.lightL === false, 'the left hall light comes on by itself for a moment, on nothing');
    }
    const d = { ...game().session.snapshot().devices, doorL: true, lightL: false };
    const fake = { id: 'mirehop', node: 'DOOR_L' };
    dr.tell(fake, d, P, now()); // the first tell waits a few seconds after the arrival
    dr.nextTell.set('mirehop@DOOR_L', now());
    const n0 = mock.sounds.length;
    dr.tell(fake, d, P, now());
    check(mock.sounds.slice(n0).some((x) => x === 'fnar.night.knock' || x === 'fnar.night.door_rattle'), 'something at a shut door knocks on it or rattles it');
    dr.nextTell.set('mirehop@DOOR_L', now());
    const n1 = mock.sounds.length;
    dr.tell(fake, { ...d, doorL: false }, P, now());
    check(mock.sounds.slice(n1).includes('fnar.night.breath'), 'something at an open, dark door breathes');
    dr.setHollow('mirehop', true, 10);
    await steps(1);
    check(ent('mirehop')?.props['fnar:hollow'] === true, 'hollow eyes: the pupils go');
    await steps(12);
    check(ent('mirehop')?.props['fnar:hollow'] === false, 'and come back');
    dr.nextAmbient = now();
    const n2 = mock.sounds.length;
    await steps(12);
    check(mock.sounds.slice(n2).some((x) => x.startsWith('fnar.night.')), 'the empty building makes its own sounds');
  }
  // the pizzeria at night: writing only at night, a chalk tally per night, drawings that change, the
  // backstage heads turning to CAM 5 while nobody watches, dying lights, the 4 AM fog
  {
    const ns = game().nightset;
    const CARD = { n: 'north', s: 'south', e: 'east', w: 'west' };
    const facing = (h) => blockAt(h.x, h.y, h.z).permutation.getState('minecraft:cardinal_direction');
    const W0 = ns.writing[0];
    ns.restore(true);
    check(ns.writing.length > 0 && blockAt(W0.x, W0.y, W0.z).typeId === 'minecraft:air', 'by day the writing is gone from the walls');
    ns.begin(4);
    check(blockAt(W0.x, W0.y, W0.z).typeId === 'fnar:wall_writing', 'at night it is back');
    check(ns.tallies.length === 4, `a chalk tally mark outside the left door for every night (${ns.tallies.length} on night 4)`);
    const office = ns.drawings.filter((d) => d.office);
    check(office.length === 2 && office.every((d) => [6, 7].includes(blockAt(d.x, d.y, d.z).permutation.getState('fnar:tile'))), 'from night 4 the drawings in the office are different at night');
    check(ns.heads.length >= 8 && ns.heads.every((h) => facing(h) !== CARD[h.dir]), `the ${ns.heads.length} heads backstage face away when the night starts`);
    const s = game().session;
    const t = s.t;
    s.t = 4 * s.def.ticksPerHour;
    for (let i = 0; i < 40; i++) ns.tickHeads(s, game().rng);
    s.t = t;
    check(ns.heads.every((h) => facing(h) === CARD[h.dir]), 'by 4 AM, with nobody on CAM 5, every head backstage looks at the camera');
    check(ns.dying.length >= 3, `dying lights: a footlight, marquee bulbs (${ns.dying.length})`);
    const c0 = mock.commands.length;
    ns.onHour(4);
    check(mock.commands.slice(c0).some((c) => c.includes('fnar:night_late')), 'at 4 AM the fog thickens');
    ns.restore(false);
    check(ns.heads.every((h) => facing(h) === CARD[h.dir]) && office.every((d) => blockAt(d.x, d.y, d.z).permutation.getState('fnar:tile') !== 6 && blockAt(d.x, d.y, d.z).permutation.getState('fnar:tile') !== 7), 'and it all goes back as built');
    ns.begin(s.night);
  }
  // 3-block animatronics: they stoop through the 3-tall doorways (not the 4-tall hall-to-corner link) and
  // lean in at the office door
  const { inLowDoorway } = await import(path.join(ROOT, 'packs/BP/scripts/mc/puppets.js'));
  check(inLowDoorway({ x: 27.5, y: 0, z: 38.4 }) && !inLowDoorway({ x: 27.5, y: 0, z: 50 }) && !inLowDoorway({ x: 27.5, y: 0, z: 57.6 }),
    'the 3-tall dining-to-hall doorway counts as low; the middle of the hall and the 4-tall corner link do not');
  game().session.chars.mirehop.placeAt('DOOR_L', 'stand');
  await steps(2);
  check(ent('mirehop')?.props['fnar:anim'] === 'lean', `at the left door Mirehop leans in (${ent('mirehop')?.props['fnar:anim']})`);
  {
    // caught in the hall light: the head snaps round to the guard and follows him, it leans in closer,
    // its own sound slowed down, then the guard's name (driven directly: the AI must not move it meanwhile)
    const dr = game().dread;
    const e = ent('mirehop');
    const x0 = e.location.x;
    const lit = { lightL: true, doorL: false, lightR: false, doorR: false };
    const t0 = system.currentTick;
    const n0 = mock.sounds.length;
    for (let i = 0; i <= 90; i += 2) dr.tickDoors(game().session, lit, P, t0 + i);
    check(e.location.x > x0 + 0.3 && e.location.x < x0 + 0.4, `caught in the light, it leans in closer (${(e.location.x - x0).toFixed(2)} blocks)`);
    check(e.props['fnar:look_yaw'] !== 0 || e.props['fnar:look_pitch'] !== 0, `its head follows the guard (yaw ${e.props['fnar:look_yaw']}, pitch ${e.props['fnar:look_pitch']})`);
    check(mock.sounds.slice(n0).includes('fnar.mirehop.strum') && mock.sounds.slice(n0).includes('fnar.hall.whisper'), 'then its own sound, slowed, and a whisper');
    check(String(game().hud.message).includes(P.name), `the whisper is the guard's name (${game().hud.message})`);
    // the door shut in its face: it knocks, then pounds and the view shakes
    const shut = { lightL: false, doorL: true, lightR: false, doorR: false };
    const c0 = mock.commands.length;
    const n1 = mock.sounds.length;
    for (let i = 0; i < 12; i++) {
      dr.nextTell.set('mirehop@DOOR_L', 0);
      dr.tell(game().session.chars.mirehop, shut, P, system.currentTick + 200 * (i + 1));
    }
    check(mock.sounds.slice(n1).includes('fnar.night.knock'), 'at the shut door it knocks');
    check(mock.commands.slice(c0).some((c) => c.startsWith('camerashake')), 'and soon pounds on it hard enough to shake the view');
  }
  // the smarter cast's habits each have a tell: a sound and a caption (core/ai, rendered by game.js)
  {
    const s = game().session;
    const tells = [
      [{ fx: 'cue', kind: 'linger', who: 'mirehop', side: 'L' }, 'fnar.mirehop.strum', /soft twang/],
      [{ fx: 'cue', kind: 'linger', who: 'noxbriar', side: 'R' }, 'fnar.noxbriar.hum', /soft humming/],
      [{ fx: 'cue', kind: 'blink', who: 'rustgrin', from: 'DIN_C' }, 'fnar.rustgrin.laugh', /looked away/],
      [{ fx: 'cue', kind: 'switch', who: 'purple_rat', side: 'R' }, 'fnar.rat.maracas', /other duct/],
      [{ fx: 'cue', kind: 'nervous', who: 'purple_rat', side: 'L' }, null, /squeak in the west duct/],
      [{ fx: 'sound', id: 'fnar.step.heavy', at: 'mirehop', vol: 0.6, approach: 'L' }, 'fnar.step.heavy', /footsteps in the West Hall/],
      [{ fx: 'sound', id: 'fnar.noxbriar.hum', at: 'noxbriar', vol: 0.4, approach: 'R' }, 'fnar.noxbriar.hum', /humming in the East Hall/],
      [{ fx: 'sound', id: 'fnar.cat.growl', at: 'door_l', vol: 0.4, approach: 'L' }, 'fnar.cat.growl', /growl down the West Hall/],
    ];
    for (const [e, sound, caption] of tells) {
      const n0 = mock.sounds.length;
      s.emit(e);
      await steps(5);
      const what = e.kind ?? e.id;
      check(!sound || mock.sounds.slice(n0).includes(sound), `the ${what} tell plays ${sound}`);
      check(caption.test(P.actionBar ?? ''), `the ${what} tell has a caption (got: ${(P.actionBar ?? '').split('\n').at(-1)})`);
    }
  }
  // the cast's tricks (core/ai, rendered by mc/tricks.js): each tell is a sound and a caption
  {
    const s = game().session;
    const tricks = await import(path.join(ROOT, 'packs/BP/scripts/mc/tricks.js'));
    for (const c of Object.values(s.chars)) c.baseAi = 0; // (nobody moves on its own while the tells are checked)
    s.life.enabled = false; // (and no sign of life but the ones the test sends)
    const tells = [
      [{ fx: 'cue', kind: 'squeal', who: 'rustgrin', cam: '4A' }, 'fnar.rustgrin.feedback', /feed squeals.*CAM 4A.*Look away/],
      [{ fx: 'cue', kind: 'burn', who: 'rustgrin', cam: '4A', ticks: 400 }, 'fnar.cam.glitch', /CAM 4A burns out/],
      [{ fx: 'cue', kind: 'knock', who: 'mirehop', side: 'L' }, 'fnar.step.light', /three quick knocks on the left wall/],
      [{ fx: 'cue', kind: 'decoy', who: 'noxbriar', side: 'L' }, 'fnar.noxbriar.hum', /humming in the West Hall - too clear/],
      [{ fx: 'cue', kind: 'playdead', who: 'purple_rat', side: 'L' }, 'fnar.night.twitch', /maracas stop dead in the west duct/],
      [{ fx: 'cue', kind: 'burst', who: 'purple_rat', side: 'R' }, 'fnar.rat.maracas', /frantic rattle in the east duct/],
      [{ fx: 'cue', kind: 'pull', who: 'cat' }, 'fnar.tophat.rewind', /show music warbles.*CAM 8/],
      [{ fx: 'cue', kind: 'pull', who: 'cat', again: true }, 'fnar.tophat.rewind', /still warbling/],
      [{ fx: 'cue', kind: 'pull_end', who: 'cat', rewound: true }, 'fnar.cat.bell', /back on the ring/],
      [{ fx: 'cue', kind: 'places', who: ['mirehop', 'noxbriar'], hold: 180 }, 'fnar.tophat.cane', /Mirehop and Noxbriar go back to the stage/],
      [{ fx: 'cue', kind: 'places_go', who: ['mirehop', 'noxbriar'] }, 'fnar.tophat.cane', /leave the stage together/],
      [{ fx: 'cue', kind: 'clatter', who: 'noxbriar', node: 'KIT' }, 'fnar.rat.bang', /crash of pots in the kitchen/],
      [{ fx: 'cue', kind: 'trade', who: ['mirehop', 'noxbriar'] }, 'fnar.mirehop.strum', /trading halls/],
      [{ fx: 'cue', kind: 'grudge', who: 'mirehop', way: 'L' }, 'fnar.mirehop.strum', /Mirehop remembers last night - the left door again/],
      [{ fx: 'cue', kind: 'grudge', who: 'purple_rat', way: 'VR' }, 'fnar.rat.maracas', /Purple Rat remembers last night - the right vent/],
      // after a trade the tell at a door is still its owner's, on the side it comes from
      [{ fx: 'at_door', who: 'mirehop', side: 'R', window: false }, null, /guitar string twangs - right door/],
      [{ fx: 'at_door', who: 'noxbriar', side: 'L', window: false }, null, /soft humming - left door/],
      [{ fx: 'at_door', who: 'noxbriar', side: 'R', window: true }, null, /soft humming - right window/],
    ];
    for (const [e, sound, caption] of tells) {
      const n0 = mock.sounds.length;
      s.emit(e);
      await steps(10);
      const what = `${e.kind ?? e.fx}${e.again ? ' (again)' : ''}`;
      check(!sound || mock.sounds.slice(n0).includes(sound), `the ${what} tell plays ${sound}`);
      check(caption.test(P.actionBar ?? ''), `the ${what} tell has a caption (got: ${(P.actionBar ?? '').split('\n').at(-1)})`);
      if (e.kind === 'knock') check(mock.sounds.slice(n0).filter((x) => x === 'fnar.step.light').length === 3, 'the knock is three quick taps');
      if (e.kind === 'places') {
        check(ent('top_hat_rat')?.props['fnar:anim'] === 'perform', 'calling "places!", the Ringmaster conducts in his booth');
        await waitFor(() => /\[PA\].*(Mirehop|marks|From the top)/.test(P.actionBar ?? ''), 120, 'the Ringmaster calling "places!" over the PA');
      }
      if (e.kind === 'places_go') check(ent('top_hat_rat')?.props['fnar:anim'] === 'pose', 'and stands posed again once they are sent');
    }
    // a trick that was part of the catch gets its own tip: on the game-over screen, and in the chat
    const c0 = mock.chat.length;
    tricks.killNote({ fx: 'jumpscare', who: 'mirehop', way: 'L', note: 'knock' }, P);
    tricks.killNote({ fx: 'jumpscare', who: 'mirehop', way: 'L', note: null }, P);
    await steps(55);
    check(mock.chat.length === c0 + 1 && /knocks were bait/.test(mock.chat.at(-1)), `a catch by a trick explains the trick (${mock.chat.at(-1)})`);

    // signs of life (core/ai/liveliness.js): a head tilt, a pose for a while, a shuffle out and back
    const m = s.chars.mirehop;
    m.baseAi = 0; // (he stays where the test puts him)
    m.placeAt('DIN_W', 'stand');
    await steps(2);
    const e = ent('mirehop');
    const { NODES } = await import(path.join(ROOT, 'packs/BP/scripts/data/nodes.js'));
    const home = { ...e.location };
    s.emit({ fx: 'idle', kind: 'tilt', who: 'mirehop', node: 'DIN_W', yaw: 30, pitch: 9, dur: 8 });
    await steps(2);
    check(e.props['fnar:look_yaw'] === 30 && e.props['fnar:look_pitch'] === 9, `an idle head tilt turns the head (yaw ${e.props['fnar:look_yaw']}, pitch ${e.props['fnar:look_pitch']})`);
    await steps(10);
    check(e.props['fnar:look_yaw'] === 0 && e.props['fnar:look_pitch'] === 0, 'and it comes back');
    s.emit({ fx: 'idle', kind: 'pose', who: 'mirehop', node: 'DIN_W', pose: 'peek', dur: 8 });
    await steps(2);
    check(e.props['fnar:anim'] === 'peek', `an idle pose change (${e.props['fnar:anim']})`);
    await steps(10);
    check(e.props['fnar:anim'] === 'stand', `goes back to standing (${e.props['fnar:anim']})`);
    const n = NODES.DIN_W;
    s.emit({ fx: 'idle', kind: 'shuffle', who: 'mirehop', node: 'DIN_W', path: [[n.x, n.y, n.z], [n.x + 1.3, n.y, n.z], [n.x, n.y, n.z]], dur: 12 });
    await steps(6);
    const out = Math.hypot(e.location.x - home.x, e.location.z - home.z);
    check(out > 0.8 && e.props['fnar:anim'] === 'walk', `an idle shuffle takes a few steps out (${out.toFixed(2)} blocks)`);
    await steps(10);
    check(Math.hypot(e.location.x - home.x, e.location.z - home.z) < 0.05 && e.props['fnar:anim'] === 'stand', 'and back to where it stood');
    // never for a puppet in a pose of its own, or one that is hidden
    m.placeAt('DOOR_L', 'stand');
    await steps(2);
    s.emit({ fx: 'idle', kind: 'pose', who: 'mirehop', node: 'DOOR_L', pose: 'peek', dur: 8 });
    s.emit({ fx: 'idle', kind: 'shuffle', who: 'mirehop', node: 'DOOR_L', path: [[n.x, n.y, n.z], [n.x + 1.3, n.y, n.z], [n.x, n.y, n.z]], dur: 12 });
    await steps(3);
    check(e.props['fnar:anim'] === 'lean', `a sign of life never breaks a pose of its own: at the door he keeps leaning in (${e.props['fnar:anim']})`);
    // a head on the lens (a camera stare) glances away and comes back to the lens
    m.placeAt('DIN_W', 'stand');
    await steps(2);
    answer((f) => f._title.startsWith(MAP_MARK), () => new Promise(() => {})); // leave the map open
    s.input('cams_open', '1B');
    await steps(60);
    const aimed = [e.props['fnar:look_yaw'], e.props['fnar:look_pitch']];
    s.emit({ fx: 'idle', kind: 'tilt', who: 'mirehop', node: 'DIN_W', yaw: -35, pitch: 10, dur: 8 });
    await steps(2);
    check(e.props['fnar:look_yaw'] === -35 && game().stare.mirehop >= 40, 'watched on a camera, a tilt is a glance away from the lens');
    await steps(10);
    check(e.props['fnar:look_yaw'] === aimed[0] && e.props['fnar:look_pitch'] === aimed[1], `and the head comes back to the lens (${e.props['fnar:look_yaw']}, ${e.props['fnar:look_pitch']} vs ${aimed})`);
    s.input('cams_close');
    await steps(10);
  }
  // night 4: he is glimpsed out of place, and snaps back once watched on CAM 1C
  debug('night', '4');
  await steps(5);
  game().booth.next = 0;
  await steps(3);
  const away = game().booth.at;
  check(away === 'CAB_PEEK' || away === 'CAB_OUT', `night 4: the Ringmaster is glimpsed outside his booth (at ${away})`);
  answer((f) => f._title.startsWith(MAP_MARK), () => new Promise(() => {})); // leave the map open
  game().session.input('cams_open', '1C');
  await steps(70);
  check(game().booth.at === 'CAB' && game().session.chars.top_hat_rat.node === 'CAB', `watched on CAM 1C, he is back in his booth (at ${game().booth.at})`);
  {
    // stared down on a camera, Mirehop slips out of the frame: the watched feed tears
    const n0 = mock.sounds.length;
    game().session.emit({ fx: 'cue', kind: 'slip', who: 'mirehop', cam: '1C' });
    await steps(5);
    check(mock.sounds.slice(n0).includes('fnar.cam.glitch') && /slipped out of view/.test(P.actionBar ?? ''), 'a slip-away tears the feed being watched (glitch and caption)');
  }
  game().session.input('cams_close');
  await steps(10);
}

// 6d. night 5, 4 AM: the takeover -------------------------------------------------------------
debug('night', '5');
await steps(5);
debug('takeover');
await waitFor(() => game().state === 'ENDING', 60, 'the takeover');
check(P.music === null, 'the music stops for the takeover');
await waitFor(() => game().state === 'NIGHT' && game().nightOpts.n === 6, 2000, 'the Final Act after the takeover');
check(mock.titles.some(([t]) => /THANK YOU FOR PLAYING/.test(t)), 'the fake "thank you for playing" screen is shown');
check(mock.titles.some(([t]) => /show is not over/.test(t)), 'the Ringmaster interrupts it');
check(game().save.beaten.includes(5) && game().save.stars >= 1, 'reaching the takeover counts night 5 and earns the first star');
say('night 5 takeover -> the Final Act');

// 6e. the Final Act --------------------------------------------------------------------------
{
  const { CAMS_FOR_NODE } = await import(path.join(ROOT, 'packs/BP/scripts/data/cameras.js'));
  const s6 = () => game().session;
  const seen = { cue: false, applause: false };
  // a guard who does what the Ringmaster says
  const obey = () => {
    const s = s6();
    if (!s || game().state !== 'NIGHT') return;
    const snap = s.snapshot();
    const ev = snap.event;
    const d = s.devices;
    if (/ -> |[0-9]+s$/.test((P.actionBar ?? '').split('\n').find((l) => /s$/.test(l)) ?? '')) seen.cue = true;
    const want = { doorL: false, doorR: false, ventL: false, ventR: false };
    if (ev?.kind === 'summon') {
      if (ev.guard === 'vent') want.ventL = want.ventR = true;
      else if (ev.who === 'cat') want.doorL = want.doorR = true;
      else want[ev.side === 'L' ? 'doorL' : 'doorR'] = true;
    } else if (ev?.kind === 'game') {
      if (ev.game === 'still') return;
      if (ev.game === 'doors') want.doorL = want.doorR = true;
      if (ev.game === 'vents') want.ventL = want.ventR = true;
      if (ev.game === 'cam' || ev.game === 'find') {
        if (!d.cams.open) s.input('cams_open', ev.cam);
        else if (d.cams.cam !== ev.cam) s.input('cam_select', ev.cam);
        return;
      }
      if (ev.game === 'light') {
        if (!(ev.side === 'L' ? d.lightL : d.lightR)) s.input(ev.side === 'L' ? 'light_l' : 'light_r');
        return;
      }
    }
    if (d.cams.open && !(ev?.kind === 'game' && (ev.game === 'cam' || ev.game === 'find'))) s.input('cams_close');
    for (const [k, act] of [['doorL', 'door_l'], ['doorR', 'door_r'], ['ventL', 'vent_l'], ['ventR', 'vent_r']]) if (d[k] !== want[k]) s.input(act);
  };
  // the guard here plays through the session; the camera map just stays open (no random clicks)
  const hold = { on: true };
  answer((f) => hold.on && f._title.startsWith(MAP_MARK), () => new Promise(() => {}), true);
  await waitFor(() => /\[PA\]/.test(P.actionBar ?? '') && /Tester/.test(P.actionBar ?? ''), 300, 'the PA welcome');
  check(mock.sounds.includes('fnar.final.chime'), 'the PA chimes before he speaks');
  await steps(900, obey);
  check(seen.cue, 'Act I shows the summon cue with its countdown');
  check(game().state === 'NIGHT', `the Final Act's Act I can be survived by doing as told (state ${game().state}, killer ${s6()?.killer})`);
  debug('act', '2');
  const applause = mock.sounds.filter((x) => x === 'fnar.final.applause').length;
  await waitFor(() => { obey(); return mock.sounds.filter((x) => x === 'fnar.final.applause').length > applause || game().state !== 'NIGHT'; }, 4000, 'applause for a game done right');
  check(mock.sounds.filter((x) => x === 'fnar.final.applause').length > applause, 'a game done right gets applause');
  await steps(300, obey);
  check(game().state === 'NIGHT', `Act II can be survived by doing as told (state ${game().state}, killer ${s6()?.killer})`);
  debug('act', '3');
  await steps(2);
  const rm = () => s6().chars.top_hat_rat;
  await waitFor(() => { obey(); const r = rm(); return r.out && !r.walk && (CAMS_FOR_NODE[r.node] ?? []).some((c) => s6().camWorking(c)); }, 3000, 'the Ringmaster out of his booth, on a camera');
  const idx0 = rm().idx;
  const camId = CAMS_FOR_NODE[rm().node].find((c) => s6().camWorking(c));
  const spots = mock.sounds.filter((x) => x === 'fnar.final.spot').length;
  hold.on = false;
  answer((f) => f._title.startsWith(MAP_MARK) && /SPOTLIGHT/.test(f.buttons.at(-1) ?? ''), (f) => ({ canceled: false, selection: f.buttons.length - 1 }));
  s6().input('cams_open', camId);
  await waitFor(() => mock.sounds.filter((x) => x === 'fnar.final.spot').length > spots, 60, 'the SPOTLIGHT from the camera map');
  await steps(2);
  check(rm().idx < idx0 || rm().idx === 0, `the SPOTLIGHT drives him back (index ${idx0} -> ${rm().idx} on CAM ${camId})`);
  say(`final act: summons, games and the spotlight work (CAM ${camId}, ${idx0} -> ${rm().idx})`);
  s6().input('cams_close');
  answer(titleHas('COMPLETE'), () => ({ canceled: false, selection: 1 }));
  debug('win');
  await waitFor(() => game().state === 'LOBBY', 1500, 'the lobby after the Final Act');
  check(mock.titles.some(([t]) => /THE END/.test(t)), 'the Final Act ending plays');
  check(game().save.stars >= 2 && game().save.beaten.includes(6), `the Final Act earns the second star (stars ${game().save.stars})`);
}
// 6f. storms, co-op, Extras, challenges and the Encore -----------------------------------------
{
  // night 5 storms: thunder, the halls flash, the power dips
  debug('night', '5');
  await steps(5);
  check(mock.sounds.includes('fnar.storm.rain'), 'night 5 has rain on the roof');
  const pw = game().session.power;
  game().storm.next = mock.tick + 1;
  await steps(3);
  check(mock.sounds.includes('fnar.storm.thunder') && game().session.power < pw, 'thunder rolls and the power flickers');
  // a second player during the shift is the camera operator
  const Q = driver.addPlayer('Buddy', { x: 0.5, y: -60, z: 0.5 });
  world.afterEvents.playerSpawn.fire({ player: Q, initialSpawn: true });
  await steps(15);
  check(game().ops.has(Q.id) && Q.inventory[4]?.typeId === 'fnar:tablet' && Q.gameMode === 'Adventure', 'a second player becomes the camera operator with a tablet');
  answer((f) => f._title.startsWith(MAP_MARK) && /WARN GUARD/.test(f.buttons.at(-1) ?? ''), (f) => ({ canceled: false, selection: f.buttons.length - 1 }));
  world.afterEvents.itemUse.fire({ source: Q, itemStack: { typeId: 'fnar:tablet' } });
  let opView = false;
  await waitFor(() => { opView ||= Q.cameraState === 'free'; return (P.lastMessage ?? '').includes('[Operator] Buddy'); }, 40, 'the operator warning the guard');
  check(opView && !game().session.devices.cams.open, "the operator's cameras are their own (the guard's monitor stays down)");
  debug('lobby');
  await steps(5);
  check(Q.cameraState === 'default', "the operator's view is restored after the shift");
  Q.isValid = false;
  // Extras: the Sound Test, then a challenge
  game().save.beaten = [1, 2, 3, 4, 5];
  answer(titleHas('EXTRAS'), (f) => ({ canceled: false, selection: f.buttons.findIndex((b) => b.startsWith('Sound Test')) }));
  answer(titleHas('SOUND TEST'), (f) => ({ canceled: false, selection: 1 }));
  answer(titleHas('EXTRAS'), (f) => ({ canceled: false, selection: f.buttons.findIndex((b) => b.startsWith('Challenges')) }));
  answer(titleHas('CHALLENGES'), () => ({ canceled: false, selection: 0 }));
  answer(titleHas('LIGHTS OUT'), () => ({ canceled: false, selection: 1 }));
  push('extras');
  await waitFor(() => game().state === 'NIGHT', 200, 'the Lights Out challenge');
  check(mock.sounds.includes('fnar.music.showtime') && game().nightLabel === 'Challenge: Lights Out', `the Sound Test plays and the challenge starts (${game().nightLabel})`);
  check(game().session.input('light_l').reason === 'lights_out', 'Lights Out: the hall lights do not work');
  answer(titleHas('COMPLETE'), () => ({ canceled: false, selection: 1 }));
  debug('win');
  await waitFor(() => game().state === 'LOBBY', 600, 'the lobby after the challenge');
  check(game().save.trophies.includes('lights_out'), 'beating a challenge earns its trophy');
  // Extras: a jumpscare replay hides the player and keeps the lens clear of their own model
  {
    game().save.seenJs = [...new Set([...(game().save.seenJs ?? []), 'mirehop'])];
    const head = P.getHeadLocation();
    const replay = game().previewJumpscare(P, 'mirehop');
    await steps(2);
    const ahead = P.cameraLoc ? Math.hypot(P.cameraLoc.x - head.x, P.cameraLoc.z - head.z) : 0;
    check(P.effects.has('invisibility') && P.cameraState === 'free' && ahead > 0.3, `the Extras jumpscare hides the player and puts the lens ahead of them (invisible ${P.effects.has('invisibility')}, ${ahead.toFixed(2)} ahead)`);
    let done = false;
    replay.then(() => { done = true; });
    await waitFor(() => done, 120, 'the end of the jumpscare replay');
    await steps(2);
    check(!P.effects.has('invisibility') && P.cameraState === 'default' && game().state === 'LOBBY', 'after the replay the player is visible again, back in the lobby');
  }
  // the Encore: after the Final Act the Rusted one waits in the Gallery
  game().save.beaten = [1, 2, 3, 4, 5, 6];
  game().enterLobby();
  await steps(3);
  const rusted = [...mock.entities.values()].find((e) => e.typeId === 'fnar:rusted');
  check(!!rusted, 'the Rusted one waits in the Gallery after the Final Act');
  answer(titleHas('ENCORE'), () => ({ canceled: false, selection: 1 }));
  P.teleport({ x: rusted.location.x + 2.5, y: rusted.location.y, z: rusted.location.z }, { rotation: { x: 10, y: 90 } });
  await waitFor(() => game().state === 'NIGHT' && game().nightOpts.n === 8, 60, 'the Encore night');
  await steps(5);
  check([...mock.entities.values()].some((e) => e.typeId === 'fnar:rusted' && e.tags.has('fnar_puppet_rustgrin')), "in the Encore the Rusted one plays Rustgrin's part");
  answer(titleHas('COMPLETE'), () => ({ canceled: false, selection: 1 }));
  debug('win');
  await waitFor(() => game().state === 'LOBBY', 1200, 'the lobby after the Encore');
  check(game().save.endings.includes('curtain_call') && mock.titles.some(([t]) => /CURTAIN CALL/.test(t)), 'the Encore ends with Curtain Call');
  say('storms, co-op, Extras, a challenge and the Encore ok');
}

// ================================================================================================
// THE GOLDEN DOG (core/ai/golden_dog.js, mc/golden.js): every shift played through the game layer.
// The map under him is the cellar's section above; his rules are in tools/sim/golden_checks.mjs.
// Here: what the player sees and hears, and that everything he bends is put back.
// ================================================================================================
{
  const { CELLAR } = CEL;
  // (--trace prints a failed check of this section at once, with the tick it failed on)
  const check = (ok, what) => { if (!ok) { mock.errors.push(`check failed: ${what}`); if (args.trace) say(`  FAILED at tick ${mock.tick}: ${what}`); } };
  const { NODES } = await import(path.join(ROOT, 'packs/BP/scripts/data/nodes.js'));
  const { CAMERA_BY_ID } = await import(path.join(ROOT, 'packs/BP/scripts/data/cameras.js'));
  const { PALETTE } = await import(path.join(ROOT, 'packs/BP/scripts/data/palette.js'));
  const { CONFIG, GOLDEN, FULL_CAST } = await import(path.join(ROOT, 'packs/BP/scripts/core/config.js'));
  const STORY = await import(path.join(ROOT, 'packs/BP/scripts/data/story.js'));
  const { GOLDEN_BODY, GALLERY_SPOT, looksAt } = await import(path.join(ROOT, 'packs/BP/scripts/mc/golden.js'));
  const G = CONFIG.golden;
  const T = STORY.GOLDEN;
  const sess = () => game().session;
  const gd = () => sess().golden;
  const GM = () => game().golden;
  const dog = () => [...mock.entities.values()].find((e) => e.typeId === 'fnar:golden_dog');
  const ent = (id) => [...mock.entities.values()].find((e) => e.typeId === `fnar:${id}`);
  const local = (v) => ({ x: v.x - origin.x, y: v.y - origin.y, z: v.z - origin.z });
  const at = (e, n, tol = 0.01) => !!e && Math.hypot(local(e.location).x - n.x, local(e.location).y - n.y, local(e.location).z - n.z) <= tol;
  const cnt = (id) => mock.sounds.filter((x) => x === id).length;
  const face = (yaw, pitch = 0) => { P.rotation = { x: pitch, y: yaw }; };
  const bar = () => P.actionBar ?? '';
  const ONLY_HIM = { mirehop: 0, noxbriar: 0, rustgrin: 0, cat: 0, purple_rat: 0, top_hat_rat: 0, golden_dog: 20 };
  /** A night with him awake and nothing else decided for him: he acts only when told to (force). */
  const night = async (n, ai) => {
    golden.on = true;
    game().startNight(P, n, ai ? { ai } : {});
    golden.on = false;
    await steps(5);
    gd().choose = () => null;
  };
  /** One shift, the way he starts every one: the watch first. */
  const force = async (kind) => {
    const watch = cnt('fnar.golden.watch');
    check(gd().force(kind), `the Golden Dog can start ${kind} from his stage`);
    await steps(2);
    check(cnt('fnar.golden.watch') === watch + 1 && gd().state === 'tell', `${kind}: the pocket watch ticks first`);
    await waitFor(() => gd().state === kind, G.tell + 10, `the ${kind} shift after its tell`);
    await steps(1);
  };
  const lobby = async () => { debug('lobby'); await steps(4); };
  const lampLit = () => blockAt(OFFICE.lamp.x, OFFICE.lamp.y, OFFICE.lamp.z).permutation.getState('fnar:lit');
  const stage = NODES[CELLAR.stage];
  const behind = NODES[CELLAR.visit];
  const seatDown = CELLAR.otherOffice.spawn;
  // (the clickable camera map is answered at random by this session's fuzzing policy: these checks work the
  // monitor through the session instead, so the map stays off until the fuzzed night at the end)
  const cursor0 = game().save.settings.camCursor;
  game().save.settings.camCursor = false;

  // ---- CAM 11 through the week: slumped, head up, standing; not there in the Final Act
  {
    const seen = {};
    for (const n of [1, 2, 3]) {
      await night(n);
      const d = dog();
      seen[n] = d ? { on: at(d, stage), anim: d.props['fnar:anim'], eyes: d.props['fnar:eyes'], pitch: d.props['fnar:look_pitch'] } : null;
    }
    check(seen[1]?.on && seen[1].anim === 'slump' && seen[1].eyes === false && seen[1].pitch === 0, `night 1: he is slumped on his stage in the cellar, switched off (${JSON.stringify(seen[1])})`);
    check(seen[2]?.on && seen[2].anim === 'slump' && seen[2].eyes === true && seen[2].pitch < -20, `night 2: his head is up (${JSON.stringify(seen[2])})`);
    check(seen[3]?.on && seen[3].anim === 'stand' && seen[3].eyes === true, `from night 3 he stands (${JSON.stringify(seen[3])})`);
    for (const c of Object.values(sess().chars)) c.baseAi = 0; // (the rest of this night is about him)
    // CAM 11: a stare turns his head to the lens, and he remembers it; the tell empties the stage
    sess().input('cams_open', CELLAR.cam);
    await steps(8);
    const cam = CAMERA_BY_ID[CELLAR.cam];
    check(P.cameraState === 'free' && Math.hypot(P.cameraLoc.x - (cam.loc[0] + origin.x), P.cameraLoc.z - (cam.loc[2] + origin.z)) < 0.01, 'CAM 11 shows the cellar');
    check(/light_block/.test(blockAt(Math.floor(stage.x), stage.y + 3, Math.floor(stage.z)).typeId) || /light_block/.test(blockAt(Math.floor(NODES.CEL_PIT.x), NODES.CEL_PIT.y + 3, Math.floor(NODES.CEL_PIT.z)).typeId), 'the live camera lights what it watches down there');
    await steps(G.stare.after + 6);
    const d = dog();
    check(gd().turned && gd().angry && d.props['fnar:hollow'] === true && (d.props['fnar:look_pitch'] !== 0 || d.props['fnar:look_yaw'] !== 0), `stared at on CAM 11 he turns to the lens (yaw ${d.props['fnar:look_yaw']}, pitch ${d.props['fnar:look_pitch']})`);
    check(bar().includes(T.caption.stare), 'and the caption says to look away');
    await force('gild');
    check(dog().props['fnar:hidden'] === true, 'while he is at work his stage is empty');
    await waitFor(() => gd().state === 'stage', G.gild.lasts + 10, 'the end of the gilding');
    await steps(2);
    check(dog().props['fnar:hidden'] === false && at(dog(), stage), 'and afterwards he is back on it');
    await lobby();
    game().startNight(P, 6);
    await steps(5);
    check(!dog() && !sess().golden.present, 'he is not in the Final Act');
    await lobby();
  }

  // ---- the tell and the hold: the watch, the silence, the cast stopped in its tracks
  {
    await night(7, { ...ONLY_HIM, mirehop: 20 });
    await waitFor(() => game().puppets.isWalking('mirehop'), 900, 'Mirehop to take a walk');
    await steps(3);
    const m = ent('mirehop');
    check(game().audio.loops.has('office') && game().audio.loops.has('building'), 'the building hums as usual');
    check(gd().force('gild'), 'the watch starts while Mirehop is walking');
    await steps(5);
    const p0 = { ...m.location };
    const t0 = sess().t;
    check(bar().includes(T.caption.tell) && bar().includes('tick'), `the caption and the HUD say a watch is ticking (${bar().split('\n').slice(-2).join(' / ')})`);
    await steps(40);
    check(m.location.x === p0.x && m.location.z === p0.z && sess().t === t0 && game().puppets.frozen, 'while the watch ticks Mirehop stands where he was, mid-step: the cast is held');
    check(!game().audio.loops.has('office') && !game().audio.loops.has('building') && !game().audio.loops.has('dread_drone'), 'and the building is silent');
    await waitFor(() => gd().state === 'stage', G.tell + G.gild.lasts + 10, 'the end of the shift');
    await steps(30);
    check(!game().puppets.frozen && sess().t > t0 && (m.location.x !== p0.x || m.location.z !== p0.z), 'when he lets go Mirehop walks on');
    check(game().audio.loops.has('office') && game().audio.loops.has('building'), 'and the building hums again');
    debug('status');
    await steps(2);
    check(mock.chat.some((c) => typeof c === 'string' && /golden:20/.test(c)) && /golden_dog/.test(P.lastMessage ?? ''), 'the status command lists him and what he is doing');
    game().save.cheats.radar = true;
    check(/Golden §fCAM 11/.test(game().radarLine() ?? ''), `the radar cheat shows him too (${game().radarLine()})`);
    game().save.cheats.radar = false;
    await lobby();
  }

  // ---- the Ringmaster stops talking when the watch ticks, and finds his voice again
  {
    await night(4);
    for (const c of Object.values(sess().chars)) c.baseAi = 0;
    check(STORY.CALLS[4].some((l) => /Golden Dog Supper Club, 1958 to 1971/.test(l)), 'on night 4 the Ringmaster has to tell the guard about the cellar');
    await waitFor(() => (game().phoneSeq?.i ?? -1) >= 2, 600, 'the Ringmaster to be in the middle of his call');
    const i0 = game().phoneSeq.i;
    check(gd().force('gild'), 'the watch cuts into the call');
    await steps(G.tell + 40);
    check(game().phoneSeq.i === i0, 'he says nothing while the watch runs');
    await waitFor(() => gd().state === 'stage', G.gild.lasts, 'the end of the shift');
    await waitFor(() => game().phoneSeq?.i > i0, 200, 'him to speak again');
    check(T.interrupted.admit.includes(game().phoneSeq.lines[i0]), `and then he says so (${game().phoneSeq.lines[i0]})`);
    await lobby();
  }

  // ---- gilding: the map's cells for a moment, and back exactly as found; any list will do
  {
    await night(7, ONLY_HIM);
    const snap = () => CELLAR.gild.map((c) => { const b = blockAt(c.x, c.y, c.z).permutation; return `${b.type}${JSON.stringify(b.states)}`; });
    const before = snap();
    await force('gild');
    const now = CELLAR.gild.map((c) => blockAt(c.x, c.y, c.z).typeId);
    await steps(4);
    const office = CELLAR.gild.map((c, i) => [c, i]).filter(([c]) => c.where === 'office');
    const hall = CELLAR.gild.map((c, i) => [c, i]).filter(([c]) => c.where === 'hall');
    check(office.length > 0 && office.every(([c, i]) => now[i] === PALETTE[c.key].name), `with the monitor down the office's ${office.length} gild cells are his`);
    check(hall.every(([, i]) => snap()[i] === before[i]), 'and the hall is left alone (nobody is looking at it)');
    check(bar().includes(T.caption.gild_office), 'the caption says so');
    await waitFor(() => gd().state === 'stage', G.gild.lasts + 10, 'the end of the gilding');
    check(JSON.stringify(snap()) === JSON.stringify(before), 'afterwards every cell is exactly as it was');
    sess().input('cams_open', '4A');
    await steps(8);
    await force('gild');
    const now2 = CELLAR.gild.map((c) => blockAt(c.x, c.y, c.z).typeId);
    check(hall.length > 0 && hall.every(([c, i]) => now2[i] === PALETTE[c.key].name) && office.every(([, i]) => snap()[i] === before[i]), `with the monitor up it is the hall's ${hall.length} cells (the paw prints and the drawing)`);
    await waitFor(() => gd().state === 'stage', G.gild.lasts + 10, 'the end of the gilding');
    check(JSON.stringify(snap()) === JSON.stringify(before), 'and they are cleared again (the paw prints\' cells are empty as built)');
    sess().input('cams_close');
    // a list of somebody else's making: an empty cell, a wall, and a cell that holds a light (left alone)
    const o = OFFICE.spawn;
    const fake = [{ x: Math.floor(o.x), y: 3, z: Math.floor(o.z) + 1, key: 'gild_poster_0', where: 'x' }, { x: OFFICE.lamp.x, y: OFFICE.lamp.y, z: OFFICE.lamp.z, key: 'gild_poster_1', where: 'x' }, { x: Math.floor(o.x) + 1, y: 3, z: Math.floor(o.z) + 1, key: 'gild_poster_2', where: 'x' }];
    blockAt(fake[2].x, fake[2].y, fake[2].z).setPermutation(BlockPermutation.resolve('minecraft:light_block_7'));
    const fsnap = () => fake.map((c) => { const b = blockAt(c.x, c.y, c.z).permutation; return `${b.type}${JSON.stringify(b.states)}`; });
    const f0 = fsnap();
    GM().gild('anything', fake);
    const f1 = fake.map((c) => blockAt(c.x, c.y, c.z).typeId);
    check(f1[0] === PALETTE.gild_poster_0.name && f1[1] === PALETTE.gild_poster_1.name && /light_block/.test(f1[2]), `gilding works for any list of cells (${f1.join(', ')}); a light in the way is not his to move`);
    GM().ungild();
    check(JSON.stringify(fsnap()) === JSON.stringify(f0), 'and every one of them is put back as found');
    GM().gild('office', []);
    GM().ungild();
    blockAt(fake[2].x, fake[2].y, fake[2].z).setPermutation(BlockPermutation.resolve('minecraft:air'));
    // a night that ends in the middle of it still puts everything back
    const gilt = () => CELLAR.gild.filter((c) => { const b = blockAt(c.x, c.y, c.z).permutation; const want = PALETTE[c.key]; return b.type === want.name && Object.entries(want.states ?? {}).every(([k, v]) => b.states[k] === v); }).length;
    await force('gild');
    check(gilt() === office.length, `${office.length} cells are gilt`);
    await lobby();
    check(gilt() === 0, 'a night abandoned in the middle of a gilding leaves no gold behind');
  }

  // ---- the false dawn
  {
    await night(7, ONLY_HIM);
    debug('hour', '3');
    await steps(3);
    const titles = mock.titles.length;
    const real = cnt('fnar.clock.6am');
    await force('dawn');
    await steps(6);
    const card = mock.titles.slice(titles).find(([t]) => t === T.dawn.card[0]);
    check(cnt('fnar.golden.chime') === 1 && !!card && /Custom Night complete/.test(card[1] ?? ''), `the false dawn: the chime (off-key) and the 6 AM card of the real thing (${JSON.stringify(card)})`);
    check(/6 AM/.test(bar()) && game().state === 'NIGHT' && !sess().result, 'the clock on the HUD says 6 AM, and the night goes on');
    await waitFor(() => gd().state === 'stage', G.dawn.lasts + 10, 'the false dawn to tear away');
    await steps(5);
    check(mock.titles.slice(titles).some(([t]) => t === T.dawn.torn[0]) && /3 AM/.test(bar()), 'it tears away: 3 AM again');
    check(game().state === 'NIGHT' && cnt('fnar.clock.6am') === real && cnt('fnar.golden.tear') >= 2, 'nothing was won: the real chime never played, and the tear is heard as it starts and as it ends');
    await lobby();
  }

  // ---- the wrong feed
  {
    await night(7, ONLY_HIM);
    const cam11 = CAMERA_BY_ID[CELLAR.cam];
    const on11 = () => P.cameraState === 'free' && Math.hypot(P.cameraLoc.x - (cam11.loc[0] + origin.x), P.cameraLoc.y - (cam11.loc[1] + origin.y), P.cameraLoc.z - (cam11.loc[2] + origin.z)) < 0.01;
    sess().input('cams_open', '1A');
    await steps(8);
    check(!on11(), 'the monitor is on CAM 1A');
    await force('feed');
    await steps(5);
    check(on11() && sess().devices.cams.cam === '1A' && bar().includes('THE GOLD ROOM'), `the wrong feed: CAM 1A shows the cellar's empty stage (${bar().split('\n')[0]})`);
    check(dog().props['fnar:hidden'] === true && game().camCover() === null, 'the stage on it is empty (he is at work), and nothing covers the picture');
    sess().input('cam_select', '2A');
    await steps(5);
    check(on11() && sess().devices.cams.cam === '2A' && bar().includes(T.caption.pick.split(' (')[0]), 'another camera picked: the cellar again, and something stood up down there');
    sess().input('cams_close');
    await steps(4);
    check(gd().state === 'stage' && P.cameraState === 'default', 'lowering the monitor ends it');
    await steps(8);
    sess().input('cams_open', '1A');
    await steps(8);
    check(!on11() && P.cameraState === 'free', 'and the cameras are their own again');
    // three cameras picked in a row bring him up
    await force('feed');
    for (const c of ['1B', '2A', '4A']) { sess().input('cam_select', c); await steps(5); }
    await steps(2);
    check(gd().state === 'visit' && !sess().devices.cams.open && P.cameraState === 'default' && at(dog(), behind), 'three cameras picked in a row: the monitor drops and he is standing behind the seat');
    face(OFFICE.spawn.yaw);
    await waitFor(() => gd().state === 'stage', G.visit.lasts + 10, 'the end of the visit');
    check(!sess().result, 'eyes forward, the guard is none the worse for it');
    await lobby();
  }

  // ---- the mirror
  {
    await night(7, ONLY_HIM);
    await force('mirror');
    await steps(4);
    const B = OFFICE.buttons;
    const lit = (b) => blockAt(b.x, b.y, b.z).permutation.getState('fnar:on');
    check(bar().includes('LEFT IS RIGHT'), `the HUD says left is right (${bar().split('\n').find((l) => /LEFT/.test(l))})`);
    click(B.door_l.x, B.door_l.y, B.door_l.z);
    await steps(8);
    check(sess().devices.doorR && !sess().devices.doorL && lit(B.door_r) === true && lit(B.door_l) === false, 'the LEFT door button drops the RIGHT door (and the right button lights)');
    click(B.light_r.x, B.light_r.y, B.light_r.z);
    await steps(6);
    check(sess().devices.lightL && !sess().devices.lightR, 'the RIGHT light button lights the LEFT hall');
    click(B.door_l.x, B.door_l.y, B.door_l.z);
    await steps(8);
    click(B.light_r.x, B.light_r.y, B.light_r.z);
    await waitFor(() => gd().state === 'stage', G.mirror.lasts + 10, 'the mirror to pass');
    await steps(6);
    click(B.door_l.x, B.door_l.y, B.door_l.z);
    await steps(8);
    check(sess().devices.doorL && !sess().devices.doorR && !bar().includes('LEFT IS RIGHT'), 'ten seconds later left is left again');
    await lobby();
  }

  // ---- the visit
  {
    await night(7, ONLY_HIM);
    const breaths = cnt('fnar.golden.breath');
    await steps(120); // (the night's opening has the lamp out for its first seconds)
    check(lampLit() === true, `the office lamp is on (${JSON.stringify(blockAt(OFFICE.lamp.x, OFFICE.lamp.y, OFFICE.lamp.z).permutation)})`);
    await force('visit');
    await steps(8);
    const d = dog();
    check(at(d, behind) && d.props['fnar:anim'] === 'idle' && d.props['fnar:hidden'] === false && d.rotation?.y === behind.yaw, `the visit: he stands behind the seat, facing the guard's back (${JSON.stringify(local(d.location))})`);
    check(lampLit() === false && cnt('fnar.golden.breath') > breaths, 'the lamp dims, and something breathes');
    check(bar().includes('DO NOT TURN AROUND') && bar().includes(T.caption.visit), 'the HUD and the caption say what to do');
    check(sess().usage() <= 2 && !game().audio.loops.has('office'), 'the cast is held: the building is silent and the meter runs on his time');
    // eyes forward, then a glance to the side: he is at the edge of the screen, not looked at
    face(OFFICE.spawn.yaw);
    await steps(10);
    const yawTo = (Math.atan2(-(behind.x - OFFICE.spawn.x), behind.z - OFFICE.spawn.z) * 180) / Math.PI;
    face(yawTo + 55);
    await steps(10);
    check(gd().shift.looked === 0 && !looksAt(P, behind, 30), 'looking at a door, he is only at the edge of the screen: that is not looking at him');
    // turning round: he saw it
    const stings = cnt('fnar.hall.sting');
    face(yawTo, -10);
    await steps(6);
    check(gd().shift.looked >= 4 && gd().shift.seen && cnt('fnar.hall.sting') === stings + 1 && bar().includes('LOOK AWAY'), `turning round to him: he saw the guard look (${gd().shift.looked} ticks), and the HUD says LOOK AWAY`);
    check(d.props['fnar:look_yaw'] !== undefined, 'his head comes round');
    face(OFFICE.spawn.yaw);
    await steps(6);
    const looked = gd().shift.looked;
    check(!gd().shift.seen && looked <= G.visit.look, 'looking away in time is forgiven');
    // the monitor shows only his face
    sess().input('cams_open', '1A');
    await steps(8);
    const eye = { x: behind.x + origin.x, y: behind.y + GOLDEN_BODY.eyeY + origin.y, z: behind.z + origin.z };
    const lens = Math.hypot(P.cameraLoc.x - eye.x, P.cameraLoc.y - eye.y, P.cameraLoc.z - eye.z);
    check(P.cameraState === 'free' && lens > 0.8 && lens < 2.2 && bar().includes('HE IS IN THE ROOM') && gd().shift.looked > looked, `raising the monitor shows only his face, and that is looking at him too (the lens ${lens.toFixed(2)} from his eyes)`);
    sess().input('cams_close');
    await steps(3);
    face(OFFICE.spawn.yaw);
    await waitFor(() => gd().state === 'stage', G.visit.lasts + 10, 'the end of the visit');
    await steps(3);
    check(!sess().result && lampLit() === true && at(dog(), stage) && game().audio.loops.has('office'), 'the visit passes: the lamp comes back, the building hums, he is on his stage');
    // looked at too long: he takes the guard (on a night of the week, to see what the cast remembers of it)
    await lobby();
    await night(4);
    for (const c of Object.values(sess().chars)) c.baseAi = 0;
    await steps(40);
    const mem = JSON.stringify(game().save.memory);
    const js = cnt('fnar.js.golden_dog');
    await force('visit');
    face(yawTo, -10);
    answer(titleHas('GAME OVER'), () => ({ canceled: false, selection: 1 }));
    await waitFor(() => game().state === 'JUMPSCARE', G.visit.look + 20, 'him to take the guard');
    await steps(2);
    const shot = dog();
    check(sess().killer === GOLDEN && sess().killWay === 'visit' && cnt('fnar.js.golden_dog') === js + 1 && shot?.props['fnar:anim'] === 'jumpscare', 'looked at for more than a second and a half, he takes the guard: his own scream, his own jumpscare');
    {
      // framed for a body about 3.5 blocks tall: his eyes on the held frame are level with the lens, his head just short of it
      const eyeY = local(shot.location).y + GOLDEN_BODY.jumpscareEyeY;
      const lensY = local(P.cameraLoc).y;
      const ahead = Math.hypot(shot.location.x - P.cameraLoc.x, shot.location.z - P.cameraLoc.z);
      check(Math.abs(eyeY - lensY) < 0.05 && Math.abs(ahead - GOLDEN_BODY.jumpscareDist) < 0.01, `the jumpscare is framed on his own eyes (${eyeY.toFixed(2)} against the lens at ${lensY.toFixed(2)}, ${ahead.toFixed(2)} blocks ahead)`);
    }
    await waitFor(() => game().state === 'LOBBY', 600, 'the lobby after his jumpscare');
    const over = mock.forms.filter((f) => f.title.includes('GAME OVER')).at(-1);
    check(/You looked at him/.test(over?.body ?? ''), `the game-over screen explains it (${over?.body})`);
    check(game().save.seenJs.includes(GOLDEN) && JSON.stringify(game().save.memory) === mem, `his jumpscare is unlocked in Extras; the week's memory does not track him (a night he ended is not remembered: ${mem})`);
    check(lampLit() !== undefined && !game().puppets.frozen, 'nothing of his is left behind');
  }

  // ---- the Other Office
  {
    await night(7, ONLY_HIM);
    const fogPop = () => mock.commands.filter((c) => c === 'fog @a remove fnar_night').length;
    const fogPush = () => mock.commands.filter((c) => c === 'fog @a push fnar:night fnar_night').length;
    const hisLights = () => game().golden.lights.length;
    const pops = fogPop();
    const pushes = fogPush();
    check(gd().force('other'), 'the Other Office can start');
    await waitFor(() => gd().state === 'other', G.tell + 10, 'the lamp to stutter');
    await steps(4);
    check(!gd().away && at(P, OFFICE.spawn, 0.6), 'while the lamp stutters the guard is still in the office');
    await waitFor(() => gd().away, G.other.fade + 10, 'the Other Office');
    await steps(5);
    check(at(P, seatDown, 0.01) && P.rotation.y === OFFICE.spawn.yaw, `the guard sits in the Other Office, in the same seat seven blocks down (${JSON.stringify(local(P.location))})`);
    check(fogPop() > pops, "the night's fog is lifted down there (it ends at 40 blocks, and he is 45 away)");
    // (the seat faces the hall: the guard arrives looking straight at him, and he has already taken his first step)
    check(at(dog(), stage, 1) && dog().props['fnar:hidden'] === false && Math.abs(local(dog().location).z - seatDown.z) > 40, `he is on his stage at the far end of the hall, ${Math.abs(local(dog().location).z - seatDown.z).toFixed(1)} blocks away`);
    check(hisLights() >= 1 && game().audio.loops.has('cellar') && bar().includes('LOOK AT THE DESK'), `there is a little light (${hisLights()} of his), the cellar's air, and the HUD says to look at the desk`);
    // nothing of the real office answers
    check(sess().input('door_l').reason === 'away' && sess().input('cams_open').reason === 'away', 'nothing of the real office answers down there');
    world.afterEvents.itemUse.fire({ source: P, itemStack: { typeId: 'fnar:tablet' } });
    await steps(5);
    check(!sess().devices.cams.open && bar().includes(T.message.away), 'the tablet says so');
    // the seat faces him: he walks while he is watched
    face(seatDown.yaw ?? OFFICE.spawn.yaw, 0);
    const steps0 = cnt('fnar.golden.step');
    await steps(40);
    const z1 = local(dog().location).z;
    check(looksAt(P, { x: stage.x, y: stage.y, z: stage.z }, 20) && z1 > stage.z + 4 && dog().props['fnar:anim'] === 'walk' && cnt('fnar.golden.step') > steps0, `watched, he walks down the aisle (${(z1 - stage.z).toFixed(1)} blocks in two seconds), and his steps are heard`);
    check(game().golden.follow !== null && Math.abs(game().golden.follow[2] - Math.floor(z1)) <= 1 && /light_block/.test(blockAt(...game().golden.follow).typeId), 'his light goes with him, so he can be seen coming');
    // eyes on the desk: he stops
    face(seatDown.yaw ?? OFFICE.spawn.yaw, 50);
    await steps(6);
    const z2 = local(dog().location).z;
    await steps(30);
    check(local(dog().location).z === z2 && dog().props['fnar:anim'] === 'stand' && !sess().looking, 'eyes on the desk: he stops where he is');
    // the guard is kept in the room
    P.teleport(Wl(seatDown.x, seatDown.y, seatDown.z - 10));
    await steps(12);
    check(at(P, seatDown, 0.01), 'the guard is kept in the Other Office (not sent back upstairs)');
    // the phone
    const ph = CELLAR.otherOffice.phone;
    click(ph.x, ph.y, ph.z);
    await steps(5);
    check(gd().away && bar().includes(T.message.quiet), 'the phone is dead until it rings');
    await waitFor(() => gd().shift.ringing, G.other.phone + 20, 'the phone to ring');
    await steps(5);
    check(blockAt(ph.x, ph.y, ph.z).permutation.getState('fnar:ringing') === true && cnt('fnar.golden.phone') >= 1 && bar().includes('PICK UP THE PHONE'), 'the old phone on the desk rings');
    click(ph.x, ph.y, ph.z);
    await steps(4);
    check(!gd().away && gd().state === 'stage' && at(P, OFFICE.spawn, 0.01) && !sess().result, 'picking it up brings the guard back to the real seat');
    check(fogPush() > pushes && hisLights() === 0 && !game().audio.loops.has('cellar') && blockAt(ph.x, ph.y, ph.z).permutation.getState('fnar:ringing') === false && lampLit() === true, "the night's fog, the lamp and the dark of the cellar are as they were");
    check(/The Ringmaster/.test(bar()) && at(dog(), stage), 'the voice on the line was the Ringmaster\'s; the Golden Dog is back on his stage');
    check(sess().input('door_l').ok, 'and the office answers again');
    await lobby();

    // watched all the way to the desk
    await night(7, ONLY_HIM);
    check(gd().force('other'), 'again');
    await waitFor(() => gd().away, G.tell + G.other.fade + 20, 'the Other Office');
    face(OFFICE.spawn.yaw, 0);
    answer(titleHas('GAME OVER'), () => ({ canceled: false, selection: 1 }));
    await waitFor(() => game().state === 'JUMPSCARE', 400, 'him to reach the desk');
    check(sess().killer === GOLDEN && sess().killWay === 'other', 'watched all the way to the desk, he takes the guard');
    await waitFor(() => game().state === 'LOBBY', 600, 'the lobby');
    check(/watched him all the way to the desk/.test(mock.forms.filter((f) => f.title.includes('GAME OVER')).at(-1)?.body ?? ''), 'and the game-over screen says what to do instead');
    check(game().golden.lights.length === 0, 'his lights are gone from the cellar');

    // the power goes while the guard sits there: back upstairs for the blackout
    await night(7, ONLY_HIM);
    check(gd().force('other'), 'once more');
    await waitFor(() => gd().away, G.tell + G.other.fade + 20, 'the Other Office');
    face(OFFICE.spawn.yaw, 50);
    debug('power', '1');
    await waitFor(() => !!sess().powerOut, 400, 'the power to run out');
    await steps(3);
    check(at(P, OFFICE.spawn, 0.01) && gd().state === 'stage' && game().golden.lights.length === 0, 'if the power goes he lets go: the guard is back in the real office for the blackout');
    await lobby();
  }

  // ---- a guard who does everything at random (buttons, monitor, cameras, where they look), with him at 20
  {
    game().save.settings.camCursor = cursor0;
    golden.on = true;
    game().startNight(P, 7, { ai: ONLY_HIM });
    golden.on = false;
    answer(titleHas('GAME OVER'), () => ({ canceled: false, selection: 1 }), true);
    const mine = answers.at(-1);
    const shifts = new Set();
    await steps(3500, (i) => {
      if (game().state !== 'NIGHT') return;
      fuzz(i);
      if (i % 19 === 0) face(rand() * 360 - 180, rand() * 80 - 40);
      const st = game().session?.golden.state;
      if (st && st !== 'stage' && st !== 'tell') shifts.add(st);
      if (i % 29 === 0 && game().session?.golden.away) click(CELLAR.otherOffice.phone.x, CELLAR.otherOffice.phone.y, CELLAR.otherOffice.phone.z, false);
    });
    say(`the Golden Dog at 20 against a fuzzing guard: ${[...shifts].join(', ') || 'no shift'} (state ${game().state})`);
    check(shifts.size >= 1, `a night at level 20 is full of him (${[...shifts].join(', ')})`);
    answers = answers.filter((a) => a !== mine);
    if (game().state !== 'LOBBY') await waitFor(() => game().state === 'LOBBY' || game().state === 'NIGHT', 800, 'the fuzzed night to settle');
    await lobby();
  }

  // ---- the Custom Night's seventh slider, and its saved value
  {
    game().save.beaten = [1, 2, 3, 4, 5, 6];
    let sliders = null;
    answer(titleHas('CUSTOM NIGHT'), () => ({ canceled: false, selection: 0 }));
    answer((f) => f.kind === 'modal' && f._title.includes('CUSTOM NIGHT'), (f) => { sliders = f.controls.map((c) => [c[1], c[2]]); return { canceled: false, formValues: f.controls.map((c, i) => (i === f.controls.length - 1 ? 14 : 0)) }; });
    golden.on = true;
    push('custom');
    await waitFor(() => game().state === 'NIGHT' && game().nightOpts.n === 7, 100, 'the Custom Night');
    golden.on = false;
    await steps(5);
    check(sliders?.length === FULL_CAST.length && sliders.at(-1)[0] === 'The Golden Dog' && sliders.at(-1)[1] === 0, `the Custom Night has a seventh slider, off until it is set (${JSON.stringify(sliders?.at(-1))})`);
    check(sess().golden.level === 14 && sess().golden.enabled && game().save.custom.golden_dog === 14 && at(dog(), stage) && dog().props['fnar:anim'] === 'stand', 'his level is the night\'s, and it is remembered for next time');
    await lobby();
    let again = null;
    answer(titleHas('CUSTOM NIGHT'), () => ({ canceled: false, selection: 0 }));
    answer((f) => f.kind === 'modal' && f._title.includes('CUSTOM NIGHT'), (f) => { again = f.controls.at(-1)[2]; return { canceled: true, cancelationReason: 'UserClosed' }; });
    push('custom');
    await steps(10);
    check(again === 14, `the form opens on the saved value (${again})`);
    check(CONFIG.presets.some((p) => (p.ai.golden_dog ?? 0) > 0) && CONFIG.presets.find((p) => p.id === 'showstopper').ai.golden_dog === undefined, 'one preset is his; the Showstopper is still the six');
  }

  // ---- Extras: his jumpscare, his place in the cast, the Sound Test
  {
    await lobby();
    check(!dog(), 'he is not in the Gallery');
    game().save.seenJs = [...new Set([...(game().save.seenJs ?? []), GOLDEN])];
    let listed = null;
    let poses = null;
    answer(titleHas('EXTRAS'), (f) => ({ canceled: false, selection: f.buttons.findIndex((b) => b.startsWith('The Cast')) }));
    answer(titleHas('THE CAST'), (f) => { listed = [...f.buttons]; return { canceled: false, selection: f.buttons.indexOf('The Golden Dog') }; });
    answer(titleHas('THE GOLDEN DOG'), () => ({ canceled: false, selection: 0 })); // the info box
    answer(titleHas('THE GOLDEN DOG'), (f) => { poses = [...f.buttons]; return { canceled: false, selection: f.buttons.indexOf('Powered down') }; });
    push('extras');
    await steps(12);
    check(listed?.includes('The Golden Dog') && poses?.includes('Standing'), `Extras > The Cast lists him (${listed?.join(', ')})`);
    check(at(dog(), GALLERY_SPOT) && dog().props['fnar:anim'] === 'slump', 'and he can be looked at in the Gallery, in the pose that was picked');
    check(/Golden Dog Supper Club, 1958 to 1971/.test(mock.forms.filter((f) => f.title.includes('THE GOLDEN DOG')).at(-2)?.body ?? ''), 'with a word about who he is');
    let shown = null;
    answer(titleHas('EXTRAS'), (f) => ({ canceled: false, selection: f.buttons.findIndex((b) => b.startsWith('Jumpscares')) }));
    answer(titleHas('JUMPSCARES'), (f) => { shown = [...f.buttons]; return { canceled: false, selection: f.buttons.indexOf('The Golden Dog') }; });
    const js = cnt('fnar.js.golden_dog');
    push('extras');
    await waitFor(() => game().state === 'EXTRAS', 40, 'his jumpscare replay');
    await steps(3);
    check(shown?.includes('The Golden Dog') && cnt('fnar.js.golden_dog') === js + 1 && dog()?.props['fnar:anim'] === 'jumpscare', 'Extras > Jumpscares replays his, once he has been seen');
    await waitFor(() => game().state === 'LOBBY', 200, 'the lobby after the replay');
    let tracks = null;
    answer(titleHas('EXTRAS'), (f) => ({ canceled: false, selection: f.buttons.findIndex((b) => b.startsWith('Sound Test')) }));
    answer(titleHas('SOUND TEST'), (f) => { tracks = [...f.buttons]; return { canceled: false, selection: f.buttons.indexOf('A pocket watch') }; });
    const w = cnt('fnar.golden.watch');
    push('extras');
    await steps(8);
    check(tracks?.includes("The Golden Dog's scream") && tracks.includes('The cellar') && cnt('fnar.golden.watch') === w + 1, 'the Sound Test has his watch, the cellar and his scream');
    await steps(3);
    check(game().trophies().find((t) => /every jumpscare/.test(t[0]))?.[1] === ['mirehop', 'noxbriar', 'rustgrin', 'cat', 'purple_rat', 'top_hat_rat', GOLDEN, 'rusted'].every((id) => game().save.seenJs.includes(id)), 'the "every jumpscare" trophy counts his too');
  }

  // ---- Free Roam: he stands on his stage, he does not talk, and he is not quite as he was
  {
    game().enterFreeRoam();
    await steps(5);
    const d = dog();
    check(at(d, stage) && d.props['fnar:anim'] === 'stand' && d.props['fnar:eyes'] === false, 'by day he stands on his stage in the Gold Room, switched off');
    check(!game().audio.loops.has(`cellar_${P.id}`), 'upstairs the pizzeria sounds like the pizzeria');
    // down the stairs, up the aisle, looking at him
    P.teleport(Wl(stage.x, stage.y, stage.z + 5), { rotation: { x: -15, y: 180 } });
    await steps(12);
    check(game().audio.loops.has(`cellar_${P.id}`) && cnt('fnar.golden.cellar') >= 1, 'in the cellar its own air plays');
    check(d.props['fnar:look_pitch'] !== 0 || d.props['fnar:look_yaw'] !== 0, `his head follows whoever looks at him (yaw ${d.props['fnar:look_yaw']}, pitch ${d.props['fnar:look_pitch']})`);
    check(T.silent.some((l) => bar().includes(l)), `he does not talk (${bar().split('\n')[0]})`);
    check(!Object.keys(STORY.DAY_TALK).includes(GOLDEN), 'he has no lines at all');
    const was = JSON.stringify([d.props['fnar:anim'], d.props['fnar:eyes'], d.rotation, local(d.location)]);
    // look away for a few seconds, and back
    face(0, 0);
    await steps(60);
    check(game().golden.roam.changed === true, 'looked away from, he moves');
    const servo = cnt('fnar.servo.head');
    face(180, -15);
    await steps(8);
    const is = JSON.stringify([d.props['fnar:anim'], d.props['fnar:eyes'], d.rotation, local(d.location)]);
    check(is !== was && game().golden.roam.changed === false && servo >= 1, `and looked at again he is not quite as he was (${was} -> ${is})`);
    check(Math.hypot(local(d.location).x - stage.x, local(d.location).z - stage.z) <= 1 && local(d.location).y === stage.y, 'but he never leaves his stage');
    // a show upstairs: he is not in it
    game().roam.nextShow = mock.tick + 5;
    await waitFor(() => game().roam.phase === 'show', 40, 'a show');
    await steps(5);
    check(!/perform/.test(d.props['fnar:anim']) && /perform/.test(ent('rustgrin').props['fnar:anim']), 'when the band plays upstairs, he does not perform');
    P.teleport(Wl(OFFICE.spawn.x, 0, OFFICE.spawn.z), { rotation: { x: 0, y: 0 } });
    await steps(8);
    check(!game().audio.loops.has(`cellar_${P.id}`), 'back upstairs the cellar is out of earshot');
    await lobby();
    check(!dog() && game().golden.roam === null, 'and when the day is over he is put away with the rest');
  }
  say('the Golden Dog: CAM 11, the tell and the hold, gilding, the false dawn, the wrong feed, the mirror, the visit, the Other Office and back, the Custom Night, Extras and Free Roam ok');
}
// ================================================================================================
// ---- end of the Golden Dog's section

// 7. custom night: showstopper ---------------------------------------------------------------
debug('unlock');
await steps(2);
game().save.beaten.push(6);
answer(titleHas('CUSTOM NIGHT'), (f) => ({ canceled: false, selection: f.buttons.findIndex((b) => b.startsWith('SHOWSTOPPER')) }));
push('custom');
await waitFor(() => game().state === 'NIGHT' && game().nightOpts.n === 7, 100, 'custom night');
await steps(2500, fuzz);
say(`custom night after 2500 ticks: state ${game().state} ${game().session?.debugLine() ?? ''}`);
if (game().state === 'NIGHT') {
  answer(titleHas('COMPLETE'), () => ({ canceled: false, selection: 1 }));
  debug('win');
  await waitFor(() => game().state === 'LOBBY', 1500, 'lobby after the showstopper');
  say(`showstopper won: stars ${game().save.stars}`);
} else {
  await waitFor(() => game().state === 'LOBBY' || game().state === 'NIGHT', 1500, 'after custom');
}
// 8. power out -------------------------------------------------------------------------------
if (game().state !== 'NIGHT') { debug('night', '3'); await steps(5); }
debug('power', '1');
answer(titleHas('GAME OVER'), () => ({ canceled: false, selection: 1 }), true);
answer(titleHas('COMPLETE'), () => ({ canceled: false, selection: 1 }), true);
await waitFor(() => game().state === 'LOBBY', 3000, 'power out to lobby');
say(`power out sequence ok (${mock.sounds.filter((s) => s === 'fnar.rustgrin.song').length} song plays)`);

// report ----------------------------------------------------------------------------------------
const errs = mock.errors.filter((e) => !/^\[FNaR\] (FIVE|ready)/.test(e));
say(`\nforms shown: ${mock.forms.length}, sounds: ${mock.sounds.length}, commands: ${mock.commands.length}, entities alive: ${mock.entities.size}`);
say(`missing sound events: ${missingSounds.size ? [...missingSounds].sort().join(', ') : 'none'}`);
const chatText = (m) => (typeof m === 'string' ? m : (m?.rawtext ?? []).map((r) => r.text ?? `{${r.translate}}`).join(''));
check(mock.chat.some((m) => typeof m === 'object' && m.rawtext?.some((r) => r.translate === 'fnar.version.rp')), 'the welcome message shows the resource pack version');
say(`chat: ${mock.chat.length} lines${mock.chat.length ? ` (first: ${chatText(mock.chat[0])})` : ''}`);
const warnCounts = {};
for (const w of mock.warnings) { const k = w.replace(/[-\d.,@ ]+/g, ' ').slice(0, 90); warnCounts[k] = (warnCounts[k] ?? 0) + 1; }
say(`warnings: ${mock.warnings.length}`);
for (const [k, n] of Object.entries(warnCounts).sort((a, b) => b[1] - a[1]).slice(0, 25)) say(`  ${n}x ${k}`);
say(`errors: ${errs.length}`);
for (const e of errs.slice(0, 20)) say('  ' + e.slice(0, 600));
process.exit(errs.length ? 1 : 0);
