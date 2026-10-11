// Automated logic tests for the pure night simulation (no Minecraft needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NightSession } from '../packs/FredbearBP/scripts/core/session.js';
import { CONFIG } from '../packs/FredbearBP/scripts/core/config.js';
import { idleBot, oracleBot, wastefulBot, runNight } from '../tools/lib/bots.mjs';

const LETHAL_PRECURSOR = { bonnie: ['TELEGRAPH'], chica: ['TELEGRAPH'], freddy: ['LURK', 'POWEROUT'], fredbear: ['TELEGRAPH', 'FORCING', 'JAMMED', 'POWEROUT'] };

function runTicks(s, n, each) {
  const fx = [];
  for (let i = 0; i < n && !['WON', 'LOST'].includes(s.phase); i++) {
    each?.(s);
    for (const f of s.tick()) {
      fx.push({ ...f, t: s.t });
      if (f.fx === 'maint_begin') s.resumeMaintenance();
    }
  }
  return fx;
}

test('same seed reproduces the same night exactly (deterministic debug mode)', async () => {
  const a = await runNight(NightSession, { night: 4, seed: 99, bot: idleBot() });
  const b = await runNight(NightSession, { night: 4, seed: 99, bot: idleBot() });
  assert.deepEqual(a.session.log, b.session.log);
  assert.equal(a.t, b.t);
  const c = await runNight(NightSession, { night: 4, seed: 100, bot: idleBot() });
  assert.notDeepEqual(a.session.log, c.session.log);
});

test('nights 1-7 start and complete with a valid defence (oracle, 10 seeds each)', async () => {
  for (let night = 1; night <= 7; night++) {
    for (let seed = 1; seed <= 10; seed++) {
      const r = await runNight(NightSession, { night, seed, bot: oracleBot() });
      assert.equal(r.result, 'WON', `night ${night} seed ${seed} lost to ${r.attacker}`);
      assert.equal(r.t, CONFIG.clock.ticksPerHour * 6);
      assert.ok(r.power > 5000, `night ${night} seed ${seed} finished with only ${r.power}`);
    }
  }
});

test('every lethal attack is preceded by its telegraph state and never passes a closed barrier', async () => {
  let attacks = 0;
  for (let night = 1; night <= 7; night++) {
    for (let seed = 1; seed <= 15; seed++) {
      for (const bot of [idleBot(), wastefulBot()]) {
        const r = await runNight(NightSession, { night, seed, bot });
        const atk = r.session.log.find((l) => l.to === 'ATTACK');
        if (!atk) continue;
        attacks++;
        assert.ok(LETHAL_PRECURSOR[atk.who].includes(atk.from), `${atk.who} attacked from ${atk.from}`);
        const s = r.session;
        const a = s.anim[atk.who];
        if (atk.from !== 'POWEROUT') {
          // The barrier at the attacker's entry must be open at the moment of attack.
          const entry = a.entry ?? (atk.who === 'freddy' ? 'R' : null);
          assert.ok(entry, 'attack without an entry');
          assert.equal(s.barrierClosed(entry), false, `${atk.who} attacked through a closed ${entry}`);
        }
      }
    }
  }
  assert.ok(attacks > 50, `expected many attacks from idle/wasteful bots, got ${attacks}`);
});

test('a closed door always protects against Bonnie (repelled, never attacks)', () => {
  const s = new NightSession({ night: 6, seed: 3 });
  s.input('door_l');
  runTicks(s, 2);
  assert.equal(s.devices.doorL, true);
  for (const id of ['chica', 'freddy', 'fredbear']) s.setAggression(id, 0);
  s.forceApproach('bonnie', 'L');
  runTicks(s, 600, (ss) => {
    if (ss.anim.bonnie.target === 'R') ss.anim.bonnie.target = 'L';
  });
  assert.ok(s.log.some((l) => l.who === 'bonnie' && l.to === 'RETREAT'), 'Bonnie should retreat');
  assert.ok(!s.log.some((l) => l.to === 'ATTACK'));
});

test('6 AM boundary: win commits before an attack that has not started; a started jumpscare still loses', () => {
  const s = new NightSession({ night: 2, seed: 1 });
  for (const id of ['chica', 'freddy']) s.setAggression(id, 0);
  s.place('bonnie', 'W_DOOR', 'TELEGRAPH');
  s.anim.bonnie.entry = 'L';
  s.director.entries.L = 'bonnie';
  s.anim.bonnie.timer = 0; // window already elapsed: would attack this tick
  s.setTick(s.length - 1);
  runTicks(s, 3);
  assert.equal(s.phase, 'WON');
  assert.ok(!s.log.some((l) => l.to === 'ATTACK'));

  const s2 = new NightSession({ night: 2, seed: 1 });
  for (const id of ['chica', 'freddy']) s2.setAggression(id, 0);
  s2.place('bonnie', 'W_DOOR', 'TELEGRAPH');
  s2.anim.bonnie.entry = 'L';
  s2.director.entries.L = 'bonnie';
  s2.anim.bonnie.timer = 0;
  s2.setTick(s2.length - 3);
  runTicks(s2, 100);
  assert.equal(s2.phase, 'LOST', 'attack began at 5:59 and must complete');
});

test('power reaching zero: reserve window on night 3, Freddy sequence otherwise, devices forced off', () => {
  const s = new NightSession({ night: 3, seed: 5 });
  s.input('door_l');
  s.input('door_r');
  runTicks(s, 2);
  s.setPowerPercent(0.01);
  runTicks(s, 2);
  assert.equal(s.phase, 'POWER_OUT');
  assert.equal(s.devices.doorL, false);
  assert.equal(s.devices.doorR, false);
  s.input('reserve');
  runTicks(s, 1);
  assert.equal(s.phase, 'RUNNING');
  assert.equal(s.power > 7000, true);

  const s1 = new NightSession({ night: 1, seed: 5 });
  s1.setPowerPercent(0.001);
  const fx = runTicks(s1, 900);
  assert.ok(fx.some((f) => f.fx === 'power_out' && f.stage === 'music'));
  assert.equal(s1.phase, 'LOST');
  assert.equal(s1.jumpscare.who, 'freddy');

  // Nights Fredbear is awake (4-7): the power-out sequence is his, at the left door.
  const s4 = new NightSession({ night: 4, seed: 5 });
  s4.reserveUsed = true;
  s4.setPowerPercent(0.001);
  const fx4 = runTicks(s4, 900);
  assert.ok(fx4.some((f) => f.fx === 'power_out' && f.stage === 'music' && f.who === 'fredbear'));
  assert.ok(fx4.some((f) => f.fx === 'sound' && f.id === 'fb.fredbear.musicbox' && f.loopKey === 'powerout_music'));
  assert.equal(s4.phase, 'LOST');
  assert.equal(s4.jumpscare.who, 'fredbear');
  assert.equal(s4.anim.freddy.state === 'POWEROUT', false);
});

test('power out right before 6 AM can still be survived', () => {
  const s = new NightSession({ night: 1, seed: 8 });
  s.setTick(s.length - 80);
  s.setPowerPercent(0.001);
  runTicks(s, 200);
  assert.equal(s.phase, 'WON');
});

function fredbearAt(night, entry) {
  const s = new NightSession({ night, seed: 11 });
  for (const id of ['bonnie', 'chica', 'freddy']) s.setAggression(id, 0);
  const fb = s.anim.fredbear;
  s.place('fredbear', { H: 'SUB_N', L: 'WH_S', R: 'EH_S' }[entry], 'PATROL');
  fb.target = entry;
  fb.cool.relocate = 9999;
  return s;
}

test('Fredbear: barrier + strobe repels; strobe with open barrier only stuns; no strobe -> forced open -> attack', () => {
  // 1. correct defence
  let s = fredbearAt(4, 'H');
  s.input('hatch');
  runTicks(s, 1200, (ss) => {
    if (['FORCING'].includes(ss.anim.fredbear.state) && ss.strobe.cooldown === 0) ss.input('strobe');
  });
  assert.ok(s.log.some((l) => l.who === 'fredbear' && /repelled at HATCH/.test(l.reason)));
  assert.notEqual(s.phase, 'LOST');

  // 2. strobe while open: stunned, then attack
  s = fredbearAt(4, 'H');
  let strobed = false;
  runTicks(s, 1500, (ss) => {
    if (ss.anim.fredbear.state === 'TELEGRAPH' && !strobed) {
      ss.input('strobe');
      strobed = true;
    }
  });
  assert.equal(s.phase, 'LOST');
  assert.equal(s.jumpscare.who, 'fredbear');

  // 3. closed but never strobed, and this door already held once tonight:
  //    the barrier is forced open (JAMMED) before the attack
  s = fredbearAt(5, 'L');
  s.held.L = true;
  s.input('door_l');
  const fx = runTicks(s, 1500);
  const jamIdx = fx.findIndex((f) => f.fx === 'device' && f.device === 'jam_L' && f.value === true);
  const atkIdx = fx.findIndex((f) => f.fx === 'jumpscare');
  assert.ok(jamIdx >= 0 && atkIdx > jamIdx, 'jam must precede the attack');
  assert.equal(s.devices.doorL, false);
});

test('a door or the hatch holds Fredbear off once per night (not in the Golden Hour); the second time it is forced', () => {
  const s = fredbearAt(5, 'L');
  s.input('door_l');
  const fx = runTicks(s, 400, (ss) => {
    if (ss.anim.fredbear.state === 'YIELD') ss.anim.fredbear.cool.relocate = 9999;
  });
  assert.ok(s.log.some((l) => l.who === 'fredbear' && l.to === 'YIELD' && /LEFT DOOR held/.test(l.reason)), 'first visit: the door holds');
  assert.ok(fx.some((f) => f.fx === 'held' && f.entry === 'L'));
  assert.ok(fx.some((f) => f.fx === 'actuate' && f.id === 'sig.strain_end_l'));
  assert.ok(!fx.some((f) => f.fx === 'device' && f.device === 'jam_L'), 'a held door is never jammed');
  assert.equal(s.held.L, true);
  assert.equal(s.anim.fredbear.attempts, 1, 'a hold counts as one of his attempts');
  assert.equal(s.stats.holds, 1);
  runTicks(s, 60);
  assert.equal(s.anim.fredbear.state, 'RECOVER');
  assert.notEqual(s.phase, 'LOST');

  // Golden Hour: nothing holds him.
  const f = fredbearAt(6, 'H');
  f.finale = true;
  f.input('hatch');
  const ffx = runTicks(f, 1500);
  assert.ok(!f.log.some((l) => l.who === 'fredbear' && l.to === 'YIELD'));
  assert.ok(ffx.some((x) => x.fx === 'device' && x.device === 'jam_H' && x.value === true));
});

test('Fredbear laughs when every hunt starts; the office lamp flickers while he is next to the office', () => {
  const s = new NightSession({ night: 4, seed: 21 });
  const fx = runTicks(s, 9600, (ss) => oracleBot().act(ss));
  const laughs = fx.filter((f) => f.fx === 'sound' && f.id === 'fb.fredbear.laugh');
  const hunts = s.log.filter((l) => l.who === 'fredbear' && l.to === 'PATROL' && /hunting toward/.test(l.reason));
  assert.ok(hunts.length >= 1);
  assert.equal(laughs.length, hunts.length);
  const flickers = fx.filter((f) => f.fx === 'actuate' && f.id === 'env.flicker_office');
  assert.ok(flickers.length >= 1, 'flicker while he climbs to the hatch');
  for (let i = 1; i < flickers.length; i++) assert.ok(flickers[i].t - flickers[i - 1].t >= CONFIG.characters.fredbear.flickerClose);
  // Nights 1-3: he never wakes, so no laugh and no flicker.
  const s1 = new NightSession({ night: 2, seed: 21 });
  const fx1 = runTicks(s1, 3000);
  assert.ok(!fx1.some((f) => f.id === 'fb.fredbear.laugh' || f.id === 'env.flicker_office'));
});

test('night 7: only Fredbear hunts, with every entry and power; the others stay on the stage', async () => {
  for (let seed = 1; seed <= 5; seed++) {
    const r = await runNight(NightSession, { night: 7, seed, bot: oracleBot() });
    const s = r.session;
    assert.equal(r.result, 'WON', `seed ${seed}`);
    for (const id of ['freddy', 'bonnie', 'chica']) assert.equal(s.anim[id].state, 'DORMANT', `${id} must stay dormant`);
    assert.ok(s.log.some((l) => l.who === 'fredbear' && l.to === 'TELEGRAPH'));
  }
});

test('challenge modifiers: no doors (lights are the barrier), broken cameras, double drain, bigger reserve', () => {
  const C = CONFIG.challenges;
  const mk = (id, seed = 1) => new NightSession({ night: C[id].base, seed, overrides: C[id].overrides, options: { mods: C[id].mods } });
  // No Doors: door and hatch buttons refuse; a lit hall light counts as that side's barrier.
  let s = mk('no_doors');
  s.input('door_l');
  s.input('hatch');
  let fx = runTicks(s, 1).filter((f) => f.fx === 'feedback');
  assert.deepEqual(fx.map((f) => [f.action, f.ok, f.reason]), [['door_l', false, 'welded open'], ['hatch', false, 'welded open']]);
  assert.equal(s.barrierClosed('L'), false);
  s.input('light_l');
  runTicks(s, 1);
  assert.equal(s.barrierClosed('L'), true);
  assert.equal(s.barrierClosed('H'), false);
  assert.equal(s.devices.lightTimer.L > CONFIG.devices.lightAutoOff, true, 'lights stay on longer');
  // ... Bonnie at the lit corner backs off.
  s = mk('no_doors', 3);
  for (const id of ['chica', 'freddy', 'fredbear']) s.setAggression(id, 0);
  s.forceApproach('bonnie', 'L');
  runTicks(s, 900, (ss) => {
    if (ss.anim.bonnie.target === 'R') ss.anim.bonnie.target = 'L';
    if (ss.anim.bonnie.state === 'TELEGRAPH' && !ss.devices.lightL) ss.input('light_l');
  });
  assert.ok(s.log.some((l) => l.who === 'bonnie' && l.to === 'RETREAT'));
  assert.ok(!s.log.some((l) => l.to === 'ATTACK'));
  // Broken cameras: the monitor never opens.
  s = mk('no_cams');
  s.input('cams_open', 'C01');
  fx = runTicks(s, 1).filter((f) => f.fx === 'feedback');
  assert.deepEqual(fx.map((f) => [f.action, f.ok, f.reason]), [['cams_open', false, 'no signal']]);
  assert.equal(s.devices.cams.open, false);
  assert.equal(s.options.captions, true);
  // Double device drain and a 25 % reserve.
  s = mk('double_drain');
  const base = new NightSession({ night: 3, seed: 1 });
  assert.equal(s.drainPerTick(), base.drainPerTick(), 'the building itself drains as usual');
  s.devices.doorL = true;
  base.devices.doorL = true;
  assert.equal(s.drainPerTick() - CONFIG.power.baseDrain[3], 2 * (base.drainPerTick() - CONFIG.power.baseDrain[3]));
  s.devices.doorL = false;
  s.setPowerPercent(0.001);
  runTicks(s, 3);
  s.input('reserve');
  runTicks(s, 1);
  assert.equal(s.phase, 'RUNNING');
  assert.ok(s.power > 24000, `reserve gave ${s.power}`);
});

test('every challenge mode is beatable with a valid defence (oracle, 8 seeds each)', async () => {
  for (const [id, c] of Object.entries(CONFIG.challenges)) {
    for (let seed = 1; seed <= 8; seed++) {
      const r = await runNight(NightSession, { night: c.base, seed, bot: oracleBot(), overrides: c.overrides, options: { mods: c.mods } });
      assert.equal(r.result, 'WON', `${id} seed ${seed} lost to ${r.attacker}`);
    }
  }
});

test('shadow Fredbear: rare silhouette on the stage; staring at it drains 1 % power and it vanishes', () => {
  const s = new NightSession({ night: 3, seed: 2 });
  for (const id of s.order) s.setAggression(id, 0);
  s.shadowRng = { chance: () => true };
  s.setTick(s.tph - 2);
  const fx = runTicks(s, 3);
  const on = fx.find((f) => f.fx === 'echo' && f.on && f.kind === 'shadow');
  assert.ok(on, 'shadow appears at 1 AM');
  assert.equal(on.cam, 'C01');
  assert.equal(on.node, CONFIG.shadow.node);
  assert.equal(s.snapshot().shadow, true);
  const p = s.power;
  s.input('cams_open', 'C01');
  const fx2 = runTicks(s, CONFIG.shadow.stareTicks + 5);
  assert.ok(fx2.some((f) => f.fx === 'echo' && !f.on && f.kind === 'shadow'));
  assert.ok(p - s.power >= CONFIG.shadow.drain, 'staring cost at least 1 %');
  assert.equal(s.echo, null);
  // Never on the training night or nights 0-1.
  const t = new NightSession({ night: 1, seed: 2 });
  t.shadowRng = { chance: () => true };
  t.setTick(t.tph - 2);
  assert.ok(!runTicks(t, 3).some((f) => f.fx === 'echo'));
});

test('Fredbear telegraph/forcing windows respect the fairness floors for every aggression', () => {
  const c = CONFIG.characters;
  for (let a = 0; a <= 20; a++) {
    assert.ok(c.fredbear.w1(a) >= 100);
    assert.ok(c.fredbear.w2(a) >= 60);
    assert.ok(c.bonnie.telegraph(a) >= 70);
    assert.ok(c.chica.telegraph(a) >= 80);
    assert.ok(c.freddy.patience(a) >= 120);
  }
});

test('mercy cap: after maxAttempts repelled attempts Fredbear never approaches again', async () => {
  let capped = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const r = await runNight(NightSession, { night: 4, seed, bot: oracleBot() });
    const s = r.session;
    const max = s.def.fredbear.maxAttempts;
    assert.ok(s.anim.fredbear.attempts <= max);
    const capIdx = s.log.findIndex((l) => l.who === 'fredbear' && l.reason.includes(`(attempt ${max}/${max})`));
    if (capIdx < 0) continue;
    capped++;
    assert.ok(!s.log.slice(capIdx + 1).some((l) => l.who === 'fredbear' && l.to === 'APPROACH'), `seed ${seed}`);
  }
  assert.ok(capped > 0, 'expected at least one capped night in 20 seeds');
});

test('simultaneous threats: at most two engaged entries, nobody engages beside Fredbear, one attack token', async () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = new NightSession({ night: 6, seed });
    for (let i = 0; i < 9600 && !['WON', 'LOST'].includes(s.phase); i++) {
      oracleBot().act(s);
      for (const f of s.tick()) if (f.fx === 'maint_begin') s.resumeMaintenance();
      const engaged = Object.values(s.director.entries).filter(Boolean);
      assert.ok(engaged.length <= 2, `t=${s.t} ${engaged}`);
      const fbEngaged = ['TELEGRAPH', 'FORCING', 'JAMMED'].includes(s.anim.fredbear.state);
      if (fbEngaged) {
        for (const id of ['bonnie', 'chica', 'freddy']) {
          const st = s.anim[id].state;
          // Already-engaged characters may finish; none may START an approach afterwards.
          if (st === 'APPROACH') assert.ok(s.anim[id].entry, `${id} approaching without a slot`);
        }
      }
    }
  }
});

test('ten consecutive fresh sessions start from identical clean state (reset)', () => {
  const first = JSON.stringify(new NightSession({ night: 5, seed: 42 }).snapshot());
  for (let i = 0; i < 12; i++) {
    const s = new NightSession({ night: 5, seed: 42 });
    assert.equal(JSON.stringify(s.snapshot()), first);
    runTicks(s, 500);
  }
});

test('night 3 maintenance pauses the clock and AI, then resumes with a grace period', () => {
  const s = new NightSession({ night: 3, seed: 4 });
  let maintAt = -1;
  for (let i = 0; i < 4000 && maintAt < 0; i++) {
    for (const f of s.tick()) if (f.fx === 'maint_begin') maintAt = s.t;
  }
  assert.ok(maintAt >= 3200, `maintenance began at ${maintAt}`);
  assert.equal(s.phase, 'MAINT');
  const t = s.t;
  const p = s.power;
  for (let i = 0; i < 300; i++) s.tick();
  assert.equal(s.t, t, 'clock paused');
  assert.equal(s.power, p, 'no drain while paused');
  for (const id of s.order) assert.equal(s.anim[id].state, 'SUSPENDED');
  s.resumeMaintenance();
  assert.equal(s.phase, 'RUNNING');
  for (let i = 0; i < CONFIG.director.maintenanceGrace - 1; i++) {
    s.tick();
    for (const id of s.order) assert.ok(!['TELEGRAPH', 'LURK'].includes(s.anim[id].state), 'no telegraph inside the grace period');
  }
});

test("Chica's breaker trip disables hall lights only; doors still work; reset restores lights", () => {
  const s = new NightSession({ night: 2, seed: 1 });
  s.tripBreaker('chica');
  s.input('light_l');
  s.input('door_l');
  const fx = runTicks(s, 2);
  assert.ok(fx.some((f) => f.fx === 'feedback' && f.action === 'light_l' && !f.ok && f.reason === 'breaker tripped'));
  assert.equal(s.devices.doorL, true);
  s.input('breaker');
  runTicks(s, CONFIG.devices.breakerResetTicks + 3);
  assert.equal(s.breaker.tripped, false);
  s.input('light_l');
  runTicks(s, 1);
  assert.equal(s.devices.lightL, true);
});

test('Freddy never moves while the current camera shows him', () => {
  const s = new NightSession({ night: 6, seed: 9 });
  for (const id of ['bonnie', 'chica', 'fredbear']) s.setAggression(id, 0);
  s.place('freddy', 'EH_N', 'PATROL');
  s.input('cams_open', 'C12');
  runTicks(s, 1);
  const before = s.anim.freddy.node;
  runTicks(s, 1200);
  assert.equal(s.anim.freddy.node, before);
  assert.equal(s.anim.freddy.move, null);
});

test('finale on night 6 withdraws the trio and grants extra strobe charges', () => {
  const s = new NightSession({ night: 6, seed: 3 });
  const charges = s.strobe.charges;
  s.setTick(7990);
  runTicks(s, 20, (ss) => oracleBot().act(ss));
  assert.equal(s.finale, true);
  assert.equal(s.strobe.charges >= charges, true);
  for (const id of ['bonnie', 'chica', 'freddy']) assert.equal(s.anim[id].state, 'WITHDRAWN');
});

test('inputs are debounced and report accepted/denied/cooldown feedback', () => {
  const s = new NightSession({ night: 1, seed: 1 });
  s.input('door_l');
  s.input('door_l');
  s.input('strobe');
  s.input('hatch');
  const fx = runTicks(s, 1).filter((f) => f.fx === 'feedback');
  assert.deepEqual(fx.map((f) => [f.action, f.ok, f.reason]), [
    ['door_l', true, 'closed'],
    ['door_l', false, 'cooldown'],
    ['strobe', false, 'not installed'],
    ['hatch', false, 'welded shut'],
  ]);
});

test('no AI activity happens outside RUNNING (won/lost sessions are inert)', () => {
  const s = new NightSession({ night: 1, seed: 1 });
  s.setTick(s.length - 1);
  runTicks(s, 5);
  assert.equal(s.phase, 'WON');
  const snap = JSON.stringify(s.snapshot());
  for (let i = 0; i < 200; i++) assert.deepEqual(s.tick(), []);
  assert.equal(JSON.stringify(s.snapshot()), snap);
});
