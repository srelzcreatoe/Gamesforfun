// Integration tests: the real behavior-pack scripts (main.js, Game, builder,
// actuator bus, puppets, camera view, persistence, debug tools) running
// against the headless mock of @minecraft/server in tests/mock/.
//
// These prove the scripts, the generated .mcstructure command blocks and the
// build plan work together as designed INSIDE THE MOCK. They are not an
// in-game playthrough: rendering, physics, redstone timing and the real
// engine are not involved (see docs/10_TEST_REPORT.md).
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

register('./mock/loader.mjs', import.meta.url);

const { mock, STATE, world, system, BlockPermutation, executeCommand } = await import('./mock/minecraft-server.mjs');
const { uiMock } = await import('./mock/minecraft-server-ui.mjs');
const { Game } = await import('../packs/FredbearBP/scripts/mc/game.js');
const { installDebug, registerCommands, handleDebug } = await import('../packs/FredbearBP/scripts/mc/debug.js');
const { INPUT_BY_ID, inputCbPos } = await import('../packs/FredbearBP/scripts/data/inputs.js');
const { ANCHORS } = await import('../packs/FredbearBP/scripts/data/layout.js');
const { NODE_BY_ID } = await import('../packs/FredbearBP/scripts/data/nodes.js');
const { PALETTE } = await import('../packs/FredbearBP/scripts/data/palette.js');
const { W, Wv } = await import('../packs/FredbearBP/scripts/mc/world_io.js');
const { allCommandBlocks } = await import('../tools/gen_structures.mjs');
const { buildVoxel, BOUNDS } = await import('../tools/voxel.mjs');
const { Rng } = await import('../packs/FredbearBP/scripts/core/rng.js');

const HOME = { freddy: 'STAGE_F', bonnie: 'STAGE_B', chica: 'STAGE_C', fredbear: 'CHAMBER_F', morgrave: 'M_HOME', valek: 'V_HOME' };
const TYPES = { freddy: 'fb:freddy', bonnie: 'fb:bonnie', chica: 'fb:chica', fredbear: 'fb:fredbear', morgrave: 'fb:morgrave', valek: 'fb:valek' };

let game;
let player;
let commands;

function startGame() {
  game = new Game();
  installDebug(game);
  game.start();
  commands = new Map();
  registerCommands({ registerCommand: (def, cb) => commands.set(def.name, cb) }, () => game);
  return game;
}

/** Press the physical control wired to an input command block. */
function press(inputId) {
  const inp = INPUT_BY_ID[inputId];
  assert.ok(inp, `input ${inputId}`);
  const w = W(...inputCbPos(inp));
  mock.activateCommandBlockAt(w.x, w.y, w.z);
}

const at = (x, y, z) => {
  const w = W(x, y, z);
  return mock.blockAt(w.x, w.y, w.z);
};
const typeAt = (x, y, z) => at(x, y, z).split('[')[0];
const box = (x1, y1, z1, x2, y2, z2) => {
  const out = [];
  for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) out.push(typeAt(x, y, z));
  return out;
};

async function until(pred, max = 2000, step = 1) {
  for (let t = 0; t < max; t += step) {
    if (pred()) return t;
    await mock.tick(step);
  }
  assert.fail(`condition not reached within ${max} ticks`);
}

function noMockErrors() {
  assert.deepEqual(STATE.errors, [], 'API misuse detected by the mock');
  assert.deepEqual(STATE.handlerErrors, [], 'exceptions in event handlers / scheduled callbacks');
}

function puppetsOf(type) {
  return mock.entities().filter((e) => e.typeId === type && e.isValid);
}

async function goToOfficeAndStart() {
  player.teleport(Wv(ANCHORS.officeSeat));
  press('in.office.start');
  await mock.tick(3);
  if (game.state === 'FLASHBACK') {
    // First night 4 shows the 1983 memory; sneaking skips it (tested on its own below).
    mock.sneak(player);
    await mock.tick(3);
  }
  assert.equal(game.state, 'NIGHT');
}

/** Everything a full reset promises (game.js fullReset header). */
async function assertCleanLobby() {
  await mock.tick(30); // let the reset command-block chains run
  assert.equal(game.state, 'LOBBY');
  assert.equal(game.session, null);
  assert.equal(world.getDynamicProperty('fb:session'), undefined, 'interrupted-night marker cleared');
  for (const [who, type] of Object.entries(TYPES)) {
    const list = puppetsOf(type);
    assert.equal(list.length, 1, `exactly one ${who}`);
    const n = Wv(NODE_BY_ID[HOME[who]]);
    const l = list[0].location;
    assert.ok(Math.hypot(l.x - n.x, l.y - n.y, l.z - n.z) < 0.01, `${who} back home`);
    assert.equal(list[0].getProperty('fb:hidden'), false);
  }
  assert.equal(puppetsOf('fb:fredbear_echo').length, 0, 'no echo left');
  assert.deepEqual([...new Set(box(94, 0, 129, 94, 2, 130))], ['minecraft:air'], 'left doorway open');
  assert.deepEqual([...new Set(box(106, 0, 129, 106, 2, 130))], ['minecraft:air'], 'right doorway open');
  for (const t of [...box(91, 0, 127, 93, 3, 133), ...box(107, 0, 127, 109, 3, 133), ...box(95, 0, 127, 105, 5, 139)]) {
    assert.ok(!['minecraft:light_block_14', 'minecraft:light_block_7', 'minecraft:light_block_15', 'minecraft:light_block_12'].includes(t), `stray light ${t}`);
  }
  assert.equal(player.cameraState.preset, null, 'normal camera');
  assert.ok(!player.effects.has('minecraft:night_vision'), 'night vision removed');
  for (const v of Object.values(player.permissions)) assert.equal(v, true, 'input permissions restored');
  assert.deepEqual(player.inventory.slots.slice(0, 3).map((s) => s?.typeId), ['fb:tablet', 'fb:remote', 'fb:guide']);
  assert.equal(player.inventory.slots[0].lockMode, 'slot');
  assert.equal(game.cams.active, false);
  assert.equal(game.tour, null, 'no camera tour running');
  assert.equal(game.musicPlaying, false, 'night music stopped');
  assert.equal(player.music ?? null, null, 'no music track left playing');
  assert.equal(game.audio.loops.size, 0);
  assert.equal(game.bus.queue.length, 0, 'actuator queue drained');
  assert.equal(game.bus.stats.stuck, 0, 'no stuck pads');
  assert.equal(game.bus.stats.unknown, 0, 'no unknown actuators');
  const lobby = Wv(ANCHORS.lobbySpawn);
  assert.ok(Math.hypot(player.location.x - lobby.x, player.location.z - lobby.z) < 0.01, 'player at the time clock');
  noMockErrors();
}

// ------------------------------------------------------------------------------------------
test('main.js wiring: custom commands at startup, unbuilt prompt after world load', async () => {
  mock.resetAll();
  uiMock.reset();
  await import('../packs/FredbearBP/scripts/main.js');
  const cmds = mock.fireStartup();
  assert.deepEqual([...cmds.keys()].sort(), ['fb:debug', 'fb:lobby', 'fb:setup']);
  mock.fireWorldLoad();
  player = mock.addPlayer('Guard');
  await mock.tick(60);
  assert.match(player.actionBar, /fb:setup/);
  noMockErrors();
  mock.reload(); // drop main.js's instance; the rest of the file drives its own Game
});

test('structure ids resolve as fb:<name>, or by file name under another namespace', async () => {
  const { resolveStructureId } = await import('../packs/FredbearBP/scripts/mc/builder.js');
  assert.equal(resolveStructureId('fb:cb_row_0', new Set(['fb:cb_row_0'])), 'fb:cb_row_0');
  assert.equal(resolveStructureId('fb:cb_row_0', new Set(['mystructure:cb_row_0'])), 'mystructure:cb_row_0');
  assert.equal(resolveStructureId('fb:cb_row_0', new Set(['fb/cb_row_0'])), 'fb/cb_row_0');
  assert.equal(resolveStructureId('fb:cb_row_9', new Set(['fb:cb_row_0'])), undefined);
});

test('/fb:setup builds the whole map, installs every command block and reaches the lobby', async () => {
  startGame();
  assert.equal(game.state, 'UNBUILT');
  commands.get('fb:setup')({ sourceEntity: player }, false);
  await until(() => game.state === 'LOBBY', 5000, 10);
  assert.equal(mock.commandBlockCount(), allCommandBlocks().length);
  assert.equal(mock.commandBlockCount(), 523);
  assert.ok(STATE.maxFill <= 32768, `largest single fill ${STATE.maxFill}`);
  assert.equal(uiMock.shown.filter((f) => f.title === 'Build report').length, 0, 'no build warnings');
  await assertCleanLobby();
});

test('the built world equals the offline voxel model outside command-block-controlled cells', () => {
  const vox = buildVoxel();
  // Cells that command blocks legitimately change after the build.
  const skip = new Set();
  const mark = (x, y, z) => skip.add(`${x},${y},${z}`);
  for (const b of allCommandBlocks()) {
    mark(...b.world);
    if (b.pad) mark(...W(...b.pad).x === undefined ? b.pad : [W(...b.pad).x, W(...b.pad).y, W(...b.pad).z]);
    const t = b.command.split(/\s+/);
    if (t[0] === 'setblock') mark(+t[1], +t[2], +t[3]);
    if (t[0] === 'fill') {
      for (let x = Math.min(+t[1], +t[4]); x <= Math.max(+t[1], +t[4]); x++) {
        for (let y = Math.min(+t[2], +t[5]); y <= Math.max(+t[2], +t[5]); y++) for (let z = Math.min(+t[3], +t[6]); z <= Math.max(+t[3], +t[6]); z++) mark(x, y, z);
      }
    }
  }
  const expected = new Map();
  const keyOf = (k) => {
    let v = expected.get(k);
    if (v === undefined) {
      const p = PALETTE[k];
      v = k === 'air' ? 'minecraft:air' : k === 'dirt' ? 'minecraft:dirt' : BlockPermutation.resolve(p.name, p.states ?? {}).key;
      expected.set(k, v);
    }
    return v;
  };
  let compared = 0;
  const diffs = [];
  for (let x = BOUNDS.x0; x <= BOUNDS.x1; x++) {
    for (let y = BOUNDS.y0; y <= BOUNDS.y1; y++) {
      for (let z = BOUNDS.z0; z <= BOUNDS.z1; z++) {
        const w = W(x, y, z);
        if (skip.has(`${w.x},${w.y},${w.z}`)) continue;
        compared++;
        const want = keyOf(vox.get(x, y, z));
        const got = mock.blockAt(w.x, w.y, w.z);
        if (want !== got && diffs.length < 10) diffs.push(`(${x},${y},${z}) want ${want} got ${got}`);
      }
    }
  }
  assert.ok(compared > 2_000_000, `compared ${compared} cells`);
  assert.deepEqual(diffs, []);
});

test('in-game self-test passes inside the mock (palette, structures, CBs, bus round trip, heartbeat, routes, cameras, puppets)', async () => {
  await mock.tick(120); // heartbeat repeats every 100 ticks
  const { selfTest } = await import('../packs/FredbearBP/scripts/mc/debug.js');
  const p = selfTest(game, undefined);
  await mock.tick(25);
  const lines = await p;
  assert.equal(lines.length, 9);
  for (const l of lines) assert.match(l, /PASS/, l.replace(/§./g, ''));
  noMockErrors();
});

test('training shift: every step completes through the physical controls, then back to the lobby', async () => {
  press('in.lobby.tutorial');
  await mock.tick(5);
  assert.equal(game.state, 'NIGHT');
  assert.equal(game.night, 0);
  await mock.tick(20);
  // Shift start must leave the doorways sealed with barriers (doors "open").
  assert.deepEqual([...new Set(box(94, 0, 129, 94, 2, 130))], ['minecraft:barrier'], 'left doorway sealed at shift start');
  assert.deepEqual([...new Set(box(106, 0, 129, 106, 2, 130))], ['minecraft:barrier'], 'right doorway sealed at shift start');
  const step = () => game.tutorial.step;
  press('in.office.door_l');
  await mock.tick(5);
  assert.equal(step(), 1);
  assert.deepEqual([...new Set(box(94, 0, 129, 94, 2, 130))], ['minecraft:iron_block'], 'door closed physically');
  await mock.tick(10);
  press('in.office.door_l');
  await mock.tick(5);
  assert.equal(step(), 2);
  assert.deepEqual([...new Set(box(94, 0, 129, 94, 2, 130))], ['minecraft:barrier']);
  press('in.office.light_l');
  await mock.tick(5);
  assert.equal(step(), 3);
  assert.ok(box(91, 0, 127, 93, 3, 133).includes('minecraft:light_block_14'), 'hall light on');
  press('in.office.cams');
  await mock.tick(5);
  assert.equal(step(), 4);
  assert.equal(player.cameraState.preset, 'minecraft:free');
  assert.equal(player.permissions[4], false, 'lateral movement locked while viewing');
  mock.hotbar(player, 4, 5);
  await mock.tick(5);
  assert.equal(step(), 5);
  mock.sneak(player);
  await mock.tick(5);
  assert.equal(step(), 6);
  assert.equal(player.cameraState.preset, null);
  // Demo: Bonnie walks to the left door; close it while he telegraphs.
  await until(() => game.session.anim.bonnie.state === 'TELEGRAPH', 4000);
  press('in.office.door_l');
  await until(() => step() === 7, 400);
  press('in.office.strobe');
  await mock.tick(5);
  assert.equal(game.tutorial.done, true);
  await until(() => game.state === 'LOBBY', 200);
  assert.equal(JSON.parse(world.getDynamicProperty('fb:save')).tutorialDone, true);
  await assertCleanLobby();
});

test('intro camera tour at 11:55: shows the cameras, sneak skips it, then the walk starts', async () => {
  press('in.lobby.night_1');
  await mock.tick(25);
  assert.equal(game.state, 'INTRO');
  assert.ok(game.tour, 'tour running');
  assert.equal(game.cams.active, true, 'tour uses the camera view');
  assert.equal(player.cameraState.preset, 'minecraft:free');
  await mock.tick(70);
  assert.equal(game.cams.cam, 'C07', 'second shot: west hall');
  mock.sneak(player);
  await mock.tick(2);
  assert.equal(game.tour, null);
  assert.equal(game.cams.active, false);
  assert.equal(player.cameraState.preset, null, 'view restored');
  commands.get('fb:lobby')();
  await mock.tick(2);
  await assertCleanLobby();
});

test('intro breadcrumbs follow a walkable route (no sparkles inside walls) and the HUD shows the distance', async () => {
  press('in.lobby.night_1');
  await mock.tick(2);
  assert.equal(game.state, 'INTRO');
  mock.sneak(player); // skip the camera tour
  await mock.tick(2);
  STATE.particles.length = 0;
  await mock.tick(25);
  const crumbs = STATE.particles.filter((p) => p.id === 'minecraft:villager_happy');
  assert.ok(crumbs.length >= 8, `${crumbs.length} breadcrumbs`);
  const solidAt = (x, y, z) => {
    const t = mock.blockAt(Math.floor(x), Math.floor(y), Math.floor(z)).split('[')[0];
    return !(t === 'minecraft:air' || t.startsWith('minecraft:light_block') || t.includes('carpet') || t.includes('button') || t.includes('sign') || t.includes('plate'));
  };
  for (const c of crumbs) {
    assert.ok(!solidAt(c.loc.x, c.loc.y, c.loc.z), `breadcrumb inside a block at ${JSON.stringify(c.loc)}`);
    assert.ok(solidAt(c.loc.x, c.loc.y - 1, c.loc.z) || solidAt(c.loc.x, c.loc.y - 2, c.loc.z), `breadcrumb floating at ${JSON.stringify(c.loc)}`);
  }
  // After the 13 s intro message, the action bar shows the walking distance left.
  await until(() => /\d+ blocks/.test(player.actionBar), 400);
  commands.get('fb:lobby')();
  await mock.tick(2);
  await assertCleanLobby();
});

test('Shift Guide item opens a topic menu covering every mechanic, with a Music on/off switch', async () => {
  const { GUIDE_SECTIONS } = await import('../packs/FredbearBP/scripts/data/guide_text.js');
  const seen = [];
  uiMock.respond = (f) => {
    seen.push(f.title);
    if (f.title === '§lSHIFT GUIDE') return seen.length === 1 ? { selection: f.buttons.indexOf('Fredbear') } : { selection: f.buttons.length - 1 };
    return { selection: 0 }; // back to topics
  };
  mock.useItem(player, 'fb:guide');
  await mock.tick(3);
  uiMock.respond = () => undefined;
  assert.deepEqual(seen, ['§lSHIFT GUIDE', '§lFREDBEAR', '§lSHIFT GUIDE']);
  const menu = uiMock.shown.find((f) => f.title === '§lSHIFT GUIDE');
  assert.equal(menu.buttons.length, GUIDE_SECTIONS.length + 2, 'music switch + topics + close');
  assert.match(menu.buttons[0], /Music: ON/);
  // The switch flips the saved setting (and back).
  uiMock.respond = (f) => (f.title === '§lSHIFT GUIDE' ? { selection: uiMock.shown.filter((x) => x.title === '§lSHIFT GUIDE').length === 1 ? 0 : f.buttons.length - 1 } : undefined);
  uiMock.shown.length = 0;
  mock.useItem(player, 'fb:guide');
  await mock.tick(3);
  assert.equal(game.save.settings.music, false);
  assert.match(uiMock.shown.filter((f) => f.title === '§lSHIFT GUIDE')[1].buttons[0], /Music: OFF/);
  game.toggleMusic(true);
  uiMock.respond = () => undefined;
  for (const t of ['Power', 'Doors', 'Hall lights', 'Cameras', 'Office hatch', 'Emergency strobe', 'Bonnie', 'Chica', 'Freddy', 'Fredbear', 'Maintenance and tasks']) assert.ok(menu.buttons.includes(t), t);
  for (const sct of GUIDE_SECTIONS) assert.doesNotMatch(sct.body, /undefined|NaN/, sct.title);
  noMockErrors();
});

test('night 1 from the time clock: intro, office start, controls drive session and command blocks', async () => {
  game.save.settings.deterministic = true;
  game.save.settings.seed = 1983;
  press('in.lobby.night_1');
  await mock.tick(2);
  assert.equal(game.state, 'INTRO');
  press('in.office.start'); // still in the lobby: refused
  await mock.tick(2);
  assert.equal(game.state, 'INTRO');
  await goToOfficeAndStart();
  assert.ok(STATE.commands.includes('fog @a push fb:night_1 fb_night'));
  await mock.tick(20);
  const s = game.session;
  const p0 = s.power;
  press('in.office.door_r');
  await mock.tick(4);
  assert.equal(s.devices.doorR, true);
  assert.deepEqual([...new Set(box(106, 0, 129, 106, 2, 130))], ['minecraft:iron_block']);
  assert.equal(typeAt(106, 3, 129), 'minecraft:ochre_froglight', 'door indicator');
  press('in.office.map_c05'); // map button opens the monitor on that feed
  await mock.tick(4);
  assert.equal(s.devices.cams.open, true);
  assert.equal(s.devices.cams.cam, 'C05');
  mock.useItem(player, 'fb:tablet'); // tablet while viewing -> camera menu form
  await mock.tick(2);
  assert.ok(uiMock.shown.some((f) => f.title.includes('SECURITY CAMERAS')));
  await mock.tick(200);
  assert.ok(s.power < p0, 'power drains');
  // Unregistered block cannot drive the office.
  const fake = mock.store();
  void fake;
  system.afterEvents.scriptEventReceive.emit({ id: 'fb:input', message: 'door_r', sourceBlock: { location: { x: 0, y: -60, z: 0 } } });
  await mock.tick(10);
  assert.equal(s.devices.doorR, true, 'spoofed input ignored');
  noMockErrors();
});

test('6 AM win unlocks night 2 and persists; result form returns to the lobby', async () => {
  const s = game.session;
  uiMock.respond = (f) => (f.title.includes('COMPLETE') ? { selection: f.buttons.indexOf('Return to the lobby') } : undefined);
  s.setTick(s.length - 3);
  await until(() => game.state === 'RESULT', 50);
  await until(() => game.state === 'LOBBY', 400);
  const save = JSON.parse(world.getDynamicProperty('fb:save'));
  assert.equal(save.unlocked, 2);
  assert.deepEqual(save.completed, [1]);
  uiMock.respond = () => undefined;
  await assertCleanLobby();
});

test('jumpscare -> game over -> immediate retry restarts the same night in the office', async () => {
  press('in.lobby.night_2');
  await mock.tick(2);
  await goToOfficeAndStart();
  await mock.tick(40);
  uiMock.respond = (f) => (f.title.includes('GAME OVER') ? { selection: 0 } : undefined);
  handleDebug(game, 'lose', 'bonnie', undefined, player);
  await until(() => game.state === 'RESULT', 300);
  assert.ok(player.sounds.includes('fb.js.bonnie'), 'scream played');
  assert.ok(player.cameraState.history.some((h) => h.preset === 'minecraft:free'), 'jumpscare camera');
  await until(() => game.state === 'NIGHT' && game.session?.t > 5, 400);
  assert.equal(game.night, 2);
  assert.equal(game.session.phase, 'RUNNING');
  await mock.tick(10);
  assert.deepEqual([...new Set(box(94, 0, 129, 94, 2, 130))], ['minecraft:barrier'], 'retry sealed the doorway');
  uiMock.respond = () => undefined;
  commands.get('fb:lobby')();
  await mock.tick(2);
  await assertCleanLobby();
});

test('maintenance pause: clock stops, the lever completes it, START resumes the night', async () => {
  handleDebug(game, 'unlock', '3', undefined, player);
  press('in.lobby.night_3');
  await mock.tick(2);
  await goToOfficeAndStart();
  const s = game.session;
  s.setTick(3195);
  await until(() => s.phase === 'MAINT', 30);
  const t0 = s.t;
  await mock.tick(40);
  assert.equal(s.t, t0, 'clock paused');
  press('in.office.start'); // task not done yet
  await mock.tick(2);
  assert.equal(s.phase, 'MAINT');
  STATE.particles.length = 0;
  await mock.tick(20);
  const crumbs = STATE.particles.filter((p) => p.id === 'minecraft:villager_happy');
  assert.ok(crumbs.length >= 5, 'breadcrumbs toward the generator');
  assert.match(player.actionBar, /Staff Stairwell/);
  press('in.maint.generator');
  await mock.tick(2);
  player.teleport(Wv(ANCHORS.officeSeat));
  press('in.office.start');
  await mock.tick(5);
  assert.equal(s.phase, 'RUNNING');
  assert.ok(s.t > t0);
  commands.get('fb:lobby')();
  await mock.tick(2);
  await assertCleanLobby();
});

test('ten randomized play / reset cycles leave no residue', async () => {
  const rng = new Rng(77);
  const controls = ['in.office.door_l', 'in.office.door_r', 'in.office.light_l', 'in.office.light_r', 'in.office.cams', 'in.office.hatch', 'in.office.strobe', 'in.office.map_c02', 'in.office.map_c11', 'in.office.breaker'];
  handleDebug(game, 'unlock', '6', undefined, player);
  for (let cycle = 0; cycle < 10; cycle++) {
    const night = 1 + rng.int(0, 5);
    press(`in.lobby.night_${night}`);
    await mock.tick(2);
    await goToOfficeAndStart();
    const actions = 20 + rng.int(0, 20);
    for (let i = 0; i < actions && game.state === 'NIGHT'; i++) {
      press(rng.pick(controls));
      if (rng.chance(0.2)) mock.sneak(player);
      if (rng.chance(0.2)) mock.hotbar(player, 4, rng.pick([3, 5]));
      if (cycle % 3 === 1 && i === 5 && game.session) game.session.setTick(game.session.tph * 3 - 5);
      if (cycle === 4 && i === 8 && game.session) handleDebug(game, 'scenario', 'blackout', undefined, player);
      if (cycle === 7 && i === 8 && game.session) game.puppets.showEcho('DIN_C');
      await mock.tick(5 + rng.int(0, 25));
    }
    // Leave the way a player would: the developer/console reset or the result screen.
    if (game.state === 'RESULT') await until(() => game.state !== 'RESULT', 400);
    commands.get('fb:lobby')();
    await mock.tick(2);
    await assertCleanLobby();
  }
});

test('duplicate and stray animatronic entities are removed by the integrity pass', async () => {
  const dim = world.getDimension('overworld');
  const extra = dim.spawnEntity('fb:bonnie', Wv(NODE_BY_ID.DIN_C));
  extra.addTag('fb_puppet');
  dim.spawnEntity('fb:chica', Wv(NODE_BY_ID.DIN_C)); // untagged stray
  dim.spawnEntity('fb:freddy', Wv(NODE_BY_ID.DIN_C));
  await mock.tick(41);
  for (const type of Object.values(TYPES)) assert.equal(puppetsOf(type).length, 1, type);
  await assertCleanLobby();
});

test('unloaded chunks: the night keeps running; puppets and actuations recover without duplicates', async () => {
  press('in.lobby.night_5');
  await mock.tick(2);
  await goToOfficeAndStart();
  await mock.tick(40);
  const s = game.session;
  // Unload the stage / dining area (the trio's homes) and the whole command-block control room.
  mock.unloadChunks(60, 0, 140, 60);
  mock.unloadChunks(22, 169, 177, 193);
  const t0 = s.t;
  const deferred0 = game.bus.stats.deferred;
  press('in.office.door_l');
  await mock.tick(200);
  assert.ok(s.t >= t0 + 199, 'the night clock does not depend on loaded chunks');
  assert.equal(s.devices.doorL, true, 'the session accepted the input');
  assert.deepEqual([...new Set(box(94, 0, 129, 94, 2, 130))], ['minecraft:barrier'], 'actuation waits while its command blocks are unloaded');
  assert.ok(game.bus.stats.deferred > deferred0, 'bus deferred the pad');
  mock.loadAllChunks();
  await mock.tick(45);
  assert.deepEqual([...new Set(box(94, 0, 129, 94, 2, 130))], ['minecraft:iron_block'], 'deferred actuation applied after reload');
  for (const [who, type] of Object.entries(TYPES)) {
    const list = puppetsOf(type);
    assert.equal(list.length, 1, `exactly one ${who} after the chunks return`);
    const pose = Wv(s.anim[who].pose());
    assert.ok(Math.hypot(list[0].location.x - pose.x, list[0].location.z - pose.z) < 0.5, `${who} puppet synced to its logical pose`);
  }
  noMockErrors();
  commands.get('fb:lobby')();
  await mock.tick(2);
  await assertCleanLobby();
});

test('quitting mid-night: on reload the night is abandoned, progress kept, back at the time clock', async () => {
  const before = world.getDynamicProperty('fb:save');
  press('in.lobby.night_4');
  await mock.tick(2);
  await goToOfficeAndStart();
  press('in.office.door_l');
  await mock.tick(200);
  assert.equal(JSON.parse(world.getDynamicProperty('fb:session')).active, true);
  // Close the world: scripts stop, blocks/entities/dynamic properties persist.
  mock.reload();
  startGame();
  mock.respawn(player);
  await mock.tick(2);
  assert.equal(game.state, 'LOBBY');
  assert.match(game.hud.message ?? '', /interrupted/);
  assert.equal(world.getDynamicProperty('fb:save'), before, 'save untouched by the abandoned night');
  assert.equal(game.save.unlocked, 6);
  await assertCleanLobby();
});

test('progress and settings survive a reload', async () => {
  game.save.settings.captions = false;
  (await import('../packs/FredbearBP/scripts/mc/persistence.js')).storeSave(game.save);
  mock.reload();
  startGame();
  await mock.tick(2);
  assert.equal(game.save.settings.captions, false);
  assert.equal(game.save.unlocked, 6);
  assert.equal(game.save.tutorialDone, true);
  await assertCleanLobby();
});

test('helper .mcfunction files drive the game through /scriptevent', async () => {
  const fs = await import('node:fs');
  const { log } = await import('../packs/FredbearBP/scripts/mc/log.js');
  const run = (name) => {
    const text = fs.readFileSync(new URL(`../packs/FredbearBP/functions/fb/${name}.mcfunction`, import.meta.url), 'utf8');
    for (const line of text.split('\n')) if (line.trim() && !line.trim().startsWith('#')) executeCommand(line.trim(), {});
  };
  press('in.lobby.night_1');
  await mock.tick(2);
  await goToOfficeAndStart();
  run('lobby');
  await mock.tick(2);
  assert.equal(game.state, 'LOBBY', 'lobby.mcfunction abandons the night');
  const overlay = game.overlay;
  run('debug_overlay');
  await mock.tick(1);
  assert.equal(game.overlay, !overlay);
  run('debug_overlay');
  await mock.tick(1);
  run('selftest');
  await mock.tick(150);
  const report = log.recent(40).filter((l) => l.includes('self-test')).at(-1) ?? '';
  assert.match(report, /PASS/);
  assert.doesNotMatch(report, /FAIL/);
  // control_room.mcfunction lands the player in open air on a solid floor.
  assert.equal(mock.blockAt(30, -59, 179), 'minecraft:air');
  assert.equal(mock.blockAt(30, -58, 179), 'minecraft:air');
  assert.notEqual(mock.blockAt(30, -60, 179), 'minecraft:air');
  run('setup');
  assert.equal(game.state, 'BUILDING', 'setup.mcfunction starts the builder');
  await until(() => game.state === 'LOBBY', 5000, 10);
  await assertCleanLobby();
});

// ------------------------------------------------------------------------------------------
// Full campaign through the physical controls (brief test items 18-20 in the mock).
const ENGAGED = ['APPROACH', 'TELEGRAPH', 'LURK', 'FORCING', 'JAMMED'];

/** Oracle policy (tools/lib/bots.mjs) expressed as button presses on the office console. */
function oraclePress(s) {
  const snap = s.snapshot();
  const want = { L: false, R: false, H: false };
  for (const id of s.order) {
    const a = s.anim[id];
    if (ENGAGED.includes(a.state) && a.entry) want[a.entry] = true;
  }
  if (s.anim.freddy.state === 'STALK' && s.anim.freddy.node === 'EH_S') want.R = true;
  const d = snap.devices;
  if (snap.phase === 'POWER_OUT' && snap.powerOut?.stage === 'reserve') return press('in.office.reserve');
  if (snap.phase !== 'RUNNING') return undefined;
  if (want.L !== d.doorL && !snap.jammed.L) press('in.office.door_l');
  if (want.R !== d.doorR && !snap.jammed.R) press('in.office.door_r');
  if (snap.hatchInstalled && want.H !== d.hatch && !snap.jammed.H) press('in.office.hatch');
  const fb = s.anim.fredbear;
  if (['TELEGRAPH', 'FORCING', 'JAMMED'].includes(fb.state) && fb.entry && (s.barrierClosed(fb.entry) || s.jammed[fb.entry]) && snap.strobe.cooldown === 0) press('in.office.strobe');
  if (snap.breaker.tripped && snap.breaker.resetting === 0) press('in.office.breaker');
  return undefined;
}

test('full campaign: erase progress, nights 1-6 through the office controls, ending, persistent completion', async () => {
  const { MAINTENANCE } = await import('../packs/FredbearBP/scripts/data/story.js');
  const { INPUTS } = await import('../packs/FredbearBP/scripts/data/inputs.js');
  uiMock.respond = (f) => (f.title === 'Erase progress?' ? { selection: 1 } : undefined);
  press('in.lobby.reset');
  await mock.tick(3);
  assert.equal(game.save.unlocked, 1);
  uiMock.respond = () => undefined;
  game.save.settings.deterministic = true;
  game.save.settings.seed = 4242;
  const nightTicks = [];
  for (let n = 1; n <= 6; n++) {
    press(`in.lobby.night_${n}`);
    await mock.tick(2);
    assert.equal(game.state, 'INTRO', `night ${n} intro`);
    await goToOfficeAndStart();
    let guard = 0;
    while (game.state === 'NIGHT' && guard++ < 20000) {
      const s = game.session;
      if (s.phase === 'MAINT' && game.maint && !game.maint.done) {
        const inp = INPUTS.find((i) => i.action === MAINTENANCE[game.maint.task].action);
        press(inp.id);
        await mock.tick(2);
        player.teleport(Wv(ANCHORS.officeSeat));
        press('in.office.start');
      } else oraclePress(s);
      await mock.tick(1);
    }
    assert.equal(game.state, 'RESULT', `night ${n} ended`);
    assert.equal(game.result.won, true, `night ${n} won`);
    assert.equal(game.session.t, 9600, `night ${n} clock reached 6 AM (9600 ticks)`);
    nightTicks.push(guard);
    if (n < 6) {
      await until(() => game.state === 'LOBBY', 400);
      assert.equal(JSON.parse(world.getDynamicProperty('fb:save')).unlocked, n + 1, `night ${n + 1} unlocked and saved`);
    }
  }
  await until(() => game.state === 'ENDING', 400);
  await until(() => game.state === 'LOBBY', 2000);
  const save = JSON.parse(world.getDynamicProperty('fb:save'));
  console.log(`campaign: game ticks per night ${nightTicks.join(', ')}`);
  assert.equal(save.campaignDone, true);
  assert.deepEqual(save.completed, [1, 2, 3, 4, 5, 6]);
  assert.ok(uiMock.shown.some((f) => f.title.includes('ARCHIVE')), 'credits / archive shown after the ending');
  await assertCleanLobby();
  // The chamber stays open once the campaign is complete (applyGates follows progress).
  mock.reload();
  startGame();
  await mock.tick(2);
  assert.equal(game.save.campaignDone, true);
  await assertCleanLobby();
});

test('night 4 flashback: the 1983 memory plays once before the first night 4 shift, then never again', async () => {
  handleDebug(game, 'unlock', '6', undefined, player);
  game.save.flashbackSeen = false;
  press('in.lobby.night_4');
  await mock.tick(2);
  mock.sneak(player); // skip the camera tour
  await mock.tick(2);
  player.teleport(Wv(ANCHORS.officeSeat));
  STATE.commands.length = 0;
  press('in.office.start');
  await mock.tick(3);
  assert.equal(game.state, 'FLASHBACK');
  assert.ok(STATE.commands.includes('fog @a push fb:flashback fb_scene'), 'sepia memory fog');
  const fb = puppetsOf('fb:fredbear')[0];
  const stage = Wv(NODE_BY_ID.DINER_STAGE);
  assert.ok(Math.hypot(fb.location.x - stage.x, fb.location.z - stage.z) < 0.01, 'Fredbear on the old diner stage');
  assert.equal(fb.getProperty('fb:anim'), 'perform');
  assert.equal(player.cameraState.preset, 'minecraft:free');
  await until(() => game.state === 'NIGHT', 700);
  assert.equal(game.save.flashbackSeen, true);
  assert.ok(STATE.commands.includes('fog @a remove fb_scene'), 'memory fog removed');
  assert.equal(game.session.night, 4);
  commands.get('fb:lobby')();
  await mock.tick(2);
  await assertCleanLobby();
  // Second time: straight into the shift.
  press('in.lobby.night_4');
  await mock.tick(2);
  player.teleport(Wv(ANCHORS.officeSeat));
  press('in.office.start');
  await mock.tick(3);
  assert.equal(game.state, 'NIGHT');
  commands.get('fb:lobby')();
  await mock.tick(2);
  await assertCleanLobby();
});

test('night music: loops for the whole shift, stops at a jumpscare and at 6 AM, and follows the setting', async () => {
  press('in.lobby.night_1');
  await mock.tick(2);
  await goToOfficeAndStart();
  assert.deepEqual(player.music, { id: 'fb.night.bgm', loop: true }, 'Pizza Dinner loops (a music track: Minecraft music is replaced)');
  assert.equal(game.musicPlaying, true);
  handleDebug(game, 'lose', 'bonnie', undefined, player);
  await mock.tick(2);
  assert.equal(player.music, null, 'stopped by the jumpscare');
  await until(() => game.state === 'RESULT', 200);
  commands.get('fb:lobby')();
  await mock.tick(2);
  await assertCleanLobby();
  // Switched off: no music at all; switched on mid-shift: starts at once.
  game.toggleMusic(false);
  press('in.lobby.night_1');
  await mock.tick(2);
  await goToOfficeAndStart();
  assert.equal(player.music ?? null, null);
  game.toggleMusic(true);
  assert.deepEqual(player.music, { id: 'fb.night.bgm', loop: true });
  handleDebug(game, 'win', undefined, undefined, player);
  await until(() => game.state === 'RESULT', 50);
  assert.equal(player.music, null, 'stopped at 6 AM');
  await until(() => game.state === 'LOBBY', 400);
  await assertCleanLobby();
});

test('challenges: locked until night 6; the menu starts one with its modifiers; a win is saved and lights its lamp', async () => {
  const { CHALLENGE_LAMPS } = await import('../packs/FredbearBP/scripts/data/inputs.js');
  game.save.campaignDone = false;
  uiMock.shown.length = 0;
  press('in.lobby.challenges');
  await mock.tick(2);
  assert.match(game.hud.message, /Beat night 6/);
  assert.equal(uiMock.shown.filter((f) => f.title === '§lCHALLENGES').length, 0);
  game.save.campaignDone = true;
  uiMock.respond = (f) => {
    if (f.title === '§lCHALLENGES') return { selection: f.buttons.indexOf('No Doors') };
    if (f.title === '§lNO DOORS') return { selection: 1 }; // Start
    return undefined;
  };
  press('in.lobby.challenges');
  await mock.tick(3);
  uiMock.respond = () => undefined;
  assert.equal(game.state, 'INTRO');
  assert.equal(game.challenge.id, 'no_doors');
  mock.sneak(player);
  await mock.tick(2);
  await goToOfficeAndStart();
  assert.equal(game.session.mods.noDoors, true);
  assert.equal(game.session.night, 4, 'built on night 4');
  press('in.office.door_l');
  await mock.tick(3);
  assert.match(game.hud.message, /welded open/);
  assert.match(player.actionBar, /NO DOORS/);
  handleDebug(game, 'win', undefined, undefined, player);
  await until(() => game.state === 'RESULT', 50);
  await until(() => game.state === 'LOBBY', 400);
  assert.ok(game.save.challenges.includes('no_doors'));
  assert.ok(uiMock.shown.some((f) => f.title === '§lCHALLENGE: NO DOORS COMPLETE'), 'result form names the challenge');
  await mock.tick(10);
  assert.equal(typeAt(...CHALLENGE_LAMPS.no_doors), 'minecraft:pearlescent_froglight', 'challenge lamp lit');
  assert.equal(typeAt(...CHALLENGE_LAMPS.no_cams), 'minecraft:gray_concrete');
  await assertCleanLobby();
});

test('newspaper clippings: one per night survived, readable from the lobby board', async () => {
  const { CLIPPINGS } = await import('../packs/FredbearBP/scripts/data/story.js');
  game.save.completed = [1, 2];
  uiMock.shown.length = 0;
  uiMock.respond = (f) => (f.title === '§lLOCAL NEWS' && uiMock.shown.filter((x) => x.title === '§lLOCAL NEWS').length === 1 ? { selection: 1 } : undefined);
  press('in.lobby.clippings');
  await mock.tick(3);
  uiMock.respond = () => undefined;
  const board = uiMock.shown.find((f) => f.title === '§lLOCAL NEWS');
  assert.equal(board.buttons.length, CLIPPINGS.length + 1);
  assert.match(board.body, new RegExp(`2/${CLIPPINGS.length}`));
  assert.equal(board.buttons.filter((b) => b.includes('???')).length, CLIPPINGS.length - 2);
  assert.ok(uiMock.shown.some((f) => f.title === `§l${CLIPPINGS[1].headline}` && f.body.includes(CLIPPINGS[1].text)), 'clipping 2 opened');
  noMockErrors();
});

test('holiday decorations: Halloween / Christmas from the date, placed only into air and removed afterwards', async () => {
  const { seasonFor } = await import('../packs/FredbearBP/scripts/mc/holidays.js');
  const { HOLIDAY_DECOR } = await import('../packs/FredbearBP/scripts/data/holiday_decor.generated.js');
  assert.equal(seasonFor(new Date(2026, 9, 31)), 'halloween');
  assert.equal(seasonFor(new Date(2026, 11, 24)), 'christmas');
  assert.equal(seasonFor(new Date(2027, 0, 3)), 'christmas');
  assert.equal(seasonFor(new Date(2026, 6, 4)), null);
  const cells = (season) => {
    const out = [];
    const { keys, cells: c } = HOLIDAY_DECOR[season];
    for (let i = 0; i < c.length; i += 4) out.push([c[i], c[i + 1], c[i + 2], PALETTE[keys[c[i + 3]]].name]);
    return out;
  };
  for (const season of ['christmas', 'halloween']) {
    for (const [x, y, z] of cells(season)) assert.equal(typeAt(x, y, z), 'minecraft:air', `${season} cell ${x},${y},${z} is free before`);
    game.holidays.sync(season);
    await until(() => !game.holidays.busy, 400);
    assert.equal(game.holidays.lastResult.failed, 0);
    for (const [x, y, z, name] of cells(season)) assert.equal(typeAt(x, y, z), name, `${season} decoration at ${x},${y},${z}`);
    game.holidays.sync(null);
    await until(() => !game.holidays.busy, 400);
    for (const [x, y, z] of cells(season)) assert.equal(typeAt(x, y, z), 'minecraft:air', `${season} removed at ${x},${y},${z}`);
  }
  assert.equal(JSON.parse(world.getDynamicProperty('fb:holiday')).season, null);
  noMockErrors();
});

test('shadow Fredbear: a black silhouette on CAM 01; staring at it costs power and it vanishes', async () => {
  press('in.lobby.night_2');
  await mock.tick(2);
  await goToOfficeAndStart();
  handleDebug(game, 'shadow', undefined, undefined, player);
  await mock.tick(2);
  const echo = puppetsOf('fb:fredbear_echo');
  assert.equal(echo.length, 1);
  assert.equal(echo[0].getProperty('fb:variant'), 1, 'shadow texture');
  const node = Wv(NODE_BY_ID.STAGE_FRONT);
  assert.ok(Math.hypot(echo[0].location.x - node.x, echo[0].location.z - node.z) < 0.01);
  const p0 = game.session.power;
  press('in.office.map_c01');
  await mock.tick(80);
  assert.equal(puppetsOf('fb:fredbear_echo').length, 0, 'gone after the stare');
  assert.ok(p0 - game.session.power >= 1000, 'cost at least 1 % power');
  commands.get('fb:lobby')();
  await mock.tick(2);
  await assertCleanLobby();
});

test('night 7: Fredbear alone, then the final choice: burn (and seal) play their endings and are saved', async () => {
  handleDebug(game, 'unlock', '7', undefined, player);
  assert.equal(game.save.unlocked, 7);
  press('in.lobby.night_7');
  await mock.tick(2);
  assert.equal(game.state, 'INTRO');
  await goToOfficeAndStart();
  assert.equal(game.session.night, 7);
  await mock.tick(20);
  for (const who of ['freddy', 'bonnie', 'chica']) assert.equal(puppetsOf(TYPES[who])[0].getProperty('fb:anim'), 'dormant', `${who} powered down`);
  STATE.commands.length = 0;
  STATE.particles.length = 0;
  uiMock.respond = (f) => (f.title === '§l6 AM' ? { selection: 1 } : undefined); // BURN IT DOWN
  handleDebug(game, 'win', undefined, undefined, player);
  await until(() => game.state === 'ENDING', 400);
  await until(() => game.state === 'LOBBY', 2000);
  uiMock.respond = () => undefined;
  assert.ok(game.save.endings.includes('burn'));
  assert.ok(game.save.completed.includes(7));
  assert.ok(STATE.commands.includes('fog @a push fb:ending_fire fb_scene'));
  assert.ok(STATE.commands.includes('time set 23500'), 'sunrise');
  assert.ok(STATE.particles.some((p) => p.id === 'minecraft:mobflame_single' || p.id === 'minecraft:basic_flame_particle'), 'fire particles (no real fire)');
  assert.ok(uiMock.shown.some((f) => f.title.includes('ARCHIVE')), 'archive after the ending');
  await assertCleanLobby();
  // The other ending through the debug shortcut.
  handleDebug(game, 'ending', 'seal', undefined, player);
  await until(() => game.state === 'LOBBY', 2000);
  assert.deepEqual([...game.save.endings].sort(), ['burn', 'seal']);
  assert.equal(typeAt(64, -8, 85), 'minecraft:brick_block', 'the diner is bricked up again');
  await assertCleanLobby();
});

test('nights 8 and 9: night 8 follows the last ending, the camera map HUD, the tapes, the night 9 ending', async () => {
  // The seal ending was the last one played (previous test): night 8 is Morgrave's.
  assert.equal(game.save.lastEnding, 'seal');
  assert.ok(game.save.unlocked >= 8, 'night 7 survived opens night 8');
  press('in.lobby.night_8');
  await mock.tick(2);
  assert.equal(game.state, 'INTRO');
  assert.match(game.nightTitle(8), /Walled In/);
  await goToOfficeAndStart();
  assert.equal(game.session.night, 8);
  assert.ok(game.session.def.ai.morgrave > 0 && !game.session.def.ai.valek, 'Morgrave, not Valek');
  // Camera map: a formatting-code-only title while the monitor is up, the "off" marker when it goes down.
  player.titles.length = 0;
  press('in.office.cams');
  await mock.tick(4);
  assert.ok(game.session.devices.cams.open);
  const cam = game.session.devices.cams.cam;
  const code = `§k§r§k§r§l${cam.slice(1).split('').map((d) => `§${d}`).join('')}`;
  assert.ok(player.titles.some((t) => t.t === code), `map title for ${cam}`);
  const hud = JSON.parse((await import('node:fs')).readFileSync(new URL('../packs/FredbearRP/ui/hud_screen.json', import.meta.url), 'utf8'));
  assert.ok(JSON.stringify(hud).includes(`'${code}'`), 'the HUD file highlights that exact title');
  player.titles.length = 0;
  mock.sneak(player);
  await mock.tick(4);
  assert.ok(!game.session.devices.cams.open);
  assert.ok(player.titles.some((t) => t.t === '§k§r§k§r§o'), 'map off');
  // Survive night 8 -> night 9 opens.
  handleDebug(game, 'win', undefined, undefined, player);
  await until(() => game.state !== 'NIGHT', 400);
  await until(() => game.state === 'LOBBY' || game.state === 'RESULT', 400);
  if (game.state === 'RESULT') handleDebug(game, 'lobby', undefined, undefined, player);
  await assertCleanLobby();
  assert.ok(game.save.completed.includes(8));
  assert.equal(game.save.unlocked, 9);
  // Night 9: the trio switched off in Parts & Service; then the ending.
  press('in.lobby.night_9');
  await mock.tick(2);
  await goToOfficeAndStart();
  assert.equal(game.session.night, 9);
  await mock.tick(20);
  for (const who of ['freddy', 'bonnie', 'chica']) assert.equal(puppetsOf(TYPES[who])[0].getProperty('fb:anim'), 'dormant', `${who} powered down`);
  handleDebug(game, 'win', undefined, undefined, player);
  await until(() => game.state === 'ENDING', 400);
  await until(() => game.state === 'LOBBY', 3000);
  assert.ok(game.save.completed.includes(9));
  await assertCleanLobby();
  // The 1987 tapes play on the office monitor outside a shift, once night 5 has been survived.
  player.teleport(Wv(ANCHORS.officeSeat));
  game.save.completed = game.save.completed.filter((n) => n !== 5);
  press('in.office.tapes');
  await mock.tick(3);
  assert.ok(!game.tape);
  assert.match(player.actionBar, /jammed/, 'locked before night 5');
  game.save.completed.push(5);
  await mock.tick(20);
  press('in.office.tapes');
  await mock.tick(3);
  assert.ok(game.tape, 'the tape deck plays');
  mock.sneak(player);
  await until(() => !game.tape, 400);
  assert.equal(game.save.tapesSeen, true);
  handleDebug(game, 'lobby', undefined, undefined, player);
  await assertCleanLobby();
  noMockErrors();
});

test('saves from 1.1 / 1.2 unlock nights 7-9 only by survived nights', async () => {
  const { loadSave } = await import('../packs/FredbearBP/scripts/mc/persistence.js');
  const keep = world.getDynamicProperty('fb:save');
  const load = (s) => {
    world.setDynamicProperty('fb:save', JSON.stringify(s));
    return loadSave();
  };
  assert.equal(load({ unlocked: 6, campaignDone: true, completed: [1, 2, 3, 4, 5, 6] }).unlocked, 7, '1.1 save: night 7 opens');
  assert.equal(load({ unlocked: 7, campaignDone: true, completed: [1, 2, 3, 4, 5, 6, 7], endings: ['burn'] }).unlocked, 8, '1.2 save with night 7 beaten: night 8');
  assert.equal(load({ unlocked: 7, campaignDone: true, completed: [1, 2, 3, 4, 5, 6, 7], endings: ['burn'] }).lastEnding, 'burn', 'night 8 version from the last ending');
  assert.equal(load({ unlocked: 9, campaignDone: true, completed: [1, 2, 3, 4, 5, 6] }).unlocked, 7, 'never past an unbeaten night');
  assert.equal(load({ unlocked: 9, completed: [1, 2, 3, 4, 5, 6, 7, 8] }).unlocked, 9);
  assert.equal(load({ settings: { music: false } }).settings.camMap, true, 'the camera map is on by default');
  world.setDynamicProperty('fb:save', keep);
});

test('upgrading a world built by an older pack version: asks for /fb:setup, rebuilds, keeps progress', async () => {
  const save = world.getDynamicProperty('fb:save');
  world.setDynamicProperty('fb:build', JSON.stringify({ version: 1, done: true, phase: 9, op: 0 }));
  mock.reload();
  startGame();
  mock.respawn(player);
  await mock.tick(61);
  assert.equal(game.state, 'UNBUILT');
  assert.match(player.actionBar, /updated/);
  commands.get('fb:setup')({ sourceEntity: player }, false);
  await until(() => game.state === 'LOBBY', 5000, 10);
  assert.equal(world.getDynamicProperty('fb:save'), save, 'campaign progress kept');
  const { BUILD_VERSION } = await import('../packs/FredbearBP/scripts/mc/builder.js');
  assert.equal(JSON.parse(world.getDynamicProperty('fb:build')).version, BUILD_VERSION);
  await assertCleanLobby();
});
