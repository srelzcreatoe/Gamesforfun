// Runs the real behavior-pack scripts against the strict mock API through a
// scripted play session: setup + build, lobby, night 1 with a fuzzing guard,
// 6 AM, night 2 lost on purpose, retry, free roam, custom night (showstopper).
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
await steps(40);
check(cams().open, 'a busy player (UserBusy) does not lower the monitor');
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
// 6. free roam ------------------------------------------------------------------------------
push('free_roam');
await waitFor(() => game().state === 'FREE_ROAM', 50, 'free roam');
await steps(400);
answer(titleHas('FREE ROAM'), () => ({ canceled: false, selection: 1 }));
world.afterEvents.itemUse.fire({ source: P, itemStack: { typeId: 'fnar:guide' } });
await waitFor(() => game().state === 'LOBBY', 100, 'lobby after free roam');
say('free roam ok');

// 6b. nothing lives in the pizzeria but the cast --------------------------------------------------
{
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
say(`chat: ${mock.chat.length} lines${mock.chat.length ? ` (first: ${mock.chat[0]})` : ''}`);
const warnCounts = {};
for (const w of mock.warnings) { const k = w.replace(/[-\d.,@ ]+/g, ' ').slice(0, 90); warnCounts[k] = (warnCounts[k] ?? 0) + 1; }
say(`warnings: ${mock.warnings.length}`);
for (const [k, n] of Object.entries(warnCounts).sort((a, b) => b[1] - a[1]).slice(0, 25)) say(`  ${n}x ${k}`);
say(`errors: ${errs.length}`);
for (const e of errs.slice(0, 20)) say('  ' + e.slice(0, 600));
process.exit(errs.length ? 1 : 0);
