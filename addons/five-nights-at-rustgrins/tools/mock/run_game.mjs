// Runs the real behavior-pack scripts against the strict mock API through a
// scripted play session: setup + build, lobby, night 1 with a fuzzing guard,
// 6 AM, night 2 lost on purpose, retry, free roam, custom night (showstopper).
//   node --import ./tools/mock/register.mjs tools/mock/run_game.mjs [--seed=1] [--quick]
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
push('new_game');
await waitFor(() => game().state === 'NIGHT', 200, 'night 1 start');
say(`night 1 started (guard mode ${P.gameMode})`);

// 3. a fuzzing guard -------------------------------------------------------------
const { OFFICE } = await import(path.join(ROOT, 'packs/BP/scripts/data/layout.js'));
const buttons = Object.values(OFFICE.buttons);
const fuzz = (i) => {
  const s = game().session;
  if (!s || game().state !== 'NIGHT') return;
  const r = rand();
  if (i % 37 === 0) world.afterEvents.itemUse.fire({ source: P, itemStack: { typeId: 'fnar:tablet' } });
  if (i % 53 === 0 && s.devices.cams.open) world.afterEvents.playerButtonInput.fire({ player: P, button: 'Sneak', newButtonState: 'Pressed' });
  if (i % 41 === 0 && s.devices.cams.open) world.afterEvents.playerHotbarSelectedSlotChange.fire({ player: P, previousSlotSelected: 4, newSlotSelected: r < 0.5 ? 5 : 3 });
  if (i % 23 === 0) { const b = buttons[Math.floor(rand() * buttons.length)]; components['fnar:control'].onPlayerInteract({ player: P, block: blockAt(b.x, b.y, b.z) }); }
  if (i % 97 === 0) world.afterEvents.playerInteractWithBlock.fire({ player: P, block: blockAt(OFFICE.monitor.x, OFFICE.monitor.y, OFFICE.monitor.z), isFirstEvent: true });
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
await waitFor(() => game().state === 'LOBBY', 600, 'back to the lobby');
say('back in the lobby after a loss');
// 6. free roam ------------------------------------------------------------------------------
push('free_roam');
await waitFor(() => game().state === 'FREE_ROAM', 50, 'free roam');
await steps(400);
answer(titleHas('FREE ROAM'), () => ({ canceled: false, selection: 1 }));
world.afterEvents.itemUse.fire({ source: P, itemStack: { typeId: 'fnar:guide' } });
await waitFor(() => game().state === 'LOBBY', 100, 'lobby after free roam');
say('free roam ok');
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
const warnCounts = {};
for (const w of mock.warnings) { const k = w.replace(/[-\d.,@ ]+/g, ' ').slice(0, 90); warnCounts[k] = (warnCounts[k] ?? 0) + 1; }
say(`warnings: ${mock.warnings.length}`);
for (const [k, n] of Object.entries(warnCounts).sort((a, b) => b[1] - a[1]).slice(0, 25)) say(`  ${n}x ${k}`);
say(`errors: ${errs.length}`);
for (const e of errs.slice(0, 20)) say('  ' + e.slice(0, 600));
process.exit(errs.length ? 1 : 0);
